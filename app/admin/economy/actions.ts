"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdminAction } from "@/lib/auth/admin";
import { createClient } from "@/utils/supabase/server";

export async function saveEconomyThresholds(form: FormData) {
  await requireAdminAction();
  const keys = [
    "p_money",
    "p_concentration",
    "p_prices",
    "p_progression",
    "p_activity",
    "p_min_sales"
  ] as const;
  const args = Object.fromEntries(
    keys.map(key => [key, Number(form.get(key))])
  );
  if (
    keys.some(key => !Number.isFinite(args[key]) || args[key] <= 0) ||
    !Number.isInteger(args.p_min_sales)
  ) {
    redirect("/admin/economy?section=risks&saved=error");
  }
  const client = createClient(await cookies());
  const { error } = await client.rpc("admin_set_economy_thresholds", args);
  redirect("/admin/economy?section=risks&saved=" + (error ? "error" : "yes"));
}
