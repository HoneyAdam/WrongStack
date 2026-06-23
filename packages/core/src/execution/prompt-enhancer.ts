import type { ContentBlock } from '../types/blocks.js';
import { isTextBlock } from '../types/blocks.js';
import type { Message } from '../types/messages.js';
import type {
  Provider,
  ReasoningConfig,
  ReasoningEffort,
  ReasoningRequest,
  Request,
} from '../types/provider.js';
import { toErrorMessage } from '../utils/error.js';

/**
 * Prompt refinement ("did you mean this?").
 *
 * Runs a one-shot LLM call in a SEPARATE context (its own system prompt, no
 * conversation history, no tools) that rewrites a raw user message into a
 * clearer, more complete instruction BEFORE the main agent sees it. The goal
 * is to make the main context start from a well-understood request rather than
 * guessing intent from terse input like "fix the bug".
 *
 * This mirrors `IntelligentCompactor.callSummarizer` — a plain
 * `provider.complete()` with a dedicated system prompt — and is deliberately
 * free of React / TUI dependencies so it can be unit-tested in isolation.
 */

export const ENHANCER_SYSTEM_PROMPT = `You are a request refiner embedded in a coding agent. Your ONLY job is to rewrite the user's message into clearer, unambiguous instructions that the coding agent can act on confidently.

Rules:
- Preserve the user's intent and scope EXACTLY. Do not add new requirements, features, constraints, or steps the user did not ask for. Do not remove anything they did ask for.
- Do NOT answer, solve, or perform the request. Only restate it more clearly.
- Keep all concrete details verbatim: file paths, identifiers, code, error text, numbers, names, URLs.
- Resolve obvious ambiguity by making the implied subject explicit, not by inventing specifics. If something is genuinely unspecified, leave it general rather than guessing.
- Be concise: one tight instruction per version (a few sentences at most). No preamble, no explanation, no quotes, no markdown headers.
- If the message is already clear and complete, return it essentially unchanged.

Detect the language of the user's LATEST message and output accordingly:

- If that message is ALREADY in English: output exactly ONE refined version, in English. Nothing else — no "---" line, no second copy.
- If that message is in ANY OTHER language (Turkish, Spanish, …): output TWO versions separated by a line containing only "---":
    - First version: refined in the SAME LANGUAGE the user wrote in.
    - Second version: refined in ENGLISH (translate the intent into clear English while preserving all concrete details).

Output format for non-English input:
<refined in user's language>
---
<refined in English>

When earlier conversation turns are provided, they are CONTEXT ONLY. Use them to resolve references in the user's latest message — "it", "that", "the same", "the other one", "this file", "again" — so the refined instruction is self-contained. Refine ONLY the user's latest message; do not answer it, do not act on or restate earlier turns, and do not summarize the conversation. The conversation language does NOT decide the output language — only the language of the latest message does.

Output ONLY the refined request(s) in the format above — nothing else.`;

/** Words/phrases that are control answers, not refinable requests. */
const AFFIRMATION_RE =
  /^(y|n|yes|no|yep|nope|ok|okay|sure|go|go ahead|continue|proceed|stop|cancel|done|next|skip|retry|again|please do|do it)\b[.! ]*$/i;

/**
 * Heuristic gate: should this raw input be sent through the refiner at all?
 * Pure + exported for unit testing. Returns false for inputs where refinement
 * is pointless or unwanted (slash commands, one-word affirmations, trivially
 * short text, bare numbers).
 */
export function shouldEnhance(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('/')) return false; // slash command
  if (t.length < 12) return false; // too short to be worth refining
  if (AFFIRMATION_RE.test(t)) return false; // "yes" / "continue" / ...
  if (/^[\d\s.,]+$/.test(t)) return false; // bare numbers (menu picks, etc.)
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false; // 1–2 words rarely benefit
  return true;
}

/**
 * Preference order when picking an effort level: the cheapest level that still
 * does SOME reasoning first ('low', then 'minimal'), then up the ladder, with
 * fully-off ('none') last so it's only chosen when it's the sole advertised
 * option. This keeps the refiner cheap without dropping reasoning entirely when
 * a little still helps. 'low' leads because it's the most widely accepted low
 * level across adapters (e.g. OpenAI's reasoning_effort set).
 */
