import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import { withCollectionCovers } from "@/lib/data/collection-covers";
import { cardSearchTerms } from "@/lib/ui/card-search";
import type { Rarity } from "@/lib/data/cards";
import { invalidatePlayerSnapshots, type PaniniAlbumCardPage } from "@/lib/data/cards";

export type LicenseFolder = { id: string; binderKey: string | null; name: string; featured: boolean; total: number; owned: number; image?: string; cardIds: string[] };
export async function getLicenseFolders(ownerId?: string, binderKey?: string, featuredOnly = false): Promise<LicenseFolder[]> {
  const { data, error } = await readRequest(signal => createClient().rpc("get_license_folders", { p_owner_id: ownerId ?? null, p_binder_key: binderKey ?? null, p_featured_only: featuredOnly }).abortSignal(signal));
  if (error) throw error;
  return withCollectionCovers((data ?? []) as LicenseFolder[], folder => `folder:${folder.id}`, ownerId);
}
export async function saveLicenseFolder(folder: { id?: string; binderKey: string | null; name: string; cardIds: string[]; featured: boolean }): Promise<string> {
  const { data, error } = await createClient().rpc("save_license_folder", { p_id: folder.id ?? null, p_binder_key: folder.binderKey, p_name: folder.name, p_card_ids: folder.cardIds, p_featured: folder.featured });
  if (error) throw error;
  invalidatePlayerSnapshots(["collection"]);
  window.dispatchEvent(new Event("yokkai:folders-updated"));
  return data as string;
}
export async function deleteLicenseFolder(id: string) {
  const { error } = await createClient().rpc("delete_license_folder", { p_id: id });
  if (error) throw error;
  invalidatePlayerSnapshots(["collection"]);
  window.dispatchEvent(new Event("yokkai:folders-updated"));
}
export async function getLicenseFolderCards(id: string | null, page = 1, ownedOnly = false, query = ""): Promise<PaniniAlbumCardPage> {
  const { data, error } = await readRequest(signal => createClient().rpc("get_license_folder_cards", { p_id: id, p_query: query, p_owned_only: ownedOnly, p_offset: (page - 1) * 24, p_limit: 24 }).abortSignal(signal));
  if (error) throw error;
  return data as PaniniAlbumCardPage;
}

// Filter before pagination, while RLS and the explicit owner filter keep copy
// ownership private. Folder contents and selection are independent of this view.
export async function getFolderSelectionCards({ page, ownedOnly, query, rarities, categories }: {
  page: number; ownedOnly: boolean; query: string; rarities: Rarity[]; categories: string[];
}): Promise<PaniniAlbumCardPage> {
  const client = createClient();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw authError ?? new Error("AUTH_REQUIRED");
  const relation = ownedOnly ? "user_cards!inner" : "user_cards";
  const { data, error, count } = await readRequest(signal => {
    let request = client.from("cards")
      .select(`id,nom,categorie,franchise,rarete_base,image_url,${relation}(card_id)`, { count: "exact" })
      .eq("user_cards.user_id", auth.user!.id);
    if (rarities.length) request = request.in("rarete_base", rarities);
    if (categories.length) request = request.in("categorie", categories);
    for (const term of cardSearchTerms(query)) {
      const pattern = JSON.stringify(`%${term.replace(/[_\\]/g, "\\$&")}%`);
      request = request.or(`nom.ilike.${pattern},franchise.ilike.${pattern}`);
    }
    return request.order("rarete_base", { ascending: false }).order("nom").order("id")
      .range((page - 1) * 24, page * 24 - 1).abortSignal(signal);
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    id: string; nom: string; categorie: string; franchise: string | null;
    rarete_base: Rarity; image_url: string; user_cards: { card_id: string }[];
  }[];
  return { total: count ?? 0, items: rows.map(row => ({
    id: row.id, name: row.nom, category: row.categorie, anime: row.franchise ?? undefined,
    rarity: row.rarete_base, image: row.image_url, owned: row.user_cards.length > 0
  })) };
}
