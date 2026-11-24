// Proposed product rules for the isolated local preview, NOT game entitlements.
// Real privileges must be enforced by authenticated database functions, not this file.
export const DECISION_PACK_RESET = {
  hour: 20,
  timeZone: "Europe/Paris"
} as const;

export const PROPOSED_PLAN_RULES = {
  basic: {
    regularPackMinutes: 5,
    regularPackReserve: 5,
    decisionPacksPerDay: 1,
    concurrentAuctions: 5,
    showcaseSlots: 5
  },
  pro: {
    regularPackMinutes: 5,
    regularPackReserve: 10,
    decisionPacksPerDay: 2,
    concurrentAuctions: 10,
    showcaseSlots: 10
  }
} as const;
export type PreviewPlan = keyof typeof PROPOSED_PLAN_RULES;

export const PROPOSED_PRO_FEATURES = [
  {
    id: "card-art",
    title: "Custom card artwork",
    detail: "Use artwork from Imgur or Pinterest."
  },
  {
    id: "regular-packs",
    title: "A bigger Regular Pack reserve",
    detail:
      "Save up to 10 packs instead of 5, with one pack every 5 minutes for everyone."
  },
  {
    id: "decision-packs",
    title: "Two Decision Packs per day",
    detail:
      "Two packs unlock together at the same time each day instead of one. Unused packs do not carry over."
  },
  {
    id: "auctions",
    title: "More auction slots",
    detail: "List up to 10 cards at once."
  },
  {
    id: "achievements",
    title: "Additional achievements and Karas",
    detail: "Unlock additional achievements with Karas rewards. Coming soon."
  },
  {
    id: "site-background",
    title: "Your own site background",
    detail: "Customize the atmosphere across Yokkai."
  },
  {
    id: "banners",
    title: "Custom and animated banners",
    detail: "Upload your own images or GIFs for your profile banner."
  },
  {
    id: "avatar-gifs",
    title: "Animated profile pictures",
    detail: "Bring your avatar to life with a GIF."
  },
  {
    id: "showcase",
    title: "A bigger showcase",
    detail: "Show off 10 characters instead of 5."
  },
  {
    id: "pro-badge",
    title: "A Pro badge",
    detail: "Show your membership next to your name."
  },
  {
    id: "frames",
    title: "Exclusive avatar frames and badges",
    detail: "Add a signature finishing touch to your identity."
  },
  {
    id: "profile-themes",
    title: "Name colors and profile themes",
    detail: "Give your profile a coordinated look."
  },
  {
    id: "showcase-effects",
    title: "Showcase effects and card backs",
    detail: "Style your showcase and personalize your card backs."
  }
] as const;
