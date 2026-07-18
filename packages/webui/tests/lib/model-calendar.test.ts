import { describe, expect, it } from 'vitest';
import {
  blockingCalendarRules,
  isCalendarRuleActive,
  isCalendarRuleBlocking,
  ruleTarget,
} from '../../src/lib/model-calendar';

describe('browser model calendar', () => {
  it('matches the same overnight semantics as core routing', () => {
    const rule = {
      id: 'night',
      provider: 'cc',
      days: [1],
      start: '22:00',
      end: '07:00',
      timezone: 'UTC',
    };
    expect(isCalendarRuleActive(rule, new Date('2026-07-20T23:00:00Z'))).toBe(true);
    expect(isCalendarRuleActive(rule, new Date('2026-07-21T06:00:00Z'))).toBe(true);
    expect(isCalendarRuleActive(rule, new Date('2026-07-21T08:00:00Z'))).toBe(false);
  });

  it('formats provider-wide and model-specific targets', () => {
    expect(ruleTarget({ id: 'p', provider: 'openai', start: '00:00', end: '01:00' })).toBe(
      'openai/*',
    );
    expect(
      ruleTarget({ id: 'm', provider: 'cc', model: 'opus', start: '00:00', end: '01:00' }),
    ).toBe('cc/opus');
  });

  it('shows allow-only rules as blocked outside their window', () => {
    expect(
      isCalendarRuleBlocking(
        {
          id: 'work',
          mode: 'allow_only',
          provider: 'cc',
          start: '09:00',
          end: '17:00',
          timezone: 'UTC',
        },
        new Date('2026-07-20T20:00:00Z'),
      ),
    ).toBe(true);
  });

  it('does not show a target blocked when another allow-only window is active', () => {
    const rules = [
      {
        id: 'morning',
        mode: 'allow_only' as const,
        provider: 'cc',
        start: '08:00',
        end: '12:00',
        timezone: 'UTC',
      },
      {
        id: 'evening',
        mode: 'allow_only' as const,
        provider: 'cc',
        start: '18:00',
        end: '20:00',
        timezone: 'UTC',
      },
    ];
    expect(blockingCalendarRules(rules, new Date('2026-07-20T19:00:00Z'))).toEqual([]);
  });

  it('ignores invalid allow-only rules in the availability panel', () => {
    const rules = [
      {
        id: 'bad',
        mode: 'allow_only' as const,
        provider: 'cc',
        start: '09:00',
        end: '17:00',
        timezone: 'Not/AZone',
      },
    ];
    expect(blockingCalendarRules(rules, new Date('2026-07-20T19:00:00Z'))).toEqual([]);
  });
});
