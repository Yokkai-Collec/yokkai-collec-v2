export function getSupabaseConfig() {
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // A Dockerized Next server may need a private Supabase address while the
  // browser keeps using the public one. The override is server-only, so it
  // cannot leak an internal hostname into the client bundle.
  const url =
    typeof window === "undefined"
      ? process.env.SUPABASE_SERVER_URL?.trim() || publicUrl
      : publicUrl;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!publicUrl || !url || !key) {
    throw new Error(
      "Renseignez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY dans .env.local."
    );
  }

  return {
    url,
    key,
    cookieName: `sb-${new URL(publicUrl).hostname.split(".")[0]}-auth-token`
  };
}
