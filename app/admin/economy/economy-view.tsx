import type { ReactNode } from "react";
import Link from "next/link";
import { EconomyChart, type PlotSeries } from "./economy-chart";
import { saveEconomyThresholds } from "./actions";
import {
  economyLink,
  formatEconomyValue,
  type EconomyFilters
} from "@/lib/admin/economy";

type Scalar = string | number | null | undefined;
type Row = Record<string, Scalar>;
type Alert = {
  key: string;
  value: number | null;
  threshold: number;
  alert: boolean | null;
  samples?: number;
  previousSamples?: number;
};
export type EconomyData = Row & {
  previous?: Row | null;
  series?: Row[];
  categories?: Row[];
  trend?: Row[];
  lorenz?: Row[];
  stats?: Row[];
  cohorts?: Row[];
  cards?: Row[];
  rows?: Row[];
  alerts?: Alert[];
  rarities?: Record<string, number>;
};

type Translate = (key: string, values?: Record<string, string>) => string;

export function EconomyTable({
  title,
  columns,
  rows,
  empty
}: {
  title: string;
  columns: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  if (!rows.length) return <p className="yk-econ-empty">{empty}</p>;
  return (
    <div
      className="yk-econ-table-scroll"
      role="region"
      aria-label={title}
      tabIndex={0}
    >
      <table className="yk-econ-table">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((line, index) => (
            <tr key={index}>
              {line.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex}>{cell}</td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="yk-econ-panel">
      <h2>{title}</h2>
      {description && <p className="yk-econ-note">{description}</p>}
      {children}
    </section>
  );
}

export function EconomyView({
  data,
  filters,
  t,
  locale,
  timeZone,
  saved
}: {
  data: EconomyData;
  filters: EconomyFilters;
  t: Translate;
  locale: string;
  timeZone: string;
  saved?: string;
}) {
  const exact = (value: Scalar) =>
    value === null || value === undefined
      ? t("unavailable")
      : formatEconomyValue(value, locale);
  const percent = (value: Scalar) =>
    value === null || value === undefined
      ? t("unavailable")
      : exact(value) + " %";
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone
  });
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone
  });
  const time = (value: Scalar, precise = false) => {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
      return t("unavailable");
    return (
      <time dateTime={value}>
        {(precise ? dateTime : date).format(new Date(value))}
      </time>
    );
  };
  const shorthand = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1
  });
  const chartNumber = (value: number) => shorthand.format(value);
  const category = (key: Scalar) =>
    t("category." + String(key ?? "unclassified"));
  const entity = (key: Scalar) =>
    key === "unknown" || key === null ? t("unavailable") : String(key ?? "");
  const table = (title: string, columns: string[], rows: ReactNode[][]) => (
    <EconomyTable
      title={title}
      columns={columns.map(column => t(column))}
      rows={rows}
      empty={t("empty")}
    />
  );
  const compactSeries = (
    rows: Row[],
    name: string,
    key: string
  ): PlotSeries => ({
    label: name,
    points: rows.flatMap(row => {
      const at = Date.parse(String(row.at));
      const amount = row[key];
      return amount !== null &&
        amount !== undefined &&
        Number.isFinite(at) &&
        Number.isFinite(Number(amount))
        ? [{ at, label: date.format(new Date(at)), value: Number(amount) }]
        : [];
    })
  });
  const plot = (
    title: string,
    lines: PlotSeries[],
    detail?: ReactNode,
    bars = false
  ) => (
    <EconomyChart
      title={title}
      empty={t("empty")}
      dataLabel={t("chartData")}
      series={lines}
      format={chartNumber}
      details={detail}
      bars={bars}
    />
  );
  const series = data.series ?? [];

  switch (filters.section) {
    case "overview": {
      const previous = data.previous;
      const previousMoney = data.previousMoney;
      const change = (key: string) => {
        const historic = previous?.[key];
        const current = data[key];
        if (typeof historic !== "string" || typeof current !== "string")
          return null;
        return (BigInt(current) - BigInt(historic)).toString();
      };
      const moneyChange =
        typeof data.money === "string" && typeof previousMoney === "string"
          ? (BigInt(data.money) - BigInt(previousMoney)).toString()
          : null;
      const tiles = [
        {
          key: "created",
          value: exact(data.created),
          trend: change("created")
        },
        {
          key: "destroyed",
          value: exact(data.destroyed),
          trend: change("destroyed")
        },
        { key: "money", value: exact(data.money), trend: moneyChange },
        { key: "net", value: exact(data.net), trend: change("net") },
        {
          key: "active",
          value: exact(data.active),
          trend:
            typeof data.active === "number" &&
            typeof data.previousActive === "number"
              ? String(data.active - data.previousActive)
              : null
        },
        {
          key: "growth",
          value: percent(data.growth),
          trend:
            typeof data.growthChange === "number"
              ? String(data.growthChange)
              : null
        }
      ];
      return (
        <>
          <div className="yk-econ-kpis">
            {tiles.map(item => (
              <article key={item.key} className="yk-econ-kpi">
                <h2>{t(item.key)}</h2>
                <strong>{item.value}</strong>
                <p
                  data-trend={
                    item.trend === null
                      ? "unknown"
                      : Number(item.trend) > 0
                        ? "up"
                        : Number(item.trend) < 0
                          ? "down"
                          : "same"
                  }
                >
                  {item.trend === null ? (
                    t("unavailableTrend")
                  ) : (
                    <>
                      {Number(item.trend) > 0
                        ? "↑ "
                        : Number(item.trend) < 0
                          ? "↓ "
                          : "= "}
                      {item.key === "growth"
                        ? t("percentagePoints", { value: exact(item.trend) })
                        : exact(item.trend)}{" "}
                      · {t("previousPeriod")}
                    </>
                  )}
                </p>
                <details>
                  <summary>{t("method")}</summary>
                  <p>{t("method_" + item.key)}</p>
                </details>
              </article>
            ))}
          </div>
          <Panel title={t("moneyHistory")} description={t("snapshotNote")}>
            {plot(
              t("moneyHistory"),
              [compactSeries(series, t("money"), "value")],
              table(
                t("moneyHistory"),
                ["date", "money"],
                series.map(row => [time(row.at, true), exact(row.value)])
              )
            )}
          </Panel>
          <Panel title={t("balanceDetails")} description={t("escrowNote")}>
            {table(
              t("balanceDetails"),
              ["measure", "value"],
              [
                [t("wallet"), exact(data.wallet)],
                [t("escrow"), exact(data.escrow)],
                [t("tradeHolds"), exact(data.tradeHolds)],
                [t("holders"), exact(data.holders)],
                [t("median"), exact(data.median)],
                [t("average"), exact(data.average)],
                [
                  t("change7"),
                  <>
                    {exact(data.after7)} · {percent(data.growth7)}
                  </>
                ],
                [
                  t("change30"),
                  <>
                    {exact(data.after30)} · {percent(data.growth30)}
                  </>
                ],
                [t("adjustments"), exact(data.adjustments)],
                [
                  t("unknown"),
                  <>
                    {exact(data.unknown)} · {exact(data.unclassified)}{" "}
                    {t("entries")}
                  </>
                ],
                [
                  t("reconciliation"),
                  <>
                    {exact(data.walletDiscrepancy)} ·{" "}
                    {time(data.reconciledAt, true)}
                  </>
                ]
              ]
            )}
          </Panel>
        </>
      );
    }
    case "flows": {
      const trend = data.trend ?? [];
      return (
        <>
          <Panel title={t("flowsChart")} description={t("flowNote")}>
            <div className="yk-econ-view-toggle">
              {[false, true].map(bars => (
                <Link
                  key={String(bars)}
                  aria-current={filters.bars === bars ? "true" : undefined}
                  href={economyLink(filters, { bars })}
                >
                  {t(bars ? "bars" : "line")}
                </Link>
              ))}
            </div>
            {plot(
              t("flowsChart"),
              [
                compactSeries(series, t("created"), "created"),
                compactSeries(series, t("destroyed"), "destroyed"),
                compactSeries(series, t("net"), "net")
              ],
              table(
                t("flowsChart"),
                ["date", "created", "destroyed", "net"],
                series.map(row => [
                  time(row.at),
                  exact(row.created),
                  exact(row.destroyed),
                  exact(row.net)
                ])
              ),
              filters.bars
            )}
          </Panel>
          {["source", "sink", "adjustment", "unknown"].map(kind => (
            <Panel key={kind} title={t("kind." + kind)}>
              {table(
                t("kind." + kind),
                ["mechanism", "value", "share", "operations", "playersCount"],
                (data.categories ?? [])
                  .filter(row => row.kind === kind)
                  .map(row => [
                    category(row.category),
                    exact(row.amount),
                    percent(row.share),
                    exact(row.operations),
                    exact(row.players)
                  ])
              )}
            </Panel>
          ))}
          <Panel title={t("trendByCategory")}>
            {table(
              t("trendByCategory"),
              ["date", "mechanism", "value"],
              trend.map(row => [
                time(row.at),
                category(row.category),
                exact(row.amount)
              ])
            )}
          </Panel>
        </>
      );
    }
    case "distribution": {
      const lorenz = (data.lorenz ?? []).filter(row => row.wealth !== null);
      return (
        <>
          <Panel
            title={t("wealthDistribution")}
            description={t(
              filters.active ? "populationActiveNote" : "populationAllNote"
            )}
          >
            {table(
              t("wealthDistribution"),
              ["measure", "value"],
              [
                [t("playersCount"), exact(data.players)],
                [t("money"), exact(data.money)],
                [t("top1"), percent(data.top1)],
                [t("top5"), percent(data.top5)],
                [t("top10"), percent(data.top10)],
                [t("bottom50"), percent(data.bottom50)],
                [t("median"), exact(data.median)],
                [t("average"), exact(data.average)],
                [t("gini"), exact(data.gini)]
              ]
            )}
          </Panel>
          <Panel title={t("lorenz")} description={t("lorenzNote")}>
            <EconomyChart
              title={t("lorenz")}
              empty={t("empty")}
              dataLabel={t("chartData")}
              fixedMax={100}
              format={value => percent(value)}
              series={[
                {
                  label: t("lorenz"),
                  points: lorenz.map(row => ({
                    at: Number(row.population),
                    label: percent(row.population),
                    value: Number(row.wealth)
                  }))
                },
                {
                  label: t("equality"),
                  points:
                    lorenz.length > 0
                      ? [
                          { at: 0, label: "0 %", value: 0 },
                          { at: 100, label: "100 %", value: 100 }
                        ]
                      : []
                }
              ]}
              details={table(
                t("lorenz"),
                ["playersCount", "share"],
                lorenz.map(row => [
                  percent(row.population),
                  percent(row.wealth)
                ])
              )}
            />
          </Panel>
        </>
      );
    }
    case "players":
      return (
        <Panel title={t("richestPlayers")} description={t("playersNote")}>
          <p className="yk-econ-note">
            {t("journalSince")} {time(data.since, true)}
          </p>
          {table(
            t("richestPlayers"),
            [
              "player",
              "wallet",
              "totalBalance",
              "share",
              "created30",
              "spent30",
              "sent30",
              "received30",
              "joined",
              "lastSeen"
            ],
            (data.rows ?? []).map(row => [
              row.player,
              exact(row.balance),
              exact(row.total),
              percent(row.share),
              exact(row.created),
              exact(row.spent),
              exact(row.sent),
              exact(row.received),
              time(row.joined),
              time(row.lastSeen, true)
            ])
          )}
          <nav className="yk-econ-pages" aria-label={t("pagination")}>
            {filters.page > 0 && (
              <Link href={economyLink(filters, { page: filters.page - 1 })}>
                {t("previous")}
              </Link>
            )}
            <span>
              {t("page")} {exact(filters.page + 1)} · {exact(data.total)}{" "}
              {t("playersCount").toLocaleLowerCase(locale)}
            </span>
            {(filters.page + 1) * Number(data.pageSize ?? 25) <
              Number(data.total ?? 0) && (
              <Link href={economyLink(filters, { page: filters.page + 1 })}>
                {t("next")}
              </Link>
            )}
          </nav>
        </Panel>
      );
    case "market": {
      const rarities = [...new Set(series.map(row => String(row.rarity)))];
      return (
        <>
          <Panel title={t("marketPrices")} description={t("marketNote")}>
            {table(
              t("marketPrices"),
              [
                "rarity",
                "median",
                "average",
                "low",
                "high",
                "sales",
                "volume",
                "change7",
                "change30"
              ],
              (data.stats ?? []).map(row => [
                entity(row.rarity),
                exact(row.median),
                exact(row.average),
                exact(row.lowest),
                exact(row.highest),
                exact(row.sales),
                exact(row.volume),
                percent(row.change7),
                percent(row.change30)
              ])
            )}
          </Panel>
          <Panel title={t("marketHistory")}>
            {plot(
              t("marketHistory"),
              rarities.map(rarity =>
                compactSeries(
                  series.filter(row => row.rarity === rarity),
                  entity(rarity),
                  "median"
                )
              ),
              table(
                t("marketHistory"),
                ["date", "rarity", "median", "sales"],
                series.map(row => [
                  time(row.at),
                  entity(row.rarity),
                  exact(row.median),
                  exact(row.sales)
                ])
              )
            )}
          </Panel>
        </>
      );
    }
    case "cohorts": {
      const cohorts = data.cohorts ?? [];
      const sorted = [
        "new",
        "recent",
        "intermediate",
        "veteran",
        "unknown"
      ].flatMap(key => cohorts.filter(row => row.generation === key));
      const rare = new Map(
        (data.cards ?? []).map(row => [row.generation, row])
      );
      return (
        <>
          <Panel title={t("cohortTitle")} description={t("cohortNote")}>
            <p className="yk-econ-note">
              {t("catchup")} · <strong>{percent(data.catchup)}</strong>
            </p>
            {plot(
              t("medianByCohort"),
              [
                {
                  label: t("median"),
                  points: sorted.flatMap((row, index) =>
                    row.median == null
                      ? []
                      : [
                          {
                            at: index,
                            label: t("generation." + String(row.generation)),
                            value: Number(row.median)
                          }
                        ]
                  )
                }
              ],
              undefined,
              true
            )}
            {table(
              t("cohortTitle"),
              [
                "cohort",
                "playersCount",
                "average",
                "median",
                "created",
                "received",
                "spent",
                "sales"
              ],
              sorted.map(row => [
                t("generation." + String(row.generation)),
                exact(row.players),
                exact(row.average),
                exact(row.median),
                exact(row.created),
                exact(row.received),
                exact(row.spent),
                exact(row.sales)
              ])
            )}
          </Panel>
          <Panel title={t("rareByCohort")} description={t("cardsNote")}>
            <p className="yk-econ-note">{time(data.cardsAt, true)}</p>
            {table(
              t("rareByCohort"),
              [
                "cohort",
                "averageCards",
                "medianCards",
                "sr",
                "ssr",
                "lr",
                "rareMedian"
              ],
              sorted
                .filter(row => rare.has(row.generation))
                .map(row => {
                  const info = rare.get(row.generation);
                  return [
                    t("generation." + String(row.generation)),
                    exact(info?.average),
                    exact(info?.median),
                    exact(info?.sr),
                    exact(info?.ssr),
                    exact(info?.lr),
                    exact(info?.rare_median)
                  ];
                })
            )}
          </Panel>
        </>
      );
    }
    case "activity": {
      const channels = [...new Set(series.map(row => String(row.channel)))];
      return (
        <>
          <Panel title={t("activityTitle")} description={t("activityNote")}>
            {table(
              t("activityTitle"),
              ["measure", "value"],
              [
                [t("listed"), exact(data.listed)],
                [t("sold"), exact(data.sold)],
                [t("cancelled"), exact(data.cancelled)],
                [t("reversed"), exact(data.reversed)],
                [t("volume"), exact(data.volume)],
                [t("median"), exact(data.median)],
                [t("buyers"), exact(data.buyers)],
                [t("sellers"), exact(data.sellers)],
                [t("transferCount"), exact(data.transferCount)],
                [t("transferVolume"), exact(data.transferVolume)],
                [t("transferMedian"), exact(data.transferMedian)],
                [t("tradeCount"), exact(data.tradeCount)],
                [t("tradeVolume"), exact(data.tradeVolume)],
                [t("tradeMedian"), exact(data.tradeMedian)],
                [t("senders"), exact(data.senders)],
                [t("recipients"), exact(data.recipients)],
                [t("directTransfers"), exact(data.directTransfers)]
              ]
            )}
          </Panel>
          <Panel title={t("salesByRarity")}>
            {table(
              t("salesByRarity"),
              ["rarity", "sales"],
              Object.entries(data.rarities ?? {}).map(([key, value]) => [
                entity(key),
                exact(value)
              ])
            )}
          </Panel>
          <Panel title={t("activityVolume")}>
            {plot(
              t("activityVolume"),
              channels.map(channel =>
                compactSeries(
                  series.filter(row => row.channel === channel),
                  t("channel." + channel),
                  "amount"
                )
              ),
              table(
                t("activityVolume"),
                ["date", "mechanism", "operations", "volume"],
                series.map(row => [
                  time(row.at),
                  t("channel." + row.channel),
                  exact(row.operations),
                  exact(row.amount)
                ])
              )
            )}
          </Panel>
        </>
      );
    }
    case "risks": {
      const fields = [
        { key: "money", name: "p_money", max: 1000 },
        { key: "concentration", name: "p_concentration", max: 100 },
        { key: "prices", name: "p_prices", max: 1000 },
        { key: "progression", name: "p_progression", max: 100 },
        { key: "activity", name: "p_activity", max: 100 }
      ];
      return (
        <>
          <Panel title={t("riskTitle")} description={t("riskNote")}>
            {table(
              t("riskTitle"),
              ["measure", "value", "threshold", "sample", "status"],
              (data.alerts ?? []).map(alert => [
                t("risk." + alert.key),
                percent(alert.value),
                percent(alert.threshold),
                alert.samples === undefined
                  ? t("unavailable")
                  : exact(alert.samples) + " / " + exact(alert.previousSamples),
                <span
                  key={alert.key}
                  className="yk-econ-alert"
                  data-active={alert.alert === true}
                >
                  {t(
                    alert.alert === null
                      ? "unavailable"
                      : alert.alert
                        ? "watch"
                        : "withinThreshold"
                  )}
                </span>
              ])
            )}
          </Panel>
          <Panel title={t("settingsTitle")}>
            {saved && (
              <p role="status" className="yk-econ-note">
                {t(saved === "yes" ? "saved" : "saveError")}
              </p>
            )}
            <form action={saveEconomyThresholds} className="yk-econ-filters">
              {fields.map(field => (
                <label key={field.name}>
                  {t("risk." + field.key)}
                  <input
                    required
                    name={field.name}
                    type="number"
                    min="1"
                    max={field.max}
                    step="0.1"
                    defaultValue={
                      data.alerts?.find(alert => alert.key === field.key)
                        ?.threshold
                    }
                  />
                </label>
              ))}
              <label>
                {t("minSales")}
                <input
                  required
                  name="p_min_sales"
                  type="number"
                  min="5"
                  max="1000"
                  defaultValue={data.minSales ?? 20}
                />
              </label>
              <button type="submit" className="yk-button yk-button-primary">
                {t("save")}
              </button>
            </form>
          </Panel>
        </>
      );
    }
  }
}
