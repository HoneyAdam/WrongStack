#!/usr/bin/env node
/**
 * One-shot purge of stale mailbox client + agent registry entries.
 *
 * Reads _mailbox.clients.json and _mailbox.registry.json from the current
 * project's wrongstack directory, prunes entries past their staleness
 * thresholds, and writes the cleaned files back.
 *
 * Usage:
 *   node scripts/purge-stale-mailbox-entries.mjs
 *
 * Or with an explicit project slug:
 *   node scripts/purge-stale-mailbox-entries.mjs wrongstack-6fc446
 *
 * Thresholds:
 *   CLIENT_STALE_MS = 60_000  (1 min)  — clients deleted entirely
 *   AGENT_PURGE_MS  = 3_600_000 (1 h)  — agents deleted entirely
 *   (The GlobalMailbox uses 24h for agent purge as a safety buffer; this
 *    one-shot cleanup uses 1h since any agent that hasn't heartbeated in
 *    an hour is certainly dead.)
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { projectSlug } from '../packages/core/dist/index.js';

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * How long without a heartbeat before a client is removed. (1 min)
 */
const CLIENT_STALE_MS = 60_000;

/**
 * How long without a heartbeat before the default purge kicks in. (1 hour)
 * The GlobalMailbox constant is AGENT_PURGE_MS = 24h, but that's designed as
 * a safety buffer so agents are never accidentally purged mid-session. For
 * the explicit one-shot cleanup we use 1h — any agent that hasn't sent a
 * heartbeat in more than an hour is certainly dead.
 */
const AGENT_PURGE_MS = 3_600_000; // 1h

// ── Resolve project directory ─────────────────────────────────────────────

const slug = process.argv[2] || projectSlug(process.cwd());
const projectDir = join(homedir(), '.wrongstack', 'projects', slug);
console.log(`Project dir: ${projectDir}`);

// ── Helpers ───────────────────────────────────────────────────────────────

function _isoNow() {
  return new Date().toISOString();
}

function report(label, before, after) {
  const removed = before - after;
  const pct = before > 0 ? Math.round((removed / before) * 100) : 0;
  if (removed > 0) {
    console.log(`  ${label}: ${before} → ${after} (${removed} removed, ${pct}%)`);
  } else {
    console.log(`  ${label}: ${after} entries (no stale entries)`);
  }
}

// ── Purge clients (delete past CLIENT_STALE_MS) ───────────────────────────

const clientFile = join(projectDir, '_mailbox.clients.json');
if (existsSync(clientFile)) {
  const raw = readFileSync(clientFile, 'utf8');
  const clients = JSON.parse(raw);
  const before = Object.keys(clients).length;
  const cutoff = Date.now() - CLIENT_STALE_MS;
  for (const [id, client] of Object.entries(clients)) {
    const lastSeen = new Date(client.lastSeenAt).getTime();
    if (lastSeen < cutoff) {
      delete clients[id];
    }
  }
  const after = Object.keys(clients).length;
  report('Clients', before, after);
  writeFileSync(clientFile, JSON.stringify(clients));
}

// ── Purge agents (delete those past AGENT_PURGE_MS) ────────────────────────

const agentFile = join(projectDir, '_mailbox.registry.json');
if (existsSync(agentFile)) {
  const raw = readFileSync(agentFile, 'utf8');
  const agents = JSON.parse(raw);
  const before = Object.keys(agents).length;
  const cutoff = Date.now() - AGENT_PURGE_MS;
  for (const [id, agent] of Object.entries(agents)) {
    if (new Date(agent.lastSeenAt).getTime() < cutoff) {
      delete agents[id];
    }
  }
  const after = Object.keys(agents).length;
  report('Agents', before, after);
  writeFileSync(agentFile, JSON.stringify(agents));
}

// ── Stale .tmp files from crashed writes ──────────────────────────────────

let tmpRemoved = 0;
for (const name of readdirSync(projectDir)) {
  if (name.includes('.tmp')) {
    const fp = join(projectDir, name);
    try {
      unlinkSync(fp);
      tmpRemoved++;
    } catch { /* race with another process — skip */ }
  }
}
if (tmpRemoved > 0) {
  console.log(`  Stale .tmp files: ${tmpRemoved} cleaned`);
}

console.log('Done.');
