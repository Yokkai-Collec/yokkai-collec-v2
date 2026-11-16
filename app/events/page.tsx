import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { CommunityPage } from "@/components/community-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("events");
  return { title: t("title"), description: t("description") };
}

export default function Page() {
  return <CommunityPage screen="events" />;
}
