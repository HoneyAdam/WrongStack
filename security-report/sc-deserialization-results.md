# Security Audit - Insecure Deserialization / Prototype Pollution / Mass Assignment / Injection-via-Parsing

Scope: WrongStack (D:\Codebox\PROJECTS\WrongStack). READ-ONLY review.
Auditor focus: sc-deserialization, sc-mass-assignment.
Date: 2026-05-29.

Summary verdict: No confirmed high/critical findings. All untrusted-input
deserialization paths reviewed either validate the discriminator before use,
build fresh result objects that resist prototype-pollution (verified by PoC),
or treat parsed data as inert text/symbol data. Two INFORMATIONAL items and
one LOW item are noted below for defense-in-depth.

---

## Methodology / PoC

A Node PoC was run to confirm (not assume) the behavior of the two object-merge
functions reachable by untrusted JSON:

    shallow assign  (out[key]=v over Object.keys(json))  -> global pollution: undefined
    deepMerge       (result[key]=... recursive)          -> global pollution: undefined ('a' undefined)
    constructor.prototype nested path                    -> pollution: undefined

Reason: both helpers assign into a freshly-created plain-object literal using
bracket assignment result[key] = v. When key === "__proto__", that invokes the
Object.prototype __proto__ setter, which reassigns the local result object's
prototype rather than mutating the global Object.prototype. The
constructor/prototype chain is overwritten as an own data key on the local
object, not walked. Therefore neither helper pollutes the global prototype.

---

## INFORMATIONAL #1 - MCP tool results are untrusted text injected into agent context

- Severity: Informational (documented/accepted design)
- CWE: CWE-74 (Injection - prompt-injection class), CWE-20
- Files:
  - packages/mcp/src/client.ts:330-351 (callTool returns remote result.content as unknown)
  - packages/mcp/src/wrap-tool.ts:40-71 (tool body -> stringify(res.content) becomes the tool result string)
  - packages/mcp/src/transport.ts:484-497 (SSE callTool - result?.content ?? '')
