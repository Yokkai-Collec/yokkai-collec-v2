"use client";
import { useEffect, useRef } from "react";

/** Decorative procedural atmosphere: no network media, no pointer interception. */
export function ShowcaseAtmosphere({
  scene,
  intensity = 60
}: {
  scene?: string;
  intensity?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (
      !canvas ||
      intensity <= 0 ||
      !["flames", "lightning", "mist", "aurora", "frost"].includes(scene ?? "")
    )
      return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      last = -1000,
      visible = true,
      stopped = false;
    let width = 1,
      height = 1;
    const hash = (x: number, y: number) => {
      let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
    };
    const noise = (x: number, y: number) => {
      const ix = Math.floor(x),
        iy = Math.floor(y);
      let fx = x - ix,
        fy = y - iy;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      return (
        (hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx) * (1 - fy) +
        (hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx) * fy
      );
    };
    const cloud = (x: number, y: number) =>
      noise(x, y) * 0.57 +
      noise(x * 2.03, y * 2.03) * 0.28 +
      noise(x * 4.11, y * 4.11) * 0.15;
    const texture = document.createElement("canvas");
    const textureCtx = texture.getContext("2d");
    function resize() {
      if (!canvas) return;
      const box = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
      texture.width = Math.min(480, Math.max(160, Math.round(width / 2)));
      texture.height = Math.min(180, Math.max(90, Math.round(height / 2)));
      draw(2.5);
    }
    function vaporOrFire(time: number) {
      if (!textureCtx || !ctx) return;
      const w = texture.width,
        h = texture.height;
      const pixels = textureCtx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const v = y / h;
        for (let x = 0; x < w; x++) {
          const u = x / w,
            i = (y * w + x) * 4;
          if (scene === "aurora") {
            const base =
              0.16 +
              Math.sin(u * 6 + time * 0.12) * 0.14 +
              Math.sin(u * 13 - time * 0.08) * 0.035;
            const distance = v - base;
            const curtain = 0.4 + noise(u * 85, time * 0.15) * 0.6;
            const veil =
              Math.exp(-Math.pow((distance - 0.12) / 0.19, 2)) *
              Math.max(0, Math.min(1, distance * 38));
            const purple = (0.5 + 0.5 * Math.sin(u * 9 + time * 0.1)) * 0.85;
            pixels.data[i] = 35 + purple * 140;
            pixels.data[i + 1] = 235 - purple * 130;
            pixels.data[i + 2] = 155 + purple * 90;
            pixels.data[i + 3] = veil * curtain * 155;
          } else {
            const n = cloud(
              u * 4 + time * 0.075,
              v * 3 + cloud(u * 7, v * 4) * 1.5 - time * 0.05
            );
            const ribbons = Math.pow(
              Math.max(0, 1 - Math.abs(n - 0.54) * 4),
              2
            );
            const density = ribbons * (0.12 + v * 0.35);
            pixels.data[i] = 185;
            pixels.data[i + 1] = 205;
            pixels.data[i + 2] = 224;
            pixels.data[i + 3] = density * 255;
          }
        }
      }
      textureCtx.putImageData(pixels, 0, 0);
      ctx.drawImage(texture, 0, 0, width, height);
    }
    function lightning(time: number) {
      if (!ctx) return;
      const cycle = Math.floor(time / 5),
        phase = time % 5;
      const glow =
        0.18 + 0.82 * Math.pow(Math.max(0, Math.sin((phase / 5) * Math.PI)), 5);
      ctx.globalAlpha = glow;
      const sky = ctx.createRadialGradient(
        width * 0.58,
        height * 0.12,
        0,
        width * 0.58,
        height * 0.12,
        width * 0.7
      );
      sky.addColorStop(0, "#839cff30");
      sky.addColorStop(1, "#839cff00");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);
      function bolt(
        seed: number,
        start: number,
        span: number,
        branch = false,
        startY = -12
      ) {
        type Point = [number, number];
        const points: Point[] = [];
        function split(a: Point, b: Point, depth: number, key: number) {
          if (!depth) {
            points.push(a);
            return;
          }
          const middle: Point = [
            (a[0] + b[0]) / 2 +
              (hash(key, seed) - 0.5) * span * Math.pow(0.53, 7 - depth),
            (a[1] + b[1]) / 2
          ];
          split(a, middle, depth - 1, key * 2);
          split(middle, b, depth - 1, key * 2 + 1);
        }
        split(
          [start, startY],
          [
            start + span * (branch ? 1.4 : 0.3),
            branch ? startY + height * 0.4 : height + 12
          ],
          7,
          1
        );
        ctx!.beginPath();
        points.forEach(([x, y], i) =>
          i ? ctx!.lineTo(x, y) : ctx!.moveTo(x, y)
        );
        ctx!.lineJoin = "round";
        ctx!.lineCap = "round";
        ctx!.shadowColor = "#7b9eff";
        ctx!.shadowBlur = branch ? 8 : 20;
        ctx!.strokeStyle = "#739bff";
        ctx!.lineWidth = branch ? 2 : 5;
        ctx!.stroke();
        ctx!.shadowBlur = 6;
        ctx!.strokeStyle = "#eff7ff";
        ctx!.lineWidth = branch ? 0.7 : 1.5;
        ctx!.stroke();
        if (!branch) {
          bolt(seed + 32, points[35][0], span * 0.7, true, points[35][1]);
          bolt(seed + 74, points[72][0], -span * 0.5, true, points[72][1]);
        }
      }
      bolt(cycle + 4, width * 0.17, width * 0.12);
      bolt(cycle + 21, width * 0.83, width * 0.14);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    function draw(time: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      if (scene === "lightning") lightning(time);
      else if (scene === "flames") fire(time);
      else if (scene === "frost") frost(time);
      else vaporOrFire(time);
    }
    function fire(time: number) {
      if (!ctx) return;
      const glow = ctx.createLinearGradient(0, height, 0, 0);
      glow.addColorStop(0, "#ff6c2528");
      glow.addColorStop(0.65, "#ff482b05");
      glow.addColorStop(1, "#ff482b00");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "screen";
      const tongues = Math.min(40, Math.ceil(width / 40));
      for (let i = 0; i < tongues; i++) {
        const base =
          ((i + 0.5) * width) / tongues + Math.sin(time * 0.6 + i) * 9;
        const tall =
          height *
          (0.3 + hash(i, 5) * 0.6) *
          (0.88 + Math.sin(time * 1.7 + i) * 0.12);
        const sway = Math.sin(time * 1.1 + i * 2) * 36;
        const breadth = 12 + hash(i, 9) * 15;
        ctx.beginPath();
        ctx.moveTo(base - breadth, height + 6);
        ctx.bezierCurveTo(
          base - breadth * 1.7,
          height - tall * 0.32,
          base + sway - breadth,
          height - tall * 0.63,
          base + sway * 1.6,
          height - tall
        );
        ctx.bezierCurveTo(
          base + sway * 1.6 - breadth * 0.8,
          height - tall * 0.64,
          base + breadth * 1.9,
          height - tall * 0.42,
          base + breadth,
          height + 6
        );
        const gradient = ctx.createLinearGradient(
          base,
          height,
          base,
          height - tall
        );
        gradient.addColorStop(0, "#fff1ba9c");
        gradient.addColorStop(0.2, "#ffcb6590");
        gradient.addColorStop(0.52, "#ff7b305c");
        gradient.addColorStop(0.84, "#f448252b");
        gradient.addColorStop(1, "#ff5f2800");
        ctx.fillStyle = gradient;
        ctx.shadowColor = "#ff822e";
        ctx.shadowBlur = 9;
        ctx.fill();
        ctx.shadowColor = "#ff762b";
        ctx.shadowBlur = 14;
        ctx.strokeStyle = `rgba(255,181,88,${0.15 + hash(i, 2) * 0.25})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(base - breadth * 0.45, height);
        ctx.bezierCurveTo(
          base + breadth,
          height - tall * 0.2,
          base - breadth,
          height - tall * 0.3,
          base + sway * 0.4,
          height - tall * 0.58
        );
        ctx.bezierCurveTo(
          base + breadth * 0.4,
          height - tall * 0.28,
          base + breadth * 0.6,
          height - tall * 0.16,
          base + breadth * 0.45,
          height
        );
        const core = ctx.createLinearGradient(
          base,
          height,
          base,
          height - tall * 0.58
        );
        core.addColorStop(0, "#fff7d696");
        core.addColorStop(0.55, "#ffe8a844");
        core.addColorStop(1, "#ffcb6500");
        ctx.fillStyle = core;
        ctx.fill();
        const rise = (time * (0.045 + hash(i, 8) * 0.035) + hash(i, 7)) % 1;
        ctx.fillStyle = "#ffd8a1";
        ctx.globalAlpha = Math.sin(rise * Math.PI) * 0.7;
        ctx.beginPath();
        ctx.arc(
          base + Math.sin(rise * 8 + i) * 18,
          height * (1 - rise),
          0.8 + hash(i, 4),
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = "source-over";
    }
    function frost(time: number) {
      if (!ctx) return;
      const haze = ctx.createLinearGradient(0, 0, 0, height);
      haze.addColorStop(0, "#9adfff26");
      haze.addColorStop(0.3, "#8bdfff00");
      haze.addColorStop(0.75, "#8bdfff00");
      haze.addColorStop(1, "#a9eaff36");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);
      // Faceted ice shelves grow inward from both edges, leaving the art clear.
      for (const top of [true, false]) {
        ctx.save();
        if (!top) {
          ctx.translate(0, height);
          ctx.scale(1, -1);
        }
        const shelf = ctx.createLinearGradient(0, 0, 0, height * 0.25);
        shelf.addColorStop(0, "#e2faffc0");
        shelf.addColorStop(0.2, "#91d7f18c");
        shelf.addColorStop(0.65, "#4da0c735");
        shelf.addColorStop(1, "#87dfff00");
        ctx.fillStyle = shelf;
        ctx.strokeStyle = "#c8f4ff85";
        ctx.lineWidth = 0.65;
        const shards = Math.ceil(width / 36);
        for (let i = 0; i < shards; i++) {
          const x = i * 36,
            seed = top ? 13 : 27;
          const length = 19 + hash(i, seed) * Math.min(84, height * 0.23);
          const tip = x + 9 + hash(i, seed + 1) * 22;
          ctx.beginPath();
          ctx.moveTo(x - 10, 0);
          ctx.lineTo(x + 42, 0);
          ctx.lineTo(x + 30, length * 0.3);
          ctx.lineTo(tip, length);
          ctx.lineTo(x + 7, length * 0.43);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x + 19, 0);
          ctx.lineTo(tip, length);
          ctx.lineTo(x + 28, length * 0.29);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x - 10, 12 + hash(i, 3) * 9);
          ctx.lineTo(x + 18, 26 + hash(i, 6) * 10);
          ctx.lineTo(x + 39, 13);
          ctx.stroke();
        }
        ctx.restore();
      }
      function crystal(
        x: number,
        y: number,
        length: number,
        angle: number,
        depth: number
      ) {
        if (!ctx || !depth) return;
        const endX = x + Math.cos(angle) * length,
          endY = y + Math.sin(angle) * length;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
        ctx.lineWidth = depth * 0.28;
        ctx.stroke();
        for (const fraction of [0.45, 0.72]) {
          const bx = x + (endX - x) * fraction,
            by = y + (endY - y) * fraction;
          for (const side of [-1, 1])
            crystal(
              bx,
              by,
              length * 0.32,
              angle + (side * Math.PI) / 3,
              depth - 1
            );
        }
      }
      ctx.strokeStyle = "#d0f4ffb0";
      ctx.shadowColor = "#8edfff";
      ctx.shadowBlur = 5;
      for (let i = 0; i < Math.ceil(width / 95); i++) {
        const x = i * 97 + hash(i, 2) * 45;
        crystal(
          x,
          i % 2 ? 0 : height,
          26 + hash(i, 7) * 64,
          i % 2 ? Math.PI / 2 : -Math.PI / 2,
          3
        );
      }
      ctx.shadowBlur = 0;
      for (let i = 0; i < 38; i++) {
        const fall = (hash(i, 3) + time * 0.018) % 1;
        const x = hash(i, 8) * width + Math.sin(time * 0.25 + i) * 10;
        ctx.globalAlpha = 0.25 + hash(i, 6) * 0.45;
        ctx.fillStyle = "#e5faff";
        ctx.beginPath();
        ctx.arc(x, fall * height, 0.6 + hash(i, 4) * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function tick(now: number) {
      if (stopped) return;
      if (visible && !document.hidden && now - last >= 50) {
        draw(now / 1000);
        last = now;
      }
      if (!motion.matches) frame = requestAnimationFrame(tick);
    }
    const restart = () => {
      cancelAnimationFrame(frame);
      draw(2.5);
      if (!motion.matches) frame = requestAnimationFrame(tick);
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
    });
    resizeObserver.observe(canvas);
    intersection.observe(canvas);
    motion.addEventListener("change", restart);
    resize();
    restart();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      motion.removeEventListener("change", restart);
    };
  }, [scene, intensity]);
  if (!["flames", "lightning", "mist", "aurora", "frost"].includes(scene ?? ""))
    return null;
  return (
    <canvas
      ref={ref}
      className="yk-showcase-atmosphere"
      data-atmosphere={scene}
      style={{ opacity: Math.max(0, Math.min(100, intensity)) / 100 }}
      aria-hidden="true"
    />
  );
}
