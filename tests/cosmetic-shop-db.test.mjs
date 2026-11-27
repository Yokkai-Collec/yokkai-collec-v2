import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("cosmetics charge once per order, reserve one copy per card, and release copies on transfer", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const user = randomUUID();
  const other = randomUUID();
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,jsonb_build_object('pseudo','ShopBuyer')),($2,jsonb_build_object('pseudo','ShopOther'))",
    [user, other]
  );
  await db.query(
    "update public.user_profiles set karas_balance=3850 where user_id=$1",
    [user]
  );
  const type = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source) values('test-shop','Shop Card','ANIME/MANGA','LR','https://example.test/card.png','test') returning id"
    )
  ).rows[0].id;
  const card = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'SSR') returning id",
      [user, type]
    )
  ).rows[0].id;
  const ssrType = (
    await db.query(
      "insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source) values('test-shop-ssr','SSR Card','ANIME/MANGA','SSR','https://example.test/ssr.png','test') returning id"
    )
  ).rows[0].id;
  const ssrCard = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'LR') returning id",
      [user, ssrType]
    )
  ).rows[0].id;
  const call = async (player, sql, bindings = []) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      player
    ]);
    await db.exec("set role authenticated");
    try {
      return (await db.query(sql, bindings)).rows[0]?.result;
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const shop = player =>
    call(player, "select public.get_card_cosmetic_shop() result");
  const buy = (id, price, quantity = 1, request = randomUUID(), buyer = user) =>
    call(buyer, "select public.buy_card_cosmetic($1,$2,$3,$4) result", [
      id,
      price,
      quantity,
      request
    ]);
  const equip = (player, kind, id, copy = card) =>
    call(player, "select public.set_card_cosmetic($1,$2,$3)", [copy, kind, id]);
  const inventory = player =>
    call(player, "select public.get_my_card_cosmetics() result");
  const chooseBack = (player, id) =>
    call(player, "select public.set_my_invocation_card_back($1) result", [id]);
  const selectedBack = player =>
    call(player, "select cosmetic_id result from public.invocation_card_backs");

  const initial = await shop(user);
  assert.equal(initial.invocationBack, null);
  assert.equal(initial.items.length, 34);
  assert.deepEqual(
    initial.items.find(item => item.id === "frame_halo"),
    {
      id: "frame_halo",
      kind: "animation",
      price: 900,
      quantity: 0,
      available: 0
    }
  );
  assert.ok(!initial.items.some(item => item.id === "prism_sweep"));
  await assert.rejects(buy("prism_sweep", 450), /COSMETIC_UNAVAILABLE/);
  await assert.rejects(buy("ember_aura", 900), /COSMETIC_UNAVAILABLE/);
  await assert.rejects(buy("showcase_lightning", 900), /COSMETIC_UNAVAILABLE/);
  await assert.rejects(buy("showcase_feathers", 900), /COSMETIC_UNAVAILABLE/);
  await assert.rejects(buy("showcase_velvet", 900), /COSMETIC_UNAVAILABLE/);
  await assert.rejects(buy("showcase_mist", 900), /COSMETIC_UNAVAILABLE/);
  assert.deepEqual(
    initial.items.filter(item => item.id.startsWith("showcase_")),
    ["cyber", "embers", "frost", "sakura", "vhs"].map(scene => ({
      id: `showcase_${scene}`,
      kind: "animation",
      price: 900,
      quantity: 0,
      available: 0
    }))
  );
  assert.deepEqual(
    initial.items
      .filter(item => item.id.startsWith("infinity_reflection_"))
      .map(({ id, kind, price }) => [id, kind, price]),
    ["blue", "gold", "original", "red", "violet"].flatMap(color =>
      ["", "_ssr"].map(suffix => [
        `infinity_reflection_${color}${suffix}`,
        "animation",
        900
      ])
    )
  );
  assert.deepEqual(
    initial.items.find(item => item.id === "infinity_lightning"),
    {
      id: "infinity_lightning",
      kind: "animation",
      price: 900,
      quantity: 0,
      available: 0
    }
  );
  assert.deepEqual(
    initial.items.filter(item =>
      ["violet_mist", "midnight_sakura"].includes(item.id)
    ),
    [
      {
        id: "violet_mist",
        kind: "back",
        price: 650,
        quantity: 0,
        available: 0
      },
      {
        id: "midnight_sakura",
        kind: "back",
        price: 1200,
        quantity: 0,
        available: 0
      }
    ]
  );
  assert.ok(initial.items.every(item => item.quantity === 0));
  await assert.rejects(
    buy("showcase_cyber", 900, 0),
    /INVALID_COSMETIC_QUANTITY/
  );
  await assert.rejects(
    buy("showcase_cyber", 900, 2147483647),
    /INSUFFICIENT_KARAS/
  );
  await assert.rejects(buy("velvet_shadow", 350), /COSMETIC_UNAVAILABLE/);
  await assert.rejects(buy("showcase_cyber", 1), /COSMETIC_PRICE_CHANGED/);
  await assert.rejects(
    equip(user, "animation", "showcase_cyber"),
    /COSMETIC_NOT_OWNED/
  );
  assert.equal((await shop(user)).balance, 3850);

  const order = randomUUID();
  const bought = await buy("showcase_cyber", 900, 2, order);
  assert.equal(bought.balance, 2050);
  assert.equal(
    bought.items.find(item => item.id === "showcase_cyber").quantity,
    2
  );
  assert.deepEqual(await buy("showcase_cyber", 900, 2, order), bought);
  await assert.rejects(
    buy("showcase_cyber", 900, 1, order),
    /COSMETIC_REQUEST_MISMATCH/
  );
  const another = await buy("showcase_cyber", 900);
  assert.equal(another.balance, 1150);
  assert.equal(
    another.items.find(item => item.id === "showcase_cyber").quantity,
    3
  );
  await buy("silver_screen", 250);
  await buy("obsidian_seal", 650);
  assert.equal((await shop(user)).balance, 250);
  await assert.rejects(buy("astral_atlas", 1200), /INSUFFICIENT_KARAS/);
  assert.deepEqual(
    (
      await db.query(
        "select price_paid from public.card_cosmetic_purchases where user_id=$1 order by price_paid",
        [user]
      )
    ).rows.map(row => Number(row.price_paid)),
    [250, 650, 2700]
  );

  await assert.rejects(
    equip(other, "animation", "showcase_cyber"),
    /CARD_NOT_OWNED/
  );
  await assert.rejects(
    equip(user, "back", "obsidian_seal"),
    /INVALID_COSMETIC_KIND/
  );
  await assert.rejects(
    chooseBack(other, "obsidian_seal"),
    /COSMETIC_NOT_OWNED/
  );
  await assert.rejects(
    chooseBack(user, "showcase_cyber"),
    /COSMETIC_NOT_OWNED/
  );
  await assert.rejects(buy("obsidian_seal", 650), /COSMETIC_ALREADY_OWNED/);
  await assert.rejects(
    buy("astral_atlas", 1200, 2),
    /INVALID_COSMETIC_QUANTITY/
  );
  await assert.rejects(
    equip(user, "filter", "obsidian_seal"),
    /COSMETIC_NOT_OWNED/
  );
  await equip(user, "animation", "showcase_cyber");
  await assert.rejects(
    equip(user, "filter", "silver_screen"),
    /COSMETIC_CARD_INELIGIBLE/
  );
  await equip(user, "filter", "silver_screen", ssrCard);
  assert.equal(
    (await chooseBack(user, "obsidian_seal")).invocationBack,
    "obsidian_seal"
  );
  assert.equal(await selectedBack(user), "obsidian_seal");
  assert.equal(await selectedBack(other), undefined);
  const moreCards = (
    await db.query(
      "insert into public.user_cards(user_id,card_id,rarity) select $1,$2,'LR' from generate_series(1,3) returning id",
      [user, type]
    )
  ).rows.map(row => row.id);
  await equip(user, "animation", "showcase_cyber", moreCards[0]);
  await equip(user, "animation", "showcase_cyber", moreCards[1]);
  await equip(user, "animation", "showcase_cyber", moreCards[1]);
  await assert.rejects(
    equip(user, "animation", "showcase_cyber", moreCards[2]),
    /COSMETIC_COPIES_EXHAUSTED/
  );
  assert.deepEqual((await inventory(user)).copies.showcase_cyber, {
    quantity: 3,
    available: 0
  });
  await equip(user, "animation", null, moreCards[0]);
  await equip(user, "animation", "showcase_cyber", moreCards[2]);
  await equip(user, "animation", null, moreCards[1]);
  await equip(user, "animation", null, moreCards[2]);
  await equip(user, "animation", "showcase_cyber", ssrCard);
  assert.deepEqual((await inventory(user)).equipped[ssrCard], {
    animation: "showcase_cyber",
    filter: "silver_screen"
  });
  await equip(user, "filter", null, ssrCard);
  assert.deepEqual((await inventory(user)).equipped[ssrCard], {
    animation: "showcase_cyber"
  });
  await equip(user, "animation", null, ssrCard);

  await db.query("update public.user_cards set user_id=$1 where id=$2", [
    other,
    card
  ]);
  assert.deepEqual((await inventory(user)).equipped, {});
  assert.deepEqual((await inventory(other)).equipped, {});
  assert.equal((await shop(user)).invocationBack, "obsidian_seal");
  assert.deepEqual((await inventory(user)).copies, {
    obsidian_seal: { quantity: 1, available: 1 },
    showcase_cyber: { quantity: 3, available: 3 },
    silver_screen: { quantity: 1, available: 1 }
  });

  await db.query(
    "update public.user_profiles set karas_balance=4550 where user_id=$1",
    [other]
  );
  for (const [id, price] of [
    ["violet_mist", 650],
    ["midnight_sakura", 1200]
  ]) {
    const purchased = await buy(id, price, 1, randomUUID(), other);
    assert.equal(purchased.items.find(item => item.id === id).quantity, 1);
    assert.equal((await chooseBack(other, id)).invocationBack, id);
    assert.equal(await selectedBack(other), id);
  }
  await assert.rejects(
    equip(other, "animation", "infinity_lightning"),
    /COSMETIC_NOT_OWNED/
  );
  const lightning = await buy(
    "infinity_lightning",
    900,
    3,
    randomUUID(),
    other
  );
  assert.equal(lightning.balance, 0);
  assert.equal(
    lightning.items.find(item => item.id === "infinity_lightning").quantity,
    3
  );
  await assert.rejects(
    equip(other, "animation", "infinity_lightning"),
    /COSMETIC_CARD_INELIGIBLE/
  );
  assert.deepEqual((await inventory(other)).equipped[card], undefined);
  assert.equal((await chooseBack(other, null)).invocationBack, null);
  assert.equal(await selectedBack(other), undefined);
  assert.equal(await selectedBack(user), "obsidian_seal");
  await db.query(
    "update public.user_profiles set karas_balance=900 where user_id=$1",
    [other]
  );
  await buy("infinity_lightning_ssr", 900, 1, randomUUID(), other);

  const copiesByName = {};
  for (const { name, rarity, shiny, evolved, edition, eligible } of [
    { name: "common", rarity: "C" },
    { name: "normal-ssr", rarity: "SSR" },
    { name: "shiny", rarity: "LR", shiny: true },
    { name: "infinity-lr", rarity: "LR", evolved: true, eligible: true },
    {
      name: "infinity-ssr",
      rarity: "SSR",
      shiny: true,
      evolved: true,
      eligible: true
    },
    { name: "edition", rarity: "LR", edition: true }
  ]) {
    const catalogueId = (
      await db.query(
        "insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source,event_only) values($1,$1,'ANIME/MANGA',$2,'https://example.test/card.png','test',$3) returning id",
        [name, rarity, Boolean(edition)]
      )
    ).rows[0].id;
    const copy = (
      await db.query(
        "insert into public.user_cards(user_id,card_id,rarity,is_shiny,is_evolved) values($1,$2,$3,$4,$5) returning id",
        [other, catalogueId, rarity, Boolean(shiny), Boolean(evolved)]
      )
    ).rows[0].id;
    copiesByName[name] = copy;
    if (eligible) {
      const id =
        rarity === "SSR" ? "infinity_lightning_ssr" : "infinity_lightning";
      const wrongRarity =
        rarity === "SSR" ? "infinity_lightning" : "infinity_lightning_ssr";
      await assert.rejects(
        equip(other, "animation", wrongRarity, copy),
        /COSMETIC_CARD_INELIGIBLE/
      );
      await equip(other, "animation", id, copy);
      assert.deepEqual((await inventory(other)).equipped[copy], {
        animation: id
      });
    } else {
      await assert.rejects(
        equip(other, "animation", "infinity_lightning", copy),
        /COSMETIC_CARD_INELIGIBLE/
      );
    }
    if (edition) {
      assert.deepEqual((await inventory(other)).specialEditions, [catalogueId]);
      assert.deepEqual((await inventory(user)).specialEditions, []);
    }
  }

  const eligibleCard = copiesByName["infinity-lr"];
  const eligibleSsr = copiesByName["infinity-ssr"];
  const originalSsr = copiesByName["normal-ssr"];
  const cosmeticPage = (player, id, equippedOnly = false) =>
    call(
      player,
      "select public.get_collection_groups_page(p_cosmetic_id=>$1,p_cosmetic_equipped_only=>$2) result",
      [id, equippedOnly]
    );
  const pageCopies = page =>
    page.groups.flatMap(group => group.copies.map(copy => copy.instanceId));
  assert.deepEqual(
    pageCopies(await cosmeticPage(other, "infinity_lightning_ssr")),
    [eligibleSsr]
  );
  assert.deepEqual(
    pageCopies(await cosmeticPage(other, "infinity_lightning")),
    [eligibleCard]
  );
  assert.deepEqual(
    pageCopies(await cosmeticPage(other, "infinity_lightning_ssr", true)),
    [eligibleSsr]
  );
  assert.deepEqual(
    pageCopies(await cosmeticPage(user, "infinity_lightning_ssr", true)),
    []
  );
  await assert.rejects(
    cosmeticPage(other, "obsidian_seal"),
    /COLLECTION_PAGE_INVALID/
  );
  await equip(other, "animation", null, eligibleSsr);
  assert.deepEqual(
    pageCopies(await cosmeticPage(other, "infinity_lightning_ssr", true)),
    []
  );
  await db.query(
    "update public.user_profiles set karas_balance=400 where user_id=$1",
    [other]
  );
  await buy("violet_dusk", 400, 1, randomUUID(), other);
  await assert.rejects(
    equip(other, "filter", "violet_dusk", originalSsr),
    /COSMETIC_CARD_INELIGIBLE/
  );
  await equip(other, "filter", "violet_dusk", card);
  assert.equal((await inventory(other)).equipped[card].filter, "violet_dusk");
  await db.query(
    "update public.user_profiles set karas_balance=9000 where user_id=$1",
    [other]
  );
  for (const id of [
    "infinity_lightning_violet",
    "infinity_lightning_blue",
    "infinity_lightning_gold",
    "infinity_lightning_red",
    "infinity_lightning_black"
  ]) {
    const purchase = await buy(id, 900, 1, randomUUID(), other);
    assert.equal(purchase.items.find(item => item.id === id).available, 1);
    await assert.rejects(
      equip(other, "animation", id),
      /COSMETIC_CARD_INELIGIBLE/
    );
    await equip(other, "animation", id, eligibleCard);
    assert.deepEqual((await inventory(other)).copies[id], {
      quantity: 1,
      available: 0
    });
    assert.equal((await inventory(other)).equipped[eligibleCard].animation, id);
    const ssrId = `${id}_ssr`;
    await buy(ssrId, 900, 1, randomUUID(), other);
    await assert.rejects(
      equip(other, "animation", ssrId, eligibleCard),
      /COSMETIC_CARD_INELIGIBLE/
    );
    await assert.rejects(
      equip(other, "animation", id, eligibleSsr),
      /COSMETIC_CARD_INELIGIBLE/
    );
    await equip(other, "animation", ssrId, eligibleSsr);
    assert.deepEqual((await inventory(other)).copies[ssrId], {
      quantity: 1,
      available: 0
    });
  }
  assert.equal((await shop(other)).balance, 0);
  assert.deepEqual((await inventory(other)).copies.infinity_lightning, {
    quantity: 3,
    available: 3
  });

  await db.query(
    "update public.user_profiles set karas_balance=2700 where user_id=$1",
    [other]
  );
  const reflections = await buy(
    "infinity_reflection_blue",
    900,
    2,
    randomUUID(),
    other
  );
  assert.equal(reflections.balance, 900);
  const reflectionsSsr = await buy(
    "infinity_reflection_blue_ssr",
    900,
    1,
    randomUUID(),
    other
  );
  assert.equal(reflectionsSsr.balance, 0);
  for (const incompatible of [
    card,
    originalSsr,
    copiesByName.shiny,
    copiesByName.edition
  ]) {
    await assert.rejects(
      equip(other, "animation", "infinity_reflection_blue", incompatible),
      /COSMETIC_CARD_INELIGIBLE/
    );
  }
  for (const [compatible, wrongCard, id] of [
    [eligibleCard, eligibleSsr, "infinity_reflection_blue"],
    [eligibleSsr, eligibleCard, "infinity_reflection_blue_ssr"]
  ]) {
    await assert.rejects(
      equip(other, "animation", id, wrongCard),
      /COSMETIC_CARD_INELIGIBLE/
    );
    await equip(other, "animation", id, compatible);
    assert.equal((await inventory(other)).equipped[compatible].animation, id);
  }
  assert.deepEqual((await inventory(other)).copies.infinity_reflection_blue, {
    quantity: 2,
    available: 1
  });
  assert.deepEqual(
    (await inventory(other)).copies.infinity_reflection_blue_ssr,
    { quantity: 1, available: 0 }
  );

  await db.query(
    "update public.user_profiles set karas_balance=2700 where user_id=$1",
    [other]
  );
  const original = await buy(
    "infinity_reflection_original",
    900,
    2,
    randomUUID(),
    other
  );
  assert.equal(original.balance, 900);
  const originalSsrOffer = await buy(
    "infinity_reflection_original_ssr",
    900,
    1,
    randomUUID(),
    other
  );
  assert.equal(originalSsrOffer.balance, 0);
  await assert.rejects(
    equip(other, "animation", "infinity_reflection_original", originalSsr),
    /COSMETIC_CARD_INELIGIBLE/
  );
  await assert.rejects(
    equip(other, "animation", "infinity_reflection_original_ssr", originalSsr),
    /COSMETIC_CARD_INELIGIBLE/
  );
  await equip(
    other,
    "animation",
    "infinity_reflection_original_ssr",
    eligibleSsr
  );
  await equip(other, "animation", "infinity_reflection_original", eligibleCard);
  assert.deepEqual(
    (await inventory(other)).copies.infinity_reflection_original,
    {
      quantity: 2,
      available: 1
    }
  );
  assert.equal(
    (await inventory(other)).copies.infinity_reflection_blue.available,
    2
  );

  const privateAccess = call(
    other,
    "select price_paid result from public.card_cosmetic_purchases"
  );
  await assert.rejects(privateAccess, /permission denied/);

  await db.query(
    "update public.user_profiles set karas_balance=1800 where user_id=$1",
    [other]
  );
  const sakura = await buy("showcase_sakura", 900, 2, randomUUID(), other);
  assert.equal(sakura.balance, 0);
  await equip(other, "animation", "showcase_sakura", originalSsr);
  await equip(other, "animation", "showcase_sakura", card);
  assert.deepEqual((await inventory(other)).copies.showcase_sakura, {
    quantity: 2,
    available: 0
  });
  await db.query(
    "update public.user_profiles set karas_balance=1800 where user_id=$1",
    [other]
  );
  await buy("frame_halo", 900, 2, randomUUID(), other);
  await equip(other, "animation", "frame_halo", copiesByName.common);
  await equip(other, "animation", "frame_halo", copiesByName.shiny);
  assert.deepEqual((await inventory(other)).copies.frame_halo, {
    quantity: 2,
    available: 0
  });
  assert.deepEqual(
    new Set(pageCopies(await cosmeticPage(other, "frame_halo", true))),
    new Set([copiesByName.common, copiesByName.shiny])
  );
  await db.query(
    "insert into public.card_cosmetic_purchases(user_id,cosmetic_id,price_paid) values($1,'prism_sweep',450)",
    [other]
  );
  await equip(other, "animation", "prism_sweep", originalSsr);
  assert.equal(
    (await inventory(other)).equipped[originalSsr].animation,
    "prism_sweep"
  );
  assert.equal((await inventory(other)).copies.showcase_sakura.available, 1);

  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  await db.query(
    "update auth.users set banned_until = now()+interval '1 day' where id=$1",
    [user]
  );
  await assert.rejects(buy("astral_atlas", 1200), /ACCOUNT_BANNED/);
});

