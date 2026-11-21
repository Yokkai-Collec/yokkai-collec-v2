"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

const endpoint = "/api/billing/whop-sandbox";
type Status = { status: string; active: boolean };

export function WhopSandboxPreview({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("whopSandbox");
  const format = useFormatter();
  const [state, setState] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState(false);
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let request: AbortController | undefined;
    async function refresh() {
      if (document.hidden || request) return;
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw Error();
        const status = (await response.json()) as Status;
        if (!controller.signal.aborted) {
          setState(status);
          setStatusError(false);
        }
      } catch {
        if (!controller.signal.aborted) setStatusError(true);
      } finally {
        request = undefined;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => {
      request?.abort();
      window.clearInterval(timer);
    };
  }, [signedIn]);

  async function openCheckout() {
    setBusy(true);
    setCheckoutError(false);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      if (!response.ok) throw Error();
      const { url } = await response.json();
      const checkout = new URL(url);
      if (
        checkout.origin !== "https://sandbox.whop.com" ||
        checkout.username ||
        checkout.password ||
        !/^\/checkout\/ch_[A-Za-z0-9]+\/$/.test(checkout.pathname)
      )
        throw Error();
      window.location.assign(checkout.href);
    } catch {
      setCheckoutError(true);
    } finally {
      setBusy(false);
    }
  }

  const canCheckout =
    state?.status === "not_started" || state?.status === "pending";
  const label = !state
    ? "checking"
    : state.active
      ? state.status === "trialing"
        ? "trialActive"
        : "active"
      : state.status === "not_started"
        ? "notStarted"
        : state.status === "pending"
          ? "pending"
          : "inactive";

  return (
    <main style={{ maxWidth: 680, margin: "48px auto", padding: 24 }}>
      <h1>Yokkai Pro · Whop Sandbox</h1>
      <p>
        {t("offer", {
          price: format.number(4.99, { style: "currency", currency: "EUR" })
        })}
      </p>
      {!signedIn ? (
        <Link
          className="yk-button"
          href="/login?next=%2Fdesign-system%2Fwhop-preview"
        >
          {t("signIn")}
        </Link>
      ) : (
        <>
          <p className="mt-4" role="status">
            {t(label)}
          </p>
          {state?.active && (
            <Link className="yk-button" href="/boosters">
              {t("openPacks")}
            </Link>
          )}
          {canCheckout && (
            <button
              className="yk-button yk-button-primary"
              type="button"
              disabled={busy || statusError}
              onClick={() => void openCheckout()}
            >
              {t(
                state.status === "pending" ? "resumeCheckout" : "startCheckout"
              )}
            </button>
          )}
          {checkoutError && <p role="alert">{t("checkoutError")}</p>}
          {statusError && <p role="alert">{t("statusError")}</p>}
          {canCheckout && (
            <p className="mt-4">
              {t("testCard", { card: "4242 4242 4242 4242" })}
            </p>
          )}
        </>
      )}
    </main>
  );
}
