import { managementText, type ManagementKey } from '../shared/managementLocale';
import { useTranslation } from './useTranslation';

export function useManagementText() {
  const { language } = useTranslation();
  return (key: ManagementKey, values?: Record<string, string | number>) => managementText(language, key, values);
}
