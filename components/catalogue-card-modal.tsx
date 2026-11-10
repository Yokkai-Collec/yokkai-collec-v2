"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations, useFormatter } from "next-intl";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CardReportButton } from "@/components/card-report-button";
import { Button, Karas, Modal } from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import type { Card } from "@/lib/data/cards";
import {
  getCardDiscovery,
  toggleWishlist,
  type CardDiscovery,
  type CardOwner
} from "@/lib/data/wishlist";

function CardOwnerList({
  title,
  owners
}: {
  title: string;
  owners: CardOwner[];
}) {
  const tv = useTranslations("catalogueUi");
  const format = useFormatter();
  return (
    <div className="yk-catalogue-owner-group">
      <h4>{title}</h4>
      {owners.length ? (
        <ul>
          {owners.map(owner => (
            <li key={owner.id}>
              <Link href={`/profile/${owner.id}`} title={owner.pseudo}>
                <span className="yk-catalogue-owner-name">{owner.pseudo}</span>
                <span className="yk-catalogue-owner-copies">
                  {format.number(owner.copies)}{" "}
                  {owner.copies === 1
                    ? tv("countPluralOneCopyOtherCopies", {
                        count: owner.copies
                      })
                    : tv("countPluralOneCopyOtherCopies", {
                        count: owner.copies
                      })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>{tv("none")}</p>
      )}
    </div>
  );
}

export function CatalogueCardModal({
  selected,
  onClose,
  onWishlistChange,
  ownedCopies
}: {
  selected: Card | null;
  onClose: () => void;
  ownedCopies?: number;
  onWishlistChange?: (cardId: string, wishlisted: boolean) => void;
}) {
  const tError = useTranslations();
  const tv = useTranslations("catalogueUi");
  const [discovery, setDiscovery] = useState<{
    key: string;
    detail?: CardDiscovery;
    error?: string;
  }>();
  const [busy, setBusy] = useState(false);
  const selectionKey = selected
    ? `${selected.id}:${selected.shiny ? "shiny" : "normal"}`
    : undefined;
  const detail =
    selectionKey && discovery?.key === selectionKey
      ? discovery.detail
      : undefined;
  const error =
    selectionKey && discovery?.key === selectionKey
      ? discovery.error
      : undefined;

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const cardId = selected.id;
    const key = selectionKey!;
    void getCardDiscovery(cardId, 0, 12, !!selected.shiny).then(
      value => {
        if (active) setDiscovery({ key, detail: value });
      },
      caught => {
        if (active)
          setDiscovery({
            key,
            error:
              caught instanceof Error
                ? gameErrorKey(caught)
                : "catalogueUi.detailsUnavailable"
          });
      }
    );
    return () => {
      active = false;
    };
  }, [selected, selectionKey]);

  async function toggle() {
    if (!selected || busy) return;
    const key = selectionKey!;
    setBusy(true);
    setDiscovery(current =>
      current?.key === key ? { ...current, error: undefined } : current
    );
    try {
      const wishlisted = await toggleWishlist(selected.id);
      setDiscovery(current =>
        current?.key === key && current.detail
          ? { ...current, detail: { ...current.detail, wishlisted } }
          : current
      );
      onWishlistChange?.(selected.id, wishlisted);
    } catch (caught) {
      setDiscovery({
        key,
        detail,
        error:
          caught instanceof Error
            ? gameErrorKey(caught)
            : "catalogueUi.couldntCompleteThisAction"
      });
    } finally {
      setBusy(false);
    }
  }

  async function moreOwners() {
    if (!selected || !detail) return;
    const key = selectionKey!;
    try {
      const next = await getCardDiscovery(
        selected.id,
        detail.owners.length,
        12,
        !!selected.shiny
      );
      setDiscovery({
        key,
        detail: { ...next, owners: [...detail.owners, ...next.owners] }
      });
    } catch (caught) {
      setDiscovery({
        key,
        detail,
        error:
          caught instanceof Error
            ? gameErrorKey(caught)
            : "catalogueUi.ownersUnavailable"
      });
    }
  }

  const friendOwners = detail?.owners.filter(owner => owner.isFriend) ?? [];
  const otherOwners = detail?.owners.filter(owner => !owner.isFriend) ?? [];

  return (
    <Modal
      open={!!selected}
      onClose={onClose}
      title={selected?.name ?? tv("cardDetails")}
      className="yk-catalogue-detail-modal"
    >
      {selected && (
        <div className="yk-detail-grid">
          <div className="yk-detail-art">
            <YokaiCard {...selected} />
          </div>
          <div className="flex min-w-0 flex-col">
            <p className="text-sm text-ink-2">
              {selected.category} · {selected.rarity}
            </p>
            {selected.anime && (
              <p className="mt-2 text-sm text-ink-3">{selected.anime}</p>
            )}
            {ownedCopies !== undefined && (
              <p className="mt-2 text-sm text-ink-2">
                {ownedCopies
                  ? tv("ownedCopies", { count: ownedCopies })
                  : tv("notInYourCollection")}
              </p>
            )}
            <p className="mt-7 text-xs text-ink-3">{tv("marketValue")}</p>
            {detail?.marketValue != null ? (
              <Karas
                amount={Math.round(detail.marketValue)}
                className="mt-2 text-xl"
              />
            ) : (
              <p className="mt-2 text-sm text-ink-3">{tv("noSalesRecorded")}</p>
            )}
            {detail?.activeAuctionId ? (
              <Link
                className="yk-button mt-5 flex w-full justify-center"
                href={`/market/${detail.activeAuctionId}`}
              >
                {tv("viewAuction")}
              </Link>
            ) : null}
            <Button
              variant="secondary"
              disabled={!detail || busy}
              className="mt-3 w-full"
              onClick={() => void toggle()}
            >
              {detail?.wishlisted
                ? tv("removeFromMyWishlist")
                : tv("addToMyWishlist")}
            </Button>
            <CardReportButton
              cardId={selected.id}
              cardName={selected.name}
              className="mt-3 w-full"
            />
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {tError(gameErrorKey(error))}
              </p>
            )}
            <section className="yk-catalogue-owners">
              <h3 className="font-display text-sm">
                {tv("currentOwners")}
                {detail ? `(${detail.ownerCount})` : ""}
              </h3>
              {detail?.owners.length ? (
                <div className="yk-catalogue-owner-columns">
                  <CardOwnerList title={tv("friends")} owners={friendOwners} />
                  <CardOwnerList
                    title={tv("otherPlayers")}
                    owners={otherOwners}
                  />
                </div>
              ) : detail ? (
                <p>{tv("noCurrentOwners")}</p>
              ) : (
                <p>{tv("loading")}</p>
              )}
              {detail && detail.owners.length < detail.ownerCount ? (
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={() => void moreOwners()}
                >
                  {tv("showMore")}
                </Button>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}
