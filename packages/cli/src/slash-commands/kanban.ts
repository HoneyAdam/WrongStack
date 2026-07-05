import {
  addCheckToTask,
  addColumn,
  addDependency,
  addNoteToTask,
  addTask,
  areDependenciesMet,
  assignTask,
  color,
  copyTaskToBoard,
  createBoard,
  duplicateBoard,
  exportBoardAsMarkdown,
  findBlockedTasks,
  generateBoardFromDescription,
  getBoard,
  getTask,
  type KanbanBoard,
  type KanbanBoardSummary,
  type KanbanTask,
  listBoards,
  moveTask,
  parseLinesIntoTasks,
  removeBoard,
  removeColumn,
  removeTask,
  type SlashCommand,
  transferTaskToBoard,
  updateBoard as updateBoardManager,
  updateTask,
  updateTaskAssignment,
} from '@wrongstack/core';
import { parseSubcommand, unknownSubcommand } from './helpers.js';
import type { SlashCommandContext } from './index.js';

// ── Colour helpers ──────────────────────────────────────────────────────

const HEADING = (s: string) => color.bold(s);
const LABEL = (s: string) => color.cyan(s);
const VALUE = (s: string) => s;
const DIM = (s: string) => color.dim(s);
const TAG_CRITICAL = (s: string) => color.bold(color.red(s));
const TAG_HIGH = (s: string) => color.yellow(s);
const TAG_MEDIUM = (s: string) => s;
const TAG_LOW = (s: string) => color.dim(s);
const STATUS_BADGE: Record<string, (s: string) => string> = {
  pending: (s) => color.dim(s),
  in_progress: (s) => color.blue(s),
  blocked: (s) => color.red(s),
  completed: (s) => color.green(s),
  failed: (s) => color.bold(color.red(s)),
};

function fmtPriority(p: string): string {
  const map: Record<string, (s: string) => string> = {
    critical: TAG_CRITICAL,
    high: TAG_HIGH,
    medium: TAG_MEDIUM,
    low: TAG_LOW,
  };
  return (map[p] ?? TAG_MEDIUM)(p.toUpperCase());
}

function fmtStatus(s: string): string {
  return (STATUS_BADGE[s] ?? ((x: string) => x))(s.replace('_', ' '));
}

function fmtTimestamp(iso: string | undefined): string {
  if (!iso) return DIM('never');
  const d = new Date(iso);
  return d.toLocaleString();
}

function fmtAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Formatting ──────────────────────────────────────────────────────────

function formatBoardList(boards: KanbanBoardSummary[]): string {
  if (!boards.length) return DIM('No kanban boards yet. Use /kanban create <title> to start one.');
  const lines: string[] = [HEADING(`Kanban Boards (${boards.length})`), ''];
  for (const b of boards) {
    const pct = b.taskCount > 0 ? Math.round((b.completedTaskCount / b.taskCount) * 100) : 0;
    const progress = b.taskCount > 0 ? ` ${pct}% done` : ' empty';
    lines.push(
      `  ${LABEL(b.id.slice(0, 8))}  ${VALUE(b.title)}  ${DIM(`${b.columnCount} cols · ${b.taskCount} tasks${progress}`)}`,
    );
  }
  return lines.join('\n');
}

