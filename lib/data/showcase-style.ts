import type { ProfileStyle } from "@/lib/ui/profile-style";

const STYLE_SAVE_RETRY_DELAY_MS = 2200;

type ProfileStyleFailure = {
  code?: unknown;
  error?: unknown;
};

function waitForStyleSaveWindow() {
  return new Promise<void>(resolve => {
    window.setTimeout(resolve, STYLE_SAVE_RETRY_DELAY_MS);
  });
}

export async function persistProfileStyle(style: ProfileStyle) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("/api/pro/profile-style", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ style })
    });
    if (response.ok) {
      window.dispatchEvent(new Event("yokkai:profile-style-updated"));
      return;
    }

    const failure = (await response
      .json()
      .catch(() => ({}))) as ProfileStyleFailure;
    if (
      failure.code === "PROFILE_STYLE_RATE_LIMITED" &&
      attempt === 0
    ) {
      await waitForStyleSaveWindow();
      continue;
    }
    throw new Error(
      typeof failure.error === "string"
        ? failure.error
        : "Your profile style couldn't be saved. Try again."
    );
  }
}
