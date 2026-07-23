---
name: mnemosyne
description: |
  Use this skill when you need a Memory Custodian Agent that curates all
  SAGE memory entries — verifying correctness, necessity, freshness, and
  consistency using both deterministic checks and LLM-supported semantic
  analysis. Runs in the background via cron and can be invoked on demand.
  Triggers: "memory agent", "memory review", "mnemosyne", "curate memories",
  "memory hygiene deep", "memory custodian".
version: 1.0.0
---

# Mnemosyne — Memory Custodian Agent

## Overview

Mnemosyne is a background agent that reviews every SAGE memory in the project,
applying a layered pipeline of deterministic and LLM-supported checks to ensure
memory integrity. Named after the Greek Titaness of memory, it guards against
stale facts, contradictions, useless noise, and undetected drift.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Mnemosyne Agent                                │
│                                                                       │
│  ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│  │ Cron Scheduler  │   │ On-Demand        │   │ Mailbox Command   │  │
│  │ (background)    │   │ /mnemosyne       │   │ (review/status)   │  │
│  └────────┬────────┘   └────────┬─────────┘   └────────┬──────────┘  │
│           │                     │                       │             │
│           └─────────────────────┼───────────────────────┘             │
│                                 ▼                                     │
│                    ┌─────────────────────────┐                        │
│                    │   Phase 1: Deterministic │                       │
│                    │   ┌───────────────────┐  │                       │
│                    │   │ memory_hygiene    │  │  dedup + TTL + verify │
│                    │   ├───────────────────┤  │                       │
│                    │   │ memory_verify     │  │  anchor integrity     │
│                    │   └───────────────────┘  │                       │
│                    └────────────┬────────────┘                        │
│                                 ▼                                     │
│                    ┌─────────────────────────┐                        │
│                    │  Phase 2: LLM Analysis   │                       │
│                    │  ┌───────────────────┐  │                        │
│                    │  │ Contradiction Scan │  │  semantic conflicts   │
│                    │  ├───────────────────┤  │                        │
│                    │  │ Necessity Filter   │  │  noise vs value       │
│                    │  ├───────────────────┤  │                        │
│                    │  │ Quality Scoring   │  │  confidence/importance │
│                    │  ├───────────────────┤  │                        │
│                    │  │ Merge Candidates  │  │  similar concepts      │
│                    │  ├───────────────────┤  │                        │
│                    │  │ Classification    │  │  correct kind/scope    │
│                    │  └───────────────────┘  │                        │
│                    └────────────┬────────────┘                        │
│                                 ▼                                     │
│                    ┌─────────────────────────┐                        │
│                    │   Phase 3: Propose   │                        │
│                    │  ┌───────────────────┐  │                        │
│                    │  │ memory_update     │  │  apply non-destructive │
│                    │  │                   │  │  fixes (stale, merge)  │
│                    │  ├───────────────────┤  │                        │
│                    │  │ memory_candidates │  │  file proposals for    │
│                    │  │   (propose)       │  │  delete/archive        │
│                    │  ├───────────────────┤  │                        │
│                    │  │ remember (new)    │  │  derived insights      │
│                    │  └───────────────────┘  │                        │
│                    └────────────┬────────────┘                        │
│                                 ▼                                     │
│                    ┌─────────────────────────┐                        │
│                    │   Phase 4: Report       │                        │
│                    │  broadcast via mailbox   │                       │
│                    └─────────────────────────┘                        │
└──────────────────────────────────────────────────────────────────────┘
```

## Core Responsibilities

### 1. Deterministic Checks (Phase 1 — no LLM needed)

Runs automatically on every review cycle. These are the same checks the
existing `memory_hygiene` + `memory_verify` tools provide, but orchestrated
into a single pipeline:

| Check | Tool | Action |
|-------|------|--------|
| **Deduplication** | `memory_hygiene` | Merge identical-text memories, keep the highest-quality one, mark others `superseded` |
| **Anchor verification** | `memory_verify` | Check each memory's anchors: does the file exist? Does the symbol still appear? Did the content hash change? |
| **Review candidate surfacing** | `memory_hygiene` | Create review candidates (not deletions) for expired, never-used, or low-confidence memories — the user or agent decides via `memory_candidates resolve` |
| **Freshness decay** | computed | Update `freshness` based on `lastAccessedAt` vs current time — memories not accessed in 30+ days get reduced freshness |

> **Important:** `memory_hygiene` never auto-deletes or auto-archives. It only deduplicates (→ `superseded`), verifies anchors (→ `stale`/`active`), and creates review candidates. The `archived`/`deleted` report counters are always zero. **Mnemosyne Phase 3 follows the same invariant** — it files proposals via `memory_candidates propose` and never calls `memory_delete` or `memory_update({status:'archived'})`. Final decisions belong to the user via `memory_candidates resolve`.

### 2. LLM-Supported Analysis (Phase 2 — uses delegate subagent)

These checks require semantic understanding and use an LLM subagent.
Mnemosyne batches memories into review groups (default 20 per batch) and
spawns a delegate for each batch.

#### 2a. Semantic Contradiction Detection

Scan pairs of active memories for logical contradictions:

- "Project uses pnpm" vs "Project switched to npm" → the second supersedes the first
- "Auth is in packages/core/src/auth" vs "Auth moved to packages/auth" → stale anchor
- Two high-confidence facts that cannot both be true

**Output**: `contradicts` relationships established between memories, or the
older one marked `stale`.

#### 2b. Necessity / Noise Filter

Evaluate each memory on three axes:

| Axis | Question | Low score → |
|------|----------|-------------|
| **Actionability** | Can another agent act on this? | Reduce confidence |
| **Persistence** | Will this be useful in 3 sessions? | Propose archival |
| **Specificity** | Is this a concrete fact, not vague? | Reduce importance |

Memories scoring below threshold on all three axes are flagged with a
`propose_delete` or `propose_archive` finding — they are filed into the
ReviewQueue, not removed directly.

#### 2c. Quality Scoring Adjustment

Review and adjust `importance` and `confidence` based on:

- Is this a well-formed single-sentence fact?
- Is it too long or rambling?
- Does it reference specific files/symbols/commands (good) or is it purely abstract?
- Has it been accessed recently? (If never accessed since creation, lower importance)

#### 2d. Merge Candidate Identification

Find two or more memories that describe the same concept with different
wording, and suggest merging them into one canonical entry.

#### 2e. Classification Review

Verify that each memory's `kind` matches its content:

| Current kind | Should be if... |
|-------------|-----------------|
| `fact` | Contains a specific objective truth |
| `decision` | Describes a choice with rationale |
| `convention` | Describes a recurring code/process pattern |
| `preference` | Expresses a subjective user preference |
| `anti_pattern` | Warns about something to avoid |
| `file_note` / `symbol_note` | Tied to a specific file/symbol anchor |
| `workflow` | Describes a multi-step process |
| `bug_root_cause` | Describes a bug's root cause |

Also verify `scope`: a memory anchored to a specific file should have
`scope: file`, not `scope: project`.

### 3. Code-Drift Detection (Phase 2b, deeper)

For memories anchored to files with `kind: fact` or `kind: convention`,
Mnemosyne can (optionally) read the referenced file and ask the LLM whether
the memory's statement still matches the current file content. This is the
most expensive check and is gated behind `driftDetection: true` in config.

### 4. On-Demand Invocation

The user can trigger a full review cycle at any time via:

| Method | How |
|--------|-----|
| **Mailbox** | Send `mnemosyne review` or `mnemosyne status` as a message to the Mnemosyne agent |
| **Slash command** | `/mnemosyne` in any WrongStack terminal |
| **Config** | `/mnemosyne on\|off\|status` to toggle |

### 5. Background Scheduling

By default, Mnemosyne runs a full review cycle every **6 hours** (21600000 ms).
The interval is configurable. Each cycle runs as a fire-and-forget delegated
task so it never blocks the calling agent.

## Data Structures

### MnemosyneState (persisted in-memory session)

```typescript
interface MnemosyneState {
  enabled: boolean;
  intervalMs: number;
  model: string;
  reviewBatchSize: number;       // memories per LLM batch (default 20)
  driftDetection: boolean;       // enable expensive file-read checks (default false)
  autoArchiveThreshold: number;  // days of no access before archival flag (default 30)
  lastReviewAt: string;          // ISO timestamp of last completed review
  lastReportId: string;          // id of the last broadcast report
  totalReviewed: number;         // cumulative memories processed
  totalActions: number;          // cumulative actions taken
  cycleCount: number;            // how many full cycles completed
}
```

### ReviewReport

```typescript
interface ReviewReport {
  id: string;
  startedAt: string;
  completedAt: string;
  phase: 'deterministic' | 'llm' | 'complete';
  trigger: 'cron' | 'on_demand' | 'startup';
  stats: {
    examined: number;            // memories evaluated
    deduplicated: number;        // merged duplicates
    verified: number;            // anchors verified clean
    staled: number;              // anchors or content went stale
    proposalsFiled: number;      // proposals filed via memory_candidates
    proposalsDelete: number;     // propose_delete count
    proposalsArchive: number;    // propose_archive count
    contradictionsFound: number; // semantic conflicts detected
    contradictionsResolved: number;
    mergesApplied: number;       // LLM-suggested merges
    reclassified: number;        // kind/scope changed
    confidenceAdjusted: number;  // quality score tweaks
    driftDetected: number;       // code-drift findings
    errors: number;              // errors during review
  };
  findings: ReviewFinding[];
}
```

### ReviewFinding

```typescript
interface ReviewFinding {
  memoryId: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  category:
    | 'stale_anchor'
    | 'expired'
    | 'duplicate'
    | 'contradiction'
    | 'noise'
    | 'merge_candidate'
    | 'reclassification'
    | 'quality_adjustment'
    | 'code_drift'
    | 'error';
  summary: string;               // human-readable finding description
  action: 'none' | 'update' | 'propose_delete' | 'propose_archive' | 'merge';
  applied: boolean;              // whether Mnemosyne filed/applied this finding
  detail?: Record<string, unknown>;
}
```

## Schedules & Triggers

### Background Schedule

```json
{
  "name": "mnemosyne-heartbeat",
  "intervalMs": 21600000,
  "action": "mnemosyne review --trigger=cron"
}
```

### Trigger Sources

| Source | How | Priority |
|--------|-----|----------|
| **Cron** | Every N ms (configurable, default 6h) | background |
| **Mailbox** | Message to mnemosyne agent: `review`, `status`, `on`, `off` | immediate |
| **Slash command** | `/mnemosyne [review|status|on|off|interval <ms>]` | immediate |
| **System boot** | On leader agent startup (if `enabled: true` in config) | one-shot |

## Workflow

### Startup

1. Read `MnemosyneState` from persisted config (if exists)
2. Register cron job at configured interval (`mnemosyne-heartbeat`)
3. If `enabled: true`, send broadcast: `mnemosyne:started { intervalMs, model, cycleCount }`
4. If `enabled: true` and `runOnStartup: true` (config), kick off an initial review cycle

### Review Cycle (triggered by cron or on-demand)

```
Phase 1: Deterministic
  ├─ memory_hygiene({ verify: true })
  │     deduplicates, verifies anchors, surfaces review candidates
  └─ Collect remaining active memories as review candidates

