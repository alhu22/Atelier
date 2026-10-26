import { StrictMode, type PropsWithChildren } from "react";

export function AppProviders({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>;
}
