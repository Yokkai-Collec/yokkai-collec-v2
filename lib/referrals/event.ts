import type { Card } from "@/lib/data/cards";
import type { PlayerCosmetics } from "@/components/styled-player-name";

export type ReferralEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  serverNow: string;
  validCount: number;
  pending: string[];
  leaderboard?: {
    entries: {
      userId?: string;
      avatarUrl?: string | null;
      cosmetics?: PlayerCosmetics;
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
