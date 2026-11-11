"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminAction } from "@/lib/auth/admin";
import { createClient } from "@/utils/supabase/server";

const statuses = new Set(["open", "reviewed", "dismissed"]);

export async function resolveTradeQuarantineAction(form: FormData) {
  await requireAdminAction();
  const id = String(form.get("quarantine_id") ?? "");
  const version = Number(form.get("version"));
  const action = String(form.get("decision") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !["release", "cancel"].includes(action) ||
    reason.length < 1 ||
    reason.length > 500
  )
    redirect("/admin/security?quarantine_result=invalid#anticheat-quarantines");
  const client = createClient(await cookies());
  const result = await client.rpc("admin_resolve_trade_quarantine", {
    p_id: id,
    p_version: version,
    p_action: action,
    p_reason: reason
  });
  revalidatePath("/admin/security");
  redirect(
    `/admin/security?quarantine_result=${result.error ? "failed" : "saved"}#anticheat-quarantines`
  );
}

export async function applyDeletedAccountSanctionAction(form: FormData) {
  await requireAdminAction();
  const primaryUserId = String(form.get("primary_user_id") ?? "");
  const accounts = form.getAll("source_account").map(String);
  const note = String(form.get("note") ?? "").trim();
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(primaryUserId) ||
    form.get("confirmation") !== primaryUserId ||
    accounts.length < 1 ||
    accounts.length > 20 ||
    new Set(accounts).size !== accounts.length ||
    accounts.some(id => !uuid.test(id))
  )
    throw new Error("INVALID_DELETED_ACCOUNTS");
  if (note.length < 10 || note.length > 2000)
    throw new Error("INVALID_SANCTION_NOTE");
  const client = createClient(await cookies());
  const result = await client.rpc("admin_apply_deleted_account_sanction", {
    p_primary_user_id: primaryUserId,
    p_deleted_user_ids: accounts,
    p_note: note,
    p_confirmation: primaryUserId,
    p_preview_token: String(form.get("preview_token") ?? "")
  });
  if (result.error) throw new Error("DELETED_ACCOUNT_SANCTION_UNAVAILABLE");
  revalidatePath("/admin/security");
  revalidatePath("/admin/players");
  redirect(
    `/admin/security?sanction=${primaryUserId}&mode=deleted&result=deleted-accounts-applied`
  );
}

export async function applyDeletedSmurfRecoveryAction(form: FormData) {
  await requireAdminAction();
  const primaryUserId = String(form.get("primary_user_id") ?? "");
  const tradeIds = form.getAll("source").map(value => String(value));
  const note = String(form.get("note") ?? "").trim();
  const evidenceReference = String(form.get("evidence_reference") ?? "").trim();
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(primaryUserId) ||
    form.get("confirmation") !== primaryUserId ||
    tradeIds.length < 1 ||
    tradeIds.length > 100 ||
    tradeIds.some(id => !uuid.test(id)) ||
    new Set(tradeIds).size !== tradeIds.length
  )
    throw new Error("DELETED_SMURF_RECOVERY_INVALID");
  if (note.length < 10 || note.length > 2000 || evidenceReference.length > 2000)
    throw new Error("HISTORICAL_EVIDENCE_REQUIRED");
  const client = createClient(await cookies());
  const result = await client.rpc("admin_apply_sanction", {
    p_subject_user_id: primaryUserId,
    p_mode: "deleted",
    p_primary_user_id: null,
    p_trade_ids: tradeIds,
    p_note: note,
    p_evidence_reference: evidenceReference,
    p_preview_token: String(form.get("preview_token") ?? ""),
    p_confirmation: primaryUserId
  });
  if (result.error) throw new Error("DELETED_SMURF_RECOVERY_UNAVAILABLE");
  revalidatePath("/admin/security");
  revalidatePath("/admin/players");
  redirect(
    `/admin/security?sanction=${primaryUserId}&mode=deleted&result=deleted-smurf-recovered`
  );
}

export async function reviewAnticheatCaseAction(form: FormData) {
  await requireAdminAction();
  const userId = String(form.get("user_id") ?? "");
  const status = String(form.get("status") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !statuses.has(status))
    throw new Error("ANTICHEAT_REVIEW_INVALID");
  if (note.length < 5 || note.length > 2000)
    throw new Error("ANTICHEAT_REVIEW_NOTE_INVALID");
  const client = createClient(await cookies());
  const result = await client.rpc("admin_review_anticheat_case", {
    p_user_id: userId,
    p_status: status,
    p_note: note
  });
  if (result.error) throw new Error("ANTICHEAT_REVIEW_UNAVAILABLE");
  revalidatePath("/admin/security");
}

export async function applySmurfSanctionAction(form: FormData) {
  await requireAdminAction();
  const smurfUserId = String(form.get("smurf_user_id") ?? "");
  const primaryUserId = String(form.get("primary_user_id") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  const note = String(form.get("note") ?? "").trim();
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(smurfUserId) ||
    !uuid.test(primaryUserId) ||
    confirmation !== `${smurfUserId}:${primaryUserId}` ||
    smurfUserId === primaryUserId
  )
    throw new Error("SMURF_SANCTION_INVALID");
  if (note.length < 10 || note.length > 2000)
    throw new Error("SMURF_SANCTION_NOTE_INVALID");
  const client = createClient(await cookies());
  const result = await client.rpc("admin_apply_sanction", {
    p_subject_user_id: smurfUserId,
    p_mode: "active",
    p_primary_user_id: primaryUserId,
    p_trade_ids: [],
    p_evidence_reference: "",
    p_preview_token: String(form.get("preview_token") ?? ""),
    p_note: note,
    p_confirmation: smurfUserId
  });
  if (result.error) throw new Error("SMURF_SANCTION_UNAVAILABLE");
  revalidatePath("/admin/security");
  revalidatePath("/admin/players");
  redirect(
    `/admin/security?sanction=${smurfUserId}&primary=${primaryUserId}&role=smurf&result=smurf-sanction-applied`
  );
}
