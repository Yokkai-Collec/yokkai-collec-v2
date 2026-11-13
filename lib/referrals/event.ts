export type ReferralEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  serverNow: string;
  validCount: number;
  pending: string[];
  tiers: {
    threshold: number;
    karas: number;
    badge: boolean;
    awarded: boolean;
  }[];
};
