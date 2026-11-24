import { notFound } from "next/navigation";
import { CardWavePreview } from "@/components/card-wave-preview";

export const metadata = {
  title: "Infinity shimmer preview",
  robots: { index: false, follow: false }
};

export default function CardWavePreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CardWavePreview />;
}
