"use client";
import { useSyncExternalStore } from "react";
import { i18nEnabled } from "@/i18n/locale";
const subscribeToHydration = () => () => {};
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations, useFormatter } from "next-intl";
/* eslint-disable @next/next/no-img-element -- private wall media and animated GIFs use authenticated URLs. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Avatar, Button, Modal, Toast } from "@/components/ui";
import { GifPicker } from "@/components/gif-picker";
import { WallPostInteractions } from "@/components/wall-post-interactions";
import { PlayerModeration } from "@/components/player-moderation";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  liveWall,
  type WallAdapter,
  type WallPage,
  type WallPost
} from "@/lib/data/profile-wall";

export function ProfileWall({
  ownerId,
  pseudo,
  avatarUrl,
  isMe,
  isPublic,
  canRead,
  active,
  composerOnly = false,
  canInteract = isMe,
  onPublished,
  onDeleted,
  feedPost,
  initialActivity,
  canReport = true,
  authorAction,
  adapter = liveWall
}: {
  ownerId: string;
  pseudo: string;
  avatarUrl: string | null;
  isMe: boolean;
  isPublic: boolean;
  canRead: boolean;
  active: boolean;
  composerOnly?: boolean;
  canInteract?: boolean;
  onPublished?: (post: WallPost) => void;
  onDeleted?: (id: string) => void;
  feedPost?: WallPost;
  initialActivity?: import("@/lib/data/wall-interactions").WallActivity | null;
  canReport?: boolean;
  authorAction?: ReactNode;
  adapter?: WallAdapter;
}) {
  const fmt = useFormatter();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );
  const t = useTranslations();
  const isAdmin = useIsAdmin(active && canRead && !isMe && !composerOnly);
  const [posts, setPosts] = useState<WallPost[]>(feedPost ? [feedPost] : []);
  const [cursor, setCursor] = useState<WallPage["next"]>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mediaZoomed, setMediaZoomed] = useState(false);
  const [expandedMedia, setExpandedMedia] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [gif, setGif] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [removing, setRemoving] = useState<WallPost | null>(null);
  const [retry, setRetry] = useState(0);
  const [cleanup, setCleanup] = useState<string[]>([]);
  const requestId = useRef<string | null>(null);
  const lock = useRef(false);
  const uploaded = useRef<{ file: File; path: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const deletedPost = useRef<string | null>(null);
  function finishDeletion() {
    if (deletedPost.current) {
      onDeleted?.(deletedPost.current);
      window.dispatchEvent(
        new CustomEvent("profile-wall-changed", {
          detail: { kind: "deleted", id: deletedPost.current }
        })
      );
      deletedPost.current = null;
    }
  }

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );
  useEffect(() => {
    if (!active || !canRead || composerOnly || feedPost) return;
    let current = true;
    void Promise.resolve()
      .then(async () => {
        if (!current) return null;
        setLoading(true);
        setError("");
        const { loadPostTarget } =
          await import("@/lib/ui/wall-notification-focus");
        return loadPostTarget(adapter, ownerId, () => current);
      })
      .then(
        page => {
          if (current && page) {
            setPosts(page.items);
            setCursor(page.next);
          }
        },
        () => {
          if (current) {
            setPosts([]);
            setCursor(null);
            setError("Couldn't load the wall. Please try again in a moment.");
          }
        }
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [active, canRead, composerOnly, feedPost, ownerId, adapter, retry]);
  async function discard(path: string) {
    try {
      await adapter.discard(path);
      return true;
    } catch {
      setCleanup(current => [...new Set([...current, path])]);
      return false;
    }
  }
  function changeAttachment(next: File | null, nextGif = "") {
    if (lock.current) return;
    if (uploaded.current) {
      void discard(uploaded.current.path);
      uploaded.current = null;
    }
    requestId.current = null;
    setError("");
    if (
      next &&
      (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
        next.type
      ) ||
        next.size > 6 * 1024 * 1024 ||
        !next.size)
    ) {
      setError("JPG, PNG, WebP, or GIF, up to 6 MB.");
      return;
    }
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : "");
    setGif(nextGif);
    if (fileInput.current) fileInput.current.value = "";
  }
  async function publish() {
    if (
      lock.current ||
      loading ||
      !isMe ||
      !canRead ||
      (!text.trim() && !file && !gif)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      if (file && uploaded.current?.file !== file)
        uploaded.current = { file, path: await adapter.upload(file, ownerId) };
      const post = await adapter.publish({
        id: requestId.current,
        text: text.trim(),
        mediaPath: uploaded.current?.path ?? null,
        gifUrl: gif || null
      });
      setPosts(current => [
        post,
        ...current.filter(item => item.id !== post.id)
      ]);
      uploaded.current = null;
      requestId.current = null;
      setText("");
      setFile(null);
      setPreview("");
      setGif("");
      setToast("Post added to your wall");
      onPublished?.(post);
      window.dispatchEvent(
        new CustomEvent("profile-wall-changed", {
          detail: { kind: "published", id: post.id }
        })
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Couldn't publish your post. Your draft has been kept."
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (!removing || lock.current || loading || !(isMe || isAdmin)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const path = await adapter.remove(removing.id);
      setPosts(current => current.filter(post => post.id !== removing.id));
      deletedPost.current = removing.id;
      setRemoving(null);
      if (!path || (await discard(path))) finishDeletion();
      setToast("Post deleted");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Couldn't delete this post."
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function more() {
    if (loading || busy || !cursor) return;
    setLoading(true);
    setError("");
    try {
      const page = await adapter.list(ownerId, cursor);
      setPosts(current => [
        ...new Map(
          [...current, ...page.items].map(post => [post.id, post])
        ).values()
      ]);
      setCursor(page.next);
    } catch {
      setPosts([]);
      setCursor(null);
      setError(
        "The wall is unavailable or its access has changed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }
  if (!canRead)
    return (
      <section className="yk-profile-surface yk-wall-private">
        <h2>{t("profileUi.thisWallIsPrivate")}</h2>
        <p>{t("profileUi.friendsOnlyPosts")}</p>
      </section>
    );
  return (
    <section className="yk-profile-wall">
      {!composerOnly && !feedPost && (
        <div className="yk-profile-section-heading">
          <div>
            <p className="eyebrow">{t("profileUi.theirPosts")}</p>
            <h2>{t("profileUi.wallFor", { name: pseudo })}</h2>
          </div>
          <span className="yk-wall-audience">
            {isPublic
              ? t("profileUi.publicAllPlayers")
              : t("profileUi.privateYouAndYourFriends")}
          </span>
        </div>
      )}
      {isMe && !feedPost && (
        <form
          className="yk-profile-surface yk-wall-composer"
          onSubmit={event => {
            event.preventDefault();
            void publish();
          }}
        >
          <div className="yk-wall-author">
            <Avatar name={pseudo} image={avatarUrl ?? undefined} size={38} />
            <strong>{pseudo}</strong>
          </div>
          <label htmlFor="wall-text" className="sr-only">
            {t("profileUi.yourPost")}{" "}
          </label>
          <textarea
            id="wall-text"
            className="auth-input"
            value={text}
            maxLength={3000}
            disabled={busy}
            placeholder={t("profileUi.postPlaceholder")}
            onChange={event => {
              setText(event.target.value);
              requestId.current = null;
            }}
          />
          {(preview || gif) && (
            <div className="yk-wall-attachment">
              <img
                src={preview || gif}
                alt={t("profileUi.attachmentPreview")}
              />
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => changeAttachment(null)}
              >
                {t("profileUi.removeAttachment")}{" "}
              </Button>
            </div>
          )}
          <div className="yk-wall-compose-actions">
            <div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {t("profileUi.addImage")}{" "}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                aria-label={t("profileUi.wallImage")}
                hidden
                disabled={busy}
                onChange={event =>
                  changeAttachment(event.target.files?.[0] ?? null)
                }
              />
              <GifPicker
                disabled={busy}
                onSelect={choice => changeAttachment(null, choice.url)}
              />
            </div>
            <span>{text.length}/3000</span>
            <Button
              type="submit"
              disabled={busy || (!text.trim() && !file && !gif)}
            >
              {busy ? t("profileUi.publishing") : t("profileUi.publish")}
            </Button>
          </div>
          <p className="yk-profile-muted">
            {t("profileUi.oneImageOrGIFPerPostUpTo")}{" "}
          </p>
        </form>
      )}
      {error && (
        <div role="alert" className="yk-profile-notice">
          <p>{t(gameErrorKey(error, "profileUi.profileUnavailable"))}</p>
          {!composerOnly && (
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => setRetry(current => current + 1)}
            >
              {t("profileUi.reloadWall")}{" "}
            </Button>
          )}
        </div>
      )}
      {cleanup.length > 0 && (
        <div role="status" className="yk-profile-notice">
          <p>{t("profileUi.unusedFileNotice")}</p>
          <Button
            variant="secondary"
            onClick={() => {
              const paths = cleanup;
              setCleanup([]);
              void Promise.all(paths.map(path => discard(path))).then(
                results => {
                  if (results.every(Boolean)) finishDeletion();
                }
              );
            }}
          >
            {t("profileUi.retryCleanup")}{" "}
          </Button>
        </div>
      )}
      {loading && !posts.length && (
        <p className="yk-profile-empty" role="status">
          {t("profileUi.loadingWall")}{" "}
        </p>
      )}
      {!composerOnly && !feedPost && !loading && !error && !posts.length && (
        <div className="yk-profile-surface yk-wall-empty">
          <h3>{t("profileUi.wallEmptyTitle")}</h3>
          <p>
            {isMe ? t("profileUi.wallEmptyHint") : t("profileUi.noPostsYet")}
          </p>
        </div>
      )}
      {!composerOnly && (
        <div className="yk-wall-posts">
          {posts.map(post => (
            <article
              className="yk-profile-surface yk-wall-post"
              key={post.id}
              data-wall-post={post.id}
            >
              <header>
                <div className="yk-wall-author">
                  <Avatar
                    name={pseudo}
                    image={avatarUrl ?? undefined}
                    size={38}
                  />
                  <div>
                    <strong>
                      {feedPost ? (
                        <Link
                          href={`/profile/${encodeURIComponent(ownerId)}?tab=wall`}
                        >
                          <StyledPlayerName
                            name={pseudo}
                            cosmetics={post.profileStyle}
                          />
                        </Link>
                      ) : (
                        <StyledPlayerName
                          name={pseudo}
                          cosmetics={post.profileStyle}
                        />
                      )}
                    </strong>
                    {feedPost && (
                      <p className="yk-profile-muted">
                        {t("profileUi.onWall")}{" "}
                        <Link
                          href={`/profile/${encodeURIComponent(ownerId)}?tab=wall`}
                        >
                          {isMe
                            ? t("profileUi.yourWall")
                            : t("profileUi.playerWall", { name: pseudo })}
                        </Link>
                      </p>
                    )}
                    <time dateTime={post.createdAt}>
                      {i18nEnabled() && !hydrated
                        ? "…"
                        : i18nEnabled()
                          ? fmt.dateTime(new Date(post.createdAt), {
                              ...{
                                dateStyle: "medium",
                                timeStyle: "short"
                              },
                              timeZone:
                                Intl.DateTimeFormat().resolvedOptions().timeZone
                            })
                          : new Date(post.createdAt).toLocaleString("en-US", {
                              dateStyle: "medium",
                              timeStyle: "short"
                            })}
                    </time>
                  </div>
                </div>
                <div className="yk-wall-post-actions">
                  {authorAction}
                  {(isMe || isAdmin || canReport) && (
                    <details className="yk-wall-post-menu">
                      <summary
                        aria-label={t("profileUi.playerActions", {
                          name: pseudo
                        })}
                      >
                        ⋯
                      </summary>
                      <div className="yk-wall-post-menu-items">
                        {!isMe && canReport && (
                          <PlayerModeration
                            userId={ownerId}
                            pseudo={pseudo}
                            contextType="wall_post"
                            contextId={post.id}
                          />
                        )}
                        {(isMe || isAdmin) && (
                          <Button
                            variant="danger"
                            aria-label={t("profileUi.deleteThisPost")}
                            disabled={busy}
                            onClick={() => setRemoving(post)}
                          >
                            {t("profileUi.remove")}{" "}
                          </Button>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              </header>
              {post.text && <p className="yk-wall-text">{post.text}</p>}
              {(post.mediaPath || post.hasMedia || post.gifUrl) && (
                <button
                  type="button"
                  className="yk-wall-media-button"
                  aria-label={t("profileUi.enlargeImage")}
                  onClick={() =>
                    setExpandedMedia({
                      src:
                        post.previewUrl ??
                        post.gifUrl ??
                        `/api/profile-wall/media/${post.id}`,
                      alt: post.gifUrl
                        ? t("profileUi.gifpostedOnTheWall")
                        : t("profileUi.imagePostedOnTheWall")
                    })
                  }
                >
                  <img
                    className="yk-wall-media"
                    src={
                      post.previewUrl ??
                      post.gifUrl ??
                      `/api/profile-wall/media/${post.id}`
                    }
                    alt={
                      post.gifUrl
                        ? t("profileUi.gifpostedOnTheWall")
                        : t("profileUi.imagePostedOnTheWall")
                    }
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              )}
              {(canInteract || isPublic) && adapter === liveWall && (
                <WallPostInteractions
                  postId={post.id}
                  initialActivity={initialActivity}
                  hideUnavailable={!canInteract}
                />
              )}
            </article>
          ))}
        </div>
      )}
      {!composerOnly && cursor && (
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => void more()}
        >
          {loading ? t("packs.loading") : t("profileUi.seeOlderPosts")}
        </Button>
      )}
      <Modal
        open={!!expandedMedia}
        onClose={() => {
          setExpandedMedia(null);
          setMediaZoomed(false);
        }}
        title={t("profileUi.enlargeImage")}
        hideTitle
        className="yk-wall-media-modal"
      >
        {expandedMedia && (
          <button
            type="button"
            className="yk-wall-media-zoom"
            aria-label={t(
              mediaZoomed ? "profileUi.zoomOutImage" : "profileUi.zoomInImage"
            )}
            aria-pressed={mediaZoomed}
            onClick={() => setMediaZoomed(value => !value)}
            onPointerMove={event => {
              const bounds = event.currentTarget.getBoundingClientRect();
              event.currentTarget.style.setProperty(
                "--zoom-x",
                `${Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100))}%`
              );
              event.currentTarget.style.setProperty(
                "--zoom-y",
                `${Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100))}%`
              );
            }}
          >
            <img
              src={expandedMedia.src}
              alt={expandedMedia.alt}
              draggable={false}
              className="yk-wall-media-expanded"
            />
          </button>
        )}
      </Modal>
      <Modal
        open={!!removing}
        onClose={() => {
          if (!busy) setRemoving(null);
        }}
        title={t("profileUi.deleteThisPost2")}
      >
        <p>{t("profileUi.deletePostNotice")} </p>
        {error && (
          <p role="alert" className="yk-profile-notice">
            {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
          </p>
        )}
        <div className="yk-wall-compose-actions">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setRemoving(null)}
          >
            {t("packs.cancel")}{" "}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            {t("profileUi.deletePost")}{" "}
          </Button>
        </div>
      </Modal>
      <Toast
        message={
          toast ? t(gameErrorKey(toast, "profileUi.profileUnavailable")) : ""
        }
        onDismiss={() => setToast("")}
      />
    </section>
  );
}
import { StyledPlayerName } from "@/components/styled-player-name";
