// Animated status chip embedded in the composer's top rail (right side).
//
// This replaces the old static `WORKING`/`READY` string that `frameRule` baked
// into the border. It mirrors the statusline's `ThinkingChip` look — while the
// agent works it paints the configured thinking word with the chosen animation
// style (rainbow/wave/pulse/dots/breathe); when idle it shows a flat `idle`
// (or `agents >N` when background subagents are running).
//
// TWO invariants make it safe to live inside a fixed-width border:
//   1. Isolation — the chip owns its OWN spinner/cycle timers so per-frame
//      re-renders stay local. It must never be inlined into <Input>, whose memo
//      and keyboard listeners would otherwise churn at ~4Hz.
//   2. No jitter — every render is padded to exactly `reservedWidth` columns,
//      so the growing `dots` ellipsis and rolling word can't push the right
//      corner around. `composerStatusReservedWidth` computes that stable width
//      from the descriptor (not the live animation frame).

import { Text } from '../ink.js';
import type React from 'react';
import { useEffect, useState } from 'react';
import { displayWidth, truncateDisplay } from '../terminal-width.js';
import {
  type AnimationStyle,
  BREATHE_FRAMES,
  CYCLE_TICK_INTERVAL_MS,
  DOTS_FRAMES,
  pulseColor,
  rainbowColor,
  styleForCycleTick,
  waveColor,
} from './animation-style.js';

// Spinner cadence — matches the statusline's braille spinner so the two
// surfaces breathe in sync. Frames reuse BREATHE_FRAMES (identical set).
const SPINNER_INTERVAL_MS = 250;

/**
 * Composer status descriptor. Distinct from the raw runtime status so the
 * chip's render (and its reserved width) is driven by one small, testable
 * value instead of scattered flags.
 */
export type ComposerStatus =
  | { kind: 'idle'; fleetRunning: number }
  | { kind: 'working'; word: string }
  | { kind: 'aborting' }
  | { kind: 'confirm' }
  | { kind: 'queued'; count: number };

/**
 * Build the composer status descriptor from the raw runtime state. Priority
 * mirrors the old `composerStatusLabel`: an open confirm panel and an in-flight
 * abort outrank the working/queued/idle states.
 */
export function composerStatusFromState(opts: {
  status: 'idle' | 'running' | 'streaming' | 'aborting';
  confirmCount: number;
  queueCount: number;
  thinkingWord: string;
  fleetRunning: number;
}): ComposerStatus {
  if (opts.confirmCount > 0) return { kind: 'confirm' };
  if (opts.status === 'running' || opts.status === 'streaming') {
    return { kind: 'working', word: opts.thinkingWord };
  }
  if (opts.status === 'aborting') return { kind: 'aborting' };
  if (opts.queueCount > 0) return { kind: 'queued', count: opts.queueCount };
  return { kind: 'idle', fleetRunning: opts.fleetRunning };
}

/** Static (non-animated) label + Ink color for the flat states. */
function staticLabel(status: ComposerStatus): { text: string; color: string; bold?: boolean } {
  switch (status.kind) {
    case 'confirm':
      return { text: 'CONFIRM', color: 'red', bold: true };
    case 'aborting':
      return { text: 'aborting…', color: 'red' };
    case 'queued':
      return { text: `queued ${status.count}`, color: 'cyan' };
    case 'idle':
      return status.fleetRunning > 0
        ? { text: `agents >${status.fleetRunning}`, color: 'magenta' }
        : { text: 'idle', color: 'cyan' };
    case 'working':
      // Not used for static render — working animates. Fallback for width calc.
      return { text: `⠋ ${status.word}…`, color: 'green' };
  }
}

/**
 * Stable column width the chip occupies for a given status — independent of the
 * live animation frame so the border geometry never shifts. For `working` we
 * reserve `spinner + space + word + '...'` (the `dots` style's widest frame is
 * three dots; the `…` used by other styles is narrower), i.e. `w(word) + 5`.
 * Pure + exported for testing.
 */
export function composerStatusReservedWidth(status: ComposerStatus): number {
  if (status.kind === 'working') {
    // 1 (spinner) + 1 (space) + word + 3 (widest dots frame)
    return displayWidth(status.word) + 5;
  }
  return displayWidth(staticLabel(status).text);
}

