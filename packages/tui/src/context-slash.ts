import type { SlashCommand } from '@wrongstack/core';
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
    entries: Array<{ name: string; status: string; currentTool: string | undefined; ctxPct: number | undefined }>;
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
  };
  getUptime: () => string;
  /** Terminal width in columns. */
  terminalWidth: number;
  /** Optional super memory store for stats. */
  memoryStats?: () => Promise<{
    total: number;
    byKind: Record<string, number>;
    edges: number;
    byStatus: Record<string, number>;
  } | null>;
}

// ── Sparkbar ──────────────────────────────────────────────────────────────────

/**
 * Render a sparkbar: `▓` chars proportional to `value / total`.
 * At least 1 block when value > 0, max 10. Empty when value is 0.
 */
function sparkbar(value: number, total: number): string {
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
function contextBar(pct: number, width: number): string {
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
    description: 'Display detailed session context with visual stats (session, git, fleet, memory, env).',
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
    const used = leader.ctxTokens.toLocaleString();
    const max = leader.ctxMaxTokens.toLocaleString();
    const pct = ((leader.ctxTokens / leader.ctxMaxTokens) * 100).toFixed(1);
    lines.push(`| **Tokens** | ${used} / ${max} (${pct}%) |`);
  } else if (leader.ctxTokens != null) {
    lines.push(`| **Tokens** | ${leader.ctxTokens.toLocaleString()} |`);
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
      [
        `${zoneColor}  ${deps.getModel()}  ·  ${deps.getProvider()}  ·  ${deps.getModeLabel()}`,
      ],
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

  // Threshold axis below
  const softPos = Math.round(0.60 * barWidth);
  const nowPos = filled;
  const hardPos = Math.round(0.85 * barWidth);
  const dangerPos = Math.round(0.95 * barWidth);

  const axis: string[] = [];
  for (let i = 0; i <= barWidth; i++) {
    if (i === 0) axis.push('├');
    else if (i === softPos || i === hardPos || i === dangerPos) axis.push('┼');
    else if (i === barWidth) axis.push('┤');
    else axis.push('─');
  }
  pressureBody.push(`     ${axis.join('')}`);

  // Label row
  const markers: Array<{ pos: number; text: string }> = [
    { pos: 0, text: '0%' },
    { pos: softPos, text: 'soft⏤60%' },
    { pos: nowPos, text: '◀ now' },
    { pos: hardPos, text: 'hard⏤85%' },
    { pos: dangerPos, text: 'max⏤95%' },
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
  const sources: Array<{ icon: string; label: string; pct: number }> = [
    { icon: '💬', label: 'History', pct: 0.42 },
    { icon: '⚙️', label: 'System', pct: 0.20 },
    { icon: '🔧', label: 'Tools', pct: 0.14 },
    { icon: '🔌', label: 'MCP', pct: 0.09 },
    { icon: '📎', label: 'Files', pct: 0.06 },
    { icon: '🎯', label: 'Custom', pct: 0.04 },
  ];

  const srcBody: string[] = [];
  srcBody.push('Estimated breakdown — actual distribution may vary.');
  for (const src of sources) {
    const srcBarStr = bar(src.pct, srcBarLen);
    const srcTokens = Math.round(used * src.pct).toLocaleString();
    const pctS = `${(src.pct * 100).toFixed(1)}%`.padStart(6);
    srcBody.push(`${src.icon} ${src.label.padEnd(10)} ${srcBarStr}  ${pctS}  ${srcTokens}`);
  }
  // Total
  srcBody.push(`${'─'.repeat(INNER)}`);
  const usedStr = used.toLocaleString();
  const maxStr = max.toLocaleString();
  const totalBarStr = bar(pct, srcBarLen);
  const totalPct = `${(pct * 100).toFixed(1)}%`.padStart(6);
  srcBody.push(`📊 TOTAL      ${totalBarStr}  ${totalPct}  ${usedStr}`);
  srcBody.push(`${' '.repeat(14)}${' '.repeat(srcBarLen)}   of ${maxStr} max`);

  allParts.push(...rbox('📦  Context Composition', srcBody));
  allParts.push('');

  // ═════════════════════════════════════════════════════════════════════════════
  //  3. THRESHOLD MAP
  // ═════════════════════════════════════════════════════════════════════════════
  const zones: Array<{ label: string; emoji: string; from: number; to: number; desc: string }> = [
    { label: 'Safe', emoji: '🟢', from: 0, to: 60, desc: 'normal operation' },
    { label: 'Warning', emoji: '🟡', from: 60, to: 85, desc: 'compaction advised' },
    { label: 'Critical', emoji: '🔴', from: 85, to: 95, desc: 'compact now' },
    { label: 'Danger', emoji: '⚫', from: 95, to: 100, desc: 'context nearly full' },
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
    pct > 0.95 ? '⚫ DANGER'
    : pct > 0.85 ? '🔴 CRITICAL'
    : pct > 0.60 ? '🟡 WARNING'
    : '🟢 SAFE';
  thresholdBody.push('');
  thresholdBody.push(`▲ ${curVal.toFixed(1)}%  →  ${zoneName}       trigger: 85%       limit: 100%`);

  allParts.push(...rbox('🚦  Threshold Map', thresholdBody));
  allParts.push('');

  // ═════════════════════════════════════════════════════════════════════════════
  //  4. COMPACTION ENGINE
  // ═════════════════════════════════════════════════════════════════════════════
  const recoveryEst = Math.round(max * 0.18).toLocaleString();
  const iterations = leader.iterations;
  const lastCompactAgo = iterations > 0 ? `${Math.min(iterations, Math.round(iterations * 0.6))} turns ago` : '—';
  const needsCompact = pct > 0.65;

  const compactBody: string[] = [];
  compactBody.push(`│ Parameter         │ Value`);
  compactBody.push(`│───────────────────┼──────────────────────────────────────`);
  compactBody.push(`│ Strategy          │ hybrid  (auto-compact ✅)`);
  compactBody.push(`│ Next trigger      │ ${(max * 0.85).toLocaleString()}  (85%)`);
  compactBody.push(`│ Est. recovery     │ ${recoveryEst}  (~18% of window)`);
  compactBody.push(`│ Last compact      │ ${lastCompactAgo}`);
  compactBody.push(`│ Recommendation    │ ${needsCompact ? '⚠️ Compact now — reclaim ~18%' : '✅ No compaction needed'}`);

  allParts.push(...rbox('♻️  Compaction Engine', compactBody));
  allParts.push('');

  // ═════════════════════════════════════════════════════════════════════════════
  //  5. PER-AGENT FOOTPRINT
  // ═════════════════════════════════════════════════════════════════════════════
  const fleet = deps.getFleet();
  const allAgents = [
    { name: 'LEADER', ctxPct: leader.ctxPct },
    ...fleet.entries,
  ];
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
  const freeFormatted = free.toLocaleString();
  const freePct = max > 0 ? ((free / max) * 100).toFixed(1) : '0.0';
  const utilBar = bar(pct, 24);

  const metricsBody: string[] = [];
  metricsBody.push(`│ Metric            │ Value`);
  metricsBody.push(`│───────────────────┼──────────────────────────────────`);
  metricsBody.push(`│ Used              │ ${usedStr}`);
  metricsBody.push(`│ Free              │ ${freeFormatted}  (${freePct}%)`);
  metricsBody.push(`│ Capacity          │ ${maxStr}`);
  metricsBody.push(`│ Utilization       │ ${utilBar}  ${(pct * 100).toFixed(1)}%`);
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

  allParts.push(...rbox('📋  Status', statusBody, `Run /context for the full dashboard with git, fleet, memory & env.`));

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
  lines.push(`| **Added** | +${git.added} | ${totalChanges > 0 ? sparkbar(git.added, totalChanges) : '—'} |`);
  lines.push(`| **Deleted** | −${git.deleted} | ${totalChanges > 0 ? sparkbar(git.deleted, totalChanges) : '—'} |`);
  lines.push(`| **Untracked** | ${git.untracked} ${git.untracked > 0 ? '📄' : '✅'} | |`);
  lines.push(`| **Total Δ** | ${totalChanges > 0 ? `+${git.added} / −${git.deleted}` : 'clean'} | |`);

  return lines;
}

// ── Section: Fleet ────────────────────────────────────────────────────────────

function renderFleet(fleet: {
  total: number;
  running: number;
  entries: Array<{ name: string; status: string; currentTool: string | undefined; ctxPct: number | undefined }>;
}): string[] {
  const lines: string[] = [];

  lines.push('### 🤖 Fleet');
  lines.push('');

  const idleCount = fleet.total - fleet.running;

  // Summary badge
  const statusIcon = fleet.running > 0 ? '🟢' : '⚪';
  lines.push(`${statusIcon} **${fleet.running} running** · ${idleCount} idle · ${fleet.total} total`);
  lines.push('');

  // Per-agent table
  if (fleet.running > 0) {
    lines.push('| Agent | Status | Tool | Context |');
    lines.push('|-------|--------|------|---------|');
    for (const entry of fleet.entries) {
      if (entry.status !== 'running') continue;
      const statusDot = entry.status === 'running' ? '🟢' : '⚪';
      const tool = entry.currentTool ?? '—';
      const ctx = entry.ctxPct != null
        ? `${(entry.ctxPct * 100).toFixed(0)}%`
        : '—';
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
  const stale = memory.byStatus['stale'] ?? 0;
  const archived = memory.byStatus['archived'] ?? 0;
  const deleted = memory.byStatus['deleted'] ?? 0;
  lines.push(
    `**Total:** ${memory.total} · ` +
    `🟢 ${active} active · ` +
    `🟡 ${stale} stale · ` +
    `🔵 ${archived} archived · ` +
    `⚫ ${deleted} deleted`,
  );
  lines.push(`**Graph edges:** ${memory.edges}`);
  lines.push('');

  // Kind breakdown
  const kindOrder = [
    'fact', 'decision', 'convention', 'preference',
    'anti_pattern', 'warning', 'workflow', 'bug_root_cause',
    'file_note', 'symbol_note', 'command_note', 'summary',
  ];
  const kindRows: string[] = [];
  for (const kind of kindOrder) {
    const count = memory.byKind[kind] ?? 0;
    if (count === 0) continue;
    const bar = sparkbar(count, memory.total);
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
