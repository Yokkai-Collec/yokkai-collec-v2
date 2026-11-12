"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { anticheatSanctionLabel } from "@/lib/anticheat-sanction-labels";
import { createClient } from "@/utils/supabase/client";
import "@/styles/account-sanctions.css";

type Receipt = {
  sanction_id: string;
  sanction_type:
    | "AFFILIATE_ABUSE_SANCTION"
    | "AFFILIATE_ABUSE_WARNING_WITH_PENALTY"
    | "AFFILIATE_ABUSE_WARNING"
    | "AFFILIATE_ABUSE_NETWORK_WARNING"
    | "SMURF_ASSET_RECOVERY"
    | "FARM_BAN"
    | "FARM_WARNING"
    | "FARM_SUSPENSION"
    | "SHARED_TRADE_BAN"
    | "SHARED_TRADE_WARNING"
    | "SHARED_TRADE_SUSPENSION";
  cards_removed: number;
  kara_removed: number;
};

// No local receipt: only the committed server acknowledgement can dismiss this.
export function AccountSanctionNotice() {
  const t = useTranslations("accountSanctions");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const receipt = receipts[0];
  const receiptId = receipt?.sanction_id;
  useEffect(() => {
    const client = createClient();
    let active = true;
    let revision = 0;
    let pending = false;
    let reload = false;
    let userId: string | undefined;
    const load = async () => {
      if (!active || document.visibilityState !== "visible") return;
      if (pending) {
        reload = true;
        return;
      }
      pending = true;
      const request = ++revision;
      try {
        const {
          data: { session }
        } = await client.auth.getSession();
        if (!active || request !== revision) return;
        if (!session) {
          setReceipts([]);
          return;
        }
        userId = session.user?.id;
        const { data, error } = await client
          .rpc("get_my_pending_sanctions")
          .setHeader("x-client-info", "yokkai-assets-notice-v1");
        if (active && request === revision && !error) setReceipts(data ?? []);
      } catch {
        // Keep unseen notices pending on the server; retry on the next wake-up.
      } finally {
        pending = false;
        if (active && reload) {
          reload = false;
          void load();
        }
      }
    };
    void load();
    const {
      data: { subscription }
    } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        revision++;
        userId = undefined;
        setReceipts([]);
      } else if (event === "SIGNED_IN" && session?.user?.id !== userId) {
        revision++;
        userId = session?.user.id;
        setReceipts([]);
        setTimeout(() => {
          if (active) void load();
        }, 0);
      }
    });
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    const poll = setInterval(visible, 30_000);
    return () => {
      active = false;
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visible);
      clearInterval(poll);
    };
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!receiptId || !element) return;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      previous?.focus({ preventScroll: true });
    };
  }, [receiptId]);
  if (!receipt) return null;
  const anticheatKind = anticheatSanctionLabel(receipt.sanction_type);
  const kind =
    anticheatKind ??
    (receipt.sanction_type === "SMURF_ASSET_RECOVERY"
      ? "recovery"
      : receipt.sanction_type === "AFFILIATE_ABUSE_SANCTION"
        ? "sanction"
        : receipt.sanction_type === "AFFILIATE_ABUSE_WARNING_WITH_PENALTY"
          ? "penalty"
          : receipt.sanction_type === "AFFILIATE_ABUSE_NETWORK_WARNING"
            ? "networkWarning"
            : "warning");
  const acknowledge = async () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const { data, error } = await createClient().rpc(
        "acknowledge_my_sanction",
        { p_sanction_id: receipt.sanction_id }
      );
      if (error || data !== true) {
        setFailed(true);
        return;
      }
      setReceipts(items =>
        items.filter(item => item.sanction_id !== receipt.sanction_id)
      );
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="yk-sanction-notice"
      aria-labelledby={title}
      onCancel={event => event.preventDefault()}
    >
      <h2 id={title}>{t(`${kind}.title`)}</h2>
      <p>{t(`${kind}.intro`)}</p>
      {!anticheatKind && kind !== "warning" && kind !== "networkWarning" && (
        <>
          <p>{t(`${kind}.decision`)}</p>
          <dl>
            <div>
              <dt>{t("cardsRemoved")}</dt>
              <dd>{receipt.cards_removed}</dd>
            </div>
            <div>
              <dt>{t("karaRemoved")}</dt>
              <dd>{receipt.kara_removed}</dd>
            </div>
          </dl>
          <p>{t(`${kind}.explanation`)}</p>
        </>
      )}
      <p>{t(`${kind}.rules`)}</p>
      <p>{t(`${kind}.future`)}</p>
      {failed && <p role="alert">{t("saveError")}</p>}
      <button
        type="button"
        disabled={saving}
        onClick={() => void acknowledge()}
      >
        {t(saving ? "saving" : "acknowledge")}
      </button>
    </dialog>
  );
}
