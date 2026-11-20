"use client";

import { useActionState, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui";
import {
  CollectionView,
  type CollectionPresentation
} from "@/components/collection";
import type { CollectedCard } from "@/lib/data/cards";
import { PlayerWarningControl } from "./player-warning-control";
import {
  removePlayerCardAction,
  setPlayerBanAction,
  type PlayerAdminActionState
} from "./actions";

export type AdminPlayer = {
  userId: string;
  pseudo: string;
  email: string;
  createdAt: string;
  lastSeenAt: string | null;
  cardsCount: number;
  karasBalance: number;
  isBanned: boolean;
  isAdmin: boolean;
};
export type AdminPlayerCard = {
  instanceId: string;
  cardId: string;
  name: string;
  category: string;
  franchise: string;
  rarity: "C" | "R" | "SR" | "SSR" | "LR";
  imageUrl: string;
  catalogueImage: string;
  customImageUrl: string | null;
  obtainedAt: string;
  shiny: boolean;
  evolved: boolean;
  firstOwner: boolean;
  locked: boolean;
  activeAuctionId: string | null;
};
export type AdminPlayerDetail = AdminPlayer & { cards: AdminPlayerCard[] };

const initialState: PlayerAdminActionState = { ok: false, message: "" };

function BanControl({ player }: { player: AdminPlayer }) {
  const [state, action, pending] = useActionState(
    setPlayerBanAction,
    initialState
  );
  const [confirming, setConfirming] = useState(false);
  async function submit(form: FormData) {
    action(form);
    setConfirming(false);
  }
  if (player.isAdmin)
    return (
      <span className="rounded-full border border-cyan-300/30 px-3 py-1 text-xs text-cyan-200">
        Administrator
      </span>
    );
  return (
    <>
      <button
        className={
          player.isBanned
            ? "yk-button yk-button-secondary"
            : "yk-button yk-button-danger"
        }
        onClick={() => setConfirming(true)}
        type="button"
      >
        {player.isBanned ? "Unban" : "Ban"}
      </button>
      {state.message && (
        <p
          className={`mt-2 text-xs ${state.ok ? "text-emerald-300" : "text-red-300"}`}
          role="status"
        >
          {state.message}
        </p>
      )}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={player.isBanned ? "Unban this player?" : "Ban this player?"}
      >
        <p className="text-sm text-slate-300">
          {player.isBanned
            ? `${player.pseudo} will be able to sign in again.`
            : `${player.pseudo} will be signed out immediately. Their listings will be cancelled, bidders refunded and their bids removed.`}
        </p>
        <form action={submit} className="mt-5 flex justify-end gap-3">
          <input name="user_id" type="hidden" value={player.userId} />
          <input name="banned" type="hidden" value={String(!player.isBanned)} />
          <button
            className="yk-button yk-button-secondary"
            onClick={() => setConfirming(false)}
            type="button"
          >
            Cancel
          </button>
          <button
            className={
              player.isBanned ? "yk-button" : "yk-button yk-button-danger"
            }
            disabled={pending}
            type="submit"
          >
            {pending ? "Processing…" : "Confirm"}
          </button>
        </form>
      </Modal>
    </>
  );
}

export function PlayerDetailPanel({
  selected
}: {
  selected: AdminPlayerDetail | null;
}) {
  const router = useRouter();
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionError, setCollectionError] = useState("");
  const collection = useMemo<CollectedCard[]>(
    () =>
      selected?.cards.map(card => ({
        id: card.cardId,
        instanceId: card.instanceId,
        name: card.name,
        category: card.category,
        anime: card.franchise,
        rarity: card.rarity,
        image: card.imageUrl,
        catalogueImage: card.catalogueImage,
        customImageUrl: card.customImageUrl,
        obtainedAt: card.obtainedAt,
        shiny: card.shiny,
        isEvolved: card.evolved,
        isFirstOwner: card.firstOwner,
        locked: card.locked,
        folderId: null
      })) ?? [],
    [selected]
  );
  const presentation = useMemo<Record<string, CollectionPresentation>>(
    () =>
      Object.fromEntries(
        (selected?.cards ?? [])
          .filter(card => card.activeAuctionId)
          .map(card => [
            card.instanceId,
            {
              auctionId: card.activeAuctionId!,
              frozen: { remaining: "At auction" }
            }
          ])
      ),
    [selected]
  );
  const categories = useMemo(
    () =>
      [...new Set(collection.map(card => card.category))].sort((a, b) =>
        a.localeCompare(b, "fr")
      ),
    [collection]
  );
  async function removeCard(instanceId: string) {
    setCollectionError("");
    const result = await removePlayerCardAction(instanceId);
    if (!result.ok) {
      setCollectionError(result.message);
      throw new Error(result.message);
    }
    router.refresh();
  }
  return (
    <div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        {!selected ? (
          <div className="py-12 text-center text-slate-400">
            <p className="font-semibold text-white">Select a player</p>
            <p className="mt-2 text-sm">
              Their account and cards will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-widest text-cyan-300">
                  Player account
                </p>
                <h2 className="mt-1 truncate text-2xl font-black">
                  {selected.pseudo}
                </h2>
                <p className="truncate text-sm text-slate-400">
                  {selected.email}
                </p>
              </div>
              <BanControl player={selected} />
            </div>
            <div className="mt-4">
              <PlayerWarningControl
                key={selected.userId}
                userId={selected.userId}
                pseudo={selected.pseudo}
              />
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-slate-950 p-3">
                <dt className="text-slate-500">Karas</dt>
                <dd className="mt-1 font-bold text-amber-300">
                  {selected.karasBalance.toLocaleString("en-US")}
                </dd>
              </div>
              <div className="rounded-xl bg-slate-950 p-3">
                <dt className="text-slate-500">Cards</dt>
                <dd className="mt-1 font-bold">{selected.cardsCount}</dd>
              </div>
              <div className="col-span-2 rounded-xl bg-slate-950 p-3">
                <dt className="text-slate-500">Last active</dt>
                <dd className="mt-1">
                  {selected.lastSeenAt
                    ? new Date(selected.lastSeenAt).toLocaleString("en-US")
                    : "Never seen online"}
                </dd>
              </div>
            </dl>
            <div className="mt-6 rounded-xl border border-white/10 bg-slate-950 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold">Collection</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {selected.cards.length}{" "}
                    {selected.cards.length === 1 ? "copy" : "copies"}
                  </p>
                </div>
                <button
                  className="yk-button yk-button-secondary"
                  onClick={() => setCollectionOpen(true)}
                  type="button"
                >
                  View collection
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      <Modal
        open={collectionOpen && !!selected}
        onClose={() => {
          setCollectionOpen(false);
          setCollectionError("");
        }}
        title={`Collection of ${selected?.pseudo ?? "this player"}`}
        className="yk-friend-collection-modal"
      >
        {collectionError && (
          <p role="alert" className="yk-feedback yk-feedback-error mb-4">
            {collectionError}
          </p>
        )}
        <CollectionView
          cards={collection}
          categories={categories}
          presentation={presentation}
          readOnly
          adminRemoval
          onDiscard={removeCard}
        />
      </Modal>
    </div>
  );
}

export function PlayerManager({
  players,
  selected,
  moderationHistory
}: {
  players: AdminPlayer[];
  selected: AdminPlayerDetail | null;
  moderationHistory?: ReactNode;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,.85fr)]">
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-lg font-bold">Players ({players.length})</h2>
        </div>
        {players.length ? (
          <div className="divide-y divide-white/10">
            {players.map(player => (
              <article
                className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={player.userId}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{player.pseudo}</strong>
                    {player.isBanned && (
                      <span className="rounded-full bg-red-500/15 px-2 py-1 text-[11px] font-bold text-red-300">
                        Banned
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-slate-400">
                    {player.email}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {player.cardsCount} card
                    {player.cardsCount === 1 ? "" : "s"} ·{" "}
                    {player.karasBalance.toLocaleString("en-US")} Karas
                  </p>
                </div>
                <Link
                  className="yk-button yk-button-secondary"
                  href={`/admin/players?player=${player.userId}`}
                >
                  View player
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <p className="p-8 text-center text-slate-400">No players found.</p>
        )}
      </section>
      <aside
        className={
          selected
            ? "order-first min-w-0 space-y-4 xl:order-none xl:self-start"
            : "xl:sticky xl:top-24 xl:self-start"
        }
      >
        <PlayerDetailPanel selected={selected} />
        {moderationHistory}
      </aside>
    </div>
  );
}
