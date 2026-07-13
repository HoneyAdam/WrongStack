import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
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
    return this.record(id, sessionId, kind, target, mimeType);
  }

  private async record(
    id: string,
    sessionId: string,
    kind: BrowserArtifactKind,
    target: string,
    mimeType: string,
  ): Promise<BrowserArtifact> {
    await fs.chmod(target, 0o600).catch(() => undefined);
    const [stat, sha256] = await Promise.all([fs.stat(target), hashFile(target)]);
    const artifact: BrowserArtifact = {
      id,
      kind,
      sensitivity: 'sensitive',
      path: target,
      mimeType,
      sizeBytes: stat.size,
      sha256,
      createdAt: new Date().toISOString(),
    };
    const metadataPath = path.join(path.dirname(target), `${id}.metadata.json`);
    try {
      await atomicWrite(
        metadataPath,
        `${JSON.stringify({
          id: artifact.id,
          sessionId: safeSegment(sessionId),
          kind: artifact.kind,
          sensitivity: artifact.sensitivity,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
          createdAt: artifact.createdAt,
        })}\n`,
        { mode: 0o600 },
      );
    } catch (error) {
      await fs.rm(target, { force: true }).catch(() => undefined);
      throw error;
    }
    return artifact;
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
    return this.record(id, path.basename(path.dirname(target)), kind, target, mimeType);
  }
}

async function hashFile(target: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(target);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}
