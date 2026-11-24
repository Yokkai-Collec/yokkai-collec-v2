"use client";

import { useEffect, useRef } from "react";

const random = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

function paintCardEmbers(
  ctx: CanvasRenderingContext2D,
  glows: HTMLCanvasElement[],
  width: number,
  height: number,
  time: number
) {
  const scale = Math.min(1.25, Math.max(0.8, width / 135));
  ctx.save();
  for (let index = 0; index < 28; index++) {
    const depth = random(index + 11);
    const duration = 2.5 + depth * 2.4;
    const age = (time / duration + random(index + 54)) % 1;
    const rise =
      height * (0.2 + (1 - depth) * 0.42 + random(index + 37) * 0.21);
    const origin = random(index + 72);
    const side = index % 2 ? 1 : -1;
    // Most cinders rise from either edge. A few drift across the middle.
    const start =
      width * (index % 5 === 0 ? origin : 0.5 + side * (0.19 + origin * 0.24));
    const drift = width * (0.04 + depth * 0.12) * -side;
    const phase = random(index + 95) * Math.PI * 2;
    const x = start + age * drift + Math.sin(age * 6 + phase) * (4 + depth * 6);
    const y = height * 0.89 - age * rise;
    const fade = Math.min(1, age * 17, (1 - age) * 4.7);
    const heat = (1 - age) * (0.86 + Math.sin(time * 8 + phase) * 0.14);
    const size = scale * (0.95 + depth * depth * 2.65);
    const bloom = size * 4;

    ctx.globalAlpha = fade * heat * 0.83;
    ctx.drawImage(glows[index % 2], x - bloom, y - bloom, bloom * 2, bloom * 2);

    const rotation = phase + time * side * (0.8 + depth * 1.3);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(0.62 + Math.abs(Math.sin(rotation)) * 0.38, 1);
    ctx.globalAlpha = fade;
    ctx.fillStyle = `hsl(${4 + heat * 23} 91% ${20 + heat * 42}%)`;
    ctx.strokeStyle = "#4e170c";
    ctx.lineWidth = 0.58;
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.15);
    ctx.lineTo(-size * 0.65, -size * (0.36 + depth * 0.5));
    ctx.lineTo(size * 0.32, -size * 0.77);
    ctx.lineTo(size * 0.84, size * 0.01);
    ctx.lineTo(size * 0.36, size * 0.69);
    ctx.lineTo(-size * 0.44, size * 0.56);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();

    // The exposed face glows while the darker edge tumbles around it.
    ctx.globalAlpha = fade * heat;
    ctx.fillStyle = "#fff1bb";
    ctx.beginPath();
    ctx.moveTo(-size * 0.62, -size * 0.12);
    ctx.lineTo(-size * 0.3, -size * 0.55);
    ctx.lineTo(size * 0.47, -size * 0.35);
    ctx.lineTo(size * 0.05, -size * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export function ShowcaseEmbers({
  enabled = true,
  onCard = false
}: {
  enabled?: boolean;
  onCard?: boolean;
}) {
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
      if (onCard) {
        paintCardEmbers(ctx, glows, width, height, time);
        return;
      }
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
  }, [enabled, onCard]);
  return (
    <canvas
      ref={ref}
      className="yk-showcase-embers-canvas"
      aria-hidden="true"
    />
  );
}
