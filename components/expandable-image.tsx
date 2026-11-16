"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui";

/* eslint-disable @next/next/no-img-element -- Authenticated media and animated GIFs use their original URL. */

export function ExpandableImage({
  src,
  alt,
  className,
  onLoad
}: {
  src: string;
  alt: string;
  className: string;
  onLoad?: () => void;
}) {
  const t = useTranslations("profileUi");
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  return (
    <>
      <button
        type="button"
        className="yk-wall-media-button"
        aria-label={t("enlargeImage")}
        onClick={() => setOpen(true)}
      >
        <img
          className={className}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={onLoad}
        />
      </button>
      {open && (
        <Modal
          open
          onClose={() => {
            setOpen(false);
            setZoomed(false);
          }}
          title={t("enlargeImage")}
          hideTitle
          className="yk-wall-media-modal"
        >
          <button
            type="button"
            className="yk-wall-media-zoom"
            aria-label={t(zoomed ? "zoomOutImage" : "zoomInImage")}
            aria-pressed={zoomed}
            onClick={() => setZoomed(value => !value)}
            onPointerMove={event => {
              const bounds = event.currentTarget.getBoundingClientRect();
              event.currentTarget.style.setProperty(
                "--zoom-x",
                `${Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100))}%`
              );
              event.currentTarget.style.setProperty(
                "--zoom-y",
                `${Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100))}%`
              );
            }}
          >
            <img
              src={src}
              alt={alt}
              draggable={false}
              referrerPolicy="no-referrer"
              className="yk-wall-media-expanded"
            />
          </button>
        </Modal>
      )}
    </>
  );
}
