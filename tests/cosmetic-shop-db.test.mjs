import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
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
      "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'LR') returning id",
      [user, type]
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

  const initial = await shop(user);
  assert.equal(initial.items.length, 22);
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
    ["blue", "gold", "original", "red", "violet"].map(color => [
      `infinity_reflection_${color}`,
      "animation",
      900
    ])
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

  await assert.rejects(equip(other, "back", "obsidian_seal"), /CARD_NOT_OWNED/);
  await assert.rejects(
    equip(user, "filter", "obsidian_seal"),
    /COSMETIC_NOT_OWNED/
  );
  await equip(user, "animation", "showcase_cyber");
  await equip(user, "filter", "silver_screen");
  await equip(user, "back", "obsidian_seal");
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
  assert.deepEqual((await inventory(user)).equipped[card], {
    animation: "showcase_cyber",
    filter: "silver_screen",
    back: "obsidian_seal"
  });
  await equip(user, "filter", null);
  assert.deepEqual((await inventory(user)).equipped[card], {
    animation: "showcase_cyber",
    back: "obsidian_seal"
  });

  await db.query("update public.user_cards set user_id=$1 where id=$2", [
    other,
    card
  ]);
  assert.deepEqual((await inventory(user)).equipped, {});
  assert.deepEqual((await inventory(other)).equipped, {});
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
    await equip(other, "back", id);
    assert.deepEqual((await inventory(other)).equipped[card], { back: id });
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
  assert.deepEqual((await inventory(other)).equipped[card], {
    back: "midnight_sakura"
  });

  for (const { name, rarity, shiny, evolved, edition, eligible } of [
    { name: "common", rarity: "C" },
    { name: "normal-ssr", rarity: "SSR" },
    { name: "shiny", rarity: "LR", shiny: true, eligible: true },
    { name: "infinity", rarity: "LR", evolved: true, eligible: true },
    { name: "edition", rarity: "LR", edition: true, eligible: true }
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
    if (eligible) {
      await equip(other, "animation", "infinity_lightning", copy);
      assert.deepEqual((await inventory(other)).equipped[copy], {
        animation: "infinity_lightning"
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

  const specialCopy = await db.query(
    "select id from public.user_cards where user_id=$1 and is_evolved limit 1",
    [other]
  );
  const eligibleCard = specialCopy.rows[0].id;
  await db.query(
    "update public.user_profiles set karas_balance=4500 where user_id=$1",
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
  }
  assert.equal((await shop(other)).balance, 0);
  assert.deepEqual((await inventory(other)).copies.infinity_lightning, {
    quantity: 3,
    available: 1
  });

  await db.query(
    "update public.user_profiles set karas_balance=1800 where user_id=$1",
    [other]
  );
  const reflections = await buy(
    "infinity_reflection_blue",
    900,
    2,
    randomUUID(),
    other
  );
  assert.equal(reflections.balance, 0);
  await equip(other, "animation", "infinity_reflection_blue", card);
  await equip(other, "animation", "infinity_reflection_blue", eligibleCard);
  assert.deepEqual((await inventory(other)).copies.infinity_reflection_blue, {
    quantity: 2,
    available: 0
  });
  assert.equal(
    (await inventory(other)).equipped[card].animation,
    "infinity_reflection_blue"
  );

  await db.query(
    "update public.user_profiles set karas_balance=1800 where user_id=$1",
    [other]
  );
  const original = await buy(
    "infinity_reflection_original",
    900,
    2,
    randomUUID(),
    other
  );
  assert.equal(original.balance, 0);
  const originalSsr = (
    await db.query(
      "select id from public.user_cards where user_id=$1 and rarity='SSR' and not is_evolved and not is_shiny limit 1",
      [other]
    )
  ).rows[0].id;
  await equip(other, "animation", "infinity_reflection_original", originalSsr);
  await equip(other, "animation", "infinity_reflection_original", card);
  assert.deepEqual(
    (await inventory(other)).copies.infinity_reflection_original,
    {
      quantity: 2,
      available: 0
    }
  );
  assert.equal(
    (await inventory(other)).copies.infinity_reflection_blue.available,
    1
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
