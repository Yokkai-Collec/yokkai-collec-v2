import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

// Loads the client's own TypeScript helpers so SQL is compared with the code
// the collection screen runs, not with a re-implementation.
const modules = new Map();
function load(specifier) {
  const file = specifier.replace(/^@\//, "") + ".ts";
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    { exports, require: load, Date, Number, Map, Set, Math }
  );
  return exports;
}
const { filterCollection } = load("@/lib/ui/collection-filter");
const { groupCollection } = load("@/lib/ui/collection-groups");

test("duplicates use the whole collection and keep variants separate", () => {
  const base = {
    id: "a",
    name: "a",
    rarity: "C",
    category: "Anime",
    obtainedAt: "2026-01-01",
    shiny: false
  };
  const cards = [
    { ...base, instanceId: "1", folderId: "folder" },
    { ...base, instanceId: "2", locked: true },
    { ...base, instanceId: "3", shiny: true },
    { ...base, instanceId: "4", isEvolved: true },
    { ...base, id: "b", instanceId: "5" }
  ];
  const filters = {
    query: "",
    category: [],
    rarity: [],
    shinyOnly: false,
    folder: "",
    auctionOnly: false,
    lockedOnly: false,
    sort: "rarity",
    duplicatesOnly: true
  };
  const ids = extra =>
    Array.from(
      filterCollection(cards, { ...filters, ...extra }, () => false),
      card => card.instanceId
    );
  assert.deepEqual(ids({}), ["1", "2"]);
  assert.deepEqual(ids({ folder: "folder" }), ["1"]);
  assert.deepEqual(ids({ lockedOnly: true }), ["2"]);
  assert.deepEqual(ids({ shinyOnly: true }), []);
  assert.equal(ids({ duplicatesOnly: false }).length, 5);
});

