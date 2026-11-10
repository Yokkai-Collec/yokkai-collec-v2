"use client";
import { useEffect, useRef, type CSSProperties } from "react";
import { ShowcaseEmbers } from "@/components/showcase-embers";

/** Decorative atmosphere: photographic fire/ice and procedural sky, all click-through. */
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
    if (!canvas || intensity <= 0 || scene !== "aurora") return;
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
    function vapor(time: number) {
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
    function draw(time: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      vapor(time);
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
  if (scene === "mist")
    return <ShowcaseSecretFogEffect intensity={intensity} />;
  if (scene === "lightning")
    return <ShowcaseLightningEffect intensity={intensity} />;
  if (scene === "feathers")
    return <ShowcaseCelestialFeathersEffect intensity={intensity} />;
  if (scene === "vhs") return <ShowcaseVhsCrtEffect intensity={intensity} />;
  if (scene === "cyber" || scene === "sakura")
    return <ShowcaseParticleEffect kind={scene} intensity={intensity} />;
  if (scene === "embers" || scene === "flames")
    return (
      <>
        <ShowcaseSceneBackdrop scene="embers" />
        <div
          className="yk-showcase-embers"
          data-atmosphere="embers"
          style={{ opacity: Math.max(0, Math.min(100, intensity)) / 100 }}
          aria-hidden="true"
        >
          <ShowcaseEmbers enabled={intensity > 0} />
        </div>
      </>
    );
  if (scene === "frost") return <ShowcaseFrostEffect intensity={intensity} />;
  if (scene !== "aurora") return <ShowcaseSceneBackdrop scene={scene} />;
  return (
    <>
      <ShowcaseSceneBackdrop scene={scene} />
      <canvas
        ref={ref}
        className="yk-showcase-atmosphere"
        data-atmosphere={scene}
        style={{ opacity: Math.max(0, Math.min(100, intensity)) / 100 }}
        aria-hidden="true"
      />
    </>
  );
}

type CelestialFeather = {
  angle: number;
  depth: number;
  fall: number;
  front: boolean;
  horizontal: number;
  opacity: number;
  phase: number;
  seed: number;
  size: number;
  spin: number;
  sway: number;
  x: number;
  y: number;
};

type CelestialDust = {
  alpha: number;
  phase: number;
  radius: number;
  x: number;
  y: number;
};

/**
 * Faithful, canvas-based port of the supplied Plumes célestes demonstration.
 * The rear canvas remains below the real cards; the few foreground feathers
 * are click-through and sit above them to preserve the demonstration's depth.
 */
function ShowcaseCelestialFeathersEffect({ intensity }: { intensity: number }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    const back = backRef.current;
    const front = frontRef.current;
    if (!layer || !back || !front) return;
    const backContext = back.getContext("2d", { alpha: true });
    const frontContext = front.getContext("2d", { alpha: true });
    if (!backContext || !frontContext) return;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const strength = Math.max(0, Math.min(100, intensity)) / 100;
    let width = 1;
    let height = 1;
    let particles: CelestialFeather[] = [];
    let dust: CelestialDust[] = [];
    let frame = 0;
    let last = 0;
    let visible = true;
    let destroyed = false;

    const between = (min: number, max: number) =>
      min + Math.random() * (max - min);
    const createFeather = (initial = false): CelestialFeather => {
      const depth = Math.random();
      const size = between(30, 70) * (0.64 + depth * 1.16);
      return {
        x: between(-width * 0.16, width * 1.12),
        y: initial ? between(-height, height) : between(-height * 0.45, -size),
        size,
        angle: between(-1.5, 1.5),
        spin: between(-0.16, 0.16),
        phase: between(0, 7),
        sway: between(7, 23),
        fall: between(6, 16) * (0.6 + depth * 0.7),
        horizontal: between(-5, 8),
        depth,
        opacity: between(0.27, 0.75) * (0.38 + depth * 0.62),
        front: depth > 0.75,
        seed: between(-10, 10)
      };
    };

    const seedParticles = () => {
      const amount = Math.round((width < 600 ? 9 : 15) + strength * 4);
      particles = Array.from({ length: amount }, () => createFeather(true));
      dust = Array.from(
        { length: Math.max(8, Math.round((width * height) / 3800)) },
        () => ({
          x: between(0, width),
          y: between(0, height),
          radius: between(0.4, 1.6),
          alpha: between(0.14, 0.68),
          phase: between(0, 7)
        })
      );
    };

    const paintFeather = (
      context: CanvasRenderingContext2D,
      feather: CelestialFeather,
      time: number
    ) => {
      const size = feather.size;
      const halfWidth = size * 0.19;
      const sway = Math.sin(time * 0.52 + feather.phase) * feather.sway;
      context.save();
      context.translate(feather.x + sway, feather.y);
      context.rotate(
        feather.angle + Math.sin(time * 0.38 + feather.phase) * 0.3
      );
      context.globalAlpha = feather.opacity * strength;
      const gradient = context.createLinearGradient(
        -halfWidth,
        0,
        halfWidth,
        0
      );
      gradient.addColorStop(0, "#6b6c72");
      gradient.addColorStop(0.3, "#d5d6db");
      gradient.addColorStop(0.53, "#ffffff");
      gradient.addColorStop(0.75, "#dfe1e7");
      gradient.addColorStop(1, "#656971");

      // The two asymmetrical vanes and individual barbs give the feathers
      // their soft, detailed silhouette instead of a flat leaf shape.
      const segments = 46;
      for (const side of [-1, 1]) {
        context.beginPath();
        context.moveTo(0, size * 0.49);
        for (let index = 0; index <= segments; index++) {
          const progress = index / segments;
          const y = size * (0.49 - progress * 0.93);
          const envelope = Math.pow(Math.sin(Math.PI * progress), 0.72);
          const notch =
            (index % 8 === 0 ? 0.79 : 1) *
            (1 + Math.sin(index * 9.2 + feather.seed) * 0.055);
          context.lineTo(
            side * halfWidth * envelope * notch * (side === -1 ? 1.1 : 0.85),
            y
          );
        }
        context.lineTo(0, -size * 0.46);
        context.closePath();
        context.fillStyle = gradient;
        context.fill();
      }

      context.lineCap = "round";
      for (let index = 3; index < 54; index++) {
        const progress = index / 56;
        const y = size * (0.48 - progress * 0.92);
        const envelope = Math.pow(Math.sin(Math.PI * progress), 0.72);
        if (envelope < 0.08) continue;
        for (const side of [-1, 1]) {
          const brokenBarb = index % 13 === 0 ? 0.73 : 1;
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(
            side * halfWidth * envelope * brokenBarb * (side < 0 ? 1.08 : 0.82),
            y + size * 0.055
          );
          context.strokeStyle =
            index % 3 === 0
              ? "rgba(32, 36, 43, 0.43)"
              : "rgba(250, 252, 255, 0.32)";
          context.lineWidth = Math.max(0.35, size * 0.006);
          context.stroke();
        }
      }

      context.beginPath();
      context.moveTo(0, size * 0.62);
      context.quadraticCurveTo(-size * 0.013, 0, 0, -size * 0.46);
      context.lineWidth = Math.max(0.65, size * 0.012);
      context.strokeStyle = "#f2f4f7";
      context.shadowColor = "#ffffff";
      context.shadowBlur = 3;
      context.stroke();
      context.restore();
    };

    const paintDust = (time: number) => {
      for (const particle of dust) {
        backContext.globalAlpha =
          particle.alpha *
          (0.65 + 0.35 * Math.sin(time * 1.4 + particle.phase)) *
          strength;
        backContext.fillStyle = "#f6f7ff";
        backContext.beginPath();
        backContext.arc(
          particle.x,
          particle.y,
          particle.radius,
          0,
          Math.PI * 2
        );
        backContext.fill();
      }
      backContext.globalAlpha = 1;
    };

    const draw = (time: number, delta = 0) => {
      backContext.clearRect(0, 0, width, height);
      frontContext.clearRect(0, 0, width, height);
      paintDust(time);
      for (const feather of particles) {
        if (delta) {
          feather.y += feather.fall * delta;
          feather.x += feather.horizontal * delta;
          feather.angle += feather.spin * delta;
          if (feather.y - feather.size > height + 15) {
            Object.assign(feather, createFeather());
            feather.y = -feather.size;
          }
        }
        paintFeather(feather.front ? frontContext : backContext, feather, time);
      }
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const tick = (now: number) => {
      if (destroyed || !visible || document.hidden || reducedMotion.matches) {
        frame = 0;
        return;
      }
      if (now - last >= 32) {
        const delta = Math.min((now - last) / 1000 || 0.016, 0.05);
        last = now;
        draw(now / 1000, delta);
      }
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (
        !frame &&
        visible &&
        !document.hidden &&
        !reducedMotion.matches &&
        !destroyed
      ) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      const box = layer.getBoundingClientRect();
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      const ratio = Math.min(devicePixelRatio || 1, width < 600 ? 1.5 : 2);
      for (const canvas of [back, front]) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      seedParticles();
      draw(performance.now() / 1000);
    };
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };
    const onMotionChange = () => {
      stop();
      draw(performance.now() / 1000);
      start();
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) start();
      else stop();
    });
    resizeObserver.observe(layer);
    intersection.observe(layer);
    reducedMotion.addEventListener("change", onMotionChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    resize();
    start();
    return () => {
      destroyed = true;
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      reducedMotion.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intensity]);

  return (
    <>
      <div
        ref={layerRef}
        className="yk-showcase-celestial-feathers"
        aria-hidden="true"
      >
        <span className="yk-showcase-celestial-feathers-rays" />
        <canvas ref={backRef} className="yk-showcase-celestial-feathers-back" />
      </div>
      <canvas
        ref={frontRef}
        className="yk-showcase-celestial-feathers-front"
        aria-hidden="true"
      />
    </>
  );
}

