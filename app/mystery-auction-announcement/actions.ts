"use server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  MYSTERY_ANNOUNCEMENT_ID,
  MYSTERY_ANNOUNCEMENT_METADATA_KEY
} from "@/lib/ui/mystery-auction-announcement";

// Cosmetic acknowledgement only. The session determines the account, never an input ID.
export async function acknowledgeMysteryAnnouncement(): Promise<{
  ok: boolean;
}> {
  try {
    const client = createClient(await cookies());
    const {
      data: { user },
      error
    } = await client.auth.getUser();
    if (error || !user) return { ok: false };
    if (
      user.user_metadata?.[MYSTERY_ANNOUNCEMENT_METADATA_KEY] ===
      MYSTERY_ANNOUNCEMENT_ID
    )
      return { ok: true };
    const saved = await client.auth.updateUser({
      data: { [MYSTERY_ANNOUNCEMENT_METADATA_KEY]: MYSTERY_ANNOUNCEMENT_ID }
    });
    return { ok: !saved.error };
  } catch {
    return { ok: false };
  }
}
