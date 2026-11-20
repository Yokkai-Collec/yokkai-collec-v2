import type { Metadata } from "next";
import { UrlPagination } from "@/components/ui/url-pagination";
import Link from "next/link";
import { cookies } from "next/headers";
import { AccountMenu } from "@/components/account-menu";
import { Topbar } from "@/components/topbar";
import { requireAdminPage } from "@/lib/auth/admin";
import { getCurrentKarasBalance, getCurrentPseudo } from "@/lib/auth/session";
import { createClient } from "@/utils/supabase/server";
import { AdminNavigation } from "../admin-navigation";
import { PlayerManager } from "./player-manager";
import { playerDetailFromRpc, playerFromRpc } from "./player-data";
import {
  ModerationHistory,
  type ModerationHistoryData
} from "./moderation-history";

export const metadata: Metadata = { title: "Admin · Players" };

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function AdminPlayersPage({
  searchParams
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    player?: string;
    history?: string;
  }>;
}) {
  const admin = await requireAdminPage();
  const client = createClient(await cookies());
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 100) ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const playerId = /^[0-9a-f-]{36}$/i.test(params.player ?? "")
    ? params.player!
    : null;
  const historyPage = Math.min(
    2_147_483_647,
    Math.max(1, Number.parseInt(params.history ?? "1", 10) || 1)
  );
  const [name, karas, listResult, detailResult, historyResult] =
    await Promise.all([
      getCurrentPseudo(admin.id),
      getCurrentKarasBalance(client),
      client.rpc("admin_list_players", {
        p_query: query,
        p_limit: PAGE_SIZE,
        p_offset: (page - 1) * PAGE_SIZE
      }),
      playerId
        ? client.rpc("admin_get_player", { p_user_id: playerId })
        : Promise.resolve({ data: null, error: null }),
      playerId
        ? client.rpc("admin_get_player_moderation_history", {
            p_user_id: playerId,
            p_page: historyPage
          })
        : Promise.resolve({ data: null, error: null })
    ]);
  if (listResult.error) throw new Error(listResult.error.message);
  if (detailResult.error) throw new Error(detailResult.error.message);
  const payload = (listResult.data ?? {}) as Record<string, unknown>;
  const players = (Array.isArray(payload.players) ? payload.players : []).map(
    item => playerFromRpc(item as Record<string, unknown>)
  );
  const total = Number(payload.total ?? 0);
  const selected = playerDetailFromRpc(
    detailResult.data as Record<string, unknown> | null
  );
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Topbar
        view="admin"
        account={<AccountMenu />}
        name={name ?? undefined}
        karas={karas}
      />
      <main id="main-content" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-7xl space-y-8">
          <header>
            <p className="text-sm font-semibold uppercase tracking-widest text-cyan-300">
              Administration
            </p>
            <h1 className="text-3xl font-black">Player administration</h1>
            <p className="mt-1 text-sm text-slate-400">
              Account search, inventory and moderation.
            </p>
          </header>
          <AdminNavigation />
          <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5">
            <form className="flex flex-col gap-3 sm:flex-row" method="get">
              <input
                aria-label="Search players"
                className="yk-field-control flex-1"
                defaultValue={query}
                maxLength={100}
                name="q"
                placeholder="Username or email address…"
              />
              <button className="yk-button" type="submit">
                Search
              </button>
              {query && (
                <Link
                  className="yk-button yk-button-secondary"
                  href="/admin/players"
                >
                  Clear
                </Link>
              )}
            </form>
            <p className="mt-3 text-xs text-slate-500">
              {total} account{total === 1 ? "" : "s"} found
            </p>
          </section>
          <div id="admin-players-list" tabIndex={0}>
            <PlayerManager
              players={players}
              selected={selected}
              moderationHistory={
                selected && (
                  <ModerationHistory
                    history={
                      historyResult.error
                        ? null
                        : (historyResult.data as ModerationHistoryData | null)
                    }
                  />
                )
              }
            />
          </div>
          <UrlPagination
            page={page}
            pageCount={pages}
            scrollTargetId="admin-players-list"
          />
        </div>
      </main>
    </div>
  );
}
