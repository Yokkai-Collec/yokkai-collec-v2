import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CommunityPage } from "@/components/community-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("topbar");
  return { title: t("trades") };
}

export default function Page() {
  return <CommunityPage screen="trades" />;
}
