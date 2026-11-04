"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { BinderCover } from "@/components/binder-cover";
import { Button, Modal, Pagination } from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import {
  getFriendPaniniAlbumCardsPage,
  type ProfileDetails
} from "@/lib/data/profile";
import type { PaniniAlbumCardPage } from "@/lib/data/cards";
import { binderIdentity } from "@/lib/ui/binder-identity";
import "@/styles/binder-discovery.css";
import "@/styles/profile-favorite-binders.css";

export type ProfileFavoriteAlbum = ProfileDetails["favoriteAlbums"][number] & {
  kind?: "binder" | "folder";
};
type CardLoader = typeof getFriendPaniniAlbumCardsPage;
const wideSnapshot = () => window.matchMedia("(min-width: 640px)").matches;
const serverSnapshot = () => false;
const subscribeWidth = (listener: () => void) => {
  const media = window.matchMedia("(min-width: 640px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};

export function BinderContents({
  ownerId,
  album,
  loadCards
}: {
  ownerId: string;
  album: ProfileFavoriteAlbum;
  loadCards: CardLoader;
}) {
  const t = useTranslations("profileUi");
  const tc = useTranslations("collectionUi");
  const [page, setPage] = useState(1),
    [ownedOnly, setOwnedOnly] = useState(false),
    [retry, setRetry] = useState(0);
  const identity = binderIdentity(album);
  const requestKey = JSON.stringify([
    ownerId,
    identity,
    page,
    ownedOnly,
    retry
  ]);
  const [result, setResult] = useState<{
    key: string;
    data?: PaniniAlbumCardPage;
    error?: boolean;
  }>();
  const current = result?.key === requestKey ? result : undefined;
  useEffect(() => {
    let active = true;
    void loadCards(ownerId, {
      license: identity,
      page,
      pageSize: 24,
      ownedOnly
    }).then(
      data => {
        if (active) setResult({ key: requestKey, data });
      },
      () => {
        if (active) setResult({ key: requestKey, error: true });
      }
    );
    return () => {
      active = false;
    };
  }, [loadCards, ownerId, identity, page, ownedOnly, requestKey]);
  const data = current?.data;
  return (
    <div className="yk-profile-binder-contents">
      <header>
        <BinderCover image={album.image ?? undefined} license={album.license} />
        <div>
          <strong>{album.license}</strong>
          <p>
            {t("favoriteBinderCardCount", {
              owned: data?.binderOwned ?? album.owned,
              total: data?.binderTotal ?? album.total
            })}
          </p>
          <progress
            max={Math.max(1, album.total)}
            value={album.owned}
            aria-label={t("completionFor", { license: album.license })}
          />
        </div>
      </header>
      <label className="yk-profile-binder-owned-filter">
        <input
          type="checkbox"
          checked={ownedOnly}
          onChange={event => {
            setOwnedOnly(event.target.checked);
            setPage(1);
          }}
        />
        {t("favoriteBinderOwnedOnly")}
      </label>
      {!current ? (
        <p className="yk-profile-binder-state" role="status">
          {tc("loadingBinder")}
        </p>
      ) : current.error ? (
        <div className="yk-profile-binder-state" role="alert">
          <p>{t("favoriteBinderLoadError")}</p>
          <Button
            variant="secondary"
            onClick={() => setRetry(value => value + 1)}
          >
            {tc("tryAgain")}
          </Button>
        </div>
      ) : (
        <>
          {data?.items.length ? (
            <ul className="yk-profile-binder-cards">
              {data.items.map(card => (
                <li key={card.id} data-owned={card.owned ? "true" : "false"}>
                  <YokaiCard {...card} animated={false} />
                  <p className="yk-profile-binder-card-name">{card.name}</p>
                  <small>
                    {t(
                      card.owned
                        ? "favoriteBinderOwned"
                        : "favoriteBinderMissing"
                    )}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="yk-profile-binder-state">{tc("noCardsFound")}</p>
          )}
          <Pagination
            page={page}
            pageCount={Math.max(1, Math.ceil((data?.total ?? 0) / 24))}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

export function ProfileFavoriteBinders({
  ownerId,
  ownerName,
  albums,
  loadCards = getFriendPaniniAlbumCardsPage,
  folderMode = false,
  mixedMode = false
}: {
  ownerId: string;
  ownerName: string;
  albums: ProfileFavoriteAlbum[];
  loadCards?: CardLoader;
  folderMode?: boolean;
  mixedMode?: boolean;
}) {
  const t = useTranslations("profileUi");
  const wide = useSyncExternalStore(
    subscribeWidth,
    wideSnapshot,
    serverSnapshot
  );
  const size = wide ? 12 : 6;
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<ProfileFavoriteAlbum>();
  const pageCount = Math.max(1, Math.ceil(albums.length / size));
  const activePage = Math.min(page, pageCount);
  const start = (activePage - 1) * size;
  const completed = albums.filter(
    album => album.total > 0 && album.owned >= album.total
  ).length;
  return (
    <section className="yk-profile-surface yk-profile-favorite-binders">
      {mixedMode ? (
        <div className="yk-profile-featured-summary">
          <span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            {t("featuredItemTotal", { count: albums.length })}
          </span>
        </div>
      ) : (
        <div className="yk-profile-completion-summary">
          <strong>{completed}</strong>
          <span>
            {t(
              mixedMode
                ? "completedFeaturedItems"
                : folderMode
                  ? "completedFolders"
                  : "completedBinders",
              {
                count: completed
              }
            )}
            <small>
              {t(
                mixedMode
                  ? "featuredItemTotal"
                  : folderMode
                    ? "featuredFolderTotal"
                    : "favoriteBinderTotal",
                {
                  count: albums.length
                }
              )}
            </small>
          </span>
        </div>
      )}
      <ul className="yk-profile-favorite-grid">
        {albums.slice(start, start + size).map(album => (
          <li key={binderIdentity(album)}>
            <button
              type="button"
              className="yk-profile-favorite-binder"
              onClick={() => setSelected(album)}
              aria-label={t(
                folderMode || album.kind === "folder"
                  ? "openFeaturedFolder"
                  : "openFavoriteBinder",
                { license: album.license }
              )}
              aria-haspopup="dialog"
            >
              <BinderCover
                image={album.image ?? undefined}
                license={album.license}
              />
              <span className="yk-profile-favorite-copy">
                {mixedMode && (
                  <span
                    className="yk-profile-featured-kind"
                    data-kind={album.kind}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      aria-hidden="true"
                    >
                      {album.kind === "folder" ? (
                        <path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                      ) : (
                        <>
                          <rect x="5" y="3" width="14" height="18" rx="2" />
                          <path d="M9 3v18m-4-6h4M5 9h4" />
                        </>
                      )}
                    </svg>
                    {t(
                      album.kind === "folder"
                        ? "featuredKindFolder"
                        : "featuredKindBinder"
                    )}
                  </span>
                )}
                <strong>
                  {!mixedMode && <span aria-hidden="true">★ </span>}
                  {album.license}
                </strong>
                <span
                  className={
                    mixedMode ? "yk-profile-featured-card-stats" : undefined
                  }
                >
                  <span>
                    {t("favoriteBinderCardCount", {
                      owned: album.owned,
                      total: album.total
                    })}
                  </span>
                  {mixedMode && (
                    <small>
                      {t("featuredPercent", { percent: album.percent })}
                    </small>
                  )}
                </span>
                <progress
                  max={Math.max(1, album.total)}
                  value={album.owned}
                  aria-label={t("completionFor", { license: album.license })}
                />
                {!mixedMode && (
                  <small>
                    {t("percentComplete", { percent: album.percent })}
                  </small>
                )}
              </span>
              <span className="yk-profile-favorite-open" aria-hidden="true">
                ↗
              </span>
            </button>
          </li>
        ))}
      </ul>
      {albums.length > size && (
        <footer className="yk-profile-favorite-pages">
          <p role="status">
            {t(mixedMode ? "featuredItemRange" : "favoriteBinderRange", {
              from: start + 1,
              to: Math.min(start + size, albums.length),
              total: albums.length
            })}
          </p>
          <Pagination
            page={activePage}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        </footer>
      )}
      <Modal
        open={!!selected}
        onClose={() => setSelected(undefined)}
        title={
          selected
            ? t(
                folderMode || selected.kind === "folder"
                  ? "featuredFolderTitle"
                  : "favoriteBinderTitle",
                {
                  license: selected.license,
                  name: ownerName
                }
              )
            : t("favoriteBinders")
        }
        className="yk-profile-favorite-binder-modal"
      >
        {selected && (
          <BinderContents
            key={binderIdentity(selected)}
            ownerId={ownerId}
            album={selected}
            loadCards={loadCards}
          />
        )}
      </Modal>
    </section>
  );
}
