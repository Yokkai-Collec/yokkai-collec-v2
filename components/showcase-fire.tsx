"use client";

import { useEffect, useRef } from "react";

/** Animate photographic frames, never geometric flame silhouettes. */
export function ShowcaseFire({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx || !enabled) return;
    const texture = new Image();
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      last = -1000,
      visible = false,
      ready = false,
      disposed = false;
    let width = 1,
      height = 1;
    function paint(time: number) {
      if (!ready || !ctx || !canvas) return;
      ctx.clearRect(0, 0, width, height);
      const cellWidth = texture.width / 4,
        cellHeight = texture.height / 4;
      const count = Math.max(2, Math.ceil(width / 350));
      const step = width / count;
      // Overlapping, independently phased fire beds hide the texture boundaries.
      for (let index = -1; index <= count; index++) {
        const position = time * (9 + ((index + 2) % 3)) + (index + 2) * 3.7;
        const current = Math.floor(position) % 16,
          blend = position % 1;
        const center = (index + 0.5) / count;
        const lowCenter = 1 - Math.exp(-Math.pow((center - 0.5) * 5, 2)) * 0.25;
        const tileWidth = Math.max(step * 1.4, 240);
        const tileHeight =
          Math.min(height, (tileWidth * cellHeight) / cellWidth) *
          (0.78 + ((index + 4) % 3) * 0.08) *
          lowCenter;
        for (let layer = 0; layer < 2; layer++) {
          const tile = (current + layer) % 16;
          ctx.globalAlpha = layer ? blend : 1 - blend;
          ctx.drawImage(
            texture,
            (tile % 4) * cellWidth + 3,
            Math.floor(tile / 4) * cellHeight + 3,
            cellWidth - 6,
            cellHeight - 6,
            index * step - (tileWidth - step) / 2,
            height - tileHeight,
            tileWidth,
            tileHeight
          );
        }
      }
      ctx.globalAlpha = 1;
      canvas.dataset.ready = "true";
    }
    function tick(now: number) {
      if (disposed || !visible || document.hidden || motion.matches) return;
      if (now - last >= 1000 / 30) {
        paint(now / 1000);
        last = now;
      }
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame);
      paint(motion.matches ? 0 : performance.now() / 1000);
      if (ready && visible && !document.hidden && !motion.matches)
        frame = requestAnimationFrame(tick);
    }
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      sync();
    };
    const size = new ResizeObserver(resize);
    const visibility = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      sync();
    });
    size.observe(canvas);
    visibility.observe(canvas);
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    texture.onload = () => {
      if (!disposed) {
        ready = true;
        resize();
      }
    };
    texture.src = "/images/showcase-fire-flipbook.webp";
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      texture.onload = null;
      size.disconnect();
      visibility.disconnect();
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [enabled]);
  return (
    <canvas ref={ref} className="yk-showcase-fire-canvas" aria-hidden="true" />
  );
}
