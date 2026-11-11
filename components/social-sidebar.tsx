"use client";

import { useEffect, useState, type ReactNode } from "react";

export function SocialSidebar({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let previous = Math.max(0, window.scrollY);
    const onScroll = () => {
      const current = Math.max(0, window.scrollY);
      if (current <= 96) {
        setHidden(false);
        previous = current;
      } else if (Math.abs(current - previous) >= 8) {
        setHidden(current > previous);
        previous = current;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <aside className="yk-social-sidebar" data-scroll-hidden={hidden}>
      {children}
    </aside>
  );
}
