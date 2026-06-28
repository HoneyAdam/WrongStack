import type { HqClientConfig, SlashCommand } from '@wrongstack/core';
import {
  color,
  noOpVault,
  readHqRuntimeFileSync,
  resolveHqConfig,
  resolveHqDataDir,
} from '@wrongstack/core';
import { persistConfigSetting } from '../settings-menu.js';
import { parseSubcommand } from './helpers.js';
import type { SlashCommandContext } from './index.js';

function maskToken(t: string): string {
  if (t.length <= 10) return `${t.slice(0, 2)}…(${t.length})`;
  return `${t.slice(0, 6)}…${t.slice(-4)} (${t.length} chars)`;
}

/**
 * Best-effort reachability check. We hit the HQ root over HTTP: a 200 (open
 * mode) or 401 (token mode — server is up, just auth-gated) both mean the HQ
 * is reachable; a network failure means it isn't. The client token is for the
 * WS `/ws/client` channel, so we don't try to validate it here.
 */
async function probeHq(url: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' }).catch(() => null);
    clearTimeout(timer);
    if (!res) return color.red('unreachable');
    if (res.ok) return color.green('reachable');
    if (res.status === 401) return color.green('reachable') + color.dim(' (token required)');
    return color.amber(`reachable (HTTP ${res.status})`);
  } catch {
    return color.red('unreachable');
  }
}

export function buildHqCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'hq',
    category: 'Config',
    description: 'Connect to and inspect a WrongStack HQ command center.',
    argsHint: '[status | set <url> [token] | token <t> | on | off | clear]',
    help: [
      'Stream this client’s live session + agents to an HQ command center.',
      '',
      'Usage:',
      '  /hq                     Show HQ connection status (resolved URL, token, reachability)',
      '  /hq status              Same as bare /hq',
      '  /hq set <url> [token]   Point this client at an HQ, e.g.',
      '                            /hq set http://192.168.1.20:3499 my-client-token',
      '  /hq token <token>       Set just the client token',
      '  /hq on | off            Enable / disable HQ publishing',
      '  /hq clear               Remove all HQ settings',
      '',
      'Saved to ~/.wrongstack/config.json (global). Telemetry connects on the',
      'NEXT session start (an already-running session keeps its connection).',
      'A locally running `wstack --hq` is auto-discovered with no config.',
      '',
      '/hq is the canonical HQ command. The /settings hq* entries write the same',
      'config keys, so either works; prefer /hq for HQ connection management.',
    ].join('\n'),
    async run(args) {
      const { cmd, rest } = parseSubcommand(args);
      const sub = cmd;

      if (!opts.configStore || !opts.paths) {
        return { message: `${color.red('✗')} HQ config is unavailable in this surface.` };
      }
      const persistDeps = {
        configStore: opts.configStore,
        globalConfigPath: opts.paths.globalConfig,
        inProjectConfigPath: opts.paths.inProjectConfig,
        vault: noOpVault,
        forceGlobal: true as const,
      };
      const currentHq = (opts.configStore.get() as { hq?: HqClientConfig }).hq;

      // ── set <url> [token] ───────────────────────────────────────────────
      if (sub === 'set') {
        const url = (rest[0] ?? '').trim();
        const token = rest.slice(1).join(' ').trim();
        if (!url) {
          return { message: `${color.amber('Usage:')} /hq set <http://host:3499> [client-token]` };
        }
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('proto');
        } catch {
          return { message: `${color.red('Invalid URL:')} ${url} ${color.dim('(expected http://host:3499)')}` };
        }
        await persistConfigSetting(persistDeps, (cfg) => {
          const hq = (cfg.hq as Record<string, unknown> | undefined) ?? {};
          hq.url = url;
          hq.enabled = true;
          if (token) hq.token = token;
          cfg.hq = hq;
        });
        const reach = await probeHq(url);
        const tokLine = token ? `\n  token:  ${color.dim(maskToken(token))}` : '';
        return {
          message:
            `${color.green('✓')} HQ set → ${color.cyan(url)}${tokLine}\n` +
            `  status: ${reach}\n` +
            `  ${color.dim('Connects on the next session start.')}`,
        };
      }

      // ── token <token> ───────────────────────────────────────────────────
      if (sub === 'token') {
        const token = rest.join(' ').trim();
        if (!token) return { message: `${color.amber('Usage:')} /hq token <client-token>` };
        await persistConfigSetting(persistDeps, (cfg) => {
          const hq = (cfg.hq as Record<string, unknown> | undefined) ?? {};
          hq.token = token;
          hq.enabled = true;
          cfg.hq = hq;
        });
        return { message: `${color.green('✓')} HQ client token saved ${color.dim(maskToken(token))}` };
      }

      // ── on / off ────────────────────────────────────────────────────────
      if (sub === 'on' || sub === 'off') {
        const on = sub === 'on';
        await persistConfigSetting(persistDeps, (cfg) => {
          const hq = (cfg.hq as Record<string, unknown> | undefined) ?? {};
          hq.enabled = on;
          cfg.hq = hq;
        });
        return { message: `${color.green('✓')} HQ publishing → ${on ? color.cyan('on') : color.dim('off')}` };
      }

      // ── clear ───────────────────────────────────────────────────────────
      if (sub === 'clear') {
        await persistConfigSetting(persistDeps, (cfg) => {
          delete (cfg as Record<string, unknown>).hq;
        });
        return { message: `${color.green('✓')} HQ configuration cleared.` };
      }

      // ── status (bare /hq or /hq status) ─────────────────────────────────
      if (sub === '' || sub === 'status') {
        const dataDir = resolveHqDataDir(currentHq?.dataDir);
        const runtime = readHqRuntimeFileSync(dataDir);
        const resolved = resolveHqConfig({ config: currentHq });
        const lines: string[] = [`${color.bold('📋 WrongStack HQ — connection')}`, ''];

        if (!resolved) {
          lines.push(`  ${color.dim('Not configured.')} Use ${color.cyan('/hq set <url> [token]')} to connect,`);
          lines.push(`  or run ${color.cyan('wstack --hq')} locally (auto-discovered).`);
          if (runtime) {
            lines.push('');
            lines.push(`  ${color.green('A local HQ is running')} at ${color.cyan(runtime.url)} ${color.dim('(start a new session to attach)')}`);
          }
          const message = lines.join('\n');
          return { message };
        }

        const source = process.env['WRONGSTACK_HQ_URL']
          ? 'WRONGSTACK_HQ_URL env'
          : currentHq?.url
            ? 'config.json'
            : runtime
              ? `local HQ marker (pid ${runtime.pid ?? '?'})`
              : 'default';
        lines.push(`  url:     ${color.cyan(resolved.url)}`);
        lines.push(`  enabled: ${resolved.enabled === false ? color.dim('false') : color.green('true')}`);
        lines.push(`  source:  ${color.dim(source)}`);
        lines.push(`  token:   ${resolved.token ? color.dim(maskToken(resolved.token)) : color.dim('none (open mode)')}`);
        if (resolved.rawContent === true) lines.push(`  content: ${color.amber('raw (unredacted)')}`);
        if (resolved.projectAlias) lines.push(`  alias:   ${color.cyan(resolved.projectAlias)}`);
        lines.push(`  status:  ${await probeHq(resolved.url)}`);
        return { message: lines.join('\n') };
      }

      return {
        message: `${color.red('Unknown subcommand:')} ${sub}\n${color.dim('Try /hq, /hq set <url> [token], /hq on|off, /hq clear, or /help hq')}`,
      };
    },
  };
}
