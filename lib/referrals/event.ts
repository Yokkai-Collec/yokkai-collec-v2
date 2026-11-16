import type { Card } from "@/lib/data/cards";

export type ReferralEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  serverNow: string;
  validCount: number;
  pending: string[];
  leaderboard?: {
    entries: {
      pseudo: string;
      position: number;
      validCount: number;
      mine: boolean;
    }[];
    mine: {
      position: number | null;
      validCount: number;
      isPublic: boolean;
    } | null;
  };
  rewardCards?: (Card & { instanceId: string; shiny?: boolean })[];
  tiers: {
    threshold: number;
    karas: number;
    lrCards?: number;
    badge: boolean;
    awarded: boolean;
  }[];
};
