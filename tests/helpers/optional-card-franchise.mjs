import { licenseName } from "./license-name.mjs";
import { intl } from "./i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as importer from "../../scripts/import-cards.mjs";
import { replayMigrations } from "../../scripts/replay-migrations.mjs";
import { cardRarityLabels } from "./card-rarity-labels.mjs";

const require = createRequire(import.meta.url);
export function load(path, imports = {}) {
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    }
  }).outputText;
  const context = {
    exports: {},
    FormData,
    File,
    Buffer,
    process,
    URL,
    fetch,
    AbortSignal,
    Response,
    Uint8Array,
    require: name => {
      if (name === "@/lib/ui/license-name") return licenseName;
      if (name === "next-intl") return intl;
      if (name in imports) return imports[name];
      if (name === "@/lib/ui/card-rarity-label") return cardRarityLabels;
      if (name === "@/components/invocation-card-back")
        return { useInvocationCardBack: () => null };
      if (name === "@/components/card-showcase-effect")
        return { CardShowcaseEffect: () => null };
      if (name === "@/lib/ui/card-cosmetics")
        return load("lib/ui/card-cosmetics.ts");
      if (name === "@/lib/ui/booster-opening-document") return {};
      if (name.startsWith("react") || name.startsWith("node:"))
        return require(name);
      if (name.endsWith(".css") || name === "server-only") return {};
      throw new Error(`Unexpected import: ${name}`);
    }
  };
  vm.runInNewContext(source, context);
  return context.exports;
}
export const row = {
  source_id: "optional-license",
  nom: "No License Hero",
  categorie: "ARTIST",
  franchise: "",
  franchise_romaji: "",
  rarete_base: "C",
  image_url: "https://example.test/card.png",
  source: "manual",
  favoris_count: ""
};

