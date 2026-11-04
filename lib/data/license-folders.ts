import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import { withCollectionCovers } from "@/lib/data/collection-covers";
import type { PaniniAlbumCardPage } from "@/lib/data/cards";

export type LicenseFolder = { id: string; binderKey: string; name: string; featured: boolean; total: number; owned: number; image?: string; cardIds: string[] };
export async function getLicenseFolders(ownerId?: string, binderKey?: string, featuredOnly = false): Promise<LicenseFolder[]> {
  const { data, error } = await readRequest(signal => createClient().rpc("get_license_folders", { p_owner_id: ownerId ?? null, p_binder_key: binderKey ?? null, p_featured_only: featuredOnly }).abortSignal(signal));
  if (error) throw error;
  return withCollectionCovers((data ?? []) as LicenseFolder[], folder => `folder:${folder.id}`, ownerId);
}
export async function saveLicenseFolder(folder: { id?: string; binderKey: string; name: string; cardIds: string[]; featured: boolean }): Promise<string> {
  const { data, error } = await createClient().rpc("save_license_folder", { p_id: folder.id ?? null, p_binder_key: folder.binderKey, p_name: folder.name, p_card_ids: folder.cardIds, p_featured: folder.featured });
  if (error) throw error;
  return data as string;
}
export async function deleteLicenseFolder(id: string) {
  const { error } = await createClient().rpc("delete_license_folder", { p_id: id });
  if (error) throw error;
}
export async function getLicenseFolderCards(id: string, page = 1, ownedOnly = false, query = ""): Promise<PaniniAlbumCardPage> {
  const { data, error } = await readRequest(signal => createClient().rpc("get_license_folder_cards", { p_id: id, p_query: query, p_owned_only: ownedOnly, p_offset: (page - 1) * 24, p_limit: 24 }).abortSignal(signal));
  if (error) throw error;
  return data as PaniniAlbumCardPage;
}
