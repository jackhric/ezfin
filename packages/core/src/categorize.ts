import { CATEGORY_BY_ID } from "./categories.ts";
import type { MerchantInsight, Transaction } from "./types.ts";

export interface CategoryRule {
  /** Case-insensitive regex tested against the normalized merchant and the raw description. */
  pattern: RegExp;
  categoryId: string;
  /** Optional sign constraint: "in" only matches credits, "out" only debits. */
  direction?: "in" | "out";
}

/**
 * Built-in rules. Order matters: first match wins. User overrides (exact merchant
 * -> category) are applied before these in `categorize`.
 */
export const DEFAULT_RULES: CategoryRule[] = [
  // income
  {
    pattern: /payroll|direct dep|salary|paycheck|gusto|adp |rippling|deel/i,
    categoryId: "income",
    direction: "in",
  },
  { pattern: /interest paid|interest earned|dividend/i, categoryId: "income", direction: "in" },
  { pattern: /refund|reversal|return/i, categoryId: "refund", direction: "in" },
  // utilities / telecom / insurance
  {
    pattern:
      /electric|power co|pg&e|pge|con ed|duke energy|water dept|sewer|waste mgmt|gas company|utility|utilities|comed|national grid/i,
    categoryId: "utilities",
  },
  {
    pattern:
      /verizon|at&t|att\b|t-mobile|tmobile|comcast|xfinity|spectrum|cox comm|google fi|mint mobile|visible|frontier/i,
    categoryId: "phone_internet",
  },
  {
    pattern:
      /geico|progressive|state farm|allstate|lemonade|insurance|assurant|oscar health|blue cross|aetna|cigna/i,
    categoryId: "insurance",
  },
  // transfers
  {
    pattern:
      /payment thank you|(card|crd|visa|mastercard|amex)\b.*(autopay|pymt|payment)|cardmember serv|chase card|amex epayment|capital one.*pymt|discover.*pymt|citi.*autopay/i,
    categoryId: "cc_payment",
  },
  { pattern: /transfer|zelle|venmo|cash app|wire|xfer/i, categoryId: "transfer" },
  {
    pattern:
      /vanguard|fidelity|schwab|betterment|wealthfront|robinhood|acorns|401k|roth|ira contribution/i,
    categoryId: "savings",
  },
  // housing / debt
  { pattern: /rent|mortgage|property mgmt|apartments|landlord|hoa dues/i, categoryId: "housing" },
  {
    pattern:
      /student loan|navient|nelnet|mohela|sallie|auto loan|car payment|toyota financial|honda financial|ford credit|lending club|sofi loan/i,
    categoryId: "debt",
  },
  // essentials
  {
    pattern:
      /whole foods|trader joe|safeway|kroger|aldi|costco|sam s club|wegmans|publix|heb\b|h-e-b|sprouts|food lion|giant|stop & shop|grocery|market basket|instacart/i,
    categoryId: "groceries",
  },
  {
    pattern:
      /shell|chevron|exxon|mobil|bp\b|arco|76\b|speedway|wawa|sunoco|circle k|marathon|valero|fuel|gas station|costco gas|texaco|phillips 66/i,
    categoryId: "gas",
  },
  {
    pattern:
      /uber(?! eats)|lyft|parking|metro|mta\b|bart\b|transit|amtrak|toll|ez pass|e-zpass|fastrak|caltrain/i,
    categoryId: "transport",
  },
  {
    pattern:
      /cvs|walgreens|rite aid|pharmacy|dental|dentist|clinic|medical|hospital|doctor|labcorp|quest diag|optometr|urgent care/i,
    categoryId: "health",
  },
  // lifestyle
  {
    pattern:
      /netflix|spotify|hulu|disney\+|disney plus|hbo|max\b|apple\.com|apple tv|icloud|youtube|paramount|peacock|audible|kindle unlimited|adobe|dropbox|google one|google storage|microsoft 365|openai|chatgpt|anthropic|claude|github|notion|1password|nyt|new york times|wsj|patreon|substack|twitch|crunchyroll|playstation|xbox|nintendo/i,
    categoryId: "subscriptions",
  },
  {
    pattern:
      /planet fitness|equinox|la fitness|24 hour fitness|crossfit|peloton|yoga|gym|orangetheory|barry s|climbing/i,
    categoryId: "fitness",
  },
  {
    pattern:
      /doordash|uber eats|grubhub|postmates|seamless|chipotle|starbucks|mcdonald|taco bell|wendy|burger|pizza|sushi|ramen|cafe|coffee|restaurant|grill|kitchen|bistro|taqueria|deli|bakery|bar\b|pub\b|tavern|brewery|dunkin|panera|chick-fil-a|sweetgreen|cava|in-n-out|wingstop|popeyes|subway|dominos|thai|pho\b|noodle|bbq|steakhouse/i,
    categoryId: "dining",
  },
  {
    pattern:
      /amazon|amzn|target|walmart|best buy|home depot|lowe s|ikea|wayfair|etsy|ebay|nike|zara|h&m|uniqlo|nordstrom|macy|gap\b|old navy|sephora|ulta|apple store|shopify|temu|shein|rei\b|dick s sporting/i,
    categoryId: "shopping",
  },
  {
    pattern:
      /amc|regal|cinemark|cinema|theatre|theater|ticketmaster|stubhub|eventbrite|steam games|steamgames|steampowered|concert|museum|bowling|arcade|dave & buster/i,
    categoryId: "entertainment",
  },
  {
    pattern:
      /airlines|airline|delta|united|american air|southwest|jetblue|alaska air|spirit air|frontier air|airbnb|vrbo|marriott|hilton|hyatt|hotel|motel|expedia|booking\.com|kayak|hertz|avis|enterprise rent|turo|hostel/i,
    categoryId: "travel",
  },
  {
    pattern: /salon|barber|haircut|spa\b|nails|massage|great clips|supercuts/i,
    categoryId: "personal",
  },
  {
    pattern: /donation|charity|red cross|gofundme|church|tithe|unicef|wikimedia|patreon/i,
    categoryId: "gifts",
  },
  // financial
  {
    pattern:
      /overdraft|late fee|annual fee|service fee|interest charge|finance charge|atm fee|foreign transaction|monthly fee|maintenance fee/i,
    categoryId: "fees",
  },
];

