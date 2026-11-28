"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { CardCosmeticShop } from "@/lib/ui/card-cosmetics";
import { createClient } from "@/utils/supabase/server";

export async function setInvocationCardBack(id: string | null) {
  const { data, error } = await createClient(await cookies()).rpc(
    "set_my_invocation_card_back",
    { p_cosmetic_id: id }
  );
  if (error || !data) return null;
  revalidatePath("/boosters");
  revalidatePath("/referral-event");
  return data as CardCosmeticShop;
}
