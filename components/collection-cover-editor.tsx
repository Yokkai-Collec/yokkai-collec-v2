"use client";
/* eslint-disable @next/next/no-img-element -- Preserve uploaded animated GIFs. */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@/components/ui";
import { useProMembershipStatus } from "@/components/pro-access";
import {
  setCollectionCover,
  uploadCollectionCover,
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
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void withCollectionCovers(
      [{ image: undefined as string | undefined }],
      () => targetKey
    ).then(items => {
      if (active) setImage(items[0].image);
    });
    return () => {
      active = false;
    };
  }, [open, targetKey]);
  async function save(file?: File) {
    setBusy(true);
    setError("");
    try {
      const url = file ? await uploadCollectionCover(file) : null;
      await setCollectionCover(targetKey, url);
      onSaved?.();
      setOpen(false);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(
        code === "PRO_REQUIRED"
          ? "proRequired"
          : code === "PROFILE_IMAGE_INVALID"
            ? "invalidImage"
            : "error"
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setError("");
          setImage(undefined);
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
          {image && (
            <img
              className="yk-collection-cover-preview"
              src={image}
              alt={t("preview", { name })}
            />
          )}
          {pro !== true && <p role="status">{t("proRequired")}</p>}
          <label className="yk-collection-cover-file">
            {t("choose")}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={busy || pro !== true}
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void save(file);
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
              onClick={() => void save()}
            >
              {t("reset")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
