/**
 * Python source symbol extraction using the `ast` module.
 *
 * Spawns a `python -c` child process that parses the file with Python's `ast`
 * module and emits JSON. Falls back to empty results on any error.
 *
 * Extracts: class, function, async function, const, var, import, import_from
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveWin32Command } from '../_win32-resolve.js';
import type { FileSymbols, Symbol as IndexSymbol, SymbolLang } from './schema.js';

// ─── Public API ─────────────────────────────────────────────────────────────

export async function parseSymbols(opts: { file: string; content: string; lang: SymbolLang }): Promise<FileSymbols> {
  const { file, content, lang } = opts;

  try {
    return await syncPyParse(file, content, lang);
  } catch {
    /* v8 ignore next -- syncPyParse has its own catch; this outer guard is defensive. */
    return { file, lang, symbols: [], mtimeMs: Date.now() };
  }
}

export { detectLang } from './ts-parser.js';

// ─── Inline Python parser script ────────────────────────────────────────────

const PY_PARSE_SCRIPT = `import ast, json, sys, os

def get_name(node):
    if isinstance(node, ast.Name):
        return node.id
    elif isinstance(node, ast.Attribute):
        return get_name(node.value) + "." + node.attr
    elif isinstance(node, ast.Subscript):
        return get_name(node.value)
    elif isinstance(node, ast.Call):
        return get_name(node.func)
    elif isinstance(node, ast.Constant):
        return str(node.value)
    return ""

def get_decorators(node):
    decs = []
    for dec in node.decorator_list:
        decs.append(get_name(dec))
    return decs

def get_bases(node):
    bases = []
    for base in node.bases:
        bases.append(get_name(base))
    return bases

def get_args(args):
    parts = []
    for arg in args.args:
        parts.append(arg.arg)
    return ", ".join(parts)

def get_returns(node):
    if node.returns is None:
        return ""
    return get_name(node.returns)

class Sym:
    def __init__(self, name, kind, line, col, signature, scope):
        self.name = name
        self.kind = kind
        self.line = line
        self.col = col
        self.signature = signature
        self.scope = scope
    def to_dict(self):
        return {
            "name": self.name,
            "kind": self.kind,
            "line": self.line,
            "col": self.col,
            "signature": self.signature,
            "scope": self.scope,
        }

def is_private(name):
    return name.startswith("__") and not name.endswith("__")

syms = []
errors = []

try:
    source = sys.stdin.read()
    tree = ast.parse(source, filename=sys.argv[1])
except Exception as e:
    errors.append(str(e))
    print("[]")
    sys.exit(0)

# Module-level scope
module_scope = os.path.basename(sys.argv[1])[:-3]  # strip .py

class ModuleVisitor(ast.NodeVisitor):
    def __init__(self):
        self.scope_stack = [module_scope]

    def visit_ClassDef(self, node):
        bases = get_bases(node)
        decs = get_decorators(node)
        sig = "class " + node.name
        if bases:
            sig += "(" + ", ".join(bases) + ")"
        sig += ": ..."
        syms.append(Sym(
            name=node.name,
            kind="class",
            line=node.lineno,
            col=node.col_offset,
            signature=sig,
            scope=".".join(self.scope_stack) + "." + node.name,
        ))
        self.scope_stack.append(node.name)
        self.generic_visit(node)
        self.scope_stack.pop()

    def visit_FunctionDef(self, node):
        decs = get_decorators(node)
        args = get_args(node.args)
        returns = get_returns(node)
        is_async = isinstance(node, ast.AsyncFunctionDef)

        kind = "function"
        prefix = "def "
        if decs:
            for d in decs:
                if d.endswith(".staticmethod"):
                    kind = "staticmethod"
                elif d.endswith(".classmethod"):
                    kind = "classmethod"
                elif d == "property":
                    kind = "property"

        if is_async:
            kind = "async_" + kind

        sig = f"{prefix}{node.name}({args})"
        if returns:
            sig += f" -> {returns}"
        scope = ".".join(self.scope_stack) + "." + node.name

        syms.append(Sym(
            name=node.name,
            kind=kind,
            line=node.lineno,
            col=node.col_offset,
            signature=sig,
            scope=scope,
        ))
        # Don't descend into function bodies to avoid local symbols
        # self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node):
        # Treat as function
        self.visit_FunctionDef(node)

    def visit_Assign(self, node):
        for target in node.targets:
            if isinstance(target, ast.Name):
                name = target.id
                if is_private(name):
                    continue
                # Infer constness from UPPER_CASE naming
                kind = "const" if name.isupper() else "var"
                col = target.col_offset if hasattr(target, 'col_offset') else 0
                syms.append(Sym(
                    name=name,
                    kind=kind,
                    line=node.lineno,
                    col=col,
                    signature=f"{name} = ...",
                    scope=".".join(self.scope_stack),
                ))

    def visit_AnnAssign(self, node):
        if isinstance(node.target, ast.Name):
            name = node.target.id
            if is_private(name):
                return
            kind = "const" if name.isupper() else "var"
            col = node.target.col_offset if hasattr(node.target, 'col_offset') else 0
            sig = f"{name}: {get_name(node.annotation)}"
            if node.value:
                sig += " = ..."
            syms.append(Sym(
                name=name,
                kind=kind,
                line=node.lineno,
                col=col,
                signature=sig,
                scope=".".join(self.scope_stack),
            ))

    def visit_Import(self, node):
        for alias in node.names:
            name = alias.asname or alias.name
            syms.append(Sym(
                name=name,
                kind="import",
                line=node.lineno,
                col=node.col_offset,
                signature=f"import {alias.name}",
                scope=".".join(self.scope_stack),
            ))

    def visit_ImportFrom(self, node):
        module = node.module or ""
        for alias in node.names:
            name = alias.asname or alias.name
            syms.append(Sym(
                name=name,
                kind="import",
                line=node.lineno,
                col=node.col_offset,
                signature=f"from {module} import {alias.name}",
                scope=".".join(self.scope_stack),
            ))

visitor = ModuleVisitor()
visitor.visit(tree)

print(json.dumps([s.to_dict() for s in syms]))
`;

