import type { AuctionData, MarketQuery } from "@/lib/data/market";

// Development-only fallback used when a local database has no active auctions.
// Keeping this data here lets the real Market page be inspected without ever
// changing the production query or its empty-state behaviour.
const cards = [
  ["Satoru Gojo", "Jujutsu Kaisen", "ANIME/MANGA", "LR", "/assets/premium-examples/gojo-original.png"],
  ["Shadow Monarch", "Solo Leveling", "ANIME/MANGA", "SSR", "/assets/card-reveals/ssr-pink-world.webp"],
  ["Cyber Ronin", "Neo Tokyo", "VIDEO GAMES", "SR", "/assets/regular-opening-nebula.webp"],
  ["Aurora Witch", "Winter Saga", "SAGA", "R", "/assets/decision-opening-nebula.webp"],
  ["Solar Sentinel", "Galactic Tales", "COMICS", "C", "/assets/card-back.png"],
  ["Gojo Shiny", "Jujutsu Kaisen", "ANIME/MANGA", "LR", "/assets/premium-examples/gojo-custom.gif"]
] as const;

const sellers = [
  "KitsuneMaster",
  "Mika",
  "Ryo",
  "Luna",
  "Yume",
  "Shin"
] as const;

/**
 * Local visual data for the normal Market route. It is only consumed from a
 * development build after the real request has successfully returned no rows.
 */
export function localMarketFixture(
  query: Pick<MarketQuery, "query" | "rarity" | "category" | "sort">
): AuctionData[] {
  const now = Date.now();
  const auctions = Array.from({ length: 36 }, (_, index) => {
    const [name, anime, category, rarity, image] = cards[index % cards.length];
    return {
      id: `local-market-demo-${index + 1}`,
      card: {
        id: `local-card-${index + 1}`,
        name: `${name} ${index >= cards.length ? `#${index + 1}` : ""}`.trim(),
        anime,
        category,
        rarity,
        image
      },
      amount: [45, 120, 375, 850, 1_250, 4_800][index % 6],
      endsAt: new Date(now + (index + 2) * 13 * 60_000).toISOString(),
      status: "active",
      seller: sellers[index % sellers.length],
      sellerId: `local-seller-${index % sellers.length}`,
      sellerAvatarUrl: null,
      buyerId: null,
      buyer: null,
      hasBid: index % 5 === 0,
      popularity: (index * 7) % 31,
      bids: (index % 7) + 1,
      watched: index === 1,
      ownedCount: index % 8 === 0 ? 1 : 0
    };
  });
  const words = query.query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const rarities =
    typeof query.rarity === "string" ? [query.rarity] : [...query.rarity];
  const filtered = auctions.filter(auction => {
    const searchable = [
      auction.card.name,
      auction.card.anime,
      auction.card.category
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return (
      words.every(word => searchable.includes(word)) &&
      (!rarities.length || rarities.includes(auction.card.rarity)) &&
      (!query.category || auction.card.category === query.category)
    );
  });
  return filtered.sort((left, right) => {
    if (query.sort === "asc") return left.amount - right.amount;
    if (query.sort === "desc") return right.amount - left.amount;
    if (query.sort === "popular")
      return (right.popularity ?? 0) - (left.popularity ?? 0);
    return Date.parse(left.endsAt) - Date.parse(right.endsAt);
  });
}
