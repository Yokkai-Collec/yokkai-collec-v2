export const SECTIONS = [
  "overview",
  "flows",
  "distribution",
  "players",
  "market",
  "cohorts",
  "activity",
  "risks"
] as const;
export const PERIODS = [1, 7, 30, 90, 0] as const;
export const BUCKETS = ["day", "week", "month"] as const;
export type Section = (typeof SECTIONS)[number];
export type EconomyFilters = {
  section: Section;
  days: (typeof PERIODS)[number];
  bucket: (typeof BUCKETS)[number];
  active: boolean;
  page: number;
  query: string;
  bars: boolean;
};
type Params = Record<string, string | string[] | undefined>;
export function readEconomyFilters(params: Params): EconomyFilters {
  const days = typeof params.days === "string" ? Number(params.days) : NaN;
  const page = typeof params.page === "string" ? Number(params.page) : NaN;
  return {
    section: SECTIONS.find(value => value === params.section) ?? "overview",
    days: PERIODS.find(value => value === days) ?? 30,
    bucket: BUCKETS.find(value => value === params.bucket) ?? "day",
    active: params.population !== "all",
    page: Number.isInteger(page) && page >= 0 && page <= 9999 ? page : 0,
    query:
      typeof params.query === "string" ? params.query.trim().slice(0, 80) : "",
    bars: params.chart === "bars"
  };
}
export function economyLink(
  filters: EconomyFilters,
  changes: Partial<EconomyFilters>
) {
  const next = { ...filters, page: 0, ...changes };
  const query = new URLSearchParams({
    section: next.section,
    days: String(next.days),
    bucket: next.bucket,
    population: next.active ? "active" : "all",
    chart: next.bars ? "bars" : "line"
  });
  if (next.page) query.set("page", String(next.page));
  if (next.query && next.section === "market") query.set("query", next.query);
  return "/admin/economy?" + query;
}
// SQL returns exact monetary values as text. Use BigInt for integer parts to
// avoid rounding large totals on the client. Charts deliberately scale to Number.
export function formatEconomyValue(value: string | number, locale: string) {
  if (typeof value === "number")
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(
      value
    );
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, whole, decimal] = match;
  const number = new Intl.NumberFormat(locale);
  const integer =
    sign === "-" && /^0+$/.test(whole)
      ? number.format(-0)
      : number.format(BigInt(sign + whole));
  const fraction = decimal?.replace(/0+$/, "");
  if (!fraction) return integer;
  const point =
    number.formatToParts(1.1).find(part => part.type === "decimal")?.value ??
    ".";
  return (
    integer +
    point +
    [...fraction].map(digit => number.format(Number(digit))).join("")
  );
}
