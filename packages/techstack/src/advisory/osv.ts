/**
 * TechStack — OSV (Open Source Vulnerabilities) advisory client.
 *
 * Uses the OSV /v1/querybatch endpoint to batch-query vulnerability
 * information for lists of PackageURLs. Chunks requests into batches
 * of at most 500 packages per the OSV API limits.
 *
 * @see https://osv.dev/docs/
 */

import { get as httpsGet, RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { Evidence } from '../types.js';

// ── Types ─────────────────────────────────────────────────────────────────

/** OSV query batch request shape */
interface OsvQueryBatchRequest {
  readonly queries: ReadonlyArray<{
    readonly package: {
      readonly purl: string;
    };
  }>;
}

/** OSV query batch response shape */
interface OsvQueryBatchResponse {
  readonly results: ReadonlyArray<{
    readonly vulns?: ReadonlyArray<{
      readonly id: string;
      readonly summary?: string;
      readonly details?: string;
      readonly aliases?: readonly string[];
      readonly severity?: ReadonlyArray<{
        readonly type: string;
        readonly score: string;
      }>;
      readonly database_specific?: {
        readonly severity?: string;
      };
      readonly affected?: ReadonlyArray<{
        readonly database_specific?: {
          readonly severity?: string;
        };
      }>;
    }>;
  }>;
}

/** Parsed advisory for a single package */
export interface OsvAdvisory {
  readonly id: string;
  readonly summary: string;
  readonly severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  readonly aliases: readonly string[];
}

/** Result of querying OSV for a batch of packages */
export interface OsvBatchResult {
  /** Map from PURL to advisories found for that package */
  readonly advisories: Map<string, readonly OsvAdvisory[]>;
  readonly evidence: Evidence;
}

// ── Constants ──────────────────────────────────────────────────────────────

const OSV_API_BASE = 'api.osv.dev';
const OSV_QUERY_BATCH_PATH = '/v1/querybatch';
const MAX_BATCH_SIZE = 500;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

// ── Severity mapping ───────────────────────────────────────────────────────

function mapSeverity(
  osvSeverity?: ReadonlyArray<{ readonly type: string; readonly score: string }>,
  databaseSeverity?: string,
): 'info' | 'low' | 'medium' | 'high' | 'critical' {
  // Check CVSS score first
  if (osvSeverity && osvSeverity.length > 0) {
    for (const s of osvSeverity) {
      if (s.type === 'CVSS_V3' || s.type === 'CVSS_V2') {
        const score = parseFloat(s.score);
        if (score >= 9.0) return 'critical';
        if (score >= 7.0) return 'high';
        if (score >= 4.0) return 'medium';
        if (score >= 0.1) return 'low';
      }
    }
  }

  // Check database_specific severity
  if (databaseSeverity) {
    const ds = databaseSeverity.toLowerCase();
    if (ds === 'critical') return 'critical';
    if (ds === 'high') return 'high';
    if (ds === 'medium' || ds === 'moderate') return 'medium';
    if (ds === 'low') return 'low';
  }

  return 'info';
}

// ── HTTP client ────────────────────────────────────────────────────────────

function osvPostRequest(body: string, signal?: AbortSignal): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      hostname: OSV_API_BASE,
      path: OSV_QUERY_BATCH_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
        'User-Agent': 'WrongStack-TechStack/1.0',
      },
      signal,
      timeout: 30000,
    };

    const req = httpsGet(options, (res: IncomingMessage) => {
      const statusCode = res.statusCode ?? 0;
      let responseBody = '';
      res.on('data', (chunk: string) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode, body: responseBody });
      });
    });

    req.on('error', (err: Error) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('OSV API request timeout'));
    });

    req.write(body);
    req.end();
  });
}

// ── Sleep helper ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Core function ──────────────────────────────────────────────────────────

/**
 * Query OSV for advisories matching a list of PackageURLs.
 *
 * Chunks requests into batches of at most 500 PURLs per the OSV API limits.
 * Returns a map from each queried PURL to its list of advisories (empty array
 * means no advisories found).
 */
export async function queryOsvBatch(
  purls: readonly string[],
  options: { signal?: AbortSignal | undefined } = {},
): Promise<OsvBatchResult> {
  const advisories = new Map<string, readonly OsvAdvisory[]>();

  // Initialize empty arrays for all PURLs
  for (const purl of purls) {
    advisories.set(purl, []);
  }

  // Chunk PURLs into batches
  const batches: string[][] = [];
  for (let i = 0; i < purls.length; i += MAX_BATCH_SIZE) {
    batches.push(purls.slice(i, i + MAX_BATCH_SIZE));
  }

  let lastError: Error | undefined;

  for (const batch of batches) {
    const requestBody: OsvQueryBatchRequest = {
      queries: batch.map((purl) => ({
        package: { purl },
      })),
    };

    const jsonBody = JSON.stringify(requestBody);

    let success = false;
    for (let attempt = 0; attempt < MAX_RETRIES && !success; attempt++) {
      try {
        const response = await osvPostRequest(jsonBody, options.signal);

        if (response.statusCode === 200) {
          const result = JSON.parse(response.body) as OsvQueryBatchResponse;

          if (result.results && Array.isArray(result.results)) {
            for (let i = 0; i < result.results.length; i++) {
              const purl = batch[i];
              if (!purl) continue;

              const vulns = result.results[i]?.vulns;
              if (!vulns || vulns.length === 0) continue;

              const parsed: OsvAdvisory[] = [];
              for (const vuln of vulns) {
                // Determine severity
                const dbSpecific = vuln.database_specific;
                const affectedDbSpecific = vuln.affected?.[0]?.database_specific;
                const severitySource = dbSpecific?.severity ?? affectedDbSpecific?.severity;

                parsed.push({
                  id: vuln.id,
                  summary: vuln.summary ?? vuln.details ?? 'No summary available',
                  severity: mapSeverity(vuln.severity, severitySource),
                  aliases: vuln.aliases ?? [],
                });
              }

              advisories.set(purl, parsed);
            }
          }

          success = true;
        } else if (response.statusCode === 429 || response.statusCode >= 500) {
          // Rate limited or server error — retry with backoff
          if (attempt < MAX_RETRIES - 1) {
            const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500;
            await sleep(backoff);
          } else {
            throw new Error(`OSV API returned ${response.statusCode} after ${MAX_RETRIES} attempts: ${response.body}`);
          }
        } else {
          // Other error — don't retry
          throw new Error(`OSV API returned ${response.statusCode}: ${response.body}`);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500;
          await sleep(backoff);
        }
      }
    }

    if (!success && lastError) {
      // If a batch completely fails, we still have partial results from
      // earlier batches
      throw lastError;
    }
  }

  const evidence: Evidence = {
    kind: 'osv',
    source: 'https://api.osv.dev/v1/querybatch',
    retrievedAt: new Date().toISOString(),
    detail: `Queried ${purls.length} packages in ${batches.length} batch(es)`,
  };

  return { advisories, evidence };
}

/**
 * Query OSV for a single PURL.
 * Convenience wrapper around queryOsvBatch.
 */
export async function queryOsvSingle(
  purl: string,
  options: { signal?: AbortSignal | undefined } = {},
): Promise<readonly OsvAdvisory[]> {
  const result = await queryOsvBatch([purl], options);
  return result.advisories.get(purl) ?? [];
}
