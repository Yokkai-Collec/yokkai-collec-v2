"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";

export function BlackoutProCheckout({ preview }: { preview: boolean }) {
  const t = useTranslations("blackout");
  const premium = useTranslations("premiumUi");
  const endpoint = preview
    ? "/api/billing/whop-sandbox"
    : "/api/billing/checkout?offer=blackout";
  const checkoutOrigin = preview
    ? "https://sandbox.whop.com"
    : "https://whop.com";
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openCheckout() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "BILLING_CHECKOUT_CLOSED") {
          setError(t("checkoutClosed"));
        } else {
          setError(
            premium(
              result.code === "BILLING_USE_PORTAL"
                ? "alreadyHasSubscription"
                : "billingUnavailable"
            )
          );
        }
        return;
      }
      const url = new URL(result.url);
      if (
        url.origin !== checkoutOrigin ||
        url.username ||
        url.password ||
        !/^[/]checkout[/]ch_[A-Za-z0-9]+[/]?$/.test(url.pathname)
      )
        throw Error("Invalid Whop destination");
      window.location.assign(url.href);
    } catch {
      setError(premium("billingUnavailable"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        className="yk-blackout-pro-checkout"
        disabled={busy}
        onClick={openCheckout}
      >
        {busy ? premium("openingWhop") : t("checkoutOnWhop")}
      </Button>
      {error && (
        <p className="text-sm text-ink-2" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
