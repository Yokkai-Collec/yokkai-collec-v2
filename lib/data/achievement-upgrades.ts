import { createClient } from "@/utils/supabase/client";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";
import type { ClaimResult } from "@/lib/data/achievements";
export async function claimAchievementUpgrade(
  id: string
): Promise<ClaimResult> {
  const { data, error } = await createClient().rpc(
    "claim_achievement_upgrade",
    { p_achievement_id: id }
  );
  if (error)
    throw new Error("Achievement bonus unavailable", {
      cause: {
        i18nKey:
          error.message === "ACHIEVEMENT_ALREADY_CLAIMED"
            ? "achievementUi.alreadyClaimed"
            : "achievementUi.claimError"
      }
    });
  invalidatePlayerSnapshots(["balance"]);
  return data as ClaimResult;
}
