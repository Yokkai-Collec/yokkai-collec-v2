import { randomUUID } from "node:crypto";
import { inspectProfileImage } from "@/lib/pro/image";
import {
  ProError,
  proUser,
  proClient,
  hasPaidPro,
  boundedBody,
  proReply,
  proFailure
} from "@/lib/pro/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await proUser(request, true);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data;"))
      throw new ProError("REQUEST_INVALID", 400);
    const bytes = await boundedBody(request, 4 * 1024 * 1024 + 8192);
    let form;
    try {
      form = await new Response(bytes, {
        headers: { "Content-Type": contentType }
      }).formData();
    } catch {
      throw new ProError("REQUEST_INVALID", 400);
    }
    if (
      [...form.keys()].some(key => key !== "file" && key !== "purpose") ||
      form.getAll("file").length !== 1 ||
      form.getAll("purpose").length !== 1
    )
      throw new ProError("REQUEST_INVALID", 400);
    const file = form.get("file"),
      purpose = form.get("purpose");
    if (
      !(file instanceof File) ||
      typeof purpose !== "string" ||
      ![
        "avatar",
        "banner",
        "background",
        "card-back",
        "collection-cover"
      ].includes(purpose)
    )
      throw new ProError("REQUEST_INVALID", 400);
    let image;
    const imageBytes = new Uint8Array(await file.arrayBuffer());
    try {
      image = inspectProfileImage(imageBytes);
    } catch {
      throw new ProError(
        "PROFILE_IMAGE_INVALID",
        file.size > 4 * 1024 * 1024 ? 413 : 400
      );
    }
    const client = proClient();
    if (
      (purpose !== "avatar" || image.animated) &&
      !(await hasPaidPro(user.id, client))
    )
      throw new ProError("PRO_REQUIRED", 403);
    // Best effort: free unreferenced files older than 24 h before the stored
    // quota is checked. A failure (or an older database) never blocks uploads.
    try {
      const { data: stale } = await client.rpc("claim_stale_profile_media", {
        p_user_id: user.id
      });
      // Defence in depth: only this player's plain one-level file names.
      const own = new RegExp(
        `^${user.id}/[A-Za-z0-9_-]+\\.(jpg|jpeg|png|webp|gif)$`
      );
      const paths = Array.isArray(stale)
        ? stale.filter(path => typeof path === "string" && own.test(path))
        : [];
      if (paths.length) {
        const { error } = await client.storage.from("avatars").remove(paths);
        if (!error)
          await client
            .from("profile_media_assets")
            .delete()
            .eq("user_id", user.id)
            .in("path", paths);
      }
    } catch {}
    const path = `${user.id}/${purpose}-${randomUUID()}.${image.extension}`;
    const url = client.storage.from("avatars").getPublicUrl(path)
      .data.publicUrl;
    // Reserve a validated asset and the durable quota before uploading bytes.
    const { error: reserveError } = await client
      .from("profile_media_assets")
      .insert({
        path,
        user_id: user.id,
        purpose,
        mime_type: image.mime,
        animated: image.animated,
        public_url: url
      });
    if (reserveError?.message === "PRO_REQUIRED")
      throw new ProError("PRO_REQUIRED", 403);
    if (reserveError?.message === "ACCOUNT_DELETED")
      throw new ProError("REQUEST_DENIED", 403);
    if (reserveError?.message === "ACCOUNT_BANNED")
      throw new ProError("ACCOUNT_BANNED", 403);
    if (reserveError?.message === "PROFILE_MEDIA_QUOTA_EXCEEDED")
      throw new ProError("PROFILE_MEDIA_QUOTA_EXCEEDED", 429);
    if (reserveError?.message === "PROFILE_MEDIA_RATE_LIMITED")
      throw new ProError("PROFILE_MEDIA_RATE_LIMITED", 429);
    if (reserveError) throw new ProError("PRO_UNAVAILABLE");
    const { error } = await client.storage
      .from("avatars")
      .upload(path, imageBytes, {
        upsert: false,
        contentType: image.mime,
        // Unique path per upload (UUID): safe to cache for a year.
        cacheControl: "31536000"
      });
    if (error) {
      await client
        .from("profile_media_assets")
        .delete()
        .eq("path", path)
        .eq("user_id", user.id);
      throw new ProError("PROFILE_MEDIA_UNAVAILABLE");
    }
    // Storage is outside the SQL reservation transaction. A deletion fence may
    // have committed while the bytes were in flight, after its manifest read.
    const deleted = await client
      .from("account_deletion_log")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (deleted.error || deleted.data) {
      await client.storage.from("avatars").remove([path]);
      await client
        .from("profile_media_assets")
        .delete()
        .eq("path", path)
        .eq("user_id", user.id);
      throw new ProError(
        deleted.data ? "REQUEST_DENIED" : "PRO_UNAVAILABLE",
        deleted.data ? 403 : 503
      );
    }
    return proReply({ url });
  } catch (error) {
    return proFailure(error);
  }
}
