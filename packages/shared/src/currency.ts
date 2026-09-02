// Purely cosmetic per-player display preference — every currency here is
// 1:1 with the underlying `gold` value everywhere in the game (Settlement.
// gold, Company.cash, Government.treasury, market prices). Nothing about
// this changes any numeric field or game balance; it only changes which
// symbol/label the client renders.
export const CURRENCY_CODES = ["EUR", "USD", "GBP", "JPY"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface CurrencyDef {
  code: CurrencyCode;
  symbol: string;
  name: string;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyDef> = {
  EUR: { code: "EUR", symbol: "€", name: "Euro" },
  USD: { code: "USD", symbol: "$", name: "US Dollar" },
  GBP: { code: "GBP", symbol: "£", name: "British Pound" },
  JPY: { code: "JPY", symbol: "¥", name: "Japanese Yen" },
};

export const DEFAULT_CURRENCY: CurrencyCode = "EUR";

// Rounds to whole units (this game's amounts are never meant to be read to
// the cent) and prefixes the selected symbol — e.g. formatCurrency(1234.5,
// "EUR") -> "€1,235". Falls back to EUR for an unrecognized/未-set code
// rather than throwing, since this runs on every price/cash display.
export function formatCurrency(amount: number, currencyCode: string): string {
  const def = CURRENCIES[currencyCode as CurrencyCode] ?? CURRENCIES[DEFAULT_CURRENCY];
  return `${def.symbol}${Math.round(amount).toLocaleString()}`;
}
