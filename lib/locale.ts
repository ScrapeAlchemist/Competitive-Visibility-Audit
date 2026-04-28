// =====================================================
// Locale helpers shared across audit stages.
// =====================================================

/**
 * Map a human-friendly location string ("United States", "Israel", "uk")
 * to an ISO two-letter country code. Returns 'us' when nothing matches
 * so that callers always have a sane default.
 */
export function toCountryCode(location: string): string {
  const l = (location || '').trim().toLowerCase();
  const map: Record<string, string> = {
    israel: 'il',
    'united states': 'us',
    usa: 'us',
    us: 'us',
    'united kingdom': 'uk',
    uk: 'uk',
    england: 'uk',
    britain: 'uk',
    germany: 'de',
    france: 'fr',
    spain: 'es',
    italy: 'it',
    netherlands: 'nl',
    canada: 'ca',
    australia: 'au',
    india: 'in',
    japan: 'jp',
    brazil: 'br',
  };
  if (map[l]) return map[l];
  if (/^[a-z]{2}$/.test(l)) return l;
  return 'us';
}
