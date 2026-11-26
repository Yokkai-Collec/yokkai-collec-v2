import "server-only";
import type { createClient } from "@/utils/supabase/server";

export async function getInvocationCardBack(db: ReturnType<typeof createClient>) {
  const { data } = await db
    .from("invocation_card_backs")
    .select("cosmetic_id")
    .maybeSingle();
  return typeof data?.cosmetic_id === "string" ? data.cosmetic_id : null;
}
