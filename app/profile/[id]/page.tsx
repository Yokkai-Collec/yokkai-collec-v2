import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { MissionProfileVisit } from "@/components/mission-profile-visit";
import { CommunityPage } from "@/components/community-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profileUi");
  return { title: t("profile") };
}
export default async function Page({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const identifier = decodeURIComponent(id);
  return (
    <>
      <CommunityPage screen="profile" playerId={identifier} />
      <MissionProfileVisit identifier={identifier} />
    </>
  );
}