const EFFORT_PREFERENCE: ReasoningEffort[] = [
  'low',
  'minimal',
  'medium',
  'high',
  'xhigh',
  'max',
  'none',
];

/**
 * Build a reasoning directive for the refiner that minimizes wasted thinking,
 * gated to what the model actually accepts. Refinement is a shallow rewrite
 * task — extended thinking adds latency and (hidden) token cost for little
 * gain — so we ask the model to spend as little reasoning as it safely can.
 *
 * The gating mirrors `resolveReasoningForRequest` so we never send a field the
 * model would reject:
 *   - effort-capable model      → its lowest advertised effort level;
 *   - else disable-capable model → disable thinking (`enabled: false`);
 *   - else (always-on / unknown) → `undefined` (leave the provider default).
 *
 * Returns `undefined` whenever nothing can be safely reduced. Callers forward
 * that verbatim to `enhanceUserPrompt`, which then sends no reasoning field —
 * identical to the behavior before this hint existed. Pure + exported for unit
 * testing.
 */
export function gatedEnhancerReasoning(
  rc: ReasoningConfig | undefined,
): ReasoningRequest | undefined {
  // Capabilities unknown → don't risk an unsupported field (matches the
  // conservative "capabilities unknown" branch in resolveReasoningForRequest).
  if (!rc) return undefined;
  if (rc.effortSupported && rc.effortLevels.length > 0) {
    const lowest = EFFORT_PREFERENCE.find((e) => rc.effortLevels.includes(e)) ?? rc.effortLevels[0];
    if (lowest) return { effort: lowest };
  }
  if (rc.disableSupported) return { enabled: false };
  return undefined;
}

/**
 * Normalize for "did the refiner actually change anything?" comparison —
 * collapse whitespace and lowercase so trivial reformatting doesn't trigger
 * the confirmation panel.
 */
export function normalizedEqual(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(a) === norm(b);
}

/** A single text-only conversation turn used as refiner context. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Result of a successful prompt refinement. Carries the original-language and
 * English versions so the UI can offer both. When the input was already in
 * English the refiner emits a single version and both fields hold the same
 * text (the UI then offers two identical choices, which is correct).
 */
export interface EnhanceResult {
  /** Refined in the user's original language. */
  refined: string;
  /** Refined in English. Equals `refined` when the input was already English. */
  english: string;
}

export interface EnhanceUserPromptOptions {
  provider: Provider;
  model: string;
  text: string;
  /**
   * Recent conversation turns (oldest→newest), text only, used purely as
   * CONTEXT so the refiner can resolve references in a follow-up message
   * ("it", "the same", "that file"). Without this, the refiner is blind to
   * the conversation and can only refine self-contained prompts. Build with
   * `recentTextTurns(ctx.messages)`.
   */
  history?: ConversationTurn[] | undefined;
  /** Parent abort signal (e.g. the run controller / Esc). */
  signal?: AbortSignal | undefined;
  /** Hard cap on how long to wait for the refiner before giving up. Default 90s. */
  timeoutMs?: number | undefined;
  /** Max tokens for the refined output. Default 2048. */
  maxTokens?: number | undefined;
  /**
   * Reasoning directive for the refiner call. Refinement is a shallow
   * restate-this-more-clearly task that does not benefit from extended
   * thinking, so callers pass a low-effort / thinking-disabled hint here to
   * cut latency and (hidden) reasoning-token cost — most impactful on slow
   * reasoning models. Build it with `gatedEnhancerReasoning(rc)` so the field
   * is gated to what the model accepts. Omit (undefined) to send no reasoning
   * directive at all (the provider's own default applies).
   */
  reasoning?: ReasoningRequest | undefined;
  /**
   * Called with a short reason when refinement fails (provider error, timeout,
   * empty response). NOT called when the caller cancels via `signal`. Lets the
   * UI surface *why* a refine fell through instead of a generic message.
   */
  onError?: ((reason: string) => void) | undefined;
}

/**
 * Compose the single user message sent to the refiner: the recent
 * conversation embedded as plain text (so we never trip provider
 * role-alternation rules) followed by the latest message to refine.
 */
