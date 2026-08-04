import { useCallback } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { locales, type Language, type LocaleBundle } from '../shared/locales';

function resolve(bundle: LocaleBundle | undefined, key: string): string | null {
    let current: unknown = bundle;
    for (const part of key.split('.')) {
        if (!current || typeof current !== 'object') return null;
        current = (current as Record<string, unknown>)[part];
    }
    return typeof current === 'string' ? current : null;
}

/** Replaces `{name}` placeholders, so translated sentences keep their own word order. */
function interpolate(template: string, values?: Record<string, string | number>) {
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
        values[name] !== undefined ? String(values[name]) : match);
}

export function useTranslation() {
    const { language } = useSettingsStore();

    const t = useCallback((key: string, values?: Record<string, string | number>): string => {
        // Every language is type-checked against the English bundle, so a miss here means
        // a key that does not exist at all rather than one language lagging behind.
        const found = resolve(locales[language as Language], key) ?? resolve(locales.en, key);
        return found === null ? key : interpolate(found, values);
    }, [language]);

    return { t, language };
}