/** Faithful V2 cassette treatment: animated grain and short tracking tears. */
function ShowcaseVhsCrtEffect({ intensity }: { intensity: number }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const tearRef = useRef<HTMLCanvasElement>(null);
  // VHS never becomes invisible: the current common slider's 0% is a subtle
  // 20% signal, while the requested visible range is 20–100%.
  const power = 0.2 + Math.max(0, Math.min(100, intensity)) / 125;

  useEffect(() => {
    const layer = layerRef.current;
    const staticCanvas = staticRef.current;
    const tearCanvas = tearRef.current;
    const staticContext = staticCanvas?.getContext("2d", { alpha: true });
    const tearContext = tearCanvas?.getContext("2d", { alpha: true });
    if (
      !layer ||
      !staticCanvas ||
      !tearCanvas ||
      !staticContext ||
      !tearContext
    )
      return;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const random = (min: number, max: number) =>
      min + Math.random() * (max - min);
    let width = 1;
    let height = 1;
    let frame = 0;
    let last = 0;
    let burstUntil = 0;
    let visible = true;
    let destroyed = false;

    const setMotion = () => {
      layer.dataset.motion =
        !destroyed && visible && !document.hidden && !reducedMotion.matches
          ? "running"
          : "paused";
    };
    const clear = () => {
      staticContext.clearRect(0, 0, width, height);
      tearContext.clearRect(0, 0, width, height);
    };
    const draw = (now: number) => {
      staticContext.clearRect(0, 0, width, height);
      tearContext.clearRect(0, 0, width, height);
      const mobile = width < 650;
      const grainCount = Math.round(
        (mobile ? 72 : 150) + power * (mobile ? 120 : 220)
      );
      for (let index = 0; index < grainCount; index++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        staticContext.fillStyle =
          Math.random() > 0.48
            ? "rgba(235, 245, 255, 0.24)"
            : "rgba(0, 0, 0, 0.35)";
        staticContext.fillRect(x, y, random(1, 4), random(1, mobile ? 2 : 3));
      }

      const activeBurst = now < burstUntil || Math.sin(now * 0.00052) > 0.97;
      if (activeBurst) {
        burstUntil = Math.max(burstUntil, now + 320);
        const bands = mobile ? 8 : 15;
        for (let index = 0; index < bands; index++) {
          const y = Math.random() * height;
          const bandHeight = random(1, mobile ? 4 : 6);
          tearContext.fillStyle =
            Math.random() > 0.5
              ? "rgba(216, 242, 255, 0.28)"
              : "rgba(22, 30, 50, 0.55)";
          tearContext.fillRect(
            random(-width * 0.1, 0),
            y,
            width * random(0.5, 1.1),
            bandHeight
          );
          if (Math.random() > 0.5) {
            tearContext.fillStyle = "rgba(247, 73, 100, 0.2)";
            tearContext.fillRect(random(-20, 20), y + 2, width * 0.82, 1);
          }
        }
      } else if (frame % 5 === 0) {
        tearContext.fillStyle = "rgba(196, 224, 250, 0.15)";
        tearContext.fillRect(0, Math.random() * height, width, 1);
      }
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const tick = (now: number) => {
      if (destroyed || !visible || document.hidden || reducedMotion.matches) {
        frame = 0;
        return;
      }
      if (now - last >= 55) {
        last = now;
        draw(now);
      }
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!frame && visible && !document.hidden && !reducedMotion.matches) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      const box = layer.getBoundingClientRect();
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      const ratio = Math.min(devicePixelRatio || 1, width < 650 ? 1.25 : 1.5);
      for (const canvas of [staticCanvas, tearCanvas]) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      draw(performance.now());
    };
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
      setMotion();
    };
    const onMotionChange = () => {
      stop();
      if (reducedMotion.matches) clear();
      else draw(performance.now());
      start();
      setMotion();
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) start();
      else stop();
      setMotion();
    });
    resizeObserver.observe(layer);
    intersection.observe(layer);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.addEventListener("change", onMotionChange);
    resize();
    setMotion();
    start();
    return () => {
      destroyed = true;
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", onMotionChange);
    };
  }, [power]);

  const visualStyle = { "--yk-vhs-power": power } as CSSProperties;
  return (
    <>
      <span
        className="yk-showcase-vhs-crt-backdrop"
        style={{ opacity: 0.38 + power * 0.46 }}
        aria-hidden="true"
      />
      <div
        ref={layerRef}
        className="yk-showcase-vhs-crt"
        style={visualStyle}
        data-motion="paused"
        aria-hidden="true"
      >
        <span className="yk-showcase-vhs-ghost" />
        <span className="yk-showcase-vhs-chromatic" />
        <span className="yk-showcase-vhs-scanlines" />
        <span className="yk-showcase-vhs-phosphor" />
        <span className="yk-showcase-vhs-rolling" />
        <span className="yk-showcase-vhs-tracking" />
        <span className="yk-showcase-vhs-tear" />
        <canvas ref={staticRef} className="yk-showcase-vhs-static" />
        <canvas ref={tearRef} className="yk-showcase-vhs-tear-canvas" />
        <span className="yk-showcase-vhs-noise-pulse" />
        <span className="yk-showcase-vhs-flicker" />
        <span className="yk-showcase-vhs-glare" />
        <span className="yk-showcase-vhs-vignette" />
        <span className="yk-showcase-vhs-osd">
          <b>●</b> REC&nbsp;&nbsp; PAUSE ∥ &nbsp;&nbsp; PLAY ▷ &nbsp;&nbsp; SP
          00:03:24
        </span>
      </div>
    </>
  );
}

