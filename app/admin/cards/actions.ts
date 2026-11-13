"use server";

import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireAdminAction } from "@/lib/auth/admin";
import { createClient } from "@/utils/supabase/server";
import { MAX_BULK_DELETE_CARDS, type BulkDeletePreview } from "./bulk-delete";
import {
  downloadImage,
  deriveSourceId,
  imagePath,
  imageUrlFromCsvRow,
  importCards,
  splitFranchises,
  validateCard,
  validateImageBytes
} from "@/scripts/import-cards.mjs";

export type AdminActionState = {
  ok: boolean;
  message: string;
  details?: string[];
};

const initialFailure = (
  message: string,
  details?: string[]
): AdminActionState => ({
  ok: false,
  message,
  details
});
const value = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
function cardFailure(error: unknown, fallback: string): AdminActionState {
  const failure = error as { code?: string; message?: string } | null;
  if (
    (failure?.code === "23502" || failure?.code === "23514") &&
    /franchise/i.test(failure.message ?? "")
  ) {
    return initialFailure(
      "Cards without a license are not available yet. Ask an administrator to apply the pending database migration."
    );
  }
  return initialFailure(failure?.message || fallback);
}
const MAX_FRANCHISES = 10;
const CATEGORY_ALBUMS = new Set([
  "ARTIST",
  "BRAINROT",
  "DISNEY CHANNEL",
  "FILM",
  "INTERNET PERSONALITY",
  "KDRAMA",
  "KPOP",
  "MEME",
  "VOCALOID",
  "WWE"
]);

function franchiseInputs(form: FormData) {
  const franchises: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of form.getAll("franchise").entries()) {
    const franchise = String(entry).trim();
    if (!franchise) {
      // Preserve the primary slot so a secondary license is never promoted.
      if (index === 0) franchises.push("");
      continue;
    }
    if (franchise.length > 200)
      throw new Error("A license cannot exceed 200 characters.");
    const key = franchise.toLocaleLowerCase("fr-FR");
    if (seen.has(key)) continue;
    seen.add(key);
    franchises.push(franchise);
  }
  if (franchises.length > MAX_FRANCHISES)
    throw new Error(`Maximum ${MAX_FRANCHISES} licenses per card.`);
  return franchises;
}

function albumFranchises(franchises: string[], category: string) {
  if (!franchises[0]) return franchises.slice(1);
  const normalizedCategory = category.trim().toUpperCase();
  if (normalizedCategory === "ARTIST") return franchises;
  if (CATEGORY_ALBUMS.has(normalizedCategory)) return [normalizedCategory];
  return franchises;
}
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

function normalizeCsvRow(row: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, cell]) => [
      key
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, ""),
      cell
    ])
  );
}

function cardInput(form: FormData, franchises: string[]) {
  return validateCard({
    source_id: value(form, "source_id"),
    nom: value(form, "nom"),
    categorie: value(form, "categorie"),
    franchise: franchises[0] ?? "",
    franchise_romaji: "",
    image_url: value(form, "image_url") || "https://local.invalid/upload",
    favoris_count: "",
    rarete_base: value(form, "rarete_base"),
    source: "manual"
  });
}

async function imageForCard(
  form: FormData,
  card: ReturnType<typeof validateCard>
) {
  const file = form.get("image_file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMAGE_BYTES)
      throw new Error("The image exceeds 6 MiB.");
    if (!ALLOWED_MIME.has(file.type))
      throw new Error("Unsupported image format.");
    const bytes = Buffer.from(await file.arrayBuffer());
    validateImageBytes(bytes, file.type);
    return { bytes, contentType: file.type };
  }
  if (card.image_url.includes("local.invalid"))
    throw new Error("Add an image file or an HTTPS URL.");
  return downloadImage(card.image_url);
}

type AuthenticatedClient = ReturnType<typeof createClient>;

async function syncCategory(
  client: AuthenticatedClient,
  cardId: string,
  category: string
) {
  const { error: deleteError } = await client
    .from("card_categories")
    .delete()
    .eq("card_id", cardId);
  if (deleteError) throw deleteError;
  const { error: insertError } = await client.from("card_categories").insert({
    card_id: cardId,
    categorie: category
  });
  if (insertError) throw insertError;
}

