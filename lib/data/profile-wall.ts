import { createClient } from "@/utils/supabase/client";
import type { PlayerCosmetics } from "@/components/styled-player-name";

export function wallRequestId() {
  const crypto = globalThis.crypto;
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  // Older WebKit builds expose getRandomValues without randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10)
  ].map(group => group.join("")).join("-");
}

export type WallPost = {profileStyle?: PlayerCosmetics; id: string; text: string; mediaPath: string | null; hasMedia?: boolean; gifUrl: string | null; createdAt: string; previewUrl?: string };
export type WallPage = { items: WallPost[]; next: { at: string; id: string } | null };
export type WallAdapter = {
  list: (ownerId: string, cursor?: WallPage["next"]) => Promise<WallPage>;
  publish: (input: { id: string; text: string; mediaPath: string | null; gifUrl: string | null }) => Promise<WallPost>;
  remove: (id: string) => Promise<string | null>;
  upload: (file: File, ownerId: string) => Promise<string>;
  discard: (path: string) => Promise<void>;
};
const messages: Record<string,string> = {
  WALL_PRIVATE: "This wall is private. Only their friends can view it.",
  WALL_RATE_LIMITED: "Wait a few seconds between posts (up to 30 per hour).",
  WALL_FULL: "Your wall already has 500 posts. Delete one to continue.",
  WALL_POST_INVALID: "Write up to 3,000 characters, or add an image or GIF.",
  WALL_GIF_INVALID: "Choose a GIF from the picker.",
  GIF_RATING_REJECTED: "Choose a GIF from the picker.",
  WALL_MEDIA_INVALID: "The image is no longer available. Choose it again."
};
async function rpc<T>(name: string, args: Record<string,unknown>, signal?: AbortSignal): Promise<T> {
  const request = createClient().rpc(name,args);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if(error) throw new Error(messages[error.message] ?? "The wall is temporarily unavailable. Please try again in a moment.");
  return data as T;
}

async function publishPost(input: Parameters<WallAdapter["publish"]>[0]): Promise<WallPost> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Couldn't confirm publication. Your draft has been kept. Try again."));
      controller.abort();
    }, 20_000);
  });
  try {
    // The caller keeps the UUID after a failed or interrupted response.
    // Retrying it lets the RPC return a previously committed post once.
    return await Promise.race([
      rpc<WallPost>("publish_profile_wall_post", {
        p_id: input.id,
        p_body: input.text,
        p_media_path: input.mediaPath,
        p_gif_url: input.gifUrl
      }, controller.signal),
      timeout
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const liveWall: WallAdapter = {
  list: (id,cursor) => rpc("get_profile_wall",{p_owner_id:id,p_before:cursor?.at??null,p_before_id:cursor?.id??null,p_limit:20}),
  publish: publishPost,
  remove: async id => {
    const {deleteWallPost}=await import("@/app/social/actions");
    if (!(await deleteWallPost(id)).ok) throw new Error("Couldn't finish deleting this post and its files. Please try again.");
    return null;
  },
  upload: async (file,ownerId) => {
    const formats: Record<string,string> = {"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"};
    if(!formats[file.type] || file.size>6*1024*1024 || file.size===0) throw new Error("JPG, PNG, WebP, or GIF, up to 6 MB.");
    const path=`${ownerId}/${wallRequestId()}.${formats[file.type]}`;
    const {error}=await createClient().storage.from("profile-wall-media").upload(path,file,{upsert:false,contentType:file.type});
    if(error) throw new Error(error.message.includes("WALL_STORAGE_FULL") ? "Your wall has reached its 100 MB image quota. Delete an older post with an image to continue." : "Couldn't upload the image. Your text has been kept.");
    return path;
  },
  discard: async path => {
    const {error}=await createClient().storage.from("profile-wall-media").remove([path]);
    if(error) throw new Error("Couldn't remove the file. Please try again.");
  }
};
