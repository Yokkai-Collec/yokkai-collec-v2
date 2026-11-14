import type { Metadata } from "next";
import { CardLicensePreview } from "@/components/card-license-preview";

export const metadata: Metadata = {
  title: "Card franchise preview",
  robots: { index: false, follow: false }
};

export default function Page() {
  return <CardLicensePreview />;
}
