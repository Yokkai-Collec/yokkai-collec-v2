import { createClient } from "@/utils/supabase/client";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";
export type MissionPeriod = "daily" | "weekly";
export type Mission = {
  id: string;
  metric: string;
  target: number;
  points: number;
  category: string;
  current: number;
};
export type MissionGauge = {
  period: MissionPeriod;
  startAt: string;
  endsAt: string;
  points: number;
  missions: Mission[];
  milestones: { points: number; reward: number; claimedAt: string | null }[];
};
export type Missions = {
  settled?: boolean;
  serverNow: string;
  launchAt: string;
  active: boolean;
  pro: boolean;
  periods: MissionGauge[];
};
function failure(code?: string) {
  const key =
    code === "MISSION_ALREADY_CLAIMED"
      ? "alreadyClaimed"
      : code === "MISSION_LOCKED"
        ? "locked"
        : "unavailable";
  return new Error("Mission request failed", {
    cause: { i18nKey: `missionUi.${key}` }
  });
}
export async function getMissions(): Promise<Missions> {
  const { data, error } = await createClient().rpc("get_missions");
  if (error) throw failure(error.message);
  if ((data as Missions).settled) invalidatePlayerSnapshots(["balance"]);
  return data as Missions;
}
export async function claimMissionMilestone(
  gauge: MissionGauge,
  points: number
) {
  const { data, error } = await createClient().rpc("claim_mission_milestone", {
    p_period: gauge.period,
    p_start: gauge.startAt,
    p_points: points
  });
  if (error) throw failure(error.message);
  invalidatePlayerSnapshots(["balance"]);
  return data as { balance: number; reward: number };
}

export async function recordFriendVisit(identifier: string): Promise<void> {
  const { error } = await createClient().rpc("record_friend_visit", {
    p_identifier: identifier
  });
  if (error) throw failure(error.message);
}