// ─── Synchronous Python parse via child process ─────────────────────────────

/**
 * Cross-platform Python binary resolver.
 *
 * Windows: walks PATHEXT via `resolveWin32Command` (handles .exe/.cmd/.bat).
 *          A match means a real file on disk — return it immediately.
 * macOS / Linux: `resolveWin32Command` is a pass-through. We verify each
 *          candidate with `spawnSync --version` — the only reliable way to
 *          check that a binary actually exists on PATH. Cost is a single
 *          short-lived process per lookup, cached for the process lifetime.
 *
 * Candidates in priority order:
 *   Windows:  python3 → python → py (Python launcher)
 *   Unix:     python3 → python
 */
function resolvePython(): string | null {
	const candidates = process.platform === 'win32'
		? ['python3', 'python', 'py']
		: ['python3', 'python'];
	for (const name of candidates) {
		const resolved = resolveWin32Command(name);
		// On Windows: if resolution changed the name, a real .exe was found.
		// On Unix: resolved === name always; verify with spawnSync.
		if (process.platform === 'win32' && resolved !== name) return resolved;
		const result = spawnSync(resolved, ['--version'], {
			stdio: 'pipe',
			timeout: 5_000,
		});
		if (result.error) continue; // ENOENT or similar — try next
		if (result.status !== 0) continue; // binary exists but broken
		return resolved;
	}
	return null;
}

/**
 * Spawn the Python parser child process with proper error handling.
 *
 * Returns a promise that resolves to { code, stdout } or rejects with an
 * Error (ENOENT, timeout, spawn error) that the caller converts to empty
 * results. The 'error' event listener is critical: without it, a spawn
 * ENOENT on Windows crashes as an unhandled exception because
 * ChildProcess emits 'error' asynchronously and the Promise.race only
 * listens on 'close'.
 */
function spawnPyParser(
	pyBinary: string,
	scriptPath: string,
	filePath: string,
	content: string,
): Promise<{ code: number | null; stdout: string }> {
	return new Promise((resolve, reject) => {
		let settled = false;

		const proc: ChildProcess = spawn(pyBinary, [scriptPath, filePath], {
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});

		// Mandatory: catch ENOENT / permission-denied / spawn failures.
		proc.on('error', (err) => {
			if (settled) return;
			settled = true;
			reject(err);
		});

		// Write source content via stdin so the child doesn't reopen the file.
		proc.stdin?.write(content);
		proc.stdin?.end();

		let stdout = '';
		proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });

		// Discard stderr to avoid backpressure deadlocks when Python emits
		// warnings (e.g. deprecation notices).
		proc.stderr?.resume();

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			proc.kill('SIGKILL');
			reject(new Error('timeout'));
		}, 15_000);
		timer.unref?.();

		proc.on('close', (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ code, stdout });
		});
	});
}

// Cache the temp script path + resolved Python binary so we don't rewrite
// or re-resolve on every file.
let _cachedScriptPath: string | null = null;
let _cachedPyBinary: string | null = null;

async function syncPyParse(filePath: string, content: string, lang: SymbolLang): Promise<FileSymbols> {
	try {
		// Write the parser script once per process — not per file.
		// Passing the whole 200-line program via `python -c "..."` breaks
		// under cmd.exe on Windows (embedded newlines truncate the command).
		// A real file sidesteps all quoting and can be reused across calls.
		if (!_cachedScriptPath) {
			const tmpDir = path.join(os.tmpdir(), 'ws-py-parse');
			await fs.mkdir(tmpDir, { recursive: true });
			_cachedScriptPath = path.join(tmpDir, 'parse.py');
			await fs.writeFile(_cachedScriptPath, PY_PARSE_SCRIPT, 'utf8');
		}

		// Resolve Python binary once (expensive: walks PATH on Windows).
		if (!_cachedPyBinary) {
			_cachedPyBinary = resolvePython();
			if (!_cachedPyBinary) return { file: filePath, lang, symbols: [], mtimeMs: Date.now() };
		}

		// argv-array form: no shell, so a hostile filename cannot inject commands.
		// Content is piped via stdin — avoids a second file read in the child.
		const { code, stdout } = await spawnPyParser(
			_cachedPyBinary,
			_cachedScriptPath,
			filePath,
			content,
		);

		if (code !== 0 || !stdout.trim()) {
			return { file: filePath, lang, symbols: [], mtimeMs: Date.now() };
		}

		const raw = JSON.parse(stdout.trim()) as Array<{
			name: string;
			kind: string;
			line: number;
			col: number;
			signature: string;
			scope: string;
		}>;
		const symbols: IndexSymbol[] = raw.map((s) => ({
			id: 0,
			lang,
			kind: s.kind as IndexSymbol['kind'],
			name: s.name,
			file: filePath,
			line: s.line,
			col: s.col,
			signature: s.signature ?? '',
			docComment: '',
			scope: s.scope ?? '',
			text: `${s.name} ${s.signature ?? ''}`.trim(),
		}));
		return { file: filePath, lang, symbols, mtimeMs: Date.now() };
	} catch {
		return { file: filePath, lang, symbols: [], mtimeMs: Date.now() };
	}
}