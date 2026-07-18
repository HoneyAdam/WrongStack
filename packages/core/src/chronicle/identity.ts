import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ChronicleRuntimeIdentityInput {
  globalRoot: string;
  projectId: string;
  projectDir: string;
  now?: Date | undefined;
}

export interface ChronicleRuntimeLocation {
  installationId: string;
  machineId: string;
  projectId: string;
  journalPath: string;
}

/**
 * Resolve privacy-preserving stable IDs and a UTC daily project partition.
 * Raw host names and global paths never enter the journal envelope.
 */
export function resolveChronicleRuntimeLocation(
  input: ChronicleRuntimeIdentityInput,
): ChronicleRuntimeLocation {
  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  return {
    installationId: stableId('installation', path.resolve(input.globalRoot)),
    machineId: stableId('machine', `${os.hostname()}\0${os.platform()}\0${os.arch()}`),
    projectId: input.projectId,
    journalPath: path.join(input.projectDir, 'chronicle', `${day}.events.jsonl`),
  };
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}
