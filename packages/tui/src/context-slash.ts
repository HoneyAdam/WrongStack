import type {
  ContextBreakdown,
  ContextWindowPolicy,
  MemoryStore,
  SlashCommand,
} from '@wrongstack/core';
import type { GitInfo } from './git-info.js';

// ── Deps ──────────────────────────────────────────────────────────────────────

export interface ContextSlashDeps {
  cwd: string;
  getProvider: () => string;
  getModel: () => string;
  getModeLabel: () => string;
  getGitInfo: () => GitInfo | null;
  getFleet: () => {
    total: number;
    running: number;
    entries: Array<{
      name: string;
      status: string;
      currentTool: string | undefined;
      ctxPct: number | undefined;
    }>;
  };
  getLeader: () => {
    iterations: number;
    toolCalls: number;
    startedAt: number;
    status: string;
    currentTool: { name: string; startedAt: number } | undefined;
    ctxPct: number | undefined;
    ctxTokens: number | undefined;
    ctxMaxTokens: number | undefined;
    /** Cumulative prompt-cache stats for the session (from the token counter). */
    cacheStats?:
      | { readTokens: number; writeTokens: number; hitRatio: number; savedUsd?: number | undefined }
      | undefined;
  };
  getUptime: () => string;
  /** Terminal width in columns. */
  terminalWidth: number;
  /** Optional super memory store for stats. */
  memoryStats:
    | (() => Promise<{
        total: number;
        byKind: Record<string, number>;
        edges: number;
        byStatus: Record<string, number>;
      } | null>)
    | undefined;
  /** Optional panel-open bridge for dispatching TUI panels from the slash command. */
  onPanelOpen?: { current: ((action: string) => boolean) | null } | undefined;
  /**
   * Real per-category token breakdown of the leader's live context. When
   * provided, the expanded view shows measured numbers instead of the old
   * hardcoded fixed-percentage split. Returns null when no context is assembled
   * yet (falls back to a coarse estimate).
   */
  getBreakdown?: (() => ContextBreakdown | null) | undefined;
  /**
   * Active context-window policy (thresholds + compaction params). Drives the
   * threshold map, pressure axis, and compaction box with real values instead
   * of hardcoded 60/85/95. Null → balanced defaults.
   */
  getPolicy?: (() => ContextWindowPolicy | null) | undefined;
}

type ContextMemoryStats = Awaited<ReturnType<NonNullable<ContextSlashDeps['memoryStats']>>>;

/** Adapt the optional extended memory-store surface to context dashboard stats. */
export function createContextMemoryStatsGetter(
  memoryStore: MemoryStore | undefined,
): ContextSlashDeps['memoryStats'] {
  if (!memoryStore || !('stats' in memoryStore) || !('listSuper' in memoryStore)) return undefined;
  const store = memoryStore as MemoryStore & {
    stats(): Promise<{
      total: number;
      byStatus: Record<string, number>;
      edges: number;
    }>;
    listSuper(statuses?: string[]): Promise<Array<{ kind: string }>>;
  };
  return async (): Promise<ContextMemoryStats> => {
    const stats = await store.stats();
    const byKind: Record<string, number> = {};
    // The kind chart describes usable guidance, not the soft-delete audit
    // trail. Lifecycle totals remain available separately in byStatus.
    for (const memory of await store.listSuper(['active'])) {
      byKind[memory.kind] = (byKind[memory.kind] ?? 0) + 1;
    }
    return { total: stats.total, byKind, edges: stats.edges, byStatus: stats.byStatus };
  };
}

// ── Sparkbar ──────────────────────────────────────────────────────────────────

/**
 * Render a sparkbar: `▓` chars proportional to `value / total`.
 * At least 1 block when value > 0, max 10. Empty when value is 0.
 */
export function sparkbar(value: number, total: number): string {
  if (value === 0 || total === 0) return '';
  const blocks = Math.max(1, Math.round((value / total) * 10));
  if (blocks >= 10) return '█'.repeat(10);
  return '█'.repeat(blocks) + '░'.repeat(10 - blocks);
}

// ── Context bar ───────────────────────────────────────────────────────────────

