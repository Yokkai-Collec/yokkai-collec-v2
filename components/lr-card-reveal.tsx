"use client";
import { useTranslations } from "next-intl";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Card } from "@/lib/data/cards";
import { YokaiCard } from "@/components/yokai-card";
import { LrShinyScenery } from "@/components/lr-shiny-scenery";
import "@/styles/lr-card-reveal.css";

// The reference samples a tiny image once; no canvas participates in playback.
function artworkPalette(pixels: Uint8ClampedArray) {
  const toHsl = (r: number, g: number, b: number) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    const l = (max + min) / 2;
    let h = 0;
    if (delta) {
      h =
        max === r
          ? ((g - b) / delta) % 6
          : max === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4;
      h = (h * 60 + 360) % 360;
    }
    return [h, delta ? delta / (1 - Math.abs(2 * l - 1)) : 0, l];
  };
  const toRgb = (h: number, s: number, l: number) => {
    const a = s * Math.min(l, 1 - l);
    return [0, 8, 4].map(n => {
      const k = (n + h / 30) % 12;
      return Math.round(
        255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
      );
    });
  };
  const bins = Array.from({ length: 36 }, (_, i) => ({
    h: i * 10 + 5,
    weight: 0,
    s: 0,
    l: 0,
    count: 0
  }));
  for (let i = 0; i < pixels.length; i += 12) {
    if (pixels[i + 3] < 135) continue;
    const [h, s, l] = toHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (l < 0.08 || l > 0.96) continue;
    const weight = (0.18 + s) * (0.45 + Math.min(l, 0.82));
    if (s < 0.1) continue;
    const bin = bins[Math.floor(h / 10) % 36];
    bin.weight += weight * (0.45 + s);
    bin.s += s * weight;
    bin.l += l * weight;
    bin.count += weight;
  }
  const chosen: typeof bins = [];
  for (const bin of bins.sort((a, b) => b.weight - a.weight)) {
    if (bin.weight < 0.08) break;
    if (
      chosen.every(
        color =>
          Math.min(
            Math.abs(color.h - bin.h),
            360 - Math.abs(color.h - bin.h)
          ) >= 18
      )
    )
      chosen.push({ ...bin, s: bin.s / bin.count, l: bin.l / bin.count });
    if (chosen.length === 6) break;
  }
  if (!chosen.length) return null;
  while (chosen.length < 6) {
    const first = chosen[0];
    chosen.push({
      ...first,
      h: (first.h + 32 * (chosen.length + 1)) % 360,
      s: Math.max(0.32, first.s * 0.88),
      l: Math.min(0.68, Math.max(0.38, first.l))
    });
  }
  const colors = chosen.map((color, index) =>
    toRgb(
      color.h,
      Math.min(0.84, Math.max(0.38, color.s * 0.98 + 0.08)),
      Math.min(
        0.68,
        Math.max(
          0.36,
          color.l +
            (index === 0 ? 0.06 : index === 1 ? 0.02 : index >= 4 ? -0.02 : 0)
        )
      )
    )
  );
  const contrast = chosen.findIndex(
    (color, index) =>
      index > 0 &&
      Math.min(
        Math.abs(color.h - chosen[0].h),
        360 - Math.abs(color.h - chosen[0].h)
      ) >= 65
  );
  return {
    colors,
    secondary: colors[contrast < 0 ? 1 : contrast]
  };
}

