import type { CSSProperties, ReactNode } from "react";
import { CardShell } from "@/components/card-shell";
import "@/styles/event-scene.css";

export function EclipseScene({
  children,
  revealed = false
}: {
  children: ReactNode;
  revealed?: boolean;
}) {
  return (
    <div className="yk-eclipse-scene" data-revealed={revealed}>
      <div className="yk-eclipse-space" aria-hidden="true">
        <span className="yk-eclipse-aura" />
        <span className="yk-eclipse-rays" />
        <span className="yk-eclipse-sun" />
        <span className="yk-eclipse-ring yk-eclipse-ring-outer" />
        <span className="yk-eclipse-ring yk-eclipse-ring-inner" />
        <span className="yk-eclipse-meridian" />
        <span className="yk-eclipse-horizon" />
        {Array.from({ length: 18 }, (_, index) => (
          <i
            className="yk-eclipse-particle"
            key={index}
            style={{ "--particle": index } as CSSProperties}
          />
        ))}
      </div>
      <div className="yk-eclipse-artifact">
        <CardShell>{children}</CardShell>
        <span className="yk-eclipse-artifact-glint" aria-hidden="true" />
      </div>
      <span className="yk-eclipse-shadow" aria-hidden="true" />
    </div>
  );
}
