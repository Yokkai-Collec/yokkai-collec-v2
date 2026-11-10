"use client";
/* eslint-disable @next/next/no-img-element -- Preserve uploaded animated GIFs. */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@/components/ui";
import { useProMembershipStatus } from "@/components/pro-access";
import { BannerCrop } from "@/components/banner-crop";
import {
  setCollectionCover,
  withCollectionCovers
} from "@/lib/data/collection-covers";
import {
  collectionCoverImageStyle,
  DEFAULT_COLLECTION_COVER_FRAME,
  normalizeCollectionCoverFrame,
  type CollectionCoverFrame
} from "@/lib/ui/collection-cover-frame";
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
    [frame, setFrame] = useState<CollectionCoverFrame>(
      DEFAULT_COLLECTION_COVER_FRAME
    ),
    [error, setError] = useState("");
  const [cropping, setCropping] = useState(false);
  const [link, setLink] = useState("");
  const preview = /^https:\/\/((i\.)?imgur\.com|i\.pinimg\.com)\/[^\s]+$/i.test(
    link.trim()
  )
    ? link.trim()
    : image;
  const source = link.trim() || image;
  useEffect(() => {
    if (!open) return;
    let active = true;
    void withCollectionCovers(
      [
        {
          image: undefined as string | undefined,
          coverFrame: undefined as CollectionCoverFrame | undefined
        }
      ],
      () => targetKey
    ).then(items => {
      if (active) {
        setImage(items[0].image);
        setFrame(normalizeCollectionCoverFrame(items[0].coverFrame));
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
      const url = reset ? null : (source ?? null);
      if (
        !reset &&
        (!url ||
          url.length > 2048 ||
          !/^https:\/\/((i\.)?imgur\.com|i\.pinimg\.com)\/[^\s]+$/i.test(url))
      )
        throw new Error("COLLECTION_COVER_INVALID");
      await setCollectionCover(targetKey, url, reset ? null : frame);
      setImage(url ?? undefined);
      setLink("");
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
          setFrame(DEFAULT_COLLECTION_COVER_FRAME);
          setLink("");
          setCropping(false);
          setOpen(true);
        }}
        aria-label={t("editFor", { name })}
      >
        {t("button")}
      </Button>
      <Modal
        open={open && !cropping}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("title", { name })}
      >
        <div className="yk-collection-cover-editor">
          <p>{t("hint")}</p>
          {preview && (
            <div className="yk-collection-cover-preview">
              <img
                src={preview}
                alt={t("preview", { name })}
                style={collectionCoverImageStyle(frame)}
              />
            </div>
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
                setFrame(DEFAULT_COLLECTION_COVER_FRAME);
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
              variant="secondary"
              disabled={busy || pro !== true || !preview}
              onClick={() => setCropping(true)}
            >
              {t("adjust")}
            </Button>
            <Button
              disabled={busy || pro !== true || !source}
              onClick={() => void save()}
            >
              {t("save")}
            </Button>
          </div>
        </div>
      </Modal>
      {cropping && preview && (
        <BannerCrop
          src={preview}
          initial={frame}
          viewportAspect={16 / 10}
          title={t("cropTitle")}
          hint={t("cropHint")}
          positionLabel={t("cropPosition")}
          onCancel={() => setCropping(false)}
          onApply={nextFrame => {
            setFrame(normalizeCollectionCoverFrame(nextFrame));
            setCropping(false);
          }}
        />
      )}
    </>
  );
}
