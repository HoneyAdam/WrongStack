import { describe, expect, it } from 'vitest';
import { validatePrefsUpdatePayload } from '../src/server/ws-payload-validation.js';

/**
 * `pluginsEnabled` is the only prefs key whose *object keys* are
 * attacker-controlled (plugin names → `extensions.<name>.enabled`). The
 * validator originally checked only the values, so `{"__proto__": true}` sailed
 * through to the persist layer, where `ext['__proto__']` reads back
 * Object.prototype and `pExt['enabled'] = true` pollutes it for the whole
 * process — every object then inherits `.enabled === true`, defeating the
 * `?? true`-style plugin gates.
 *
 * JSON.parse is used deliberately below — NOT an object literal: it makes
 * `__proto__` an OWN enumerable property (a literal would invoke the setter and
 * create nothing), which is exactly what an incoming WS frame produces.
 */
describe('prefs.update pluginsEnabled — prototype pollution guard', () => {
  it('rejects a __proto__ plugin name instead of persisting it', () => {
    const payload = JSON.parse(`{"pluginsEnabled":{"__proto__":true}}`) as unknown;
    const result = validatePrefsUpdatePayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('forbidden key');
  });

  it('rejects the other prototype-reaching keys', () => {
    for (const key of ['constructor', 'prototype']) {
      const payload = JSON.parse(`{"pluginsEnabled":{${JSON.stringify(key)}:true}}`) as unknown;
      const result = validatePrefsUpdatePayload(payload);
      expect(result.ok, `${key} must be rejected`).toBe(false);
    }
  });

  it('still accepts ordinary plugin names', () => {
    const payload = JSON.parse(
      `{"pluginsEnabled":{"wstack-chimera":false,"wstack-auto-review":true}}`,
    ) as unknown;
    expect(validatePrefsUpdatePayload(payload).ok).toBe(true);
  });

  it('still rejects non-boolean values', () => {
    expect(validatePrefsUpdatePayload({ pluginsEnabled: { foo: 'yes' } }).ok).toBe(false);
  });

  it('leaves Object.prototype clean after a rejected payload', () => {
    const payload = JSON.parse(`{"pluginsEnabled":{"__proto__":true}}`) as unknown;
    validatePrefsUpdatePayload(payload);
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'enabled')).toBeUndefined();
    expect(({} as Record<string, unknown>)['enabled']).toBeUndefined();
  });
});
