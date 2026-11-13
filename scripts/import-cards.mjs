import { createReadStream } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import {
  isAnilistAnime,
  anilistImportRow,
  immutableAnilistImagePath
} from "./anilist-import-provenance.mjs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { parse } from "csv-parse";
import { createClient } from "@supabase/supabase-js";
import {
  publicImageFetch,
  validateImageURL
} from "../lib/server/public-image-fetch.mjs";

const COLUMNS = [
  "source_id",
  "nom",
  "categorie",
  "franchise",
  "franchise_romaji",
  "image_url",
  "favoris_count",
  "rarete_base",
  "source"
];
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const IMGUR_HOSTS = new Set([
  "imgur.com",
  "www.imgur.com",
  "i.imgur.com",
  "m.imgur.com"
]);

export async function* readCards(path) {
  const input = createReadStream(path);
  const parser = parse({
    bom: true,
    skip_empty_lines: true,
    max_record_size: 1024 * 1024,
    record_delimiter: ["\r\n", "\n", "\r"],
    columns(headers) {
      const missing = COLUMNS.filter(column => !headers.includes(column));
      if (missing.length)
        throw new Error(`Colonnes CSV manquantes : ${missing.join(", ")}`);
      if (new Set(headers).size !== headers.length)
        throw new Error("Colonnes CSV dupliquées.");
      return headers;
    }
  });
  input.on("error", error => parser.destroy(error));
  input.pipe(parser);
  try {
    yield* parser;
  } finally {
    input.destroy();
    parser.destroy();
  }
}