/**
 * Render a proportional context-window bar using `█` foreground + `░` background
 * characters. The bar is `width` characters wide and includes a percentage label.
 */
export function contextBar(pct: number, width: number): string {
  if (pct <= 0) return `[${'░'.repeat(width)}]   0%`;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const label = ` ${(pct * 100).toFixed(0)}%`;
  const bar = `[${'█'.repeat(Math.max(1, filled))}${'░'.repeat(Math.max(0, empty))}]`;
  // Trim the bar to fit label
  if (bar.length + label.length <= width + 4) {
    return `${bar}${label}`;
  }
  return `${'█'.repeat(Math.max(1, filled))}${'░'.repeat(Math.max(0, empty))} ${label}`;
}

// ── Main command factory ──────────────────────────────────────────────────────

export function createContextSlashCommand(deps: ContextSlashDeps): SlashCommand {
  return {
    name: 'context',
    description:
      'Display detailed session context with visual stats (session, git, fleet, memory, env).',
    argsHint: '',
    category: 'Inspect',
    help:
      'Usage:\n' +
      '  /context                  — show session context dashboard\n' +
      '  /context window           — show only the context window details\n' +
      '  /context --window         — same as above\n',
    async run(args: string) {
      try {
        const trimmed = args.trim().toLowerCase();
        const viewOnly = trimmed === 'window' || trimmed === '--window';

        // When the user types `/context window`, try to open the interactive panel
        if (viewOnly && deps.onPanelOpen?.current) {
          const opened = deps.onPanelOpen.current('toggleContextPanel');
          if (opened) return { message: '' };
          // If no panel bridge (headless mode), fall through to text output
        }

        // Fetch memory stats only for the full dashboard
        let memoryData: Awaited<ReturnType<NonNullable<ContextSlashDeps['memoryStats']>>> = null;
        if (!viewOnly && deps.memoryStats) {
          try {
            memoryData = await deps.memoryStats();
          } catch {
            // Non-critical — skip memory section
          }
        }

        if (viewOnly) {
          return { message: renderContextWindowExpanded(deps) };
        }
        return { message: renderContext(deps, memoryData) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { message: `Failed to render context: ${msg}` };
      }
    },
  };
}

// ── Render — exported for testing ──────────────────────────────────────────────

/**
 * Pure render of the full context dashboard. Exported so tests can drive it with
 * known deps without mounting Ink or registering a real slash command.
 */
export function renderContext(
  deps: ContextSlashDeps,
  memoryData: {
    total: number;
    byKind: Record<string, number>;
    edges: number;
    byStatus: Record<string, number>;
  } | null,
): string {
  const parts: string[] = [];

  // ── Header ──
  parts.push('## 📊 Context Dashboard');
  parts.push('');

  // ── 1. Session ──
  parts.push(...renderSession(deps));
  parts.push('');

  // ── 2. Context window (if available) ──
  parts.push(...renderContextWindow(deps));
  parts.push('');

  // ── 3. Working tree ──
  const git = deps.getGitInfo();
  if (git) {
    parts.push(...renderWorkingTree(git));
    parts.push('');
  }

  // ── 4. Fleet ──
  const fleet = deps.getFleet();
  if (fleet.total > 0) {
    parts.push(...renderFleet(fleet));
    parts.push('');
  }

  // ── 5. Leader ──
  const leader = deps.getLeader();
  if (leader.iterations > 0 || leader.toolCalls > 0) {
    parts.push(...renderLeader(leader, deps.getUptime()));
    parts.push('');
  }

  // ── 6. Memory (when Super Memory is available) ──
  if (memoryData) {
    parts.push(...renderMemory(memoryData));
    parts.push('');
  }

  // ── 7. Environment ──
  parts.push(...renderEnvironment(deps));
  parts.push('');

  // ── Footer ──
  parts.push('> 💡 Tip: Run `/memory` for detailed memory stats, `/fleet` for the live monitor.');
  parts.push('');

  return parts.join('\n');
}

// ── Section: Session ──────────────────────────────────────────────────────────

function renderSession(deps: ContextSlashDeps): string[] {
  const lines: string[] = [];

  lines.push('### 🖥️  Session');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|----------|-------|');
  lines.push(`| **Provider** | \`${deps.getProvider()}\` |`);
  lines.push(`| **Model** | \`${deps.getModel()}\` |`);
  lines.push(`| **Mode** | ${deps.getModeLabel()} |`);
  lines.push(`| **Working dir** | \`${deps.cwd}\` |`);
  lines.push(`| **Uptime** | ${deps.getUptime()} |`);
  lines.push(`| **Terminal** | ${deps.terminalWidth} cols |`);

  return lines;
}

// ── Section: Context window ──────────────────────────────────────────────────

function renderContextWindow(deps: ContextSlashDeps): string[] {
  const lines: string[] = [];
  const leader = deps.getLeader();

  if (leader.ctxPct == null && leader.ctxTokens == null) {
    return lines; // no context data available yet
  }

  lines.push('### 🧠 Context Window');
  lines.push('');

  const barWidth = Math.min(30, Math.max(10, deps.terminalWidth - 20));

  if (leader.ctxPct != null) {
    const pct = Math.min(1, Math.max(0, leader.ctxPct));
    const bar = contextBar(pct, barWidth);
    lines.push(`| **Pressure** | ${bar} |`);
  }

  if (leader.ctxTokens != null && leader.ctxMaxTokens != null && leader.ctxMaxTokens > 0) {
    const used = leader.ctxTokens.toLocaleString('en-US');
    const max = leader.ctxMaxTokens.toLocaleString('en-US');
    const pct = ((leader.ctxTokens / leader.ctxMaxTokens) * 100).toFixed(1);
    lines.push(`| **Tokens** | ${used} / ${max} (${pct}%) |`);
  } else if (leader.ctxTokens != null) {
    lines.push(`| **Tokens** | ${leader.ctxTokens.toLocaleString('en-US')} |`);
  }

  // Visual gauge row
  if (leader.ctxPct != null) {
    const pct = Math.min(1, Math.max(0, leader.ctxPct));
    const danger = pct > 0.85 ? '🔴' : pct > 0.65 ? '🟡' : '🟢';
    const blocks = Math.round(pct * 10);
    const gauge = '█'.repeat(Math.max(1, blocks)) + '░'.repeat(Math.max(0, 10 - blocks));
    lines.push(`| **Gauge** | ${danger} ${gauge} |`);
  }

  return lines;
}

// ── Section: Context Window (expanded, standalone view) ──────────────────────

/**
 * Pure render of the expanded context-window view (shown by `/context window`).
 * Exported so tests can drive it directly with known deps.
 */
export function renderContextWindowExpanded(deps: ContextSlashDeps): string {
  const leader = deps.getLeader();

  if (leader.ctxPct == null && leader.ctxTokens == null) {
    const boxW = Math.min(60, deps.terminalWidth - 4);
    return [
      `╭─${'─'.repeat(boxW - 2)}╮`,
      `│ ${'📡  Context window data not available yet.'.padEnd(boxW - 4)} │`,
      `│${' '.repeat(boxW - 2)}│`,
      `│ ${'Context metrics appear once the agent starts'.padEnd(boxW - 4)} │`,
      `│ ${'processing a request.'.padEnd(boxW - 4)} │`,
      `╰─${'─'.repeat(boxW - 2)}╯`,
    ].join('\n');
  }

  const pct = leader.ctxPct != null ? Math.min(1, Math.max(0, leader.ctxPct)) : 0;
  const used = leader.ctxTokens ?? 0;
  const max = leader.ctxMaxTokens ?? 200_000;
  const free = max - used;
  const bd = deps.getBreakdown?.() ?? null;
  const policy = deps.getPolicy?.() ?? null;
  // Real compaction thresholds (fractions of the window). Fall back to the
  // *balanced* defaults (0.50/0.65/0.80) — the actual default mode — not the
  // old fabricated 0.60/0.85/0.95 that matched no mode.
  const warnT = policy?.thresholds.warn ?? 0.5;
  const softT = policy?.thresholds.soft ?? 0.65;
  const hardT = policy?.thresholds.hard ?? 0.8;
  const BOX_W = Math.min(Math.max(50, deps.terminalWidth - 6), 90);
  const INNER = BOX_W - 4; // content width inside │  │

  // ── Helper: visual bar ──────────────────────────────────────────────────────
  function bar(fillPct: number, totalLen: number): string {
    const f = Math.round(Math.min(1, Math.max(0, fillPct)) * totalLen);
    return '█'.repeat(Math.max(1, f)) + '░'.repeat(Math.max(0, totalLen - f));
  }

  // ── Helper: rounded box ─────────────────────────────────────────────────────
  function rbox(title: string, body: string[], bottom?: string): string[] {
    const out: string[] = [];
    const titlePart = title ? ` ${title} ` : '';
    const dashLen = Math.max(1, BOX_W - 2 - titlePart.length);
    out.push(`╭${titlePart}${'─'.repeat(dashLen)}╮`);
    out.push(`│${' '.repeat(BOX_W - 2)}│`);
    for (const line of body) {
      const clean = line || '';
      const pad = Math.max(0, INNER - [...clean].length);
      out.push(`│ ${clean}${' '.repeat(pad)} │`);
    }
    out.push(`│${' '.repeat(BOX_W - 2)}│`);
    if (bottom) {
      const bPad = Math.max(0, INNER - [...bottom].length);
      out.push(`│ ${bottom}${' '.repeat(bPad)} │`);
      out.push(`│${' '.repeat(BOX_W - 2)}│`);
    }
    out.push(`╰${'─'.repeat(BOX_W - 2)}╯`);
    return out;
  }

  const allParts: string[] = [];

  // ═════════════════════════════════════════════════════════════════════════════
  //  HEADER
  // ═════════════════════════════════════════════════════════════════════════════
  const zoneColor = pct > 0.85 ? '🔴' : pct > 0.65 ? '🟡' : pct > 0.45 ? '🟠' : '🟢';
  allParts.push(
    ...rbox(
      `${zoneColor} Context Telemetry`,
      [`${zoneColor}  ${deps.getModel()}  ·  ${deps.getProvider()}  ·  ${deps.getModeLabel()}`],
      `Uptime: ${deps.getUptime()}  ·  Terminal: ${deps.terminalWidth} cols`,
    ),
  );
  allParts.push('');

  // ═════════════════════════════════════════════════════════════════════════════
  //  1. PRESSURE
  // ═════════════════════════════════════════════════════════════════════════════
  const barWidth = INNER - 6;
  const filled = Math.round(pct * barWidth);
  const pctStr = ` ${(pct * 100).toFixed(1)}%`;

  const pressureBody: string[] = [];
  // The pressure bar
  pressureBody.push(`${zoneColor}  ${bar(pct, barWidth)}${pctStr}`);

  // Threshold axis below — positioned from the *active* policy thresholds.
  const warnPos = Math.round(warnT * barWidth);
  const nowPos = filled;
  const softPos = Math.round(softT * barWidth);
  const hardPos = Math.round(hardT * barWidth);

  const axis: string[] = [];
  for (let i = 0; i <= barWidth; i++) {
    if (i === 0) axis.push('├');
    else if (i === warnPos || i === softPos || i === hardPos) axis.push('┼');
    else if (i === barWidth) axis.push('┤');
    else axis.push('─');
  }
  pressureBody.push(`     ${axis.join('')}`);

  // Label row
  const markers: Array<{ pos: number; text: string }> = [
    { pos: 0, text: '0%' },
    { pos: warnPos, text: `warn⏤${Math.round(warnT * 100)}%` },
    { pos: nowPos, text: '◀ now' },
    { pos: softPos, text: `soft⏤${Math.round(softT * 100)}%` },
    { pos: hardPos, text: `hard⏤${Math.round(hardT * 100)}%` },
    { pos: barWidth, text: '100%' },
  ];
  let labelRow = '     ';
  let lastEnd = 0;
  for (const m of markers) {
    const pad = Math.max(1, m.pos - lastEnd);
    labelRow += ' '.repeat(pad) + m.text;
    lastEnd = m.pos + m.text.length;
  }
  pressureBody.push(labelRow);

  allParts.push(...rbox('📊  Pressure', pressureBody));
  allParts.push('');

  // ═════════════════════════════════════════════════════════════════════════════
  //  2. SOURCE BREAKDOWN
  // ═════════════════════════════════════════════════════════════════════════════
  const srcBarLen = INNER - 28;
  const srcBody: string[] = [];
  const maxStr = max.toLocaleString('en-US');
  const usedStr = used.toLocaleString('en-US');

  if (bd) {
    // Real, measured breakdown (chars/3.5 estimate over the assembled request).
    const denom = bd.total > 0 ? bd.total : 1;
    const sources: Array<{ icon: string; label: string; tokens: number }> = [
      { icon: '💬', label: 'History', tokens: bd.history.total },
      { icon: '⚙️', label: 'System', tokens: bd.system.total },
      { icon: '🔧', label: 'Tools', tokens: bd.tools.builtin },
      { icon: '🔌', label: 'MCP', tokens: bd.tools.mcp },
      { icon: '📌', label: 'Volatile', tokens: bd.volatile.total },
    ];
    srcBody.push('Measured from the assembled request (≈ chars/3.5).');
    for (const src of sources) {
      const frac = src.tokens / denom;
      const srcBarStr = bar(frac, srcBarLen);
      const pctS = `${(frac * 100).toFixed(1)}%`.padStart(6);
      srcBody.push(
        `${src.icon} ${src.label.padEnd(10)} ${srcBarStr}  ${pctS}  ${src.tokens.toLocaleString('en-US')}`,
      );
    }
    srcBody.push(`${'─'.repeat(INNER)}`);
    const totalPct = `${(bd.usedPct * 100).toFixed(1)}%`.padStart(6);
    srcBody.push(
      `📊 TOTAL      ${bar(bd.usedPct, srcBarLen)}  ${totalPct}  ${bd.total.toLocaleString('en-US')}`,
    );
    srcBody.push(`${' '.repeat(14)}${' '.repeat(srcBarLen)}   of ${maxStr} limit`);
    // Heaviest static system sections — the static-bloat audit surface.
    const heaviest = Object.entries(bd.system.bySource)
      .filter(([, t]) => t > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s, t]) => `${s} ${t.toLocaleString('en-US')}`)
      .join(', ');
    if (heaviest) srcBody.push(`heaviest static: ${heaviest}`);
  } else {
    // No assembled context yet — show the honest total only, no fake split.
    srcBody.push('Per-category breakdown appears once a request is assembled.');
    const totalPct = `${(pct * 100).toFixed(1)}%`.padStart(6);
    srcBody.push(`📊 TOTAL      ${bar(pct, srcBarLen)}  ${totalPct}  ${usedStr}`);
    srcBody.push(`${' '.repeat(14)}${' '.repeat(srcBarLen)}   of ${maxStr} limit`);
  }

  allParts.push(...rbox('📦  Context Composition', srcBody));
  allParts.push('');

  // ═════════════════════════════════════════════════════════════════════════════
  //  3. THRESHOLD MAP
  // ═════════════════════════════════════════════════════════════════════════════
  const warnPct = Math.round(warnT * 100);
  const softPct = Math.round(softT * 100);
  const hardPct = Math.round(hardT * 100);
  const zones: Array<{ label: string; emoji: string; from: number; to: number; desc: string }> = [
    { label: 'Safe', emoji: '🟢', from: 0, to: warnPct, desc: 'normal operation' },
    { label: 'Warning', emoji: '🟡', from: warnPct, to: softPct, desc: 'compaction advised' },
    { label: 'Critical', emoji: '🔴', from: softPct, to: hardPct, desc: 'compact soon' },
    { label: 'Danger', emoji: '⚫', from: hardPct, to: 100, desc: 'forced compaction' },
  ];

  const thresholdBody: string[] = [];
  // Visual zone strip
  let zoneStrip = '';
  for (const z of zones) {
    const zLen = Math.round(((z.to - z.from) / 100) * (INNER - 8));
    zoneStrip += `${z.emoji}${'█'.repeat(Math.max(1, zLen))}`;
  }
  thresholdBody.push(`  ${zoneStrip}`);
  thresholdBody.push('');

  // Table
  thresholdBody.push('│ Zone         │ Range     │ Status                    │');
  thresholdBody.push('│──────────────┼───────────┼───────────────────────────│');
  const curVal = pct * 100;
  for (const z of zones) {
    const marker = curVal >= z.from && curVal < z.to ? '  ◀' : '';
    const row = `│ ${z.emoji} ${z.label.padEnd(10)} │ ${z.from}%–${z.to}%${' '.repeat(4)}│ ${z.desc.padEnd(24)}${marker} │`;
    thresholdBody.push(row);
  }

  // Current position line
  const zoneName =
    pct >= hardT ? '⚫ DANGER' : pct >= softT ? '🔴 CRITICAL' : pct >= warnT ? '🟡 WARNING' : '🟢 SAFE';
  thresholdBody.push('');
  thresholdBody.push(
    `▲ ${curVal.toFixed(1)}%  →  ${zoneName}       trigger: ${softPct}%       limit: 100%`,
  );

  allParts.push(...rbox('🚦  Threshold Map', thresholdBody));
  allParts.push('');

  // ═════════════════════════════════════════════════════════════════════════════
  //  4. COMPACTION ENGINE
  // ═════════════════════════════════════════════════════════════════════════════
  // Real compaction parameters from the active policy — no fabricated numbers.
  const modeLabel = policy ? `${policy.id} (${policy.name})` : 'balanced (default)';
  const nextTriggerTokens = Math.round(max * softT).toLocaleString('en-US');
  const recommendation =
    pct >= hardT
      ? '⚫ Over hard limit — forced compaction imminent'
      : pct >= softT
        ? '🔴 Past soft threshold — compaction will fire'
        : pct >= warnT
          ? '🟡 Past warn threshold — compaction advised'
          : '🟢 Below warn threshold — no action needed';

  const compactBody: string[] = [];
  compactBody.push(`│ Parameter          │ Value`);
  compactBody.push(`│────────────────────┼─────────────────────────────────────`);
  compactBody.push(`│ Mode               │ ${modeLabel}`);
  compactBody.push(`│ Thresholds         │ warn ${warnPct}% · soft ${softPct}% · hard ${hardPct}%`);
  if (policy) {
    compactBody.push(`│ Preserve           │ last ${policy.preserveK} user/assistant messages`);
    compactBody.push(
      `│ Elide tool results │ ≥ ${policy.eliseThreshold.toLocaleString('en-US')} tokens`,
    );
  }
  compactBody.push(`│ Next trigger       │ ~${nextTriggerTokens} tokens (soft ${softPct}%)`);
  compactBody.push(`│ Status             │ ${recommendation}`);

  allParts.push(...rbox('♻️  Compaction Engine', compactBody));
  allParts.push('');

  // ═════════════════════════════════════════════════════════════════════════════
  //  5. PER-AGENT FOOTPRINT
  // ═════════════════════════════════════════════════════════════════════════════
  const fleet = deps.getFleet();
  const allAgents = [{ name: 'LEADER', ctxPct: leader.ctxPct }, ...fleet.entries];
  const agentsWithCtx = allAgents.filter((a) => a.ctxPct != null);

  if (agentsWithCtx.length > 0) {
    const agentBody: string[] = [];
    const agentBarLen = Math.min(36, INNER - 18);
    for (const agent of agentsWithCtx) {
      const apct = Math.min(1, Math.max(0, agent.ctxPct!));
      const aDanger = apct > 0.85 ? '🔴' : apct > 0.65 ? '🟡' : '🟢';
      const aPct = `${(apct * 100).toFixed(0)}%`.padStart(4);
      const tag = agent.name === 'LEADER' ? '👑' : '  ';
      const aBar = bar(apct, agentBarLen);
      agentBody.push(`${tag} ${agent.name.padEnd(14)} ${aDanger} ${aBar}  ${aPct}`);
    }
    allParts.push(...rbox('🤖  Per-Agent Footprint', agentBody));
    allParts.push('');
  }

  // ═════════════════════════════════════════════════════════════════════════════
  //  6. TOKEN METRICS
  // ═════════════════════════════════════════════════════════════════════════════
  const freeFormatted = free.toLocaleString('en-US');
  const freePct = max > 0 ? ((free / max) * 100).toFixed(1) : '0.0';
  const utilBar = bar(pct, 24);

  const metricsBody: string[] = [];
  metricsBody.push(`│ Metric            │ Value`);
  metricsBody.push(`│───────────────────┼──────────────────────────────────`);
  metricsBody.push(`│ Used              │ ${usedStr}`);
  metricsBody.push(`│ Free              │ ${freeFormatted}  (${freePct}%)`);
  metricsBody.push(`│ Capacity          │ ${maxStr}`);
  metricsBody.push(`│ Utilization       │ ${utilBar}  ${(pct * 100).toFixed(1)}%`);
  const cache = leader.cacheStats;
  if (cache && (cache.readTokens > 0 || cache.writeTokens > 0)) {
    const saved = cache.savedUsd && cache.savedUsd > 0 ? `  saved ~$${cache.savedUsd.toFixed(2)}` : '';
    metricsBody.push(
      `│ Cache hit         │ ${(cache.hitRatio * 100).toFixed(1)}%  (read ${cache.readTokens.toLocaleString('en-US')} · write ${cache.writeTokens.toLocaleString('en-US')})${saved}`,
    );
  }
  metricsBody.push(`│ Model             │ ${deps.getModel()}  ·  ${deps.getProvider()}`);
  metricsBody.push(`│ Mode              │ ${deps.getModeLabel()}`);
  metricsBody.push(`│ Uptime            │ ${deps.getUptime()}`);

  allParts.push(...rbox('📊  Token Metrics', metricsBody));
  allParts.push('');

  // ═════════════════════════════════════════════════════════════════════════════
  //  7. STATUS
  // ═════════════════════════════════════════════════════════════════════════════
  const statusText =
    pct > 0.85
      ? `🔴 CRITICAL — Context at ${(pct * 100).toFixed(1)}%. Consider compacting or a fresh session.`
      : pct > 0.65
        ? `🟡 WARNING  — Context at ${(pct * 100).toFixed(1)}%. Plan compaction soon.`
        : pct > 0.45
          ? `🟠 MODERATE — Context at ${(pct * 100).toFixed(1)}%. Healthy, monitor as it grows.`
          : `🟢 HEALTHY  — Context at ${(pct * 100).toFixed(1)}%. Plenty of room for more conversation.`;

  const statusBody: string[] = [statusText];

  allParts.push(
    ...rbox(
      '📋  Status',
      statusBody,
      `Run /context for the full dashboard with git, fleet, memory & env.`,
    ),
  );

  return allParts.join('\n');
}

