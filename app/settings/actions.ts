"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { getSupabaseConfig } from "@/utils/supabase/config";
import { hasRecentAuthentication } from "@/lib/auth/recent-auth";
import { deleteAccount } from "@/lib/server/account-deletion";

export async function submitSanctionAppealAction(form: FormData) {
  const kind = String(form.get("kind") ?? "");
  const receipt = String(form.get("receipt") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const destination = "/settings?appeal=";
  if (
    !["ACCOUNT", "SMURF"].includes(kind) ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(receipt) ||
    reason.length < 10 ||
    reason.length > 1000
  ) {
    redirect(`${destination}invalid#sanction-history`);
  }
  const client = createClient(await cookies());
  const { error } = await client.rpc("submit_my_anticheat_appeal", {
    p_kind: kind,
    p_receipt: receipt,
    p_reason: reason
  });
  revalidatePath("/settings");
  redirect(`${destination}${error ? "failed" : "saved"}#sanction-history`);
}

type DeletionState = {
  error?: string;
  reconnect?: boolean;
  errorKey?: string;
  errorValues?: Record<string, string>;
};

export async function reconnectForDeletion(
  _state: DeletionState,
  _form: FormData
): Promise<DeletionState> {
  try {
    const client = createClient(await cookies());
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) return { error: "Couldn't sign out. Please try again." };
  } catch {
    return { error: "Couldn't sign out. Please try again." };
  }
  redirect("/login");
}

export async function deleteAccountAction(
  _state: DeletionState,
  form: FormData
): Promise<DeletionState> {
  const reconnect = {
    error:
      "Sign in again, then return to settings. You must have signed in within the last five minutes.",
    reconnect: true
  };
  const cookieStore = await cookies();
  const client = createClient(cookieStore);
  let userId: string;
  try {
    // getClaims validates the signature (or asks Auth for legacy HS256 JWTs).
    // getUser additionally rejects a session whose identity has been removed.
    const { data, error } = await client.auth.getClaims();
    if (error || !data?.claims || !hasRecentAuthentication(data.claims))
      return reconnect;
    const verified = await client.auth.getUser();
    if (
      verified.error ||
      !verified.data.user ||
      data.claims.sub !== verified.data.user.id ||
      data.claims.role !== "authenticated" ||
      data.claims.is_anonymous === true
    )
      return reconnect;
    userId = verified.data.user.id;
  } catch {
    return reconnect;
  }
  const pseudo = form.get("pseudo");
  if (typeof pseudo !== "string" || !pseudo || [...pseudo].length > 30)
    return { error: "Enter your username exactly to confirm." };
  try {
    const profile = await client.rpc("get_game_info");
    if (profile.error || typeof profile.data?.user?.name !== "string")
      return {
        error: "Couldn't verify your username. Please try again later."
      };
    if (pseudo !== profile.data.user.name)
      return {
        error: "The username doesn't match. Enter your username exactly."
      };
    // Only this recently authenticated, explicitly confirmed self-service path
    // stamps a player's deletion request. Technical/restore callers stay unknown.
    await deleteAccount(userId, undefined, true);
  } catch {
    // A partial deletion remains fenced. Never retry destructive calls silently.
    return {
      errorKey: "settingsUi.deletionIncomplete",
      errorValues: {
        contact: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ?? "",
        hasContact: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ? "yes" : "no"
      },
      error:
        "We couldn't finish deleting your account. Don't submit another request. Contact the team to check its status." +
        (process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim()
          ? ` Contact: ${process.env.NEXT_PUBLIC_CONTACT_EMAIL.trim()}.`
          : "")
    };
  }
  // Auth Admin already revoked all sessions. Still clear local session cookies.
  // An Auth 401/404 is expected after deletion and tolerated by supabase-js.
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // The identity is gone; never send the player back to the destructive form.
  }
  const project = new URL(getSupabaseConfig().url).hostname.split(".")[0];
  const tokenCookie = `sb-${project}-auth-token`;
  for (const cookie of cookieStore.getAll()) {
    if (
      cookie.name === tokenCookie ||
      cookie.name.startsWith(`${tokenCookie}.`) ||
      cookie.name === `${tokenCookie}-code-verifier`
    )
      cookieStore.delete(cookie.name);
  }
  revalidatePath("/", "layout");
  redirect("/account-deleted");
}
