"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminAction } from "@/lib/auth/admin";
import { createClient } from "@/utils/supabase/server";

const statuses = new Set(["open", "reviewed", "dismissed"]);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function simulateFarmAction(form: FormData) {
  await requireAdminAction();
  const cluster = String(form.get("cluster") ?? "");
  if (!uuid.test(cluster)) redirect("/admin/security#anticheat-clusters");
  const client = createClient(await cookies());
  const { error } = await client.rpc("admin_simulate_anticheat_farm", {
    p_cluster: cluster
  });
  revalidatePath("/admin/security");
  redirect(
    `/admin/security?cluster=${cluster}&farm_result=${error ? "failed" : "saved"}#anticheat-clusters`
  );
}

export async function applyFarmAssetRecoveryAction(form: FormData) {
  await requireAdminAction();
  const cluster = String(form.get("cluster") ?? "");
  const kind = String(form.get("kind") ?? "");
  const asset = String(form.get("asset") ?? "");
  const token = String(form.get("token") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!uuid.test(cluster)) redirect("/admin/security#anticheat-clusters");
  const destination = `/admin/security?cluster=${cluster}&farm_result=`;
  if (
    !uuid.test(asset) ||
    !["CARD", "SALE"].includes(kind) ||
    !/^[0-9a-f]{32}$/.test(token) ||
    reason.length < 10 ||
    reason.length > 500
  ) {
    redirect(`${destination}invalid#anticheat-clusters`);
  }
  const client = createClient(await cookies());
  const { error } = await client.rpc("admin_apply_anticheat_asset_recovery", {
    p_cluster: cluster,
    p_kind: kind,
    p_asset: asset,
    p_token: token,
    p_reason: reason
  });
  if (error)
    await client.rpc("admin_record_anticheat_recovery_failure", {
      p_asset: asset,
      p_code: error.code ?? ""
    });
  revalidatePath("/admin/security");
  redirect(`${destination}${error ? "failed" : "saved"}#anticheat-clusters`);
}

export async function issueAppealTokenAction(
  _state: { token?: string; failed?: boolean },
  form: FormData
) {
  await requireAdminAction();
  const receipt = String(form.get("receipt") ?? "");
  const reason = String(form.get("identity") ?? "").trim();
  if (!uuid.test(receipt) || reason.length < 20 || reason.length > 500)
    return { failed: true };
  const client = createClient(await cookies());
  const { data, error } = await client.rpc(
    "admin_issue_anticheat_appeal_token",
    { p_receipt: receipt, p_verified_identity_note: reason }
  );
  return error || typeof data !== "string" ? { failed: true } : { token: data };
}

