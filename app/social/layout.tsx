import { SocialSidebar } from "@/components/social-sidebar";
import { SocialComposer } from "@/components/social-composer";
import { SocialTabs } from "@/components/social-tabs";
import { SocialFeedProvider } from "@/components/social-feed-provider";
import type { ReactNode } from "react";
import { CommunityPage } from "@/components/community-page";

export default function SocialLayout({ children }: { children: ReactNode }) {
  return (
    <CommunityPage screen="feed">
      <SocialFeedProvider>
        <div className="yk-social-shell">
          <SocialSidebar>
            <SocialTabs />
            <SocialComposer />
          </SocialSidebar>
          <div className="yk-social-main">{children}</div>
        </div>
      </SocialFeedProvider>
    </CommunityPage>
  );
}
