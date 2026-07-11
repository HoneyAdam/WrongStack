# Live Cross-Surface Collaboration

**Priority:** P3  
**Horizon:** 9–18 months  
**Status:** Discovery required

## Outcome

Allow multiple authenticated surfaces to share presence, selections, draft messages, and selected editable artifacts in real time without weakening session-writer ownership.

## Scope

- Presence, active file/view, cursor, and selection signals with privacy controls.
- Shared draft or review annotations.
- Collaborative editing only for deliberately selected artifacts, using CRDT/OT semantics.
- Offline/reconnect behavior and conflict visualization.
- Read-only spectators and role-based edit scopes.

## Critical boundary

The existing `agent.ctx.session` single-writer invariant remains unchanged. Collaboration events are a separate ephemeral or derived stream; they must not create competing session JSONL writers.

## Delivery plan

1. Validate use cases with presence and read-only follow mode.
2. Define collaboration protocol, identity, retention, and privacy controls.
3. Add shared annotations/drafts with one authoritative room service.
4. Pilot CRDT editing for a narrow artifact such as a plan document.
5. Expand only after conflict, offline, and audit behavior is proven.

## Acceptance criteria

- Presence traffic is rate-limited, ephemeral by default, and never folded into prompts automatically.
- Reconnection cannot overwrite a newer committed artifact silently.
- Each edit is attributable and authorized.
- Collaboration can be disabled completely without affecting mailbox or session behavior.

