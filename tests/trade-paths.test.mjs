import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { readRpcPages } from "../lib/data/rpc-pages.mjs";
import {
  intl,
  gameMessages,
  socialMessages,
  loadLocaleModule
} from "./helpers/i18n.mjs";
const require = createRequire(import.meta.url);
const friend = "f9100000-0000-4000-8000-000000000001";
function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      process: { env: { NODE_ENV: "test" } },
      console,
      document: { visibilityState: "visible" },
      require: mocks
    }
  );
  return exports;
}
function apiHarness({
  rpc = async () => ({ data: true, error: null }),
  enrich = async cards => cards
} = {}) {
  const invalidations = [];
  const api = load("lib/data/trades.ts", name => {
    if (name === "@/utils/supabase/client")
      return { createClient: () => ({ rpc }) };
    if (name === "@/lib/data/cards")
      return {
        withLiveCardFranchises: enrich,
        invalidatePlayerSnapshots: scopes => invalidations.push(scopes)
      };
    if (name === "@/lib/data/rpc-pages.mjs") return { readRpcPages };
    if (name.startsWith("@/messages/"))
      return {
        default: JSON.parse(readFileSync(name.replace("@/", ""), "utf8"))
      };
    throw Error(name);
  });
  return { api, invalidations };
}
test("trade context enriches both inventories in a single batch without changing instance ownership or snapshots", async () => {
  const own = [{ id: "same", instanceId: "own", customImageUrl: "own.png" }],
    other = [
      { id: "same", instanceId: "friend", customImageUrl: "friend.gif" }
    ];
  let calls = 0;
  const { api } = apiHarness({
    rpc: async (name, args) => {
      assert.equal(name, "get_trade_context");
      assert.equal(args.p_friend_id, friend);
      return {
        data: {
          friend: { id: friend, pseudo: "Friend" },
          balance: 42,
          ownCards: own,
          friendCards: other
        },
        error: null
      };
    },
    enrich: async cards => {
      calls++;
      assert.deepEqual(
        Array.from(cards, c => c.instanceId),
        ["own", "friend"]
      );
      return cards.map(c => ({ ...c, anime: "Live franchise" }));
    }
  });
  const result = await api.getTradeContext(friend);
  assert.equal(calls, 1);
  assert.equal(result.balance, 42);
  assert.equal(result.ownCards[0].instanceId, "own");
  assert.equal(result.friendCards[0].instanceId, "friend");
  assert.equal(result.ownCards[0].customImageUrl, "own.png");
  assert.equal(result.friendCards[0].customImageUrl, "friend.gif");
  assert.equal(own[0].anime, undefined);
});
test("a successful SQL decline returning false is success to conversation callers; acceptance is not forged", async () => {
  for (const action of ["accept", "decline"]) {
    const { api, invalidations } = apiHarness({
      rpc: async (name, args) => {
        assert.equal(name, "respond_trade_offer");
        assert.equal(args.p_action, action);
        return { data: false, error: null };
      }
    });
    assert.equal(
      await api.respondTradeOffer("offer", action),
      action === "decline"
    );
    assert.equal(invalidations.length, 0);
  }
  const { api, invalidations } = apiHarness();
  assert.equal(await api.respondTradeOffer("offer", "accept"), true);
  assert.deepEqual(Array.from(invalidations[0]), ["collection", "balance"]);
  const rejected = apiHarness({
    rpc: async () => ({ data: null, error: { message: "TRADE_NOT_PENDING" } })
  });
  await assert.rejects(
    rejected.api.respondTradeOffer("offer", "decline"),
    /no longer pending/
  );
});
function componentHarness(adapter, props = {}) {
  const state = [],
    effects = [];
  let poll;
  let index = 0,
    dirty = true,
    tree;
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const i = index++;
      state[i] ??= {
        value: typeof initial === "function" ? initial() : initial
      };
      return [
        state[i].value,
        v => {
          state[i].value = typeof v === "function" ? v(state[i].value) : v;
          dirty = true;
        }
      ];
    },
    useRef(initial) {
      const i = index++;
      return (state[i] ??= { current: initial });
    },
    useMemo(fn, deps) {
      const i = index++;
      if (!state[i] || !same(state[i].deps, deps))
        state[i] = { deps, value: fn() };
      return state[i].value;
    },
    useEffect(fn, deps) {
      const i = index++;
      if (!state[i] || !same(state[i].deps, deps)) {
        effects.push(() => {
          state[i]?.cleanup?.();
          state[i] = { deps, cleanup: fn() };
        });
      }
    },
    useId: () => "id-" + index++
  };
  const ui = Object.fromEntries(
    [
      "Avatar",
      "Button",
      "Chip",
      "Feedback",
      "Karas",
      "Modal",
      "StatusPill",
      "Tabs"
    ].map(n => [n, Object.defineProperty(() => null, "name", { value: n })])
  );
  const { api } = apiHarness();
  const { createDemandPager } = load("lib/data/demand-pages.ts", () => ({}));
  const translators = new Map();
  const scopedIntl = {
    ...intl,
    useTranslations(namespace) {
      if (!translators.has(namespace))
        translators.set(namespace, intl.useTranslations(namespace));
      return translators.get(namespace);
    }
  };
  const { TradesPanel } = load("components/trades.tsx", name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next-intl") return scopedIntl;
    if (name === "@/i18n/game-messages") return gameMessages;
    if (name === "@/i18n/social-messages") return socialMessages;
    if (name === "@/i18n/locale") return loadLocaleModule();
    if (name === "@/components/ui") return ui;
    if (name === "@/lib/data/trades") return api;
    if (name === "@/lib/data/demand-pages") return { createDemandPager };
    if (name === "@/lib/data/friends")
      return {
        groupFriendships: items => ({
          friends: items.filter(i => i.bucket === "friends").map(i => i.friend),
          incoming: [],
          outgoing: []
        }),
        friendshipItems: lists =>
          lists.friends.map(friend => ({ bucket: "friends", friend }))
      };
    if (name === "@/lib/ui/visible-polling")
      return {
        startVisiblePolling: fn => {
          poll = fn;
          return () => {};
        }
      };
    if (name === "@/lib/ui/collection-groups")
      return load("lib/ui/collection-groups.ts", () => ({}));
    return {};
  });
  function render() {
    index = 0;
    dirty = false;
    tree = TradesPanel({ adapter, pollIntervalMs: null, ...props });
    return tree;
  }
  function all() {
    const found = [];
    function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) {
        n.forEach(walk);
        return;
      }
      found.push(n);
      walk(n.props?.children);
    }
    walk(tree);
    return found;
  }
  async function settle() {
    for (let i = 0; i < 12; i++) {
      if (dirty) render();
      effects.splice(0).forEach(f => f());
      await new Promise(r => setImmediate(r));
      if (!dirty && !effects.length) break;
    }
    if (dirty) render();
  }
  render();
  return {
    render,
    settle,
    poll: () => poll?.(),
    all,
    find: name => all().find(n => n.type?.name === name),
    modal: title =>
      all().find(n => n.type === ui.Modal && n.props.title === title)
  };
}
const offer = () => ({
  id: "offer",
  fromUser: friend,
  toUser: "viewer",
  fromPseudo: "Friend",
  toPseudo: "Viewer",
  incoming: true,
  offeredCards: [],
  requestedCards: [],
  offeredKaras: 10,
  requestedKaras: 0,
  status: "pending",
  parentOfferId: null,
  createdAt: "2026-10-29T00:00:00Z"
});
function adapter(overrides = {}) {
  return {
    friendships: async () => ({
      friends: [{ id: friend, pseudo: "Alias" }],
      incoming: [],
      outgoing: []
    }),
    listOffers: async () => [offer()],
    context: async () => ({
      friend: { id: friend, pseudo: "Alias" },
      balance: 100,
      ownCards: [],
      friendCards: []
    }),
    create: async () => "created",
    cancel: async () => true,
    respond: async () => true,
    ...overrides
  };
}
test("targeted review waits for offers, works with a fixed friend, and does not wait for friendship lookup", async () => {
  let resolveOffers,
    friendReads = 0,
    contexts = 0;
  const loaded = new Promise(r => (resolveOffers = r));
  const h = componentHarness(
    adapter({
      friendships: () => {
        friendReads++;
        return new Promise(() => {});
      },
      listOffers: () => loaded,
      context: async () => {
        contexts++;
        return {
          friend: { id: friend, pseudo: "Alias" },
          balance: 100,
          ownCards: [],
          friendCards: []
        };
      }
    }),
    { initialOfferId: "offer", fixedFriendId: friend }
  );
  assert.equal(
    h.modal("Review trade").props.open,
    false,
    "initially nested modal stays closed"
  );
  await h.settle();
  assert.equal(friendReads, 0);
  assert.equal(
    contexts,
    0,
    "reviewing snapshots does not download both inventories"
  );
  resolveOffers([offer()]);
  await h.settle();
  assert.equal(h.modal("Review trade").props.open, true);
  assert.equal(h.find("TradeReview").props.offer.id, "offer");
  h.find("TradeReview").props.onClose();
  h.render();
  h.find("Tabs").props.onChange("compose");
  await h.settle();
  assert.equal(contexts, 1);
});
test("legacy pseudo links resolve to a canonical friend before filtering received offers", async () => {
  const h = componentHarness(adapter(), {
    fixedFriendId: "Alias",
    initialOfferId: "offer"
  });
  await h.settle();
  assert.equal(h.find("TradeReview").props.offer?.id, "offer");
  h.find("Tabs").props.onChange("received");
  h.render();
  assert.equal(h.find("OfferList").props.offers.length, 1);
});
test("a committed acceptance remains accepted when refresh fails, and double confirmation sends one mutation", async () => {
  let reads = 0,
    responds = 0,
    release;
  const action = new Promise(r => (release = r));
  const h = componentHarness(
    adapter({
      listOffers: async () => {
        if (++reads > 1) throw Error("offline");
        return [offer()];
      },
      respond: async () => {
        responds++;
        return action;
      }
    }),
    { fixedFriendId: friend, initialOfferId: "offer" }
  );
  await h.settle();
  h.find("TradeReview").props.onAccept();
  h.render();
  const confirm = h
    .modal("This can't be undone")
    .props.children.at(-1)
    .props.children.at(-1);
  const one = confirm.props.onClick();
  const two = confirm.props.onClick();
  assert.equal(responds, 1);
  release(true);
  await Promise.all([one, two]);
  await h.settle();
  assert.equal(h.find("TradeReview").props.offer.status, "accepted");
  assert.equal(h.modal("This can't be undone").props.open, false);
});