// ── Section: Working tree ────────────────────────────────────────────────────

function renderWorkingTree(git: GitInfo): string[] {
  const lines: string[] = [];

  lines.push('### 📂 Working Tree');
  lines.push('');

  const totalChanges = git.added + git.deleted;

  // Branch badge
  lines.push(`🌿 **Branch:** \`${git.branch}\``);
  lines.push('');

  // Change summary table
  lines.push('| Metric | Count | Visual |');
  lines.push('|--------|-------|--------|');
  lines.push(
    `| **Added** | +${git.added} | ${totalChanges > 0 ? sparkbar(git.added, totalChanges) : '—'} |`,
  );
  lines.push(
    `| **Deleted** | −${git.deleted} | ${totalChanges > 0 ? sparkbar(git.deleted, totalChanges) : '—'} |`,
  );
  lines.push(`| **Untracked** | ${git.untracked} ${git.untracked > 0 ? '📄' : '✅'} | |`);
  lines.push(
    `| **Total Δ** | ${totalChanges > 0 ? `+${git.added} / −${git.deleted}` : 'clean'} | |`,
  );

  return lines;
}

// ── Section: Fleet ────────────────────────────────────────────────────────────

function renderFleet(fleet: {
  total: number;
  running: number;
  entries: Array<{
    name: string;
    status: string;
    currentTool: string | undefined;
    ctxPct: number | undefined;
  }>;
}): string[] {
  const lines: string[] = [];

  lines.push('### 🤖 Fleet');
  lines.push('');

  const idleCount = fleet.total - fleet.running;

  // Summary badge
  const statusIcon = fleet.running > 0 ? '🟢' : '⚪';
  lines.push(
    `${statusIcon} **${fleet.running} running** · ${idleCount} idle · ${fleet.total} total`,
  );
  lines.push('');

  // Per-agent table
  if (fleet.running > 0) {
    lines.push('| Agent | Status | Tool | Context |');
    lines.push('|-------|--------|------|---------|');
    for (const entry of fleet.entries) {
      if (entry.status !== 'running') continue;
      const statusDot = entry.status === 'running' ? '🟢' : '⚪';
      const tool = entry.currentTool ?? '—';
      const ctx = entry.ctxPct != null ? `${(entry.ctxPct * 100).toFixed(0)}%` : '—';
      lines.push(`| ${statusDot} **${entry.name}** | \`${entry.status}\` | \`${tool}\` | ${ctx} |`);
    }
    lines.push('');
  }

  return lines;
}

