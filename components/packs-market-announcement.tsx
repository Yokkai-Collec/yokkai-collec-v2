"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@/components/ui";
import { acknowledgePacksMarketAnnouncement } from "@/app/packs-market-announcement/actions";
import { PACKS_MARKET_ANNOUNCEMENT_ID } from "@/lib/ui/packs-market-announcement";
import "@/styles/packs-market-announcement.css";

const auctionLimits = [
  { plan: "Basic", previous: 3, current: 5 },
  { plan: "Pro", previous: 6, current: 10 }
];
const seenInTab = new Set<string>();

export function PacksMarketReleaseNotice({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = `yokkai:announcement:${PACKS_MARKET_ANNOUNCEMENT_ID}:${userId}`;
    let timer: ReturnType<typeof setTimeout>;
    function show() {
      if (seenInTab.has(key)) return;
      try {
        if (localStorage.getItem(key)) return;
      } catch {}
      if (document.hidden || document.querySelector("dialog[open]")) {
        timer = setTimeout(show, 500);
        return;
      }
      seenInTab.add(key);
      try {
        localStorage.setItem(key, "1");
      } catch {}
      setOpen(true);
      void acknowledgePacksMarketAnnouncement().catch(() => undefined);
    }
    timer = setTimeout(show, 1100);
    return () => clearTimeout(timer);
  }, [userId]);
  return <PacksMarketAnnouncement open={open} onClose={() => setOpen(false)} />;
}

export function PacksMarketAnnouncement({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("packsMarketAnnouncement");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("title")}
      hideTitle
      className="yk-packs-market-announcement"
    >
      <header className="yk-packs-market-hero">
        <div>
          <p className="yk-packs-market-label">{t("update")}</p>
          <h2 aria-hidden="true">{t("title")}</h2>
        </div>
        <Image
          src="/assets/chrome-regular-booster-v1.png"
          alt=""
          width={240}
          height={336}
          unoptimized
        />
      </header>
      <div className="yk-packs-market-topics">
        <section className="yk-packs-market-topic" data-topic="packs">
          <h3>{t("packTitle")}</h3>
          <p>{t("packRule", { withoutLr: 499, guaranteed: 500 })}</p>
          <p className="yk-packs-market-detail">{t("packReset")}</p>
        </section>
        <section className="yk-packs-market-topic" data-topic="market">
          <h3>{t("marketTitle")}</h3>
          <p>{t("marketRule")}</p>
          <dl className="yk-packs-market-limits">
            {auctionLimits.map(({ plan, previous, current }) => (
              <div key={plan}>
                <dt>{plan}</dt>
                <dd aria-label={t("marketLimit", { previous, current })}>
                  <del>{previous}</del>
                  <span aria-hidden="true">→</span>
                  <strong>{current}</strong>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <footer className="yk-packs-market-actions">
        <Button variant="secondary" onClick={onClose}>
          {t("dismiss")}
        </Button>
        <div>
          <Link
            href="/market"
            onClick={onClose}
            className="yk-button yk-button-secondary"
          >
            {t("openMarket")}
          </Link>
          <Link
            href="/boosters"
            onClick={onClose}
            className="yk-button yk-button-primary"
          >
            {t("openPacks")}
          </Link>
        </div>
      </footer>
    </Modal>
  );
}

export function PacksMarketAnnouncementPreview() {
  const t = useTranslations("packsMarketAnnouncement");
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("reopen")}</Button>
      <PacksMarketAnnouncement open={open} onClose={() => setOpen(false)} />
    </>
  );
}