function ShowcaseSceneBackdrop({ scene }: { scene?: string }) {
  const backdrop = scene === "flames" ? "embers" : scene;
  if (
    ![
      "velvet",
      "stars",
      "lightning",
      "mist",
      "aurora",
      "embers",
      "frost"
    ].includes(backdrop ?? "")
  ) {
    return null;
  }
  return (
    <span
      className="yk-showcase-effect-background"
      data-showcase-effect-background={backdrop}
      aria-hidden="true"
    />
  );
}

type LightningPoint = { x: number; y: number };
type LightningBolt = { points: LightningPoint[]; thickness: number };
type LightningStrike = {
  bornAt: number;
  life: number;
  bolts: LightningBolt[];
  glow: number;
};
type LightningParticle = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  phase: number;
  violet: boolean;
};

/** Faithful React port of the supplied Foudre showcase effect. */
function ShowcaseLightningEffect({ intensity }: { intensity: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const visibleIntensity =
    intensity <= 1
      ? Math.max(0, intensity)
      : Math.max(0, Math.min(100, intensity)) / 100;
  const effectIntensity =
    intensity <= 1
      ? Math.max(0.35, Math.min(1, intensity))
      : 0.35 + visibleIntensity * 0.65;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const flash = flashRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!container || !canvas || !flash || !context) return;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const random = (min: number, max: number) =>
      min + Math.random() * (max - min);
    const particles: LightningParticle[] = Array.from(
      { length: Math.round(22 + 18 * effectIntensity) },
      () => ({
        x: Math.random(),
        y: Math.random(),
        radius: random(0.4, 2.6),
        alpha: random(0.08, 0.48),
        phase: random(0, Math.PI * 2),
        violet: Math.random() > 0.72
      })
    );
    let width = 1;
    let height = 1;
    let frame = 0;
    let lastFrame = performance.now();
    let nextStrikeAt = 0;
    let flashLevel = 0;
    let visible = true;
    let active = true;
    let strikes: LightningStrike[] = [];
    let queuedStrikes: number[] = [];

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const scheduleStrike = (now: number) => {
      const maxDelay = 1450 - 700 * effectIntensity;
      nextStrikeAt = now + 450 + Math.random() * Math.max(220, maxDelay);
    };
    const generateBolt = (
      startX: number,
      startY: number,
      targetLength: number,
      thickness = 1
    ): LightningBolt => {
      const points: LightningPoint[] = [{ x: startX, y: startY }];
      let x = startX;
      let y = startY;
      const segments = 8 + Math.floor(Math.random() * 8);
      for (let index = 0; index < segments; index++) {
        x += (Math.random() - 0.5) * 52;
        y += targetLength / segments + Math.random() * 14;
        points.push({ x, y });
      }
      return { points, thickness };
    };
    const spawnStrike = (now: number) => {
      const primary = generateBolt(
        Math.random() * width,
        -20 + Math.random() * (height * 0.22),
        height * random(0.55, 0.77)
      );
      const branches: LightningBolt[] = [];
      const branchCount = Math.random() > 0.55 ? 2 : 1;
      for (let index = 0; index < branchCount; index++) {
        const point =
          primary.points[
            Math.max(2, Math.floor(Math.random() * (primary.points.length - 2)))
          ];
        branches.push(
          generateBolt(point.x, point.y, height * random(0.15, 0.33), 0.55)
        );
      }
      strikes.push({
        bornAt: now,
        life: random(170, 350),
        bolts: [primary, ...branches],
        glow: random(0.8, 1.4)
      });
      flashLevel = Math.max(
        flashLevel,
        0.45 + Math.random() * 0.35 * effectIntensity
      );
    };
    const drawAmbient = (now: number) => {
      for (const particle of particles) {
        const pulse =
          0.6 +
          Math.sin(
            now * 0.0009 + (particle.x + particle.y) * 20 + particle.phase
          ) *
            0.4;
        context.beginPath();
        context.fillStyle = particle.violet
          ? `rgba(178, 143, 255, ${particle.alpha * pulse})`
          : `rgba(145, 207, 255, ${particle.alpha * pulse})`;
        context.arc(
          particle.x * width,
          particle.y * height,
          particle.radius + pulse * 0.8,
          0,
          Math.PI * 2
        );
        context.fill();
      }
    };
    const drawStrike = (strike: LightningStrike, now: number) => {
      const life = Math.min((now - strike.bornAt) / strike.life, 1);
      const alpha = life < 0.2 ? 1 : 1 - life;
      for (const bolt of strike.bolts) {
        context.save();
        context.lineJoin = "round";
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(bolt.points[0].x, bolt.points[0].y);
        bolt.points.slice(1).forEach(point => context.lineTo(point.x, point.y));
        context.shadowBlur = 22 * strike.glow;
        context.shadowColor = "rgba(122, 200, 255, 0.95)";
        context.strokeStyle = `rgba(133, 210, 255, ${0.22 * alpha})`;
        context.lineWidth = 10 * bolt.thickness;
        context.stroke();
        context.shadowBlur = 12 * strike.glow;
        context.strokeStyle = `rgba(180, 230, 255, ${0.8 * alpha})`;
        context.lineWidth = 3.6 * bolt.thickness;
        context.stroke();
        context.shadowBlur = 0;
        context.strokeStyle = `rgba(255, 255, 255, ${0.95 * alpha})`;
        context.lineWidth = 1.25 * bolt.thickness;
        context.stroke();
        context.restore();
      }
    };
    const draw = (now: number) => {
      context.clearRect(0, 0, width, height);
      drawAmbient(now);
      strikes = strikes.filter(strike => now - strike.bornAt < strike.life);
      strikes.forEach(strike => drawStrike(strike, now));
      flashLevel *= Math.pow(0.93, Math.min(50, now - lastFrame) / 16.6667);
      flash.style.opacity = String(Math.min(flashLevel, 0.55));
    };
    const tick = (now: number) => {
      if (!active) return;
      lastFrame = now;
      if (visible && !document.hidden && !reducedMotion.matches) {
        if (!nextStrikeAt) scheduleStrike(now);
        if (now >= nextStrikeAt) {
          spawnStrike(now);
          if (Math.random() < effectIntensity * 0.45) {
            queuedStrikes.push(now + random(65, 155));
          }
          scheduleStrike(now);
        }
        queuedStrikes = queuedStrikes.filter(at => {
          if (now >= at) spawnStrike(now);
          return now < at;
        });
        draw(now);
      }
      frame = requestAnimationFrame(tick);
    };
    const observer = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
    });
    observer.observe(container);
    intersection.observe(container);
    resize();
    draw(lastFrame);
    if (!reducedMotion.matches) frame = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
    };
  }, [effectIntensity]);

  return (
    <div
      ref={containerRef}
      className="yk-showcase-lightning-effect"
      data-intensity={effectIntensity.toFixed(2)}
      style={{ opacity: visibleIntensity }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="yk-showcase-lightning-canvas" />
      <div ref={flashRef} className="yk-showcase-lightning-flash" />
    </div>
  );
}

