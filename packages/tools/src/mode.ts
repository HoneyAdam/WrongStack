import type { ModeStore, Tool } from '@wrongstack/core';

interface ModeInput {
  action: 'get' | 'list' | 'set' | 'clear';
  mode?: string;
}

interface ModeOutput {
  action: string;
  currentMode?: string;
  modes?: { id: string; name: string; description: string }[];
  success: boolean;
  message: string;
}

export function createModeTool(modeStore: ModeStore): Tool<ModeInput, ModeOutput> {
  return {
    name: 'mode',
    category: 'Session',
    description:
      'Get, list, or switch the agent mode. Modes inject role-specific prompts into the system prompt.',
    usageHint:
      'Set `action`: `get` (current mode), `list` (all modes), `set <modeId>` (switch), `clear` (reset to default).',
    permission: 'confirm',
    mutating: true,
    timeoutMs: 5_000,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'list', 'set', 'clear'],
          description: 'Action: get current, list all, set mode, or clear',
        },
        mode: {
          type: 'string',
          description: 'Mode ID to switch to (required for action=set)',
        },
      },
      required: ['action'],
    },
    async execute(input) {
      switch (input.action) {
        case 'get': {
          const mode = await modeStore.getActiveMode();
          return {
            action: 'get',
            currentMode: mode?.id,
            success: true,
            message: mode
              ? `Current mode: ${mode.name} — ${mode.description}`
              : 'No mode set (using default)',
          };
        }
        case 'list': {
          const modes = await modeStore.listModes();
          const lines = modes
            .map((m) => `  ${m.id.padEnd(20)} ${m.name} — ${m.description}`)
            .join('\n');
          return {
            action: 'list',
            modes: modes.map((m) => ({ id: m.id, name: m.name, description: m.description })),
            success: true,
            message: lines,
          };
        }
        case 'set': {
          if (!input.mode) {
            return { action: 'set', success: false, message: 'mode is required for action=set' };
          }
          const mode = await modeStore.getMode(input.mode);
          if (!mode) {
            return { action: 'set', success: false, message: `Mode "${input.mode}" not found` };
          }
          await modeStore.setActiveMode(input.mode);
          return {
            action: 'set',
            currentMode: mode.id,
            success: true,
            message: `Switched to mode: ${mode.name}\n\n${mode.description}`,
          };
        }
        case 'clear': {
          await modeStore.setActiveMode(null);
          return {
            action: 'clear',
            success: true,
            message: 'Mode cleared — using default mode',
          };
        }
        default:
          return {
            action: input.action,
            success: false,
            message: `Unknown action "${input.action}"`,
          };
      }
    },
  };
}
