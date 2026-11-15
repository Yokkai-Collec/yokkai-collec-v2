"use client";

/* eslint-disable @next/next/no-img-element -- Private URLs and animated GIFs use the browser directly. */
import { useTranslations } from "next-intl";
import { useEffect, useState, type ClipboardEvent } from "react";
import {
  isPrivateMessageGif,
  type PrivateMessage
} from "@/lib/data/private-messages";
import { pasteImage } from "@/lib/ui/paste-image";

export function useMessageImage(
  showError: (error: string) => void,
  disabled: () => boolean,
  onAttach: () => void
) {
  const [image, setImage] = useState<{ file: File; url: string }>();
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image]
  );
  return {
    image,
    clearImage: () => setImage(undefined),
    onPaste: (event: ClipboardEvent) =>
      pasteImage(event, file => {
        if (disabled()) return;
        if (
          !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
            file.type
          ) ||
          !file.size ||
          file.size > 6 * 1024 * 1024
        ) {
          showError("JPG, PNG, WebP, or GIF, up to 6 MB.");
          return;
        }
        setImage({ file, url: URL.createObjectURL(file) });
        onAttach();
        showError("");
      })
  };
}

export function MessageImageDraft({
  url,
  disabled,
  onRemove
}: {
  url: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("privateMessages");
  return (
    <div className="yk-private-messages-gif-draft">
      <img src={url} alt={t("imageAlt")} />
      <button type="button" disabled={disabled} onClick={onRemove}>
        {t("removeImage")}
      </button>
    </div>
  );
}

export function PrivateMessageMedia({
  message,
  onLoad
}: {
  message: PrivateMessage;
  onLoad: () => void;
}) {
  const t = useTranslations("privateMessages");
  if (message.moderated) return null;
  const src = message.hasImage
    ? `/api/private-messages/media/${encodeURIComponent(message.id)}`
    : message.gifUrl && isPrivateMessageGif(message.gifUrl)
      ? message.gifUrl
      : null;
  if (!src) return null;
  return (
    <img
      className="yk-private-message-gif"
      src={src}
      alt={message.hasImage ? t("imageAlt") : t("gifAlt")}
      loading="lazy"
      referrerPolicy="no-referrer"
      onLoad={onLoad}
    />
  );
}
