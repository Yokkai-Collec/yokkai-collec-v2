import assert from "node:assert/strict";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("pasted DMs attach once, keep bytes private and remove them on moderation", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec(
    "alter table auth.users add column if not exists banned_until timestamptz"
  );
  const users = ["PasteSender", "PasteRecipient", "PasteOutsider"].map(name => [
    crypto.randomUUID(),
    name
  ]);
  for (const [id, pseudo] of users) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [id, JSON.stringify({ pseudo })]
    );
  }
  const [[sender], [recipient], [outsider]] = users;
  const id = crypto.randomUUID();
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k0V4AAAAASUVORK5CYII=";
  const as = async (user, sql, args, role = "authenticated") => {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user ?? ""
    ]);
    try {
      return (await db.query(sql, args)).rows[0]?.value;
    } finally {
      await db.exec(
        "reset role; select set_config('request.jwt.claim.sub','',false)"
      );
    }
  };
  const send = (image, messageId = id, text = "") =>
    as(sender, "select public.send_private_message_image($1,$2,$3,$4) value", [
      recipient,
      text,
      messageId,
      image
    ]);
  const read = (user, role) =>
    as(user, "select public.get_private_message_image($1) value", [id], role);
  await assert.rejects(send(png), /MESSAGES_UNAVAILABLE/);
  await db.query(
    "insert into public.friendships(user_id,friend_id,status) values($1,$2,'accepted')",
    [sender, recipient]
  );
  await assert.rejects(
    send(Buffer.from("<svg onload='alert(1)' />").toString("base64")),
    /MESSAGE_IMAGE_INVALID/
  );
  await assert.rejects(send("!".repeat(32)), /MESSAGE_IMAGE_INVALID/);
  const message = await send(png);
  assert.equal(message.hasImage, true);
  assert.equal(message.text, "");
  assert.deepEqual(await send(png), message);
  await assert.rejects(send(png, id, "changed"), /MESSAGE_CONFLICT/);
  await assert.rejects(
    as(sender, "select public.send_private_message($1,'plain text',$2)", [
      recipient,
      crypto.randomUUID()
    ]),
    /MESSAGE_RATE_LIMITED/
  );
  const page = await as(
    recipient,
    "select public.get_private_messages($1) value",
    [sender]
  );
  assert.equal(page.items[0].hasImage, true);
  assert.equal(JSON.stringify(page).includes(png), false);
  const inbox = await as(
    recipient,
    "select public.get_private_conversations() value",
    []
  );
  assert.equal(inbox.items[0].kind, "image");
  assert.equal(await read(outsider), null);
  await assert.rejects(read(null, "anon"), /permission denied/);
  for (const user of [sender, recipient]) {
    const result = await read(user);
    assert.equal(result.type, "image/png");
    assert.equal(result.data.replace(/\s/g, ""), png);
  }
  await db.query(
    "update public.private_messages set moderated_at=now() where id=$1",
    [id]
  );
  assert.equal(await read(recipient), null);
  const hidden = await as(
    recipient,
    "select public.get_private_messages($1) value",
    [sender]
  );
  assert.equal(hidden.items[0].hasImage, false);
  assert.equal(hidden.items[0].moderated, true);
});