type SecretFogBank = {
  x: number;
  y: number;
  radius: number;
  speed: number;
  phase: number;
  alpha: number;
  vertical: number;
};
type SecretFogHole = {
  element: HTMLElement;
  progress: number;
  target: number;
  x: number;
  y: number;
  width: number;
  height: number;
  returnTimer?: ReturnType<typeof setTimeout>;
};

/**
 * Brume secrète V3. The front canvas is physically cleared around the active
 * card, while the other cards remain behind the dense foreground banks.
 */
function ShowcaseSecretFogEffect({ intensity }: { intensity: number }) {
  const backRef = useRef<HTMLDivElement>(null);
  const backCanvasRef = useRef<HTMLCanvasElement>(null);
  const frontCanvasRef = useRef<HTMLCanvasElement>(null);
  const normalizedIntensity =
    intensity <= 1
      ? Math.max(0, intensity)
      : Math.max(0, Math.min(100, intensity)) / 100;

  useEffect(() => {
    const back = backRef.current;
    const backCanvas = backCanvasRef.current;
    const frontCanvas = frontCanvasRef.current;
    const surface = back?.parentElement;
    const backContext = backCanvas?.getContext("2d", { alpha: true });
    const frontContext = frontCanvas?.getContext("2d", { alpha: true });
    const stage = surface?.querySelector<HTMLElement>(".yk-featured-stage");
    if (
      !back ||
      !surface ||
      !stage ||
      !backCanvas ||
      !frontCanvas ||
      !backContext ||
      !frontContext
    ) {
      return;
    }

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const cardElements = Array.from(stage.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        !element.classList.contains("yk-featured-empty")
    );
    const holes: SecretFogHole[] = cardElements.map(element => ({
      element,
      progress: 0,
      target: 0,
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }));
    cardElements.forEach((element, index) => {
      element.dataset.fogCard = "true";
      element.dataset.fogCardState = "idle";
      element.style.setProperty("--fog-card-delay", `${index * -4.2}s`);
    });

    let width = 1;
    let height = 1;
    let time = 0;
    let lastTime = performance.now();
    let frame = 0;
    let visible = true;
    let mounted = true;
    const makeBank = (layer: 0 | 1): SecretFogBank => ({
      x: Math.random() * 1.7 - 0.35,
      y: layer === 0 ? Math.random() * 0.9 : Math.random() * 0.72 + 0.12,
      radius: (layer === 0 ? 0.28 : 0.34) + Math.random() * 0.25,
      speed: (0.006 + Math.random() * 0.015) * (Math.random() > 0.5 ? 1 : -1),
      phase: Math.random() * Math.PI * 2,
      alpha: (layer === 0 ? 0.1 : 0.18) + Math.random() * 0.17,
      vertical: layer === 0 ? -0.02 : 0.045
    });
    const banks: [SecretFogBank[], SecretFogBank[]] = [
      Array.from({ length: 19 }, () => makeBank(0)),
      Array.from({ length: 34 }, () => makeBank(1))
    ];
    const detailTexture = document.createElement("canvas");
    const detailContext = detailTexture.getContext("2d", { alpha: true });
    const buildDetailTexture = () => {
      if (!detailContext) return;
      detailTexture.width = Math.min(
        720,
        Math.max(360, Math.round(width * 0.72))
      );
      detailTexture.height = Math.min(
        230,
        Math.max(120, Math.round(height * 0.52))
      );
      detailContext.clearRect(0, 0, detailTexture.width, detailTexture.height);
      // Pre-rendered micro-wisps add detail without a per-frame blur/filter.
      for (let index = 0; index < 180; index++) {
        const x = Math.random() * detailTexture.width;
        const y = Math.random() * detailTexture.height;
        const radius = 4 + Math.random() * 28;
        const gradient = detailContext.createRadialGradient(
          x,
          y,
          0,
          x,
          y,
          radius
        );
        const alpha = 0.025 + Math.random() * 0.07;
        gradient.addColorStop(0, `rgba(220,238,255,${alpha})`);
        gradient.addColorStop(0.46, `rgba(175,207,235,${alpha * 0.55})`);
        gradient.addColorStop(1, "rgba(175,207,235,0)");
        detailContext.fillStyle = gradient;
        detailContext.fillRect(
          x - radius,
          y - radius * 0.56,
          radius * 2,
          radius * 1.12
        );
      }
    };

    const updatePositions = () => {
      const surfaceBox = surface.getBoundingClientRect();
      holes.forEach(hole => {
        const cardBox = hole.element.getBoundingClientRect();
        hole.x = cardBox.left - surfaceBox.left + cardBox.width / 2;
        hole.y = cardBox.top - surfaceBox.top + cardBox.height / 2;
        hole.width = cardBox.width;
        hole.height = cardBox.height;
      });
    };
    const resize = () => {
      const box = surface.getBoundingClientRect();
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      const ratio = Math.min(
        devicePixelRatio || 1,
        matchMedia("(max-width: 640px)").matches ? 1.5 : 2
      );
      [backCanvas, frontCanvas].forEach(canvas => {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
      });
      buildDetailTexture();
      updatePositions();
      draw(performance.now(), 0);
    };
    const paint = (context: CanvasRenderingContext2D, layer: 0 | 1) => {
      context.clearRect(0, 0, width, height);
      const color = layer === 0 ? "188,211,233" : "214,226,239";
      const floor = context.createLinearGradient(0, 0, 0, height);
      if (layer === 1) {
        floor.addColorStop(0, "rgba(202,221,241,0)");
        floor.addColorStop(
          0.28,
          `rgba(185,204,226,${0.035 * normalizedIntensity})`
        );
        floor.addColorStop(
          0.55,
          `rgba(205,218,233,${0.12 * normalizedIntensity})`
        );
        floor.addColorStop(
          0.8,
          `rgba(212,225,241,${0.34 * normalizedIntensity})`
        );
        floor.addColorStop(
          1,
          `rgba(224,232,242,${0.65 * normalizedIntensity})`
        );
      } else {
        floor.addColorStop(0, "rgba(144,176,207,0)");
        floor.addColorStop(
          0.38,
          `rgba(150,181,208,${0.09 * normalizedIntensity})`
        );
        floor.addColorStop(
          1,
          `rgba(173,199,219,${0.22 * normalizedIntensity})`
        );
      }
      context.fillStyle = floor;
      context.fillRect(0, 0, width, height);
      for (const bank of banks[layer]) {
        const x = (((bank.x + time * bank.speed + 10) % 1.9) - 0.3) * width;
        const y =
          (bank.y +
            Math.sin(time * 0.17 + bank.phase) * 0.07 +
            bank.vertical * Math.sin(time * 0.27 + bank.phase)) *
          height;
        const radiusX = bank.radius * width;
        const radiusY = bank.radius * (layer === 1 ? 0.47 : 0.64) * height;
        const radius = Math.max(radiusX, radiusY);
        context.save();
        context.translate(x, y);
        context.scale(radiusX / radius, radiusY / radius);
        const gradient = context.createRadialGradient(
          0,
          0,
          radius * 0.01,
          0,
          0,
          radius
        );
        const alpha = Math.min(
          0.55,
          bank.alpha * normalizedIntensity * (layer === 1 ? 1.3 : 1)
        );
        gradient.addColorStop(0, `rgba(${color},${alpha})`);
        gradient.addColorStop(0.28, `rgba(${color},${alpha * 0.88})`);
        gradient.addColorStop(0.54, `rgba(${color},${alpha * 0.48})`);
        gradient.addColorStop(1, `rgba(${color},0)`);
        context.fillStyle = gradient;
        context.fillRect(-radius, -radius, radius * 2, radius * 2);
        context.restore();
      }
      if (detailTexture.width && detailTexture.height) {
        const detailHeight = height * (layer === 1 ? 0.72 : 0.56);
        const detailWidth =
          (detailTexture.width / detailTexture.height) * detailHeight;
        const drift = (time * (layer === 1 ? 13 : -8)) % detailWidth;
        context.save();
        context.globalCompositeOperation = "screen";
        context.globalAlpha = (layer === 1 ? 0.55 : 0.3) * normalizedIntensity;
        for (
          let x = -detailWidth - drift;
          x < width + detailWidth;
          x += detailWidth
        ) {
          context.drawImage(
            detailTexture,
            x,
            height * (layer === 1 ? 0.3 : 0.39),
            detailWidth,
            detailHeight
          );
        }
        context.restore();
      }
      if (layer === 1) {
        const lineY = height * (0.43 + 0.08 * Math.sin(time * 0.31));
        const veil = context.createLinearGradient(
          0,
          lineY - height * 0.22,
          0,
          lineY + height * 0.3
        );
        veil.addColorStop(0, "rgba(231,238,246,0)");
        veil.addColorStop(
          0.43,
          `rgba(220,230,242,${0.19 * normalizedIntensity})`
        );
        veil.addColorStop(
          0.6,
          `rgba(218,231,243,${0.17 * normalizedIntensity})`
        );
        veil.addColorStop(1, "rgba(213,228,240,0)");
        context.fillStyle = veil;
        context.fillRect(0, 0, width, height);
      }
    };
    const drawClearings = (delta: number) => {
      holes.forEach(hole => {
        const rate = hole.target ? 2 : 0.7;
        hole.progress +=
          (hole.target - hole.progress) * (1 - Math.exp(-delta * rate));
        if (hole.progress < 0.006 || !hole.width || !hole.height) return;
        const radius = Math.max(hole.width * 1.22, hole.height * 0.88);
        frontContext.save();
        frontContext.globalCompositeOperation = "destination-out";
        frontContext.translate(hole.x, hole.y);
        frontContext.scale(1.12, 1);
        const gradient = frontContext.createRadialGradient(
          0,
          0,
          radius * 0.18,
          0,
          0,
          radius
        );
        gradient.addColorStop(0, `rgba(0,0,0,${0.97 * hole.progress})`);
        gradient.addColorStop(0.45, `rgba(0,0,0,${0.94 * hole.progress})`);
        gradient.addColorStop(0.77, `rgba(0,0,0,${0.48 * hole.progress})`);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        frontContext.fillStyle = gradient;
        frontContext.beginPath();
        frontContext.arc(0, 0, radius, 0, Math.PI * 2);
        frontContext.fill();
        frontContext.restore();
      });
    };
    const draw = (now: number, delta: number) => {
      paint(backContext, 0);
      paint(frontContext, 1);
      drawClearings(delta || 0.016);
    };
    const canAnimate = () =>
      mounted && visible && !document.hidden && !reducedMotion.matches;
    const tick = (now: number) => {
      frame = 0;
      if (!canAnimate()) return;
      const delta = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      time += delta;
      draw(now, delta);
      frame = requestAnimationFrame(tick);
    };
    const resume = () => {
      if (canAnimate() && !frame) {
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const pause = () => {
      if (!canAnimate() && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const syncMotion = () => {
      if (canAnimate()) resume();
      else pause();
    };
    const reveal = (activeIndex: number) => {
      updatePositions();
      holes.forEach((hole, index) => {
        hole.target = index === activeIndex ? 1 : 0;
        if (hole.returnTimer) clearTimeout(hole.returnTimer);
        if (index === activeIndex) {
          hole.element.dataset.fogCardState = "revealed";
        } else if (hole.element.dataset.fogCardState === "revealed") {
          hole.element.dataset.fogCardState = "returning";
          hole.returnTimer = setTimeout(() => {
            hole.element.dataset.fogCardState = "idle";
          }, 1800);
        }
      });
      resume();
    };
    const cleanups = holes.flatMap((hole, index) => {
      const enter = (event: PointerEvent) => {
        if (event.pointerType !== "touch") reveal(index);
      };
      const leave = (event: PointerEvent) => {
        if (event.pointerType !== "touch") reveal(-1);
      };
      const touch = (event: PointerEvent) => {
        if (event.pointerType === "touch") reveal(index);
      };
      const focus = () => reveal(index);
      const blur = () => reveal(-1);
      hole.element.addEventListener("pointerenter", enter);
      hole.element.addEventListener("pointerleave", leave);
      hole.element.addEventListener("pointerdown", touch);
      hole.element.addEventListener("focusin", focus);
      hole.element.addEventListener("focusout", blur);
      return [
        () => hole.element.removeEventListener("pointerenter", enter),
        () => hole.element.removeEventListener("pointerleave", leave),
        () => hole.element.removeEventListener("pointerdown", touch),
        () => hole.element.removeEventListener("focusin", focus),
        () => hole.element.removeEventListener("focusout", blur)
      ];
    });
    const closeFromSurface = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-fog-card]")
      ) {
        reveal(-1);
      }
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      syncMotion();
    });
    resizeObserver.observe(surface);
    resizeObserver.observe(stage);
    intersection.observe(surface);
    stage.addEventListener("scroll", updatePositions, { passive: true });
    surface.addEventListener("pointerdown", closeFromSurface);
    document.addEventListener("visibilitychange", syncMotion);
    reducedMotion.addEventListener("change", syncMotion);
    resize();
    resume();
    return () => {
      mounted = false;
      cancelAnimationFrame(frame);
      holes.forEach(hole => {
        if (hole.returnTimer) clearTimeout(hole.returnTimer);
        delete hole.element.dataset.fogCard;
        delete hole.element.dataset.fogCardState;
        hole.element.style.removeProperty("--fog-card-delay");
      });
      cleanups.flat().forEach(cleanup => cleanup());
      resizeObserver.disconnect();
      intersection.disconnect();
      stage.removeEventListener("scroll", updatePositions);
      surface.removeEventListener("pointerdown", closeFromSurface);
      document.removeEventListener("visibilitychange", syncMotion);
      reducedMotion.removeEventListener("change", syncMotion);
    };
  }, [normalizedIntensity]);

  return (
    <>
      <div
        ref={backRef}
        className="yk-showcase-secret-fog-back"
        aria-hidden="true"
      >
        <canvas ref={backCanvasRef} />
      </div>
      <canvas
        ref={frontCanvasRef}
        className="yk-showcase-secret-fog-front"
        aria-hidden="true"
      />
    </>
  );
}

