/**
 * Real IANA areas. Allow-listing them is deliberate: a host with no timezone configured
 * reports `UTC`, `Etc/UTC`, `Etc/GMT+8` or `n/a`, and both `Etc/UTC` and `n/a` satisfy a
 * naive Area/City shape check — the latter would surface as the city "a" in the region
 * "n". Neither carries a location, so neither may pass.
 */
const IANA_AREAS = /^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//;
const IANA_SHAPE = /^[A-Za-z]+\/[A-Za-z0-9_+\-/]+$/;

/** Returns the zone when it names a real place, or '' when the host has none set. */
export function normalizeTimezone(raw: string | undefined): string {
  const value = (raw ?? '').trim().split('\n')[0].trim();
  return IANA_AREAS.test(value) && IANA_SHAPE.test(value) ? value : '';
}

/** "Asia/Shanghai" -> { region: 'Asia', city: 'Shanghai' } */
export function splitTimezone(timezone: string) {
  const parts = timezone.split('/');
  return {
    region: parts[0]?.replace(/_/g, ' ') ?? '',
    city: (parts[parts.length - 1] ?? '').replace(/_/g, ' '),
  };
}
