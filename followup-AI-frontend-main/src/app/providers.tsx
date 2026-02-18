"use client";

import { ReactQueryProvider } from "@/lib/ReactQueryProvider";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <ReactQueryProvider>{children}</ReactQueryProvider>;
}
