import { useSettingsStore } from '../store/settingsStore';
import { translations } from '../shared/locales';
import type { Language } from '../shared/locales';
import { featureTranslations } from '../shared/featureLocales';
import { uiTranslations } from '../shared/uiLocales';
import { useCallback } from 'react';

function resolveTranslation(bundle: any, key: string): string | null {
    if (!bundle) return null;
    const keys = key.split('.');
    let current: any = bundle;

    for (const k of keys) {
        if (current && current[k] !== undefined) {
            current = current[k];
        } else {
            return null;
        }
    }

    return typeof current === 'string' ? current : null;
}

/** Replaces `{name}` placeholders, so translated sentences can keep their own word order. */
function interpolate(template: string, values?: Record<string, string | number>) {
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
        values[name] !== undefined ? String(values[name]) : match);
}

export function useTranslation() {
    const { language } = useSettingsStore();

    const t = useCallback((key: string, values?: Record<string, string | number>): string => {
        const bundles = [
            translations[language],
            featureTranslations[language as Language],
            uiTranslations[language],
            // English fallback for keys a translation has not covered yet.
            translations.en,
            featureTranslations.en,
            uiTranslations.en,
        ];

        for (const bundle of bundles) {
            const found = resolveTranslation(bundle, key);
            if (found) return interpolate(found, values);
        }

        return key;
    }, [language]);

    return { t, language };
}
