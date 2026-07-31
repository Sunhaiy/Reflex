const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Turns whatever the user typed into an openable http(s) URL.
 * `aliyun.com`, `www.aliyun.com/ecs` and `https://aliyun.com` are all accepted;
 * returns null when the value is empty or cannot be parsed as http(s).
 */
export function normalizeProviderUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Short hostname used as the card label, e.g. `https://www.aliyun.com/ecs` -> `aliyun.com`. */
export function providerUrlLabel(value: string | undefined | null): string | null {
  const normalized = normalizeProviderUrl(value);
  if (!normalized) return null;
  return new URL(normalized).hostname.replace(/^www\./, '');
}
