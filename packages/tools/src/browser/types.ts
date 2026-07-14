export type BrowserArtifactKind = 'screenshot' | 'trace';

export interface BrowserArtifact {
  id: string;
  kind: BrowserArtifactKind;
  /** Browser evidence can contain page content, tokens, or user data. */
  sensitivity: 'sensitive';
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface BrowserConsoleEntry {
  level: string;
  text: string;
  at: string;
}

export interface BrowserNetworkEntry {
  method: string;
  url: string;
  status?: number | undefined;
  failed?: boolean | undefined;
  at: string;
}

export interface BrowserSessionSummary {
  id: string;
  ownerId: string;
  url: string;
  title: string;
  createdAt: string;
  lastUsedAt: string;
  tracing: boolean;
}

export interface BrowserSnapshot {
  session: BrowserSessionSummary;
  aria: string;
  console: BrowserConsoleEntry[];
  network: BrowserNetworkEntry[];
  truncated: boolean;
}

export interface BrowserOpenOptions {
  url?: string | undefined;
  viewport?: { width: number; height: number } | undefined;
  trace?: boolean | undefined;
}

export interface BrowserManagerOptions {
  artifactRoot: string;
  /** Allow navigation to private/loopback addresses (localhost, 127.0.0.1, etc.). True by default. */
  allowPrivateHosts?: boolean | undefined;
  allowedPrivateOrigins?: string[] | undefined;
  headless?: boolean | undefined;
  operationTimeoutMs?: number | undefined;
  maxSnapshotChars?: number | undefined;
  maxConsoleEntries?: number | undefined;
  maxNetworkEntries?: number | undefined;
}
