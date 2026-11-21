import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const zero = "00000000-0000-0000-0000-000000000000";
const fail = code => {
  throw Error(`STRIPE_RECONCILE_${code}`);
};

// Scheduler entrypoint. Secrets stay in the container; provider reads happen
// through the existing authenticated endpoint, never via browser credentials.
export async function reconcileStripe(
  env,
  { fetchImpl = fetch, now = Date.now } = {}
) {
  if (env.STRIPE_BILLING_ENABLED === "false")
    return { skipped: true, reason: "billing_disabled" };
  if (
    env.NODE_ENV !== "production" ||
    env.STRIPE_BILLING_MODE !== "live" ||
    env.STRIPE_BILLING_ENABLED !== "true" ||
    env.NEXT_PUBLIC_SITE_URL !== "https://yokkai-collec.com" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(env.STRIPE_RECONCILIATION_SECRET ?? "")
  )
    fail("CONFIGURATION_INVALID");
  const deadline = now() + 240000;
  let checked = 0,
    pages = 0;
  for (let pass = 1; pass <= 2; pass++) {
    let after = zero,
      failed = 0;
    const seen = new Set([zero]);
    do {
      const remaining = deadline - now();
      if (remaining <= 0) fail("DEADLINE_EXCEEDED");
      let response, body;
      try {
        response = await fetchImpl(
          `https://yokkai-collec.com/api/billing/reconcile?after=${after}`,
          {
            method: "POST",
            redirect: "error",
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${env.STRIPE_RECONCILIATION_SECRET}`
            },
            signal: AbortSignal.timeout(Math.min(45000, remaining))
          }
        );
        if (![200, 503].includes(response.status)) fail("REQUEST_FAILED");
        body = await response.json();
      } catch {
        fail("REQUEST_FAILED");
      }
      if (
        !body ||
        !Number.isInteger(body.checked) ||
        body.checked < 0 ||
        body.checked > 100 ||
        !Number.isInteger(body.failed) ||
        body.failed < 0 ||
        body.failed > body.checked ||
        (response.status === 200 && body.failed !== 0) ||
        (response.status === 503 && body.failed === 0) ||
        !(
          body.next === null ||
          (typeof body.next === "string" && uuid.test(body.next))
        )
      )
        fail("RESPONSE_INVALID");
      checked += body.checked;
      failed += body.failed;
      pages++;
      if (body.next === null) break;
      const next = body.next.toLowerCase();
      if (!body.checked || next <= after || seen.has(next))
        fail("CURSOR_INVALID");
      seen.add(next);
      after = next;
    } while (true);
    if (failed === 0)
      return { skipped: false, checked, pages, passes: pass, failed: 0 };
    // A 503 may carry a valid next cursor: finish every page first, then retry
    // from the beginning so failed accounts behind that cursor are not lost.
  }
  fail("ACCOUNTS_FAILED");
}

export async function monitoredReconcileStripe(
  env,
  { log = value => console.log(value), ...dependencies } = {}
) {
  const started = Date.now();
  try {
    const result = await reconcileStripe(env, dependencies);
    log(
      JSON.stringify({
        event: "billing.reconciliation_completed",
        severity: "info",
        at: new Date().toISOString(),
        durationMs: Date.now() - started,
        ...result
      })
    );
    return result;
  } catch (error) {
    const code = /^STRIPE_RECONCILE_[A-Z_]+$/.test(error?.message ?? "")
      ? error.message
      : "STRIPE_RECONCILE_FAILED";
    log(
      JSON.stringify({
        event: "billing.reconciliation_failed",
        severity: "error",
        at: new Date().toISOString(),
        durationMs: Date.now() - started,
        code
      })
    );
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await monitoredReconcileStripe(process.env, {
      log: value => console.error(value)
    });
  } catch {
    process.exitCode = 1;
  }
  if (process.env.WHOP_LIVE_SYNC_ENABLED === "true") {
    try {
      const { reconcileWhopLive } =
        await import("../lib/billing/whop-live.mjs");
      const result = await reconcileWhopLive(process.env);
      console.error(
        JSON.stringify({ event: "billing.whop_live_reconciled", ...result })
      );
      if (result.failed) process.exitCode = 1;
    } catch {
      console.error(
        JSON.stringify({ event: "billing.whop_live_reconciliation_failed" })
      );
      process.exitCode = 1;
    }
  }
}
