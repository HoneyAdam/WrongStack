/** Cross-reference extraction for languages not handled by ts-parser.ts. */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Ref, SymbolLang } from './schema.js';

const GO_REFS_SCRIPT = `package main

import (
  "encoding/json"
  "fmt"
  "go/ast"
  "go/parser"
  "go/token"
  "os"
  "strconv"
)

type Ref struct {
  ToName string \`json:"toName"\`
  CallType string \`json:"callType"\`
  Line int \`json:"line"\`
}

func main() {
  if len(os.Args) < 2 { fmt.Print("[]"); return }
  fset := token.NewFileSet()
  node, err := parser.ParseFile(fset, os.Args[1], nil, 0)
  if err != nil { fmt.Print("[]"); return }
  refs := []Ref{}
  ast.Inspect(node, func(n ast.Node) bool {
    switch expr := n.(type) {
    case *ast.CallExpr:
      line := fset.Position(expr.Pos()).Line
      if ident, ok := expr.Fun.(*ast.Ident); ok {
        refs = append(refs, Ref{ident.Name, "call", line})
      } else if sel, ok := expr.Fun.(*ast.SelectorExpr); ok {
        if ident, ok := sel.X.(*ast.Ident); ok {
          refs = append(refs, Ref{ident.Name + "." + sel.Sel.Name, "call", line})
        }
      }
    case *ast.ImportSpec:
      if expr.Path != nil {
        if importPath, err := strconv.Unquote(expr.Path.Value); err == nil {
          refs = append(refs, Ref{importPath, "import", fset.Position(expr.Pos()).Line})
        }
      }
    }
    return true
  })
  data, err := json.Marshal(refs)
  if err != nil { fmt.Print("[]"); return }
  fmt.Print(string(data))
}
`;

const PY_REFS_SCRIPT = `import ast, json, sys

def name_of(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = name_of(node.value)
        return (parent + "." if parent else "") + node.attr
    if isinstance(node, ast.Subscript):
        return name_of(node.value)
    return ""

try:
    with open(sys.argv[1], "r", encoding="utf-8") as source_file:
        tree = ast.parse(source_file.read())
    refs = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = name_of(node.func)
            if name:
                refs.append({"toName": name, "callType": "call", "line": node.lineno})
        elif isinstance(node, ast.Import):
            for alias in node.names:
                refs.append({"toName": alias.name, "callType": "import", "line": node.lineno})
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            for alias in node.names:
                target = module + ("." if module and alias.name else "") + alias.name
                refs.append({"toName": target, "callType": "import", "line": node.lineno})
    print(json.dumps(refs))
except Exception:
    print("[]")
`;

export interface ExtractRefsOptions {
  file: string;
  content: string;
  lang: SymbolLang;
}

type RunnerRef = { toName: string; callType: Ref['callType']; line: number };

const runnerOptions = {
  timeout: 30_000,
  encoding: 'utf8' as const,
  windowsHide: true,
};

let goRunnerPromise: Promise<{ command: string; argsPrefix: string[] } | null> | undefined;
let pythonScriptPathPromise: Promise<string | null> | undefined;

function helperDirectory(name: string): string {
  return path.join(process.env.TEMP ?? process.env.TMP ?? '/tmp', name);
}

function runFile(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, runnerOptions, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function initializeGoRunner(): Promise<{ command: string; argsPrefix: string[] } | null> {
  goRunnerPromise ??= (async () => {
    try {
    const directory = helperDirectory('ws-go-refs');
    await mkdir(directory, { recursive: true });
    const scriptPath = path.join(directory, 'refs.go');
    const executablePath = path.join(directory, 'refs.exe');
    await writeFile(scriptPath, GO_REFS_SCRIPT, 'utf8');
    try {
      await runFile('go', ['build', '-o', executablePath, scriptPath]);
      return { command: executablePath, argsPrefix: [] };
    } catch {
      // Remember the failed compilation so subsequent files go straight to
      // `go run` instead of paying the same failed build cost each time.
      return { command: 'go', argsPrefix: ['run', scriptPath] };
    }
    } catch {
      return null;
    }
  })();
  return goRunnerPromise;
}

function initializePythonRunner(): Promise<string | null> {
  pythonScriptPathPromise ??= (async () => {
    try {
      const directory = helperDirectory('ws-py-refs');
      await mkdir(directory, { recursive: true });
      const scriptPath = path.join(directory, 'refs.py');
      await writeFile(scriptPath, PY_REFS_SCRIPT, 'utf8');
      return scriptPath;
    } catch {
      return null;
    }
  })();
  return pythonScriptPathPromise;
}

function parseRunnerOutput(stdout: string): Ref[] {
  if (!stdout.trim()) return [];
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): Ref[] => {
      const candidate = value as Partial<RunnerRef>;
      if (
        typeof candidate.toName !== 'string' ||
        typeof candidate.callType !== 'string' ||
        typeof candidate.line !== 'number'
      ) {
        return [];
      }
      return [
        {
          fromId: 0,
          toName: candidate.toName,
          callType: candidate.callType as Ref['callType'],
          line: candidate.line,
        },
      ];
    });
  } catch {
    return [];
  }
}

async function extractGoRefs(filePath: string): Promise<Ref[]> {
  const runner = await initializeGoRunner();
  if (!runner) return [];
  try {
    return parseRunnerOutput(await runFile(runner.command, [...runner.argsPrefix, filePath]));
  } catch {
    return [];
  }
}

async function extractPythonRefs(filePath: string): Promise<Ref[]> {
  const scriptPath = await initializePythonRunner();
  if (!scriptPath) return [];
  try {
    return parseRunnerOutput(await runFile('python', [scriptPath, filePath]));
  } catch {
    return [];
  }
}

/** Return refs with `fromId: 0`; the indexer replaces it with the owning symbol id. */
export async function extractRefs(opts: ExtractRefsOptions): Promise<Ref[]> {
  switch (opts.lang) {
    case 'go':
      return extractGoRefs(opts.file);
    case 'py':
      return extractPythonRefs(opts.file);
    default:
      // TS/JS refs are collected during ts-parser's single AST walk.
      return [];
  }
}
