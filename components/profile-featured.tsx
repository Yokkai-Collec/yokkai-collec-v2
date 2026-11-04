"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BinderCover } from "@/components/binder-cover";
import { Button, Modal, Pagination } from "@/components/ui";
import { ProfilePrivate } from "@/components/profile-private";
import { ProfileFavoriteBinders } from "@/components/profile-favorite-binders";
import { FolderEditor } from "@/components/license-folders";
import { getPaniniAlbumsPage, type PaniniAlbumPage } from "@/lib/data/cards";
import {
  getLicenseFolders,
  getLicenseFolderCards,
  type LicenseFolder
} from "@/lib/data/license-folders";
import {
  getProfileFeaturedItems,
  setProfileFeaturedSelection,
  type FeaturedSelection
} from "@/lib/data/profile-featured";
import {
  getFriendPaniniAlbumCardsPage,
  type Profile
} from "@/lib/data/profile";
import "@/styles/profile-featured.css";

function FeaturedPicker({
  initial,
  onSaved,
  onClose,
  onSaving
}: {
  initial: FeaturedSelection;
  onSaved: () => void;
  onClose: () => void;
  onSaving: (saving: boolean) => void;
}) {
  const t = useTranslations("profileFeatured");
  const [binders, setBinders] = useState(new Set(initial.binderKeys)),
    [folders, setFolders] = useState(new Set(initial.folderIds));
  const [tab, setTab] = useState<"binder" | "folder">("binder"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const [creating, setCreating] = useState(false),
    [chosenBinder, setChosenBinder] = useState<{ key: string; name: string }>();
  const activeType = creating ? "binder" : tab;
  const requestKey = JSON.stringify([activeType, query, page, retry, creating]);
  const [result, setResult] = useState<{
    key: string;
    binders?: PaniniAlbumPage;
    folders?: LicenseFolder[];
    error?: boolean;
  }>();
  const current = result?.key === requestKey ? result : undefined;
  useEffect(() => {
    if (chosenBinder) return;
    let active = true;
    const timer = setTimeout(() => {
      void (
        activeType === "binder"
          ? getPaniniAlbumsPage({ query, page, pageSize: 24 }).then(
              binders => ({ binders })
            )
          : getLicenseFolders().then(folders => ({ folders }))
      ).then(
        data => {
          if (active) setResult({ key: requestKey, ...data });
        },
        () => {
          if (active) setResult({ key: requestKey, error: true });
        }
      );
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activeType, query, page, retry, requestKey, chosenBinder]);
  const matchingFolders =
    current?.folders?.filter(folder =>
      folder.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    ) ?? [];
  const options =
    activeType === "binder"
      ? (current?.binders?.items ?? []).map(b => ({
          key: b.binderKey ?? b.license,
          name: b.license,
          image: b.image,
          owned: b.owned,
          total: b.total
        }))
      : matchingFolders.slice((page - 1) * 24, page * 24).map(folder => ({
          key: folder.id,
          name: folder.name,
          image: folder.image,
          owned: folder.owned,
          total: folder.total
        }));
  const selected = tab === "binder" ? binders : folders;
  const total =
    activeType === "binder"
      ? (current?.binders?.total ?? 0)
      : matchingFolders.length;
  function toggle(key: string) {
    const change = (previous: Set<string>) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    };
    if (tab === "binder") setBinders(change);
    else setFolders(change);
  }
  async function save() {
    setBusy(true);
    onSaving(true);
    setError(false);
    try {
      await setProfileFeaturedSelection([...binders], [...folders]);
      onSaved();
    } catch {
      setError(true);
      setBusy(false);
    } finally {
      onSaving(false);
    }
  }
  function returnToSelection() {
    setCreating(false);
    setChosenBinder(undefined);
    setQuery("");
    setPage(1);
  }
  if (creating && chosenBinder)
    return (
      <div className="yk-profile-highlight-create">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => setChosenBinder(undefined)}
        >
          {t("changeLicense")}
        </Button>
        <h3>{t("creationTitle", { name: chosenBinder.name })}</h3>
        <FolderEditor
          key={chosenBinder.key}
          binderKey={chosenBinder.key}
          showFeaturedOption={false}
          description={t("creationHint")}
          onSavingChange={saving => {
            setBusy(saving);
            onSaving(saving);
          }}
          onClose={returnToSelection}
          onSaved={id => {
            setFolders(previous => new Set([...previous, id]));
            setTab("folder");
            returnToSelection();
            setRetry(n => n + 1);
          }}
        />
      </div>
    );
  return (
    <div className="yk-profile-highlight-picker">
      <p className="yk-featured-hint">
        {t(creating ? "chooseLicenseHint" : "hint")}
      </p>
      {creating ? (
        <h3>{t("chooseLicenseTitle")}</h3>
      ) : (
        <div
          className="yk-profile-highlight-picker-tabs"
          role="group"
          aria-label={t("type")}
        >
          {(["binder", "folder"] as const).map(kind => (
            <Button
              key={kind}
              variant="secondary"
              aria-pressed={tab === kind}
              disabled={busy}
              onClick={() => {
                setTab(kind);
                setPage(1);
                setQuery("");
              }}
            >
              {t(kind === "binder" ? "bindersTab" : "foldersTab", {
                count: kind === "binder" ? binders.size : folders.size
              })}
            </Button>
          ))}
        </div>
      )}
      {!creating && (
        <div className="yk-profile-highlight-create-actions">
          <Button
            variant="secondary"
            className="yk-profile-create-folder"
            disabled={busy || folders.size >= 100}
            onClick={() => {
              setCreating(true);
              setQuery("");
              setPage(1);
            }}
          >
            {t("createFolder")}
          </Button>
        </div>
      )}
      <input
        type="search"
        aria-label={t(creating ? "searchLicense" : "search")}
        placeholder={t(creating ? "searchLicense" : "search")}
        value={query}
        disabled={busy}
        onChange={e => {
          setQuery(e.target.value);
          setPage(1);
        }}
      />
      {!creating && (
        <div className="yk-profile-highlight-picker-tools">
          <span>{t("limit")}</span>
          <button
            disabled={busy || !selected.size}
            onClick={() => {
              if (tab === "binder") setBinders(new Set());
              else setFolders(new Set());
            }}
          >
            {t("clearTab")}
          </button>
        </div>
      )}
      {error && <p role="alert">{t("saveError")}</p>}
      {!current ? (
        <p role="status">{t("loading")}</p>
      ) : current.error ? (
        <div role="alert">
          <p>{t("loadError")}</p>
          <Button variant="secondary" onClick={() => setRetry(n => n + 1)}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <>
          {!options.length && (
            <p>{t(activeType === "folder" ? "noFolders" : "noBinders")}</p>
          )}
          <ul className="yk-profile-highlight-picker-grid">
            {options.map(option => (
              <li key={option.key}>
                <button
                  type="button"
                  aria-pressed={creating ? undefined : selected.has(option.key)}
                  className="yk-profile-highlight-picker-option"
                  disabled={
                    busy ||
                    (!creating &&
                      !selected.has(option.key) &&
                      selected.size >= 100)
                  }
                  onClick={() => {
                    if (creating)
                      setChosenBinder({ key: option.key, name: option.name });
                    else toggle(option.key);
                  }}
                >
                  <BinderCover image={option.image} license={option.name} />
                  <span>
                    <strong>{option.name}</strong>
                    <small>
                      {t("progress", {
                        owned: option.owned,
                        total: option.total
                      })}
                    </small>
                  </span>
                  <span aria-hidden="true">
                    {creating ? "→" : selected.has(option.key) ? "✓" : "+"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageCount={Math.max(1, Math.ceil(total / 24))}
            onPageChange={setPage}
          />
        </>
      )}
      <footer className="yk-profile-highlight-picker-footer">
        <span role="status">
          {t("selected", { count: binders.size + folders.size })}
        </span>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={creating ? returnToSelection : onClose}
        >
          {t(creating ? "backSelection" : "cancel")}
        </Button>
        {!creating && (
          <Button disabled={busy} onClick={() => void save()}>
            {t(busy ? "saving" : "save")}
          </Button>
        )}
      </footer>
    </div>
  );
}

export function ProfileFeaturedCollection({
  profile,
  isMe,
  loadCards = getFriendPaniniAlbumCardsPage
}: {
  profile: Profile;
  isMe: boolean;
  loadCards?: typeof getFriendPaniniAlbumCardsPage;
}) {
  const t = useTranslations("profileFeatured");
  const [result, setResult] = useState<{
      owner: string;
      data?: FeaturedSelection;
      error?: boolean;
    }>(),
    [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const current = result?.owner === profile.id ? result : undefined;
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [saved]);
  useEffect(() => {
    if (!profile.canViewCollection) return;
    let active = true;
    void getProfileFeaturedItems(profile.id).then(
      data => {
        if (active) setResult({ owner: profile.id, data });
      },
      () => {
        if (active) setResult({ owner: profile.id, error: true });
      }
    );
    return () => {
      active = false;
    };
  }, [profile.id, profile.canViewCollection, refresh]);
  const mixedLoader = useCallback<typeof getFriendPaniniAlbumCardsPage>(
    (owner, options) =>
      options.license.startsWith("folder:")
        ? getLicenseFolderCards(
            options.license.slice(7),
            options.page,
            options.ownedOnly
          )
        : loadCards(owner, options),
    [loadCards]
  );
  if (!profile.canViewCollection) return <ProfilePrivate />;
  return (
    <div className="yk-profile-surface yk-profile-featured-collection">
      <header className="yk-profile-section-heading yk-profile-featured-heading">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("subtitle")}</p>
        </div>
        {isMe && (
          <div className="yk-profile-featured-actions">
            {saved && (
              <span
                className="yk-profile-featured-saved"
                role="status"
                aria-label={t("saved")}
              >
                <span aria-hidden="true">✓</span>
                {t("savedShort")}
              </span>
            )}
            <Button
              variant="secondary"
              aria-label={t("choose")}
              disabled={!current?.data}
              onClick={() => {
                setOpen(true);
                setSaved(false);
              }}
            >
              {t("customize")}
            </Button>
          </div>
        )}
      </header>
      {!current ? (
        <p role="status">{t("loading")}</p>
      ) : current.error ? (
        <div role="alert">
          <p>{t("loadError")}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setResult(undefined);
              setRefresh(n => n + 1);
            }}
          >
            {t("retry")}
          </Button>
        </div>
      ) : current.data?.items.length ? (
        <ProfileFavoriteBinders
          key={profile.id + ":" + refresh}
          ownerId={profile.id}
          ownerName={profile.pseudo}
          albums={current.data.items}
          loadCards={mixedLoader}
          mixedMode
        />
      ) : (
        <div className="yk-profile-surface yk-profile-completion-empty">
          <span aria-hidden="true">☆</span>
          <h3>{t("empty")}</h3>
          <p>{t(isMe ? "emptyOwner" : "emptyVisitor")}</p>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("pickerTitle")}
        className="yk-profile-featured-picker-modal"
      >
        {open && current?.data && (
          <FeaturedPicker
            initial={current.data}
            onClose={() => setOpen(false)}
            onSaving={setBusy}
            onSaved={() => {
              setOpen(false);
              setSaved(true);
              setResult(undefined);
              setRefresh(n => n + 1);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
