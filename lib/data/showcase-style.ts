import type { ProfileStyle } from "@/lib/ui/profile-style";

export async function persistProfileStyle(style: ProfileStyle) {
  const response = await fetch("/api/pro/profile-style", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ style })
  });
  if (!response.ok) throw new Error("Your profile style couldn't be saved. Try again.");
  window.dispatchEvent(new Event("yokkai:profile-style-updated"));
}