// PGlite has no ICU: names stay plain lowercase ASCII here, so both orders
// agree. tests/postgres17-collection-order.mjs checks ICU names (case,
// accents, numbers) on the production PostgreSQL image.
test("collection pages match the client's filters, order, grouping and counters", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const uuid = (prefix, n) =>
    `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [player, other] = [uuid("38800000", 1), uuid("38800000", 2)];
  for (const [id, pseudo] of [
    [player, "PagePlayer"],
    [other, "PageOther"]
  ])
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  const folders = [uuid("38810000", 1), uuid("38810000", 2)];
  for (const [i, id] of folders.entries())
    await db.query(
      "insert into public.folders(id,user_id,nom) values($1,$2,$3)",
      [id, player, `Folder ${i}`]
    );
  const names = [
    "amber",
    "aster",
    "birch",
    "blaze",
    "cedar",
    "cobalt",
    "dune",
    "ember",
    "fable",
    "frost",
    "glade",
    "harbor",
    "iris",
    "jade",
    "kelp",
    "lumen",
    "maple",
    "nectar",
    "onyx",
    "pearl",
    "quartz",
    "raven",
    "sable",
    "tide"
  ];
  const rarities = ["C", "R", "SR", "SSR", "LR"];
  const categories = ["Anime", "Games", "Comics"];
  const cards = [];
  for (const [i, name] of names.entries()) {
    const id = uuid("38820000", i + 1);
    cards.push(id);
    await db.query(
      "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$2,$3,$4,$5,$6,$7,'test')",
      [
        id,
        `page-${i}`,
        // Two cards share a name: rarity and instance id must break the tie.
        i === 23 ? "amber" : name,
        categories[i % 3],
        i % 4 === 0 ? null : i % 4 === 1 ? "" : `saga ${i % 5}`,
        rarities[i % 5],
        `https://example.test/${i}.png`
      ]
    );
  }
  // 260 copies: duplicates, shiny/evolved variants, equal timestamps, folders,
  // locks, custom images and auctions.
  const base = Date.parse("2026-10-01T00:00:00Z");
  let n = 0;
  for (let i = 0; i < 260; i++) {
    const index = (i * 7) % cards.length;
    const card = cards[index];
    // Shiny exists for SSR/LR only; evolved is shiny SSR or plain LR.
    const rarity = rarities[index % 5];
    const shiny = (rarity === "SSR" || rarity === "LR") && i % 3 === 0;
    const evolved =
      (rarity === "LR" && !shiny && i % 4 === 0) ||
      (rarity === "SSR" && shiny && i % 2 === 0);
    // Same millisecond, different microseconds: equal for Date.parse().
    const at = new Date(base + Math.floor(i / 3) * 60000)
      .toISOString()
      .replace("Z", i % 3 === 2 ? "400Z" : "Z");
    await db.query(
      "insert into public.user_cards(id,user_id,card_id,rarity,date_obtention,is_shiny,is_evolved,folder_id,is_locked,custom_image_url,is_first_owner) values($1,$2,$3,(select rarete_base from public.cards where id=$3),$4,$5,$6,$7,$8,$9,$10)",
      [
        uuid("38830000", ++n),
        player,
        card,
        at,
        shiny,
        evolved,
        i % 5 === 0 ? folders[0] : i % 7 === 0 ? folders[1] : null,
        i % 9 === 0,
        i % 17 === 0 ? `https://i.imgur.com/custom${i}.png` : null,
        i % 4 === 0
      ]
    );
  }
  await db.query(
    "insert into public.user_cards(id,user_id,card_id,rarity,date_obtention) values($1,$2,$3,'C',now())",
    [uuid("38830000", 999), other, cards[0]]
  );
  const frozen = [
    uuid("38830000", 3),
    uuid("38830000", 40),
    uuid("38830000", 41)
  ];
  for (const id of frozen)
    await db.query(
      "insert into public.auctions(card_instance_id,seller_id,starting_price,current_price,duration_minutes,ends_at) values($1,$2,10,10,15,now()+interval '1 hour')",
      [id, player]
    );

  // The client's view of the same collection, built like getUserCollection.
  const rows = (
    await db.query(
      `select uc.id,uc.date_obtention,uc.is_shiny,uc.is_evolved,uc.is_first_owner,uc.is_locked,uc.folder_id,uc.custom_image_url,
        c.id card_id,c.nom,c.categorie,c.franchise,c.rarete_base,c.image_url
       from public.user_cards uc join public.cards c on c.id=uc.card_id where uc.user_id=$1`,
      [player]
    )
  ).rows;
  const client = rows.map(row => ({
    id: row.card_id,
    name: row.nom,
    category: row.categorie,
    anime: row.franchise || undefined,
    rarity: row.rarete_base,
    image: row.custom_image_url || row.image_url,
    catalogueImage: row.image_url,
    customImageUrl: row.custom_image_url,
    instanceId: row.id,
    obtainedAt: row.date_obtention.toISOString(),
    shiny: row.is_shiny,
    isEvolved: row.is_evolved,
    isFirstOwner: row.is_first_owner,
    locked: row.is_locked,
    folderId: row.folder_id
  }));
  const isFrozen = id => frozen.includes(id);

  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  const page = async args =>
    (
      await db.query(
        "select public.get_collection_groups_page(p_query=>$1,p_categories=>$2,p_rarities=>$3,p_shiny_only=>$4,p_folder=>$5,p_auction_only=>$6,p_locked_only=>$7,p_sort=>$8,p_after=>$9,p_offset=>$10,p_limit=>$11,p_duplicates_only=>$12) page",
        [
          args.query,
          args.category.length ? args.category : null,
          args.rarity.length ? args.rarity : null,
          args.shinyOnly,
          args.folder || null,
          args.auctionOnly,
          args.lockedOnly,
          args.sort,
          args.after ?? null,
          args.offset ?? 0,
          args.limit ?? 24,
          args.duplicatesOnly ?? false
        ]
      )
    ).rows[0].page;
  const empty = {
    query: "",
    category: [],
    rarity: [],
    shinyOnly: false,
    folder: "",
    auctionOnly: false,
    lockedOnly: false
  };
  const filters = [
    {},
    { query: "a" },
    { query: "SAGA 2" },
    { query: "(ber), x" },
    { category: ["Games"] },
    { rarity: ["SSR", "LR"] },
    { shinyOnly: true },
    { folder: folders[0] },
    { folder: "unfiled" },
    { auctionOnly: true },
    { lockedOnly: true },
    { duplicatesOnly: true },
    { duplicatesOnly: true, folder: folders[0] },
    { duplicatesOnly: true, lockedOnly: true },
    { duplicatesOnly: true, shinyOnly: true },
    { query: "e", rarity: ["C", "R"], folder: "unfiled" }
  ];
  for (const sort of ["rarity", "recent", "oldest", "name"])
    for (const extra of filters) {
      const args = { ...empty, ...extra, sort };
      // Plain arrays: values built in the vm realm have another Array prototype.
      const expected = JSON.parse(
        JSON.stringify(
          groupCollection(filterCollection(client, args, isFrozen)).map(
            group => [group.key, group.cards.map(card => card.instanceId)]
          )
        )
      );
      // Next pages through the cursor.
      const seen = [];
      let after;
      for (let guard = 0; guard < 50; guard++) {
        const result = await page({ ...args, after, limit: 7 });
        assert.equal(
          result.total,
          expected.length,
          `${sort} ${JSON.stringify(extra)}`
        );
        seen.push(...result.groups);
        if (!result.next) break;
        after = result.next;
      }
      const label = `${sort} ${JSON.stringify(extra)}`;
      assert.deepEqual(
        seen.map(group => [
          group.key,
          group.copies.map(copy => copy.instanceId)
        ]),
        expected,
        label
      );
      // A direct jump to page 3 equals the third slice.
      const jump = await page({ ...args, offset: 14, limit: 7 });
      assert.deepEqual(
        jump.groups.map(group => group.key),
        expected.slice(14, 21).map(([key]) => key),
        `jump ${label}`
      );
    }

  // The first-owner badge reads the whole group, even when filters hide copies.
  const history = new Map(
    groupCollection(client).map(group => [group.key, group.isFirstOwner])
  );
  for (const extra of [{}, { folder: "unfiled" }])
    for (const group of (
      await page({ ...empty, ...extra, sort: "rarity", limit: 60 })
    ).groups)
      assert.equal(group.firstOwner, history.get(group.key), group.key);
  assert.ok(
    [...history.values()].some(Boolean),
    "fixture has a first-owner LR group"
  );

  // Copies carry what the grid and detail need, as the client built them.
  const one = (await page({ ...empty, sort: "recent", limit: 60 })).groups
    .flatMap(group => group.copies)
    .find(copy => copy.instanceId === frozen[0]);
  const reference = client.find(card => card.instanceId === frozen[0]);
  assert.equal(one.frozen, true);
  for (const key of [
    "id",
    "name",
    "category",
    "rarity",
    "image",
    "catalogueImage",
    "customImageUrl",
    "shiny",
    "isEvolved",
    "isFirstOwner",
    "locked",
    "folderId"
  ])
    assert.deepEqual(one[key], reference[key], key);
  assert.equal(Date.parse(one.obtainedAt), Date.parse(reference.obtainedAt));

  // Counters: distinct groups, exactly as the sidebar computed them.
  const counts = (await db.query("select public.get_collection_counts() c"))
    .rows[0].c;
  const groups = list => groupCollection(list).length;
  assert.equal(counts.copies, client.length);
  assert.equal(counts.groups, groups(client));
  for (const rarity of rarities)
    assert.equal(
      counts.rarities[rarity] ?? 0,
      groups(client.filter(c => c.rarity === rarity)),
      rarity
    );
  for (const category of categories)
    assert.equal(
      counts.categories[category] ?? 0,
      groups(client.filter(c => c.category === category)),
      category
    );
  assert.equal(
    counts.frozen,
    groups(client.filter(c => isFrozen(c.instanceId)))
  );
  assert.equal(counts.locked, groups(client.filter(c => c.locked)));
  assert.equal(counts.unfiled, groups(client.filter(c => !c.folderId)));
  for (const folder of folders)
    assert.equal(
      counts.folders[folder] ?? 0,
      groups(client.filter(c => c.folderId === folder)),
      folder
    );

  // Every copy of one group, regardless of filters (detail, evolution).
  for (const group of groupCollection(client).slice(0, 10))
    assert.deepEqual(
      (
        await db.query("select public.get_collection_group_copies($1) c", [
          group.key
        ])
      ).rows[0].c.map(copy => copy.instanceId),
      [...group.cards.map(card => card.instanceId)],
      group.key
    );

  // Binder view: the first owned copy per card in getUserCollection's order,
  // and copies per license with the client's special categories rule.
  const rank = { C: 0, R: 1, SR: 2, SSR: 3, LR: 4 };
  const ordered = [...client].sort(
    (a, b) =>
      rank[b.rarity] - rank[a.rarity] ||
      Date.parse(b.obtainedAt) - Date.parse(a.obtainedAt) ||
      a.instanceId.localeCompare(b.instanceId)
  );
  const firstOwned = new Map();
  for (const card of ordered)
    if (!firstOwned.has(card.id)) firstOwned.set(card.id, card.instanceId);
  const owned = (
    await db.query("select public.get_collection_owned_copies($1) c", [
      cards.slice(0, 12)
    ])
  ).rows[0].c;
  assert.deepEqual(
    Object.fromEntries(owned.map(copy => [copy.id, copy.instanceId])),
    Object.fromEntries(
      cards
        .slice(0, 12)
        .filter(id => firstOwned.has(id))
        .map(id => [id, firstOwned.get(id)])
    )
  );
  for (const license of ["saga 2", "saga 3", "GAMES", "Comics", "nothing"])
    assert.equal(
      (
        await db.query("select public.get_collection_license_copies($1) n", [
          license
        ])
      ).rows[0].n,
      client.filter(card => card.anime?.trim() === license).length,
      license
    );

  // Own copies only; invalid input refused with stable codes.
  const all = await page({ ...empty, sort: "rarity", limit: 60 });
  assert.ok(!JSON.stringify(all).includes(uuid("38830000", 999)));
  await assert.rejects(
    page({ ...empty, sort: "random" }),
    /COLLECTION_PAGE_INVALID/
  );
  await assert.rejects(
    db.query("select public.get_collection_group_copies('x')"),
    /COLLECTION_PAGE_INVALID/
  );
  await db.exec("reset role; set role anon");
  await assert.rejects(page({ ...empty, sort: "rarity" }), /permission denied/);
});
