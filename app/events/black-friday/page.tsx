import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { AccountMenu } from "@/components/account-menu";
import { LeaderboardTopbar } from "@/components/leaderboard-topbar";
import { YokaiCard } from "@/components/yokai-card";
import { getCurrentUser } from "@/lib/auth/session";
import {
  BLACKOUT_EVENT_PATH,
  BLACKOUT_SLUG,
  blackFridayTerms,
  blackoutCards,
  blackoutPreviewEnabled
} from "@/lib/data/blackout-preview";
import "@/styles/gta-sunset.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("blackout");
  return { title: t("title"), robots: { index: false } };
}

export default async function BlackFridayPage() {
  if (!blackoutPreviewEnabled) notFound();
  if (!(await getCurrentUser())) redirect(`/login?next=${BLACKOUT_EVENT_PATH}`);
  const [t, format] = await Promise.all([
    getTranslations("blackout"),
    getFormatter()
  ]);
  const { startsAt, endsAt, freePacks, firstMonthPrice, renewalPrice } =
    blackFridayTerms;
  const dates = format.dateTimeRange(
    new Date(startsAt),
    new Date(Date.parse(endsAt) - 1),
    { day: "numeric", month: "long", timeZone: "Europe/Paris" }
  );
  const offer = t("proPrice", {
    first: format.number(firstMonthPrice, {
      style: "currency",
      currency: "EUR"
    }),
    renewal: format.number(renewalPrice, { style: "currency", currency: "EUR" })
  });

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <LeaderboardTopbar view="events" account={<AccountMenu />} />
      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl min-w-0 px-3 py-6 sm:px-6 sm:py-10"
      >
        <Link className="text-sm text-ink-2 hover:text-ink-1" href="/events">
          <span aria-hidden="true">← </span>
          {t("backToEvents")}
        </Link>
        <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">{t("preview")}</p>
            <h1 className="yk-title mt-1">{t("title")}</h1>
            <p className="mt-2 text-sm text-ink-2">{dates}</p>
          </div>
          <Link
            className="yk-button yk-button-primary"
            href={`/boosters#${BLACKOUT_SLUG}`}
          >
            {t("viewBooster")}
          </Link>
        </header>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <section className="rounded-card border border-veil bg-surface p-4">
            <h2 className="font-bold">{t("boosterTitle")}</h2>
            <p className="mt-1 text-sm text-ink-2">
              {t("dailyPacks", freePacks)}
            </p>
            <p className="mt-1 text-sm text-ink-2">{t("karasPacks")}</p>
          </section>
          <section className="rounded-card border border-veil bg-surface p-4">
            <h2 className="font-bold">Yokkai Pro</h2>
            <p className="mt-1 text-sm text-ink-2">{offer}</p>
          </section>
        </div>
        <section
          className="yk-blackout-roster"
          aria-labelledby="blackout-roster-title"
        >
          <h2
            id="blackout-roster-title"
            className="font-display text-xl font-bold"
          >
            {t("roster")}
          </h2>
          <ul>
            {blackoutCards.map(card => (
              <li key={card.id}>
                <YokaiCard {...card} animated={false} />
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
