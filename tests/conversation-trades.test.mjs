import { cardRarityLabels } from "./helpers/card-rarity-labels.mjs";
import { intl } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(file, overrides = {}) {
  const exports = {};
  const code = ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    }
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    Error,
    require: name =>
      name === "next-intl"
        ? intl
        : name === "@/lib/ui/card-rarity-label"
          ? cardRarityLabels
          : name in overrides
            ? overrides[name]
            : require(name)
  });
  return exports;
}
const {
  conversationOffers,
  conversationTimeline,
  createConversationTradeFeed
} = load("lib/ui/conversation-trades.ts");
const clone = value => structuredClone(value);
const offer = (id = "trade-1", patch = {}) => ({
  id,
  fromUser: "bob",
  toUser: "alice",
  fromPseudo: "Bob",
  toPseudo: "Alice",
  incoming: true,
  offeredCards: [],
  requestedCards: [],
  offeredKaras: 125,
  requestedKaras: 50,
  status: "pending",
  createdAt: "2026-10-19T04:00:00Z",
  parentOfferId: null,
  ...patch
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(adapter, onAccepted = () => {}) {
  const snapshots = [];
  const feed = createConversationTradeFeed({
    viewerId: "alice",
    friendId: "bob",
    adapter,
    onAccepted,
    onChange: state => snapshots.push(clone(state))
  });
  return { feed, snapshots, latest: () => snapshots.at(-1) };
}

test("conversation trades require both participants, ignore forged incoming flags and use stable chronological identities", () => {
  const offers = [
    offer("incoming", { incoming: false }),
    offer("outgoing", { fromUser: "alice", toUser: "bob", incoming: true }),
    offer("other", { fromUser: "carol" }),
    offer("outsiders", { fromUser: "bob", toUser: "carol" }),
    offer("deleted", { fromUser: null }),
    offer("self", { fromUser: "alice" }),
    offer("incoming", { incoming: false, status: "accepted" })
  ];
  const scoped = clone(conversationOffers(offers, "alice", "bob"));
  assert.deepEqual(
    scoped.map(item => [item.id, item.incoming, item.status]),
    [
      ["incoming", true, "accepted"],
      ["outgoing", false, "pending"]
    ]
  );
  assert.equal(conversationOffers(offers, "alice", "alice").length, 0);
  assert.equal(conversationOffers(offers, "", "bob").length, 0);
});

test("messages and trades share a chronology without ID collisions; older trades expand independently", () => {
  const message = {
    id: "same",
    createdAt: "2026-10-19T03:00:00Z",
    text: "Hello",
    senderId: "alice",
    recipientId: "bob"
  };
  const offers = [
    offer("old", { createdAt: "2026-10-19T02:00:00Z", status: "cancelled" }),
    offer("same", { status: "declined" })
  ];
  assert.deepEqual(
    clone(conversationTimeline([message], offers, 1)).map(item => item.id),
    ["message:same", "trade:same"]
  );
  assert.deepEqual(
    clone(conversationTimeline([message], offers, 20)).map(item => item.id),
    ["trade:old", "message:same", "trade:same"]
  );
});

test("only a pending received offer can invoke the existing response RPC", async () => {
  const calls = [];
  let rows = [
    offer(),
    offer("sent", { fromUser: "alice", toUser: "bob" }),
    offer("done", { status: "accepted" }),
    offer("other", { fromUser: "carol" })
  ];
  const { feed, latest } = setup({
    listOffers: async () => rows,
    respond: async (id, action) => {
      calls.push([id, action]);
      rows = rows.map(row =>
        row.id === id ? { ...row, status: "declined" } : row
      );
      return true;
    }
  });
  await feed.refresh();
  for (const id of ["sent", "done", "other", "missing"])
    assert.equal(await feed.respond(id, "accept"), false);
  assert.equal(await feed.respond("trade-1", "cancel"), false);
  assert.deepEqual(calls, []);
  assert.equal(await feed.respond("trade-1", "decline"), true);
  assert.deepEqual(calls, [["trade-1", "decline"]]);
  assert.equal(
    latest().offers.find(item => item.id === "trade-1").status,
    "declined"
  );
  assert.equal(await feed.respond("trade-1", "decline"), false);
  feed.stop();
});

test("accept/decline double clicks share one synchronous mutation lock and reconcile authoritative state", async () => {
  const response = deferred();
  let status = "pending",
    calls = 0,
    accepted = 0;
  const { feed, latest } = setup(
    {
      listOffers: async () => [offer("trade-1", { status })],
      respond: async () => {
        calls++;
        await response.promise;
        status = "accepted";
        return true;
      }
    },
    () => accepted++
  );
  await feed.refresh();
  const first = feed.respond("trade-1", "accept");
  assert.equal(latest().busyId, "trade-1");
  assert.equal(await feed.respond("trade-1", "decline"), false);
  assert.equal(calls, 1);
  response.resolve();
  assert.equal(await first, true);
  assert.equal(latest().offers[0].status, "accepted");
  assert.equal(latest().busyId, null);
  assert.equal(accepted, 1);
  feed.stop();
});

test("a pre-response read cannot restore Pending after acceptance; refresh requests never overlap", async () => {
  const stale = deferred();
  let calls = 0,
    running = 0,
    peak = 0,
    status = "pending";
  const { feed, snapshots, latest } = setup({
    listOffers: async () => {
      const call = ++calls;
      running++;
      peak = Math.max(peak, running);
      const result =
        call === 2 ? await stale.promise : [offer("trade-1", { status })];
      running--;
      return result;
    },
    respond: async () => {
      status = "accepted";
      return true;
    }
  });
  await feed.refresh();
  const read = feed.refresh();
  const response = feed.respond("trade-1", "accept");
  await tick();
  stale.resolve([offer()]);
  await Promise.all([read, response]);
  assert.equal(peak, 1);
  assert.equal(calls, 3);
  const acceptedIndex = snapshots.findIndex(
    state => state.offers[0]?.status === "accepted"
  );
  assert.ok(acceptedIndex >= 0);
  assert.ok(
    snapshots
      .slice(acceptedIndex)
      .every(state => state.offers[0]?.status === "accepted")
  );
  assert.equal(latest().busyId, null);
  feed.stop();
});

test("a security cancellation stays cancelled when the follow-up read fails", async () => {
  let responded = false;
  let accepted = false;
  const { feed, latest } = setup(
    {
      listOffers: async () => {
        if (responded) throw new Error("Read failed");
        return [offer()];
      },
      respond: async () => {
        responded = true;
        return "cancelled";
      }
    },
    () => {
      accepted = true;
    }
  );
  await feed.refresh();
  assert.equal(await feed.respond("trade-1", "accept"), true);
  assert.equal(latest().offers[0].status, "cancelled");
  assert.equal(accepted, false);
  feed.stop();
});

test("server rejection refreshes a stale offer; failed reload never erases a successful response", async () => {
  let count = 0;
  const rejected = setup({
    listOffers: async () => [
      offer("trade-1", { status: ++count > 1 ? "cancelled" : "pending" })
    ],
    respond: async () => {
      throw Error("This offer is no longer pending.");
    }
  });
  await rejected.feed.refresh();
  assert.equal(await rejected.feed.respond("trade-1", "accept"), false);
  assert.match(rejected.latest().actionError, /no longer pending/);
  assert.equal(rejected.latest().offers[0].status, "cancelled");
  assert.equal(rejected.latest().busyId, null);
  await rejected.feed.retry();
  assert.equal(rejected.latest().actionError, "");
  rejected.feed.stop();
  count = 0;
  const successful = setup({
    listOffers: async () => {
      if (++count > 1) throw Error("network");
      return [offer()];
    },
    respond: async () => true
  });
  await successful.feed.refresh();
  assert.equal(await successful.feed.respond("trade-1", "accept"), true);
  assert.equal(successful.latest().offers[0].status, "accepted");
  assert.match(successful.latest().readError, /refresh trades/);
  successful.feed.stop();
});

test("remote acceptance invalidates both inventory and balance once; closing ignores pending results", async () => {
  let status = "pending",
    accepted = 0;
  const { feed } = setup(
    {
      listOffers: async () => [
        offer("sent", { fromUser: "alice", toUser: "bob", status })
      ],
      respond: async () => true
    },
    () => accepted++
  );
  await feed.refresh();
  status = "accepted";
  await feed.refresh();
  await feed.refresh();
  assert.equal(accepted, 1);
  feed.stop();
  const response = deferred();
  const stopped = setup({
    listOffers: () => response.promise,
    respond: async () => true
  });
  const read = stopped.feed.refresh();
  stopped.feed.stop();
  response.resolve([offer()]);
  await read;
  assert.deepEqual(stopped.snapshots, []);
  assert.equal(await stopped.feed.respond("trade-1", "accept"), false);
  const mutation = deferred();
  let invalidations = 0,
    reads = 0;
  const closing = setup(
    {
      listOffers: async () => {
        reads++;
        return [offer()];
      },
      respond: () => mutation.promise
    },
    () => invalidations++
  );
  await closing.feed.refresh();
  const replying = closing.feed.respond("trade-1", "accept");
  const beforeClose = closing.snapshots.length;
  closing.feed.stop();
  mutation.resolve(true);
  await replying;
  assert.equal(closing.snapshots.length, beforeClose);
  assert.equal(invalidations, 0);
  assert.equal(reads, 1);
});

test("trade cards show both correctly oriented lots and only recipients receive response buttons", () => {
  const { ConversationTrade } = load("components/conversation-trade.tsx", {
    react: React,
    "@/components/ui": {
      Button: ({ children, disabled }) =>
        React.createElement("button", { disabled }, children),
      Karas: ({ amount }) =>
        React.createElement("span", null, `${amount} Karas`),
      StatusPill: ({ children }) => React.createElement("span", null, children)
    },
    "@/components/yokai-card": {
      YokaiCard: ({ name }) => React.createElement("span", null, name)
    },
    "@/lib/ui/collection-groups": {
      groupCollection: cards =>
        cards.map(card => ({
          key: card.instanceId,
          cards: [card],
          representative: card
        }))
    },
    "@/lib/data/trades": {
      tradeStatusPresentation: status => ({ label: status, tone: "neutral" })
    }
  });
  const html = (viewerId, status = "pending") =>
    renderToStaticMarkup(
      React.createElement(ConversationTrade, {
        offer: offer("trade-1", { status }),
        viewerId,
        busy: false,
        onRespond: () => {}
      })
    );
  const recipient = html("alice");
  assert.match(
    recipient,
    /You give<\/h4>.*50 Karas.*You receive<\/h4>.*125 Karas/
  );
  assert.match(recipient, />Accept<\/button>/);
  assert.match(recipient, />Decline<\/button>/);
  const sender = html("bob");
  assert.match(
    sender,
    /You give<\/h4>.*125 Karas.*You receive<\/h4>.*50 Karas/
  );
  assert.doesNotMatch(sender, />Accept<\/button>|>Decline<\/button>/);
  for (const status of ["accepted", "declined", "countered", "cancelled"])
    assert.doesNotMatch(
      html("alice", status),
      />Accept<\/button>|>Decline<\/button>/
    );
});
