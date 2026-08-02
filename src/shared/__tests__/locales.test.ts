import { describe, expect, it } from 'vitest';
import { LANGUAGE_NAMES, locales, type Language } from '../locales';

function flatten(node: unknown, prefix = '', out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value, full, out);
    else out[full] = value as string;
  }
  return out;
}

const LANGUAGES = Object.keys(locales) as Language[];
const reference = flatten(locales.en);

describe('locales', () => {
  // The bundles are typed against English, so this cannot drift without a compile
  // error first. It is asserted anyway to catch anything that slips in through a cast.
  it.each(LANGUAGES)('%s covers every key', (language) => {
    const missing = Object.keys(reference).filter((key) => !(key in flatten(locales[language])));
    expect(missing).toEqual([]);
  });

  it.each(LANGUAGES)('%s adds no key the reference lacks', (language) => {
    const extra = Object.keys(flatten(locales[language])).filter((key) => !(key in reference));
    expect(extra).toEqual([]);
  });

  it.each(LANGUAGES)('%s leaves no string empty', (language) => {
    const blank = Object.entries(flatten(locales[language]))
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect(blank).toEqual([]);
  });

  // A translation that drops a placeholder silently loses the value it was meant to
  // show — "3 servers" would render as "servers".
  it.each(LANGUAGES)('%s keeps the placeholders its English counterpart uses', (language) => {
    const placeholders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();
    const bundle = flatten(locales[language]);
    const mismatched = Object.entries(reference)
      .filter(([key, english]) =>
        placeholders(english).join() !== placeholders(bundle[key] ?? '').join())
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it('names every language it ships', () => {
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual([...LANGUAGES].sort());
  });
});
