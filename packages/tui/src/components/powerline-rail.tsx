import type React from 'react';
import { isValidElement } from 'react';
import { Text } from '../ink.js';
import { displayWidth } from '../terminal-width.js';
import { theme } from '../theme.js';
import { glyphs } from '../ui-glyphs.js';

const RAIL_BACKGROUNDS = ['#45475a', '#3b3d52', '#313244', '#45475a', '#36384d'] as const;

export function visibleNodeText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(visibleNodeText).join('');
  if (isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode; text?: unknown };
    if (props.children !== undefined) return visibleNodeText(props.children);
    if (typeof props.text === 'string') return props.text;
    return '';
  }
  return '';
}

export interface PowerlineRailProps {
  segments: React.ReactElement[];
  budget: number;
  monochrome?: boolean | undefined;
}

/**
 * Full-cell status segments with Powerline-style transitions. The default
 * Unicode profile uses font-safe half-circles/triangles; Nerd Font mode swaps
 * in the canonical Powerline private-use glyphs.
 */
export function PowerlineRail({
  segments,
  budget,
  monochrome = false,
}: PowerlineRailProps): React.ReactElement {
  if (segments.length === 0) return <Text> </Text>;

  const widths = segments.map((segment) => displayWidth(visibleNodeText(segment)) + 2);
  let used = monochrome ? 2 : 1;
  let keep = 0;
  for (const width of widths) {
    const transition = keep > 0 ? (monochrome ? 3 : 1) : 0;
    const end = monochrome ? 1 : 1;
    if (keep > 0 && used + transition + width + end > budget) break;
    used += transition + width;
    keep += 1;
  }
  keep = Math.max(1, keep);
  const visible = segments.slice(0, keep);
  const dropped = segments.length - keep;

  if (monochrome) {
    return (
      <Text>
        <Text dimColor>{glyphs.segmentStart}</Text>
        {visible.map((segment, index) => (
          <Text key={index}>
            {index > 0 ? <Text dimColor>{' › '}</Text> : null}
            <Text>{' '}{segment}{' '}</Text>
          </Text>
        ))}
        {dropped > 0 ? <Text dimColor>{` › +${dropped}`}</Text> : null}
        <Text dimColor>{glyphs.segmentEnd}</Text>
      </Text>
    );
  }

  return (
    <Text>
      <Text color={RAIL_BACKGROUNDS[0]}>{glyphs.segmentStart}</Text>
      {visible.map((segment, index) => {
        const bg = RAIL_BACKGROUNDS[index % RAIL_BACKGROUNDS.length]!;
        const nextBg = RAIL_BACKGROUNDS[(index + 1) % RAIL_BACKGROUNDS.length]!;
        const isLast = index === visible.length - 1;
        return (
          <Text key={index}>
            <Text backgroundColor={bg} color={theme.textPrimary}>{' '}{segment}{' '}</Text>
            {isLast ? (
              <Text color={bg}>{glyphs.segmentEnd}</Text>
            ) : (
              <Text color={bg} backgroundColor={nextBg}>{glyphs.segmentTransition}</Text>
            )}
          </Text>
        );
      })}
      {dropped > 0 ? <Text color={theme.textMuted}>{` +${dropped}`}</Text> : null}
    </Text>
  );
}