function buildRefinerInput(text: string, history?: ConversationTurn[]): string {
  if (!history || history.length === 0) return text;
  const lines = history.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`);
  return [
    'Recent conversation (context only — do not act on it):',
    ...lines,
    '',
    'Latest message to refine:',
    text,
  ].join('\n');
}

/**
 * Refine a raw user prompt. Returns the refined text, or `null` when the
 * caller should fall back to the original (refiner errored, timed out, was
 * aborted, or returned nothing useful). NEVER throws — refinement is a
 * best-effort convenience and must never block the user from sending.
 */
export async function enhanceUserPrompt(
  opts: EnhanceUserPromptOptions,
): Promise<EnhanceResult | null> {
  const { provider, model, text } = opts;
  // Reasoning models ("thinking" models like DeepSeek reasoner / o1) take
  // longer to first token, so give a generous default window.
  const timeoutMs = opts.timeoutMs ?? 90000;
  // Generous default: on some endpoints the model's hidden "thinking" tokens
  // count against this budget, so a small cap can leave NO room for the actual
  // refined text (→ empty completion → null). 2048 keeps the output room ample.
  const maxTokens = opts.maxTokens ?? 2048;

  const req: Request = {
    model,
    system: [{ type: 'text', text: ENHANCER_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: buildRefinerInput(text, opts.history) }],
    maxTokens,
    // NOTE: deliberately NO `temperature`. The main agent loop never sets it,
    // and reasoning models (DeepSeek reasoner, o1/o3, …) return HTTP 400 when
    // `temperature` is present — which would make every refine call fail and
    // silently fall back to the original (no panel shown).
    //
    // A reasoning hint is forwarded ONLY when the caller supplies one (it must
    // already be gated to the model's advertised support — see
    // `gatedEnhancerReasoning`). Absent it, no reasoning field is sent, which
    // is identical to the original behavior.
    ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
  };

  // Link a local timeout to the parent signal so a stuck provider call can't
  // hang the submit path. AbortSignal.any keeps both cancellation sources.
  const timer = new AbortController();
  const to = setTimeout(() => timer.abort(new Error('enhancer timeout')), timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timer.signal]) : timer.signal;

  try {
    const res = await provider.complete(req, { signal });
    const raw = res.content
      .filter(isTextBlock)
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!raw) {
      opts.onError?.('model returned no text');
      return null;
    }

    // English input → ONE version (no "---"); other languages → two versions
    // separated by a line with only "---". Split on the first occurrence so the
    // delimiter can still appear inside the second version's text.
    const sepIdx = raw.indexOf('\n---\n');
    if (sepIdx === -1) {
      // Single version: the input was already English (or the model chose not
      // to translate). Use it for both fields — the UI offers identical
      // "refined" / "english" options, which is correct and saves the model
      // from generating a redundant second copy. NOT an error.
      return { refined: raw, english: raw };
    }
    const refined = raw.slice(0, sepIdx).trim();
    const english = raw.slice(sepIdx + 5).trim(); // skip "\n---\n"
    if (!refined || !english) {
      opts.onError?.('one or both versions empty');
      return null;
    }
    return { refined, english };
  } catch (err) {
    // User-initiated cancel → stay silent (they chose to send the original).
    if (opts.signal?.aborted) return null;
    if (timer.signal.aborted) {
      opts.onError?.(`timed out after ${Math.round(timeoutMs / 1000)}s`);
      return null;
    }
    opts.onError?.(toErrorMessage(err));
    return null;
  } finally {
    // Idempotent — abort() after signal already fired is a no-op, so this is
    // always safe regardless of whether the timeout fired first.
    timer.abort();
    clearTimeout(to);
  }
}

/** Pull the visible text out of a message's content (ignores tool blocks). */
function messageText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Extract the last few user/assistant TEXT turns from a conversation, newest
 * last, for use as refiner context. Skips system messages and tool-only turns
 * (tool_use / tool_result carry no useful natural-language context and bloat
 * the call). Each turn is truncated to `maxChars`; at most `maxTurns` are
 * returned. Pure + exported for unit testing.
 */
export function recentTextTurns(
  messages: Message[],
  maxTurns = 6,
  maxChars = 1500,
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (let i = messages.length - 1; i >= 0 && turns.length < maxTurns; i--) {
    const m = messages[i];
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const text = messageText(m.content);
    if (!text) continue;
    turns.unshift({
      role: m.role,
      text: text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text,
    });
  }
  return turns;
}
