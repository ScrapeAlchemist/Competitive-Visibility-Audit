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
    'united kingdom': 'gb',
    uk: 'gb',
    gb: 'gb',
    england: 'gb',
    britain: 'gb',
    'great britain': 'gb',
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

/**
 * Pick a sensible Google `hl` (interface/result language) for a country.
 * Drives Stage 1 keyword language, Stage 2 SERP language, and Stage 5
 * AI-engine prompt language. The query language picks the corpus -
 * "best backpacks" returns global English listicles regardless of `gl`,
 * but "meilleurs sacs à dos" returns the actual French market.
 *
 * English-speaking markets keep 'en'. Israel keeps 'en' to match the
 * demo's design (English SEO audience). Everything else follows the
 * country's primary language.
 */
export function defaultLanguageForCountry(country: string): string {
  const c = (country || '').toLowerCase();
  const map: Record<string, string> = {
    us: 'en',
    gb: 'en',
    ca: 'en',
    au: 'en',
    in: 'en',
    il: 'en',
    fr: 'fr',
    de: 'de',
    es: 'es',
    it: 'it',
    nl: 'nl',
    jp: 'ja',
    br: 'pt',
  };
  return map[c] || 'en';
}

/**
 * Human-readable language name for use inside Claude prompts ("generate
 * queries in French"). Falls back to 'English' for unknown codes.
 */
export function languageName(lang: string): string {
  const map: Record<string, string> = {
    en: 'English',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    it: 'Italian',
    nl: 'Dutch',
    pt: 'Portuguese',
    ja: 'Japanese',
  };
  return map[(lang || '').toLowerCase()] || 'English';
}
