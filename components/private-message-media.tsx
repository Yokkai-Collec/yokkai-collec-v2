"use client";

/* eslint-disable @next/next/no-img-element -- Private URLs and animated GIFs use the browser directly. */
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import {
  isPrivateMessageGif,
  type PrivateMessage
} from "@/lib/data/private-messages";
import { pasteImage } from "@/lib/ui/paste-image";
import { ExpandableImage } from "@/components/expandable-image";

const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

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
  function attachImage(file: File) {
    if (disabled()) return;
    if (
      !imageTypes.includes(file.type) ||
      !file.size ||
      file.size > 6 * 1024 * 1024
    ) {
      showError("JPG, PNG, WebP, or GIF, up to 6 MB.");
      return;
    }
    setImage({ file, url: URL.createObjectURL(file) });
    onAttach();
    showError("");
  }
  return {
    image,
    attachImage,
    clearImage: () => setImage(undefined),
    onPaste: (event: ClipboardEvent) => pasteImage(event, attachImage)
  };
}

export function MessageImagePicker({
  disabled,
  onSelect
}: {
  disabled: boolean;
  onSelect: (file: File) => void;
}) {
  const t = useTranslations("profileUi");
  const input = useRef<HTMLInputElement>(null);
  const label = t("addImage");
  return (
    <>
      <button
        type="button"
        className="yk-message-image-trigger"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 16-5-5L6 21" />
        </svg>
      </button>
      <input
        ref={input}
        type="file"
        accept={imageTypes.join(",")}
        disabled={disabled}
        hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onSelect(file);
        }}
      />
    </>
  );
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
    <ExpandableImage
      className="yk-private-message-gif"
      src={src}
      alt={message.hasImage ? t("imageAlt") : t("gifAlt")}
      onLoad={onLoad}
    />
  );
}
