import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("../lib/data/profile-wall.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }
);

test("older mobile browsers generate a valid post ID without randomUUID", () => {
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: () => ({}),
    crypto: { getRandomValues: bytes => bytes.fill(255) }
  });
  assert.equal(exports.wallRequestId(), "ffffffff-ffff-4fff-bfff-ffffffffffff");
});

test("an unanswered publish recovers and the same post ID can be retried", async () => {
  const exports = {};
  const requests = [];
  let expire;
  let timerCleared = false;
  vm.runInNewContext(outputText, {
    exports,
    require: () => ({
      createClient: () => ({
        rpc(name, args) {
          return {
            abortSignal(signal) {
              requests.push({ name, args, signal });
              return requests.length === 1
                ? new Promise(() => {})
                : Promise.resolve({
                    data: { id: args.p_id, text: args.p_body }
                  });
            }
          };
        }
      })
    }),
    AbortController,
    clearTimeout: () => {
      timerCleared = true;
    },
    setTimeout: (callback, delay) => {
      assert.equal(delay, 20_000);
      expire = callback;
    }
  });
  const draft = {
    id: "unique-draft-id",
    text: "Test @BBDOU",
    mediaPath: null,
    gifUrl: null
  };
  const attempt = exports.liveWall.publish(draft);
  expire();
  await assert.rejects(attempt, /Your draft has been kept/);
  assert.equal(timerCleared, true);
  assert.equal(requests[0].signal.aborted, true);
  const post = await exports.liveWall.publish(draft);
  assert.equal(requests[1].name, "publish_profile_wall_post");
  assert.equal(requests[1].args.p_id, requests[0].args.p_id);
  assert.equal(post.text, draft.text);
});