// Final reference timings: four stroke passes, slide/spin, glass, labels, art, impact.
const lines = [
  [13.0, 26.0, 84.0, -14.0],
  [24.0, 18.0, 62.0, 19.0],
  [71.0, 22.0, 73.0, -26.0],
  [63.0, 37.0, 96.0, 11.0],
  [18.0, 51.0, 104.0, -9.0],
  [39.0, 44.0, 58.0, 31.0],
  [77.0, 54.0, 68.0, -18.0],
  [58.0, 66.0, 92.0, 15.0],
  [28.0, 72.0, 74.0, -29.0],
  [9.0, 68.0, 56.0, 12.0],
  [46.0, 24.0, 70.0, -7.0],
  [83.0, 78.0, 54.0, 23.0],
  [15.0, 12.0, 66.0, -18.0],
  [52.0, 11.0, 88.0, 13.0],
  [91.0, 34.0, 68.0, -27.0],
  [33.0, 37.0, 58.0, 24.0],
  [4.0, 58.0, 92.0, -9.0],
  [66.0, 58.0, 81.0, 18.0],
  [49.0, 77.0, 62.0, -34.0],
  [81.0, 84.0, 80.0, 8.0],
  [13.0, 87.0, 54.0, 23.0],
  [73.0, 8.0, 63.0, -8.0],
  [43.0, 91.0, 78.0, 29.0],
  [94.0, 64.0, 52.0, -20.0]
];
const dots = [
  [12.0, 25.0],
  [30.0, 17.0],
  [68.0, 23.0],
  [79.0, 38.0],
  [17.0, 52.0],
  [44.0, 45.0],
  [82.0, 53.0],
  [63.0, 67.0],
  [26.0, 73.0],
  [87.0, 79.0],
  [14.0, 13.0],
  [58.0, 9.0],
  [90.0, 35.0],
  [35.0, 37.0],
  [6.0, 58.0],
  [72.0, 59.0],
  [53.0, 77.0],
  [87.0, 84.0]
];
const phases = [
  [0.048, 0.03257, 0.068, 0.04412, 0.234, 0.203],
  [1.058, 0.01335, 1.079, 0.018, 0.195, 0.179],
  [1.586, 0.01657, 1.607, 0.02241, 0.234, 0.203],
  [2.185, 0.0207, 2.205, 0.02806, 0.203, 0.234]
];
const streaks = [
  [40, -20, 5.6, 0],
  [62, 17, 6.8, -2.1],
  [24, -38, 7.6, -4.1],
  [13, 12, 3.5, -0.1],
  [29, -27, 4.7, -1.6],
  [42, 34, 4.1, -2.6],
  [56, -12, 3.8, -0.9],
  [71, 23, 5.3, -3.2],
  [83, -41, 4.5, -2]
];

