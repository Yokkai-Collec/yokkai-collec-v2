import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getAdminUser } from "@/lib/auth/admin";
import { Button, Karas } from "@/components/ui";
import { AccountMenu } from "@/components/account-menu";
import { BlackoutProCheckout } from "@/components/blackout-pro-checkout";
import { BlackoutPreviewShop } from "@/components/blackout-preview-shop";
import { LeaderboardTopbar } from "@/components/leaderboard-topbar";
import { BlackoutRoster } from "@/components/blackout-roster";
import { getCurrentUser } from "@/lib/auth/session";
import {
  BLACKOUT_EVENT_PATH,
  blackFridayTerms,
  blackoutPreviewEnabled,
  getBlackoutPhase
} from "@/lib/data/blackout-preview";
import { BLACKOUT_BOOSTER_IMAGE } from "@/lib/ui/booster-opening-document";
import "@/styles/blackout-shop.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("blackout");
  return { title: t("title"), robots: { index: false } };
}

export default async function BlackFridayPage() {
  const phase = getBlackoutPhase();
  const adminPreview = !blackoutPreviewEnabled && phase === "upcoming";
  if (!blackoutPreviewEnabled && phase === "ended") notFound();
  if (adminPreview) {
    if ((await getAdminUser()).kind !== "admin") notFound();
  } else {
    if (!(await getCurrentUser()))
      redirect(`/login?next=${BLACKOUT_EVENT_PATH}`);
    if (!blackoutPreviewEnabled) {
      const { data, error } = await createClient(await cookies()).rpc(
        "get_blackout_event"
      );
      if (error || !data) notFound();
    }
  }
  const [t, format] = await Promise.all([
    getTranslations("blackout"),
    getFormatter()
  ]);
  const {
    startsAt,
    endsAt,
    freePacks,
    promoCode,
    firstMonthPrice,
    renewalPrice
  } = blackFridayTerms;
  const dates = format.dateTimeRange(
    new Date(startsAt),
    new Date(Date.parse(endsAt) - 1),
    { day: "numeric", month: "long", timeZone: "Europe/Paris" }
  );
  const euro = { style: "currency", currency: "EUR" } as const;

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
            {(adminPreview || blackoutPreviewEnabled) && (
              <p className="eyebrow">
                {t(adminPreview ? "adminPreview" : "preview")}
              </p>
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
                {adminPreview ? (
                  <div className="yk-blackout-shop">
                    <div className="yk-blackout-price">
                      <Karas amount={blackFridayTerms.packPrice} />{" "}
                      <span>{t("perPack")}</span>
                    </div>
                    <Button disabled>{t("availableAtLaunch")}</Button>
                  </div>
                ) : (
                  <BlackoutPreviewShop />
                )}
              </div>
            </section>
            <section className="yk-blackout-pro-offer" aria-label="Yokkai Pro">
              <h2 className="font-bold">Yokkai Pro</h2>
              <p className="yk-blackout-pro-price">
                {t.rich("proPrice", {
                  first: format.number(firstMonthPrice, euro),
                  amount: chunks => <strong>{chunks}</strong>
                })}
              </p>
              <p className="yk-blackout-pro-terms">
                {t.rich("proTerms", {
                  code: promoCode,
                  promo: chunks => (
                    <code className="yk-blackout-promo-code">{chunks}</code>
                  ),
                  renewal: format.number(renewalPrice, euro)
                })}
              </p>
              {adminPreview ? (
                <Button disabled>{t("availableAtLaunch")}</Button>
              ) : (
                <BlackoutProCheckout preview={blackoutPreviewEnabled} />
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
