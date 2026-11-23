import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";
import { AccountMenu } from "@/components/account-menu";
import { Topbar } from "@/components/topbar";
import {
  BUCKETS,
  PERIODS,
  SECTIONS,
  economyLink,
  readEconomyFilters
} from "@/lib/admin/economy";
import { requireAdminPage } from "@/lib/auth/admin";
import { createClient } from "@/utils/supabase/server";
import { AdminNavigation } from "../admin-navigation";
import { EconomyView, type EconomyData } from "./economy-view";
import "@/styles/admin-economy.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy");
  return { title: t("title") };
}

export default async function AdminEconomyPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();
  const [params, t, locale, timeZone, cookieStore] = await Promise.all([
    searchParams,
    getTranslations("adminEconomy"),
    getLocale(),
    getTimeZone(),
    cookies()
  ]);
  const filters = readEconomyFilters(params);
  const client = createClient(cookieStore);
  const { data, error } = await client.rpc("admin_get_economy", {
    p_section: filters.section,
    p_days: filters.days,
    p_bucket: filters.bucket,
    p_active: filters.active,
    p_page: filters.page,
    p_query: filters.query
  });
  const report = data as EconomyData | null;
  const showBucket = ["flows", "market", "activity"].includes(filters.section);
  const showPeriod =
    filters.section !== "risks" &&
    filters.section !== "distribution" &&
    filters.section !== "players";
  const showPopulation =
    filters.section === "distribution" || filters.section === "players";
  return (
    <div className="min-h-dvh">
      <Topbar view="admin" account={<AccountMenu />} />
      <main id="main-content" className="yk-econ-page">
        <header>
          <h1 className="yk-title">{t("title")}</h1>
          <p className="yk-econ-note">{t("description")}</p>
        </header>
        <AdminNavigation />
        <nav className="yk-econ-tabs" aria-label={t("sections")}>
          {SECTIONS.map(section => (
            <Link
              key={section}
              aria-current={filters.section === section ? "page" : undefined}
              href={economyLink(filters, { section })}
            >
              {t("section." + section)}
            </Link>
          ))}
        </nav>
        {filters.section !== "risks" && (
          <form
            method="get"
            action="/admin/economy"
            className="yk-econ-filters"
          >
            <input type="hidden" name="section" value={filters.section} />
            <input
              type="hidden"
              name="chart"
              value={filters.bars ? "bars" : "line"}
            />
            {showPeriod ? (
              <label>
                {t("periodLabel")}
                <select name="days" defaultValue={filters.days}>
                  {PERIODS.map(days => (
                    <option key={days} value={days}>
                      {t("period.d" + days)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="days" value={filters.days} />
            )}
            {showBucket ? (
              <label>
                {t("bucketLabel")}
                <select name="bucket" defaultValue={filters.bucket}>
                  {BUCKETS.map(bucket => (
                    <option key={bucket} value={bucket}>
                      {t("bucket." + bucket)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="bucket" value={filters.bucket} />
            )}
            {showPopulation && (
              <label>
                {t("population")}
                <select
                  name="population"
                  defaultValue={filters.active ? "active" : "all"}
                >
                  <option value="active">{t("populationActive")}</option>
                  <option value="all">{t("populationAll")}</option>
                </select>
              </label>
            )}
            {filters.section === "market" && (
              <label>
                {t("cardSearch")}
                <input
                  name="query"
                  type="search"
                  maxLength={80}
                  defaultValue={filters.query}
                />
              </label>
            )}
            <button type="submit" className="yk-button yk-button-primary">
              {t("apply")}
            </button>
          </form>
        )}
        {error || !report ? (
          <p className="yk-econ-empty" role="alert">
            {t("loadError")}
          </p>
        ) : (
          <>
            {typeof report.startsAt === "string" && (
              <p className="yk-econ-note">
                {t("journalSince")}{" "}
                <time dateTime={report.startsAt}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone
                  }).format(new Date(report.startsAt))}
                </time>
                {report.partial && <> · {t("partial")}</>}
              </p>
            )}
            <EconomyView
              data={report}
              filters={filters}
              t={t}
              locale={locale}
              timeZone={timeZone}
              saved={
                typeof params.saved === "string" ? params.saved : undefined
              }
            />
          </>
        )}
      </main>
    </div>
  );
}
