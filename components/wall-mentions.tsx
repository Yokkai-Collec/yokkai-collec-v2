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
    if (activeOption) {
      document
        .getElementById(activeOption)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [activeOption]);

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
    setCursor(
      input.selectionStart === input.selectionEnd ? input.selectionStart : null
    );
    setSelected(0);
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
    field.current?.focus();
    const position =
      before.length +
      token.length +
      spacer.length +
      (after.startsWith(" ") ? 1 : 0);
    requestAnimationFrame(() =>
      field.current?.setSelectionRange(position, position)
    );
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
          if (event.currentTarget.selectionStart !== cursor)
            trackCaret(event.currentTarget);
        }}
        onBlur={() => setCursor(null)}
        onKeyDown={event => {
          if (!active || event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setCursor(null);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const offset = event.key === "ArrowDown" ? 1 : -1;
            setSelected(
              index => (index + offset + players.length) % players.length
            );
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            choose(players[selected] ?? players[0]);
          }
        }}
      />
      {active && (
        <div
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