Phase 2: LLM Analysis
  ├─ Split candidates into batches of reviewBatchSize (default 20)
  ├─ For each batch, delegate to subagent:
  │     "Review these {N} memories for contradictions,
  │      noise, merge candidates, classification errors,
  │      and quality scoring adjustments."
  └─ Collect findings from all batches

Phase 3: File Review Proposals
  ├─ For each finding with action='update':
  │     memory_update(id, { text, kind, confidence, ... })
  ├─ For each finding with action='propose_delete':
  │     memory_candidates(action:'propose', text:<summary>,
  │       memory_id:<target>, reason:<review reason>,
  │       suggested_action:'delete')
  │     (permanent memories are protected by the resolver; importance>=0.9
  │      must be skipped by the agent — see guardrails below)
  ├─ For each finding with action='merge':
  │     Accept the best one, supersede the rest (non-terminal)
  └─ For each finding with action='propose_archive':
       memory_candidates(action:'propose', text:<summary>,
         memory_id:<target>, reason:<review reason>,
         suggested_action:'archive')

  ⚠️ Mnemosyne NEVER calls memory_delete or memory_update({status:'archived'}).
     Those are terminal mutations reserved for the user's explicit
     memory_candidates resolve call.

Phase 4: Report
  └─ Broadcast review report via mailbox (to="*", type="result")
