import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import { withCollectionCovers } from "@/lib/data/collection-covers";
import type { ProfileFavoriteAlbum } from "@/components/profile-favorite-binders";

export type FeaturedSelection = { items: (ProfileFavoriteAlbum & { id: string; kind: "binder" | "folder" })[]; binderKeys: string[]; folderIds: string[] };
export async function getProfileFeaturedItems(ownerId: string): Promise<FeaturedSelection> {
  const { data, error } = await readRequest(signal => createClient().rpc("get_profile_featured_items", { p_owner_id: ownerId }).abortSignal(signal));
  if (error) throw error;
  const result = data as FeaturedSelection;
  return { ...result, items: await withCollectionCovers(result.items, item => item.kind === "folder" ? `folder:${item.id}` : item.binderKey ?? item.id, ownerId) };
}
export async function setProfileFeaturedSelection(binderKeys: string[], folderIds: string[]): Promise<void> {
  const { error } = await createClient().rpc("set_profile_featured_selection", { p_binder_keys: binderKeys, p_folder_ids: folderIds });
  if (error) throw error;
}
