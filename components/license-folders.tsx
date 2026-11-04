"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, Pagination } from "@/components/ui";
import { BinderCover } from "@/components/binder-cover";
import { CollectionCoverEditor } from "@/components/collection-cover-editor";
import { YokaiCard } from "@/components/yokai-card";
import {
  BinderContents,
  type ProfileFavoriteAlbum
} from "@/components/profile-favorite-binders";
import {
  getPaniniAlbumCardsPage,
  type PaniniAlbumCardPage
} from "@/lib/data/cards";
import {
  getLicenseFolders,
  getLicenseFolderCards,
  saveLicenseFolder,
  deleteLicenseFolder,
  type LicenseFolder
} from "@/lib/data/license-folders";
import type { getFriendPaniniAlbumCardsPage } from "@/lib/data/profile";
import "@/styles/license-folders.css";

const folderLoader: typeof getFriendPaniniAlbumCardsPage = (_owner, options) =>
  getLicenseFolderCards(options.license, options.page, options.ownedOnly);
function album(folder: LicenseFolder): ProfileFavoriteAlbum {
  return {
    binderKey: folder.id,
    license: folder.name,
    total: folder.total,
    owned: folder.owned,
    percent: folder.total ? Math.round((folder.owned * 100) / folder.total) : 0,
    image: folder.image
  };
}
function errorKey(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "";
  const keys: Record<string, string> = {
    LICENSE_FOLDER_NAME_TAKEN: "nameTaken",
    LICENSE_FOLDER_NAME_INVALID: "invalidName",
    LICENSE_FOLDER_LIMIT: "folderLimit",
    LICENSE_FOLDER_CARDS_INVALID: "invalidCards",
    LICENSE_FOLDER_NOT_FOUND: "notFound"
  };
  return keys[code] ?? "error";
}
export function FolderEditor({
  binderKey,
  folder,
  onSaved,
  onClose,
  onSavingChange,
  showFeaturedOption = true,
  description
}: {
  binderKey: string;
  folder?: LicenseFolder;
  onSaved: (id: string) => void;
  onClose: () => void;
  onSavingChange: (saving: boolean) => void;
  showFeaturedOption?: boolean;
  description?: string;
}) {
  const t = useTranslations("licenseFolders");
  const [name, setName] = useState(folder?.name ?? ""),
    [featured, setFeatured] = useState(folder?.featured ?? false);
  const [selected, setSelected] = useState(new Set(folder?.cardIds ?? []));
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [ownedOnly, setOwnedOnly] = useState(false),
    [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = JSON.stringify([binderKey, query, page, ownedOnly, retry]);
  const [result, setResult] = useState<{
    key: string;
    data?: PaniniAlbumCardPage;
    error?: boolean;
  }>();
  const current = result?.key === request ? result : undefined;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void getPaniniAlbumCardsPage({
        license: binderKey,
        query,
        page,
        pageSize: 24,
        ownedOnly
      }).then(
        data => {
          if (active) setResult({ key: request, data });
        },
        () => {
          if (active) setResult({ key: request, error: true });
        }
      );
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [binderKey, query, page, ownedOnly, request]);
  async function save() {
    setBusy(true);
    onSavingChange(true);
    setError("");
    try {
      const id = await saveLicenseFolder({
        id: folder?.id,
        binderKey,
        name,
        featured,
        cardIds: [...selected]
      });
      onSaved(id);
    } catch (e) {
      setError(errorKey(e));
      setBusy(false);
    } finally {
      onSavingChange(false);
    }
  }
  return (
    <div className="yk-license-folder-editor">
      <p className="yk-license-folder-hint">{description ?? t("hint")}</p>
      <label className="yk-license-folder-name">
        {t("name")}
        <input
          autoFocus
          maxLength={60}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          disabled={busy}
        />
      </label>
      {showFeaturedOption && (
        <label className="yk-license-folder-featured">
          <input
            type="checkbox"
            checked={featured}
            onChange={e => setFeatured(e.target.checked)}
            disabled={busy}
          />
          {t("feature")}
        </label>
      )}
      <div className="yk-license-folder-search">
        <input
          aria-label={t("search")}
          type="search"
          value={query}
          placeholder={t("search")}
          onChange={e => {
            setQuery(e.target.value);
            setPage(1);
          }}
          disabled={busy}
        />
        <label>
          <input
            type="checkbox"
            checked={ownedOnly}
            onChange={e => {
              setOwnedOnly(e.target.checked);
              setPage(1);
            }}
            disabled={busy}
          />
          {t("ownedOnly")}
        </label>
      </div>
      {error && (
        <p role="alert" className="yk-license-folder-error">
          {t(error)}
        </p>
      )}
      {!current ? (
        <p role="status">{t("loading")}</p>
      ) : current.error ? (
        <div role="alert">
          <p>{t("error")}</p>
          <Button variant="secondary" onClick={() => setRetry(n => n + 1)}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <>
          {!current.data?.items.length && <p>{t("noCards")}</p>}
          <ul className="yk-license-folder-card-grid">
            {current.data?.items.map(card => (
              <li key={card.id}>
                <button
                  type="button"
                  className="yk-license-folder-card"
                  aria-pressed={selected.has(card.id)}
                  aria-label={t(selected.has(card.id) ? "unselect" : "select", {
                    name: card.name
                  })}
                  disabled={
                    busy || (!selected.has(card.id) && selected.size >= 500)
                  }
                  onClick={() =>
                    setSelected(previous => {
                      const next = new Set(previous);
                      if (next.has(card.id)) next.delete(card.id);
                      else next.add(card.id);
                      return next;
                    })
                  }
                >
                  <YokaiCard {...card} animated={false} />
                  <span className="yk-license-folder-card-label">
                    <strong>{card.name}</strong>
                    <span>{selected.has(card.id) ? "✓" : "+"}</span>
                  </span>
                  <small>{t(card.owned ? "owned" : "missing")}</small>
                </button>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageCount={Math.max(1, Math.ceil((current.data?.total ?? 0) / 24))}
            onPageChange={setPage}
          />
        </>
      )}
      <footer className="yk-license-folder-save">
        <span role="status">{t("selected", { count: selected.size })}</span>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button disabled={busy || !name.trim()} onClick={() => void save()}>
          {t(busy ? "saving" : "save")}
        </Button>
      </footer>
    </div>
  );
}

export function LicenseFolderManager({
  binderKey,
  binderName
}: {
  binderKey: string;
  binderName: string;
}) {
  const t = useTranslations("licenseFolders");
  const [folders, setFolders] = useState<LicenseFolder[]>([]),
    [refresh, setRefresh] = useState(0),
    [page, setPage] = useState(1);
  const [editor, setEditor] = useState<LicenseFolder | "new">(),
    [view, setView] = useState<LicenseFolder>(),
    [removing, setRemoving] = useState<LicenseFolder>();
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void getLicenseFolders(undefined, binderKey).then(
      data => {
        if (active) {
          setFolders(data);
          setError("");
        }
      },
      e => {
        if (active) setError(errorKey(e));
      }
    );
    return () => {
      active = false;
    };
  }, [binderKey, refresh]);
  const activePage = Math.min(page, Math.max(1, Math.ceil(folders.length / 6)));
  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError("");
    try {
      await deleteLicenseFolder(removing.id);
      setRemoving(undefined);
      setRefresh(n => n + 1);
      setNotice(t("deleted"));
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="secondary"
        className="yk-license-folder-create"
        onClick={() => setEditor("new")}
      >
        <span aria-hidden="true">＋</span>
        {t("create")}
      </Button>
      {(folders.length > 0 || error || notice) && (
        <div className="yk-license-folder-list">
          <h3>{t("inBinder", { name: binderName })}</h3>
          {error && (
            <p role="alert" className="yk-license-folder-error">
              {t(error)}{" "}
              <Button
                variant="secondary"
                onClick={() => setRefresh(n => n + 1)}
              >
                {t("retry")}
              </Button>
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <ul>
            {folders.slice((activePage - 1) * 6, activePage * 6).map(folder => (
              <li key={folder.id}>
                <button
                  className="yk-license-folder-open"
                  onClick={() => setView(folder)}
                >
                  <BinderCover image={folder.image} license={folder.name} />
                  <span>
                    <strong>{folder.name}</strong>
                    <small>
                      {t("progress", {
                        owned: folder.owned,
                        total: folder.total
                      })}
                    </small>
                    {folder.featured && (
                      <small className="yk-license-folder-star">
                        ★ {t("featured")}
                      </small>
                    )}
                  </span>
                </button>
                <div className="yk-license-folder-actions">
                  <CollectionCoverEditor
                    targetKey={`folder:${folder.id}`}
                    name={folder.name}
                    onSaved={() => setRefresh(n => n + 1)}
                  />
                  <button onClick={() => setEditor(folder)}>{t("edit")}</button>
                  <button
                    onClick={() => {
                      setError("");
                      setRemoving(folder);
                    }}
                  >
                    {t("delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {folders.length > 6 && (
            <Pagination
              page={activePage}
              pageCount={Math.ceil(folders.length / 6)}
              onPageChange={setPage}
            />
          )}
        </div>
      )}
      <Modal
        open={!!editor}
        onClose={() => {
          if (!busy) setEditor(undefined);
        }}
        title={t(editor === "new" ? "createTitle" : "editTitle")}
        className="yk-license-folder-modal"
      >
        {editor && (
          <FolderEditor
            key={editor === "new" ? "new" : editor.id}
            binderKey={binderKey}
            folder={editor === "new" ? undefined : editor}
            onClose={() => setEditor(undefined)}
            onSavingChange={setBusy}
            onSaved={() => {
              setEditor(undefined);
              setRefresh(n => n + 1);
              setNotice(t("saved"));
            }}
          />
        )}
      </Modal>
      <Modal
        open={!!view}
        onClose={() => setView(undefined)}
        title={view?.name ?? ""}
        className="yk-profile-favorite-binder-modal"
      >
        {view && (
          <BinderContents
            key={view.id}
            ownerId="self"
            album={album(view)}
            loadCards={folderLoader}
          />
        )}
      </Modal>
      <Modal
        open={!!removing}
        onClose={() => {
          if (!busy) setRemoving(undefined);
        }}
        title={t("deleteTitle")}
      >
        <p>{t("deleteHint", { name: removing?.name ?? "" })}</p>
        {error && <p role="alert">{t(error)}</p>}
        <div className="yk-license-folder-actions">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setRemoving(undefined)}
          >
            {t("cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            {t("delete")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