/** Right-pad a rendered node to exactly `reservedWidth` columns. */
function withPad(
  node: React.ReactNode,
  contentWidth: number,
  reservedWidth: number,
): React.ReactNode {
  const pad = Math.max(0, reservedWidth - contentWidth);
  return (
    <>
      {node}
      {pad > 0 ? <Text>{' '.repeat(pad)}</Text> : null}
    </>
  );
}

/** Fit plain chip text inside the rail slot without consuming the right corner. */
function fitStatusText(text: string, reservedWidth: number): string {
  return truncateDisplay(text, Math.max(0, reservedWidth));
}

/**
 * Render the animated working chip for the resolved style. Returns the styled
 * nodes plus the plain content width so the caller can pad to `reservedWidth`.
 */
function renderWorking(
  word: string,
  style: AnimationStyle,
  spinner: string,
  phase: number,
  maxWidth: number,
): { node: React.ReactNode; width: number } {
  if (style === 'dots') {
    // Spinner + word + a growing/shrinking dot run (no baseline ellipsis).
    const suffix = DOTS_FRAMES[phase % DOTS_FRAMES.length] ?? '';
    const text = truncateDisplay(`${spinner} ${word}${suffix}`, maxWidth);
    return {
      node: (
        <Text bold color="green">
          {text}
        </Text>
      ),
      width: displayWidth(text),
    };
  }
  if (style === 'breathe') {
    // The spinner IS the breathing element; text stays flat.
    const text = truncateDisplay(`${spinner} ${word}`, maxWidth);
    return {
      node: (
        <Text bold color="green">
          {text}
        </Text>
      ),
      width: displayWidth(text),
    };
  }
  // rainbow / wave / pulse all decorate `⠋ word…`.
  const text = truncateDisplay(`${spinner} ${word}…`, maxWidth);
  const chars = Array.from(text);
  if (style === 'pulse') {
    return {
      node: (
        <Text bold color={pulseColor(phase)}>
          {text}
        </Text>
      ),
      width: displayWidth(text),
    };
  }
  const colorFor =
    style === 'wave'
      ? (i: number) => waveColor(i, phase, chars.length)
      : (i: number) => rainbowColor(i, phase);
  return {
    node: (
      <Text bold>
        {chars.map((ch, i) => (
          <Text key={i} color={colorFor(i)}>
            {ch}
          </Text>
        ))}
      </Text>
    ),
    width: displayWidth(text),
  };
}

export interface ComposerStatusChipProps {
  status: ComposerStatus;
  /** Animation style for the working state (`'cycle'` rotates the variants). */
  animationStyle: AnimationStyle | 'cycle';
  /** Fixed slot width — the chip pads its output to exactly this many columns. */
  reservedWidth: number;
}

/**
 * Isolated, self-animating composer status chip. Owns its spinner/cycle timers
 * so animation re-renders never propagate into <Input>. Renders flat text for
 * idle/confirm/aborting/queued and the animated thinking word for `working`.
 */
export function ComposerStatusChip({
  status,
  animationStyle,
  reservedWidth,
}: ComposerStatusChipProps): React.ReactElement {
  const animating = status.kind === 'working';

  const [spinnerIdx, setSpinnerIdx] = useState(0);
  useEffect(() => {
    if (!animating) return;
    const t = setInterval(
      () => setSpinnerIdx((n) => (n + 1) % BREATHE_FRAMES.length),
      SPINNER_INTERVAL_MS,
    );
    return () => clearInterval(t);
  }, [animating]);

  const [cycleTick, setCycleTick] = useState(0);
  useEffect(() => {
    if (!animating || animationStyle !== 'cycle') return;
    const t = setInterval(() => setCycleTick((n) => n + 1), CYCLE_TICK_INTERVAL_MS);
    return () => clearInterval(t);
  }, [animating, animationStyle]);

  if (status.kind === 'working') {
    const live: AnimationStyle =
      animationStyle === 'cycle' ? styleForCycleTick(cycleTick) : animationStyle;
    const spinner = BREATHE_FRAMES[spinnerIdx % BREATHE_FRAMES.length] ?? '⠋';
    const { node, width } = renderWorking(
      status.word,
      live,
      spinner,
      spinnerIdx,
      reservedWidth,
    );
    return <Text>{withPad(node, width, reservedWidth)}</Text>;
  }

  const { text, color, bold } = staticLabel(status);
  const fittedText = fitStatusText(text, reservedWidth);
  return (
    <Text>
      {withPad(
        <Text color={color} bold={bold ?? false}>
          {fittedText}
        </Text>,
        displayWidth(fittedText),
        reservedWidth,
      )}
    </Text>
  );
}
