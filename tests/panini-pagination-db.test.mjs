import assert from "node:assert/strict";
import test from "node:test";
import { replayCatalogueFixtures } from "./helpers/replay-catalogue-fixtures.mjs";

const player = "70000000-0000-4000-8000-000000000001";
const friend = "70000000-0000-4000-8000-000000000002";
const outsider = "70000000-0000-4000-8000-000000000003";

test("les albums Panini sont paginés et leurs cartes chargées à la demande", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());

  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
    [player, JSON.stringify({ pseudo: "PaniniPage" })]
  );
  await db.exec(`
    insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    select 'panini-' || i, 'Carte ' || i, 'ANIME/MANGA', 'Licence ' || lpad(i::text, 3, '0'),
      'C', 'https://example.test/' || i || '.png', 'panini-test'
    from generate_series(1,75) i;
    insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values
      ('film-a','Film A','FILM','Alien','R','https://example.test/film-a.png','panini-test'),
      ('film-b','Film B','FILM','Matrix','SR','https://example.test/film-b.png','panini-test'),
      ('brainrot-a','Brainrot A','BRAINROT','Tralalero Tralala','R','https://example.test/brainrot-a.png','panini-test'),
      ('brainrot-b','Brainrot B','BRAINROT','Bombardiro Crocodilo','SR','https://example.test/brainrot-b.png','panini-test');
  `);
  const ownedCard = (
    await db.query("select id from public.cards where source_id='panini-1'")
  ).rows[0].id;
  await db.query(
    "insert into public.card_franchises(card_id,franchise,position) values ($1,'Licence croisee',1)",
    [ownedCard]
  );
  await db.query(
    "insert into public.user_cards(user_id,card_id,rarity) values ($1,$2,'C')",
    [player, ownedCard]
  );

  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  await db.query(
    "insert into public.panini_album_favorites(user_id,license) values ($1,'Licence 075')",
    [player]
  );
  const first = (
    await db.query(
      "select public.get_panini_albums_page('', '', 0, 72) as value"
    )
  ).rows[0].value;
  assert.equal(first.items.length, 72);
  assert.equal(first.total, 78);
  assert.deepEqual(first.items[0], {
    license: "Licence 075",
    image: "https://example.test/75.png",
    total: 1,
    owned: 0,
    percent: 0,
    favorite: true
  });
  assert.deepEqual(first.items[1], {
    license: "Licence 001",
    image: "https://example.test/1.png",
    total: 1,
    owned: 1,
    percent: 100,
    favorite: false
  });

  const favoritesOnly = (
    await db.query(
      "select public.get_panini_albums_page('', '', 0, 72, true) as value"
    )
  ).rows[0].value;
  assert.equal(favoritesOnly.total, 1);
  assert.deepEqual(favoritesOnly.items, [first.items[0]]);

  const second = (
    await db.query(
      "select public.get_panini_albums_page('', '', 72, 72) as value"
    )
  ).rows[0].value;
  assert.equal(second.items.length, 6);
  assert.equal(second.total, 78);

  const crossed = (
    await db.query(
      "select public.get_panini_album_cards_page('Licence croisee','','',false,0,24) as value"
    )
  ).rows[0].value;
  assert.equal(crossed.total, 1);
  assert.equal(crossed.items[0].anime, "Licence 001");
  assert.equal(crossed.items[0].owned, true);

  const film = (
    await db.query(
      "select public.get_panini_albums_page('', 'FILM', 0, 72) as value"
    )
  ).rows[0].value;
  assert.deepEqual(film.items, [
    {
      license: "FILM",
      image: "https://example.test/film-b.png",
      total: 2,
      owned: 0,
      percent: 0,
      favorite: false
    }
  ]);

  const cards = (
    await db.query(
      "select public.get_panini_album_cards_page('FILM','Film','FILM',false,0,24) as value"
    )
  ).rows[0].value;
  assert.equal(cards.total, 2);
  assert.equal(cards.items.length, 2);
  assert.deepEqual(
    cards.items.map(card => [card.name, card.rarity]),
    [
      ["FILM B", "SR"],
      ["FILM A", "R"]
    ]
  );
  assert.ok(cards.items.every(card => card.owned === false));

  const brainrot = (
    await db.query(
      "select public.get_panini_album_cards_page('BRAINROT','','BRAINROT',false,0,24) as value"
    )
  ).rows[0].value;
  assert.equal(brainrot.total, 2);
  assert.deepEqual(
    brainrot.items.map(card => card.name),
    ["BRAINROT B", "BRAINROT A"]
  );

  const ownedOnly = (
    await db.query(
      "select public.get_panini_album_cards_page('Licence 001','','',true,0,24) as value"
    )
  ).rows[0].value;
  assert.equal(ownedOnly.total, 1);
  assert.equal(ownedOnly.items[0].owned, true);

  await db.exec("reset role");
  for (const role of ["public", "anon"]) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'public.get_panini_albums_page(text,text,integer,integer,boolean)','EXECUTE') as allowed",
          [role]
        )
      ).rows[0].allowed,
      false
    );
    assert.equal(
      (
        await db.query(
          "select has_table_privilege($1,'public.panini_album_favorites','SELECT') as allowed",
          [role]
        )
      ).rows[0].allowed,
      false
    );
  }
});

