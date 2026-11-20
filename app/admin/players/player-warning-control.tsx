"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui";
import { sendPlayerWarningAction, type PlayerWarningState } from "./actions";

export function PlayerWarningControl({
  userId,
  pseudo
}: {
  userId: string;
  pseudo: string;
}) {
  const t = useTranslations("playerWarnings");
  const [warningId, setWarningId] = useState<string>();
  return (
    <>
      <button
        type="button"
        className="yk-button yk-button-secondary"
        onClick={() => setWarningId(crypto.randomUUID())}
      >
        {t("open")}
      </button>
      {warningId && (
        <PlayerWarningForm
          userId={userId}
          warningId={warningId}
          pseudo={pseudo}
          onClose={() => setWarningId(undefined)}
        />
      )}
    </>
  );
}

function PlayerWarningForm({
  userId,
  warningId,
  pseudo,
  onClose
}: {
  userId: string;
  warningId: string;
  pseudo: string;
  onClose: () => void;
}) {
  const t = useTranslations("playerWarnings");
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [state, submit, pending] = useActionState(
    sendPlayerWarningAction.bind(null, userId, warningId),
    "idle" as PlayerWarningState
  );
  const failed = state === "invalidReason" || state === "sendError";

  return (
    <Modal open onClose={() => !pending && onClose()} title={t("open")}>
      {state === "sent" ? (
        <div className="space-y-4">
          <p
            className="yk-feedback yk-feedback-success wrap-anywhere"
            role="status"
          >
            {t("sent", { pseudo })}
          </p>
          <button type="button" className="yk-button" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      ) : (
        <form action={submit} className="space-y-4">
          <label
            htmlFor={reasonId}
            className="block text-sm font-medium wrap-anywhere"
          >
            {t("reasonLabel", { pseudo })}
          </label>
          <textarea
            className="yk-field-control w-full resize-y"
            id={reasonId}
            name="reason"
            rows={4}
            maxLength={500}
            required
            readOnly={pending}
            value={reason}
            onChange={event => setReason(event.target.value)}
          />
          {failed && (
            <p role="alert" className="yk-feedback yk-feedback-error">
              {t(state)}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="yk-button yk-button-secondary"
              disabled={pending}
              onClick={onClose}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              className="yk-button"
              disabled={pending || !reason.trim()}
            >
              {t(pending ? "sending" : "send")}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
