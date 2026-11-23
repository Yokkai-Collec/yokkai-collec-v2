import type { Metadata } from "next";
import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import { Topbar } from "@/components/topbar";
import { cookies } from "next/headers";
import { requireAdminPage } from "@/lib/auth/admin";
import { blackFridayTerms } from "@/lib/data/blackout-preview";
import { getCurrentKarasBalance, getCurrentPseudo } from "@/lib/auth/session";
import { createClient } from "@/utils/supabase/server";
import { AdminCardManager } from "./admin-card-manager";
import { AdminNavigation } from "../admin-navigation";

export const metadata: Metadata = { title: "Admin · Cards" };

export const dynamic = "force-dynamic";
const ADMIN_SEARCH_PAGE_SIZE = 1000;

function quotedLike(value: string) {
  return `"%${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}%"`;
}

export default async function AdminCardsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const admin = await requireAdminPage();
  const client = createClient(await cookies());
  const [name, karas] = await Promise.all([
    getCurrentPseudo(admin.id),
    getCurrentKarasBalance(client)
  ]);
  const { q, category } = await searchParams;
  const searchQuery = q?.trim().slice(0, 100) ?? "";
  const searchTerms = searchQuery.split(/\s+/).filter(Boolean);
  const selectedCategory = category?.trim().slice(0, 100) ?? "";
  const { data: categoryData, error: categoryError } = await client.rpc(
    "list_admin_card_categories"
  );
  if (categoryError) throw new Error(categoryError.message);
  const categories = Array.isArray(categoryData)
    ? categoryData.filter((item): item is string => typeof item === "string")
    : [];
  const cards = [];
  let offset = 0;
  while (true) {
    let cardsQuery = client
      .from("cards")
      .select(
        "id,nom,categorie,franchise,rarete_base,image_url,card_franchises(franchise,position)"
      );
    for (const searchTerm of searchTerms) {
      const term = quotedLike(searchTerm);
      cardsQuery = cardsQuery.or(`nom.ilike.${term},franchise.ilike.${term}`);
    }
    if (selectedCategory)
      cardsQuery = cardsQuery.eq("categorie", selectedCategory);
    cardsQuery = (
      searchQuery || selectedCategory
        ? cardsQuery.order("nom", { ascending: true })
        : cardsQuery.order("date_ajout", { ascending: false })
    ).range(offset, offset + (searchQuery ? ADMIN_SEARCH_PAGE_SIZE : 49));
    const { data, error } = await cardsQuery;
    if (error) throw new Error(error.message);
    cards.push(...(data ?? []));
    if (!searchQuery || !data || data.length < ADMIN_SEARCH_PAGE_SIZE) break;
    offset += ADMIN_SEARCH_PAGE_SIZE;
  }
  const managerCards = cards.map(card => ({
    id: card.id,
    nom: card.nom,
    categorie: card.categorie,
    franchise: card.franchise,
    rarete_base: card.rarete_base,
    image_url: card.image_url,
    franchises: [...(card.card_franchises ?? [])]
      .sort((left, right) => left.position - right.position)
      .map(item => item.franchise)
  }));
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
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-cyan-300">
                Administration
              </p>
              <h1 className="text-3xl font-black">Card publishing</h1>
              <p className="text-sm text-slate-400">Signed in: {admin.email}</p>
            </div>
          </header>
          <AdminNavigation
            showBlackoutPreview={
              Date.now() < Date.parse(blackFridayTerms.startsAt)
            }
          />
          <section className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5">
            <h2 className="text-xl font-bold">Search catalogue cards</h2>
            <p className="mt-1 text-sm text-slate-300">
              Search by card or license name, with an optional category filter.
            </p>
            <form
              className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(14rem,2fr)_auto_auto]"
              method="get"
            >
              <input
                aria-label="Card or license name"
                className="w-full min-w-0 rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-white"
                defaultValue={searchQuery}
                maxLength={100}
                name="q"
                placeholder="Example: V Cyberpunk"
              />
              <label className="sr-only" htmlFor="admin-card-category">
                Category
              </label>
              <select
                id="admin-card-category"
                aria-label="Category"
                className="w-full min-w-0 rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-white"
                defaultValue={selectedCategory}
                name="category"
              >
                <option value="">All categories</option>
                {categories.map(item => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <button
                className="rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950"
                type="submit"
              >
                Search
              </button>
              {(searchQuery || selectedCategory) && (
                <Link
                  className="rounded-xl border border-white/15 px-5 py-3 text-center"
                  href="/admin/cards"
                >
                  Clear
                </Link>
              )}
            </form>
          </section>
          <AdminCardManager
            cards={managerCards}
            categories={categories}
            searchQuery={searchQuery || selectedCategory}
          />
        </div>
      </main>
    </div>
  );
}
