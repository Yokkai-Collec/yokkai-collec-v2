"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  GRID_CARD_IMAGE_SIZES,
  YokaiCard,
  type YokaiCardProps
} from "@/components/yokai-card";
import { matchesCardSearch } from "@/lib/ui/card-search";
import { createClient } from "@/utils/supabase/client";
import { RecoveryQueue } from "./recovery-queue";
import "@/styles/black-market.css";

type StockItem = Pick<
  YokaiCardProps,
  "name" | "rarity" | "image" | "category" | "anime" | "shiny" | "isEvolved"
> & { instanceId: string };

type Stock = {
  enabled: boolean;
  minDay: string;
  scheduledDay: string | null;
  selectedIds: string[];
  items: StockItem[];
  recoveryRuns?: {
    id: number;
    checkedAt: string;
    checkedAccounts: number;
    recoveredLR: number;
    recoveredSSR: number;
    deferredAccounts: number;
  }[];
};

const maxLots = 60;

export function BlackMarketAdmin({ previewStock }: { previewStock?: Stock }) {
  const t = useTranslations("blackMarket");
  const tm = useTranslations("market");
  const format = useFormatter();
  const [stock, setStock] = useState(previewStock);
  const [day, setDay] = useState(previewStock?.scheduledDay ?? "");
  const [selected, setSelected] = useState(previewStock?.selectedIds ?? []);
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (previewStock) return;
    let active = true;
    void Promise.resolve(createClient().rpc("admin_get_black_market_stock"))
      .then(({ data, error }) => {
        if (!active) return;
        if (error) throw error;
        const next = data as Stock;
        setStock(next);
        setDay(next.scheduledDay ?? "");
        setSelected(next.selectedIds);
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setMessage(t("unavailable"));
        }
      });
    return () => {
      active = false;
    };
  }, [t, previewStock]);

  async function scheduleEdition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (previewStock || busy) return;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const db = createClient();
      const { error } = await db.rpc("admin_schedule_black_market_edition", {
        p_day: day,
        p_card_ids: selected
      });
      if (error) throw error;
      const { data, error: refreshError } = await db.rpc(
        "admin_get_black_market_stock"
      );
      if (refreshError) throw refreshError;
      const next = data as Stock;
      setStock(next);
      setDay(next.scheduledDay ?? "");
      setSelected(next.selectedIds);
      setMessage(t("editionSaved"));
    } catch (error) {
      const code =
        typeof error === "object" && error && "message" in error
          ? String(error.message)
          : "";
      const keys: Record<string, string> = {
        BLACK_MARKET_DISABLED: "disabled",
        BLACK_MARKET_CARD_UNAVAILABLE: "cardUnavailable",
        BLACK_MARKET_INVALID_DAY: "invalidDay",
        BLACK_MARKET_INVALID_SELECTION: "invalidSelection",
        BLACK_MARKET_EDITION_STARTED: "editionStarted"
      };
      setFailed(true);
      setMessage(t(keys[code] ?? "unavailable"));
    } finally {
      setBusy(false);
    }
  }

  const categories = [
    ...new Set(stock?.items.map(item => item.category))
  ].sort();
  const categoryFilter = categories.includes(category) ? category : "";
  const matches = stock?.items.filter(
    item =>
      (!rarity || item.rarity === rarity) &&
      (!categoryFilter || item.category === categoryFilter) &&
      matchesCardSearch(query, [item.name, item.rarity])
  );
  const copiesByName = new Map<string, number>();
  for (const item of stock?.items ?? []) {
    copiesByName.set(item.name, (copiesByName.get(item.name) ?? 0) + 1);
  }
  const recoveryRuns = stock?.recoveryRuns ?? [];
  return (
    <div className="yk-black-market-admin">
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
      {!stock && !failed && <p role="status">{t("loading")}</p>}
      {stock && (
        <>
          <form
            className="yk-black-market-edition"
            onSubmit={event => void scheduleEdition(event)}
          >
            <header>
              <h2>{t("nextEdition")}</h2>
              <p>{t("editionHours")}</p>
            </header>
            <div className="yk-black-market-edition-rules">
              <p>{t("rarityBidRule", { rarity: "LR", amount: 1000 })}</p>
              <p>{t("rarityBidRule", { rarity: "SSR", amount: 500 })}</p>
            </div>
            <label className="yk-black-market-edition-day">
              {t("openingDay")}
              <input
                name="opening-day"
                type="date"
                required
                min={stock.minDay}
                value={day}
                onChange={event => setDay(event.target.value)}
                disabled={busy}
              />
            </label>
            {!stock.enabled && <p role="status">{t("scheduleDisabled")}</p>}
            <fieldset disabled={busy}>
              <legend>{t("stock")}</legend>
              {stock.items.length ? (
                <>
                  <div className="yk-black-market-stock-filters">
                    <label>
                      {t("searchStock")}
                      <input
                        type="search"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                      />
                    </label>
                    <label>
                      {tm("rarity")}
                      <select
                        value={rarity}
                        onChange={event => setRarity(event.target.value)}
                      >
                        <option value="">{t("allStockOptions")}</option>
                        <option value="LR">LR</option>
                        <option value="SSR">SSR</option>
                      </select>
                    </label>
                    <label>
                      {tm("category")}
                      <select
                        value={categoryFilter}
                        onChange={event => setCategory(event.target.value)}
                      >
                        <option value="">{t("allStockOptions")}</option>
                        {categories.map(option => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {matches?.length ? (
                    <ul className="yk-black-market-edition-stock">
                      {matches.map(({ instanceId, ...card }) => {
                        const checked = selected.includes(instanceId);
                        const shortId = instanceId.slice(-6);
                        return (
                          <li
                            key={instanceId}
                            className="yk-black-market-edition-lot"
                          >
                            <label className="yk-black-market-lot-target">
                              <input
                                className="sr-only"
                                type="checkbox"
                                aria-label={t("stockOption", {
                                  name: card.name,
                                  rarity: card.rarity,
                                  id: shortId
                                })}
                                checked={checked}
                                disabled={
                                  !checked && selected.length >= maxLots
                                }
                                onChange={() => {
                                  setSelected(previous =>
                                    previous.includes(instanceId)
                                      ? previous.filter(id => id !== instanceId)
                                      : previous.length < maxLots
                                        ? [...previous, instanceId]
                                        : previous
                                  );
                                }}
                              />
                            </label>
                            <div aria-hidden="true">
                              <YokaiCard
                                {...card}
                                animated={false}
                                imageSizes={GRID_CARD_IMAGE_SIZES}
                              />
                              <div className="yk-black-market-lot-state">
                                <span className="yk-black-market-lot-mark">
                                  ✓
                                </span>
                                {t(checked ? "stockSelected" : "stockAdd")}
                              </div>
                              {(copiesByName.get(card.name) ?? 0) > 1 && (
                                <span className="yk-black-market-lot-copy">
                                  #{shortId}
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-3">{t("noStockMatch")}</p>
                  )}
                </>
              ) : (
                <p>{t("emptyStock")}</p>
              )}
            </fieldset>
            <div className="yk-black-market-edition-actions">
              <p role="status">
                {t("selectedLots", { count: selected.length })}
              </p>
              <button
                disabled={busy || !stock.enabled || !day || !selected.length}
                type="submit"
              >
                {t(stock.scheduledDay ? "updateEdition" : "scheduleEdition")}
              </button>
            </div>
          </form>
          {!previewStock && <RecoveryQueue enabled={stock.enabled} />}
          <section
            className="yk-black-market-recovery-log"
            aria-labelledby="black-market-recovery-log-heading"
          >
            <h2 id="black-market-recovery-log-heading">{t("recoveryLog")}</h2>
            {recoveryRuns.length ? (
              <ul>
                {recoveryRuns.map(run => (
                  <li key={run.id}>
                    <time dateTime={run.checkedAt}>
                      {format.dateTime(new Date(run.checkedAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Europe/Paris"
                      })}
                    </time>
                    <span>
                      {t("recoveryCounts", {
                        lr: run.recoveredLR,
                        ssr: run.recoveredSSR
                      })}
                    </span>
                    <span>
                      {t("recoveryAccounts", {
                        checked: run.checkedAccounts,
                        deferred: run.deferredAccounts
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("noRecoveryRuns")}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
