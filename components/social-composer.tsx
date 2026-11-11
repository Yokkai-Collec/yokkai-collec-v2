"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, Skeleton } from "@/components/ui";
import { ProfileWall } from "@/components/profile-wall";
import { useSocialFeeds } from "@/components/social-feed-provider";
import { getProfile, type Profile } from "@/lib/data/profile";

export function SocialComposer() {
  const t = useTranslations();
  const feeds = useSocialFeeds();
  const [open, setOpen] = useState(false);
  const [viewer, setViewer] = useState<Profile>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void getProfile().then(
      profile => {
        if (active) {
          setViewer(profile);
          setError(false);
        }
      },
      () => {
        if (active) setError(true);
      }
    );
    return () => {
      active = false;
    };
  }, [open]);
  return (
    <>
      <Button
        className="yk-social-compose-button"
        aria-label={t("socialFriends.post")}
        onClick={() => setOpen(true)}
      >
        <span className="yk-social-compose-label">
          {t("socialFriends.post")}
        </span>
        <span className="yk-social-compose-icon" aria-hidden="true">
          +
        </span>
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("profileUi.yourPost")}
        keepMounted
        className="yk-social-compose-modal"
      >
        {error && <p role="alert">{t("socialUi.feedProfileFailed")}</p>}
        {!viewer && !error && (
          <Skeleton label={t("packs.loading")} className="h-48 w-full" />
        )}
        {viewer && (
          <ProfileWall
            ownerId={viewer.id}
            pseudo={viewer.pseudo}
            avatarUrl={viewer.avatarUrl}
            isMe
            isPublic={viewer.isPublic}
            canRead
            active={open}
            composerOnly
            onPublished={post => {
              const item = {
                ...post,
                hasMedia: !!post.mediaPath,
                author: {
                  id: viewer.id,
                  name: viewer.pseudo,
                  avatarUrl: viewer.avatarUrl,
                  profileStyle: viewer.profileStyle
                }
              };
              feeds.friends.published(item);
              if (viewer.isPublic) feeds.public.published(item);
              setOpen(false);
            }}
          />
        )}
      </Modal>
    </>
  );
}
