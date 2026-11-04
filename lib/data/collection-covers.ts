import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";

export async function withCollectionCovers<T extends { image?: string | null }>(items: T[], key: (item: T) => string, ownerId?: string): Promise<T[]> {
  if (!items.length) return items;
  try {
    const { data, error } = await readRequest(signal => createClient().rpc("get_collection_covers", {
      p_owner_id: ownerId ?? null, p_target_keys: [...new Set(items.map(key))].slice(0, 200)
    }).abortSignal(signal));
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return items;
    return items.map(item => typeof data[key(item)] === "string" ? { ...item, image: data[key(item)] } : item);
  } catch {
    // Cosmetic enrichment never prevents access to a collection during an outage.
    return items;
  }
}
export async function setCollectionCover(targetKey: string, url: string | null) {
  const { error } = await createClient().rpc("set_collection_cover", { p_target_key: targetKey, p_media_url: url });
  if (error) throw error;
  window.dispatchEvent(new Event("yokkai:collection-cover-updated"));
}
export async function uploadCollectionCover(file: File): Promise<string> {
  if (file.size > 4 * 1024 * 1024) throw new Error("PROFILE_IMAGE_INVALID");
  const form = new FormData();
  form.set("file", file);
  form.set("purpose", "collection-cover");
  const response = await fetch("/api/profile-media", { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok || typeof result.url !== "string") throw new Error(result.code ?? "COLLECTION_COVER_INVALID");
  return result.url;
}
