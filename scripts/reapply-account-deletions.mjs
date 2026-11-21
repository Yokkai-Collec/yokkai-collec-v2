// Administrative tool only: never run automatically or from the browser.
import { createClient } from "@supabase/supabase-js";
import { deleteAccount } from "../lib/server/account-deletion-core.mjs";
import { readFile, open, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

export function parseOptions(args) {
  const options = { apply: false };
  while (args.length) {
    const arg = args.shift();
    if (arg === "--apply") options.apply = true;
    else if (
      ["--export", "--journal"].includes(arg) &&
      args[0] &&
      !args[0].startsWith("--")
    )
      options[arg.slice(2)] = args.shift();
    else throw Error("USAGE: --export <file> OR --journal <file> [--apply]");
  }
  if (
    !!options.export === !!options.journal ||
    (options.export && options.apply)
  )
    throw Error("USAGE: --export <file> OR --journal <file> [--apply]");
  return options;
}

export function validateJournal(value, targetUrl, now = Date.now()) {
  if (
    !value ||
    value.version !== 1 ||
    value.project_url !== targetUrl ||
    !Array.isArray(value.deletions) ||
    !Number.isFinite(Date.parse(value.exported_at)) ||
    Date.parse(value.exported_at) > now
  )
    throw Error("INVALID_JOURNAL_OR_TARGET");
  const seen = new Set();
  for (const entry of value.deletions) {
    if (
      !entry ||
      Object.keys(entry).sort().join(",") !== "deleted_at,user_id" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        entry.user_id
      ) ||
      seen.has(entry.user_id.toLowerCase()) ||
      !Number.isFinite(Date.parse(entry.deleted_at)) ||
      Date.parse(entry.deleted_at) > Date.parse(value.exported_at)
    )
      throw Error("INVALID_JOURNAL_ENTRY");
    seen.add(entry.user_id.toLowerCase());
  }
  return value.deletions;
}

export async function exportJournal(admin, url) {
  const deletions = [];
  let last;
  while (true) {
    let query = admin
      .from("account_deletion_log")
      .select("user_id,deleted_at")
      .order("user_id")
      .limit(1000);
    if (last) query = query.gt("user_id", last);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) throw Error("JOURNAL_EXPORT_FAILED");
    deletions.push(...data);
    if (data.length < 1000) break;
    last = data.at(-1).user_id;
  }
  const journal = {
    version: 1,
    project_url: url,
    exported_at: new Date().toISOString(),
    deletions
  };
  validateJournal(journal, url);
  return journal;
}

async function cancelRestoredAccountBilling(userId, admin) {
  const { loadRestorationBilling } = await import("./restoration-billing.mjs");
  const cancel = await loadRestorationBilling();
  await cancel(userId);
  const { cancelLinkedWhopAccount } =
    await import("../lib/billing/whop-live.mjs");
  await cancelLinkedWhopAccount(userId, admin);
}

export async function reapplyJournal(
  admin,
  entries,
  cancelBilling = cancelRestoredAccountBilling
) {
  for (const { user_id, deleted_at } of entries) {
    try {
      await deleteAccount(user_id, admin, () => cancelBilling(user_id, admin));
      const { error } = await admin
        .from("account_deletion_log")
        .update({ deleted_at })
        .eq("user_id", user_id)
        .gt("deleted_at", deleted_at);
      if (error) throw Error("JOURNAL_DATE_RESTORE_FAILED");
    } catch {
      throw Error(`REAPPLICATION_STOPPED: ${user_id} (no automatic retry)`);
    }
  }
}

async function main() {
  const options = parseOptions([...process.argv.slice(2)]);
  const rawUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !key)
    throw Error("SUPABASE_URL_AND_PRIVATE_SERVICE_KEY_REQUIRED");
  const parsed = new URL(rawUrl);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw Error("HTTPS_PROJECT_ORIGIN_REQUIRED");
  const url = parsed.origin;
  const admin = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  if (options.export) {
    const destination = resolve(options.export);
    const repo = fileURLToPath(new URL("../", import.meta.url));
    const within = relative(repo, destination);
    if (
      within !== ".." &&
      !within.startsWith(`..${sep}`) &&
      !isAbsolute(within)
    )
      throw Error("JOURNAL_MUST_STAY_OUTSIDE_REPOSITORY");
    const journal = await exportJournal(admin, url);
    const file = await open(destination, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(journal, null, 2) + "\n");
      await file.sync();
    } catch (error) {
      await file.close();
      await unlink(destination);
      throw error;
    }
    await file.close();
    console.log(
      `Journal exported: ${journal.deletions.length} UUID/date entries. Keep this private file outside the backup being restored.`
    );
    return;
  }
  const bytes = await readFile(resolve(options.journal));
  const entries = validateJournal(JSON.parse(bytes), url);
  console.log(
    `Target: ${url}\nPlan: ${entries.length} deletions through verified Stripe cancellation when required, SQL preparation, Storage API and hard Auth Admin deletion.\nJournal SHA256: ${createHash("sha256").update(bytes).digest("hex")}`
  );
  if (!options.apply) {
    console.log(
      "DRY-RUN: no writes. Apply requires --apply and interactive confirmation."
    );
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw Error("INTERACTIVE_CONFIRMATION_REQUIRED");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try {
    answer = await rl.question(
      `Restoration completed and game stopped? Type REAPPLY ${entries.length}: `
    );
  } finally {
    rl.close();
  }
  if (answer !== `REAPPLY ${entries.length}`)
    throw Error("CONFIRMATION_REFUSED");
  // Bind the billing store to the same validated restoration target.
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  await reapplyJournal(admin, entries);
  console.log(
    `Reapplication completed: ${entries.length} entries. Verify before reopening the game.`
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(error => {
    const reasons = new Set([
      "INVALID_JOURNAL_OR_TARGET",
      "INVALID_JOURNAL_ENTRY",
      "SUPABASE_URL_AND_PRIVATE_SERVICE_KEY_REQUIRED",
      "HTTPS_PROJECT_ORIGIN_REQUIRED",
      "JOURNAL_MUST_STAY_OUTSIDE_REPOSITORY",
      "INTERACTIVE_CONFIRMATION_REQUIRED",
      "CONFIRMATION_REFUSED",
      "JOURNAL_EXPORT_FAILED"
    ]);
    console.error(
      reasons.has(error.message)
        ? error.message
        : "RESTORATION_CHECK_OR_REAPPLICATION_FAILED"
    );
    console.error(
      "Account deletion restoration failed or refused; no automatic retry. Inspect the journal and completed steps before resuming. No provider details or secrets are printed."
    );
    process.exitCode = 1;
  });
}
