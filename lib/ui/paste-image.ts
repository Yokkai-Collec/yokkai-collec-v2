import type { ClipboardEvent } from "react";

export function pasteImage(
  event: ClipboardEvent,
  attach: (file: File) => void
) {
  const image =
    Array.from(event.clipboardData.files).find(file =>
      file.type.startsWith("image/")
    ) ??
    Array.from(event.clipboardData.items)
      .find(item => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();
  if (!image) return;
  event.preventDefault();
  attach(image);
}
