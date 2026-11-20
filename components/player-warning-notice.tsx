"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { startVisiblePolling } from "@/lib/ui/visible-polling";
import { createClient } from "@/utils/supabase/client";
import "@/styles/account-sanctions.css";

type Warning = { id: string; reason: string };

export function PlayerWarningNotice() {
  const [userId, setUserId] = useState<string>();
  useEffect(() => {
    const {
      data: { subscription }
    } = createClient().auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);
  return userId ? <PendingPlayerWarning key={userId} userId={userId} /> : null;
}

function PendingPlayerWarning({ userId }: { userId: string }) {
  const [warning, setWarning] = useState<Warning | null>(null);
  const request = useRef<AbortController>(null);
  const refresh = useCallback(async () => {
    if (document.hidden) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const { data, error } = await createClient()
      .from("player_warnings")
      .select("id, reason")
      .eq("user_id", userId)
      .is("acknowledged_at", null)
      .order("created_at")
      .order("id")
      .limit(1)
      .abortSignal(controller.signal)
      .maybeSingle();
    if (!controller.signal.aborted && !error) setWarning(data);
  }, [userId]);

  useEffect(() => {
    const client = createClient();
    const stop = startVisiblePolling(() => void refresh(), 30_000);
    const changes = {
      schema: "public",
      table: "player_warnings",
      filter: `user_id=eq.${userId}`
    };
    const reload = () => void refresh();
    const channel = client
      .channel(`player-warnings:${userId}:${crypto.randomUUID()}`)
      .on("postgres_changes", { ...changes, event: "INSERT" }, reload)
      .on("postgres_changes", { ...changes, event: "UPDATE" }, reload)
      .subscribe(status => {
        if (status === "SUBSCRIBED") void refresh();
      });
    return () => {
      stop();
      request.current?.abort();
      void client.removeChannel(channel);
    };
  }, [refresh, userId]);

  return warning ? (
    <PlayerWarningDialog
      key={warning.id}
      warning={warning}
      onAcknowledged={() => {
        request.current?.abort();
        setWarning(current => (current?.id === warning.id ? null : current));
        void refresh();
      }}
    />
  ) : null;
}

function PlayerWarningDialog({
  warning,
  onAcknowledged
}: {
  warning: Warning;
  onAcknowledged: () => void;
}) {
  const t = useTranslations("playerWarnings");
  const title = useId();
  const description = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  async function acknowledge() {
    setSaving(true);
    setFailed(false);
    try {
      const { data, error } = await createClient().rpc(
        "acknowledge_player_warning",
        { p_id: warning.id }
      );
      if (error || data !== true) setFailed(true);
      else onAcknowledged();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="yk-sanction-notice"
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={event => event.preventDefault()}
    >
      <h2 id={title} className="flex items-center gap-3 font-semibold">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full border border-amber-300/50 bg-amber-300/10 text-base text-amber-300"
        >
          !
        </span>
        {t("noticeTitle")}
      </h2>
      <p id={description} className="text-slate-300">
        {t("noticeIntro")}
      </p>
      <p className="whitespace-pre-wrap rounded-lg bg-white/5 px-4 py-3">
        {warning.reason}
      </p>
      {failed && <p role="alert">{t("acknowledgeError")}</p>}
      <button
        type="button"
        disabled={saving}
        onClick={() => void acknowledge()}
      >
        {t(saving ? "acknowledging" : "acknowledge")}
      </button>
    </dialog>
  );
}
