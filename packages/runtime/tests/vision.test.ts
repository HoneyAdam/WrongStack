import { ToolRegistry, type Context, type Tool } from '@wrongstack/core';
import { describe, expect, it } from 'vitest';
import {
  ImageInputUnsupportedError,
  createToolVisionAdapters,
  routeImagesForModel,
} from '../src/vision.js';

const image = {
  type: 'image' as const,
  source: { type: 'base64' as const, media_type: 'image/png', data: 'AAAA' },
};

const ctx = {} as Context;

describe('vision routing', () => {
  it('keeps image blocks intact when the model supports native vision', async () => {
    const result = await routeImagesForModel([{ type: 'text', text: 'look' }, image], {
      supportsVision: true,
      ctx,
      signal: new AbortController().signal,
    });

    expect(result.route).toBe('native');
    expect(result.blocks[1]).toBe(image);
  });

  it('throws a clear error when images have no native or adapter route', async () => {
    await expect(
      routeImagesForModel([image], {
        supportsVision: false,
        ctx,
        signal: new AbortController().signal,
        providerId: 'zai',
        model: 'text-only',
      }),
    ).rejects.toBeInstanceOf(ImageInputUnsupportedError);
  });

  it('converts images through a vision adapter for text-only models', async () => {
    const result = await routeImagesForModel([{ type: 'text', text: 'what?' }, image], {
      supportsVision: false,
      ctx,
      signal: new AbortController().signal,
      adapters: [
        {
          name: 'test-vision',
          async describe() {
            return 'A screenshot with an error dialog.';
          },
        },
      ],
    });

    expect(result.route).toBe('adapter');
    expect(result.blocks).toEqual([
      { type: 'text', text: 'what?' },
      {
        type: 'text',
        text: '[Image 1 analyzed via test-vision]\nA screenshot with an error dialog.',
      },
    ]);
  });

  it('resolves adapter providers at routing time', async () => {
    let calls = 0;
    const result = await routeImagesForModel([image], {
      supportsVision: false,
      ctx,
      signal: new AbortController().signal,
      adapters: () => {
        calls++;
        return [
          {
            name: 'late-vision',
            async describe() {
              return 'late MCP tool saw the image';
            },
          },
        ];
      },
    });

    expect(calls).toBe(1);
    expect(result.adapterName).toBe('late-vision');
    expect(result.blocks).toEqual([
      {
        type: 'text',
        text: '[Image 1 analyzed via late-vision]\nlate MCP tool saw the image',
      },
    ]);
  });

  it('discovers safe auto image-understanding tools as adapters', async () => {
    const registry = new ToolRegistry();
    const tool: Tool<Record<string, unknown>, string> = {
      name: 'mcp__vision__describe_image',
      description: 'Analyze an image and return a textual description.',
      inputSchema: {
        type: 'object',
        properties: {
          image: { type: 'object' },
          prompt: { type: 'string' },
        },
      },
      permission: 'auto',
      mutating: false,
      async execute(input) {
        expect(input).toMatchObject({
          image: { type: 'base64', data: 'AAAA' },
        });
        return 'visible UI';
      },
    };
    registry.register(tool);

    const adapters = createToolVisionAdapters(registry);
    expect(adapters.map((a) => a.name)).toEqual(['mcp__vision__describe_image']);
    await expect(
      adapters[0]!.describe({ image, ctx, signal: new AbortController().signal }),
    ).resolves.toBe('visible UI');
  });

  it('re-resolves adapter tools from the registry before execution', async () => {
    const registry = new ToolRegistry();
    const original: Tool<Record<string, unknown>, string> = {
      name: 'mcp__vision__describe_image',
      description: 'Analyze an image and return a textual description.',
      inputSchema: { type: 'object', properties: { image: { type: 'object' } } },
      permission: 'auto',
      mutating: false,
      async execute() {
        return 'stale tool';
      },
    };
    const fresh: Tool<Record<string, unknown>, string> = {
      ...original,
      async execute() {
        return 'fresh tool';
      },
    };
    registry.register(original);
    const adapters = createToolVisionAdapters(registry);
    registry.unregister(original.name);
    registry.register(fresh);

    await expect(
      adapters[0]!.describe({ image, ctx, signal: new AbortController().signal }),
    ).resolves.toBe('fresh tool');
  });

  it('supports path-based MCP vision tools by writing a temporary image file', async () => {
    const registry = new ToolRegistry();
    const tool: Tool<Record<string, unknown>, string> = {
      name: 'mcp__zai_mcp_server__image_analysis',
      description: 'General-purpose image understanding.',
      inputSchema: {
        type: 'object',
        properties: {
          image_path: { type: 'string' },
          prompt: { type: 'string' },
        },
      },
      permission: 'auto',
      mutating: false,
      async execute(input) {
        expect(typeof input.image_path).toBe('string');
        expect(String(input.image_path)).toMatch(/wstack-vision-/);
        return 'zai saw a screenshot';
      },
    };
    registry.register(tool);

    const adapters = createToolVisionAdapters(registry);
    await expect(
      adapters[0]!.describe({ image, ctx, signal: new AbortController().signal }),
    ).resolves.toBe('zai saw a screenshot');
  });

  it('routes a base64 image through a `base64` schema property', async () => {
    const registry = new ToolRegistry();
    let receivedBase64 = '';
    const tool: Tool<Record<string, unknown>, string> = {
      name: 'mcp__vision__describe_b64',
      description: 'Analyze an image (base64 input).',
      inputSchema: {
        type: 'object',
        properties: { base64: { type: 'string' }, prompt: { type: 'string' } },
      },
      permission: 'auto',
      mutating: false,
      async execute(input) {
        receivedBase64 = String(input.base64);
        return 'b64-described';
      },
    };
    registry.register(tool);
    const adapters = createToolVisionAdapters(registry);
    await expect(
      adapters[0]!.describe({ image, ctx, signal: new AbortController().signal }),
    ).resolves.toBe('b64-described');
    expect(receivedBase64).toBe('AAAA');
  });

  it('routes a base64 image through a `data` schema property', async () => {
    const registry = new ToolRegistry();
    let received = '';
    const tool: Tool<Record<string, unknown>, string> = {
      name: 'mcp__vision__analyse_data',
      description: 'Analyze an image (data input).',
      inputSchema: {
        type: 'object',
        properties: { data: { type: 'string' }, mediaType: { type: 'string' } },
      },
      permission: 'auto',
      mutating: false,
      async execute(input) {
        received = String(input.data);
        expect(input.mediaType).toBe('image/png');
        return 'data-described';
      },
    };
    registry.register(tool);
    const adapters = createToolVisionAdapters(registry);
    await expect(
      adapters[0]!.describe({ image, ctx, signal: new AbortController().signal }),
    ).resolves.toBe('data-described');
    expect(received).toBe('AAAA');
  });

  it('routes a URL image through a `url` schema property', async () => {
    const registry = new ToolRegistry();
    const urlImage = {
      type: 'image' as const,
      source: { type: 'url' as const, url: 'https://example.com/a.png', media_type: 'image/png' },
    };
    let receivedUrl = '';
    const tool: Tool<Record<string, unknown>, string> = {
      name: 'mcp__vision__analyse_url',
      description: 'Analyze an image (url input).',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' } },
      },
      permission: 'auto',
      mutating: false,
      async execute(input) {
        receivedUrl = String(input.url);
        return 'url-described';
      },
    };
    registry.register(tool);
    const adapters = createToolVisionAdapters(registry);
    await expect(
      adapters[0]!.describe({ image: urlImage, ctx, signal: new AbortController().signal }),
    ).resolves.toBe('url-described');
    expect(receivedUrl).toBe('https://example.com/a.png');
  });

  it('routes a URL image through `imageUrl` (camelCase variant)', async () => {
    const registry = new ToolRegistry();
    const urlImage = {
      type: 'image' as const,
      source: { type: 'url' as const, url: 'https://example.com/img.png', media_type: 'image/png' },
    };
    let receivedUrl = '';
    const tool: Tool<Record<string, unknown>, string> = {
      name: 'mcp__vision__analyse_imageurl',
      description: 'Analyze an image (imageUrl input).',
      inputSchema: {
        type: 'object',
        properties: { imageUrl: { type: 'string' } },
      },
      permission: 'auto',
      mutating: false,
      async execute(input) {
        receivedUrl = String(input.imageUrl);
        return 'imageUrl-described';
      },
    };
    registry.register(tool);
    const adapters = createToolVisionAdapters(registry);
    await expect(
      adapters[0]!.describe({ image: urlImage, ctx, signal: new AbortController().signal }),
    ).resolves.toBe('imageUrl-described');
    expect(receivedUrl).toBe('https://example.com/img.png');
  });

  it('passes mediaType / mimeType / media_type when the tool schema declares them', async () => {
    const registry = new ToolRegistry();
    let captured: Record<string, unknown> = {};
    const tool: Tool<Record<string, unknown>, string> = {
      name: 'mcp__vision__media_type',
      description: 'Analyze an image with media type metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          image: { type: 'object' },
          mediaType: { type: 'string' },
          mimeType: { type: 'string' },
          media_type: { type: 'string' },
        },
      },
      permission: 'auto',
      mutating: false,
      async execute(input) {
        captured = input;
        return 'mt';
      },
    };
    registry.register(tool);
    const adapters = createToolVisionAdapters(registry);
    await adapters[0]!.describe({ image, ctx, signal: new AbortController().signal });
    expect(captured.mediaType).toBe('image/png');
    expect(captured.mimeType).toBe('image/png');
    expect(captured.media_type).toBe('image/png');
  });

  it('passes the prompt under `query` and `instruction` aliases', async () => {
    const registry = new ToolRegistry();
    const captured: Record<string, unknown> = {};
    const tool: Tool<Record<string, unknown>, string> = {
      name: 'mcp__vision__describe_query',
      description: 'Analyze an image (query-aliased prompt).',
      inputSchema: {
        type: 'object',
        properties: {
          image: { type: 'object' },
          query: { type: 'string' },
          instruction: { type: 'string' },
        },
      },
      permission: 'auto',
      mutating: false,
      async execute(input) {
        captured.query = input.query;
        captured.instruction = input.instruction;
        return 'aliased';
      },
    };
    registry.register(tool);
    const adapters = createToolVisionAdapters(registry);
    await adapters[0]!.describe({ image, ctx, prompt: 'OCR the image', signal: new AbortController().signal });
    expect(captured.query).toBe('OCR the image');
    expect(captured.instruction).toBe('OCR the image');
  });

  it('handles tool results returned as an array of {text} blocks', async () => {
    const registry = new ToolRegistry();
    const tool: Tool<Record<string, unknown>, unknown> = {
      name: 'mcp__vision__describe_arr',
      description: 'Analyze an image and return blocks.',
      inputSchema: { type: 'object', properties: { image: { type: 'object' } } },
      permission: 'auto',
      mutating: false,
      async execute() {
        return [
          { text: 'line1' },
          'line2',
          { other: 'ignored' },
        ] as never;
      },
    };
    registry.register(tool);
    const adapters = createToolVisionAdapters(registry);
    const out = await adapters[0]!.describe({ image, ctx, signal: new AbortController().signal });
    expect(out).toContain('line1');
    expect(out).toContain('line2');
  });

  it('handles tool results returned as a {text: ...} object', async () => {
    const registry = new ToolRegistry();
    const tool: Tool<Record<string, unknown>, unknown> = {
      name: 'mcp__vision__describe_obj',
      description: 'Analyze image, returns object with text.',
      inputSchema: { type: 'object', properties: { image: { type: 'object' } } },
      permission: 'auto',
      mutating: false,
      async execute() {
        return { text: 'object-text' } as never;
      },
    };
    registry.register(tool);
    const adapters = createToolVisionAdapters(registry);
    const out = await adapters[0]!.describe({ image, ctx, signal: new AbortController().signal });
    expect(out).toBe('object-text');
  });

  it('supports MiniMax-style understand_image tools that accept image_url paths', async () => {
    const registry = new ToolRegistry();
    const tool: Tool<Record<string, unknown>, string> = {
      name: 'mcp__MiniMax__understand_image',
      description: 'Analyze and understand image content with AI vision capabilities.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          image_url: { type: 'string' },
        },
      },
      permission: 'auto',
      mutating: false,
      async execute(input) {
        expect(typeof input.image_url).toBe('string');
        expect(String(input.image_url)).toMatch(/wstack-vision-/);
        expect(input.prompt).toContain('Describe this image');
        return 'minimax saw the UI';
      },
    };
    registry.register(tool);

    const adapters = createToolVisionAdapters(registry);
    expect(adapters.map((a) => a.name)).toEqual(['mcp__MiniMax__understand_image']);
    await expect(
      adapters[0]!.describe({ image, ctx, signal: new AbortController().signal }),
    ).resolves.toBe('minimax saw the UI');
  });

  it('routes a URL image through `image_url` (snake_case variant)', async () => {
    const registry = new ToolRegistry();
    const urlImage = {
      type: 'image' as const,
      source: { type: 'url' as const, url: 'https://example.com/snake.png', media_type: 'image/png' },
    };
    let received = '';
    const tool: Tool<Record<string, unknown>, string> = {
      name: 'mcp__vision__url_snake',
      description: 'Analyze an image (image_url input).',
      inputSchema: {
        type: 'object',
        properties: { image_url: { type: 'string' } },
      },
      permission: 'auto',
      mutating: false,
      async execute(input) {
        received = String(input.image_url);
        return 'snake-described';
      },
    };
    registry.register(tool);
    const adapters = createToolVisionAdapters(registry);
    await expect(
      adapters[0]!.describe({ image: urlImage, ctx, signal: new AbortController().signal }),
    ).resolves.toBe('snake-described');
    expect(received).toBe('https://example.com/snake.png');
  });

  it('rejects schema that has no recognized image input property', async () => {
    // A tool whose schema lacks every recognized image property —
    // buildToolPayload returns null, describe() throws.
    const registry = new ToolRegistry();
    const tool: Tool<Record<string, unknown>, string> = {
      name: 'mcp__vision__describe_no_input',
      description: 'Analyze an image with no input slot.',
      inputSchema: {
        type: 'object',
        // No image / base64 / data / url / image_url / imageUrl / image_path
        properties: { only_prompt: { type: 'string' } },
      },
      permission: 'auto',
      mutating: false,
      async execute() {
        return 'should-never-be-called';
      },
    };
    registry.register(tool);
    const adapters = createToolVisionAdapters(registry);
    // No adapter is even built since schema is unsupported.
    expect(adapters).toHaveLength(0);
  });

  it('stringifies a non-string non-array non-text tool result via JSON.stringify', async () => {
    const registry = new ToolRegistry();
    const tool: Tool<Record<string, unknown>, unknown> = {
      name: 'mcp__vision__describe_json',
      description: 'Analyze image, returns arbitrary object.',
      inputSchema: { type: 'object', properties: { image: { type: 'object' } } },
      permission: 'auto',
      mutating: false,
      async execute() {
        // Object without a `text` property — should fall through to JSON.stringify
        return { score: 42, label: 'cat' } as never;
      },
    };
    registry.register(tool);
    const adapters = createToolVisionAdapters(registry);
    const out = await adapters[0]!.describe({ image, ctx, signal: new AbortController().signal });
    expect(out).toBe(JSON.stringify({ score: 42, label: 'cat' }));
  });
});
