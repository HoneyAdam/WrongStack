import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Box, Text, useStdout } from '../ink.js';
import { theme } from '../theme.js';

export interface MonitorSize {
  columns: number;
  rows: number;
  /** Width inside a full-width round border with one column of horizontal padding. */
  contentWidth: number;
  /** Conservative row budget after the shared header/footer chrome. */
  contentRows: number;
}

export function useMonitorSize(): MonitorSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 90,
    rows: stdout?.rows ?? 24,
  });

  useEffect(() => {
    const update = () => {
      setSize({ columns: stdout?.columns ?? 90, rows: stdout?.rows ?? 24 });
    };
    update();
    process.stdout.on('resize', update);
    return () => {
      process.stdout.off('resize', update);
    };
  }, [stdout]);

  return {
    ...size,
    contentWidth: Math.max(24, size.columns - 4),
    contentRows: Math.max(4, size.rows - 9),
  };
}

export function truncatePanelText(text: string, width: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (width <= 0) return '';
  if (normalized.length <= width) return normalized;
  if (width === 1) return '…';
  return `${normalized.slice(0, width - 1)}…`;
}

export function panelWindow(
  total: number,
  selected: number,
  limit: number,
): { start: number; end: number; above: number; below: number } {
  if (total <= 0 || limit <= 0) return { start: 0, end: 0, above: 0, below: 0 };
  const safeLimit = Math.max(1, Math.min(total, limit));
  const safeSelected = Math.max(0, Math.min(total - 1, selected));
  const half = Math.floor(safeLimit / 2);
  let start = Math.max(0, safeSelected - half);
  const end = Math.min(total, start + safeLimit);
  start = Math.max(0, end - safeLimit);
  return { start, end, above: start, below: total - end };
}

export interface MonitorShellProps {
  accent: string;
  icon: string;
  title: string;
  /** Quiet context beside the title, hidden by callers on narrow terminals. */
  kicker?: string | undefined;
  right?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  children?: ReactNode | undefined;
  grow?: boolean | undefined;
}

/** Shared chrome for F-key monitors: one visual hierarchy and one geometry contract. */
export function MonitorShell({
  accent,
  icon,
  title,
  kicker,
  right,
  footer,
  children,
  grow = false,
}: MonitorShellProps) {
  return (
    <Box
      alignSelf="stretch"
      width="100%"
      flexDirection="column"
      borderStyle="round"
      borderColor={accent}
      paddingX={1}
      flexGrow={grow ? 1 : 0}
    >
      <Box height={1}>
        <Text color={accent} bold>
          {icon} {title}
        </Text>
        {kicker ? <Text color={theme.textMuted}> / {kicker}</Text> : null}
        <Box flexGrow={1} />
        {right}
      </Box>
      {children}
      {footer ? <Box marginTop={1}>{footer}</Box> : null}
    </Box>
  );
}

export function SectionLabel({
  children,
  color = theme.textMuted,
}: {
  children: ReactNode;
  color?: string | undefined;
}) {
  return (
    <Text color={color} bold>
      {children}
    </Text>
  );
}

export function KeyCap({
  keyName,
  label,
  color = theme.accent,
}: {
  keyName: string;
  label: string;
  color?: string | undefined;
}) {
  return (
    <Text>
      <Text
        color={color}
        bold
        {...(theme.supportsBackground ? { backgroundColor: theme.surfaceRaised } : {})}
      >
        {' '}
        {keyName}{' '}
      </Text>
      <Text color={theme.textMuted}> {label}</Text>
    </Text>
  );
}

export function EmptyPanelState({
  icon,
  title,
  detail,
  accent = theme.textMuted,
}: {
  icon: string;
  title: string;
  detail?: ReactNode | undefined;
  accent?: string | undefined;
}) {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Text color={accent} bold>
        {icon} {title}
      </Text>
      {detail ? (
        <Box marginTop={1}>
          <Text color={theme.textMuted}>{detail}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
