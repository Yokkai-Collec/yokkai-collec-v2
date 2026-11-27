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
type CardLightningColor =
  "white" | "violet" | "blue" | "gold" | "red" | "black";
type InfinityRarity = "SSR" | "LR";

const LIGHTNING_COLORS = [
  "white",
  "violet",
  "blue",
  "gold",
  "red",
  "black"
] as const;
const INFINITY_RARITIES = ["LR", "SSR"] as const;

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
      infinityRarity?: InfinityRarity;
      lightningColor?: CardLightningColor;
      reflectionColor?: CardReflectionColor;
      showcaseScene?: CardShowcaseScene;
      frameHalo?: true;
    }
  >
> = {
  prism_sweep: { kind: "animation" },
  ember_aura: { kind: "animation" },
  frame_halo: { kind: "animation", frameHalo: true },
  ...Object.fromEntries(
    INFINITY_RARITIES.flatMap(infinityRarity => {
      const suffix = infinityRarity === "SSR" ? "_ssr" : "";
      return [
        ...LIGHTNING_COLORS.map(lightningColor => [
          `infinity_lightning${lightningColor === "white" ? "" : `_${lightningColor}`}${suffix}`,
          {
            kind: "animation",
            tier: "special",
            infinityRarity,
            lightningColor
          } as const
        ]),
        ...(["original", ...CARD_REFLECTION_COLORS] as const).map(
          reflectionColor => [
            `${reflectionCosmeticId(reflectionColor)}${suffix}`,
            {
              kind: "animation",
              tier: "special",
              infinityRarity,
              reflectionColor
            } as const
          ]
        )
      ];
    })
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

export function cosmeticNameId(id: string) {
  return CARD_COSMETIC_DISPLAY[id]?.infinityRarity === "SSR"
    ? id.slice(0, -4)
    : id;
}

export function cardCosmeticEligibility(id: string) {
  const display = CARD_COSMETIC_DISPLAY[id];
  if (display?.infinityRarity) {
    return display.infinityRarity === "SSR"
      ? "infinitySsrEligibility"
      : "infinityLrEligibility";
  }
  if (display?.tier === "ssr") return "ssrEligibility";
  if (display?.tier === "lr") return "lrEligibility";
  return "allCardsEligibility";
}

export function canEquipCardCosmetic(
  id: string | null,
  rarity: string,
  isEvolved: boolean
) {
  if (!id) return true;
  const display = CARD_COSMETIC_DISPLAY[id];
  if (display?.infinityRarity)
    return isEvolved && rarity === display.infinityRarity;
  return !display?.tier || rarity.toLowerCase() === display.tier;
}

export type PerCardCosmeticKind = Exclude<CardCosmeticKind, "back">;
export type CardCosmeticLoadout = Partial<Record<PerCardCosmeticKind, string>>;
export type CardCosmeticColorFamily = "reflection" | "lightning";

export function cosmeticOfferAnchor(id: string) {
  return `shop-cosmetic-${id}`;
}

export type CosmeticCollectionFilter = { id: string; equippedOnly: boolean };

export function cosmeticCollectionHref(filter: CosmeticCollectionFilter) {
  const params = new URLSearchParams({ cosmetic: filter.id });
  if (filter.equippedOnly) params.set("equipped", "1");
  return `/collection?${params}`;
}

export function readCosmeticCollectionFilter(
  params: URLSearchParams
): CosmeticCollectionFilter | null {
  const id = params.get("cosmetic");
  if (
    !id ||
    !Object.hasOwn(CARD_COSMETIC_DISPLAY, id) ||
    CARD_COSMETIC_DISPLAY[id].kind === "back"
  )
    return null;
  return { id, equippedOnly: params.get("equipped") === "1" };
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
