/**
 * Normalize a raw bank description into a stable merchant key.
 *
 * Bank descriptions are noisy: "SQ *BLUE BOTTLE COFFEE 0412 SAN FRANCISCO CA"
 * and "SQ *BLUE BOTTLE COFFEE 0419 SAN FRANCISCO CA" are the same merchant.
 * We strip payment-processor prefixes, store numbers, dates, reference codes
 * and trailing city/state so repeated charges collapse onto one key.
 */
const PROCESSOR_PREFIXES =
  /^(sq \*|sq\*|tst\*|tst \*|pp\*|paypal \*|paypal\*|apl\*|google \*|goog\*|pos debit|pos purchase|debit card purchase|card purchase|check card|recurring payment|ach debit|ach credit|web pmt|online payment|purchase authorized on \d{2}\/\d{2})\s*/i;

const US_STATE =
  /\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\b\s*$/i;

export function normalizeMerchant(description: string): string {
  let s = description.toLowerCase().trim();
  s = s.replace(PROCESSOR_PREFIXES, "");
  // dates like 03/14, 03/14/24, 2024-03-14
  s = s.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ");
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  // phone numbers
  s = s.replace(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/g, " ");
  // long digit runs / reference codes / card last-4 (keep short numbers that are part of names, e.g. "7-eleven")
  s = s.replace(/\b[a-z]*\d{4,}[a-z0-9]*\b/g, " ");
  s = s.replace(/#\s*\d+/g, " ");
  // mixed letter+digit reference codes like "2k4lm" or "1l8zq" (4+ chars, both kinds)
  s = s.replace(/\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{4,}\b/g, " ");
  // urls and emails
  s = s.replace(/\b[\w.-]+\.(com|net|org|io|co|tv)\b(\/\S*)?/g, (m) => m.split(".")[0] ?? m);
  // trailing city/state
  s = s.replace(US_STATE, " ");
  // punctuation to spaces
  s = s.replace(/[*_|,.:;()[\]{}'"\\/-]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // drop trailing single tokens that are usually city names after we removed state (best effort: keep max 4 words)
  const words = s.split(" ").filter(Boolean);
  return words.slice(0, 4).join(" ");
}

/** Human-friendly label from a merchant key. */
export function displayMerchant(key: string): string {
  return key
    .split(" ")
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}