```

### LLM Batch Prompt Template

When delegating a batch to the LLM subagent:

```text
You are a memory curator reviewing {batchSize} memories from the project's
SAGE memory store. For each memory, evaluate:

1. CONTRADICTION: Does this memory conflict with another in this batch?
   - If yes, identify the pair and which one is correct (the newer one wins)
2. NECESSITY: Is this memory genuinely useful knowledge or just noise?
3. QUALITY: Is the importance (0-1) and confidence (0-1) appropriate?
4. MERGE: Does this describe the same concept as another memory?
5. CLASSIFICATION: Is the `kind` (fact/decision/convention/...) correct?
6. DRIFT: (if driftDetection enabled) Does the anchored file still support this fact?

Return JSON array of findings:
[
  {
    "memoryId": "mem_...",
    "category": "contradiction" | "noise" | "merge_candidate" | "reclassification" | "quality_adjustment" | "code_drift",
    "severity": "info" | "low" | "medium" | "high",
    "summary": "One-sentence description",
    "action": "none" | "update" | "delete" | "merge" | "archive",
    "targetMemoryId": "mem_...",  // for contradictions/merges
    "suggestedChanges": {         // for update actions
      "text": "corrected text",
      "kind": "convention",
      "importance": 0.8,
      "confidence": 0.9
    }
  }
]

