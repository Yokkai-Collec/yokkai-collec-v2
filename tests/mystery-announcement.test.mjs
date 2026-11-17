import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    {
      exports,
      require: name => {
        if (name in imports) return imports[name];
        throw Error(name);
      }
    }
  );
  return exports;
}
const release = load("lib/ui/mystery-auction-announcement.ts");
test("Update receipts are scoped by account and release and survive unavailable storage", () => {
  const values = new Map(),
    storage = {
      getItem: k => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v)
    };
  assert.equal(release.hasMysteryAnnouncementReceipt(storage, "alice"), false);
  release.rememberMysteryAnnouncement(storage, "alice");
  assert.equal(release.hasMysteryAnnouncementReceipt(storage, "alice"), true);
  assert.equal(release.hasMysteryAnnouncementReceipt(storage, "bob"), false);
  assert(
    release
      .mysteryAnnouncementKey("alice")
      .includes(release.MYSTERY_ANNOUNCEMENT_ID)
  );
  const blocked = {
    getItem() {
      throw Error("storage blocked");
    },
    setItem() {
      throw Error("storage blocked");
    }
  };
  assert.equal(release.hasMysteryAnnouncementReceipt(blocked, "alice"), false);
  assert.doesNotThrow(() =>
    release.rememberMysteryAnnouncement(blocked, "alice")
  );
  assert.equal(release.hasMysteryAnnouncementReceipt(null, "alice"), false);
});
test("Acknowledgement writes only the session account's cosmetic metadata and only once", async () => {
  const writes = [];
  let user = {
    id: "session-player",
    user_metadata: { pseudo: "ExistingName" }
  };
  const action = load("app/mystery-auction-announcement/actions.ts", {
    "next/headers": { cookies: async () => ({}) },
    "@/lib/ui/mystery-auction-announcement": release,
    "@/utils/supabase/server": {
      createClient: () => ({
        auth: {
          getUser: async () => ({ data: { user }, error: null }),
          updateUser: async input => {
            writes.push(input);
            return { error: null };
          }
        }
      })
    }
  });
  assert.equal(
    (await action.acknowledgeMysteryAnnouncement("other-player")).ok,
    true
  );
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]), ["data"]);
  assert.deepEqual(Object.keys(writes[0].data), [
    release.MYSTERY_ANNOUNCEMENT_METADATA_KEY
  ]);
  assert.equal(
    writes[0].data[release.MYSTERY_ANNOUNCEMENT_METADATA_KEY],
    release.MYSTERY_ANNOUNCEMENT_ID
  );
  user.user_metadata[release.MYSTERY_ANNOUNCEMENT_METADATA_KEY] =
    release.MYSTERY_ANNOUNCEMENT_ID;
  assert.equal((await action.acknowledgeMysteryAnnouncement()).ok, true);
  assert.equal(writes.length, 1);
  user = null;
  assert.equal((await action.acknowledgeMysteryAnnouncement()).ok, false);
  assert.equal(writes.length, 1);
});
test("An unavailable account service does not break navigation", async () => {
  const action = load("app/mystery-auction-announcement/actions.ts", {
    "next/headers": { cookies: async () => ({}) },
    "@/lib/ui/mystery-auction-announcement": release,
    "@/utils/supabase/server": {
      createClient: () => {
        throw Error("offline");
      }
    }
  });
  assert.equal((await action.acknowledgeMysteryAnnouncement()).ok, false);
});

test("Old update receipts never suppress the new Mystery announcement; stale announcements expire", () => {
  const storage = {
    getItem: key =>
      key === "yokkai:update:2026-11-profiles-showcases-missions:alice"
        ? "1"
        : null
  };
  assert.equal(release.hasMysteryAnnouncementReceipt(storage, "alice"), false);
  assert.notEqual(
    release.MYSTERY_ANNOUNCEMENT_METADATA_KEY,
    "yokkai_last_seen_update"
  );
  assert.equal(
    release.isMysteryAnnouncementActive(Date.parse("2026-11-18T12:00:00Z")),
    true
  );
  assert.equal(
    release.isMysteryAnnouncementActive(Date.parse("2026-12-02T00:00:00Z")),
    false
  );
});

test("The actual announcement opens after an old dismissal but respects its own receipt", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { intl } = await import("./helpers/i18n.mjs");
  for (const seen of [
    "2026-11-profiles-showcases-missions",
    release.MYSTERY_ANNOUNCEMENT_ID
  ]) {
    let open = false,
      first = true,
      syncs = 0;
    const effects = [],
      timers = [];
    const values = new Map([
      ["yokkai:update:2026-11-profiles-showcases-missions:alice", "1"]
    ]);
    const storage = {
      getItem: k => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v)
    };
    const exports = {};
    vm.runInNewContext(
      ts.transpileModule(
        fs.readFileSync("components/mystery-auction-announcement.tsx", "utf8"),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.ReactJSX
          }
        }
      ).outputText,
      {
        exports,
        require: name => {
          if (name === "react/jsx-runtime") return require(name);
          if (name === "react")
            return {
              useState: () => [
                open,
                value => {
                  open = value;
                }
              ],
              useEffect: effect => {
                if (first) effects.push(effect);
              }
            };
          if (name === "next-intl") return intl;
          if (name === "next/image") return { default: () => null };
          if (name === "next/link") return { default: "a" };
          if (name === "@/components/ui")
            return { Modal: "dialog", Button: "button" };
          if (name === "@/app/mystery-auction-announcement/actions")
            return {
              acknowledgeMysteryAnnouncement: async () => {
                syncs++;
              }
            };
          if (name === "@/lib/ui/mystery-auction-announcement")
            return { ...release, isMysteryAnnouncementActive: () => true };
          if (name.endsWith(".css")) return {};
          throw Error(name);
        },
        window: {
          localStorage: storage,
          addEventListener: () => {},
          removeEventListener: () => {}
        },
        document: { visibilityState: "visible", querySelector: () => null },
        setTimeout: fn => {
          timers.push(fn);
          return timers.length;
        },
        clearTimeout: () => {}
      }
    );
    exports.MysteryAuctionAnnouncement({
      userId: "alice",
      seenAnnouncement: seen
    });
    first = false;
    effects.forEach(fn => fn());
    timers.forEach(fn => fn());
    const tree = exports.MysteryAuctionAnnouncement({
      userId: "alice",
      seenAnnouncement: seen
    });
    assert.equal(tree.props.open, seen !== release.MYSTERY_ANNOUNCEMENT_ID);
    assert.equal(syncs, seen !== release.MYSTERY_ANNOUNCEMENT_ID ? 1 : 0);
  }
});
