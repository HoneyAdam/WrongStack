import type { InputBuilder } from '@wrongstack/core/agent';
import { buildGoalPreamble } from '@wrongstack/core/execution';
import type { ContentBlock } from '@wrongstack/core/types';
import { type Dispatch, type MutableRefObject, useEffect, useRef } from 'react';
import type { Action } from '../app-state.js';

interface InitialPromptOptions {
  initialGoal: string | undefined;
  initialAsk: string | undefined;
  builderRef: MutableRefObject<InputBuilder | null>;
  runBlocksRef: MutableRefObject<(blocks: ContentBlock[]) => Promise<void>>;
  dispatch: Dispatch<Action>;
}

/** Injects the one-shot --goal/--ask boot prompt after the banner paints. */
export function useInitialPrompt({
  initialGoal,
  initialAsk,
  builderRef,
  runBlocksRef,
  dispatch,
}: InitialPromptOptions): void {
  // ─── --goal / --ask boot inject ─────────────────────────────────────
  // The CLI may pass `--goal "..."` or `--ask "..."` to pre-populate the
  // very first turn. `initialGoal` wraps the text in the GOAL preamble so
  // the model lands in autonomous goal mode; `initialAsk` submits the text
  // verbatim (handy for scripted shell aliases). Both fire one-shot via a
  // mount-time ref guard so a re-render can't double-submit. We wait a tick
  // for the input builder to settle, then push directly into runBlocks —
  // bypassing the slash registry / submit() path keeps the boot path
  // self-contained even if user-installed slash commands haven't mounted
  // their effects yet.
  const bootInjectedRef = useRef(false);
  useEffect(() => {
    if (bootInjectedRef.current) return;
    bootInjectedRef.current = true;
    const goal = initialGoal?.trim();
    const ask = initialAsk?.trim();
    if (!goal && !ask) return;
    void (async () => {
      // Give the banner a frame to render first so the user sees the
      // greeting before the first turn streams over the top of it.
      await new Promise((r) => setTimeout(r, 50));
      const b = builderRef.current;
      if (!b) return;
      if (goal) {
        const shortGoal = goal.length > 80 ? `${goal.slice(0, 80)}…` : goal;
        dispatch({
          type: 'addEntry',
          entry: {
            kind: 'info',
            text: `🎯 Goal locked: ${shortGoal}\n   Agent will work until verifiably complete. Esc / /steer to redirect, Ctrl+C to stop.`,
          },
        });
        b.appendText(buildGoalPreamble(goal));
      } else if (ask) {
        dispatch({ type: 'addEntry', entry: { kind: 'user', text: ask } });
        b.appendText(ask);
      }
      const blocks = await b.submit();
      await runBlocksRef.current(blocks);
    })();
  }, [initialAsk, initialGoal]);

}
