"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getHomeBinders,
  type BinderHighlight
} from "@/lib/data/binder-discovery";
import { binderHref } from "@/lib/ui/binder-discovery";
import { binderIdentity } from "@/lib/ui/binder-identity";
import { subscribePlayerSnapshotInvalidation } from "@/lib/data/player-state";
import { BinderCover } from "@/components/binder-cover";
import "@/styles/binder-discovery.css";
export function HomeBinders({
  load = getHomeBinders
}: {
  load?: () => Promise<BinderHighlight[]>;
}) {
  const t = useTranslations("binderDiscovery");
  const [albums, setAlbums] = useState<BinderHighlight[]>();
  const [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      running = false,
      queued = false;
    const refresh = async () => {
      if (!active) return;
      if (running) {
        queued = true;
        return;
      }
      running = true;
      do {
        queued = false;
        try {
          const value = await load();
          if (active && !queued) {
            setAlbums(value);
            setError(false);
          }
        } catch {
          if (active && !queued) setError(true);
        }
      } while (active && queued);
      running = false;
    };
    void refresh();
    const unsubscribe = subscribePlayerSnapshotInvalidation(scopes => {
      if (scopes.includes("collection") || scopes.includes("profile"))
        void refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [load, retry]);
  return (
    <section
      className="yk-home-panel yk-home-binders"
      aria-labelledby="home-binders"
    >
      <header className="yk-home-panel-heading">
        <div>
          <h2 id="home-binders">{t("homeTitle")}</h2>
          <p className="yk-binder-subtitle">{t("homeHint")}</p>
        </div>
        <Link
          href={binderHref()}
          className="yk-button yk-button-primary yk-home-panel-action"
        >
          {t("seeAll")} <span aria-hidden="true">↗</span>
        </Link>
      </header>
      {error ? (
        <div className="yk-binder-empty" role="status">
          <p>{t("unavailable")}</p>
          <button
            className="yk-button yk-button-secondary"
            onClick={() => setRetry(n => n + 1)}
          >
            {t("retry")}
          </button>
        </div>
      ) : !albums ? (
        <p className="yk-binder-empty" role="status">
          {t("loading")}
        </p>
      ) : albums.length ? (
        <ul className="yk-home-binder-grid">
          {albums.map(album => (
            <li key={binderIdentity(album)}>
              <Link href={binderHref(album)} className="yk-home-binder-card">
                <BinderCover
                  image={album.image}
                  frame={album.coverFrame}
                  license={album.license}
                />
                <span className="yk-binder-card-details">
                  <span className="yk-binder-tag">
                    {t(
                      album.favorite
                        ? "favorite"
                        : album.owned >= album.total
                          ? "completed"
                          : "continue"
                    )}
                  </span>
                  <strong>{album.license}</strong>
                  <span>
                    {t("count", { owned: album.owned, total: album.total })}
                  </span>
                  <progress
                    value={album.owned}
                    max={album.total}
                    aria-label={t("progressFor", { name: album.license })}
                  />
                  <small>
                    {t("missing", {
                      count: Math.max(0, album.total - album.owned)
                    })}
                  </small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="yk-binder-empty">
          <p>{t("empty")}</p>
          <Link href={binderHref()} className="yk-button yk-button-secondary">
            {t("choose")}
          </Link>
        </div>
      )}
    </section>
  );
}