function formatBoardDetail(board: KanbanBoard): string {
  const lines: string[] = [];
  lines.push(HEADING(`📋 ${board.title}`));
  if (board.description) lines.push(DIM(board.description));
  lines.push('');
  lines.push(`  ${LABEL('ID')}:      ${board.id}`);
  lines.push(`  ${LABEL('Created')}: ${fmtTimestamp(board.createdAt)}`);
  lines.push(`  ${LABEL('Updated')}: ${fmtTimestamp(board.updatedAt)}`);
  if (board.tags?.length) lines.push(`  ${LABEL('Tags')}:    ${board.tags.join(', ')}`);
  lines.push('');

  for (const col of board.columns) {
    const colTasks = board.tasks
      .filter((t) => t.columnId === col.id)
      .sort((a, b) => a.order - b.order);

    const wip =
      col.wipLimit && col.wipLimit > 0 ? DIM(` [${colTasks.length}/${col.wipLimit}]`) : '';
    lines.push(HEADING(`  ${col.title}${wip}`));
    if (col.description) lines.push(`   ${DIM(col.description)}`);

    if (!colTasks.length) {
      lines.push(`   ${DIM('— empty —')}`);
    } else {
      for (const task of colTasks) {
        const depMarker = task.dependsOn?.length ? DIM(` ⛓️${task.dependsOn.length}`) : '';
        const agentMarker = task.assignedAgent ? DIM(` 👤${task.assignedAgent}`) : '';
        if (task.status === 'completed') {
          lines.push(`   ✅ ${task.title}${agentMarker}${depMarker}`);
        } else if (task.status === 'blocked') {
          lines.push(`   🚫 ${task.title}${agentMarker}${depMarker}`);
        } else if (task.status === 'in_progress') {
          lines.push(`   🔄 ${task.title}${agentMarker}${depMarker}`);
        } else {
          lines.push(`   ○ ${task.title}${agentMarker}${depMarker}`);
        }
        lines.push(
          `      ${DIM(task.id.slice(0, 8))} ${fmtPriority(task.priority)} ${fmtStatus(task.status)}`,
        );
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatTaskDetail(board: KanbanBoard, task: KanbanTask): string {
  const lines: string[] = [];
  lines.push(HEADING(`📌 ${task.title}`));
  lines.push(`  ${LABEL('ID')}:       ${task.id}`);
  lines.push(`  ${LABEL('Status')}:   ${fmtStatus(task.status)}`);
  lines.push(`  ${LABEL('Priority')}: ${fmtPriority(task.priority)}`);
  if (task.description) lines.push(`  ${LABEL('Desc')}:    ${task.description}`);

  const col = board.columns.find((c) => c.id === task.columnId);
  lines.push(`  ${LABEL('Column')}:   ${col?.title ?? task.columnId}`);

  if (task.assignedAgent) lines.push(`  ${LABEL('Agent')}:    ${task.assignedAgent}`);
  if (task.assignee) lines.push(`  ${LABEL('Assignee')}: ${task.assignee}`);

  if (task.dependsOn?.length) {
    const depNames = task.dependsOn
      .map((depId: string) => {
        const dep = board.tasks.find((t) => t.id === depId);
        return dep ? `${dep.title} (${dep.status})` : depId;
      })
      .join(', ');
    lines.push(`  ${LABEL('Depends on')}: ${depNames}`);
    lines.push(
      `  ${LABEL('Met?')}:     ${areDependenciesMet(board, task.id) ? color.green('Yes') : color.red('No')}`,
    );
  }

  const blocked = findBlockedTasks(board, task.id);
  if (blocked.length) {
    lines.push(`  ${LABEL('Blocks')}:    ${blocked.map((t) => t.title).join(', ')}`);
  }

  if (task.successCriteria?.length) {
    lines.push('');
    lines.push(HEADING('  Success Criteria:'));
    for (const check of task.successCriteria) {
      const icon =
        check.status === 'passed'
          ? '✅'
          : check.status === 'failed'
            ? '❌'
            : check.status === 'skipped'
              ? '⏭️'
              : '⬜';
      lines.push(`   ${icon} ${check.description}`);
      if (check.checkedBy)
        lines.push(
          `       by ${check.checkedBy} ${check.checkedAt ? fmtAge(check.checkedAt) : ''}`,
        );
    }
  }

  if (task.estimatedHours || task.actualHours) {
    lines.push('');
    lines.push(
      `  ${LABEL('Est.')} ${task.estimatedHours ?? '—'}h  Actual: ${task.actualHours ?? '—'}h`,
    );
  }

  if (task.links?.length) {
    lines.push('');
    lines.push(HEADING('  Links:'));
    for (const link of task.links) {
      lines.push(`   🔗 ${link.title ?? link.url} ${DIM(`(${link.type})`)}`);
    }
  }

  if (task.notes?.length) {
    lines.push('');
    lines.push(HEADING('  Notes:'));
    for (const note of task.notes) {
      lines.push(`   💬 ${note.author}: ${note.content} ${DIM(fmtAge(note.createdAt))}`);
    }
  }

  lines.push('');
  lines.push(`  ${LABEL('Created')}: ${fmtTimestamp(task.createdAt)}`);
  lines.push(`  ${LABEL('Updated')}: ${fmtTimestamp(task.updatedAt)}`);

  return lines.join('\n');
}

function formatDependencyChain(board: KanbanBoard, taskId: string, depth = 0): string {
  const task = board.tasks.find((t) => t.id === taskId || t.id.startsWith(taskId));
  if (!task) return `  ${DIM('Task not found')}`;

  const prefix = '  '.repeat(depth);
  const statusIcon =
    task.status === 'completed'
      ? '✅'
      : task.status === 'blocked'
        ? '🚫'
        : task.status === 'in_progress'
          ? '🔄'
          : '○';
  const lines: string[] = [`${prefix}${statusIcon} ${task.title} ${DIM(`[${task.status}]`)}`];

  if (task.dependsOn?.length) {
    for (const depId of task.dependsOn) {
      lines.push(formatDependencyChain(board, depId, depth + 1));
    }
  }

  return lines.join('\n');
}

// ── Command builder ─────────────────────────────────────────────────────

export function buildKanbanCommand(opts: SlashCommandContext): SlashCommand {
  const { projectRoot } = opts;

  return {
    name: 'kanban',
    category: 'Run',
    aliases: ['kb', 'board'],
    description: 'Multi-kanban board management. Create, view, edit, auto-generate boards.',
    help: [
      'Usage:',
      '  /kanban                        List all kanban boards',
      '  /kanban open                   Open the TUI kanban panel',
      '  /kanban create <title>         Create a new board',
      '  /kanban duplicate <boardId> [title]  Duplicate a board',
      '  /kanban show <boardId>         Show board details (columns + tasks)',
      '  /kanban delete <boardId>       Delete a board',
      '  /kanban rename <boardId> <t>   Rename a board',
      '',
      '  /kanban task add <boardId> <title>          Add a task to board',
      '  /kanban task <boardId>                     List tasks on a board',
      '  /kanban task show <boardId> <taskId>       Show task details',
      '  /kanban task move <boardId> <taskId> <col>  Move task to column',
      '  /kanban task done <boardId> <taskId>        Mark task completed',
      '  /kanban task block <boardId> <taskId>       Mark task blocked',
      '  /kanban task remove <boardId> <taskId>      Delete a task',
      '  /kanban task copy <fromBoard> <taskId> <toBoard> [columnId]',
      '  /kanban task transfer <fromBoard> <taskId> <toBoard> [columnId]',
      '',
      '  /kanban task priority <boardId> <taskId> <p>   Set priority',
      '  /kanban task assign <boardId> <taskId> <agent> [--provider=p --model=m --fallback=f]',
      '  /kanban task dispatch <boardId> <taskId> [--provider=p --model=m --name=n]',
      '  /kanban task depend <boardId> <taskId> <depId>  Add dependency',
      '  /kanban task note <boardId> <taskId> <text>      Add task note',
      '',
      '  /kanban task check add <boardId> <taskId> <desc>  Add success check',
      '',
      '  /kanban column add <boardId> <title>    Add column',
      '  /kanban column rm <boardId> <colId>     Remove column',
      '',
      '  /kanban generate <description>     Auto-generate board from text',
      '  /kanban export <boardId>           Export board as markdown',
      '  /kanban deps <boardId> <taskId>    Show dependency chain',
    ].join('\n'),
    async run(args: string) {
      const showHelp = () => ({ message: buildKanbanCommand(opts).help ?? '' });

      if (!projectRoot) {
        return { message: color.red('No project root available. Open a project first.') };
      }

      const { cmd, rest } = parseSubcommand(args ?? '');
      const restJoined = rest.join(' ').trim();

      // ── No args — list boards ──────────────────────────────────────
      if (!cmd) {
        const boards = await listBoards(projectRoot);
        return { message: formatBoardList(boards) };
      }

      // ── open TUI panel ─────────────────────────────────────────────
      if (cmd === 'open' || cmd === 'panel' || cmd === 'tui') {
        const opened = opts.onPanelOpen.current?.('toggleKanbanPanel') ?? false;
        return {
          message: opened
            ? color.green('Kanban panel opened.')
            : color.yellow('Kanban panel is only available in the TUI.'),
        };
      }

      // ── create ─────────────────────────────────────────────────────
      if (cmd === 'create') {
        if (!restJoined) return { message: color.red('Usage: /kanban create <title>') };
        const board = await createBoard(projectRoot, { title: restJoined });
        return {
          message: `${color.green('✅ Board created:')} ${color.bold(board.title)}\n  ${color.dim(board.id)}`,
        };
      }

      // ── duplicate ─────────────────────────────────────────────────
      if (cmd === 'duplicate' || cmd === 'copy-board') {
        const boardId = rest[0];
        if (!boardId) return { message: color.red('Usage: /kanban duplicate <boardId> [title]') };
        const board = await duplicateBoard(projectRoot, boardId, {
          ...(rest.length > 1 ? { title: rest.slice(1).join(' ') } : {}),
        });
        if (!board) return { message: color.red(`Board not found: ${boardId}`) };
        return {
          message: `${color.green('✅ Board duplicated:')} ${color.bold(board.title)}\n  ${color.dim(board.id)}`,
        };
      }

      // ── show ───────────────────────────────────────────────────────
      if (cmd === 'show') {
        if (!rest[0]) return showHelp();
        const board = await getBoard(projectRoot, rest[0]!);
        if (!board) return { message: color.red(`Board not found: ${rest[0]}`) };
        return { message: formatBoardDetail(board) };
      }

      // ── delete ─────────────────────────────────────────────────────
      if (cmd === 'delete' || cmd === 'rm') {
        if (!rest[0]) return { message: color.red('Usage: /kanban delete <boardId>') };
        const removed = await removeBoard(projectRoot, rest[0]!);
        return {
          message: removed
            ? color.green(`✅ Board deleted: ${rest[0]}`)
            : color.red(`Board not found: ${rest[0]}`),
        };
      }

      // ── rename ──────────────────────────────────────────────────────
      if (cmd === 'rename') {
        if (rest.length < 2)
          return { message: color.red('Usage: /kanban rename <boardId> <title>') };
        const boardId = rest[0]!;
        const newTitle = rest.slice(1).join(' ');
        const updated = await updateBoardManager(projectRoot, boardId, { title: newTitle });
        if (!updated) return { message: color.red(`Board not found: ${boardId}`) };
        return { message: color.green(`✅ Board renamed to: ${newTitle}`) };
      }

      // ── generate ───────────────────────────────────────────────────
      if (cmd === 'generate') {
        if (!restJoined) return { message: color.red('Usage: /kanban generate <description>') };
        const genInput = generateBoardFromDescription({ description: restJoined });
        const board = await createBoard(projectRoot, genInput);
        const tasks = parseLinesIntoTasks(restJoined, board.columns[0]?.id ?? 'backlog');
        for (const taskInput of tasks) {
          await addTask(projectRoot, board.id, taskInput);
        }
        return {
          message: `${color.green('✅ Board generated:')} ${color.bold(board.title)}\n  ${color.dim(board.id)}\n  ${board.tasks.length + tasks.length} tasks created`,
        };
      }

      // ── export ─────────────────────────────────────────────────────
      if (cmd === 'export') {
        if (!rest[0]) return { message: color.red('Usage: /kanban export <boardId>') };
        const board = await getBoard(projectRoot, rest[0]!);
        if (!board) return { message: color.red(`Board not found: ${rest[0]}`) };
        return { message: exportBoardAsMarkdown(board) };
      }

      // ── deps / dependency chain ────────────────────────────────────
      if (cmd === 'deps' || cmd === 'dependencies') {
        if (rest.length < 2)
          return { message: color.red('Usage: /kanban deps <boardId> <taskId>') };
        const board = await getBoard(projectRoot, rest[0]!);
        if (!board) return { message: color.red(`Board not found: ${rest[0]}`) };
        return { message: formatDependencyChain(board, rest[1]!) };
      }

      // ── Subcommands: task / column ─────────────────────────────────
      if (cmd === 'task' || cmd === 't') {
        return handleTaskSubcommand(opts, projectRoot, rest, showHelp);
      }

      if (cmd === 'column' || cmd === 'col' || cmd === 'c') {
        return handleColumnSubcommand(projectRoot, rest, showHelp);
      }

      return {
        message: unknownSubcommand(
          cmd,
          [
            'open',
            'create',
            'duplicate',
            'show',
            'delete',
            'rename',
            'generate',
            'export',
            'deps',
            'task',
            'column',
          ],
          'kanban',
        ),
      };
    },
  };
}

// ── Task subcommand handler ─────────────────────────────────────────────

async function handleTaskSubcommand(
  opts: SlashCommandContext,
  projectRoot: string,
  args: string[],
  showHelp: () => { message: string },
) {
  const [sub, boardId, ...rest] = args;

  if (!sub || !boardId) {
    return showHelp();
  }

  // ── List tasks on a board ──────────────────────────────────────────
  if (sub === 'list' || sub === 'ls' || sub === '') {
    const board = await getBoard(projectRoot, boardId);
    if (!board) return { message: color.red(`Board not found: ${boardId}`) };
    return { message: formatBoardDetail(board) };
  }

  const board = await getBoard(projectRoot, boardId);
  if (!board) return { message: color.red(`Board not found: ${boardId}`) };

  // ── Show task details ──────────────────────────────────────────────
  if (sub === 'show') {
    const taskId = rest[0];
    if (!taskId) return { message: color.red('Usage: /kanban task show <boardId> <taskId>') };
    const task = await getTask(projectRoot, boardId, taskId);
    if (!task) return { message: color.red(`Task not found: ${taskId}`) };
    return { message: formatTaskDetail(board, task) };
  }

  // ── Add task ───────────────────────────────────────────────────────
  if (sub === 'add') {
    const title = rest.join(' ');
    if (!title) return { message: color.red('Usage: /kanban task add <boardId> <title>') };
    const result = await addTask(projectRoot, boardId, {
      title,
      columnId: board.columns[0]?.id ?? 'backlog',
    });
    if (!result) return { message: color.red('Failed to add task') };
    return {
      message: `${color.green('✅ Task added:')} ${color.bold(result.task.title)}\n  ${color.dim(result.task.id)}`,
    };
  }

  // ── Move task to column ───────────────────────────────────────────
  if (sub === 'move') {
    const taskId = rest[0];
    const columnId = rest[1];
    if (!taskId || !columnId) {
      return { message: color.red('Usage: /kanban task move <boardId> <taskId> <columnId>') };
    }
    const updated = await moveTask(projectRoot, boardId, taskId, columnId);
    if (!updated)
      return { message: color.red('Failed to move task. Check board/task/column IDs.') };
    return { message: color.green('✅ Task moved.') };
  }

  // ── Mark done ──────────────────────────────────────────────────────
  if (sub === 'done') {
    const taskId = rest[0];
    if (!taskId) return { message: color.red('Usage: /kanban task done <boardId> <taskId>') };
    const completedCol = board.columns.find((c) =>
      ['done', 'completed', 'finished'].includes(c.id),
    );
    const updated = await updateTask(projectRoot, boardId, taskId, {
      status: 'completed',
      ...(completedCol?.id ? { columnId: completedCol.id } : {}),
    });
    if (!updated) return { message: color.red('Task not found') };
    return { message: color.green('✅ Task marked completed.') };
  }

  // ── Mark blocked ──────────────────────────────────────────────────
  if (sub === 'block') {
    const taskId = rest[0];
    if (!taskId) return { message: color.red('Usage: /kanban task block <boardId> <taskId>') };
    const updated = await updateTask(projectRoot, boardId, taskId, { status: 'blocked' });
    if (!updated) return { message: color.red('Task not found') };
    return { message: color.yellow('🚫 Task marked blocked.') };
  }

  // ── Remove task ────────────────────────────────────────────────────
  if (sub === 'remove' || sub === 'rm' || sub === 'delete') {
    const taskId = rest[0];
    if (!taskId) return { message: color.red('Usage: /kanban task remove <boardId> <taskId>') };
    const updated = await removeTask(projectRoot, boardId, taskId);
    if (!updated) return { message: color.red('Task not found') };
    return { message: color.green('✅ Task removed.') };
  }

  // ── Copy/transfer task across kanban boards ───────────────────────
  if (sub === 'copy' || sub === 'transfer' || sub === 'move-board') {
    const taskId = rest[0];
    const targetBoardId = rest[1];
    const targetColumnId = rest[2];
    if (!taskId || !targetBoardId) {
      const action = sub === 'copy' ? 'copy' : 'transfer';
      return {
        message: color.red(
          `Usage: /kanban task ${action} <fromBoard> <taskId> <toBoard> [columnId]`,
        ),
      };
    }
    const result =
      sub === 'copy'
        ? await copyTaskToBoard(projectRoot, boardId, taskId, targetBoardId, {
            ...(targetColumnId ? { targetColumnId } : {}),
          })
        : await transferTaskToBoard(projectRoot, boardId, taskId, targetBoardId, {
            ...(targetColumnId ? { targetColumnId } : {}),
          });
    if (!result) return { message: color.red('Board or task not found') };
    return {
      message: color.green(
        `✅ Task ${sub === 'copy' ? 'copied' : 'transferred'} to ${result.targetBoard.title}: ${result.task.title}`,
      ),
    };
  }

  // ── Set priority ──────────────────────────────────────────────────
  if (sub === 'priority' || sub === 'prio') {
    const taskId = rest[0];
    const priority = rest[1];
    if (!taskId || !priority) {
      return {
        message: color.red(
          'Usage: /kanban task priority <boardId> <taskId> <critical|high|medium|low>',
        ),
      };
    }
    const valid = ['critical', 'high', 'medium', 'low'];
    if (!valid.includes(priority)) {
      return { message: color.red(`Invalid priority. Valid: ${valid.join(', ')}`) };
    }
    const updated = await updateTask(projectRoot, boardId, taskId, {
      priority: priority as KanbanTask['priority'],
    });
    if (!updated) return { message: color.red('Task not found') };
    return { message: color.green(`✅ Priority set to ${priority}.`) };
  }

  // ── Assign agent ──────────────────────────────────────────────────
  if (sub === 'assign' || sub === 'agent') {
    const taskId = rest[0];
    const parsed = parseKanbanAgentFlags(rest.slice(1));
    const agentId = parsed.target;
    if (!taskId || !agentId) {
      return {
        message: color.red(
          'Usage: /kanban task assign <boardId> <taskId> <agentId> [--provider=p --model=m --fallback=f]',
        ),
      };
    }
    const updated = await assignTask(projectRoot, boardId, taskId, {
      agentId,
      name: parsed.flags.name,
      role: parsed.flags.role,
      provider: parsed.flags.provider,
      model: parsed.flags.model,
      fallbackProfile: parsed.flags.fallbackProfile,
      fallbackModels: parsed.flags.fallbackModels,
      tools: parsed.flags.tools,
      allowedCapabilities: parsed.flags.allowedCapabilities,
    });
    if (!updated) return { message: color.red('Task not found') };
    return {
      message: color.green(
        `✅ Assigned to ${agentId}${parsed.flags.provider || parsed.flags.model ? ` (${[parsed.flags.provider, parsed.flags.model].filter(Boolean).join(' / ')})` : ''}.`,
      ),
    };
  }

  // ── Dispatch task to an agent ─────────────────────────────────────
  if (sub === 'dispatch' || sub === 'run') {
    const taskId = rest[0];
    if (!taskId) {
      return {
        message: color.red(
          'Usage: /kanban task dispatch <boardId> <taskId> [--provider=p --model=m --name=n]',
        ),
      };
    }
    if (!opts.onSpawn) return { message: color.red('Multi-agent is not enabled in this session.') };
    const parsed = parseKanbanAgentFlags(rest.slice(1));
    const task = await getTask(projectRoot, boardId, taskId);
    if (!task) return { message: color.red('Task not found') };
    const freshBoard = await getBoard(projectRoot, boardId);
    if (!freshBoard) return { message: color.red(`Board not found: ${boardId}`) };
    const assignment = {
      agentId: parsed.target ?? task.assignment?.agentId ?? task.assignedAgent,
      name: parsed.flags.name ?? task.assignment?.name ?? task.assignedAgent,
      role: parsed.flags.role ?? task.assignment?.role,
      provider: parsed.flags.provider ?? task.assignment?.provider,
      model: parsed.flags.model ?? task.assignment?.model,
      fallbackProfile: parsed.flags.fallbackProfile ?? task.assignment?.fallbackProfile,
      fallbackModels: parsed.flags.fallbackModels ?? task.assignment?.fallbackModels,
      tools: parsed.flags.tools ?? task.assignment?.tools,
      allowedCapabilities: parsed.flags.allowedCapabilities ?? task.assignment?.allowedCapabilities,
      status: 'queued' as const,
      dispatchedAt: new Date().toISOString(),
    };
    await assignTask(projectRoot, boardId, taskId, assignment);
    try {
      const prompt = buildKanbanAgentPrompt(freshBoard, task, assignment);
      const summary = await opts.onSpawn(prompt, {
        ...(assignment.provider ? { provider: assignment.provider } : {}),
        ...(assignment.model ? { model: assignment.model } : {}),
        ...(assignment.fallbackModels ? { fallbackModels: assignment.fallbackModels } : {}),
        ...(assignment.tools ? { tools: assignment.tools } : {}),
        ...(assignment.name ? { name: assignment.name } : {}),
        ...(assignment.allowedCapabilities
          ? { allowedCapabilities: assignment.allowedCapabilities }
          : {}),
      });
      const subagentId = extractSpawnedSubagentId(summary);
      await updateTaskAssignment(projectRoot, boardId, taskId, {
        ...assignment,
        status: 'running',
        ...(subagentId ? { subagentId } : {}),
        lastResult: summary,
      });
      return { message: `${color.green('✅ Kanban task dispatched.')}\n${summary}` };
    } catch (err) {
      await updateTaskAssignment(projectRoot, boardId, taskId, {
        ...assignment,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        message: color.red(`Dispatch failed: ${err instanceof Error ? err.message : String(err)}`),
      };
    }
  }

  // ── Add dependency ────────────────────────────────────────────────
  if (sub === 'depend' || sub === 'dep') {
    const taskId = rest[0];
    const depId = rest[1];
    if (!taskId || !depId) {
      return { message: color.red('Usage: /kanban task depend <boardId> <taskId> <depTaskId>') };
    }
    const task = await getTask(projectRoot, boardId, taskId);
    if (!task) return { message: color.red('Task not found') };
    const updated = await addDependency(projectRoot, boardId, taskId, depId);
    if (!updated) return { message: color.red('Failed to add dependency') };
    return { message: color.green(`✅ Dependency added: ${task.title} → ${depId}`) };
  }

  // ── Note ──────────────────────────────────────────────────────────
  if (sub === 'note') {
    const taskId = rest[0];
    const content = rest.slice(1).join(' ');
    if (!taskId || !content) {
      return { message: color.red('Usage: /kanban task note <boardId> <taskId> <text>') };
    }
    const updated = await addNoteToTask(projectRoot, boardId, taskId, {
      author: 'user',
      content,
    });
    if (!updated) return { message: color.red('Task not found') };
    return { message: color.green('✅ Note added.') };
  }

  // ── Check (success criteria) ──────────────────────────────────────
  if (sub === 'check') {
    const checkSub = rest[0];
    const taskId = rest[1];
    if (checkSub === 'add' && taskId && rest.slice(2).join(' ')) {
      const desc = rest.slice(2).join(' ');
      const updated = await addCheckToTask(projectRoot, boardId, taskId, {
        description: desc,
        type: 'manual',
      });
      if (!updated) return { message: color.red('Task not found') };
      return { message: color.green(`✅ Check added to task: ${desc}`) };
    }
    return { message: color.red('Usage: /kanban task check add <boardId> <taskId> <description>') };
  }

  return showHelp();
}

// ── Column subcommand handler ───────────────────────────────────────────

async function handleColumnSubcommand(
  projectRoot: string,
  args: string[],
  showHelp: () => { message: string },
) {
  const [sub, boardId, ...rest] = args;

  if (!sub || !boardId) return showHelp();

  // ── Add column ──────────────────────────────────────────────────────
  if (sub === 'add') {
    const title = rest.join(' ');
    if (!title) return { message: color.red('Usage: /kanban column add <boardId> <title>') };
    const result = await addColumn(projectRoot, boardId, { title });
    if (!result) return { message: color.red(`Board not found: ${boardId}`) };
    return { message: color.green(`✅ Column added: ${result.column.title}`) };
  }

  // ── Remove column ───────────────────────────────────────────────────
  if (sub === 'rm' || sub === 'remove' || sub === 'delete') {
    const colId = rest[0];
    if (!colId) return { message: color.red('Usage: /kanban column rm <boardId> <columnId>') };
    const updated = await removeColumn(projectRoot, boardId, colId, {
      moveTasksToColumnId: rest[1],
    });
    if (!updated) return { message: color.red(`Column not found: ${colId}`) };
    return { message: color.green(`✅ Column removed: ${colId}`) };
  }

  return showHelp();
}

// ── Agent dispatch helpers ──────────────────────────────────────────────

interface KanbanAgentFlags {
  provider?: string | undefined;
  model?: string | undefined;
  name?: string | undefined;
  role?: string | undefined;
  fallbackProfile?: string | undefined;
  fallbackModels?: string[] | undefined;
  tools?: string[] | undefined;
  allowedCapabilities?: string[] | undefined;
}

function parseKanbanAgentFlags(args: string[]): {
  target?: string | undefined;
  flags: KanbanAgentFlags;
} {
  const flags: KanbanAgentFlags = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    const readValue = (prefix: string): string | undefined => {
      if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1);
      const next = args[i + 1];
      if (arg === prefix && next && !next.startsWith('--')) {
        i += 1;
        return next;
      }
      return undefined;
    };
    const provider = readValue('--provider') ?? readValue('-p');
    if (provider) flags.provider = provider;
    else {
      const model = readValue('--model') ?? readValue('-m');
      if (model) flags.model = model;
      else {
        const name = readValue('--name') ?? readValue('-n');
        if (name) flags.name = stripQuotes(name);
        else {
          const role = readValue('--role');
          if (role) flags.role = role;
          else {
            const fallback = readValue('--fallback') ?? readValue('--fallback-profile');
            if (fallback) flags.fallbackProfile = fallback;
            else {
              const fallbackModels = readValue('--fallback-models');
              if (fallbackModels) flags.fallbackModels = splitCsv(fallbackModels);
              else {
                const tools = readValue('--tools');
                if (tools) flags.tools = splitCsv(tools);
                else {
                  const caps = readValue('--capabilities') ?? readValue('--caps');
                  if (caps) flags.allowedCapabilities = splitCsv(caps);
                  else if (!arg.startsWith('--')) positional.push(arg);
                }
              }
            }
          }
        }
      }
    }
  }
  return { target: positional[0], flags };
}

function buildKanbanAgentPrompt(
  board: KanbanBoard,
  task: KanbanTask,
  assignment: KanbanTask['assignment'],
): string {
  const dependencyLines = (task.dependsOn ?? [])
    .map((depId) => board.tasks.find((candidate) => candidate.id === depId))
    .filter((dep): dep is KanbanTask => Boolean(dep))
    .map((dep) => `- ${dep.title} [${dep.status}] (${dep.id})`);
  const checks = task.successCriteria?.map((check) => `- ${check.description}`).join('\n');
  const routing = [
    assignment?.role ? `role: ${assignment.role}` : '',
    assignment?.provider ? `provider: ${assignment.provider}` : '',
    assignment?.model ? `model: ${assignment.model}` : '',
    assignment?.fallbackProfile ? `fallbackProfile: ${assignment.fallbackProfile}` : '',
    assignment?.fallbackModels?.length
      ? `fallbackModels: ${assignment.fallbackModels.join(', ')}`
      : '',
  ].filter(Boolean);
  return [
    `You are processing a WrongStack kanban task.`,
    '',
    `Board: ${board.title} (${board.id})`,
    `Task: ${task.title} (${task.id})`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
    task.description ? `Description:\n${task.description}` : '',
    routing.length ? `Routing hints:\n${routing.join('\n')}` : '',
    dependencyLines.length ? `Dependencies:\n${dependencyLines.join('\n')}` : '',
    checks ? `Success criteria:\n${checks}` : '',
    task.labels?.length ? `Labels: ${task.labels.join(', ')}` : '',
    '',
    'Work the task end-to-end. Use the kanban tool, not direct file edits, to update this task.',
    `When you start or finish, call kanban with action "mark_assignment", boardId "${board.id}", taskId "${task.id}", and assignmentStatus "running", "completed", or "failed". Include lastResult or error when you finish.`,
    'When finished, report what changed, what you verified, and any remaining blockers.',
  ]
    .filter(Boolean)
    .join('\n');
}

function extractSpawnedSubagentId(summary: string): string | undefined {
  return summary.match(/Spawned subagent\s+([^\s]+)/)?.[1];
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, '');
}
