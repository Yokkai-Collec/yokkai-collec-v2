import { createClient } from "@/utils/supabase/client";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";
import type { Achievement, ClaimResult } from "@/lib/data/achievements";
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

export async function getAchievementCatalogue(): Promise<Achievement[]> {
  const { data, error } = await createClient().rpc("get_achievement_catalogue");
  if (error)
    throw new Error("Achievement catalogue unavailable", {
      cause: { i18nKey: "achievementUi.loadError" }
    });
  return data as Achievement[];
}

export async function claimCatalogueAchievement(
  id: string
): Promise<ClaimResult> {
  const { data, error } = await createClient().rpc(
    "claim_catalogue_achievement",
    { p_achievement_id: id }
  );
  if (error)
    throw new Error("Achievement claim unavailable", {
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
