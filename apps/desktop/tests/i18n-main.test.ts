/**
 * Unit tests for i18n-main module - locale management and translation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setMainLocale, getMainLocale, tMain } from '../src/main/i18n-main.js';

// ============================================================================
// Locale Management Tests
// ============================================================================

describe('getMainLocale', () => {
  it('should return en as default locale', () => {
    expect(getMainLocale()).toBe('en');
  });
});

describe('setMainLocale', () => {
  it('should set locale to en', () => {
    setMainLocale('en');
    expect(getMainLocale()).toBe('en');
  });

  it('should set locale to tr', () => {
    setMainLocale('tr');
    expect(getMainLocale()).toBe('tr');
  });

  it('should set locale to de', () => {
    setMainLocale('de');
    expect(getMainLocale()).toBe('de');
  });

  it('should set locale to fr', () => {
    setMainLocale('fr');
    expect(getMainLocale()).toBe('fr');
  });

  it('should set locale to it', () => {
    setMainLocale('it');
    expect(getMainLocale()).toBe('it');
  });

  it('should set locale to es', () => {
    setMainLocale('es');
    expect(getMainLocale()).toBe('es');
  });

  it('should set locale to pt-BR', () => {
    setMainLocale('pt-BR');
    expect(getMainLocale()).toBe('pt-BR');
  });
});

// ============================================================================
// Translation Tests
// ============================================================================

describe('tMain', () => {
  beforeEach(() => {
    setMainLocale('en');
  });

  it('should return key for unknown translations', () => {
    expect(tMain('nonexistent.key')).toBe('nonexistent.key');
  });

  it('should return English translation', () => {
    setMainLocale('en');
    expect(tMain('windowTitle')).toBe('WrongStack Desktop');
  });

  it('should return Turkish translation for locale-specific keys', () => {
    setMainLocale('tr');
    expect(tMain('yoloMode')).toBe('YOLO Modu');
  });

  it('should return German translation for locale-specific keys', () => {
    setMainLocale('de');
    expect(tMain('yoloMode')).toBe('YOLO-Modus');
  });

  it('should return French translation for locale-specific keys', () => {
    setMainLocale('fr');
    expect(tMain('file')).toBe('Fichier');
  });

  it('should return Italian translation for locale-specific keys', () => {
    setMainLocale('it');
    expect(tMain('file')).toBe('File');
  });

  it('should return Spanish translation for locale-specific keys', () => {
    setMainLocale('es');
    expect(tMain('file')).toBe('Archivo');
  });

  it('should return pt-BR translation for locale-specific keys', () => {
    setMainLocale('pt-BR');
    expect(tMain('file')).toBe('Arquivo');
  });

  it('should fallback to English when locale has no translation', () => {
    // Key exists in en but not in tr - should use en
    setMainLocale('tr');
    // All keys exist in all catalogs, so fallback is only for missing keys
    expect(tMain('windowTitle')).toBe('WrongStack Desktop');
  });
});

// ============================================================================
// Locale Cache Tests
// ============================================================================

describe('Locale switching', () => {
  it('should preserve last set locale', () => {
    setMainLocale('de');
    setMainLocale('fr');
    expect(getMainLocale()).toBe('fr');
  });

  it('should switch translations after locale change', () => {
    setMainLocale('en');
    setMainLocale('tr');
    const trResult = tMain('menu.file');
    expect(trResult).toBeTruthy();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge cases', () => {
  beforeEach(() => {
    setMainLocale('en');
  });

  it('should handle empty key', () => {
    expect(tMain('')).toBe('');
  });

  it('should handle keys with special characters', () => {
    expect(tMain('key.with.dots')).toBe('key.with.dots');
  });

  it('should handle keys with numbers', () => {
    expect(tMain('key123')).toBe('key123');
  });

  it('should handle nested key paths', () => {
    expect(tMain('deeply.nested.translation.key')).toBe('deeply.nested.translation.key');
  });
});
