"use client";

import { useEffect, useRef } from "react";

export function ShowcaseEmbers({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx || !enabled) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      last = -1000,
      visible = false,
      disposed = false;
    let width = 1,
      height = 1;
    const random = (seed: number) => {
      const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return value - Math.floor(value);
    };
    // Small cached glow textures keep the particle pass inexpensive on phones.
    const colors = ["255,102,36", "255,166,64", "255,214,136"];
    const glows = colors.map(color => {
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = 32;
      const brush = sprite.getContext("2d")!;
      const glow = brush.createRadialGradient(16, 16, 0, 16, 16, 16);
      glow.addColorStop(0, `rgba(${color},1)`);
      glow.addColorStop(0.12, `rgba(${color},0.85)`);
      glow.addColorStop(0.32, `rgba(${color},0.24)`);
      glow.addColorStop(1, `rgba(${color},0)`);
      brush.fillStyle = glow;
      brush.fillRect(0, 0, 32, 32);
      return sprite;
    });
    function paint(time: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const count = Math.min(
        180,
        Math.max(42, Math.round((width * height) / 2200))
      );
      ctx.globalCompositeOperation = "lighter";
      for (let index = 0; index < count; index++) {
        const depth = random(index + 9),
          phase = random(index + 37);
        const speed = 9 + depth * 26;
        const progress = (phase + (time * speed) / (height + 40)) % 1;
        const y = height + 20 - progress * (height + 40);
        const sway = Math.sin(time * (0.35 + depth * 0.3) + index * 2.1);
        const x =
          (random(index + 71) * width +
            sway * (9 + depth * 26) +
            Math.sin(time * 0.14 + index) * 14 +
            width) %
          width;
        const flicker = 0.7 + Math.sin(time * (1.7 + depth) + index * 4) * 0.3;
        const fade = Math.min(1, progress * 9, (1 - progress) * 7);
        ctx.globalAlpha = (0.35 + depth * 0.6) * flicker * fade;
        const radius = 2 + depth * depth * 7;
        ctx.drawImage(
          glows[index % 3],
          x - radius,
          y - radius,
          radius * 2,
          radius * 2
        );
        if (depth > 0.68) {
          ctx.strokeStyle = index % 2 ? "#ffb66d" : "#ff7039";
          ctx.lineWidth = 0.65 + depth * 0.6;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - sway * 1.3, y + 2 + depth * 5);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
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
      paint(motion.matches ? 12 : performance.now() / 1000);
      if (visible && !document.hidden && !motion.matches)
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
    resize();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      size.disconnect();
      visibility.disconnect();
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [enabled]);
  return (
    <canvas
      ref={ref}
      className="yk-showcase-embers-canvas"
      aria-hidden="true"
    />
  );
}
