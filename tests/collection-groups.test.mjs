import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const context = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../lib/ui/collection-groups.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }
  ).outputText,
  context
);
const {
  collectionGroupKey,
  consumableCopies,
  consumptionPlan,
  groupCollection,
  preservationOrder,
  pruneUnavailableSelection,
  selectGroupQuantity
} = context.exports;

const copy = (
  instanceId,
  {
    id = "card-a",
    rarity = "SSR",
    shiny = false,
    obtainedAt = "2026-01-01T00:00:00Z",
    customImageUrl = null,
    folderId = null,
    isFirstOwner = false
  } = {}
) => ({
  id,
  instanceId,
  name: "Carte",
  category: "Anime",
  rarity,
  shiny,
  obtainedAt,
  customImageUrl,
  folderId,
  image: "/card.png",
  catalogueImage: "/card.png",
  isEvolved: false,
  isFirstOwner
});

test("les groupes distinguent card_id, rareté et Shiny", () => {
  const groups = groupCollection([
    copy("normal"),
    copy("shiny", { shiny: true }),
    copy("sr", { rarity: "SR" }),
    copy("other", { id: "card-b" })
  ]);
  assert.equal(groups.length, 4);
  assert.equal(new Set(groups.map(group => group.key)).size, 4);
  assert.notEqual(
    collectionGroupKey(groups[0].cards[0]),
    collectionGroupKey(copy("x", { shiny: true }))
  );
});

test("un groupe garde tous les dossiers et affiche la copie personnalisée la plus récente", () => {
  const old = copy("old", {
    obtainedAt: "2026-01-01T00:00:00Z",
    folderId: "favorites"
  });
  const custom = copy("custom", {
    obtainedAt: "2026-02-01T00:00:00Z",
    customImageUrl: "https://i.imgur.com/custom.png"
  });
  const latest = copy("latest", {
    obtainedAt: "2026-03-01T00:00:00Z",
    folderId: "trade"
  });
  const [group] = groupCollection([old, custom, latest]);
  assert.equal(group.cards.length, 3);
  assert.equal(group.representative.instanceId, "custom");
  assert.equal(group.firstObtainedAt, old.obtainedAt);
  assert.deepEqual(
    new Set(group.cards.map(card => card.folderId)),
    new Set(["favorites", null, "trade"])
  );
});

test("un groupe LR conserve le statut de premier propriétaire quelle que soit la copie représentative", () => {
  const first = copy("first", {
    rarity: "LR",
    obtainedAt: "2026-01-01T00:00:00Z",
    folderId: "favorites",
    isFirstOwner: true
  });
  const custom = copy("custom", {
    rarity: "LR",
    obtainedAt: "2026-02-01T00:00:00Z",
    customImageUrl: "https://i.imgur.com/custom.png"
  });
  const [group] = groupCollection([custom, first]);
  assert.equal(group.representative.instanceId, "custom");
  assert.equal(group.firstObtainedAt, first.obtainedAt);
  assert.equal(group.isFirstOwner, true);
});

test("destruction et évolution préservent les images perso puis prennent les plus anciennes", () => {
  const cards = [
    copy("custom-old", {
      obtainedAt: "2025-01-01T00:00:00Z",
      customImageUrl: "https://i.imgur.com/custom.png"
    }),
    copy("plain-new", { obtainedAt: "2026-03-01T00:00:00Z" }),
    copy("plain-old", { obtainedAt: "2026-01-01T00:00:00Z" }),
    copy("plain-mid", { obtainedAt: "2026-02-01T00:00:00Z" })
  ];
  assert.deepEqual(
    Array.from(preservationOrder(cards), card => card.instanceId),
    ["plain-old", "plain-mid", "plain-new", "custom-old"]
  );
});

test("une copie en enchère est exclue de la sélection et de la destruction", () => {
  const cards = [
    copy("plain-old", { obtainedAt: "2026-01-01T00:00:00Z" }),
    copy("auction", { obtainedAt: "2026-01-02T00:00:00Z" }),
    copy("plain-new", { obtainedAt: "2026-01-03T00:00:00Z" }),
    copy("custom", {
      obtainedAt: "2026-01-04T00:00:00Z",
      customImageUrl: "https://i.imgur.com/custom.png"
    })
  ];
  const frozen = id => id === "auction";
  assert.deepEqual(
    Array.from(consumableCopies(cards, frozen), card => card.instanceId),
    ["plain-old", "plain-new", "custom"]
  );
  assert.deepEqual(
    Array.from(consumptionPlan(cards, 4, frozen), card => card.instanceId),
    ["plain-old", "plain-new", "custom"]
  );
});

