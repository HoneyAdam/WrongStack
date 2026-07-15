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

// ── Render ────────────────────────────────────────────────────────────────────

function renderContext(
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

function renderContextWindowExpanded(deps: ContextSlashDeps): string {
  const lines: string[] = [];
  const leader = deps.getLeader();

  lines.push('## 🧠 Context Window');
  lines.push('');

  if (leader.ctxPct == null && leader.ctxTokens == null) {
    lines.push('*No context window data available yet.*');
    lines.push('');
    lines.push('> Context metrics appear once the agent starts processing a request.');
    return lines.join('\n');
  }

  const barWidth = Math.min(40, Math.max(15, deps.terminalWidth - 20));

  // ── Big pressure bar ──
  if (leader.ctxPct != null) {
    const pct = Math.min(1, Math.max(0, leader.ctxPct));
    const danger = pct > 0.85 ? '🔴' : pct > 0.65 ? '🟡' : '🟢';

    lines.push(`${danger} **Context Pressure**`);
    lines.push('');

    // Full-width visual bar
    const filled = Math.round(pct * barWidth);
    const empty = barWidth - filled;
    const bar = `${'█'.repeat(Math.max(1, filled))}${'░'.repeat(Math.max(0, empty))}`;
    const pctLabel = ` ${(pct * 100).toFixed(1)}%`;

    // Top: label + percentage
    lines.push(`  ${bar} ${pctLabel}`);
    // Bottom: axis markers
    const axisMarks = `0%${' '.repeat(Math.max(0, barWidth - 6))}100%`;
    lines.push(`  ${axisMarks}`);
    lines.push('');
  }

  // ── Token table ──
  lines.push('### 📊 Token Usage');
  lines.push('');

  if (leader.ctxTokens != null && leader.ctxMaxTokens != null && leader.ctxMaxTokens > 0) {
    const used = leader.ctxTokens.toLocaleString();
    const max = leader.ctxMaxTokens.toLocaleString();
    const pct = ((leader.ctxTokens / leader.ctxMaxTokens) * 100).toFixed(1);
    const free = (leader.ctxMaxTokens - leader.ctxTokens).toLocaleString();

    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| **Used** | ${used} tokens |`);
    lines.push(`| **Available** | ${max} tokens |`);
    lines.push(`| **Free** | ${free} tokens |`);
    lines.push(`| **Utilization** | ${pct}% |`);
  } else if (leader.ctxTokens != null) {
    lines.push(`**Tokens:** ${leader.ctxTokens.toLocaleString()}`);
  }
  lines.push('');

  // ── Visual gauge ──
  if (leader.ctxPct != null) {
    const pct = Math.min(1, Math.max(0, leader.ctxPct));
    const danger = pct > 0.85 ? '🔴' : pct > 0.65 ? '🟡' : '🟢';
    const blocks = Math.round(pct * 10);
    const gauge = '█'.repeat(Math.max(1, blocks)) + '░'.repeat(Math.max(0, 10 - blocks));

    lines.push('### 📏 Pressure Gauge');
    lines.push('');
    lines.push(`  ${danger} ${gauge}`);
    const labels = '    0%    25%    50%    75%   100%';
    lines.push(`  ${labels}`);
    lines.push('');

    // Status description
    const statusText =
      pct > 0.85
        ? '⚠️ **High pressure** — consider compacting context or starting a fresh session.'
        : pct > 0.65
          ? '📝 **Moderate pressure** — context is filling up but still comfortable.'
          : '✅ **Low pressure** — plenty of room for more conversation.';
    lines.push(statusText);
    lines.push('');
  }

  // ── Per-agent breakdown ──
  const fleet = deps.getFleet();
  const agentsWithCtx = fleet.entries.filter((e) => e.ctxPct != null);
  if (agentsWithCtx.length > 0) {
    lines.push('### 🤖 Per-Agent Context');
    lines.push('');
    lines.push('| Agent | Pressure | Gauge |');
    lines.push('|-------|----------|-------|');
    for (const agent of agentsWithCtx) {
      const pct = Math.min(1, Math.max(0, agent.ctxPct!));
      const blocks = Math.round(pct * 10);
      const gauge = '█'.repeat(Math.max(1, blocks)) + '░'.repeat(Math.max(0, 10 - blocks));
      const danger = pct > 0.85 ? '🔴' : pct > 0.65 ? '🟡' : '🟢';
      const pctStr = `${(pct * 100).toFixed(0)}%`;
      lines.push(`| **${agent.name}** | ${pctStr} | ${danger} ${gauge} |`);
    }
    lines.push('');
  }

  // ── Session context ──
  lines.push('### 🖥️  Session');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|----------|-------|');
  lines.push(`| **Provider** | \`${deps.getProvider()}\` |`);
  lines.push(`| **Model** | \`${deps.getModel()}\` |`);
  lines.push(`| **Mode** | ${deps.getModeLabel()} |`);
  lines.push(`| **Uptime** | ${deps.getUptime()} |`);
  lines.push(`| **Terminal** | ${deps.terminalWidth} cols |`);
  lines.push('');

  // ── Footer ──
  lines.push('> 💡 Run `/context` for the full dashboard with git, fleet, memory & env.');
  lines.push('');

  return lines.join('\n');
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
