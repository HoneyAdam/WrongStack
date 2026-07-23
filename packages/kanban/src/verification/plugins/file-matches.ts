/**
 * file_matches plugin — reads a file and tests its content against a regex pattern.
 * The pattern is stored in check.notes as a JSON object { file, pattern, flags }.
 * Produces evidence: { path, pattern, matched, lineNumbers[] }.
 */
import type { KanbanCheck, KanbanVerificationCheckResult } from '../../types.js';
import type { VerifierPlugin } from '../verifier-plugin.js';
import type { VerificationContext } from '../verification-context.js';

export class FileMatchesPlugin implements VerifierPlugin {
  readonly id = 'file_matches';
  readonly kind = 'deterministic' as const;

  canHandle(checkType: string): boolean {
    return checkType === 'file_matches';
  }

  async verify(
    check: KanbanCheck,
    context: VerificationContext,
  ): Promise<KanbanVerificationCheckResult> {
    // Parse config from notes JSON or extract from description
    let config: { file: string; pattern: string; flags?: string } | null = null;
    try {
      if (check.notes?.trim()) {
        config = JSON.parse(check.notes) as { file: string; pattern: string; flags?: string };
      }
    } catch {
      // not JSON — parse from description
    }

    if (!config) {
      // Fallback: description = "file should contain pattern"
      const parts = check.description.split(/\s+(should|must|contains?)\s+/i);
      config = {
        file: parts[0]?.trim() ?? '',
        pattern: parts[parts.length - 1]?.trim() ?? '',
      };
    }

    if (!config.file || !config.pattern) {
      return {
        checkId: check.id,
        description: check.description,
        type: check.type,
        status: 'error',
        evidence: {},
        error: 'file_matches check requires { file, pattern } in notes JSON or description.',
      };
    }

    try {
      const content = await context.readFile(config.file);
      const flags = config.flags ?? '';
      const regex = new RegExp(config.pattern, flags);
      const match = content.match(regex);
      const lineNumbers: number[] = [];
      if (match) {
        // Find line numbers for all matches
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i]!)) {
            lineNumbers.push(i + 1);
          }
        }
      }

      return {
        checkId: check.id,
        description: check.description,
        type: check.type,
        status: match ? 'passed' : 'failed',
        evidence: {
          path: config.file,
          pattern: config.pattern,
          matched: match !== null,
          matchCount: lineNumbers.length,
          lineNumbers: lineNumbers.length > 0 ? lineNumbers : undefined,
        },
        error: match ? undefined : `Pattern "${config.pattern}" not found in ${config.file}.`,
      };
    } catch (err) {
      return {
        checkId: check.id,
        description: check.description,
        type: check.type,
        status: 'error',
        evidence: { path: config.file, pattern: config.pattern },
        error: `Error reading ${config.file}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
