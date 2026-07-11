# Multimodal Media Workflows

**Priority:** P1  
**Horizon:** 3–6 months  
**Status:** Proposed

## Outcome

Build on existing vision-capable model input with consistent media ingestion, OCR, transformation, generation, storage, and rendering across every surface.

## Scope

- A shared attachment/artifact model for images, PDFs, screenshots, and generated media.
- MIME sniffing, size/dimension limits, metadata stripping, and safe local storage.
- OCR with text blocks, confidence, and page/region coordinates.
- Image understanding routed through model capabilities or configured adapters.
- Optional image generation/editing providers behind explicit capability and cost controls.
- Inline previews in WebUI/Desktop and terminal-safe summaries in CLI/TUI.

## Delivery plan

1. Normalize attachment ingestion and artifact references.
2. Add OCR and structured extraction.
3. Unify provider vision routing and fallbacks.
4. Add opt-in image generation/editing adapters.
5. Add retention, cleanup, export, and cross-surface rendering.

## Acceptance criteria

- Unsupported media fails before provider invocation with an actionable reason.
- Large binary content is referenced, not copied into every message or event.
- EXIF/location metadata is removed by default.
- Provider cost and data-egress boundaries are visible before generation or external OCR.

