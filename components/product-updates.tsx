"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { Button, Modal } from "@/components/ui";
import { RankingIcon } from "@/components/ranking-icon";
import { acknowledgeProductUpdate } from "@/app/product-updates/actions";
import {
  PRODUCT_UPDATE_ID,
  productUpdateKey,
  hasProductUpdateReceipt,
  rememberProductUpdate
} from "@/lib/ui/product-updates";
import "@/styles/product-updates.css";

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
  void acknowledgeProductUpdate().catch(() => undefined);
}

export function ProductUpdates({
  userId,
  seenRelease,
  preview = false
}: {
  userId: string;
  seenRelease?: string | null;
  preview?: boolean;
}) {
  const t = useTranslations("productUpdates");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = productUpdateKey(userId);
    if (!preview && (seenRelease === PRODUCT_UPDATE_ID || shownInTab.has(key)))
      return;
    if (!preview && hasProductUpdateReceipt(storage(), userId)) {
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
        (shownInTab.has(key) || hasProductUpdateReceipt(storage(), userId))
      )
        return;
      setOpen(true);
      if (!preview) {
        shownInTab.add(key);
        rememberProductUpdate(storage(), userId);
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
  }, [userId, seenRelease, preview]);
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={t("title")}
      className="yk-product-updates"
    >
      <div className="yk-updates-content">
        <div className="yk-updates-hero">
          <div>
            <span className="yk-updates-release">{t("release")}</span>
            <h3>{t("headline")}</h3>
            <p>{t("intro")}</p>
          </div>
          <div className="yk-updates-books" aria-hidden="true">
            {[
              "/assets/premium-examples/bbdou-card-2.png",
              "/assets/premium-examples/gojo-original.png",
              "/assets/premium-examples/bbdou-card-3.png"
            ].map((src, index) => (
              <span
                key={src}
                className={`yk-updates-book yk-updates-book-${index}`}
              >
                <Image
                  src={src}
                  alt=""
                  width={96}
                  height={136}
                  sizes="96px"
                  loading="eager"
                />
                <span>
                  <RankingIcon kind="licenses" />
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="yk-updates-features">
          <Link
            href="/profile"
            className="yk-update-feature"
            onClick={() => setOpen(false)}
          >
            <span className="yk-update-feature-icon" data-kind="profiles">
              <RankingIcon kind="licenses" />
            </span>
            <h4>{t("profilesTitle")}</h4>
            <p>{t("profilesBody")}</p>
            <span className="yk-update-feature-link">
              {t("profilesAction")} <span aria-hidden="true">↗</span>
            </span>
          </Link>
          <Link
            href="/achievements#achievements"
            className="yk-update-feature"
            onClick={() => setOpen(false)}
          >
            <span className="yk-update-feature-icon" data-kind="achievements">
              <RankingIcon kind="collection" />
            </span>
            <h4>{t("achievementsTitle")}</h4>
            <p>{t("achievementsBody")}</p>
            <span className="yk-update-feature-link">
              {t("achievementsAction")} <span aria-hidden="true">↗</span>
            </span>
          </Link>
          <Link
            href="/achievements#missions"
            className="yk-update-feature"
            onClick={() => setOpen(false)}
          >
            <span className="yk-update-feature-icon" data-kind="missions">
              <RankingIcon kind="likes" />
            </span>
            <h4>{t("missionsTitle")}</h4>
            <p>{t("missionsBody")}</p>
            <span className="yk-update-feature-link">
              {t("missionsAction")} <span aria-hidden="true">↗</span>
            </span>
          </Link>
        </div>
        <footer className="yk-updates-footer">
          <span>{t("footer")}</span>
          <Button onClick={() => setOpen(false)}>{t("done")}</Button>
        </footer>
      </div>
    </Modal>
  );
}
export function ProductUpdatesPreview() {
  const t = useTranslations("productUpdates");
  const [revision, setRevision] = useState(0);
  return (
    <main className="yk-updates-preview">
      <p className="eyebrow">{t("title")}</p>
      <h1>{t("previewTitle")}</h1>
      <p>{t("previewIntro")}</p>
      <Button onClick={() => setRevision(value => value + 1)}>
        {t("reopen")}
      </Button>
      <ProductUpdates key={revision} userId="preview" preview />
    </main>
  );
}
