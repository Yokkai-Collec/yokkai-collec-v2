import { notFound } from "next/navigation";
import {
  BlackMarketPanel,
  type BlackMarketEvent
} from "@/components/black-market";
import { NextIntlClientProvider } from "next-intl";
import english from "@/messages/en.json";
import french from "@/messages/fr.json";
import { BlackMarketHubCard } from "@/components/black-market";
import { BlackMarketAdmin } from "@/app/admin/black-market/stock-manager";
import "@/styles/events.css";

export default async function Preview({
  searchParams
}: {
  searchParams: Promise<{ empty?: string; locale?: string; mode?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const locale = params.locale === "en" ? "en" : "fr";
  const now = Date.parse("2026-11-17T12:00:00Z");
  const event: BlackMarketEvent = {
    auctions: params.empty
      ? []
      : Array.from({ length: 12 }, (_, index) =>
          index % 2 ? "SSR" : "LR"
        ).map((rarity, index) => ({
          id: `local-preview-${index}`,
          isBlackMarket: true,
          card: {
            id: `card-${index}`,
            name: [
              "Satoru Gojo",
              "SSR · Collection",
              "LR · Collection",
              "SSR · Collection"
            ][index % 4],
            category: "Anime",
            rarity: rarity as "LR" | "SSR",
            image: "/assets/landing/gojou.webp"
          },
          amount: [50, 120, 260, 80][index % 4],
          endsAt: new Date(now + 3 * 3600000).toISOString(),
          status: "active",
          seller: "Yokkai-Collec Official",
          sellerId: "local-official",
          buyerId: null,
          balance: 1000,
          bids: 0,
          watched: false,
          history: []
        }))
  };
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "fr" ? french : english}
    >
      {params.mode === "admin" ? (
        <main
          id="main-content"
          className="mx-auto w-full max-w-6xl min-w-0 px-3 py-6 sm:px-6 sm:py-10"
        >
          <BlackMarketAdmin
            previewStock={{
              enabled: true,
              minDay: "2026-11-18",
              scheduledDay: "2026-11-19",
              selectedIds: event.auctions
                .slice(0, 2)
                .map(auction => auction.id),
              items: event.auctions.map(auction => ({
                ...auction.card,
                instanceId: auction.id
              }))
            }}
          />
        </main>
      ) : params.mode === "hub" ? (
        <main
          id="main-content"
          className="mx-auto w-full max-w-6xl min-w-0 px-3 py-6 sm:px-6 sm:py-10"
        >
          <ul className="yk-events-grid">
            <BlackMarketHubCard event={event} now={now} />
          </ul>
        </main>
      ) : (
        <BlackMarketPanel preview={event} previewNow={now} />
      )}
    </NextIntlClientProvider>
  );
}
