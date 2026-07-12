import { describe, expect, it } from 'vitest';
import {
  browserEvaluateTool,
  browserOpenTool,
  browserSnapshotTool,
  browserTools,
  browserTypeTool,
  browserUploadTool,
} from '../src/browser/tools.js';

describe('first-party browser tool contract', () => {
  it('registers unique browser-prefixed tools with normal capability metadata', () => {
    const names = browserTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'browser_open',
        'browser_status',
        'browser_navigate',
        'browser_snapshot',
        'browser_screenshot',
        'browser_click',
        'browser_type',
        'browser_select',
        'browser_press',
        'browser_hover',
        'browser_drag',
        'browser_wait',
        'browser_upload',
        'browser_evaluate',
        'browser_close',
      ]),
    );
    expect(
      browserTools
        .filter((tool) => tool.name !== 'browser_status')
        .every((tool) => tool.capabilities?.includes('net.outbound')),
    ).toBe(true);
  });

  it('keeps observation automatic while navigation, evaluation, and upload require confirmation', () => {
    expect(browserSnapshotTool.permission).toBe('auto');
    expect(browserOpenTool.permission).toBe('confirm');
    expect(browserEvaluateTool.permission).toBe('confirm');
    expect(browserEvaluateTool.riskTier).toBe('destructive');
    expect(browserUploadTool.permission).toBe('confirm');
    expect(browserUploadTool.capabilities).toContain('fs.read');
    expect(browserTypeTool.validate?.({ sessionId: 's', selector: '#p' })).toEqual([
      'exactly one of text or secretEnv is required',
    ]);
    expect(
      browserTypeTool.validate?.({
        sessionId: 's',
        selector: '#p',
        secretEnv: 'TEST_PASSWORD',
      }),
    ).toEqual([]);
  });
});
