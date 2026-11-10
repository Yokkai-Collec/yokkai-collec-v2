// Legacy SSR fusion results keep the shiny flag; LR evolution has its own flag.
export function cardRarityLabel(
  rarity: string,
  shiny = false,
  isEvolved = false
): string {
  if (
    (isEvolved || (shiny && rarity === "SSR")) &&
    (rarity === "SSR" || rarity === "LR")
  )
    return (
      rarity +
      (rarity === "SSR" ? " INFINITY" : shiny ? " INFINITY Shiny" : " EVOLVED")
    );
  if (shiny && rarity === "LR") return "LR Shiny";
  return rarity;
}
