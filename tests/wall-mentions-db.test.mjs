import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("wall mentions notify eligible players once and link to the original post or reply", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const id = n => `a2110000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [author, alice, bob, blocked, post, reply, privatePost, nested] =
    Array.from({ length: 8 }, (_, i) => id(i + 1));
  for (const [userId, pseudo] of [
    [author, "Author"],
    [alice, "Alice"],
    [bob, "Bób {King}"],
    [blocked, "Blocked"]
  ]) {
    await db.query(
      "insert into auth.users(id, raw_user_meta_data) values ($1, $2)",
      [userId, JSON.stringify({ pseudo })]
    );
  }
  await db.query(
    "update public.user_profiles set is_public = true where user_id = $1",
    [author]
  );
  await db.query(
    "insert into public.user_blocks(blocker_id, blocked_id) values ($1, $2)",
    [blocked, author]
  );

  async function as(user, name, args = []) {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      user
    ]);
    try {
      const result = await db.query(
        `select to_jsonb(value) as result from public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as value`,
        args
      );
      return result.rows.map(row => row.result);
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub', '', false)"
      );
    }
  }

  assert.deepEqual(
    await as(author, "find_wall_mention_players", [
      ["alice", "Blocked"],
      false
    ]),
    [{ userId: alice, pseudo: "Alice" }]
  );
  assert.deepEqual(
    await as(author, "find_wall_mention_players", [["bó"], true]),
    [{ userId: bob, pseudo: "Bób {King}" }]
  );

  const body =
    "@alice, @ALICE! @<Bób {King}> @Author @Unknown @Blocked hello@Alice.net";
  await as(author, "publish_profile_wall_post", [post, body, null, null]);
  await as(author, "publish_profile_wall_post", [post, body, null, null]);
  const notesOf = async user => (await as(user, "list_notifications"))[0];
  const aliceNotes = await notesOf(alice);
  assert.equal(aliceNotes.length, 1);
  const [note] = aliceNotes;
  assert.equal(note.type, "wall_post_mention");
  assert.equal(note.actorPseudo, "Author");
  assert.equal(note.postOwnerId, author);
  assert.equal(note.postId, post);
  assert(!JSON.stringify(note).includes(body));
  assert.equal((await notesOf(bob)).length, 1);
  assert.equal((await notesOf(author)).length, 0);
  assert.equal((await notesOf(blocked)).length, 0);
  assert.equal(
    (
      await db.query("select public.get_push_notification($1, $2) result", [
        note.id,
        note.createdAt
      ])
    ).rows[0].result.notification.postId,
    post
  );

  await as(alice, "publish_wall_post_reply", [
    post,
    reply,
    "@Author @<Bób {King}>"
  ]);
  const authorNotes = await notesOf(author);
  assert.equal(authorNotes.length, 1);
  assert.equal(authorNotes[0].type, "wall_reply_mention");
  assert.equal(authorNotes[0].replyId, reply);
  assert.equal((await notesOf(bob)).length, 2);

  await as(bob, "publish_wall_post_reply_to", [
    post,
    nested,
    reply,
    "@Alice",
    null,
    null
  ]);
  const afterNested = await notesOf(alice);
  assert.equal(afterNested.length, 2);
  assert(
    afterNested.some(
      item => item.type === "wall_reply_mention" && item.replyId === nested
    )
  );

  await db.query(
    "update public.user_profiles set is_public = false where user_id = $1",
    [author]
  );
  await db.query(
    "update public.profile_wall_posts set created_at = now() - interval '1 hour' where id = $1",
    [post]
  );
  await as(author, "publish_profile_wall_post", [
    privatePost,
    "@Alice",
    null,
    null
  ]);
  assert.deepEqual(await notesOf(alice), []);
  assert.equal(
    (
      await db.query("select public.get_push_notification($1, $2) result", [
        note.id,
        note.createdAt
      ])
    ).rows[0].result.notification,
    null
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.notifications where reference_id = $1",
        [privatePost]
      )
    ).rows[0].count,
    0
  );
  await db.query("delete from public.profile_wall_posts where id = $1", [post]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.notifications where type in ('wall_post_mention', 'wall_reply_mention')"
      )
    ).rows[0].count,
    0
  );
});
