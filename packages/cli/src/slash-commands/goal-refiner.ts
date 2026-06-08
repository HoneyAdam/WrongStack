import type { Provider } from '@wrongstack/core';

/**
 * Result of refining a user's raw goal into a clear, actionable mission.
 */
export interface RefinedGoal {
  /** Unambiguous, detailed goal statement. */
  refinedGoal: string;
  /** Concrete, verifiable deliverables (one per entry). */
  deliverables: string[];
}

/**
 * Prompt the LLM to refine a raw user goal into a concrete mission
 * with unambiguous deliverables. Returns null if no LLM is available
 * or the call fails.
 */
export async function refineGoal(
  rawGoal: string,
  provider: Provider,
  model: string,
): Promise<RefinedGoal | null> {
  const prompt = buildRefinementPrompt(rawGoal);

  try {
    const signal = AbortSignal.timeout(30_000);
    const response = await provider.complete({
      model,
      system: [{ type: 'text', text: prompt }],
      messages: [{ role: 'user', content: 'Produce the refined goal.' }],
      maxTokens: 1000,
    }, { signal });

    const text = extractText(response);
    if (!text) return null;

    return parseRefinement(text, rawGoal);
  } catch {
    // LLM unavailable — use the raw goal as-is
    return null;
  }
}

/** Build the refinement prompt. */
function buildRefinementPrompt(rawGoal: string): string {
  return [
    'You are a goal refinement assistant. Your job is to take a user\'s raw',
    'goal description and turn it into a clear, unambiguous, actionable mission',
    'with concrete, verifiable deliverables.',
    '',
    'Rules:',
    '- The refined goal must be self-contained — someone reading only the',
    '  refined goal should understand exactly what to do without seeing the',
    '  original.',
    '- Each deliverable must be a single, checkable item. Prefer concrete',
    '  artifacts: "file X exists at path Y", "test Z passes", "function A',
    '  is refactored into module B". Avoid vague items like "improve code".',
    '- Include acceptance criteria where helpful.',
    '- If the goal is already clear and concrete, refine it minimally — do',
    '  not add fluff.',
    '',
    'Output format (exact — use these markers):',
    '',
    'REFINED_GOAL:',
    '<the refined goal text, 1-3 sentences>',
    '',
    'DELIVERABLES:',
    '- <deliverable 1>',
    '- <deliverable 2>',
    '- ...',
    '',
    '---',
    '',
    `RAW GOAL: ${rawGoal}`,
    '',
    '---',
    '',
    'Now produce the refined version:',
  ].join('\n');
}

/** Extract text content from a provider result. */
function extractText(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;

  // Anthropic-style: { content: [{ type: 'text', text: '...' }] }
  if (Array.isArray(r.content)) {
    const texts = (r.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '');
    return texts.join('') || null;
  }

  // OpenAI-style: { choices: [{ message: { content: '...' } }] }
  if (Array.isArray(r.choices)) {
    const choice = r.choices[0] as { message?: { content?: string } } | undefined;
    return choice?.message?.content ?? null;
  }

  // Direct text field
  if (typeof r.text === 'string') return r.text;

  return null;
}

/** Parse the LLM response into a RefinedGoal. */
function parseRefinement(text: string, fallbackGoal: string): RefinedGoal {
  const refinedMatch = text.match(/REFINED_GOAL:\s*\n?([\s\S]*?)(?=\nDELIVERABLES:|$)/i);
  const refinedGoal = refinedMatch?.[1]?.trim() || fallbackGoal;

  const deliverablesMatch = text.match(/DELIVERABLES:\s*\n([\s\S]*?)$/i);
  const deliverablesRaw = deliverablesMatch?.[1] ?? '';

  const deliverables = deliverablesRaw
    .split('\n')
    .map((line) => line.replace(/^[\s-]*[-*]\s*/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('REFINED_GOAL'));

  return {
    refinedGoal,
    deliverables: deliverables.length > 0 ? deliverables : [],
  };
}

/**
 * Heuristic-only refinement — used when no LLM is available.
 * Produces a basic structure from the raw goal.
 */
export function refineGoalHeuristic(rawGoal: string): RefinedGoal {
  const trimmed = rawGoal.trim();
  return {
    refinedGoal: trimmed,
    deliverables: extractHeuristicDeliverables(trimmed),
  };
}

/** Extract deliverable-like phrases from the raw goal text. */
function extractHeuristicDeliverables(goal: string): string[] {
  const deliverables: string[] = [];

  // Look for numbered lists, bullet points, or sentences that describe actions
  const lines = goal.split(/[.;]\s*/);
  for (const line of lines) {
    const cleaned = line.trim();
    if (!cleaned) continue;

    // Detect action-oriented phrases
    if (
      /\b(add|build|create|fix|implement|refactor|write|remove|update|migrate|set up|configure|deploy|test|document)\b/i.test(
        cleaned,
      )
    ) {
      deliverables.push(cleaned);
    }
  }

  // If nothing detected, treat the whole goal as one deliverable
  if (deliverables.length === 0) {
    deliverables.push(goal.trim());
  }

  return deliverables;
}
