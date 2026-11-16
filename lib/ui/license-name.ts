// Display casing only. Callers keep the original license for IDs, searches and writes.
const acronyms = new Set([
  "AC",
  "DC",
  "DCU",
  "DCEU",
  "MCU",
  "NBA",
  "WNBA",
  "NFL",
  "NHL",
  "MLB",
  "UFC",
  "WWE",
  "WWF",
  "FIFA",
  "F1",
  "F2",
  "KPOP",
  "K-POP",
  "BTS",
  "EXO",
  "NCT",
  "TXT",
  "GOT7",
  "2NE1",
  "AKB0048",
  "D4DJ",
  "TV",
  "DVD",
  "OVA",
  "OVAS",
  "ONA",
  "ONAS",
  "OAD",
  "OADS",
  "CG",
  "CGI",
  "3D",
  "AI",
  "VR",
  "RPG",
  "MMORPG",
  "FPS",
  "WIXOSS",
  "FLCL",
  "BNA",
  "SNAFU",
  "SSSS",
  "SS",
  "GT",
  "DBZ",
  "DBS",
  "DBGT",
  "SAO",
  "SNK",
  "AOT",
  "LOTR",
  "NCIS",
  "CSI",
  "HBO",
  "BBC",
  "NHK",
  "MTV",
  "ESPN",
  "SMT",
  "SMG",
  "PV",
  "PVS",
  "CM",
  "CMS",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
  "XVI",
  "XVII",
  "XVIII",
  "XIX",
  "XX"
]);

export function formatLicenseName(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(
    /[\p{L}\p{N}\p{M}]+(?:['’\-][\p{L}\p{N}\p{M}]+)*/gu,
    word => {
      const upper = word.toLocaleUpperCase("en-US");
      if (acronyms.has(upper)) return upper;
      return word
        .split("-")
        .map(
          part =>
            part.charAt(0).toLocaleUpperCase("en-US") +
            part.slice(1).toLocaleLowerCase("en-US")
        )
        .join("-");
    }
  );
}
