import { describe, it, expect } from 'vitest';
import {
  Container,
  EventBus,
  ToolRegistry,
  ProviderRegistry,
  DefaultLogger,
  type Config,
} from '@wrongstack/core';
import createApi from '../src/plugin-api-factory.js';

describe('plugin-api-factory', () => {
  it('wires DefaultPluginAPI with ownerName', () => {
    const api = createApi('my-plugin', {
      container: new Container(),
      events: new EventBus(),
      pipelines: {} as never,
      toolRegistry: new ToolRegistry(),
      providerRegistry: new ProviderRegistry(),
      config: { providers: {}, log: { level: 'error' } } as unknown as Config,
      log: new DefaultLogger({ level: 'error' }),
    });
    expect(api).toBeDefined();
    expect(api.tools).toBeDefined();
    expect(api.providers).toBeDefined();
    expect(api.mcp).toBeDefined();
    expect(typeof api.tools.register).toBe('function');
  });
});
