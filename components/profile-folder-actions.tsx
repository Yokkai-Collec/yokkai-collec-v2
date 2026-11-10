"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@/components/ui";
import { FolderEditor } from "@/components/license-folders";
import {
  getLicenseFolders,
  saveLicenseFolder,
  type LicenseFolder
} from "@/lib/data/license-folders";

export function ProfileFolderActions({
  folderId,
  onUpdated
}: {
  folderId: string;
  onUpdated: () => void;
}) {
  const t = useTranslations("licenseFolders");
  const [mode, setMode] = useState<"cards" | "name">();
  const [folder, setFolder] = useState<LicenseFolder>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open(next: "cards" | "name") {
    setBusy(true);
    setError("");
    try {
      const current = (await getLicenseFolders()).find(
        item => item.id === folderId
      );
      if (!current) throw new Error("LICENSE_FOLDER_NOT_FOUND");
      setFolder(current);
      setName(current.name);
      setMode(next);
    } catch {
      setError(t("notFound"));
    } finally {
      setBusy(false);
    }
  }

  function saved() {
    setMode(undefined);
    onUpdated();
  }

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    if (!folder) return;
    setBusy(true);
    setError("");
    try {
      await saveLicenseFolder({ ...folder, name: name.trim() });
      saved();
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : String((cause as { message?: string })?.message);
      setError(
        t(message === "LICENSE_FOLDER_NAME_TAKEN" ? "nameTaken" : "error")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button disabled={busy} onClick={() => void open("cards")}>
        <span aria-hidden="true">＋</span>
        {t("addCards")}
      </Button>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => void open("name")}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z" />
        </svg>
        {t("rename")}
      </Button>
      {error && !mode && <p role="alert">{error}</p>}
      <Modal
        open={!!mode}
        onClose={() => {
          if (!busy) setMode(undefined);
        }}
        title={t(mode === "name" ? "rename" : "addCards")}
        className={
          mode === "cards"
            ? "yk-license-folder-modal"
            : "yk-profile-folder-rename-modal"
        }
      >
        {mode === "cards" && folder && (
          <FolderEditor
            folder={folder}
            binderKey={folder.binderKey}
            onSaved={saved}
            onClose={() => setMode(undefined)}
            onSavingChange={setBusy}
            showFeaturedOption={false}
          />
        )}
        {mode === "name" && (
          <form className="yk-profile-folder-rename" onSubmit={rename}>
            <label>
              {t("name")}
              <input
                autoFocus
                value={name}
                maxLength={60}
                disabled={busy}
                onChange={event => setName(event.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setMode(undefined)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {t("saveName")}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
