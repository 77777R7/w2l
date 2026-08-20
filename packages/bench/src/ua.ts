/**
 * Shared polite user-agent for open-web requests. Curation probe found that
 * undici's default UA is hard-blocked by Wikipedia (403) while this UA is
 * allowed. BareHttpSubject intentionally does NOT use it — it stays the
 * zero-politeness baseline against which real arms are scored.
 */
export const POLITE_UA =
  'Mozilla/5.0 (compatible; w2l-research/0.1; +https://github.com/77777R7/w2l; research benchmark, one request per page)'