test("un ami voit les albums Panini du propriétaire sans confondre les possessions", async t => {
  const { db } = await replayCatalogueFixtures();
  t.after(() => db.close());

  for (const [id, pseudo] of [
    [player, "PaniniViewer"],
    [friend, "PaniniFriend"],
    [outsider, "PaniniOutsider"]
  ]) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values ($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  await db.exec(`
    update public.user_profiles set is_public=false where user_id='${friend}';
    insert into public.friendships(user_id,friend_id,status)
    values ('${player}','${friend}','accepted');
    insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source)
    values
      ('friend-panini-a','Ami A','ANIME/MANGA','Album Ami','C','https://example.test/a.png','panini-friend-test'),
      ('friend-panini-b','Ami B','ANIME/MANGA','Album Ami','R','https://example.test/b.png','panini-friend-test');
    insert into public.user_cards(user_id,card_id,rarity)
    select '${friend}',id,rarete_base from public.cards where source_id='friend-panini-a';
    insert into public.card_franchises(card_id,franchise,position)
    select id,'Album croise ami',1 from public.cards where source_id='friend-panini-a';
  `);

  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    player
  ]);
  const albums = (
    await db.query(
      "select public.get_friend_panini_albums_page($1,'Album Ami','',0,72) as value",
      [friend]
    )
  ).rows[0].value;
  assert.deepEqual(albums.items, [
    { license: "Album Ami", total: 2, owned: 1, percent: 50, favorite: false }
  ]);

  const crossedAlbum = (
    await db.query(
      "select public.get_friend_panini_albums_page($1,'Album croise ami','',0,72) as value",
      [friend]
    )
  ).rows[0].value;
  assert.deepEqual(crossedAlbum.items, [
    {
      license: "Album croise ami",
      total: 1,
      owned: 1,
      percent: 100,
      favorite: false
    }
  ]);

  const cards = (
    await db.query(
      "select public.get_friend_panini_album_cards_page($1,'Album Ami','','',false,0,24) as value",
      [friend]
    )
  ).rows[0].value;
  assert.equal(cards.total, 2);
  assert.deepEqual(
    cards.items.map(card => [card.name, card.owned]),
    [
      ["AMI B", false],
      ["AMI A", true]
    ]
  );

  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    outsider
  ]);
  await assert.rejects(
    db.query("select public.get_friend_panini_albums_page($1,'','',0,72)", [
      friend
    ]),
    /PROFILE_PRIVATE/
  );
  await db.exec("reset role");
});
