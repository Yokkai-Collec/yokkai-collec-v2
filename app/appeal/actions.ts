"use server";

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export type AppealAccessState = {
  failed?: boolean;
  type?: string;
  state?: "APPLIED" | "ROLLED_BACK";
  status?: "PENDING" | "UPHELD" | "CORRECTION_REQUIRED";
  decisionReason?: string;
};

export async function useAppealTokenAction(
  _state: AppealAccessState,
  form: FormData
): Promise<AppealAccessState> {
  const token = String(form.get("token") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  if (
    !/^[0-9a-f]{64}$/.test(token) ||
    (reason && (reason.length < 10 || reason.length > 1000))
  )
    return { failed: true };
  const client = createClient(await cookies());
  const { data, error } = await client.rpc("consume_anticheat_appeal_token", {
    p_token: token,
    p_reason: reason || null
  });
  return error || !data ? { failed: true } : (data as AppealAccessState);
}
