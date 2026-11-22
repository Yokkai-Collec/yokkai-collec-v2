import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
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
  const now = Date.now();
  if (
    !blackoutPreviewEnabled &&
    (now < Date.parse(blackFridayTerms.startsAt) ||
      now >= Date.parse(blackFridayTerms.endsAt))
  )
    notFound();
  if (!(await getCurrentUser())) redirect(`/login?next=${BLACKOUT_EVENT_PATH}`);
  if (!blackoutPreviewEnabled) {
    const { data, error } = await createClient(await cookies()).rpc(
      "get_blackout_event"
    );
    if (error || !data) notFound();
  }
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
        className="mx-auto w-full max-w-[90rem] min-w-0 px-3 pt-4 pb-10 sm:px-6"
      >
        <Link className="text-sm text-ink-2 hover:text-ink-1" href="/events">
          <span aria-hidden="true">← </span>
          {t("backToEvents")}
        </Link>
        <header className="mt-2 mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            {blackoutPreviewEnabled && (
              <p className="eyebrow">{t("preview")}</p>
            )}
            <h1 className="yk-title yk-blackout-title mt-1">{t("title")}</h1>
          </div>
          <p className="text-sm text-ink-2">
            {dates} ·{" "}
            {t("endsAtTime", {
              time: format.dateTime(new Date(endsAt), {
                hour: "numeric",
                minute: "2-digit",
                timeZone: "Europe/Paris"
              })
            })}
          </p>
        </header>
        <div className="yk-blackout-layout">
          <BlackoutRoster />
          <div className="yk-blackout-offers">
            <section
              className="yk-blackout-storefront"
              aria-labelledby="blackout-store-title"
            >
              <div className="yk-blackout-store-art" aria-hidden="true">
                <Image
                  src={BLACKOUT_BOOSTER_IMAGE}
                  alt=""
                  width={941}
                  height={1672}
                  sizes="(min-width: 64rem) 100px, (min-width: 44rem) 180px, 126px"
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
            <section className="yk-blackout-pro-offer" aria-label="Yokkai Pro">
              <h2 className="font-bold">Yokkai Pro</h2>
              <p className="text-sm text-ink-2">{offer}</p>
              <Link
                className="yk-blackout-open-link"
                href="/premium#membership"
              >
                {t("seePro")}
              </Link>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