export function LrCardReveal({
  card,
  onContinue,
  onRevealStart,
  onReplay,
  autoAdvance = false
}: {
  card: Pick<Card, "name" | "category" | "anime" | "image" | "rarity"> & {
    shiny?: boolean;
    isEvolved?: boolean;
  };
  onContinue?: () => void;
  onRevealStart?: () => void;
  onReplay?: () => void;
  autoAdvance?: boolean;
}) {
  const t = useTranslations("gameUi");
  const ssr = card.rarity === "SSR";
  const shiny = card.rarity === "LR" && !!card.shiny && !card.isEvolved;
  const timing = shiny
    ? { arrival: 21200, artEnd: 24560, end: 29170 }
    : ssr
      ? { arrival: 4214, artEnd: 9920, end: 10030 }
      : { arrival: 5150, artEnd: 10060, end: 14670 };
  const callback = useRef(onContinue);
  const completed = useRef(false);
  const root = useRef<HTMLElement>(null);
  const sampledImage = useRef<HTMLImageElement | null>(null);
  const controlsTimer = useRef<number | undefined>(undefined);
  const [replay, setReplay] = useState(0);
  const [ready, setReady] = useState(false);
  const [entranceSkipped, setEntranceSkipped] = useState(false);
  useEffect(() => {
    callback.current = onContinue;
  }, [onContinue]);
  const advance = () => {
    if (completed.current) return;
    completed.current = true;
    root.current
      ?.getAnimations({ subtree: true })
      .forEach(animation => animation.pause());
    callback.current?.();
  };
  const nextStep = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animations = root.current?.getAnimations({ subtree: true }) ?? [];
    const time = Math.max(
      0,
      ...animations.map(animation => Number(animation.currentTime ?? 0))
    );
    setEntranceSkipped(true);
    if ((time >= timing.arrival && time < timing.artEnd) || time >= timing.end)
      return;
    // Keep every element reveal; after the art finishes, only the bounce remains.
    const target = time < timing.arrival ? timing.arrival : timing.end;
    animations.forEach(animation => {
      animation.currentTime = target;
    });
    window.clearTimeout(controlsTimer.current);
    if (target === timing.end) setReady(true);
    else
      controlsTimer.current = window.setTimeout(
        () => setReady(true),
        timing.end - timing.arrival
      );
  };
  useEffect(() => {
    completed.current = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    controlsTimer.current = window.setTimeout(
      () => setReady(true),
      reduced.matches ? 700 : timing.end
    );
    const element = root.current;
    const animations = element?.getAnimations({ subtree: true }) ?? [];
    return () => {
      window.clearTimeout(controlsTimer.current);
      // StrictMode's simulated cleanup keeps the DOM and its running sequence.
      if (!element?.isConnected)
        animations.forEach(animation => animation.cancel());
    };
  }, [replay, timing.end]);
  useEffect(() => {
    const element = root.current;
    const image = element?.querySelector("img");
    if (!image || sampledImage.current === image) return;
    const release = () => {
      window.clearTimeout(timeout);
      image.removeEventListener("load", sample);
      image.removeEventListener("error", release);
    };
    const timeout = window.setTimeout(release, 5000);
    const sample = () => {
      sampledImage.current = image;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 96;
      try {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 96, 96);
        const palette = artworkPalette(context.getImageData(0, 0, 96, 96).data);
        if (!palette) return;
        element?.style.setProperty(
          "--yk-lr-glass-1",
          palette.colors[0].join(" ")
        );
        element?.style.setProperty(
          "--yk-lr-glass-2",
          palette.secondary.join(" ")
        );
      } catch {
        // Cross-origin artwork can forbid pixel reads; retain the reference's neutral glass.
      } finally {
        canvas.width = canvas.height = 0;
        release();
      }
    };
    image.addEventListener("load", sample, { once: true });
    image.addEventListener("error", release, { once: true });
    if (image.complete && image.naturalWidth > 0) sample();
    return release;
  }, [card.image, replay]);
  useEffect(() => {
    if (!autoAdvance) return;
    let cancelled = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finish = () => {
      if (!cancelled && !completed.current) {
        completed.current = true;
        callback.current?.();
      }
    };
    const element = root.current;
    let animations: Animation[] = [];
    const observe = () => {
      animations = element?.getAnimations({ subtree: true }) ?? [];
      // The first dialog is still closed during the child's mount effect.
      if (!animations.length) return;
      element?.removeEventListener("animationstart", observe);
      void Promise.all(
        animations
          .filter(
            animation =>
              animation.effect?.getComputedTiming().iterations !== Infinity
          )
          .map(animation => animation.finished)
      ).then(finish, () => {});
    };
    element?.addEventListener("animationstart", observe);
    if (reduced.matches) finish();
    else observe();
    const motionChanged = () => {
      if (reduced.matches) finish();
    };
    reduced.addEventListener("change", motionChanged);
    return () => {
      cancelled = true;
      element?.removeEventListener("animationstart", observe);
      if (!element?.isConnected)
        animations.forEach(animation => animation.cancel());
      reduced.removeEventListener("change", motionChanged);
    };
  }, [autoAdvance]);
  return (
    <section
      key={replay}
      ref={root}
      className={`yk-lr-reveal yk-card-cinematic yk-card-cinematic-clean${ssr ? " yk-card-cinematic-ssr" : shiny ? " yk-card-cinematic-shiny" : ""}`}
      aria-label={`${shiny ? "LR Shiny" : ssr ? "SSR" : "LR"} cinematic: ${card.name}`}
    >
      {shiny ? (
        <LrShinyScenery streaks={streaks} />
      ) : (
        <div className="yk-lr-world" aria-hidden="true" />
      )}
      <div className="yk-lr-intro" aria-hidden="true" />
      <div className="yk-lr-traits" aria-hidden="true">
        {phases.map(
          (
            [lineStart, lineStep, dotStart, dotStep, lineDuration, dotDuration],
            phase
          ) => (
            <div className={`yk-lr-phase yk-lr-phase-${phase}`} key={phase}>
              {lines.map(([x, y, width, angle], index) => (
                <i
                  key={`l${index}`}
                  className="yk-lr-stroke"
                  style={
                    {
                      left: `${x}%`,
                      top: `${y}%`,
                      width: `${width}px`,
                      "--rot": `${angle}deg`,
                      animationDelay: `${(lineStart + lineStep * index).toFixed(3)}s`,
                      animationDuration: `${lineDuration}s`
                    } as CSSProperties
                  }
                />
              ))}
              {dots.map(([x, y], index) => (
                <i
                  key={`d${index}`}
                  className="yk-lr-dot"
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    animationDelay: `${(dotStart + dotStep * index).toFixed(3)}s`,
                    animationDuration: `${dotDuration}s`
                  }}
                />
              ))}
            </div>
          )
        )}
      </div>
      {!ssr && !shiny && (
        <div className="yk-lr-finale" aria-hidden="true">
          {streaks.map(([top, angle, duration, delay], index) => (
            <i
              className="yk-lr-streak"
              key={index}
              style={
                {
                  top: `${top}%`,
                  "--angle": `${angle}deg`,
                  animationDuration: `${duration}s`,
                  animationDelay: `${delay}s`
                } as CSSProperties
              }
            />
          ))}
          {Array.from({ length: 24 }, (_, index) => (
            <i
              className="yk-lr-glitter"
              key={`g${index}`}
              style={{
                left: `${(index * 37 + 19) % 100}%`,
                top: `${(index * 23 + 34) % 100}%`,
                animationDelay: `${index * 0.091}s`
              }}
            />
          ))}
          {Array.from({ length: 50 }, (_, index) => (
            <i
              className="yk-lr-confetti"
              key={`c${index}`}
              style={
                {
                  left: `${(index * 31 + 7) % 100}%`,
                  "--drift": `${((index % 7) - 3) * 17}px`,
                  animationDelay: `${3.354 + (index % 12) * 0.17}s`,
                  animationDuration: `${3.5 + (index % 5) * 0.4}s`
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      {!ssr && !shiny && (
        <div className="yk-lr-floor" aria-hidden="true">
          {Array.from({ length: 24 }, (_, index) => (
            <i
              key={index}
              style={{
                left: `${(index * 37 + 11) % 100}%`,
                bottom: `${index % 4}px`,
                transform: `rotate(${index * 29}deg)`,
                animationDelay: `${6.854 + (index % 12) * 0.17}s`
              }}
            />
          ))}
        </div>
      )}
      <div
        className="yk-lr-stage"
        onAnimationStart={event => {
          if (
            (shiny && event.animationName === "yk-shiny-final-card") ||
            (event.animationName === "yk-lr-finale-in" &&
              event.target === event.currentTarget)
          )
            onRevealStart?.();
          if (shiny && event.animationName === "yk-shiny-final-card")
            setEntranceSkipped(true);
        }}
      >
        {[0, 1, 2].map(index => (
          <i
            key={index}
            className={`yk-lr-corner yk-lr-corner-${index}`}
            aria-hidden="true"
          />
        ))}
        <div
          className="yk-lr-float"
          onAnimationEnd={event => {
            if (!shiny && event.animationName === "yk-lr-card-slide-in") {
              setEntranceSkipped(true);
              onRevealStart?.();
            }
            if (event.animationName === "yk-lr-art-window")
              setEntranceSkipped(false);
          }}
        >
          {!ssr && (
            <div
              className={shiny ? "yk-shiny-card-edge" : "yk-lr-edge"}
              aria-hidden="true"
            />
          )}
          <div className="yk-lr-spin">
            <YokaiCard
              {...card}
              rarity={ssr ? "SSR" : "LR"}
              animated={false}
              hideFirstLrBadge={!ready}
              imageLoading={shiny ? "eager" : undefined}
            />
            <div className="yk-lr-glass" aria-hidden="true" />
          </div>
        </div>
      </div>
      {onContinue && (
        <button
          type="button"
          className="yk-lr-skip"
          aria-label={t("skipCardEntrance")}
          disabled={entranceSkipped || ready}
          onClick={nextStep}
        />
      )}
      {!autoAdvance && (
        <nav
          className={`yk-lr-end-controls${ready ? " yk-lr-ready" : ""}`}
          aria-label={t("revealActions")}
          inert={!ready}
        >
          <button
            type="button"
            onClick={() => {
              onReplay?.();
              setReady(false);
              setEntranceSkipped(false);
              setReplay(value => value + 1);
            }}
          >
            {t("replay")}
          </button>
          {onContinue && (
            <button type="button" onClick={advance}>
              {t("revealNext")}
            </button>
          )}
        </nav>
      )}
    </section>
  );
}