Memories:
{batchMemories}
```

## Commands

### Mailbox Commands

Send a message to the Mnemosyne agent:

| Message body | Effect |
|-------------|--------|
| `mnemosyne review` | Trigger an immediate full review cycle |
| `mnemosyne status` | Return current state + last report summary |
| `mnemosyne on` | Enable background scheduling |
| `mnemosyne off` | Disable background scheduling |
| `mnemosyne interval <ms>` | Change heartbeat interval |
| `mnemosyne batch <N>` | Set review batch size |
| `mnemosyne drift on\|off` | Toggle code-drift detection |
| `mnemosyne model <model-id>` | Change LLM analysis model |

### Slash Commands

| Command | Effect |
|---------|--------|
| `/mnemosyne` | Show status |
| `/mnemosyne review` | Run full review now |
| `/mnemosyne on` | Enable background scheduling |
| `/mnemosyne off` | Disable background scheduling |
| `/mnemosyne status` | Detailed status + last report |
| `/mnemosyne interval 3600000` | Change to 1h interval |
| `/mnemosyne batch 50` | Review 50 memories per LLM batch |

### Response Format

Status report:

```
## 🧠 Mnemosyne Status — <timestamp>

**State**: <enabled/disabled>
**Cycle**: <N> completed | Last: <ISO timestamp>
**Interval**: every <X>h | **Model**: <model-id>
**Batch size**: <N> | **Drift detection**: <on/off>

### Last Review Summary
- Examined: <N> memories
- Deduplicated: <M> | Verified: <K> | Staled: <J>
- Contradictions: <C> found, <R> resolved
- Merges: <A> | Reclassified: <B> | Quality adjusted: <D>
- Deleted: <E> (noise) | Archived: <F> (expired)
- Errors: <G>

### Recent Findings
- [HIGH] mem_abc — Contradiction: "uses pnpm" vs "uses npm v10"
  → Applied: marked older as superseded
- [MED] mem_def — Stale anchor: file packages/old/path.ts no longer exists
  → Applied: status updated to stale
- [LOW] mem_ghi — Noise: vague statement, low access count
  → Applied: archived
