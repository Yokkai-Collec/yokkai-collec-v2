import type { Metadata } from "next";
import {
  MarketPreview,
  MarketPreviewMessenger
} from "@/components/market-preview";
import { Topbar } from "@/components/topbar";

export const metadata: Metadata = {
  title: "Marché preview",
  robots: { index: false, follow: false }
};

export default async function MarketPreviewPage({
  searchParams
}: {
  searchParams: Promise<{
    empty?: string;
    long?: string;
    history?: string;
    messenger?: string;
  }>;
}) {
  const { empty, long, history, messenger } = await searchParams;
  return (
    <>
      <Topbar view="market" name="Kitsune" karas={4920} notifications={[]} />
      <main className="yk-card-browse-page mx-auto py-10">
        <MarketPreview
          empty={empty !== undefined}
          long={long !== undefined}
          history={history !== undefined}
          pageHeading={
            <div>
              <p className="eyebrow">La salle des ventes</p>
              <h1 className="yk-title mt-3">Marché</h1>
            </div>
          }
        />
      </main>
      {messenger !== undefined && <MarketPreviewMessenger />}
    </>
  );
}
