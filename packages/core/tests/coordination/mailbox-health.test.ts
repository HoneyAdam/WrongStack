/**
 * Tests for MailboxHealthWatchdog.
 *
 * Two surfaces are pinned by these tests:
 *
 *   1. **Alert body snapshot** — `buildDownAlert` and `buildRecoveryAlert`
 *      produce the exact subject + body an external dashboard or alert
 *      consumer parses. Changing these strings is a breaking change for
 *      downstream tooling; the snapshot here is the contract.
 *
 *   2. **Config validation** — `validateWatchdogOptions` rejects
 *      nonsensical configurations (negative interval, timeout ≥
 *      interval, etc.) at startup, not silently after the first probe.
 *
 * The live probing path (`probe()`, `recordFailure()`, `recordSuccess()`)
 * is intentionally NOT exercised here — it depends on `fetch` + real
 * timing, and the existing `mailbox-bridge.test.ts` integration test
 * already covers it end-to-end with a spawned `wstack mailbox serve`
 * child process.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDownAlert,
  buildRecoveryAlert,
  validateWatchdogOptions,
  type DownAlertInput,
  type RecoveryAlertInput,
  type WatchdogConfig,
} from '../../src/coordination/mailbox-health.js';

const downFixture: DownAlertInput = {
  from: 'mailbox-bridge-watchdog',
  url: 'http://127.0.0.1:7788',
  consecutiveFailures: 2,
};

const recoveryFixture: RecoveryAlertInput = {
  from: 'mailbox-bridge-watchdog',
  url: 'http://127.0.0.1:7788',
  downtimeMs: 17_321,
  consecutiveFailures: 2,
};

const validConfig: WatchdogConfig = {
  probeIntervalMs: 15_000,
  probeTimeoutMs: 3_000,
  failureThreshold: 2,
};

describe('buildDownAlert', () => {
  it('produces the exact down-alert subject', () => {
    expect(buildDownAlert(downFixture).subject).toBe(
      'mailbox-bridge-down: HTTP /healthz not responding',
    );
  });

  it('broadcasts to * with type=status and high priority', () => {
    const a = buildDownAlert(downFixture);
    expect(a.from).toBe('mailbox-bridge-watchdog');
    expect(a.to).toBe('*');
    expect(a.type).toBe('status');
    expect(a.priority).toBe('high');
  });

  it('includes the bridge URL and failure count in the body', () => {
    const body = buildDownAlert(downFixture).body;
    expect(body).toContain('http://127.0.0.1:7788');
    expect(body).toContain('2 consecutive /healthz probes');
  });

  it('lists external-agent consequences and remediation', () => {
    const body = buildDownAlert(downFixture).body;
    expect(body).toContain('External agents (Claude Code, Aider, scripts)');
    expect(body).toContain('Fix: re-run');
    expect(body).toContain('wstack mailbox serve');
    expect(body).toContain('/mailbox-serve');
  });

  it('substitutes different failure counts verbatim', () => {
    const body = buildDownAlert({ ...downFixture, consecutiveFailures: 7 }).body;
    expect(body).toContain('7 consecutive');
    expect(body).not.toContain('2 consecutive');
  });
});

describe('buildRecoveryAlert', () => {
  it('includes downtime in the subject as a rounded-second count', () => {
    expect(buildRecoveryAlert(recoveryFixture).subject).toBe(
      'mailbox-bridge-up: recovered after 17s',
    );
  });

  it('broadcasts to * with type=status and normal priority', () => {
    const a = buildRecoveryAlert(recoveryFixture);
    expect(a.from).toBe('mailbox-bridge-watchdog');
    expect(a.to).toBe('*');
    expect(a.type).toBe('status');
    expect(a.priority).toBe('normal');
  });

  it('includes the bridge URL, downtime, and failure count in the body', () => {
    const body = buildRecoveryAlert(recoveryFixture).body;
    expect(body).toContain('http://127.0.0.1:7788');
    expect(body).toContain('Downtime: 17s');
    expect(body).toContain('Consecutive failures before recovery: 2.');
  });

  it('rounds downtime to the nearest second', () => {
    // 999 ms rounds down to 1 s
    expect(buildRecoveryAlert({ ...recoveryFixture, downtimeMs: 999 }).subject)
      .toBe('mailbox-bridge-up: recovered after 1s');
    // 1500 ms rounds to 2 s (banker's rounding aside — Math.round is round-half-up)
    expect(buildRecoveryAlert({ ...recoveryFixture, downtimeMs: 1500 }).subject)
      .toBe('mailbox-bridge-up: recovered after 2s');
  });
});

describe('validateWatchdogOptions', () => {
  it('accepts the default config', () => {
    expect(() => validateWatchdogOptions(validConfig)).not.toThrow();
  });

  it('accepts custom configs within sane bounds', () => {
    expect(() => validateWatchdogOptions({
      probeIntervalMs: 60_000,
      probeTimeoutMs: 5_000,
      failureThreshold: 3,
    })).not.toThrow();
  });

  it('rejects zero or negative probeIntervalMs', () => {
    expect(() => validateWatchdogOptions({ ...validConfig, probeIntervalMs: 0 }))
      .toThrow(/probeIntervalMs must be a positive finite number/);
    expect(() => validateWatchdogOptions({ ...validConfig, probeIntervalMs: -1 }))
      .toThrow(/probeIntervalMs must be a positive finite number/);
    expect(() => validateWatchdogOptions({ ...validConfig, probeIntervalMs: Number.NaN }))
      .toThrow(/probeIntervalMs must be a positive finite number/);
    expect(() => validateWatchdogOptions({ ...validConfig, probeIntervalMs: Number.POSITIVE_INFINITY }))
      .toThrow(/probeIntervalMs must be a positive finite number/);
  });

  it('rejects zero or negative probeTimeoutMs', () => {
    expect(() => validateWatchdogOptions({ ...validConfig, probeTimeoutMs: 0 }))
      .toThrow(/probeTimeoutMs must be a positive finite number/);
    expect(() => validateWatchdogOptions({ ...validConfig, probeTimeoutMs: -100 }))
      .toThrow(/probeTimeoutMs must be a positive finite number/);
  });

  it('rejects probeTimeoutMs >= probeIntervalMs (race condition)', () => {
    expect(() => validateWatchdogOptions({ ...validConfig, probeTimeoutMs: 15_000 }))
      .toThrow(/probeTimeoutMs .* must be less than probeIntervalMs/);
    expect(() => validateWatchdogOptions({
      probeIntervalMs: 1_000,
      probeTimeoutMs: 1_000,
      failureThreshold: 2,
    })).toThrow(/must be less than probeIntervalMs/);
    // 1 ms vs 1 ms — the strict `<` means equality also rejects.
    expect(() => validateWatchdogOptions({
      probeIntervalMs: 1,
      probeTimeoutMs: 1,
      failureThreshold: 2,
    })).toThrow(/must be less than probeIntervalMs/);
  });

  it('rejects non-positive failureThreshold', () => {
    expect(() => validateWatchdogOptions({ ...validConfig, failureThreshold: 0 }))
      .toThrow(/failureThreshold must be a positive integer/);
    expect(() => validateWatchdogOptions({ ...validConfig, failureThreshold: -3 }))
      .toThrow(/failureThreshold must be a positive integer/);
    expect(() => validateWatchdogOptions({ ...validConfig, failureThreshold: 1.5 }))
      .toThrow(/failureThreshold must be a positive integer/);
  });
});