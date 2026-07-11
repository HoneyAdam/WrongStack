# MCP Rich Content

**Priority:** P1  
**Horizon:** 2–5 months  
**Status:** Proposed

## Outcome

Preserve MCP text, image, audio, resource-link, and embedded-resource content as typed results instead of reducing responses to a text-centric shape.

## Scope

- Typed content unions that track MIME type, annotations, audience, and provenance.
- Safe decoding and storage of inline binary content.
- Resource-link resolution through explicit follow-up reads.
- Model adapter conversion only when the selected provider supports the modality.
- WebUI/Desktop previews and CLI/TUI summaries with artifact references.

## Delivery plan

1. Replace the current flattened result contract with a backward-compatible typed envelope.
2. Update transports, tool wrappers, executor results, and session serialization.
3. Integrate the shared artifact model from multimodal workflows.
4. Add renderer support and modality-aware provider forwarding.
5. Add limits, cleanup, and compatibility fixtures for representative MCP servers.

## Acceptance criteria

- Existing text-only tools keep their current user-facing behavior.
- Binary payloads are bounded, validated, and never duplicated into JSONL logs as large base64 strings.
- Unsupported modalities remain available as artifacts with a clear explanation.
- Resource links are never fetched automatically from unsafe schemes.

