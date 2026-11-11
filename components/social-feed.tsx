"use client";
import { useTranslations } from "next-intl";

import { socialErrorKey as gameErrorKey } from "@/i18n/social-messages";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { PublicPostFocus } from "@/components/public-post-focus";
import "@/styles/social-post-focus.css";
import { ProfileWall } from "@/components/profile-wall";
import { Button, Skeleton } from "@/components/ui";
import { getProfile, type Profile } from "@/lib/data/profile";
import { useSocialFeeds } from "@/components/social-feed-provider";
import { EveryoneFriendAction } from "@/components/everyone-friend-action";
import { startVisiblePolling } from "@/lib/ui/visible-polling";

export function SocialFeed({
  source = "friends"
}: {
  source?: "friends" | "public";
}) {
  const tPr4 = useTranslations();
  const store = useSocialFeeds()[source];
  const everyone = source === "public";
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const [viewer, setViewer] = useState<Profile>();
  const [profileError, setProfileError] = useState("");
  useEffect(() => {
    let active = true;
    const loadViewer = () => {
      void getProfile().then(
        profile => {
          if (active) setViewer(profile);
        },
        () => {
          if (active) setProfileError("socialUi.feedProfileFailed");
        }
      );
    };
    const refresh = (resumed = false) => {
      if (!document.hidden) {
        void store.refresh();
        if (resumed) loadViewer();
      }
    };
    const stop = startVisiblePolling(refresh, 60_000);
    const reloadViewer = () => {
      if (!document.hidden) loadViewer();
    };
    window.addEventListener("player-block-changed", reloadViewer);
    return () => {
      active = false;
      stop();
      store.dispose();
      window.removeEventListener("player-block-changed", reloadViewer);
    };
  }, [store]);
  if (everyone && state.available === false) redirect("/social");
  return (
    <section
      className="yk-social-stack yk-social-feed"
      aria-label={
        everyone
          ? tPr4("socialUi.everyoneFeed")
          : tPr4("homeFriendFeed.friendFeed")
      }
    >
      {everyone && (
        <Suspense fallback={null}>
          <PublicPostFocus />
        </Suspense>
      )}
      {everyone && viewer && !viewer.isPublic && (
        <div className="yk-profile-notice">
          <p>{tPr4("socialUi.yourProfileIsPrivateYourPostsAre")}</p>
          <Link className="underline" href="/settings">
            {tPr4("socialUi.privacySettings")}
          </Link>
        </div>
      )}
      {profileError && <p role="alert">{tPr4(profileError)}</p>}
      {!!state.pending.length && (
        <Button
          disabled={state.loadingMore}
          onClick={() => {
            store.showNew();
            window.scrollTo({ top: 0, behavior: "instant" });
          }}
        >
          {tPr4("socialUi.newPosts")}
        </Button>
      )}
      {state.loading && (
        <Skeleton
          label={tPr4("socialUi.loadingYourFeed")}
          className="h-48 w-full rounded-panel"
        />
      )}
      {state.error && (
        <div role="alert" className="yk-profile-notice">
          <p>{tPr4(gameErrorKey(state.error, "socialUi.feedFailed"))}</p>
          <Button
            variant="secondary"
            onClick={() => {
              store.clear();
              void store.refresh();
            }}
          >
            {tPr4("socialUi.refreshFeed")}
          </Button>
        </div>
      )}
      {state.loaded && viewer && !state.items.length && !state.error && (
        <div className="yk-profile-surface yk-wall-empty">
          <h2>
            {everyone
              ? tPr4("socialUi.noPublicPostsYet")
              : viewer?.friends.length
                ? tPr4("socialUi.shareTheFirstStory")
                : tPr4("socialUi.yourCircleStartsHere")}
          </h2>
          <p>
            {everyone
              ? tPr4("socialUi.publishAPostOnYourPublicWall")
              : viewer?.friends.length
                ? tPr4("socialUi.publishAPostOnYourWallTo")
                : tPr4("socialUi.findFriendsOrPublishYourFirstPost")}
          </p>
          {!everyone && !viewer?.friends.length && (
            <Link className="yk-button" href="/friends">
              {tPr4("socialUi.findFriends")}
            </Link>
          )}
        </div>
      )}
      <div className="yk-wall-posts">
        {state.items.map(post => (
          <div
            key={post.id}
            id={everyone ? "public-post-" + post.id : undefined}
            tabIndex={everyone ? -1 : undefined}
            className="yk-social-feed-post"
          >
            <ProfileWall
              feedPost={{
                ...post,
                mediaPath: null,
                profileStyle: post.author.profileStyle ?? undefined
              }}
              ownerId={post.author.id}
              pseudo={post.author.name}
              avatarUrl={post.author.avatarUrl}
              authorAction={
                everyone && (
                  <EveryoneFriendAction
                    key={`${post.author.id}:${post.relationship}:${post.requestId ?? ""}`}
                    post={post}
                    onChanged={relationship =>
                      store.relationshipChanged(post.author.id, relationship)
                    }
                  />
                )
              }
              isMe={viewer?.id === post.author.id}
              isPublic={everyone}
              canRead
              active
              canInteract
              initialActivity={post.activity}
              canReport={!!viewer}
              onDeleted={store.removed}
            />
          </div>
        ))}
      </div>
      {state.next && (
        <Button
          variant="secondary"
          disabled={state.loadingMore}
          onClick={() => void store.more()}
        >
          {state.loadingMore
            ? tPr4("packs.loading")
            : tPr4("profileUi.loadMore")}
        </Button>
      )}
      {state.loaded && state.items.length > 0 && !state.next && (
        <p role="status" className="yk-profile-muted">
          {tPr4("homeFriendFeed.youReAllCaughtUp")}
        </p>
      )}
    </section>
  );
}
