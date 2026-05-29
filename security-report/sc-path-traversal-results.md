# Path Traversal / Arbitrary File R-W / File-Upload Audit — WrongStack

Scope: filesystem tools (`packages/tools/src/*`), core storage (`packages/core/src/storage/*`, `utils/atomic-write.ts`), webui static serving (`packages/webui/src/server/index.ts`), skill archive extraction (`packages/core/src/skills/github-fetcher.ts`), and scaffold/pack writers.

Read-only review. No source files were modified.

---

## Finding 1 — Zip-Slip / tar path traversal in GitHub skill extractor

- **Severity:** High
- **Status:** CONFIRMED
- **CWE:** CWE-22 (Improper Limitation of a Pathname to a Restricted Directory) / CWE-29 (Path Traversal: '..\filename')
- **Location:** `packages/core/src/skills/github-fetcher.ts:127-156` (function `extractTar`, sink at line 154)

### Sink
```ts
const fullPath = prefix ? `${prefix}/${name}` : name;        // line 132 — from tar header
const relPath = stripTopDir(fullPath);                        // line 133 — strips owner-repo-sha/
if (relPath && relPath !== '.' && relPath !== '..') {         // line 135 — only rejects exact '.'/'..'
  const destPath = path.join(destDir, relPath);               // line 137 — NO containment check
  ...
  await fs.writeFile(destPath, buf.subarray(dataStart, dataEnd));  // line 154 — write sink
}
```

### Path source & trust
`name` (offset 0, 100 bytes) and `prefix` (offset 345, 155 bytes) are read verbatim from the
tar header of a downloaded archive. The archive comes from
`https://api.github.com/repos/<owner>/<repo>/tarball/<ref>` where owner/repo/ref are derived from
the user-supplied skill reference (`parseSkillRef`). Trust level: **untrusted** — the archive body
is third-party content (any GitHub repo, including an attacker-controlled one) and the entry names
inside it are fully attacker-chosen. GitHub canonical tarballs are well-formed, but nothing forces
the installed skill to be a benign repo; an attacker who can get a user to run
`install skill evil/repo` controls every byte of the tar.

### Validation present / bypass
- The guard at line 135 only rejects `relPath === '.'` or `relPath === '..'` exactly. It does **not**
  reject `relPath` values containing `..` segments (e.g. `../../../../home/user/.bashrc`,
  `../../.ssh/authorized_keys`) or, on Windows, backslash/drive-letter forms.
- There is **no** `path.relative(destDir, destPath)` containment check and no `realpath` check.
- `path.join(destDir, '../../../etc/cron.d/x')` resolves outside `destDir` and `fs.writeFile`
  happily writes there.
- Mitigating factor: symlink entries are skipped — only `typeflag` `0x30`/`0`/`0x00` (regular file)
  and `0x35` (dir) are handled; symlink (`0x32`/'2') and hardlink entries fall through and are
  ignored. So symlink-based escape is not available, but **direct `..` traversal in a regular-file
  entry name is**.
- `destDir` is a fresh `os.tmpdir()/wskill-XXXX` mkdtemp dir, so escapes target paths relative to
  the system temp dir's parent chain — still reaches arbitrary absolute locations the process can
  write (`/tmp/../<anywhere>`).

### Exploitability
Reachable whenever a skill is installed from a GitHub ref. A crafted tarball entry named
`x/../../../../<victim path>` (the `x/` survives `stripTopDir`, leaving `../../../../<victim path>`)
causes an arbitrary-location file write with attacker-controlled content. This is a classic
zip-slip → arbitrary file write, escalatable to RCE (drop a shell rc / cron / startup script).
Note: the install flow itself is user-initiated, but the user is trusting "install this skill", not
"let this skill overwrite arbitrary files on my disk".

### Remediation
After computing `destPath`, enforce containment before any `mkdir`/`writeFile`:
```ts
const destPath = path.resolve(destDir, relPath);
const rel = path.relative(destDir, destPath);
if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue; // or throw
```
Also normalize separators and reject absolute / drive-letter entry names before the join.

---

## Finding 2 — Session id is not validated before path join (local-only)

- **Severity:** Low
- **Status:** SUSPECTED (local-only; no remote reach found)
- **CWE:** CWE-22
- **Location:** `packages/core/src/storage/session-store.ts:38` (create), `:61` (resume), `:104` (load), also `summaryFor` at `:~/.summary.json`

### Sink
```ts
const file = path.join(this.dir, `${id}.jsonl`);   // load/resume/create
const raw = await fsp.readFile(file, 'utf8');       // load() read sink
handle = await fsp.open(file, 'a', 0o600);          // create/resume write sink
```

### Path source & trust
`id` for `resume`/`load` originates from the CLI `--resume <id>` flag / `wstack resume <id>`
positional (`packages/cli/src/wiring/session.ts:49,69`). Trust level: **local user argument**.
No `..`/absolute-path/null-byte validation; `.jsonl` is appended (which blunts but does not fully
prevent traversal — e.g. `--resume ../../foo` reads `<dir>/../../foo.jsonl`).

### Validation present / bypass
No id sanitization. The `.jsonl` suffix is the only constraint. A local user could read/append a
`.jsonl` file outside the sessions dir. Because the only caller path is a flag the local user
themselves passes, and the user already has full local FS access, this is **not a privilege
boundary crossing** — it is by-design "user picks a file". The webui server does **not** expose any
resume/load-by-arbitrary-id endpoint: the webui creates its own session
(`sessionStore.create({ id: '' ... })`) and never feeds a request-derived id into `load`/`resume`.
So there is no remote/LLM-driven reach.