type FrostParticle = {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
};

/** V3 keeps the supplied WebP texture intact; only the light atmosphere moves. */
function ShowcaseFrostEffect({ intensity }: { intensity: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const normalizedIntensity =
    intensity <= 1
      ? Math.max(0, intensity)
      : Math.max(0, Math.min(100, intensity)) / 100;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!root || !canvas || !context) return;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 1;
    let height = 1;
    let frame = 0;
    let lastTime = performance.now();
    let visible = true;
    let mounted = true;
    const particleCount = () =>
      Math.round(
        (38 + normalizedIntensity * 46) *
          Math.min(1, Math.max(0.6, width / 720))
      );
    let particles: FrostParticle[] = [];
    const makeParticle = (initial = false): FrostParticle => ({
      x: Math.random(),
      y: initial ? Math.random() : -0.04,
      speed: 0.03 + Math.random() * 0.09,
      size: 0.4 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2
    });
    const resize = () => {
      const rect = root.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles = Array.from({ length: particleCount() }, () =>
        makeParticle(true)
      );
      draw(performance.now());
    };
    const draw = (now: number) => {
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        const shimmer = 0.2 + Math.sin(now * 0.002 + particle.phase) * 0.16;
        context.beginPath();
        context.fillStyle = `rgba(223, 248, 255, ${Math.max(0, shimmer) * normalizedIntensity})`;
        context.arc(
          particle.x * width,
          particle.y * height,
          particle.size,
          0,
          Math.PI * 2
        );
        context.fill();
      }
    };
    const canAnimate = () =>
      mounted && visible && !document.hidden && !reducedMotion.matches;
    const setMotion = () => {
      root.dataset.motion = canAnimate() ? "running" : "paused";
    };
    const tick = (now: number) => {
      frame = 0;
      if (!canAnimate()) return;
      const delta = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      particles = particles.map(particle => {
        const next = {
          ...particle,
          y: particle.y + particle.speed * normalizedIntensity * delta,
          x:
            particle.x + Math.sin(now * 0.0007 + particle.phase) * delta * 0.005
        };
        return next.y > 1.03 ? makeParticle() : next;
      });
      draw(now);
      frame = requestAnimationFrame(tick);
    };
    const resume = () => {
      setMotion();
      if (canAnimate() && !frame) {
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const pause = () => {
      setMotion();
      if (!canAnimate() && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      if (visible) resume();
      else pause();
    });
    resizeObserver.observe(root);
    intersection.observe(root);
    document.addEventListener("visibilitychange", pause);
    reducedMotion.addEventListener("change", pause);
    resize();
    resume();
    return () => {
      mounted = false;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", pause);
      reducedMotion.removeEventListener("change", pause);
    };
  }, [normalizedIntensity]);

  return (
    <div
      ref={rootRef}
      className="yk-showcase-frost-v3"
      data-intensity={normalizedIntensity.toFixed(2)}
      aria-hidden="true"
    >
      <span className="yk-showcase-frost-v3-texture" />
      <span className="yk-showcase-frost-v3-glimmer" />
      <span className="yk-showcase-frost-v3-mist" />
      <canvas ref={canvasRef} className="yk-showcase-frost-v3-particles" />
    </div>
  );
}

