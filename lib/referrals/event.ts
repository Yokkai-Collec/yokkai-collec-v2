import type { Card } from "@/lib/data/cards";

export type ReferralEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  serverNow: string;
  validCount: number;
  pending: string[];
  rewardCards?: (Card & { instanceId: string; shiny?: boolean })[];
  tiers: {
    threshold: number;
    karas: number;
    lrCards?: number;
    badge: boolean;
    awarded: boolean;
  }[];
};
