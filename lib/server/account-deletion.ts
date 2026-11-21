import "server-only";
import { deleteAccount as deleteAccountCore } from "./account-deletion-core.mjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getVerifiedUser } from "@/lib/auth/session";
import { getSupabaseConfig } from "@/utils/supabase/config";
import { cancelLinkedWhopAccount } from "@/lib/billing/whop-live.mjs";

function serviceClient() {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("ACCOUNT_DELETION_NOT_CONFIGURED");
  return createClient(getSupabaseConfig().url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

// Trusted server/restoration caller only. No Server Action or public route is
// exposed here; the confirmation UI will authenticate and derive the UUID.
export async function deleteAccount(
  userId: string,
  client?: SupabaseClient,
  selfRequested = false
) {
  const admin = client ?? serviceClient();
  if (selfRequested) {
    const { error } = await admin.rpc("begin_self_requested_account_deletion", {
      p_user_id: userId
    });
    if (error) throw new Error("ACCOUNT_DELETION_START_FAILED");
  }
  return deleteAccountCore(userId, admin, async () => {
    const { cancelDeletedAccountBilling } =
      await import("@/lib/billing/deletion");
    await cancelDeletedAccountBilling(userId);
    await cancelLinkedWhopAccount(userId, admin);
  });
}

export async function deleteCurrentAccount() {
  const user = await getVerifiedUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  await deleteAccount(user.id);
}