export async function assertAdminEmptyLicense(
  t,
  secondaryLicenses = [],
  category = "ARTIST"
) {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const admin = "10000000-0000-4000-8000-000000000001";
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values ($1,$2)",
    [admin, { pseudo: "OptionalTester" }]
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin
  ]);
  let cardId;
  let unavailable = false;
  const client = {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: row.image_url } })
      })
    },
    from(table) {
      let payload, operation, id, fields;
      const request = {
        upsert(data) {
          payload = data;
          operation = "write";
          return request;
        },
        update(data) {
          payload = data;
          operation = "update";
          return request;
        },
        select(value) {
          fields = value;
          return request;
        },
        delete() {
          operation = "delete";
          return request;
        },
        eq(_key, value) {
          id = value;
          return request;
        },
        async insert(data) {
          if (table === "card_categories")
            await db.query(
              "insert into public.card_categories(card_id,categorie) values ($1,$2)",
              [data.card_id, data.categorie]
            );
          else if (table === "card_franchises")
            await db.query(
              "insert into public.card_franchises(card_id,franchise,position) values ($1,$2,$3)",
              [data.card_id, data.franchise, data.position]
            );
          return { error: null };
        },
        async single() {
          if (unavailable)
            return {
              error: {
                code: "23502",
                message:
                  'null value in column "franchise" violates not-null constraint'
              }
            };
          if (operation === "write") {
            const columns = Object.keys(payload);
            const result = await db.query(
              `insert into public.cards(${columns.join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
              Object.values(payload)
            );
            cardId = result.rows[0].id;
            return { data: result.rows[0], error: null };
          }
          if (operation === "update")
            await db.query("update public.cards set franchise=$1 where id=$2", [
              payload.franchise,
              id
            ]);
          return {
            data: (
              await db.query("select * from public.cards where id=$1", [id])
            ).rows[0],
            error: null
          };
        },
        async then(resolve) {
          if (operation === "delete")
            await db.query(`delete from public.${table} where card_id=$1`, [
              id
            ]);
          const data = operation
            ? []
            : (
                await db.query(
                  `select ${fields} from public.${table} where card_id=$1`,
                  [id]
                )
              ).rows;
          return resolve({ data, error: null });
        }
      };
      return request;
    }
  };
  const actions = load("app/admin/cards/actions.ts", {
    "csv-parse/sync": {},
    "next/cache": { revalidatePath() {} },
    "next/headers": { cookies: async () => ({}) },
    "@/lib/auth/admin": { requireAdminAction: async () => ({ id: admin }) },
    "@/utils/supabase/server": { createClient: () => client },
    "./bulk-delete": { MAX_BULK_DELETE_CARDS: 100 },
    "@/scripts/import-cards.mjs": {
      ...importer,
      downloadImage: async () => ({
        bytes: Buffer.from("image"),
        contentType: "image/png"
      })
    }
  });
  const form = new FormData();
  for (const [key, value] of Object.entries(row)) form.set(key, value);
  form.set("franchise", "   ");
  form.set("categorie", category);
  for (const license of secondaryLicenses) form.append("franchise", license);
  assert.equal((await actions.createCardAction({}, form)).ok, true);
  assert.equal(
    (await db.query("select franchise from public.cards where id=$1", [cardId]))
      .rows[0].franchise,
    null
  );
  assert.deepEqual(
    (
      await db.query(
        "select franchise from public.card_franchises where card_id=$1 order by position",
        [cardId]
      )
    ).rows,
    secondaryLicenses.map(franchise => ({ franchise }))
  );
  const catalog = (
    await db.query(
      "select public.get_catalogue_cards_page('hero','','',0,24) as result"
    )
  ).rows[0].result;
  assert.equal(catalog.total, 1);
  assert.equal(catalog.items[0].anime, null);
  assert.equal(
    (
      await db.query(
        "select public.get_catalogue_cards_page($1,'','',0,24) as result",
        [secondaryLicenses[0] ?? "Unlisted license"]
      )
    ).rows[0].result.total,
    secondaryLicenses.length ? 1 : 0
  );
  const owned = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,$3) returning id",
      [admin, cardId, "C"]
    )
  ).rows[0].id;
  assert.equal(
    (
      await db.query(
        "select public.achievement_progress($1,'cards_collected_category_percent') as progress",
        [admin]
      )
    ).rows[0].progress,
    100
  );
  const share = (
    await db.query("select public.create_card_share($1,false) as id", [owned])
  ).rows[0].id;
  assert.equal(
    (await db.query("select public.get_shared_card($1) as card", [share]))
      .rows[0].card.franchise,
    null
  );
  await db.query("update public.cards set franchise='Series' where id=$1", [
    cardId
  ]);
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position) values ($1,'Series',9)",
    [cardId]
  );
  form.set("id", cardId);
  form.delete("image_url");
  assert.equal((await actions.updateCardAction({}, form)).ok, true);
  assert.equal(
    (await db.query("select franchise from public.cards where id=$1", [cardId]))
      .rows[0].franchise,
    null
  );
  assert.deepEqual(
    (
      await db.query(
        "select franchise from public.card_franchises where card_id=$1 order by position",
        [cardId]
      )
    ).rows,
    secondaryLicenses.map(franchise => ({ franchise }))
  );
  await db.query("update public.cards set categorie=categorie where id=$1", [
    cardId
  ]);
  assert.deepEqual(
    (
      await db.query(
        "select franchise from public.card_franchises where card_id=$1 order by position",
        [cardId]
      )
    ).rows,
    secondaryLicenses.map(franchise => ({ franchise }))
  );
  for (const license of secondaryLicenses) {
    const album = (
      await db.query("select public.get_panini_album_cards_page($1) as album", [
        license
      ])
    ).rows[0].album;
    assert.equal(album.total, 1);
    assert.equal(album.items[0].id, cardId);
    assert.equal(album.items[0].anime, null);
  }
  unavailable = true;
  assert.match(
    (await actions.updateCardAction({}, form)).message,
    /pending database migration/
  );
  form.set("image_url", row.image_url);
  assert.match(
    (await actions.createCardAction({}, form)).message,
    /pending database migration/
  );
}
