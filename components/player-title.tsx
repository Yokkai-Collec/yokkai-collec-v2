"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { equipPlayerTitle } from "@/lib/data/profile";

export function PlayerTitle({ titleId = "collector" }: { titleId?: string }) {
  const t = useTranslations("playerTitles");
  return (
    <>{t(t.has(`names.${titleId}`) ? `names.${titleId}` : "names.collector")}</>
  );
}

export function PlayerTitlePicker({
  titleId = "collector",
  unlockedTitleIds,
  save = equipPlayerTitle,
  onSaved
}: {
  titleId?: string;
  unlockedTitleIds: string[];
  save?: typeof equipPlayerTitle;
  onSaved: (titleId: string) => void;
}) {
  const t = useTranslations("playerTitles");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const available = unlockedTitleIds.filter(id => t.has(`names.${id}`));
  async function change(id: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setStatus("");
    try {
      onSaved(await save(id));
      setStatus(t("saved"));
    } catch (error) {
      setStatus(
        t(
          error instanceof Error && error.message === "TITLE_NOT_UNLOCKED"
            ? "notUnlocked"
            : "saveFailed"
        )
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="yk-player-title-picker">
      <label>
        <span>{t("label")}</span>
        <select
          value={titleId}
          disabled={busy || available.length < 2}
          onChange={event => void change(event.target.value)}
        >
          {available.map(id => (
            <option key={id} value={id}>
              {t(`names.${id}`)}
            </option>
          ))}
        </select>
      </label>
      <p>{t("unlockedOnly")}</p>
      <p role="status" aria-live="polite">
        {busy ? t("saving") : status}
      </p>
    </div>
  );
}
