// The corresponding expression in notify_wall_mentions uses PostgreSQL's
// Unicode alnum class. Angle brackets are reserved by the pseudo validator.
const mentionPattern =
  /(?<![\p{L}\p{N}_.@-])@(?:<([^<>\n\r]{2,30})>|([\p{L}\p{N}_-]+(?:\.+[\p{L}\p{N}_-]+)*))(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}_])/gu;
const barePseudo = /^[\p{L}\p{N}_-]+(?:\.+[\p{L}\p{N}_-]+)*$/u;

export function wallMentionParts(text: string) {
  const parts: { text: string; pseudo?: string }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(mentionPattern)) {
    const pseudo = match[1] ?? match[2];
    if ([...pseudo].length < 2 || [...pseudo].length > 30) continue;
    const index = match.index;
    if (index > cursor) parts.push({ text: text.slice(cursor, index) });
    parts.push({ text: match[0], pseudo });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

export function wallMentionToken(pseudo: string) {
  return barePseudo.test(pseudo) ? `@${pseudo}` : `@<${pseudo}>`;
}

export function wallMentionAtCursor(value: string, cursor: number) {
  const left = value.slice(0, cursor);
  const match = /(?<![\p{L}\p{N}_.@-])@([^@<>\n\r]{0,30})$/u.exec(left);
  if (!match || !match[1].trimStart()) return null;
  const suffix = /^[\p{L}\p{N}_-]+(?:\.+[\p{L}\p{N}_-]+)*/u.exec(
    value.slice(cursor)
  );
  return {
    query: match[1],
    start: match.index,
    end: cursor + (suffix?.[0].length ?? 0)
  };
}