test("received offers accept directly from the list once without opening review or confirmation", async () => {
  let status = "pending",
    calls = 0,
    release;
  const pending = new Promise(resolve => {
    release = resolve;
  });
  const h = componentHarness(
    adapter({
      listOffers: async () => [{ ...offer(), status }],
      respond: async (id, action) => {
        assert.equal(id, "offer");
        assert.equal(action, "accept");
        calls++;
        await pending;
        status = "accepted";
        return true;
      }
    }),
    { fixedFriendId: friend }
  );
  await h.settle();
  h.find("Tabs").props.onChange("received");
  await h.settle();
  const list = h.find("OfferList");
  list.props.onAccept(list.props.offers[0]);
  list.props.onAccept(list.props.offers[0]);
  assert.equal(calls, 1);
  h.render();
  assert.equal(h.find("TradeReview").props.offer, undefined);
  assert.equal(h.modal("This can't be undone").props.open, false);
  release();
  await h.settle();
  assert.equal(h.find("OfferList").props.offers.length, 0);
  h.find("Tabs").props.onChange("sent");
  await h.settle();
  assert.equal(h.find("OfferList").props.onAccept, undefined);
});

test("a pre-acceptance polling response cannot restore Pending; reconciliation waits for a fresh read", async () => {
  let reads = 0,
    release;
  let status = "pending";
  const stale = new Promise(r => (release = r));
  const h = componentHarness(
    adapter({
      listOffers: async () => {
        reads++;
        if (reads === 2) return stale;
        return [{ ...offer(), status }];
      },
      respond: async () => {
        status = "accepted";
        return true;
      }
    }),
    { fixedFriendId: friend, initialOfferId: "offer", pollIntervalMs: 100 }
  );
  await h.settle();
  h.poll();
  await h.settle();
  assert.equal(reads, 2);
  h.find("TradeReview").props.onAccept();
  h.render();
  const confirm = h
    .modal("This can't be undone")
    .props.children.at(-1)
    .props.children.at(-1);
  const response = confirm.props.onClick();
  await h.settle();
  assert.equal(h.find("TradeReview").props.offer.status, "accepted");
  release([offer()]);
  await response;
  await h.settle();
  assert.equal(reads, 3);
  assert.equal(h.find("TradeReview").props.offer.status, "accepted");
});
test("send failure preserves a draft; committed send with failed refresh clears it and permits a fresh composer", async () => {
  for (const failSend of [true, false]) {
    let reads = 0,
      creates = 0,
      contexts = 0;
    const h = componentHarness(
      adapter({
        context: async () => {
          contexts++;
          return {
            friend: { id: friend, pseudo: "Alias" },
            balance: 100,
            ownCards: [],
            friendCards: []
          };
        },
        listOffers: async () => {
          if (++reads > 1) throw Error("offline");
          return [offer()];
        },
        create: async () => {
          creates++;
          if (failSend) throw Error("send rejected");
          return "new-offer";
        }
      }),
      { fixedFriendId: friend }
    );
    await h.settle();
    const input = h
      .all()
      .find(n => n.type === "input" && n.props.type === "number");
    input.props.onChange({ target: { value: "9" } });
    h.render();
    const send = h
      .all()
      .find(
        n => n.type?.name === "Button" && n.props.children === "Send offer"
      );
    await send.props.onClick();
    await h.settle();
    assert.equal(creates, 1);
    if (failSend) {
      assert.equal(h.find("Tabs").props.value, "compose");
      assert.equal(
        h.all().find(n => n.type === "input" && n.props.type === "number").props
          .value,
        "9"
      );
    } else {
      assert.equal(h.find("Tabs").props.value, "sent");
      assert.equal(contexts, 1);
      h.find("Tabs").props.onChange("compose");
      await h.settle();
      assert.equal(contexts, 2);
      assert.equal(
        h.all().find(n => n.type === "input" && n.props.type === "number").props
          .value,
        "0"
      );
    }
  }
});

