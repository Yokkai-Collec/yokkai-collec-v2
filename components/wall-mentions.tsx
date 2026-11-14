"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps
} from "react";
import {
  findWallMentionPlayers,
  resolveWallMentionPlayers,
  type WallMentionPlayer
} from "@/lib/data/wall-mentions";
import {
  wallMentionAtCursor,
  wallMentionParts,
  wallMentionToken
} from "@/lib/ui/wall-mentions";
import "@/styles/wall-mentions.css";

export function WallMentionText({ text }: { text: string }) {
  const parts = useMemo(() => wallMentionParts(text), [text]);
  const [players, setPlayers] = useState<WallMentionPlayer[]>([]);
  useEffect(() => {
    const names = parts.flatMap(part => part.pseudo?.toLowerCase() ?? []);
    if (!names.length) return;
    let current = true;
    void resolveWallMentionPlayers(names).then(result => {
      if (current) setPlayers(result);
    });
    return () => {
      current = false;
    };
  }, [parts]);
  const byPseudo = new Map(
    players.map(player => [player.pseudo.toLowerCase(), player])
  );
  return parts.map((part, index) => {
    const player = part.pseudo && byPseudo.get(part.pseudo.toLowerCase());
    return player ? (
      <Link
        key={index}
        className="yk-wall-mention"
        href={`/profile/${encodeURIComponent(player.userId)}`}
        prefetch={false}
      >
        @{part.pseudo}
      </Link>
    ) : (
      part.text
    );
  });
}

type MentionTextareaProps = Omit<
  ComponentProps<"textarea">,
  "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
};

export function WallMentionTextarea({
  value,
  onChange,
  ...props
}: MentionTextareaProps) {
  const t = useTranslations("profileUi");
  const field = useRef<HTMLTextAreaElement>(null);
  const suggestions = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const lastSelection = useRef<{ start: number; end: number } | null>(null);
  const listId = useId();
  const [cursor, setCursor] = useState<number | null>(null);
  const [result, setResult] = useState<{
    query: string;
    players: WallMentionPlayer[];
  }>();
  const [selected, setSelected] = useState(0);
  const mention =
    props.disabled || cursor === null
      ? null
      : wallMentionAtCursor(value, cursor);
  const query = mention?.query ?? "";
  const players = result?.query === query ? result.players : [];
  const active = players.length > 0;
  const activeOption = active
    ? `${listId}-${selected % players.length}`
    : undefined;

  useEffect(() => {
    if ([...query].length < 2) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void findWallMentionPlayers([query], true, controller.signal)
        .then(players => {
          if (!controller.signal.aborted) setResult({ query, players });
        })
        .catch(() => {});
    }, 170);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  function trackCaret(input: HTMLTextAreaElement) {
    if (composing.current) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    lastSelection.current = { start, end };
    const nextCursor =
      start === end && wallMentionAtCursor(input.value, start) ? start : null;
    if (nextCursor !== cursor) setCursor(nextCursor);
    if (nextCursor !== null && selected !== 0) setSelected(0);
  }

  function choose(player: WallMentionPlayer) {
    if (!mention) return;
    const before = value.slice(0, mention.start);
    const after = value.slice(mention.end);
    const token = wallMentionToken(player.pseudo);
    const spacer = !after || /^[\p{L}\p{N}_@-]/u.test(after) ? " " : "";
    const next = before + token + spacer + after;
    if (props.maxLength !== undefined && next.length > props.maxLength) return;
    onChange(next);
    setCursor(null);
    const input = field.current;
    if (!input) return;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    const position =
      before.length +
      token.length +
      spacer.length +
      (after.startsWith(" ") ? 1 : 0);
    requestAnimationFrame(() => {
      if (
        field.current !== input ||
        document.activeElement !== input ||
        input.value !== next
      )
        return;
      lastSelection.current = { start: position, end: position };
      input.setSelectionRange(position, position);
    });
  }

  return (
    <div className="yk-wall-mention-field">
      <textarea
        {...props}
        ref={field}
        value={value}
        aria-controls={active ? listId : undefined}
        aria-activedescendant={activeOption}
        aria-autocomplete="list"
        onChange={event => {
          onChange(event.currentTarget.value);
          trackCaret(event.currentTarget);
        }}
        onClick={event => trackCaret(event.currentTarget)}
        onSelect={event => {
          const input = event.currentTarget;
          if (
            input.selectionStart !== lastSelection.current?.start ||
            input.selectionEnd !== lastSelection.current?.end
          )
            trackCaret(input);
        }}
        onCompositionStart={() => {
          composing.current = true;
          setCursor(null);
        }}
        onCompositionEnd={event => {
          composing.current = false;
          trackCaret(event.currentTarget);
        }}
        onBlur={() => setCursor(null)}
        onKeyDown={event => {
          if (!active || composing.current || event.nativeEvent.isComposing)
            return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setCursor(null);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const offset = event.key === "ArrowDown" ? 1 : -1;
            const index = (selected + offset + players.length) % players.length;
            setSelected(index);
            const list = suggestions.current;
            const option = list?.children.item(index);
            if (list && option) {
              const bounds = list.getBoundingClientRect();
              const row = option.getBoundingClientRect();
              if (row.top < bounds.top) list.scrollTop += row.top - bounds.top;
              if (row.bottom > bounds.bottom)
                list.scrollTop += row.bottom - bounds.bottom;
            }
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            choose(players[selected] ?? players[0]);
          }
        }}
      />
      {active && (
        <div
          ref={suggestions}
          id={listId}
          className="yk-wall-mention-suggestions"
          role="listbox"
          aria-label={t("mentionSuggestions")}
        >
          {players.map((player, index) => (
            <div
              key={player.userId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={selected === index}
              onPointerDown={event => event.preventDefault()}
              onClick={() => choose(player)}
            >
              @{player.pseudo}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