### Exploitability
Local user only; no remote or LLM-tool reach. Documented for completeness / defense-in-depth.

### Remediation (defense-in-depth)
Validate `id` against an allowlist (ULID/timestamp-hex shape) or assert
`!id.includes('/') && !id.includes('\\') && !id.includes('..')` in `create`/`resume`/`load` before
the `path.join`.

---

## Reviewed and assessed SAFE (existing containment controls)

- **`packages/tools/src/_util.ts:18` `safeResolve`** — composes `resolvePath` + `ensureInsideRoot`,
  which does `path.relative(projectRoot, target)` and rejects `..`/absolute. This is the standard
  containment used by read/write/edit/glob/grep/tree/diff/document/patch/scaffold and the run-tools.
  Note: `ensureInsideRoot` (`:8`) is a **string/normalize** check, not a `realpath` check, so a
  symlink *inside* the project root pointing outside would pass the string test. The mutating tools
  that matter compensate (see below); the read-only listing tools do not, but the impact is bounded.
- **`read.ts:41`** — `safeResolve`, `permission: 'auto'` but contained to project root; size-capped,
  binary-rejected. Auto permission is acceptable because containment holds.
- **`write.ts:38`** — `safeResolve`, `permission: 'confirm'`, atomicWrite.
- **`edit.ts:57` / `:125`** — `safeResolve`, read-before-write invariant, atomicWrite.
- **`replace.ts:88-151`** — strongest of the set: `safeResolve` + `lstat` symlink skip +
  `fs.realpath` cross-check + `path.relative(projectRoot, realPath)` containment, then writes to the
  **realpath** (defeats symlink-bait TOCTOU on the temp-and-rename). No issue.
- **`patch.ts:46-71`** — forces `strip >= 1` (blocks absolute-path diffs), pre-flight scans every
  `+++` target with `path.relative(projectRoot, candidate)` containment and refuses escapes; writes
  the diff into a private `0700` mkdtemp dir. Minor SUSPECTED gap: only `+++` (new-file) targets are
  scanned, not `---` (old-file) lines; with GNU `patch --merge -pN` the effective target is normally
  the `+++` name, so this is low concern — worth noting but not a confirmed escape.
- **`scaffold.ts:114-140`** — `safeResolve(cwd)` + explicit per-file
  `path.relative(projectRoot, target)` containment that blocks template-variable injection
  (e.g. `name` = `../../x`). atomicWrite. No issue.
- **`glob.ts:41`** — `safeResolve` base; read-only path listing. Follows symlinked dirs via
  `isDirectory()` (no realpath), but only emits file path strings (no content read), so worst case is
  listing names of a symlinked-in dir — low/no impact.
- **`grep.ts:61,275-276`** — `safeResolve` base and explicitly **skips symlinks** (Dirent type check
  without following). No escape.
- **`tree.ts:87` / `diff.ts:135,156` / `document.ts:81,90`** — all gated on `safeResolve`. No
  unguarded sink observed.
- **`memory.ts`** — no filesystem path argument at all; writes are keyed by a fixed `scope` enum
  (`project-agents`/`project-memory`/`user-memory`). No traversal surface.
- **`pack.ts`** — not a file writer; it is a static tool-registry object (`builtinToolsPack`). The
  scope line describing it as "writing files to arbitrary paths" does not match the code.
- **`attachment-store.ts:44-65,108-138`** — spool path is `path.join(spoolDir, ${id}.bin)` where
  `id` is internally generated (`kindPrefix-seq-randomHex`); `att.path` is only ever that internal
  spool path. `meta.filename` is used solely as a display label in `toBlock`, never as a read path.
  No user-controlled path reaches the `readFile`/`writeFile`/`unlink` sinks. No issue.
- **`atomic-write.ts`** — writes wherever the caller specifies (temp `.<base>.<rand>.tmp` in the
  target's own dir + exclusive `wx` + rename-with-retry). No path validation of its own — by design;
  all callers pass already-contained paths. No independent issue.
- **`webui/src/server/index.ts:1868-1929` (static file server)** — CONFIRMED SAFE. Builds
  `filePath = path.join(DIST_DIR, url.pathname)` from the request URL, then enforces containment at
  `:1886-1892`: `path.resolve(filePath)` must satisfy
  `resolvedPath.startsWith(resolvedRoot + path.sep) || resolvedPath === resolvedRoot`, else `403`.
  The comment at `:1884` correctly notes `new URL()` decodes `%2e%2e`, and the check runs on the
  resolved path so encoded `..` traversal is blocked. Cannot read outside `dist/`.
- **`webui` file-picker walk (`:1503-1528`)** — walks from the fixed `projectRoot`, emits only
  relative paths, never reads file contents by a request-supplied path. No traversal.

---

## Summary

Two issues. One is a CONFIRMED High-severity zip-slip/tar path-traversal arbitrary-file-write in the
GitHub skill extractor (`github-fetcher.ts` `extractTar`, line 137/154) — no `..` containment on the
destination path. One is a Low-severity, local-only, SUSPECTED unsanitized session-id path join
(`session-store.ts`), not reachable remotely or via the LLM. All other filesystem tools, the webui
static server (explicit containment guard), atomic-write, and the attachment store are safe; most
mutating tools use `safeResolve` and `replace.ts`/`patch.ts`/`scaffold.ts` add symlink-realpath /
strip / template-injection guards on top.