export function deriveSourceId(row) {
  const source = row.source?.trim() || "manual";
  const name = row.nom?.trim();
  const category = row.categorie?.trim();
  if (!name || !category) return "";
  const identity =
    source === "manual"
      ? `${category.toLocaleLowerCase("fr")}\0${name.toLocaleLowerCase("fr")}`
      : `${source.toLocaleLowerCase("fr")}\0${category.toLocaleLowerCase("fr")}\0${name.toLocaleLowerCase("fr")}`;
  const prefix = source === "manual" ? "manual" : "generated";
  return `${prefix}-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

export function imageUrlFromCsvRow(row) {
  return (
    [row.image_url, row.image, row.image_source, row[""]].find(value =>
      value?.trim()
    ) ?? ""
  ).trim();
}

// "One Piece / Naruto" → two licences. Spaces around "/" are required so that
// real titles such as "Fate/Zero" stay intact.
export function splitFranchises(value) {
  const seen = new Set();
  const franchises = [];
  for (const part of String(value ?? "").split(/\s+\/\s+/)) {
    const franchise = part.trim();
    const key = franchise.toLocaleLowerCase("fr-FR");
    if (!franchise || seen.has(key)) continue;
    if (franchise.length > 200)
      throw new Error("A license cannot exceed 200 characters.");
    seen.add(key);
    franchises.push(franchise);
  }
  if (franchises.length > 10) throw new Error("Maximum 10 licenses per card.");
  return franchises;
}

export function validateCard(row) {
  const card = Object.fromEntries(
    COLUMNS.map(column => [column, row[column]?.trim() ?? ""])
  );
  if (!card.source_id) card.source_id = deriveSourceId(card);
  card.franchise ||= null;
  for (const column of [
    "source_id",
    "nom",
    "categorie",
    "source",
    "image_url"
  ]) {
    if (!card[column]) throw new Error(`Empty field: ${column}`);
  }
  if (!["C", "R", "SR", "SSR", "LR"].includes(card.rarete_base)) {
    throw new Error("Invalid rarity.");
  }
  if (
    card.favoris_count !== "" &&
    (!/^\d+$/.test(card.favoris_count) ||
      Number(card.favoris_count) > 2147483647)
  ) {
    throw new Error("favoris_count must be a non-negative PostgreSQL integer.");
  }
  const url = new URL(card.image_url);
  if (url.protocol !== "https:") throw new Error("The image must use HTTPS.");
  if (url.pathname.endsWith("/default.jpg"))
    throw new Error("Default AniList image.");
  card.favoris_count =
    card.favoris_count === "" ? null : Number(card.favoris_count);
  card.franchise_romaji ||= null;
  return card;
}

function failure(message, status, details = {}) {
  return Object.assign(new Error(message), { status, ...details });
}

export function retryAfterMilliseconds(value, now = Date.now()) {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value.trim()))
    return Math.ceil(Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

export function createImageRequestLimiter(
  fetchImage = publicImageFetch,
  {
    sleep = delay,
    now = Date.now,
    imgurIntervalMs = 2000,
    imgurCooldownMs = 60000
  } = {}
) {
  const states = new Map();
  return async (input, init) => {
    const hostname = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url
    ).hostname.toLowerCase();
    if (!IMGUR_HOSTS.has(hostname)) return fetchImage(input, init);

    const state = states.get(hostname) ?? {
      tail: Promise.resolve(),
      nextRequestAt: 0
    };
    states.set(hostname, state);
    const previous = state.tail;
    let release;
    state.tail = new Promise(resolve => {
      release = resolve;
    });
    await previous;
    try {
      const wait = Math.max(0, state.nextRequestAt - now());
      if (wait) await sleep(wait);
      state.nextRequestAt = now() + imgurIntervalMs;
      const response = await fetchImage(input, init);
      if (response.status === 429) {
        const serverDelay = retryAfterMilliseconds(
          response.headers.get("retry-after"),
          now()
        );
        state.nextRequestAt = Math.max(
          state.nextRequestAt,
          now() + (serverDelay || imgurCooldownMs)
        );
      }
      return response;
    } finally {
      release();
    }
  };
}

export async function retry(operation, attempts = 3, sleep = delay) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const status = Number(error.status ?? error.statusCode);
      const transient =
        [0, 408, 429].includes(status) ||
        status >= 500 ||
        error.name === "TimeoutError" ||
        error.name === "AbortError" ||
        error instanceof TypeError;
      if (!transient || attempt >= attempts) throw error;
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 10000);
      await sleep(Math.max(backoff, Number(error.retryAfterMs) || 0));
    }
  }
}

export async function downloadImage(
  url,
  fetchImage = publicImageFetch,
  timeoutMs = 30000
) {
  // Never forward the Supabase client's authorization headers to image hosts.
  const source = validateImageURL(url);
  const headers = {
    Accept:
      "image/avif,image/webp,image/apng,image/jpeg,image/png,image/gif,image/*;q=0.8,*/*;q=0.1",
    "User-Agent":
      "Mozilla/5.0 (compatible; Yokkai-Collec-Image-Importer/0.2; +https://yokkai.fr)"
  };
  if (
    ["static.wikia.nocookie.net", "vignette.wikia.nocookie.net"].includes(
      source.hostname
    )
  ) {
    headers.Referer = "https://www.fandom.com/";
  }
  const response = await fetchImage(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    await response.body?.cancel();
    const retryAfterMs = retryAfterMilliseconds(
      response.headers.get("retry-after")
    );
    throw failure(
      `Image download failed: HTTP ${response.status}`,
      response.status,
      {
        finalUrl: response.url || url,
        retryAfterMs
      }
    );
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (!MIME_TYPES.includes(contentType)) {
    await response.body?.cancel();
    throw new Error("Non-image response or unsupported format.");
  }
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    throw new Error("Image exceeds 6 MiB.");
  }
  if (!response.body) throw new Error("Empty image.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_IMAGE_BYTES) throw new Error("Image exceeds 6 MiB.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (!size) throw new Error("Empty image.");
  const bytes = Buffer.concat(chunks);
  validateImageBytes(bytes, contentType);
  return { bytes, contentType, finalUrl: response.url || url };
}

export function validateImageBytes(bytes, contentType) {
  let valid = false;
  if (contentType === "image/png") {
    valid =
      bytes.length >= 24 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.subarray(12, 16).toString("ascii") === "IHDR" &&
      bytes.readUInt32BE(16) > 0 &&
      bytes.readUInt32BE(20) > 0 &&
      bytes.includes(Buffer.from("IEND"));
  } else if (contentType === "image/jpeg") {
    valid =
      bytes.length >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[bytes.length - 2] === 0xff &&
      bytes[bytes.length - 1] === 0xd9;
  } else if (contentType === "image/gif") {
    const signature = bytes.subarray(0, 6).toString("ascii");
    valid =
      bytes.length >= 14 &&
      ["GIF87a", "GIF89a"].includes(signature) &&
      bytes.readUInt16LE(6) > 0 &&
      bytes.readUInt16LE(8) > 0 &&
      bytes[bytes.length - 1] === 0x3b;
  } else if (contentType === "image/webp") {
    valid =
      bytes.length >= 16 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP" &&
      bytes.readUInt32LE(4) + 8 === bytes.length;
  }
  if (!valid) throw new Error(`Invalid or undecodable ${contentType} content.`);
}

export function imagePath(card) {
  // Stable, collision-resistant names; no user-provided path fragments.
  return `${createHash("sha256")
    .update(JSON.stringify([card.source, card.source_id]))
    .digest("hex")}`;
}

export function cardNameCategoryKey(card) {
  return JSON.stringify([card.nom.trim(), card.categorie.trim()]);
}

export function planNameCategoryImport(rows, existing) {
  const csvByKey = new Map();
  for (const row of rows) {
    const card = validateCard(row);
    const key = cardNameCategoryKey(card);
    if (csvByKey.has(key))
      throw new Error(
        `Collision CSV sur (nom, categorie) : ${card.nom} / ${card.categorie}`
      );
    csvByKey.set(key, card);
  }
  const dbByKey = new Map();
  for (const card of existing) {
    const key = cardNameCategoryKey(card);
    if (dbByKey.has(key))
      throw new Error(
        `Collision en base sur (nom, categorie) : ${card.nom} / ${card.categorie}`
      );
    dbByKey.set(key, card);
  }
  const updates = [];
  const inserts = [];
  for (const [key, card] of csvByKey) {
    const current = dbByKey.get(key);
    if (current) updates.push({ card, current });
    else inserts.push(card);
  }
  return { updates, inserts };
}

export async function checked(request) {
  const result = await request;
  if (result.error)
    throw Object.assign(new Error(result.error.message), {
      status: result.error.statusCode ?? result.status,
      code: result.error.code
    });
  return result.data;
}

async function allCardsForCategories(client, categories) {
  const cards = [];
  for (const category of categories) {
    for (let from = 0; ; from += 1000) {
      const page = await retry(() =>
        checked(
          client
            .from("cards")
            .select(
              "id,source_id,nom,categorie,franchise,rarete_base,image_url,source"
            )
            .eq("categorie", category)
            .range(from, from + 999)
        )
      );
      cards.push(...page);
      if (page.length < 1000) break;
    }
  }
  return cards;
}

export async function compareNameCategoryImport({ rows, client }) {
  const input = [];
  for await (const row of rows) input.push(row);
  const categories = [
    ...new Set(input.map(row => row.categorie?.trim()).filter(Boolean))
  ];
  const existing = await allCardsForCategories(client, categories);
  const plan = planNameCategoryImport(input, existing);
  const changedRarityIds = plan.updates
    .filter(({ card, current }) => card.rarete_base !== current.rarete_base)
    .map(({ current }) => current.id);
  let evolvedCopies = 0;
  for (let offset = 0; offset < changedRarityIds.length; offset += 200) {
    const ids = changedRarityIds.slice(offset, offset + 200);
    const copies = await retry(() =>
      checked(
        client
          .from("user_cards")
          .select("id")
          .eq("is_evolved", true)
          .in("card_id", ids)
      )
    );
    evolvedCopies += copies.length;
  }
  return {
    ...plan,
    total: input.length,
    changedRarities: changedRarityIds.length,
    evolvedCopies
  };
}

export async function applyNameCategoryImport({
  plan,
  client,
  bucket = "card-images",
  concurrency = 5,
  announcements = false,
  fetchImage = publicImageFetch,
  log = console.log,
  onFailure = async () => {},
  sleep = delay
}) {
  const limitedFetch = createImageRequestLimiter(fetchImage, { sleep });
  const work = [
    ...plan.updates.map((item, index) => ({
      ...item,
      kind: "update",
      index: index + 1
    })),
    ...plan.inserts.map((card, index) => ({
      card,
      kind: "insert",
      index: plan.updates.length + index + 1
    }))
  ];
  const stats = { updated: 0, inserted: 0, skipped: 0 };
  const importBatchId = randomUUID();
  let cursor = 0;
  let fatal;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, work.length) }, async () => {
      try {
        while (!fatal && cursor < work.length) {
          const item = work[cursor++];
          let image;
          try {
            image = await retry(
              () => downloadImage(item.card.image_url, limitedFetch),
              3,
              sleep
            );
          } catch (error) {
            stats.skipped++;
            const entry = {
              record: item.index,
              source: item.card.source,
              source_id: item.card.source_id,
              stage: "image",
              message: error.message
            };
            await onFailure(entry);
            log(`SKIP ${JSON.stringify(entry)}`);
            continue;
          }
          const path = imagePath(item.card);
          await retry(
            () =>
              checked(
                client.storage.from(bucket).upload(path, image.bytes, {
                  contentType: image.contentType,
                  upsert: true,
                  cacheControl: "3600"
                })
              ),
            3,
            sleep
          );
          const imageUrl = client.storage.from(bucket).getPublicUrl(path)
            .data.publicUrl;
          if (item.kind === "update") {
            if (announcements) {
              await retry(
                () =>
                  checked(
                    client.rpc("update_catalogue_card_announced", {
                      p_card_id: item.current.id,
                      p_patch: {
                        rarete_base: item.card.rarete_base,
                        image_url: imageUrl,
                        franchise: item.card.franchise
                      },
                      p_import_id: importBatchId
                    })
                  ),
                3,
                sleep
              );
            } else {
              await retry(
                () =>
                  checked(
                    client
                      .from("cards")
                      .update({
                        rarete_base: item.card.rarete_base,
                        image_url: imageUrl,
                        franchise: item.card.franchise
                      })
                      .eq("id", item.current.id)
                  ),
                3,
                sleep
              );
            }
            stats.updated++;
          } else {
            if (announcements) {
              await retry(
                () =>
                  checked(
                    client.rpc("import_catalogue_cards_announced", {
                      p_rows: [{ ...item.card, image_url: imageUrl }],
                      p_import_id: importBatchId
                    })
                  ),
                3,
                sleep
              );
            } else {
              await retry(
                () =>
                  checked(
                    client
                      .from("cards")
                      .insert({ ...item.card, image_url: imageUrl })
                  ),
                3,
                sleep
              );
            }
            stats.inserted++;
          }
        }
      } catch (error) {
        fatal ??= error;
      }
    })
  );
  if (announcements) {
    try {
      await retry(
        () =>
          checked(
            client.rpc("finish_catalogue_discord_import", {
              p_import_id: importBatchId
            })
          ),
        3,
        sleep
      );
    } catch (error) {
      if (!fatal) throw error;
      log("Discord import summary deferred to scheduled recovery.");
    }
  }
  if (fatal) throw fatal;
  return stats;
}

export async function prepareStorage(client, bucket) {
  // Fail before downloading or creating a bucket if step 1 is missing.
  await retry(() =>
    checked(
      client
        .from("cards")
        .select(
          "id,source_id,nom,categorie,franchise,franchise_romaji,rarete_base,image_url,favoris_count,description,source,date_ajout"
        )
        .limit(0)
    )
  );
  const buckets = await retry(() => checked(client.storage.listBuckets()));
  const existing = buckets.find(({ id }) => id === bucket);
  if (existing) {
    if (!existing.public)
      throw new Error(`Le bucket ${bucket} existe mais n'est pas public.`);
    return;
  }
  await retry(() =>
    checked(
      client.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: MAX_IMAGE_BYTES,
        allowedMimeTypes: MIME_TYPES
      })
    )
  );
}