test("détruire 2 copies sur 4 retire les deux ordinaires les plus anciennes et laisse un groupe x2", () => {
  const cards = [
    copy("custom-old", {
      obtainedAt: "2026-01-01T00:00:00Z",
      customImageUrl: "https://i.imgur.com/custom.png"
    }),
    copy("plain-new", { obtainedAt: "2026-01-04T00:00:00Z" }),
    copy("plain-old", { obtainedAt: "2026-01-02T00:00:00Z" }),
    copy("plain-mid", { obtainedAt: "2026-01-03T00:00:00Z" })
  ];
  const destroyed = consumptionPlan(cards, 2, () => false);
  assert.deepEqual(
    Array.from(destroyed, card => card.instanceId),
    ["plain-old", "plain-mid"]
  );
  const destroyedIds = new Set(destroyed.map(card => card.instanceId));
  const [survivingGroup] = groupCollection(
    cards.filter(card => !destroyedIds.has(card.instanceId))
  );
  assert.equal(survivingGroup.cards.length, 2);
  assert.deepEqual(
    new Set(survivingGroup.cards.map(card => card.instanceId)),
    new Set(["custom-old", "plain-new"])
  );
});

test("la proposition d'évolution choisit exactement 3 copies disponibles et préserve l'image perso", () => {
  const cards = [
    copy("custom-old", {
      obtainedAt: "2026-01-01T00:00:00Z",
      customImageUrl: "https://i.imgur.com/custom.png"
    }),
    copy("plain-new", { obtainedAt: "2026-01-05T00:00:00Z" }),
    copy("auction-old", { obtainedAt: "2026-01-02T00:00:00Z" }),
    copy("plain-old", { obtainedAt: "2026-01-03T00:00:00Z" }),
    copy("plain-mid", { obtainedAt: "2026-01-04T00:00:00Z" })
  ];
  const proposed = consumableCopies(cards, id => id === "auction-old").slice(
    0,
    3
  );
  assert.deepEqual(
    Array.from(proposed, card => card.instanceId),
    ["plain-old", "plain-mid", "plain-new"]
  );
  assert.ok(!proposed.some(card => card.customImageUrl));
  assert.ok(!proposed.some(card => card.instanceId === "auction-old"));
});

test("un échange choisit les plus anciennes copies ordinaires avant les images personnalisées", () => {
  const cards = [
    copy("custom-old", {
      obtainedAt: "2026-01-01T00:00:00Z",
      customImageUrl: "https://i.imgur.com/custom.png"
    }),
    copy("plain-new", { obtainedAt: "2026-01-04T00:00:00Z" }),
    copy("plain-old", { obtainedAt: "2026-01-02T00:00:00Z" }),
    copy("plain-mid", { obtainedAt: "2026-01-03T00:00:00Z" })
  ];
  assert.deepEqual(
    [...selectGroupQuantity(new Set(), cards, 2)],
    ["plain-old", "plain-mid"]
  );
  assert.ok(!selectGroupQuantity(new Set(), cards, 2).has("custom-old"));
});

test("un échange conserve l'ordre ancien vers récent quand toutes les copies sont personnalisées", () => {
  const cards = [
    copy("custom-new", {
      obtainedAt: "2026-01-03T00:00:00Z",
      customImageUrl: "https://i.imgur.com/new.png"
    }),
    copy("custom-old", {
      obtainedAt: "2026-01-01T00:00:00Z",
      customImageUrl: "https://i.imgur.com/old.png"
    }),
    copy("custom-mid", {
      obtainedAt: "2026-01-02T00:00:00Z",
      customImageUrl: "https://i.imgur.com/mid.png"
    })
  ];
  assert.deepEqual(
    [...selectGroupQuantity(new Set(), cards, 2)],
    ["custom-old", "custom-mid"]
  );
});