export interface CategorizeOptions {
  /** Exact normalized merchant -> categoryId overrides, learned from the user. Always win. */
  overrides?: ReadonlyMap<string, string>;
  /** Conclusions from a local model, keyed by merchant. Applied after overrides and before rules. */
  insights?: ReadonlyMap<string, Pick<MerchantInsight, "categoryId" | "confidence">>;
  /** Insights below this confidence are ignored. Default 0.6. */
  minConfidence?: number;
  rules?: CategoryRule[];
}

/**
 * Categories that describe money movement rather than spending. The keyword rules
 * are precise here ("PAYMENT THANK YOU", "PAYROLL", "AUTOPAY" on a card) while a
 * small model tends to call a card payment "debt" or interest "fees", which would
 * double count spending. So a model insight may only re-file a transaction among
 * spending categories, or lift it out of "uncategorized".
 */
export function isMoneyMovement(categoryId: string): boolean {
  const group = CATEGORY_BY_ID.get(categoryId)?.group;
  return group === "income" || group === "transfer" || categoryId === "savings";
}

export function categorizeOne(
  tx: Pick<Transaction, "merchant" | "description" | "amount">,
  options: CategorizeOptions = {},
): string {
  const override = options.overrides?.get(tx.merchant);
  if (override) return override;
  const byRules = categorizeByRules(tx, options.rules ?? DEFAULT_RULES);
  const insight = options.insights?.get(tx.merchant);
  if (
    insight &&
    insight.categoryId !== "uncategorized" &&
    insight.confidence >= (options.minConfidence ?? 0.6) &&
    !isMoneyMovement(byRules) &&
    (byRules === "uncategorized" || !isMoneyMovement(insight.categoryId))
  ) {
    return insight.categoryId;
  }
  return byRules;
}

export function categorizeByRules(
  tx: Pick<Transaction, "merchant" | "description" | "amount">,
  rules: CategoryRule[] = DEFAULT_RULES,
): string {
  const haystack = `${tx.merchant} | ${tx.description}`;
  for (const rule of rules) {
    if (rule.direction === "in" && tx.amount <= 0) continue;
    if (rule.direction === "out" && tx.amount >= 0) continue;
    if (rule.pattern.test(haystack)) return rule.categoryId;
  }
  // Unmatched credits are most likely income or refunds; unmatched debits are unknown.
  return tx.amount > 0 ? "income" : "uncategorized";
}

export function categorizeAll<T extends Pick<Transaction, "merchant" | "description" | "amount">>(
  txs: T[],
  options: CategorizeOptions = {},
): (T & { categoryId: string })[] {
  return txs.map((tx) => ({ ...tx, categoryId: categorizeOne(tx, options) }));
}
