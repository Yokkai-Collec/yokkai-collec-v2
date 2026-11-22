import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { AccountMenu } from "@/components/account-menu";
import { BlackoutPreviewShop } from "@/components/blackout-preview-shop";
import { LeaderboardTopbar } from "@/components/leaderboard-topbar";
import { BlackoutRoster } from "@/components/blackout-roster";
import { getCurrentUser } from "@/lib/auth/session";
import {
  BLACKOUT_EVENT_PATH,
  blackFridayTerms,
  blackoutPreviewEnabled
} from "@/lib/data/blackout-preview";
import { BLACKOUT_BOOSTER_IMAGE } from "@/lib/ui/booster-opening-document";
import "@/styles/blackout-shop.css";

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
        <header className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <p className="eyebrow">{t("preview")}</p>
            <h1 className="yk-title mt-1">{t("title")}</h1>
          </div>
          <p className="text-sm text-ink-2">{dates}</p>
        </header>
        <section
          className="yk-blackout-storefront mt-4"
          aria-labelledby="blackout-store-title"
        >
          <div className="yk-blackout-store-art" aria-hidden="true">
            <Image
              src={BLACKOUT_BOOSTER_IMAGE}
              alt=""
              width={941}
              height={1672}
              sizes="(min-width: 700px) 240px, 126px"
              loading="eager"
            />
          </div>
          <div className="yk-blackout-store-info">
            <h2 id="blackout-store-title">{t("boosterTitle")}</h2>
            <p className="mt-2 text-sm text-ink-2">
              {t("dailyPacks", freePacks)}
            </p>
            <BlackoutPreviewShop />
          </div>
        </section>
        <section className="yk-blackout-pro-offer mt-4" aria-label="Yokkai Pro">
          <h2 className="font-bold">Yokkai Pro</h2>
          <p className="text-sm text-ink-2">{offer}</p>
        </section>
        <BlackoutRoster />
      </main>
    </div>
  );
}
