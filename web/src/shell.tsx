import { createContext, useContext } from "react";
import { AddRequest } from "./components/AddSheet";

export type Tab = "home" | "activity" | "plan" | "ask" | "accounts";

export interface Shell {
  tab: Tab;
  go: (t: Tab) => void;
  openAdd: (req?: AddRequest) => void;
}

export const ShellCtx = createContext<Shell>({ tab: "home", go: () => {}, openAdd: () => {} });
export const useShell = () => useContext(ShellCtx);
