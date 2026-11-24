import { notFound } from "next/navigation";
import { AmbientGlow } from "@/components/ambient-glow";
import { HomeHero } from "@/components/home-content";
import { PacksMarketAnnouncementPreview } from "@/components/packs-market-announcement";
import { Topbar } from "@/components/topbar";

export const metadata = {
  robots: { index: false, follow: false }
};

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div className="relative isolate flex min-h-dvh w-full flex-col">
      <AmbientGlow variant="home" />
      <Topbar view="home" />
      <main id="main-content" className="yk-home-main">
        <HomeHero />
        <PacksMarketAnnouncementPreview />
      </main>
    </div>
  );
}
