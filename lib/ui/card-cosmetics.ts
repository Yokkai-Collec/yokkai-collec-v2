export const CARD_COSMETIC_KINDS = ["animation", "filter", "back"] as const;
export type CardCosmeticKind = (typeof CARD_COSMETIC_KINDS)[number];

export const CARD_COSMETIC_TIERS = ["ssr", "lr", "special"] as const;
export type CardCosmeticTier = (typeof CARD_COSMETIC_TIERS)[number];

export const CARD_REFLECTION_COLORS = [
  "violet",
  "blue",
  "red",
  "gold"
] as const;
type CardReflectionColor = "original" | (typeof CARD_REFLECTION_COLORS)[number];

export const CARD_SHOWCASE_SCENES = [
  "velvet",
  "cyber",
  "lightning",
  "mist",
  "sakura",
  "embers",
  "frost",
  "feathers",
  "vhs"
] as const;
export type CardShowcaseScene = (typeof CARD_SHOWCASE_SCENES)[number];

export function reflectionCosmeticId(color: CardReflectionColor) {
  return `infinity_reflection_${color}`;
}

export const CARD_COSMETIC_DISPLAY: Readonly<
  Record<
    string,
    {
      kind: CardCosmeticKind;
      tier?: CardCosmeticTier;
      lightningColor?: "white" | "violet" | "blue" | "gold" | "red" | "black";
      reflectionColor?: CardReflectionColor;
      showcaseScene?: CardShowcaseScene;
    }
  >
> = {
  prism_sweep: { kind: "animation" },
  ember_aura: { kind: "animation" },
  infinity_lightning: {
    kind: "animation",
    tier: "special",
    lightningColor: "white"
  },
  infinity_lightning_violet: {
    kind: "animation",
    tier: "special",
    lightningColor: "violet"
  },
  infinity_lightning_blue: {
    kind: "animation",
    tier: "special",
    lightningColor: "blue"
  },
  infinity_lightning_gold: {
    kind: "animation",
    tier: "special",
    lightningColor: "gold"
  },
  infinity_lightning_red: {
    kind: "animation",
    tier: "special",
    lightningColor: "red"
  },
  infinity_lightning_black: {
    kind: "animation",
    tier: "special",
    lightningColor: "black"
  },
  ...Object.fromEntries(
    (["original", ...CARD_REFLECTION_COLORS] as const).map(color => [
      reflectionCosmeticId(color),
      { kind: "animation", reflectionColor: color } as const
    ])
  ),
  ...Object.fromEntries(
    CARD_SHOWCASE_SCENES.map(scene => [
      `showcase_${scene}`,
      { kind: "animation", showcaseScene: scene } as const
    ])
  ),
  silver_screen: { kind: "filter", tier: "ssr" },
  violet_dusk: { kind: "filter", tier: "lr" },
  obsidian_seal: { kind: "back" },
  astral_atlas: { kind: "back" },
  violet_mist: { kind: "back" },
  midnight_sakura: { kind: "back" }
};

export type PerCardCosmeticKind = Exclude<CardCosmeticKind, "back">;
export type CardCosmeticLoadout = Partial<Record<PerCardCosmeticKind, string>>;
export type CardCosmeticColorFamily = "reflection" | "lightning";

export function cosmeticOfferAnchor(id: string) {
  return `shop-cosmetic-${id}`;
}

export const CARD_COSMETIC_COLOR_ORDER = [
  "original",
  "white",
  "blue",
  "violet",
  "red",
  "gold",
  "black"
];

export function replayCardCosmeticColor(
  preview: Element | null | undefined,
  family: CardCosmeticColorFamily
) {
  if (!preview || matchMedia("(prefers-reduced-motion: reduce)").matches)
    return;
  // Seek to a visible moment in the effect's existing animation.
  const [selector, progress] =
    family === "reflection"
      ? ([".yk-evolved-scan", 0.44] as const)
      : ([".yk-evolved-lightning path", 0.16] as const);
  for (const layer of preview.querySelectorAll(selector)) {
    for (const animation of layer.getAnimations()) {
      const duration = animation.effect?.getTiming().duration;
      if (typeof duration === "number")
        animation.currentTime = duration * progress;
    }
  }
}

export type CardCosmeticCopies = { quantity: number; available: number };
export type CardCosmeticInventory = {
  copies: Record<string, CardCosmeticCopies>;
  equipped: Record<string, CardCosmeticLoadout>;
  specialEditions?: string[];
};

export type CardCosmeticShop = {
  balance: number;
  invocationBack?: string | null;
  items: ({
    id: string;
    kind: CardCosmeticKind;
    price: number;
  } & CardCosmeticCopies)[];
};