// ── Section: Leader ───────────────────────────────────────────────────────────

function renderLeader(
  leader: {
    iterations: number;
    toolCalls: number;
    startedAt: number;
    status: string;
    currentTool: { name: string; startedAt: number } | undefined;
  },
  uptime: string,
): string[] {
  const lines: string[] = [];

  lines.push('### 🔄 Leader Activity');
  lines.push('');

  const statusDot =
    leader.status === 'running' || leader.status === 'streaming'
      ? '🟢'
      : leader.status === 'idle'
        ? '⚪'
        : leader.status === 'error'
          ? '🔴'
          : '⚪';

  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| **Status** | ${statusDot} ${leader.status} |`);
  lines.push(`| **Iterations** | ${leader.iterations} |`);
  lines.push(`| **Tool calls** | ${leader.toolCalls} |`);
  lines.push(`| **Uptime** | ${uptime} |`);

  if (leader.currentTool) {
    const toolName = leader.currentTool.name;
    lines.push(`| **Current tool** | \`${toolName}\` |`);
  }

  return lines;
}

// ── Section: Memory ───────────────────────────────────────────────────────────

function renderMemory(memory: {
  total: number;
  byKind: Record<string, number>;
  edges: number;
  byStatus: Record<string, number>;
}): string[] {
  const lines: string[] = [];

  lines.push('### 🧠 Super Memory');
  lines.push('');

  const active = memory.byStatus['active'] ?? 0;
  lines.push('**Mode:** on-demand tool-result retrieval');
  lines.push(`**Eligible pool:** ${active} active`);
  lines.push('> No memory dump is in the prompt. Only a few active, relevant hints may be appended after a matching tool call.');
  lines.push('> Full storage history and graph totals live under `/memory stats`.');
  lines.push('');

  // Kind breakdown
  const kindOrder = [
    'fact',
    'decision',
    'convention',
    'preference',
    'anti_pattern',
    'warning',
    'workflow',
    'bug_root_cause',
    'file_note',
    'symbol_note',
    'command_note',
    'summary',
  ];
  const kindRows: string[] = [];
  for (const kind of kindOrder) {
    const count = memory.byKind[kind] ?? 0;
    if (count === 0) continue;
    const bar = sparkbar(count, active);
    kindRows.push(`\`${kind}\`: ${count} ${bar}`);
  }
  if (kindRows.length > 0) {
    lines.push(`📊 ${kindRows.join('  ·  ')}`);
  }

  return lines;
}

// ── Section: Environment ──────────────────────────────────────────────────────

function renderEnvironment(deps: ContextSlashDeps): string[] {
  const lines: string[] = [];

  lines.push('### ⚙️  Environment');
  lines.push('');

  const os = process.platform;
  const nodeVer = process.version;
  const pid = process.pid;

  lines.push('| Key | Value |');
  lines.push('|-----|-------|');
  lines.push(`| **OS** | ${os} ${osRelease()}`);
  lines.push(`| **Node.js** | ${nodeVer}`);
  lines.push(`| **PID** | ${pid}`);
  lines.push(`| **Terminal width** | ${deps.terminalWidth} cols`);

  return lines;
}

/** Best-effort OS release string. */
function osRelease(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os') as typeof import('node:os');
    return os.release();
  } catch {
    return '';
  }
}
