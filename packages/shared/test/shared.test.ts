import { describe, expect, it } from 'vitest';
import de from '../src/locales/de.json';
import en from '../src/locales/en.json';
import { DEFAULT_ROLES, levelsForSide, localized, maxLevel, resolveLanguage, rightsOf } from '../src/index.js';

const keys = (obj: object, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

describe('translations', () => {
  it('German and English have the same keys', () => {
    expect(keys(de).sort()).toEqual(keys(en).sort());
  });

  it('no empty texts', () => {
    for (const [name, file] of [
      ['de', de],
      ['en', en],
    ] as const) {
      const empty = keys(file).filter((k) => !k.split('.').reduce((o: any, p) => o[p], file));
      expect(empty, name).toEqual([]);
    }
  });
});

describe('language', () => {
  it('own choice beats project, project beats browser', () => {
    expect(resolveLanguage({ own: 'en', project: 'de', browser: ['de-DE'] })).toBe('en');
    expect(resolveLanguage({ own: null, project: 'de', browser: ['en-US'] })).toBe('de');
    expect(resolveLanguage({ browser: ['en-GB', 'de'] })).toBe('en');
  });

  it('skips languages that are only prepared', () => {
    expect(resolveLanguage({ own: 'nl', project: 'es', browser: ['fr'], fallback: 'de' })).toBe('de');
    expect(resolveLanguage({})).toBe('en');
  });

  it('picks the best translation of a name', () => {
    expect(localized({ de: 'Kunde', en: 'Customer' }, 'nl')).toBe('Customer');
    expect(localized({ de: 'Kunde' }, 'en')).toBe('Kunde');
    expect(localized(null, 'de')).toBe('');
  });
});

describe('permissions', () => {
  it('takes the highest level', () => {
    expect(maxLevel(['reader', 'pl_customer', undefined])).toBe('pl_customer');
    expect(maxLevel([])).toBeNull();
  });

  it('keeps sides apart', () => {
    expect(levelsForSide('customer')).not.toContain('team_slimstock');
    expect(levelsForSide('slimstock')).not.toContain('pl_customer');
  });

  it('only Slimstock levels see internal content', () => {
    expect(rightsOf('pl_customer').viewInternal).toBe(false);
    expect(rightsOf('team_slimstock').viewInternal).toBe(true);
    expect(rightsOf(null).view).toBe(false);
  });

  it('default roles fit their side', () => {
    for (const r of DEFAULT_ROLES) expect(levelsForSide(r.side)).toContain(r.defaultPermission);
  });
});
