import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWrite, ulid } from '@wrongstack/core/utils';
import type { BrowserArtifact, BrowserArtifactKind } from './types.js';

export class BrowserArtifactStore {
  constructor(private readonly root: string) {}

  async write(
    sessionId: string,
    kind: BrowserArtifactKind,
    extension: string,
    mimeType: string,
    content: Uint8Array,
  ): Promise<BrowserArtifact> {
    const id = ulid();
    const dir = path.join(this.root, safeSegment(sessionId));
    const target = path.join(dir, `${id}.${extension.replace(/^\./, '')}`);
    await atomicWrite(target, content, { mode: 0o600 });
    const stat = await fs.stat(target);
    return {
      id,
      kind,
      path: target,
      mimeType,
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
    };
  }

  pathFor(sessionId: string, extension: string): { id: string; path: string } {
    const id = ulid();
    return {
      id,
      path: path.join(this.root, safeSegment(sessionId), `${id}.${extension.replace(/^\./, '')}`),
    };
  }

  async describe(
    id: string,
    kind: BrowserArtifactKind,
    target: string,
    mimeType: string,
  ): Promise<BrowserArtifact> {
    await fs.chmod(target, 0o600).catch(() => undefined);
    const stat = await fs.stat(target);
    return {
      id,
      kind,
      path: target,
      mimeType,
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
    };
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}
