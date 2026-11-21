import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { BillingError } from "./config";
import { logBillingFailure } from "./observability";
import {
  whopApiVersion,
  whopSandboxConfig,
  whopSandboxService
} from "./whop-sandbox";

const membershipEvents = new Set([
  "membership.activated",
  "membership.deactivated",
  "membership.updated",
  "membership.cancel_at_period_end_changed"
]);

export function verifiedWhopEvent(
  body: Uint8Array,
  headers: Headers,
  secret: string,
  account: string,
  now = Date.now()
) {
  const id = headers.get("webhook-id") ?? "";
  const timestamp = headers.get("webhook-timestamp") ?? "";
  const signature = headers.get("webhook-signature") ?? "";
  const invalid = () => new BillingError("BILLING_SIGNATURE_INVALID", 400);
  if (
    !/^msg_[A-Za-z0-9]{1,100}$/.test(id) ||
    !/^\d{1,12}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000 ||
    signature.length > 2048
  )
    throw invalid();
  const expected = createHmac("sha256", secret)
    .update(id + "." + timestamp + ".")
    .update(body)
    .digest();
  if (
    !signature.split(/\s+/).some(value => {
      if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(value)) return false;
      const supplied = Buffer.from(value.slice(3), "base64");
      return (
        supplied.length === expected.length &&
        timingSafeEqual(supplied, expected)
      );
    })
  )
    throw invalid();

  let event;
  try {
    event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new BillingError("BILLING_INVALID_REQUEST", 400);
  }
  if (
    event?.id !== id ||
    event.account_id !== account ||
    event.api_version !== "v1" ||
    event.api_version_date !== whopApiVersion
  )
    throw new BillingError("BILLING_ACCOUNT_MISMATCH", 400);
  if (!membershipEvents.has(event.type)) return null;
  const membershipId = event.data?.id;
  if (
    typeof membershipId !== "string" ||
    !/^mem_[A-Za-z0-9]{1,100}$/.test(membershipId)
  )
    throw new BillingError("BILLING_INVALID_REQUEST", 400);
  return { id, membershipId };
}

type Job = { event_id: string; membership_id: string; lease_token: string };

export function sandboxWhopWebhook(env = process.env) {
  const config = whopSandboxConfig(env);
  const secret = env.WHOP_SANDBOX_WEBHOOK_SECRET ?? "";
  if (!config || !/^ws_[A-Za-z0-9_+/-]{16,}={0,2}$/.test(secret))
    throw new BillingError("BILLING_DISABLED", 404);
  const db = createClient(config.database, config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const sandbox = whopSandboxService(config);
  const unavailable = () => new BillingError("BILLING_STORAGE_UNAVAILABLE");
  return {
    async enqueue(body: Uint8Array, headers: Headers) {
      const event = verifiedWhopEvent(body, headers, secret, config.account);
      if (!event) return null;
      const { error } = await db.from("whop_sandbox_webhook_jobs").upsert(
        {
          scope: config.scope,
          event_id: event.id,
          membership_id: event.membershipId
        },
        { onConflict: "scope,event_id", ignoreDuplicates: true }
      );
      if (error) throw unavailable();
      return event.id;
    },
    async drain(eventId: string | null = null) {
      let processed = 0,
        failed = 0;
      const deadline = Date.now() + 12000;
      // The worker can be restarted or run on several instances; each lease
      // admits one worker and retries an unfinished job after its backoff.
      while (processed + failed < (eventId ? 1 : 8) && Date.now() < deadline) {
        const { data, error } = await db
          .rpc("whop_sandbox_claim_webhook", {
            p_scope: config.scope,
            p_event_id: eventId
          })
          .returns<Job[]>();
        if (error || !Array.isArray(data)) throw unavailable();
        const job: Job | undefined = data[0];
        if (!job) break;
        try {
          await sandbox.refreshFromWebhook(job.membership_id);
          const { error: saveError } = await db
            .from("whop_sandbox_webhook_jobs")
            .update({
              processed_at: new Date().toISOString(),
              lease_token: null
            })
            .eq("scope", config.scope)
            .eq("event_id", job.event_id)
            .eq("lease_token", job.lease_token);
          if (saveError) throw unavailable();
          processed++;
        } catch (err) {
          failed++;
          logBillingFailure("webhook", err);
        }
      }
      return { processed, failed };
    }
  };
}