test("une quantité hors limites est bornée sans inventer d'identifiant", () => {
  const cards = [copy("one"), copy("two")];
  assert.deepEqual(
    [...selectGroupQuantity(new Set(["outside"]), cards, 0)],
    ["outside"]
  );
  const selected = selectGroupQuantity(new Set(), cards, 99);
  assert.deepEqual(new Set(selected), new Set(["one", "two"]));
  assert.ok(
    [...selected].every(id => cards.some(card => card.instanceId === id))
  );
});

test("diminuer une quantité retire exactement les derniers identifiants ajoutés", () => {
  const cards = [
    copy("new", { obtainedAt: "2026-01-03T00:00:00Z" }),
    copy("old", { obtainedAt: "2026-01-01T00:00:00Z" }),
    copy("mid", { obtainedAt: "2026-01-02T00:00:00Z" })
  ];
  const two = selectGroupQuantity(new Set(), cards, 2);
  const three = selectGroupQuantity(two, cards, 3);
  const backToTwo = selectGroupQuantity(three, cards, 2);
  assert.deepEqual([...two], ["old", "mid"]);
  assert.deepEqual([...three], ["old", "mid", "new"]);
  assert.deepEqual([...backToTwo], ["old", "mid"]);
});

test("la sélection reste unique, bornée au groupe et séparée entre normal et Shiny", () => {
  const normal = [copy("normal-a"), copy("normal-b")];
  const shiny = [
    copy("shiny-a", { shiny: true }),
    copy("shiny-b", { shiny: true })
  ];
  const selected = selectGroupQuantity(
    selectGroupQuantity(new Set(), normal, 2),
    shiny,
    1
  );
  assert.equal(selected.size, 3);
  assert.deepEqual(
    new Set([...selected].filter(id => id.startsWith("normal"))),
    new Set(["normal-a", "normal-b"])
  );
  assert.deepEqual(
    new Set([...selected].filter(id => id.startsWith("shiny"))),
    new Set(["shiny-a"])
  );
  assert.equal(groupCollection([...normal, ...shiny]).length, 2);
});

test("une instance disparue du contexte est retirée avant l'envoi", () => {
  const result = pruneUnavailableSelection(
    new Set(["available", "auctioned"]),
    [copy("available")]
  );
  assert.deepEqual([...result.selected], ["available"]);
  assert.deepEqual(Array.from(result.removed), ["auctioned"]);
  assert.deepEqual(
    Array.from(
      pruneUnavailableSelection(result.selected, [copy("available")]).removed
    ),
    []
  );
});

test("normal and Shiny LR share one group, separate from Infinity", () => {
  const normal = copy("normal-lr", { rarity: "LR" });
  const shiny = copy("shiny-lr", { rarity: "LR", shiny: true });
  const evolved = { ...copy("evolved-lr", { rarity: "LR" }), isEvolved: true };
  const groups = groupCollection([
    normal,
    shiny,
    evolved,
    { ...evolved, instanceId: "evolved-copy" }
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find(g => g.representative.isEvolved).cards.length, 2);
  assert.equal(new Set(groups.map(g => g.key)).size, 2);
});

test("LR normal and Shiny share copies, while Infinity remains a separate group", () => {
  const normal = copy("normal", { rarity: "LR" });
  const shiny = copy("shiny", { rarity: "LR", shiny: true });
  const infinity = { ...normal, instanceId: "infinity", isEvolved: true };
  const groups = groupCollection([normal, shiny, infinity]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].cards.length, 2);
  assert.equal(collectionGroupKey(normal), collectionGroupKey(shiny));
  assert.notEqual(collectionGroupKey(normal), collectionGroupKey(infinity));
});

test("display remembers exact copies and falls back to a surviving Shiny", () => {
  const normal = copy("normal", { rarity: "LR" });
  const shiny = copy("shiny", { rarity: "LR", shiny: true });
  const key = collectionGroupKey(normal);
  const preferred = { [key]: "normal" };
  assert.equal(
    groupCollection([normal, shiny], preferred)[0].representative.instanceId,
    "normal"
  );
  assert.equal(
    groupCollection([normal, shiny], { [key]: "shiny" })[0].representative
      .instanceId,
    "shiny"
  );
  assert.equal(
    groupCollection([shiny], preferred)[0].representative.instanceId,
    "shiny"
  );
  assert.equal(
    groupCollection([normal, shiny], { [key]: "consumed" })[0].representative
      .instanceId,
    "shiny"
  );
  assert.equal(groupCollection([], preferred).length, 0);
});