test("Infinity rarity split preserves previously equipped copies and total ownership", async t => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const name = "20261127010000_split_infinity_cosmetics_by_rarity.sql";
  const migrations = readdirSync(directory)
    .filter(file => file.endsWith(".sql") && file < name)
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  const player = randomUUID();
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values ($1,\'{"pseudo":"SplitCosmetics"}\')',
    [player]
  );
  const cards = {};
  for (const rarity of ["SSR", "LR"]) {
    const {
      rows: [{ id }]
    } = await db.query(
      `with catalogue as (
        insert into public.cards(source_id,nom,categorie,rarete_base,image_url,source)
        values($1,$1,'ANIME/MANGA',$2,'https://example.test/card.png','test') returning id
      ) insert into public.user_cards(user_id,card_id,rarity,is_evolved,is_shiny)
        select $3,id,$2,true,$2='SSR' from catalogue returning id`,
      [`split-${rarity}`, rarity, player]
    );
    cards[rarity] = id;
  }
  await db.query(
    `insert into public.card_cosmetic_purchases(user_id,cosmetic_id,quantity,price_paid) values
      ($1,'infinity_reflection_blue',3,2700), ($1,'infinity_lightning',1,900),
      ($1,'infinity_lightning_violet',1,900)`,
    [player]
  );
  for (const card of Object.values(cards)) {
    await db.query(
      "insert into public.card_cosmetic_equipment(card_id,user_id,kind,cosmetic_id) values($1,$2,'animation','infinity_reflection_blue')",
      [card, player]
    );
  }
  const {
    rows: [{ id: otherSsr }]
  } = await db.query(
    `insert into public.user_cards(user_id,card_id,rarity,is_evolved,is_shiny)
      select user_id,card_id,rarity,is_evolved,is_shiny from public.user_cards where id=$1 returning id`,
    [cards.SSR]
  );
  await db.query(
    "insert into public.card_cosmetic_equipment(card_id,user_id,kind,cosmetic_id) values($1,$2,'animation','infinity_lightning_violet')",
    [otherSsr, player]
  );
  const migration = readFileSync(new URL(name, directory), "utf8");
  for (let attempt = 0; attempt < 2; attempt++) {
    await db.exec(migration);
    const inventory = await db.query(
      "select cosmetic_id,quantity,price_paid from public.card_cosmetic_purchases where user_id=$1 order by cosmetic_id",
      [player]
    );
    assert.deepEqual(
      inventory.rows.map(row => [
        row.cosmetic_id,
        row.quantity,
        Number(row.price_paid)
      ]),
      [
        ["infinity_lightning", 1, 900],
        ["infinity_lightning_violet_ssr", 1, 900],
        ["infinity_reflection_blue", 2, 1800],
        ["infinity_reflection_blue_ssr", 1, 900]
      ]
    );
    const equipped = await db.query(
      "select card_id,cosmetic_id from public.card_cosmetic_equipment where user_id=$1",
      [player]
    );
    assert.deepEqual(
      Object.fromEntries(
        equipped.rows.map(row => [row.card_id, row.cosmetic_id])
      ),
      {
        [cards.SSR]: "infinity_reflection_blue_ssr",
        [cards.LR]: "infinity_reflection_blue",
        [otherSsr]: "infinity_lightning_violet_ssr"
      }
    );
  }
});
