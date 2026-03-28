import { useSettingsStore } from '../store/settingsStore';
import { translations } from '../shared/locales';
import type { Language } from '../shared/locales';
import { featureTranslations } from '../shared/featureLocales';

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

export function useTranslation() {
    const { language } = useSettingsStore();

    const t = (key: string): string => {
        const localized = [
            translations[language],
            featureTranslations[language as Language],
        ];
        for (const bundle of localized) {
            const found = resolveTranslation(bundle, key);
            if (found) return found;
        }

        const english = [
            translations['en'],
            featureTranslations['en'],
        ];
        for (const bundle of english) {
            const found = resolveTranslation(bundle, key);
            if (found) return found;
        }

        return key;
    };

    return { t, language };
}
