import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import type { CollectionCoverFrame } from "@/lib/ui/collection-cover-frame";

export async function withCollectionCovers<
  T extends { image?: string | null; coverFrame?: CollectionCoverFrame | null }
>(items: T[], key: (item: T) => string, ownerId?: string): Promise<T[]> {
  if (!items.length) return items;
  try {
    const keys = [...new Set(items.map(key))].slice(0, 200);
    const client = createClient();
    const [covers, frames] = await Promise.all([
      readRequest(signal =>
        client
          .rpc("get_collection_covers", {
            p_owner_id: ownerId ?? null,
            p_target_keys: keys
          })
          .abortSignal(signal)
      ),
      readRequest(signal =>
        client
          .rpc("get_collection_cover_frames", {
            p_owner_id: ownerId ?? null,
            p_target_keys: keys
          })
          .abortSignal(signal)
      )
    ]);
    const images =
      !covers.error &&
      covers.data &&
      typeof covers.data === "object" &&
      !Array.isArray(covers.data)
        ? (covers.data as Record<string, string>)
        : {};
    const coverFrames =
      !frames.error &&
      frames.data &&
      typeof frames.data === "object" &&
      !Array.isArray(frames.data)
        ? (frames.data as Record<string, CollectionCoverFrame>)
        : {};
    return items.map(item => {
      const itemKey = key(item);
      const image = images[itemKey];
      const frame = coverFrames[itemKey];
      return image || frame
        ? {
            ...item,
            ...(image ? { image } : {}),
            ...(frame ? { coverFrame: frame } : {})
          }
        : item;
    });
  } catch {
    // Cosmetic enrichment never prevents access to a collection during an outage.
    return items;
  }
}
export async function setCollectionCover(
  targetKey: string,
  url: string | null,
  frame?: CollectionCoverFrame | null
) {
  const { error } = await createClient().rpc("set_collection_cover_framed", {
    p_target_key: targetKey,
    p_media_url: url,
    p_frame: frame ?? null
  });
  if (error) throw error;
  window.dispatchEvent(new Event("yokkai:collection-cover-updated"));
}
