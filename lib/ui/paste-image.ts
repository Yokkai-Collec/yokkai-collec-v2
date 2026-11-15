import type { ClipboardEvent, DragEvent } from "react";

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

export function allowFileDrop(event: DragEvent) {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

export function dropImage(event: DragEvent, attach: (file: File) => void) {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  const image = Array.from(event.dataTransfer.files).find(file =>
    file.type.startsWith("image/")
  );
  if (image) attach(image);
}