type SakuraPetal = {
  x: number;
  y: number;
  size: number;
  vy: number;
  vx: number;
  angle: number;
  spin: number;
  wave: number;
  frequency: number;
  phase: number;
  tilt: number;
  alpha: number;
  tone: number;
};
type Star = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  phase: number;
  frequency: number;
  blue: boolean;
};
type Meteor = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  trail: number;
  width: number;
  alpha: number;
  hue: number;
};

/**
 * Canvas particle layer adapted from the supplied showcase-effects package.
 * It remains click-through, is tied to the real showcase dimensions and is
 * always disposed with its Resize/visibility observers.
 */
function ShowcaseParticleEffect({
  kind,
  intensity
}: {
  kind: "cyber" | "sakura";
  intensity: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const boundedIntensity = Math.max(0, Math.min(100, intensity)) / 100;
    const random = (min: number, max: number) =>
      min + Math.random() * (max - min);
    let width = 1;
    let height = 1;
    let time = 0;
    let lastFrame = 0;
    let frame = 0;
    let running = true;
    let visible = true;
    let meteorClock = 0;
    let petals: SakuraPetal[] = [];
    let stars: Star[] = [];
    let meteors: Meteor[] = [];

    const petalCount = () =>
      Math.round(
        (15 + boundedIntensity * 25) *
          Math.min(1.7, Math.max(0.65, width / 650))
      );
    const makePetal = (initial = false): SakuraPetal => ({
      x: random(-30, width + 30),
      y: initial ? random(-20, height + 20) : -random(12, 80),
      size: random(6, 13.5),
      vy: random(11, 29),
      vx: random(-13, 13),
      angle: random(0, Math.PI * 2),
      spin: random(-1.8, 1.8),
      wave: random(7, 29),
      frequency: random(0.6, 1.35),
      phase: random(0, Math.PI * 2),
      tilt: random(0.65, 1),
      alpha: random(0.83, 1),
      tone: Math.random()
    });
    const makeStar = (): Star => ({
      x: random(0, width),
      y: random(0, height),
      radius: random(0.35, 1.55),
      alpha: random(0.15, 0.66),
      phase: random(0, Math.PI * 2),
      frequency: random(0.7, 1.6),
      blue: Math.random() > 0.65
    });
    const makeMeteor = (initial = false): Meteor => {
      const speed = random(230, 480);
      return {
        x: initial ? random(0, width) : random(-width * 0.26, width * 0.95),
        y: initial ? random(0, height) : random(-height * 0.3, -12),
        vx: speed * random(0.63, 0.95),
        vy: speed * random(0.35, 0.6),
        life: random(0.52, 1.13),
        age: 0,
        trail: random(75, 170),
        width: random(1.5, 3.1),
        alpha: random(0.75, 1),
        hue: [205, 225, 265, 315][Math.floor(random(0, 4))]
      };
    };
    const reseed = () => {
      petals = Array.from({ length: petalCount() }, () => makePetal(true));
      stars = Array.from({ length: 58 }, makeStar);
      meteors = [];
      meteorClock = 0;
      if (kind === "cyber") {
        for (
          let index = 0;
          index < Math.max(3, Math.round(intensity / 15));
          index++
        ) {
          const meteor = makeMeteor(true);
          meteor.age = random(0.08, 0.5);
          meteors.push(meteor);
        }
      }
    };
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      const ratio = Math.min(devicePixelRatio || 1, 1.75);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      reseed();
      draw();
    };
    const drawSakura = () => {
      for (const petal of petals) {
        const x =
          petal.x + Math.sin(time * petal.frequency + petal.phase) * petal.wave;
        context.save();
        context.translate(x, petal.y);
        context.rotate(petal.angle);
        context.scale(
          0.75 + Math.abs(Math.sin(time * 1.1 + petal.phase)) * 0.25,
          petal.tilt
        );
        context.globalAlpha = petal.alpha;
        context.shadowColor = "rgba(255,142,202,.68)";
        context.shadowBlur = 4;
        context.fillStyle =
          petal.tone > 0.72
            ? "#fff8fb"
            : petal.tone > 0.34
              ? "#ffd0e4"
              : "#ff9fcc";
        const size = petal.size;
        context.beginPath();
        context.moveTo(0, -size * 0.95);
        context.bezierCurveTo(
          size * 0.6,
          -size * 0.92,
          size * 0.94,
          -size * 0.21,
          size * 0.42,
          size * 0.43
        );
        context.quadraticCurveTo(size * 0.12, size * 0.87, 0, size * 0.98);
        context.quadraticCurveTo(
          -size * 0.18,
          size * 0.85,
          -size * 0.44,
          size * 0.43
        );
        context.bezierCurveTo(
          -size * 0.94,
          -size * 0.2,
          -size * 0.54,
          -size * 0.95,
          0,
          -size * 0.95
        );
        context.fill();
        context.shadowBlur = 0;
        context.strokeStyle = "rgba(255,255,255,.72)";
        context.lineWidth = 0.7;
        context.stroke();
        context.restore();
      }
    };
    const drawShootingStars = () => {
      for (const star of stars) {
        const alpha =
          star.alpha *
          (0.75 + 0.25 * Math.sin(time * star.frequency * 2 + star.phase));
        context.globalAlpha = alpha;
        context.fillStyle = star.blue ? "#9db8ff" : "#f5f2ff";
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      for (const meteor of meteors) {
        const fade = Math.min(
          1,
          meteor.age / 0.1,
          (meteor.life - meteor.age) / 0.24
        );
        const alpha = Math.max(0, fade) * meteor.alpha;
        const length = Math.hypot(meteor.vx, meteor.vy);
        const x = meteor.vx / length;
        const y = meteor.vy / length;
        const gradient = context.createLinearGradient(
          meteor.x,
          meteor.y,
          meteor.x - x * meteor.trail,
          meteor.y - y * meteor.trail
        );
        gradient.addColorStop(0, `hsla(${meteor.hue},100%,90%,${alpha})`);
        gradient.addColorStop(
          0.18,
          `hsla(${meteor.hue},100%,75%,${alpha * 0.75})`
        );
        gradient.addColorStop(1, `hsla(${meteor.hue},100%,66%,0)`);
        context.beginPath();
        context.moveTo(meteor.x, meteor.y);
        context.lineTo(
          meteor.x - x * meteor.trail,
          meteor.y - y * meteor.trail
        );
        context.strokeStyle = gradient;
        context.lineWidth = meteor.width * 3;
        context.globalAlpha = alpha * 0.18;
        context.lineCap = "round";
        context.stroke();
        context.globalAlpha = 1;
        context.strokeStyle = gradient;
        context.lineWidth = meteor.width;
        context.stroke();
        context.globalAlpha = alpha * 0.95;
        context.fillStyle = "#fefcff";
        context.shadowColor = "rgba(196,222,255,.9)";
        context.shadowBlur = 12;
        context.beginPath();
        context.arc(meteor.x, meteor.y, meteor.width * 1.2, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
        context.globalAlpha = 1;
      }
    };
    const draw = () => {
      context.clearRect(0, 0, width, height);
      if (kind === "sakura") drawSakura();
      else drawShootingStars();
      context.globalAlpha = 1;
    };
    const update = (delta: number) => {
      if (kind === "sakura") {
        petals = petals.map(petal => {
          const next = {
            ...petal,
            y: petal.y + petal.vy * delta,
            x: petal.x + petal.vx * delta,
            angle: petal.angle + petal.spin * delta
          };
          return next.y > height + 35 || next.x < -70 || next.x > width + 70
            ? makePetal()
            : next;
        });
        return;
      }
      meteorClock += delta * (0.5 + boundedIntensity * 5.5);
      while (meteorClock >= 1) {
        meteors.push(makeMeteor());
        meteorClock -= 1;
      }
      meteors = meteors.filter(meteor => {
        meteor.x += meteor.vx * delta;
        meteor.y += meteor.vy * delta;
        meteor.age += delta;
        return (
          meteor.age < meteor.life &&
          meteor.x < width + meteor.trail + 20 &&
          meteor.y < height + meteor.trail + 20
        );
      });
    };
    const tick = (now: number) => {
      if (!running) return;
      const delta = Math.min(0.04, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      if (visible && !document.hidden && !motion.matches) {
        time += delta;
        update(delta);
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    const pause = () => {
      if (document.hidden || motion.matches) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame) {
        lastFrame = performance.now();
        frame = requestAnimationFrame(tick);
      }
      draw();
    };
    const observer = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
    });
    observer.observe(canvas);
    intersection.observe(canvas);
    document.addEventListener("visibilitychange", pause);
    motion.addEventListener("change", pause);
    resize();
    pause();
    return () => {
      running = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", pause);
      motion.removeEventListener("change", pause);
    };
  }, [intensity, kind]);
  return (
    <>
      <span
        className="yk-showcase-effect-background"
        data-showcase-effect-background={kind}
        aria-hidden="true"
      />
      <canvas
        ref={ref}
        className="yk-showcase-atmosphere"
        data-atmosphere={kind}
        aria-hidden="true"
      />
    </>
  );
}
