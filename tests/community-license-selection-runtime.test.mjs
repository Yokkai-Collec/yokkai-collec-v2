import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createTranslator } from "next-intl";
test("Choosing a license scopes the main players table, ignores stale reads and resets to overall", async () => {
  const slots = [],
    effects = [],
    calls = [];
  let index = 0,
    dirty = false,
    tree;
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const n = index++;
      if (!slots[n]) slots[n] = { value: initial };
      return [
        slots[n].value,
        next => {
          const value =
            typeof next === "function" ? next(slots[n].value) : next;
          if (!Object.is(value, slots[n].value)) {
            slots[n].value = value;
            dirty = true;
          }
        }
      ];
    },
    useEffect(fn, deps) {
      const n = index++;
      if (!same(slots[n]?.deps, deps)) {
        const prev = slots[n];
        slots[n] = { deps };
        effects.push(() => {
          prev?.cleanup?.();
          slots[n].cleanup = fn();
        });
      }
    }
  };
  const messages = JSON.parse(fs.readFileSync("messages/en.json", "utf8")),
    exports = {};
  const passthrough = name => Object.assign(() => null, { displayName: name });
  const explorer = passthrough("RankingLicenseExplorer");
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("components/community-leaderboard.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    {
      exports,
      require: name => {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return jsx;
        if (name === "next/link") return { default: passthrough("Link") };
        if (name === "next-intl")
          return {
            useTranslations: namespace =>
              createTranslator({ locale: "en", messages, namespace }),
            useFormatter: () => ({
              number: (v, o) => new Intl.NumberFormat("en", o).format(v)
            })
          };
        if (name === "@/lib/data/binders")
          return { stableBindersEnabled: () => true };
        if (name === "@/lib/ui/binder-identity")
          return { binderIdentity: b => b.key };
        if (name === "@/lib/ui/binder-discovery")
          return {
            binderHref: (binder, completedOnly) => {
              assert.equal(binder, undefined);
              assert.equal(completedOnly, true);
              return "/collection?view=binders&completed=1";
            }
          };
        if (name === "@/lib/leaderboard/community")
          return {
            completionRatio: (v, total) =>
              total ? Math.floor((v * 1000) / total) / 1000 : 0,
            getCommunityRanking: (kind, options, key) =>
              new Promise(resolve =>
                calls.push({ kind, options, key, resolve })
              )
          };
        if (name === "@/components/ranking-player-preview")
          return {
            useRankingPlayerPreview: () => ({
              onClickCapture: () => {},
              preview: null
            })
          };
        if (name === "@/components/ranking-license-explorer")
          return { RankingLicenseExplorer: explorer };
        const names = {
          "@/components/ranking-progress": ["RankingGoal", "RankingTrend"],
          "@/components/ranking-license-cover": ["RankingLicenseCover"],
          "@/components/ranking-icon": ["RankingIcon"],
          "@/components/ui": ["Button"],
          "@/components/global-license-stats": ["GlobalLicenseStats"],
          "@/components/styled-player-avatar": ["StyledPlayerAvatar"],
          "@/components/styled-player-name": ["StyledPlayerName"]
        };
        if (names[name])
          return Object.fromEntries(names[name].map(k => [k, passthrough(k)]));
        throw Error(name);
      }
    }
  );
  const walk = node =>
    Array.isArray(node)
      ? node.flatMap(walk)
      : node && typeof node === "object"
        ? [node, ...walk(node.props?.children)]
        : [];
  const flush = async () => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      if (!tree || dirty) {
        dirty = false;
        index = 0;
        tree = exports.CommunityLeaderboardView({
          userId: "me",
          kind: "licenses"
        });
      }
      while (effects.length) effects.shift()();
    }
  };
  const result = (pseudo, binder = null) => ({
    offset: 0,
    limit: 20,
    total: 1,
    rankedPlayers: 1,
    query: "",
    friendsOnly: false,
    binder,
    entries: [
      {
        userId: pseudo,
        pseudo,
        avatarUrl: null,
        position: 1,
        value: 1,
        isFriend: false
      }
    ],
    mine: { value: 1, position: 1, isPublic: true, completedLicenses: 1 },
    profileStyles: {},
    catalogue: { totalCards: 10, totalLicenses: 2 }
  });
  const picker = () => walk(tree).find(n => n.type === explorer);
  const completedShortcut = () =>
    walk(tree).find(n => n.props?.children === "View completed licenses");
  await flush();
  assert.equal(calls[0].key, "global:progress-score");
  calls[0].resolve(result("Overall"));
  await flush();
  assert.equal(
    completedShortcut().props.href,
    "/collection?view=binders&completed=1"
  );
  picker().props.onSelect({
    key: "source:dragon",
    license: "Dragon",
    total: 10
  });
  await flush();
  assert.equal(calls[1].key, "source:dragon");
  assert.equal(calls[1].options.offset, 0);
  picker().props.onSelect({
    key: "source:naruto",
    license: "Naruto",
    total: 20
  });
  await flush();
  assert.equal(calls[2].key, "source:naruto");
  calls[2].resolve(
    result("NarutoPlayer", {
      key: "source:naruto",
      license: "Naruto",
      total: 20
    })
  );
  await flush();
  calls[1].resolve(result("StaleDragonPlayer"));
  await flush();
  let links = walk(tree).filter(
    n => n.props?.className === "yk-leaderboard-player"
  );
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, "/profile/NarutoPlayer");
  assert.equal(completedShortcut(), undefined);
  const friends = walk(tree).find(
    n => n.props?.["aria-pressed"] === false && n.props.children === "Friends"
  );
  assert(friends);
  friends.props.onClick();
  await flush();
  assert.equal(calls[3].key, "source:naruto");
  assert.equal(calls[3].options.friendsOnly, true);
  calls[3].resolve(
    result("Friend", { key: "source:naruto", license: "Naruto", total: 20 })
  );
  await flush();
  picker().props.onSelect(null);
  await flush();
  assert.equal(calls[4].key, "global:progress-score");
  assert.equal(calls[4].options.friendsOnly, true);
  calls[4].resolve(result("OverallAgain"));
  await flush();
  links = walk(tree).filter(
    n => n.props?.className === "yk-leaderboard-player"
  );
  assert.equal(links[0].props.href, "/profile/OverallAgain");
  assert.ok(completedShortcut());
});
