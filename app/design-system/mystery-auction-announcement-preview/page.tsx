import { notFound } from "next/navigation";
import { MysteryAuctionAnnouncementPreview } from "@/components/mystery-auction-announcement";
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MysteryAuctionAnnouncementPreview />;
}
