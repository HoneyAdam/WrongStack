import { describe, expect, it } from 'vitest';
import { helpSections } from '../src/components/help-overlay.js';

const flat = (opts: { managed: boolean; mouse: boolean }) =>
  helpSections(opts).flatMap((s) => s.entries.map((e) => e.keys));

describe('helpSections', () => {
  it('always groups the four areas in order', () => {
    const titles = helpSections({ managed: false, mouse: false }).map((s) => s.title);
    expect(titles).toEqual(['Navigation', 'Monitors', 'Editing', 'Commands']);
  });

  it('always lists the monitor + help keys', () => {
    const keys = flat({ managed: false, mouse: false });
    // Monitor chords are listed with their terminal-safe F-key aliases.
    expect(keys).toContain('Ctrl+F / F2');
    expect(keys).toContain('Ctrl+G / F3');
    expect(keys).toContain('Ctrl+T / F4');
    expect(keys).toContain('?');
    expect(keys).toContain('/help');
    expect(keys).toContain('Ctrl+S');
    expect(keys).toContain('/settings');
  });

  it('adds PgUp/PgDn only in the managed viewport', () => {
    expect(flat({ managed: false, mouse: false })).not.toContain('PgUp/PgDn');
    expect(flat({ managed: true, mouse: false })).toContain('PgUp/PgDn');
  });

  it('adds wheel + click only in full mouse mode', () => {
    expect(flat({ managed: true, mouse: false })).not.toContain('wheel');
    const mouseKeys = flat({ managed: true, mouse: true });
    expect(mouseKeys).toContain('wheel');
    expect(mouseKeys).toContain('click');
  });

  it('never produces an empty section', () => {
    for (const opts of [
      { managed: false, mouse: false },
      { managed: true, mouse: true },
    ]) {
      for (const sec of helpSections(opts)) {
        expect(sec.entries.length).toBeGreaterThan(0);
      }
    }
  });
});
