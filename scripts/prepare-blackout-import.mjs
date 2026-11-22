import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const cards = JSON.parse(
  readFileSync(new URL("../data/blackout-cards.json", import.meta.url), "utf8")
).map(card => ({
  ...card,
  image:
    card.artwork ??
    `/assets/events/blackout/cards/${card.id.slice("blackout-".length)}.webp`
}));

const artwork = await Promise.allSettled(
  cards.map(async ({ image }) => {
    const metadata = await sharp(
      fileURLToPath(new URL(`../public${image}`, import.meta.url))
    ).metadata();
    if (metadata.format !== "webp") throw new Error("Expected WebP");
  })
);
const missing = cards.filter(
  (_, index) => artwork[index].status === "rejected"
);

if (missing.length > 0) {
  process.stderr.write(
    `Illustrations Blackout manquantes ou invalides :\n${missing.map(card => `public${card.image}`).join("\n")}\n`
  );
  process.exitCode = 1;
} else {
  const literal = value => "'" + value.replaceAll("'", "''") + "'";
  const values = cards
    .map(
      ({ id, name, anime, image }) =>
        `  ('manual', ${literal(id)}, ${literal(name)}, 'ANIME/MANGA', ${literal(anime)}, 'LR', ${literal(image)}, true)`
    )
    .join(",\n");
  const expected = cards
    .map(
      ({ id, name, image }) =>
        `    (${literal(id)}, ${literal(name)}, ${literal(image)})`
    )
    .join(",\n");
  process.stdout.write(`begin;

insert into public.cards
  (source, source_id, nom, categorie, franchise, rarete_base, image_url, event_only)
values
${values}
on conflict (source, source_id) do update
set nom = excluded.nom, image_url = excluded.image_url
where cards.event_only and cards.rarete_base = 'LR'
  and (cards.nom, cards.image_url) is distinct from (excluded.nom, excluded.image_url);

do $$
begin
  if exists (
    select 1
    from (values
${expected}
    ) as expected(source_id, nom, image_url)
    where not exists (
      select 1 from public.cards c
      where c.source = 'manual' and c.source_id = expected.source_id
        and c.nom = upper(expected.nom) and c.image_url = expected.image_url
        and c.event_only and c.rarete_base = 'LR'
    )
  ) then
    raise exception 'Blackout source IDs conflict with an existing card';
  end if;
end;
$$;

commit;
`);
}