test("collection card links preselect exactly the friend's instance and polling prunes it when unavailable", async () => {
  let available = true;
  const chosen = {
    id: "card",
    instanceId: "chosen",
    name: "Chosen",
    rarity: "LR"
  };
  const h = componentHarness(
    adapter({
      context: async () => ({
        friend: { id: friend, pseudo: "Alias" },
        balance: 100,
        ownCards: [],
        friendCards: available ? [chosen] : []
      })
    }),
    {
      fixedFriendId: "Alias",
      initialRequestedCardId: "chosen",
      pollIntervalMs: 100
    }
  );
  await h.settle();
  const friendLot = () => h.all().filter(n => n.type?.name === "OfferCards")[1];
  assert.equal(h.all().filter(n => n.type?.name === "OfferCards").length, 2);
  assert.equal(friendLot().props.cards[0].instanceId, "chosen");
  available = false;
  h.poll();
  await h.settle();
  assert.equal(friendLot().props.cards.length, 0);
  assert.equal(
    h
      .all()
      .find(n => n.type?.name === "Button" && n.props.children === "Send offer")
      .props.disabled,
    true
  );
});

test("inline removal edits both counteroffer lots without restoring removed copies on polling or changing Karas", async () => {
  const card = instanceId => ({
    id: "same-card",
    instanceId,
    name: "Same card",
    rarity: "SSR",
    obtainedAt: "2026-11-01T00:00:00Z"
  });
  const ownCards = [card("own-one"), card("own-two"), card("own-keep")];
  const friendCards = [card("friend-one"), card("friend-keep")];
  const incoming = {
    ...offer(),
    requestedCards: ownCards,
    offeredCards: friendCards,
    requestedKaras: 15,
    offeredKaras: 40
  };
  let submitted;
  const h = componentHarness(
    adapter({
      listOffers: async () => [incoming],
      context: async () => ({
        friend: { id: friend, pseudo: "Alias" },
        balance: 100,
        ownCards,
        friendCards
      }),
      create: async input => {
        submitted = input;
        return "created";
      }
    }),
    { fixedFriendId: friend, initialOfferId: "offer", pollIntervalMs: 100 }
  );
  await h.settle();
  h.find("TradeReview").props.onCounter();
  await h.settle();
  const lots = () => h.all().filter(n => n.type?.name === "OfferCards");
  lots()[0].props.onRemove(["own-one", "own-two"]);
  lots()[1].props.onRemove(["friend-one"]);
  await h.settle();
  h.poll();
  await h.settle();
  assert.deepEqual(
    Array.from(lots()[0].props.cards, c => c.instanceId),
    ["own-keep"]
  );
  assert.deepEqual(
    Array.from(lots()[1].props.cards, c => c.instanceId),
    ["friend-keep"]
  );
  const send = h
    .all()
    .find(
      n => n.type?.name === "Button" && n.props.children === "Send counteroffer"
    );
  await send.props.onClick();
  await h.settle();
  assert.deepEqual(Array.from(submitted.offeredCardIds), ["own-keep"]);
  assert.deepEqual(Array.from(submitted.requestedCardIds), ["friend-keep"]);
  assert.equal(submitted.offeredKaras, 15);
  assert.equal(submitted.requestedKaras, 40);
  assert.equal(submitted.parentOfferId, "offer");
  assert.equal(
    incoming.requestedCards.length,
    3,
    "the received offer snapshot stays intact"
  );
});

test("prepared trade contexts are reused only for the selected friend and stale requests stay fenced", async () => {
  const { api } = apiHarness();
  const prepared = {
    friendId: friend,
    value: Promise.resolve({ balance: 42 })
  };
  let calls = 0;
  const load = async () => {
    calls++;
    return { balance: 7 };
  };
  const current = () => ({ friendId: friend, requestId: 1 });
  assert.equal(
    (await api.loadTradeContextIfCurrent(load, friend, 1, current, prepared))
      .balance,
    42
  );
  assert.equal(calls, 0);
  assert.equal(
    await api.loadTradeContextIfCurrent(load, friend, 2, current, prepared),
    undefined
  );
  const other = "other";
  assert.equal(
    (
      await api.loadTradeContextIfCurrent(
        load,
        other,
        1,
        () => ({ friendId: other, requestId: 1 }),
        prepared
      )
    ).balance,
    7
  );
  assert.equal(calls, 1);
});
