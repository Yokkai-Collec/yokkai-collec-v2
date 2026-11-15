import { createClient } from "@/utils/supabase/client";

export async function sendPrivateMessageImage(
  friendId: string,
  text: string,
  id: string,
  file: File
) {
  const image = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new Error("Image reading aborted"));
    reader.readAsDataURL(file);
  });
  return createClient().rpc("send_private_message_image", {
    p_friend_id: friendId,
    p_body: text,
    p_id: id,
    p_image: image
  }).abortSignal(AbortSignal.timeout(30_000));
}
