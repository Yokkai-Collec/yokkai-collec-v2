"use client";
/* eslint-disable @next/next/no-img-element -- Preserve uploaded animated GIFs. */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@/components/ui";
import { useProMembershipStatus } from "@/components/pro-access";
import {
  setCollectionCover,
  withCollectionCovers
} from "@/lib/data/collection-covers";
import "@/styles/collection-cover-editor.css";

export function CollectionCoverEditor({
  targetKey,
  name,
  onSaved
}: {
  targetKey: string;
  name: string;
  onSaved?: () => void;
}) {
  const t = useTranslations("collectionCovers");
  const pro = useProMembershipStatus();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [image, setImage] = useState<string>(),
    [error, setError] = useState("");
  const [link, setLink] = useState("");
  const preview = /^https:\/\/((i\.)?imgur\.com|i\.pinimg\.com)\/[^\s]+$/i.test(
    link.trim()
  )
    ? link.trim()
    : image;
  useEffect(() => {
    if (!open) return;
    let active = true;
    void withCollectionCovers(
      [{ image: undefined as string | undefined }],
      () => targetKey
    ).then(items => {
      if (active) {
        setImage(items[0].image);
      }
    });
    return () => {
      active = false;
    };
  }, [open, targetKey]);
  async function save(reset = false) {
    setBusy(true);
    setError("");
    try {
      const url = reset ? null : link.trim();
      if (
        !reset &&
        (!url ||
          url.length > 2048 ||
          !/^https:\/\/((i\.)?imgur\.com|i\.pinimg\.com)\/[^\s]+$/i.test(url))
      )
        throw new Error("COLLECTION_COVER_INVALID");
      await setCollectionCover(targetKey, url);
      onSaved?.();
      setOpen(false);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(
        code === "PRO_REQUIRED"
          ? "proRequired"
          : code === "COLLECTION_COVER_INVALID"
            ? "invalidImage"
            : "error"
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setError("");
          setImage(undefined);
          setLink("");
          setOpen(true);
        }}
        aria-label={t("editFor", { name })}
      >
        {t("button")}
      </Button>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("title", { name })}
      >
        <div className="yk-collection-cover-editor">
          <p>{t("hint")}</p>
          {preview && (
            <img
              className="yk-collection-cover-preview"
              src={preview}
              alt={t("preview", { name })}
            />
          )}
          {pro !== true && <p role="status">{t("proRequired")}</p>}
          <label className="yk-collection-cover-file">
            {t("choose")}
            <input
              type="url"
              value={link}
              maxLength={2048}
              placeholder="https://i.imgur.com/image.gif"
              disabled={busy || pro !== true}
              onChange={event => {
                setLink(event.target.value);
                setError("");
              }}
            />
          </label>
          {error && <p role="alert">{t(error)}</p>}
          {busy && <p role="status">{t("saving")}</p>}
          <div className="yk-collection-cover-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("close")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void save(true)}
            >
              {t("reset")}
            </Button>
            <Button
              disabled={busy || pro !== true || !link.trim()}
              onClick={() => void save()}
            >
              {t("save")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
