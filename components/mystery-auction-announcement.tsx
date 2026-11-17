"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { Button, Modal } from "@/components/ui";
import { acknowledgeMysteryAnnouncement } from "@/app/mystery-auction-announcement/actions";
import {
  isMysteryAnnouncementActive,
  MYSTERY_ANNOUNCEMENT_ID,
  mysteryAnnouncementKey,
  hasMysteryAnnouncementReceipt,
  rememberMysteryAnnouncement
} from "@/lib/ui/mystery-auction-announcement";
import "@/styles/mystery-auction-announcement.css";

const shownInTab = new Set<string>();
const syncedInTab = new Set<string>();
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function syncReceipt(key: string) {
  if (syncedInTab.has(key)) return;
  syncedInTab.add(key);
  void acknowledgeMysteryAnnouncement().catch(() => undefined);
}

export function MysteryAuctionAnnouncement({
  userId,
  seenAnnouncement,
  preview = false
}: {
  userId: string;
  seenAnnouncement?: string | null;
  preview?: boolean;
}) {
  const t = useTranslations("mysteryAnnouncement");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!preview && !isMysteryAnnouncementActive()) return;
    const key = mysteryAnnouncementKey(userId);
    if (
      !preview &&
      (seenAnnouncement === MYSTERY_ANNOUNCEMENT_ID || shownInTab.has(key))
    )
      return;
    if (!preview && hasMysteryAnnouncementReceipt(storage(), userId)) {
      syncReceipt(key);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      if (!active) return;
      if (
        document.visibilityState === "hidden" ||
        document.querySelector("dialog[open]")
      ) {
        timer = setTimeout(show, 500);
        return;
      }
      if (
        !preview &&
        (shownInTab.has(key) ||
          hasMysteryAnnouncementReceipt(storage(), userId))
      )
        return;
      setOpen(true);
      if (!preview) {
        shownInTab.add(key);
        rememberMysteryAnnouncement(storage(), userId);
        syncReceipt(key);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (!preview && event.key === key && event.newValue === "1") {
        clearTimeout(timer);
        setOpen(false);
      }
    };
    timer = setTimeout(show, preview ? 50 : 900);
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId, seenAnnouncement, preview]);
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={t("title")}
      className="yk-mystery-announcement"
    >
      <div className="yk-mystery-announcement-hero">
        <div>
          <p className="eyebrow">{t("release")}</p>
          <h3>{t("headline")}</h3>
          <p>{t("intro")}</p>
        </div>
        <Image
          src="/assets/events/mystery-card.png"
          alt=""
          unoptimized
          width={240}
          height={220}
          sizes="(max-width: 480px) 140px, 200px"
        />
      </div>
      <ul className="yk-mystery-announcement-facts">
        <li>
          <strong>{t("scheduleTitle")}</strong>
          <p>{t("scheduleBody")}</p>
        </li>
        <li>
          <strong>{t("lrTitle")}</strong>
          <p>{t("lrBody")}</p>
        </li>
        <li>
          <strong>{t("revealTitle")}</strong>
          <p>{t("revealBody")}</p>
        </li>
      </ul>
      <footer className="yk-mystery-announcement-actions">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {t("done")}
        </Button>
        <Link
          href="/events"
          onClick={() => setOpen(false)}
          className="yk-button yk-button-primary"
        >
          {t("explore")}
        </Link>
      </footer>
    </Modal>
  );
}
export function MysteryAuctionAnnouncementPreview() {
  const [revision, setRevision] = useState(0);
  const t = useTranslations("mysteryAnnouncement");
  return (
    <main className="mx-auto max-w-3xl p-6">
      <Button onClick={() => setRevision(value => value + 1)}>
        {t("reopen")}
      </Button>
      <MysteryAuctionAnnouncement key={revision} userId="preview" preview />
    </main>
  );
}