async function syncFranchises(
  client: AuthenticatedClient,
  cardId: string,
  franchises: string[]
) {
  const table = () => client.from("card_franchises");
  const { data: previous, error: readError } = await table()
    .select("franchise,position")
    .eq("card_id", cardId);
  if (readError) throw readError;
  const { error: deleteError } = await table().delete().eq("card_id", cardId);
  if (deleteError) throw deleteError;
  // One insert per licence: the DB trigger canonicalizes names (e.g.
  // "Black Butler II" → "Black Butler"), so aliases collapse into a duplicate
  // (23505) that we skip instead of failing the whole card. Skipped positions
  // leave harmless gaps; links are only ever ordered by position.
  for (const link of franchises.map((franchise, position) => ({
    card_id: cardId,
    franchise,
    position
  }))) {
    const { error } = await table().insert(link);
    if (error && error.code !== "23505") {
      // ponytail: compensating restore, not a transaction; an RPC would be atomic.
      await table().delete().eq("card_id", cardId);
      if (previous?.length)
        await table().insert(
          previous.map(old => ({ card_id: cardId, ...old }))
        );
      throw error;
    }
  }
}

// A CSV cell "One Piece / Naruto" links the card to every listed licence,
// exactly like the multi-licence fields of the edit form.
async function syncImportedFranchises(
  client: AuthenticatedClient,
  rows: { source: string; source_id: string; categorie: string }[],
  franchisesByRow: string[][]
) {
  const ids = new Map<string, string>();
  for (let start = 0; start < rows.length; start += 100) {
    const chunk = rows.slice(start, start + 100);
    const { data, error } = await client
      .from("cards")
      .select("id,source,source_id")
      .in(
        "source_id",
        chunk.map(row => row.source_id)
      );
    if (error) throw error;
    for (const card of data ?? [])
      ids.set(`${card.source}\0${card.source_id}`, card.id);
  }
  for (const [index, row] of rows.entries()) {
    const id = ids.get(`${row.source}\0${row.source_id}`);
    const franchises = albumFranchises(franchisesByRow[index], row.categorie);
    // An empty list clears stale links, matching the cleared cards.franchise.
    if (id) await syncFranchises(client, id, franchises);
  }
}

export async function createCardAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdminAction();
    const client = createClient(await cookies());
    const franchises = franchiseInputs(form);
    const card = cardInput(form, franchises);
    const image = await imageForCard(form, card);
    const path = imagePath(card);
    const { error: uploadError } = await client.storage
      .from("card-images")
      .upload(path, image.bytes, {
        contentType: image.contentType,
        upsert: true,
        cacheControl: "3600"
      });
    if (uploadError) throw uploadError;
    card.image_url = client.storage
      .from("card-images")
      .getPublicUrl(path).data.publicUrl;
    const { data, error } = await client
      .from("cards")
      .upsert(card, {
        onConflict: "source,source_id",
        defaultToNull: false
      })
      .select(
        "id,source_id,nom,categorie,franchise,rarete_base,image_url,source"
      )
      .single();
    if (error) throw error;
    await syncCategory(client, data.id, data.categorie);
    await syncFranchises(
      client,
      data.id,
      albumFranchises(franchises, data.categorie)
    );
    const { error: auditError } = await client.from("admin_audit_logs").insert({
      admin_user_id: admin.id,
      action: "card.create",
      card_id: data.id,
      card_snapshot: { ...data, franchises }
    });
    if (auditError) throw auditError;
    revalidatePath("/admin/cards");
    return { ok: true, message: `${data.nom} has been published.` };
  } catch (error) {
    return cardFailure(error, "Unable to create this card.");
  }
}

