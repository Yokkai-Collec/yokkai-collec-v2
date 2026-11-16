// The corresponding expression in notify_wall_mentions uses PostgreSQL's
// Unicode alnum class. Angle brackets are reserved by the pseudo validator.
const barePseudo = /^[\p{L}\p{N}_-]+(?:\.+[\p{L}\p{N}_-]+)*$/u;
const invalidPrefix = /[\p{L}\p{N}_.@-]$/u;

export function wallMentionParts(text: string) {
  // Capture the boundary without lookbehind for older mobile WebKit.
  const mentionPattern =
    /(^|[^\p{L}\p{N}_.@-])@(?:<([^<>\n\r]{2,30})>|([\p{L}\p{N}_-]+(?:\.+[\p{L}\p{N}_-]+)*))(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}_])/gu;
  const parts: { text: string; pseudo?: string }[] = [];
  let cursor = 0;
  for (
    let match = mentionPattern.exec(text);
    match;
    match = mentionPattern.exec(text)
  ) {
    const pseudo = match[2] ?? match[3];
    if ([...pseudo].length < 2 || [...pseudo].length > 30) continue;
    const index = match.index + match[1].length;
    if (index > cursor) parts.push({ text: text.slice(cursor, index) });
    parts.push({ text: match[0].slice(match[1].length), pseudo });
    cursor = mentionPattern.lastIndex;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

export function wallMentionToken(pseudo: string) {
  return barePseudo.test(pseudo) ? `@${pseudo}` : `@<${pseudo}>`;
}

export function wallMentionAtCursor(value: string, cursor: number) {
  if (cursor === 0) return null;
  const left = value.slice(Math.max(0, cursor - 61), cursor);
  const at = left.lastIndexOf("@");
  if (at === -1) return null;
  const start = cursor - left.length + at;
  const query = left.slice(at + 1);
  if (
    !query.trimStart() ||
    /[<>\n\r]/.test(query) ||
    [...query].length > 30 ||
    invalidPrefix.test(value.slice(Math.max(0, start - 2), start))
  ) {
    return null;
  }
  const suffix = /^[\p{L}\p{N}_-]+(?:\.+[\p{L}\p{N}_-]+)*/u.exec(
    value.slice(cursor)
  );
  return {
    query,
    start,
    end: cursor + (suffix?.[0].length ?? 0)
  };
}