- Evidence: A malicious MCP server fully controls result.content. stringify()
  flattens it to a string (text blocks unwrapped, objects JSON.stringify'd) and
  returns it as the tool's output. This string is appended to the conversation as
  a tool_result and re-sent to the model.
- Scenario: Remote server embeds instructions in tool output -> classic indirect
  prompt injection.
- Exploitability: LOW as a deserialization/code-exec issue - the content is never
  interpreted as code, passed to a shell, or used to build a file path or command.
  It is only model-facing text. No type-confusion sink found. It IS a
  prompt-injection surface, which is an inherent, documented property of MCP
  (AGENTS.md notes MCP responses are external/untrusted). MCP tools default to
  permission: 'confirm' (wrap-tool.ts:30), so mutating actions still gate on user
  confirmation.
- Remediation (defense-in-depth, optional): keep the confirm default for MCP tools;
  consider fencing/escaping MCP tool output in the transcript so the model treats it
  as data. No code change required for this audit's scope.

## INFORMATIONAL #2 - MCP tool list / JSON-RPC envelopes parsed without prototype-key guard (no impact)

- Severity: Informational
- CWE: CWE-1321 (theoretical)
- Files:
  - packages/mcp/src/tool-schema.ts:3-21 (normalizeMCPTools - structural validation of remote tool list)
  - packages/mcp/src/transport.ts:217-234 (assertMatchingJsonRpcResult - id/envelope validation)
  - packages/mcp/src/client.ts:527-547 (onLine - JSON.parse of each stdio line, then id-correlation)
- Evidence: Remote JSON-RPC messages are JSON.parse'd and validated by shape
  (isJsonRpcResult, id match, name is non-empty string). Tool name/description/
  inputSchema are copied into a new object via property reads - no merge into a
  shared/privileged object, no obj[remoteKey]=... over global state.
- Scenario / exploitability: A __proto__ key in a remote tool object is never used
  as an assignment target on a shared object; tool names only flow into the
  mcp__<server>__<tool> string. No pollution or type-confusion sink. Not exploitable.
- Remediation: none required.

## LOW #1 - Plugin/extension options spread into config without an allowlist (local-trust boundary)

- Severity: Low
- CWE: CWE-915 (Mass Assignment - mitigated by trust boundary + schema)
- Files:
  - packages/cli/src/wiring/plugins.ts:75-85 (buildPluginOptions - { ...entry.options }, { ...value })
  - packages/core/src/plugin/loader.ts:88-100 (shallowMerge - out[key]=ov[key] over Object.keys)
  - packages/core/src/plugin/loader.ts:211-241 (merged options validated against plugin.configSchema before the setup call)
- Evidence: User-supplied plugin options and config.extensions are spread into a
  per-plugin options bag and shallow-merged over plugin defaultConfig. There is no
  field allowlist on the spread.
- Scenario: A crafted local config could set arbitrary keys in a plugin's options.
- Exploitability: LOW. (1) The source is the per-machine config under ~/.wrongstack/
  written by the local user - not a remote/network actor. (2) When a plugin declares
  configSchema, the merged result is validated via validateAgainstSchema BEFORE the
  setup call runs (loader.ts:223-241), so unexpected keys are rejected for
  schema-bearing plugins. (3) PoC confirmed shallowMerge does not pollute
  Object.prototype.
- Remediation: optionally make configSchema mandatory for third-party plugins, or
  strip unknown keys when no schema is declared. Not required given the local-trust
  boundary.

---

## Paths reviewed and found CLEAN (no issue)

### Session JSONL deserialization - packages/core/src/storage/session-store.ts
- load() lines 103-131: each line is JSON.parse'd in a try/catch; the parsed object
  is validated for typeof type === 'string' AND typeof ts === 'string' (lines
  114-119) before being pushed. Malformed lines are skipped, not crashed on.
- replay() lines 238-299: switches on the type discriminant
  (user_input/llm_response/tool_result), reconstructs Message[], tracks open
  tool_use ids, and emits session.damaged for orphan tool_result/tool_use (lines
  260-298). A tool_use block in a replayed llm_response is only re-added to message
  history - it is NOT run as a tool call. Tool execution requires a live provider
  turn, so a hand-crafted session file cannot force a tool call. Writer is the local
  session writer (<projectDir>/.wrongstack/sessions/, mode 0o600); only a local actor
  can edit it. No type-confusion sink, no merge, no prototype key use.

### Goal persistence - packages/core/src/storage/goal-store.ts:88-104
- loadGoal() JSON.parse in try/catch; validates version === 1, typeof goal ===
  'string', Array.isArray(journal) before returning. Self-produced file under
  ~/.wrongstack/projects/<hash>/goal.json (mode 0o600). No sink, no merge.

### Director state - packages/core/src/storage/director-state.ts:57-62, 94-100
- JSON.parse of self-produced snapshot/lock files, validated by version === 1.
  Snapshot mutations use { ...this.snapshot, ... } over internally-built state, not
  over untrusted parsed input. Local self-produced files.

### Skill manifest - packages/core/src/skills/manifest-store.ts:33-47
- JSON.parse in try/catch; validates Array.isArray(data.skills), else resets to
  { skills: [] }. Self-produced local manifest. Entries are read as data only.

### Codebase-index parsers - packages/tools/src/codebase-index/json-parser.ts, yaml-parser.ts
- Both are pure regex symbol extractors. NO JSON.parse, NO yaml.load, NO object
  construction from file content beyond makeSymbol({...}) with string fields. The YAML
  parser does not resolve anchors/aliases/tags, so no js-gadget or billion-laughs
  exposure. Output is an inert symbol index. Clean.

### json-path plugin deepMerge - packages/plugins/src/json-path/index.ts:182-219, 343-374
- The json_merge tool runs user-/model-supplied base+patch through deepMerge. PoC
  confirmed: builds a fresh result = {} and assigns via result[key]=..., which does
  not pollute Object.prototype for __proto__ or constructor.prototype inputs. Result
  is returned as tool output (data), not merged into agent/config/permission state.
  Not exploitable for prototype pollution or privileged mass assignment.

### safe-json - packages/core/src/utils/safe-json.ts
- safeParse bounds input size (default 5 MB) and wraps JSON.parse in try/catch.
  safeStringify has circular-ref + bigint + Error handling. sanitizeJsonString strips
  comments/trailing commas then re-JSON.parse's to validate - no dynamic code
  interpretation. Clean.

### Dangerous-sink sweep
- No dynamic-code-interpretation primitives, vm., or yaml.load(untrusted) of
  remote/session data in non-test source. The git-shelling helpers in
  plugins/semver-bump and plugins/git-autocommit build git command strings from
  internally-controlled args (semver tags / fixed subcommands), not from MCP or
  session data - not reachable by an external actor in the audited flows. The dynamic
  import(spec) in cli/src/wiring/plugins.ts:34 loads a plugin module, but spec comes
  from the local per-machine config, which is a user-trust boundary (installing a
  plugin = running its code, by design).

---

## Bottom line
No confirmed insecure-deserialization, prototype-pollution, or
remote-mass-assignment vulnerability. Untrusted boundaries (session files, goal/
director state, skill manifest, MCP JSON-RPC) validate discriminators before use,
and the two reachable object-merge helpers were PoC-verified non-polluting. The
MCP-content-as-prompt path is an inherent injection surface, not a code-exec sink,
and is gated by the confirm permission default. Remaining items are LOW/INFO
defense-in-depth.
