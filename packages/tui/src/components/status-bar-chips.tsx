/**
 * Extracted chip components for the status bar.
 *
 * Moved out of the ~1543-line status-bar.tsx monolith to keep each concern
 * in its own file. All three components are internal to the status bar and
 * not expected to be imported from outside the status-bar module.
 */

import type React from 'react';
import { Text } from '../ink.js';
import { theme } from '../theme.js';
import { glyphs } from '../ui-glyphs.js';
import {
  type AnimationStyle,
  BREATHE_FRAMES,
  DOTS_FRAMES,
  pulseColor,
  rainbowColor,
  stripTrailingDots,
  styleForCycleTick,
  waveColor,
} from './animation-style.js';
import type { BrainStatusChip, StatusBarProps } from './status-bar.js';

// ─── BrainChip ───────────────────────────────────────────────────────────────

export function BrainChip({
  brain,
  monochrome,
}: {
  brain: BrainStatusChip;
  monochrome?: boolean;
}): React.ReactElement {
  const color =
    brain.state === 'denied'
      ? theme.error
      : brain.state === 'ask_human'
        ? theme.warn
        : brain.state === 'deciding'
          ? theme.monitor.agents
          : theme.accent;
  const label =
    brain.state === 'deciding' ? 'deciding' : brain.state === 'ask_human' ? 'human' : brain.state;
  const scope = brain.source ? ` ${brain.source}` : '';
  const summary = brain.summary ? ` · ${Array.from(brain.summary).slice(0, 40).join('')}` : '';
  return (
    <Text color={monochrome ? undefined : color}>
      {monochrome ? label : `${glyphs.brain} ${label}`}
      <Text dimColor={!monochrome}>{scope}</Text>
      <Text dimColor={!monochrome}>{summary}</Text>
    </Text>
  );
}

// ─── EternalStageChip ─────────────────────────────────────────────────────────

export function EternalStageChip({
  stage,
  monochrome,
}: {
  stage: NonNullable<StatusBarProps['eternalStage']>;
  monochrome?: boolean;
}): React.ReactElement {
  const color = (c: string) => (monochrome ? undefined : c);
  const icon = (symbol: string) => (monochrome ? '' : symbol);
  switch (stage.phase) {
    case 'idle':
      return <Text dimColor={!monochrome}>{monochrome ? 'idle' : `${glyphs.pending} idle`}</Text>;
    case 'decide':
      return (
        <Text color={color(theme.accent)}>
          {monochrome ? `decide: ${stage.reason}` : `◇ decide: ${stage.reason}`}
        </Text>
      );
    case 'execute':
      return (
        <Text color={color(theme.success)}>
          {monochrome ? null : <>{icon('▶')} </>}
          <Text bold>execute</Text>
          {stage.task ? `(${stage.task})` : ''}
        </Text>
      );
    case 'reflect':
      return (
        <Text
          color={color(
            stage.status === 'success' ? theme.success : stage.status === 'failure' ? theme.error : theme.warn,
          )}
        >
          {monochrome ? `reflect: ${stage.status}` : `↩ reflect: ${stage.status}`}
        </Text>
      );
    case 'decompose':
      return <Text color={color(theme.accent)}>{monochrome ? 'decompose' : '↓ decompose'}</Text>;
    case 'fanout':
      return (
        <Text color={color(theme.monitor.agents)}>
          {monochrome ? `fanout: ${stage.slots}` : `⇄ fanout: ${stage.slots}`}
        </Text>
      );
    case 'await':
      return (
        <Text color={color(theme.monitor.agents)}>
          {monochrome
            ? `await: ${stage.taskIds.length}`
            : `${glyphs.auto} await: ${stage.taskIds.length}`}
        </Text>
      );
    case 'aggregate':
      return (
        <Text color={color(stage.goalComplete ? theme.success : theme.monitor.agents)}>
          {monochrome
            ? `aggregate: ${stage.successCount}/${stage.total}`
            : `↩ aggregate: ${stage.successCount}/${stage.total}`}
        </Text>
      );
    case 'sleep':
      return (
        <Text dimColor={!monochrome}>
          {monochrome
            ? `sleep ${Math.round(stage.ms / 1000)}s`
            : `${glyphs.clock} sleep ${Math.round(stage.ms / 1000)}s`}
        </Text>
      );
    case 'paused':
      return <Text color={color(theme.warn)}>{monochrome ? 'paused' : 'Ⅱ paused'}</Text>;
    case 'stopped':
      return <Text dimColor={!monochrome}>{monochrome ? 'stopped' : '■ stopped'}</Text>;
    case 'error':
      return (
        <Text color={color(theme.error)}>
          {monochrome ? `error: ${stage.message}` : `${glyphs.warning} error: ${stage.message}`}
        </Text>
      );
    default: {
      const _exhaustive: never = stage;
      return <Text dimColor>unknown: {String(_exhaustive)}</Text>;
    }
  }
}

// ─── ThinkingChip ─────────────────────────────────────────────────────────────

/**
 * ThinkingChip — render the working/thinking label with the chosen
 * animation style. Picks between the 5 styles (rainbow/wave/pulse/
 * dots/breathe) plus the meta-mode `cycle` that rotates through the
 * variant styles every `CYCLE_INTERVAL_SECONDS`. Rainbow remains
 * the per-glyph Catppuccin pastel hue sweep (the original wave UI);
 * the other three reuse the helpers from `animation-style.tsx`.
 */
export function ThinkingChip({
  text,
  style,
  phase,
  cycleTick,
}: {
  text: string;
  style: AnimationStyle | 'cycle';
  phase: number;
  cycleTick: number;
}): React.ReactElement {
  const live: AnimationStyle = style === 'cycle' ? styleForCycleTick(cycleTick) : style;
  if (live === 'rainbow') {
    // Smooth HSL sinusoidal hue sweep — replaces the old discrete 12-stop
    // HUE_WHEEL lookup that snapped between fixed colors. Each glyph's hue
    // is computed from its position + the animation phase, producing a
    // gradient band that glides smoothly across the text.
    const chars = Array.from(text);
    return (
      <Text bold>
        {chars.map((ch, i) => (
          <Text key={i} color={rainbowColor(i, phase)}>
            {ch}
          </Text>
        ))}
      </Text>
    );
  }
  if (live === 'wave') {
    const len = Array.from(text).length;
    return (
      <Text bold>
        {Array.from(text).map((ch, i) => (
          <Text key={i} color={waveColor(i, phase, len)}>
            {ch}
          </Text>
        ))}
      </Text>
    );
  }
  if (live === 'pulse') {
    return (
      <Text bold color={pulseColor(phase)}>
        {text}
      </Text>
    );
  }
  if (live === 'dots') {
    const stripped = stripTrailingDots(text);
    const idx = phase % DOTS_FRAMES.length;
    const suffix = DOTS_FRAMES[idx] ?? '';
    return (
      <Text bold color="green">
        {stripped}
        {suffix ? ` ${suffix}` : ''}
      </Text>
    );
  }
  // 'breathe' — spinning braille prefix, static text.
  const idx = phase % BREATHE_FRAMES.length;
  const prefix = BREATHE_FRAMES[idx] ?? (BREATHE_FRAMES[0] ?? '⠋');
  return (
    <Text bold color="green">
      {prefix} {text}
    </Text>
  );
}
