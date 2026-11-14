"use client";

import { useState, useRef, useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import { equipPlayerTitle, markPlayerTitlesSeen } from "@/lib/data/profile";
import { UnreadBadge } from "@/components/unread-badge";

export function NewTitlesBadge({ count }: { count: number }) {
  const t = useTranslations("playerTitles");
  return (
    <UnreadBadge
      count={count}
      label={t("newTitles", { count })}
      accessibleLabel={t("newTitles", { count })}
    />
  );
}

export function PlayerTitle({ titleId = "collector" }: { titleId?: string }) {
  const t = useTranslations("playerTitles");
  return (
    <>{t(t.has(`names.${titleId}`) ? `names.${titleId}` : "names.collector")}</>
  );
}

export function PlayerTitlePicker({
  titleId = "collector",
  unlockedTitleIds,
  unseenTitleIds = [],
  markSeen = markPlayerTitlesSeen,
  onSeen,
  save = equipPlayerTitle,
  onSaved
}: {
  titleId?: string;
  unlockedTitleIds: string[];
  unseenTitleIds?: string[];
  markSeen?: typeof markPlayerTitlesSeen;
  onSeen?: (titleIds: string[]) => void;
  save?: typeof equipPlayerTitle;
  onSaved: (titleId: string) => void;
}) {
  const t = useTranslations("playerTitles");
  const fieldId = useId();
  const picker = useRef<HTMLDivElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const seeing = useRef(false);
  useEffect(() => {
    if (!unseenTitleIds.length) return;
    const frame = requestAnimationFrame(() =>
      picker.current?.scrollIntoView({ block: "center" })
    );
    return () => cancelAnimationFrame(frame);
  }, [unseenTitleIds.length]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const available = unlockedTitleIds.filter(id => t.has(`names.${id}`));
  async function acknowledge() {
    if (seeing.current || !unseenTitleIds.length) return;
    seeing.current = true;
    const shown = unseenTitleIds.filter(id => available.includes(id));
    try {
      await markSeen(shown);
      onSeen?.(shown);
    } catch {
      setStatus(t("seenFailed"));
    } finally {
      seeing.current = false;
    }
  }
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
    <div className="yk-player-title-picker" ref={picker}>
      <div className="yk-player-title-heading">
        <label htmlFor={fieldId}>{t("label")}</label>
        {unseenTitleIds.length > 0 && (
          <button
            type="button"
            aria-label={t("viewNewTitles")}
            onClick={() => {
              select.current?.focus();
              void acknowledge();
            }}
          >
            <NewTitlesBadge count={unseenTitleIds.length} />
          </button>
        )}
      </div>
      <select
        id={fieldId}
        ref={select}
        value={titleId}
        disabled={busy || available.length < 2}
        onChange={event => void change(event.target.value)}
        onPointerDown={() => void acknowledge()}
        onKeyDown={event => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key))
            void acknowledge();
        }}
      >
        {available.map(id => (
          <option key={id} value={id}>
            {t(`names.${id}`)}
          </option>
        ))}
      </select>
      <p role="status" aria-live="polite">
        {busy ? t("saving") : status}
      </p>
    </div>
  );
}
