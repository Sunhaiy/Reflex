import type { en } from './en';

/**
 * Derived from the English bundle so every other language must match it exactly.
 * DeepMutable strips the `as const` readonly-ness, which would otherwise force the
 * translations to be literal types rather than plain strings.
 */
type DeepMutable<T> = T extends string ? string : { -readonly [K in keyof T]: DeepMutable<T[K]> };

export type LocaleBundle = DeepMutable<typeof en>;
