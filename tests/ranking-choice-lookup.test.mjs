import { licenseName } from "./helpers/license-name.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      AbortSignal,
      require: name => {
        if (name === "@/lib/ui/license-name") return licenseName;
        assert(name in dependencies, name);
        return dependencies[name];
      }
    }
  );
  return exports;
}

test("License lookup keeps all matching neighbors in one bounded category lookup", async () => {
  const calls = [],
    rows = [
      { binderKey: "j1", license: "JUJUTSU KAISEN" },
      { binderKey: "j2", license: "JUJUTSU KAISEN MODULO" },
      { binderKey: "j3", license: "JoJo" },
      { binderKey: "other", license: "Naruto" }
    ];
  const { LicenseRankingChoice } = load(
    "components/license-ranking-choice.tsx",
    {
      react: { useCallback: fn => fn },
      "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
      "next-intl": { useTranslations: () => key => key },
      "@/components/ranking-choice": { RankingChoice: () => {} },
      "@/lib/ui/binder-identity": { binderIdentity: item => item.binderKey },
      "@/lib/ui/select-typeahead": {
        normalizeChoiceLabel: s => s.toLowerCase()
      },
      "@/lib/leaderboard/choices": {
        getRankingLicenseChoices: async request => {
          calls.push(request);
          return { items: rows, total: rows.length };
        }
      }
    }
  );
  const choice = LicenseRankingChoice({
    items: [],
    selected: null,
    hasMore: true,
    loading: false,
    onLoadMore: () => {},
    onSelect: () => {},
    category: "ANIME/MANGA",
    query: "shared"
  });
  const controller = new AbortController();
  assert.equal(choice.props.getLabel(rows[0]), "Jujutsu Kaisen");
  assert.equal(choice.props.getKey(rows[0]), "j1");
  assert.equal(rows[0].license, "JUJUTSU KAISEN");
  const result = await choice.props.findMatches("j", controller.signal);
  assert.deepEqual(
    Array.from(result, row => row.binderKey),
    ["j1", "j2", "j3"]
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].category, "ANIME/MANGA");
  assert.equal(calls[0].query, "shared");
  assert.equal(calls[0].prefix, "j");
  assert.equal(calls[0].pageSize, 72);
  assert.equal(calls[0].signal, controller.signal);
  controller.abort();
  assert.equal(
    (await choice.props.findMatches("j", controller.signal)).length,
    0
  );
});

test("Superseded keyboard lookup aborts its HTTP read while retaining the timeout signal", async () => {
  let requestSignal, timeoutSignal, args;
  const timeout = new AbortController(),
    lookup = new AbortController();
  const { getRankingLicenseChoices } = load("lib/leaderboard/choices.ts", {
    "@/utils/supabase/client": {
      createClient: () => ({
        rpc: (name, parameters) => {
          assert.equal(name, "get_ranking_license_choices");
          args = parameters;
          return {
            abortSignal: signal => {
              requestSignal = signal;
              return Promise.resolve({
                data: { items: [], total: 0 },
                error: null
              });
            }
          };
        }
      })
    },
    "@/lib/data/read-request": {
      readRequest: fn => {
        timeoutSignal = timeout.signal;
        return fn(timeoutSignal);
      }
    },
    "@/lib/data/binders": { stableBindersEnabled: () => true }
  });
  await getRankingLicenseChoices({
    prefix: "ju",
    category: "ANIME/MANGA",
    signal: lookup.signal
  });
  assert.equal(args.p_limit, 72);
  assert.equal(args.p_prefix, "ju");
  assert.equal(args.p_category, "ANIME/MANGA");
  assert.equal(requestSignal.aborted, false);
  lookup.abort();
  assert.equal(requestSignal.aborted, true);
  await getRankingLicenseChoices({
    prefix: "n",
    signal: new AbortController().signal
  });
  assert.equal(requestSignal.aborted, false);
  timeout.abort();
  assert.equal(requestSignal.aborted, true);
});