export async function importCardsAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdminAction();
    const file = form.get("csv");
    if (!(file instanceof File) || !file.size)
      throw new Error("Choose a CSV file.");
    if (file.size > 1024 * 1024) throw new Error("The CSV exceeds 1 MiB.");
    const records = parse(await file.text(), {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      max_record_size: 1024 * 1024
    }) as Record<string, string>[];
    if (!records.length) throw new Error("The CSV is empty.");
    if (records.length > 500) throw new Error("Maximum 500 cards per import.");
    const franchisesByRow: string[][] = [];
    const rows = records.map((rawRow, index) => {
      const row = normalizeCsvRow(rawRow);
      const sourceId = (row.source_id || row.identifiant || "").trim();
      const nom = row.nom ?? row.name ?? row.personnage ?? row.character ?? "";
      let franchises: string[];
      try {
        franchises = splitFranchises(
          row.franchise ?? row.licence ?? row.anime ?? ""
        );
      } catch (error) {
        throw new Error(
          `Card “${nom.trim()}” (row ${index + 1}): ${(error as Error).message}`
        );
      }
      franchisesByRow.push(franchises);
      const card = {
        source_id: sourceId,
        nom,
        categorie: row.categorie ?? row.category ?? "",
        franchise: franchises[0] ?? "",
        franchise_romaji: row.franchise_romaji ?? "",
        image_url: imageUrlFromCsvRow(row).replace(/^http:\/\//i, "https://"),
        favoris_count: row.favoris_count ?? "",
        rarete_base: row.rarete_base ?? row.rarete ?? row.rarity ?? "",
        // validateCard generates a deterministic ID for manual rows. An admin
        // CSV without source_id is therefore safely rerunnable without duplicates.
        source: sourceId ? row.source || "manual" : "manual"
      };
      if (!card.source_id) card.source_id = deriveSourceId(card);
      return card;
    });
    const client = createClient(await cookies());
    const failures: string[] = [];
    const writtenRecords: number[] = [];
    const stats = await importCards({
      rows,
      client,
      bucket: "card-images",
      batchSize: 25,
      concurrency: 2,
      announcements: true,
      log: () => {},
      onWritten: async (records: number[]) => {
        writtenRecords.push(...records);
      },
      onFailure: async (failure: { record: number; message: string }) => {
        const cardName = rows[failure.record - 1]?.nom.trim();
        const cardLabel = cardName ? `Card “${cardName}”` : "Unnamed card";
        failures.push(
          `${cardLabel} (row ${failure.record}): ${failure.message}`
        );
      }
    });
    await syncImportedFranchises(
      client,
      writtenRecords.map(record => rows[record - 1]),
      writtenRecords.map(record => franchisesByRow[record - 1])
    );
    const { error: auditError } = await client.from("admin_audit_logs").insert({
      admin_user_id: admin.id,
      action: "card.import",
      metadata: { filename: file.name, ...stats }
    });
    if (auditError) throw auditError;
    revalidatePath("/admin/cards");
    return {
      ok: true,
      message: `${stats.imported} card(s) imported, ${stats.skipped} rejected.`,
      details: failures.slice(0, 20)
    };
  } catch (error) {
    return initialFailure(
      error instanceof Error ? error.message : "Unable to import cards."
    );
  }
}

export async function updateCardAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  try {
    const admin = await requireAdminAction();
    const id = value(form, "id");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid card ID.");
    const franchises = franchiseInputs(form);
    const patch: {
      nom: string;
      categorie: string;
      franchise: string | null;
      rarete_base: string;
      image_url?: string;
    } = {
      nom: value(form, "nom"),
      categorie: value(form, "categorie"),
      franchise: franchises[0] || null,
      rarete_base: value(form, "rarete_base")
    };
    if (!patch.nom || !patch.categorie)
      throw new Error("Name and category are required.");
    if (!["C", "R", "SR", "SSR", "LR"].includes(patch.rarete_base))
      throw new Error("Invalid rarity.");
    const client = createClient(await cookies());
    const { data: current, error: readError } = await client
      .from("cards")
      .select("id,source,source_id,image_url")
      .eq("id", id)
      .single();
    if (readError) throw readError;
    const imageUrl = value(form, "image_url");
    const imageFile = form.get("image_file");
    if (imageUrl || (imageFile instanceof File && imageFile.size > 0)) {
      const imageCard = {
        ...current,
        ...patch,
        image_url: imageUrl || current.image_url
      } as ReturnType<typeof validateCard>;
      const image = await imageForCard(form, imageCard);
      // A replacement must get a new public URL. Overwriting the stable import
      // path leaves browsers and the Storage CDN serving the previous image
      // until cacheControl expires.
      const path = `${imagePath(imageCard)}-${randomUUID()}`;
      const { error: uploadError } = await client.storage
        .from("card-images")
        .upload(path, image.bytes, {
          contentType: image.contentType,
          upsert: true,
          // Unique path: the file never changes, so caches can keep it.
          cacheControl: "31536000"
        });
      if (uploadError) throw uploadError;
      patch.image_url = client.storage
        .from("card-images")
        .getPublicUrl(path).data.publicUrl;
    }
    const { data, error } = await client
      .from("cards")
      .update(patch)
      .eq("id", id)
      .select(
        "id,source_id,nom,categorie,franchise,rarete_base,image_url,source"
      )
      .single();
    if (error) throw error;
    await syncCategory(client, id, patch.categorie);
    await syncFranchises(
      client,
      id,
      albumFranchises(franchises, patch.categorie)
    );
    const { error: auditError } = await client.from("admin_audit_logs").insert({
      admin_user_id: admin.id,
      action: "card.update",
      card_id: id,
      card_snapshot: { ...data, franchises }
    });
    if (auditError) throw auditError;
    revalidatePath("/admin/cards");
    revalidatePath(`/admin/cards/${id}`);
    revalidatePath("/admin/reports");
    return { ok: true, message: `${data.nom} has been updated.` };
  } catch (error) {
    return cardFailure(error, "Unable to update this card.");
  }
}

