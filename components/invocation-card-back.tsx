"use client";

import { createContext, useContext, type ReactNode } from "react";

const InvocationCardBackContext = createContext<string | null>(null);

export function InvocationCardBackProvider({
  back,
  children
}: {
  back: string | null;
  children: ReactNode;
}) {
  return (
    <InvocationCardBackContext.Provider value={back}>
      {children}
    </InvocationCardBackContext.Provider>
  );
}

export function useInvocationCardBack() {
  return useContext(InvocationCardBackContext);
}