export async function compensateAppealAssetAction(form: FormData) {
  await requireAdminAction();
  const appeal = String(form.get("appeal") ?? "");
  const recovery = String(form.get("recovery") ?? "");
  const kind = String(form.get("kind") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const dest = "/admin/security?appeal_result=";
  if (
    !uuid.test(appeal) ||
    !uuid.test(recovery) ||
    !["CARD", "SALE", "PACK"].includes(kind) ||
    reason.length < 10 ||
    reason.length > 500
  )
    redirect(`${dest}invalid#anticheat-appeals`);
  const client = createClient(await cookies());
  const { error } = await client.rpc("admin_compensate_anticheat_recovery", {
    p_appeal: appeal,
    p_kind: kind,
    p_recovery: recovery,
    p_reason: reason
  });
  revalidatePath("/admin/security");
  redirect(`${dest}${error ? "failed" : "saved"}#anticheat-appeals`);
}

export async function cancelPendingReferralRewardAction(form: FormData) {
  await requireAdminAction();
  const cluster = String(form.get("cluster") ?? "");
  const referral = String(form.get("referral") ?? "");
  const version = String(form.get("version") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!uuid.test(cluster)) redirect("/admin/security#anticheat-clusters");
  const destination = `/admin/security?cluster=${cluster}&farm_result=`;
  if (
    !uuid.test(referral) ||
    !/^[0-9a-f]{32}$/.test(version) ||
    reason.length < 10 ||
    reason.length > 500
  )
    redirect(`${destination}invalid#anticheat-clusters`);
  const client = createClient(await cookies());
  const { error } = await client.rpc("admin_cancel_anticheat_pending_reward", {
    p_cluster: cluster,
    p_version: version,
    p_referral: referral,
    p_reason: reason
  });
  revalidatePath("/admin/security");
  redirect(`${destination}${error ? "failed" : "saved"}#anticheat-clusters`);
}

export async function recoverUnusedReferralLotAction(form: FormData) {
  await requireAdminAction();
  const cluster = String(form.get("cluster") ?? "");
  const lot = String(form.get("lot") ?? "");
  const version = String(form.get("version") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const packs = Number(form.get("packs"));
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (!uuid.test(cluster)) redirect("/admin/security#anticheat-clusters");
  const destination = `/admin/security?cluster=${cluster}&farm_result=`;
  if (
    !uuid.test(lot) ||
    !/^[0-9a-f]{32}$/.test(version) ||
    !Number.isSafeInteger(packs) ||
    packs < 1 ||
    packs > 5 ||
    reason.length < 10 ||
    reason.length > 500
  ) {
    redirect(`${destination}invalid#anticheat-clusters`);
  }
  const client = createClient(await cookies());
  const { error } = await client.rpc(
    "admin_recover_anticheat_unused_reward_lot",
    {
      p_cluster: cluster,
      p_version: version,
      p_lot: lot,
      p_expected_packs: packs,
      p_reason: reason
    }
  );
  revalidatePath("/admin/security");
  redirect(`${destination}${error ? "failed" : "saved"}#anticheat-clusters`);
}

export async function reviewSanctionAppealAction(form: FormData) {
  await requireAdminAction();
  const id = String(form.get("appeal_id") ?? "");
  const outcome = String(form.get("outcome") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const destination = "/admin/security?appeal_result=";
  if (
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
    ![
      "UPHELD",
      "CORRECTION_REQUIRED",
      "VOID_WARNING",
      "RESTORE_RESTRICTION"
    ].includes(outcome) ||
    reason.length < 10 ||
    reason.length > 1000
  ) {
    redirect(`${destination}invalid#anticheat-appeals`);
  }
  const client = createClient(await cookies());
  const { error } =
    outcome === "VOID_WARNING"
      ? await client.rpc("admin_void_anticheat_warning", {
          p_appeal: id,
          p_reason: reason
        })
      : outcome === "RESTORE_RESTRICTION"
        ? await client.rpc("admin_restore_anticheat_restriction", {
            p_appeal: id,
            p_reason: reason
          })
        : await client.rpc("admin_review_anticheat_appeal", {
            p_id: id,
            p_outcome: outcome,
            p_reason: reason
          });
  revalidatePath("/admin/security");
  redirect(`${destination}${error ? "failed" : "saved"}#anticheat-appeals`);
}

export async function reviewAnticheatFarmAction(form: FormData) {
  await requireAdminAction();
  const id = String(form.get("cluster_id") ?? "");
  const version = String(form.get("version") ?? "");
  const decision = String(form.get("decision") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    redirect("/admin/security#anticheat-clusters");
  }
  const destination = `/admin/security?cluster=${id}`;
  if (
    !/^[0-9a-f]{32}$/.test(version) ||
    !["CONFIRMED", "DISMISSED"].includes(decision) ||
    reason.length < 10 ||
    reason.length > 500
  ) {
    redirect(`${destination}&farm_result=invalid#anticheat-clusters`);
  }
  const client = createClient(await cookies());
  const { error } = await client.rpc("admin_review_anticheat_farm", {
    p_id: id,
    p_version: version,
    p_decision: decision,
    p_reason: reason
  });
  revalidatePath("/admin/security");
  redirect(
    `${destination}&farm_result=${error ? "failed" : "saved"}#anticheat-clusters`
  );
}

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
