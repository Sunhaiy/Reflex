import { en } from './en';
import { it } from './it';
import { zh } from './zh';
import { ja } from './ja';
import { ko } from './ko';

/**
 * One bundle per language, each in its own file. This used to be three registries
 * (translations, featureTranslations, uiTranslations) each holding all five languages,
 * so a single new string meant editing five blocks across three files and the lookup
 * had to try six bundles in order.
 */
export const locales = {
  en,
  it,
  zh,
  ja,
  ko,
} as const;

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  it: 'Italiano',
  zh: '简体中文',
  ja: '日本語',
  ko: '한국어',
};

export type Language = keyof typeof locales;
export type { LocaleBundle } from './types';