export async function deleteCardAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  try {
    await requireAdminAction();
    const id = value(form, "id");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid card ID.");
    const client = createClient(await cookies());
    const { data, error } = await client.rpc("admin_delete_card", {
      p_card_id: id
    });
    if (error) throw error;
    const result = data as {
      name?: string;
      ownedCopiesRemoved?: number;
      auctionsCancelled?: number;
      pendingTradesDeclined?: number;
    } | null;
    revalidatePath("/admin/cards");
    revalidatePath(`/admin/cards/${id}`);
    revalidatePath("/admin/reports");
    return {
      ok: true,
      message:
        `${result?.name ?? "The card"} has been deleted along with ` +
        `${Number(result?.ownedCopiesRemoved ?? 0)} copy/copies, ` +
        `${Number(result?.auctionsCancelled ?? 0)} auction(s) and ` +
        `${Number(result?.pendingTradesDeclined ?? 0)} pending trade(s).`
    };
  } catch (error) {
    return initialFailure(
      error instanceof Error ? error.message : "Unable to delete this card."
    );
  }
}

const BULK_ERRORS: Record<string, string> = {
  ADMIN_REQUIRED: "Administrator access required.",
  NO_CARDS_SELECTED: "No cards selected.",
  BULK_LIMIT_EXCEEDED: `Maximum ${MAX_BULK_DELETE_CARDS} cards per bulk deletion.`,
  CARD_NOT_FOUND:
    "Some cards no longer exist. Nothing was deleted; reload the page."
};

function bulkCardIds(ids: unknown) {
  if (!Array.isArray(ids) || !ids.length)
    throw new Error(BULK_ERRORS.NO_CARDS_SELECTED);
  const unique = [...new Set(ids.map(String))];
  if (unique.length > MAX_BULK_DELETE_CARDS)
    throw new Error(BULK_ERRORS.BULK_LIMIT_EXCEEDED);
  if (unique.some(id => !/^[0-9a-f-]{36}$/i.test(id)))
    throw new Error("Invalid card ID.");
  return unique;
}

function bulkFailure(error: unknown): AdminActionState {
  const { message = "", details } = (error ?? {}) as {
    message?: string;
    details?: string;
  };
  return initialFailure(
    BULK_ERRORS[message] ?? (message || "Unable to delete these cards."),
    message === "CARD_NOT_FOUND" && details
      ? details.split(",").map(id => `Card not found: ${id}`)
      : undefined
  );
}

export async function previewDeleteCardsAction(
  ids: string[]
): Promise<AdminActionState & { preview?: BulkDeletePreview }> {
  try {
    await requireAdminAction();
    const client = createClient(await cookies());
    const { data, error } = await client.rpc("admin_preview_delete_cards", {
      p_card_ids: bulkCardIds(ids)
    });
    if (error) throw error;
    return { ok: true, message: "", preview: data as BulkDeletePreview };
  } catch (error) {
    return bulkFailure(error);
  }
}

export async function deleteCardsAction(
  ids: string[],
  confirmation: string
): Promise<AdminActionState> {
  try {
    await requireAdminAction();
    const cardIds = bulkCardIds(ids);
    if (confirmation.trim() !== String(cardIds.length))
      throw new Error(`Enter exactly ${cardIds.length} to confirm deletion.`);
    const client = createClient(await cookies());
    const { data, error } = await client.rpc("admin_delete_cards", {
      p_card_ids: cardIds
    });
    if (error) throw error;
    const result = data as {
      cardsDeleted?: number;
      ownedCopiesRemoved?: number;
      auctionsCancelled?: number;
      pendingTradesDeclined?: number;
    } | null;
    revalidatePath("/admin/cards");
    return {
      ok: true,
      message:
        `${Number(result?.cardsDeleted ?? 0)} card(s) deleted along with ` +
        `${Number(result?.ownedCopiesRemoved ?? 0)} copy/copies, ` +
        `${Number(result?.auctionsCancelled ?? 0)} auction(s) and ` +
        `${Number(result?.pendingTradesDeclined ?? 0)} pending trade(s).`
    };
  } catch (error) {
    return bulkFailure(error);
  }
}
