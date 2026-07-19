import { beforeEach, describe, expect, it, vi } from 'vitest';
import processGuardPlugin from '../src/process-guard/index.js';

interface MockApi {
  tools: { register: ReturnType<typeof vi.fn> };
  config: { extensions: Record<string, unknown> };
  log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  metrics: { counter: ReturnType<typeof vi.fn> };
  registerHook: ReturnType<typeof vi.fn>;
}

function makeApi(): MockApi {
  return {
    tools: { register: vi.fn() },
    config: { extensions: {} },
    log: { info: vi.fn(), warn: vi.fn() },
    metrics: { counter: vi.fn() },
    registerHook: vi.fn(() => vi.fn()),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('process-guard telemetry', () => {
  it('reports pre-execution matches as detections, not blocks', async () => {
    const api = makeApi();
    processGuardPlugin.setup(api as never);

    const hook = api.registerHook.mock.calls[0]?.[2] as ((input: unknown) => void) | undefined;
    expect(hook).toBeTypeOf('function');
    hook?.({ toolName: 'exec', toolInput: { command: 'taskkill' } });

    const tool = api.tools.register.mock.calls.find(
      ([definition]: unknown[]) => (definition as { name: string }).name === 'process_guard_status',
    )?.[0] as { execute: () => Promise<Record<string, unknown>> } | undefined;
    expect(tool).toBeDefined();

    const status = await tool!.execute();
    expect(status).toMatchObject({
      counters: { invocations: 1, detections: 1, warns: 0 },
      lastDetection: { tool: 'exec', target: 'taskkill' },
    });
    expect((status.counters as Record<string, unknown>)['blocks']).toBeUndefined();
    expect(api.metrics.counter).toHaveBeenCalledWith('detections');
  });
});