export async function importCards({
  rows,
  client,
  bucket = "card-images",
  batchSize = 100,
  concurrency = 5,
  limit = Infinity,
  dryRun = false,
  stableBinders = false,
  announcements = false,
  fetchImage = publicImageFetch,
  log = console.log,
  onFailure = async () => {},
  onWritten = async () => {},
  sleep = delay
}) {
  const stats = {
    read: 0,
    imported: 0,
    valid: 0,
    skipped: 0,
    duplicates: 0,
    batches: 0
  };
  const limitedFetch = createImageRequestLimiter(fetchImage, { sleep });
  const started = Date.now();
  const importBatchId = randomUUID();
  let batch = [];
  async function skip(row, index, stage, error) {
    stats.skipped++;
    // Log only identifiers and the error, never keys or signed image URLs.
    const entry = {
      record: index,
      source: row.source,
      source_id: row.source_id,
      stage,
      message: error.message
    };
    await onFailure(entry);
    log(`SKIP ${JSON.stringify(entry)}`);
  }
  async function flush() {
    const ready = [];
    const validEntries = [];
    for (const { row, index } of batch) {
      try {
        validEntries.push({ row, index, card: validateCard(row) });
      } catch (error) {
        await skip(row, index, "validation", error);
      }
    }
    // Validate before deduplicating so an invalid duplicate (for example a row
    // without an image) cannot replace an otherwise importable card.
    let work = [
      ...new Map(
        validEntries.map(entry => [
          JSON.stringify([entry.card.source, entry.card.source_id]),
          entry
        ])
      ).values()
    ];
    stats.duplicates += validEntries.length - work.length;
    stats.valid += work.length;
    if (stableBinders && !dryRun) {
      const ids = work
        .filter(entry => isAnilistAnime(entry.card))
        .map(entry => entry.card.source_id);
      if (ids.length) {
        const existing = await retry(
          () =>
            checked(
              client
                .from("cards")
                .select("source_id")
                .eq("source", "anilist")
                .in("source_id", ids)
            ),
          3,
          sleep
        );
        const known = new Set(existing.map(card => card.source_id));
        const before = work.length;
        work = work.filter(
          entry =>
            !isAnilistAnime(entry.card) || !known.has(entry.card.source_id)
        );
        stats.duplicates += before - work.length;
      }
    }
    let cursor = 0;
    let fatal;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, work.length) }, async () => {
        try {
          while (!fatal && cursor < work.length) {
            const { row, index, card } = work[cursor++];
            if (dryRun) continue;
            let image;
            try {
              image = await retry(
                () => downloadImage(card.image_url, limitedFetch),
                3,
                sleep
              );
            } catch (error) {
              await skip(row, index, "image", error);
              continue;
            }
            const protectedImport = stableBinders && isAnilistAnime(card);
            const path = protectedImport
              ? immutableAnilistImagePath(imagePath(card), image.bytes)
              : imagePath(card);
            // Storage or DB failures stop the run: configuration/quota errors must
            // not silently skip an entire catalogue. A rerun safely reuses paths.
            await retry(
              async () => {
                const result = await client.storage
                  .from(bucket)
                  .upload(path, image.bytes, {
                    contentType: image.contentType,
                    upsert: !protectedImport,
                    cacheControl: "3600"
                  });
                // A content-addressed immutable path may already exist after a
                // previous interrupted run. Never overwrite it or another card.
                if (
                  protectedImport &&
                  String(result.error?.statusCode) === "409"
                )
                  return;
                return checked(Promise.resolve(result));
              },
              3,
              sleep
            );
            card.image_url = client.storage
              .from(bucket)
              .getPublicUrl(path).data.publicUrl;
            ready.push({ card, index, importInput: row });
          }
        } catch (error) {
          fatal ??= error;
        }
      })
    );
    // Wait for in-flight workers before failing; no background mutations after return.
    if (fatal) throw fatal;
    if (ready.length) {
      ready.sort((a, b) => a.index - b.index);
      const anilist = stableBinders
        ? ready.filter(entry => isAnilistAnime(entry.card))
        : [];
      const ordinary = ready.filter(entry => !anilist.includes(entry));
      const written = [];
      if (anilist.length) {
        for (let offset = 0; offset < anilist.length; offset += 200) {
          const batch = anilist.slice(offset, offset + 200);
          const result = await retry(
            () =>
              checked(
                client.rpc(
                  announcements
                    ? "import_catalogue_cards_announced"
                    : "import_anilist_cards",
                  {
                    p_rows: batch.map(({ card, importInput }) =>
                      anilistImportRow(card, importInput)
                    ),
                    ...(announcements
                      ? { p_import_id: importBatchId, p_anilist: true }
                      : { p_batch_id: importBatchId })
                  }
                )
              ),
            3,
            sleep
          );
          const inserted = new Set(
            result
              .filter(row => row.status !== "EXISTING_UNCHANGED")
              .map(row => row.source_id)
          );
          written.push(
            ...batch
              .filter(row => inserted.has(row.card.source_id))
              .map(row => row.index)
          );
        }
      }
      if (ordinary.length) {
        if (announcements) {
          for (let offset = 0; offset < ordinary.length; offset += 200) {
            await retry(
              () =>
                checked(
                  client.rpc("import_catalogue_cards_announced", {
                    p_rows: ordinary
                      .slice(offset, offset + 200)
                      .map(({ card }) => card),
                    p_import_id: importBatchId
                  })
                ),
              3,
              sleep
            );
          }
        } else {
          await retry(
            () =>
              checked(
                client.from("cards").upsert(
                  ordinary.map(({ card }) => card),
                  {
                    onConflict: "source,source_id",
                    defaultToNull: false
                  }
                )
              ),
            3,
            sleep
          );
        }
        written.push(...ordinary.map(row => row.index));
      }
      stats.imported += written.length;
      // Record numbers (1-based) of the rows actually upserted.
      await onWritten(written.sort((a, b) => a - b));
    }
    stats.batches++;
    log(
      `Lot ${stats.batches} | lues=${stats.read} | valides=${stats.valid} | écrites=${stats.imported} | ignorées=${stats.skipped} | doublons=${stats.duplicates} | ${Math.round((Date.now() - started) / 1000)}s`
    );
    batch = [];
  }
  let importError;
  try {
    for await (const row of rows) {
      if (stats.read >= limit) break;
      batch.push({ row, index: ++stats.read });
      if (batch.length >= batchSize) await flush();
    }
    if (batch.length) await flush();
    return stats;
  } catch (error) {
    importError = error;
    throw error;
  } finally {
    if (announcements && !dryRun) {
      try {
        await retry(
          () =>
            checked(
              client.rpc("finish_catalogue_discord_import", {
                p_import_id: importBatchId
              })
            ),
          3,
          sleep
        );
      } catch (error) {
        if (!importError) throw error;
        log("Discord import summary deferred to scheduled recovery.");
      }
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      csv: { type: "string", default: "data/characters_clean.csv" },
      bucket: { type: "string", default: "card-images" },
      "batch-size": { type: "string", default: "100" },
      concurrency: { type: "string", default: "5" },
      limit: { type: "string" },
      "error-log": {
        type: "string",
        default: "logs/import-cards-errors.jsonl"
      },
      "dry-run": { type: "boolean", default: false },
      "match-name-category": { type: "boolean", default: false },
      help: { type: "boolean", default: false }
    }
  });
  if (values.help) {
    console.log(
      "npm run import:cards -- [--csv data/characters_clean.csv] [--dry-run] [--match-name-category] [--limit 10] [--batch-size 100] [--concurrency 5] [--bucket card-images] [--error-log logs/import-cards-errors.jsonl]"
    );
    return;
  }
  const positive = (name, max) => {
    const value = Number(values[name]);
    if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
      throw new Error(`--${name} doit être un entier entre 1 et ${max}.`);
    }
    return value;
  };
  const batchSize = positive("batch-size", 1000);
  const concurrency = positive("concurrency", 20);
  const limit = values.limit
    ? positive("limit", Number.MAX_SAFE_INTEGER)
    : Infinity;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(values.bucket))
    throw new Error("Nom de bucket invalide.");
  let client;
  if (!values["dry-run"] || values["match-name-category"]) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      throw new Error(
        "Renseigner NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY) dans .env.local. La clé publique ne permet pas l'import."
      );
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(60000) })
      }
    });
    if (!values["dry-run"]) await prepareStorage(client, values.bucket);
  }
  const errorLog = resolve(values["error-log"]);
  if (errorLog === resolve(values.csv))
    throw new Error("Le journal ne peut pas remplacer le CSV.");
  await mkdir(dirname(errorLog), { recursive: true });
  // Serialize concurrent failures to keep JSONL entries intact.
  let writes = Promise.resolve();
  const onFailure = entry => {
    writes = writes.then(() =>
      appendFile(
        errorLog,
        JSON.stringify({ date: new Date().toISOString(), ...entry }) + "\n",
        "utf8"
      )
    );
    return writes;
  };
  console.log(
    values["dry-run"]
      ? values["match-name-category"]
        ? "Dry-run distant en lecture seule."
        : "Validation locale du CSV (aucun accès réseau)."
      : `Import vers ${values.bucket}, lots de ${batchSize}, concurrence ${concurrency}.`
  );
  if (values["match-name-category"]) {
    const plan = await compareNameCategoryImport({
      rows: readCards(values.csv),
      client
    });
    if (
      [...plan.inserts, ...plan.updates.map(item => item.card)].some(
        isAnilistAnime
      )
    ) {
      throw new Error(
        "AniList imports require source identities. Run without --match-name-category; existing cards remain unchanged."
      );
    }
    console.log(
      `Comparaison (nom, categorie) : total=${plan.total} | mises_a_jour=${plan.updates.length} | insertions=${plan.inserts.length} | raretes_modifiees=${plan.changedRarities} | exemplaires_evolues_concernes=${plan.evolvedCopies}`
    );
    if (values["dry-run"]) return;
    const matchStats = await applyNameCategoryImport({
      plan,
      client,
      bucket: values.bucket,
      concurrency,
      announcements: true,
      onFailure
    });
    console.log(`TerminÃ© : ${JSON.stringify(matchStats)}`);
    if (matchStats.skipped) process.exitCode = 2;
    return;
  }
  const stats = await importCards({
    rows: readCards(values.csv),
    client,
    bucket: values.bucket,
    batchSize,
    concurrency,
    limit,
    dryRun: values["dry-run"],
    stableBinders: true,
    announcements: true,
    onFailure
  });
  console.log(`Terminé : ${JSON.stringify(stats)}`);
  if (stats.skipped) process.exitCode = 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(error => {
    // Do not dump request objects or credentials on errors.
    const secrets = [
      process.env.SUPABASE_SECRET_KEY,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ].filter(Boolean);
    let message = error.message;
    for (const secret of secrets)
      message = message.replaceAll(secret, "[REDACTED]");
    console.error(`Import arrêté : ${message}`);
    process.exitCode = 1;
  });
}