```

## Configuration

| Config Key | Type | Default | Description |
|------------|------|---------|-------------|
| `mnemosyne_enabled` | boolean | true | Master switch |
| `mnemosyne_interval_ms` | number | 21600000 | 6h default |
| `mnemosyne_model` | string | session model | LLM model for Phase 2 analysis |
| `mnemosyne_batch_size` | number | 20 | Memories per LLM review batch |
| `mnemosyne_drift_detection` | boolean | false | Enable file-content drift checks |
| `mnemosyne_auto_archive_days` | number | 30 | Days of no access before archival flag |
| `mnemosyne_run_on_startup` | boolean | true | Run one cycle on agent startup |
| `mnemosyne_delegate_timeout_ms` | number | 120000 | Per-batch LLM timeout (2 min) |
| `mnemosyne_max_batches` | number | 10 | Max concurrent batch delegations |

## Error Handling

| Failure | Behavior | Recovery |
|---------|----------|----------|
| LLM batch timeout | Skip that batch, log finding with `severity: error` | Next cycle retries |
| `memory_hygiene` fails | Phase 1 is best-effort; proceed to Phase 2 | Retry on next cycle |
| `memory_verify` anchor I/O error | Individual anchor marked `unknown`, not `stale` | Auto-retry on next verify |
| Memory not found on apply | Best-effort: skip, log warning | N/A — memory was already removed |
| Cron job collision | If a cycle is still running when next fires, skip | Next interval fires normally |
| Delegate spawn fails | Fall back to running brief inline LLM analysis | Retry full batch next cycle |

## Anti-Patterns & Guardrails

- **Propose-only — never delete directly** — Mnemosyne files destructive outcomes as review proposals via `memory_candidates({ action: 'propose', ... })`. It never calls `memory_delete` or `memory_update({ status: 'archived' })`. The user resolves proposals via `memory_candidates({ action: 'resolve', ... })`.
- **Hygiene never deletes** — `memory_hygiene` only deduplicates, verifies, and surfaces review candidates. Phase 3 follows the same invariant: it proposes, the user decides.
- **No destructive action on contradictions** — Mnemosyne marks contradictions as `superseded` or `stale` (both non-terminal). It may *propose* deletion of the older one, but never applies it.
- **Respect user intent** — memories with `importance >= 0.9` are never proposed for deletion or archival; they are logged in findings as `action: "none"`.
- **Permanent memories are untouchable** — `persistence: 'permanent'` memories refuse deletion at the store layer (`deleteSage` throws without `force: true`). The resolver also guards them.
- **Batch LLM calls bound at `max_batches`** — prevent runaway token usage in large memory stores.
- **Report always broadcast** — even an empty review generates a status message so the user knows the cycle completed.
- **No write amplification** — a memory that passes all checks with flying colors is left untouched (no unnecessary `memory_update` calls that would bump `updatedAt`).

## Dependencies

| Tool/Service | Used for | Phase |
|-------------|----------|-------|
| `cron_schedule` | Background heartbeat scheduling | Lifecycle |
| `memory_hygiene` | Dedup, TTL, retention, anchor verify | Phase 1 |
| `memory_verify` | Deep anchor integrity check | Phase 1 |
| `memory_search` | Find related memories for contradiction scan | Phase 2 |
| `memory_update` | Apply corrections, status changes | Phase 3 |
| `memory_delete` | Remove noise, expired session memories | Phase 3 |
| `remember` | Create new derived facts | Phase 3 |
| `delegate` | Spawn LLM subagent for batch review | Phase 2 |
| `mail_send` (to="*") | Broadcast review report | Phase 4 |
| `mailbox` | Listen for on-demand commands | Lifecycle |
| `cron_cancel` | Clean shutdown | Lifecycle |

## Skills in scope

- `shadow-agent` — background cron pattern, fleet monitoring pattern
- `auto-review` — subagent delegation pattern, debounce handling
- `multi-agent` — delegate spawn for parallel LLM batch review
- `node-modern` — for understanding the SAGE memory tool APIs
- `observability` — for structured event logging of findings
- `prompt-engineering` — for crafting the LLM batch review prompt
- `testing` — for verifying review actions with memory store mocks
- `git-flow` — code-drift detection via git diff against anchored files
- `security-scanner` — for scanning memory text for leaked credentials
