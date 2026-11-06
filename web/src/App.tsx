import { Eye, EyeOff, House, List, LucideIcon, MessageCircle, Plus, Target, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AddRequest, AddSheet } from "./components/AddSheet";
import { useData } from "./data";
import { Accounts } from "./screens/Accounts";
import { Activity } from "./screens/Activity";
import { Ask } from "./screens/Ask";
import { Home } from "./screens/Home";
import { Login } from "./screens/Login";
import { Plan } from "./screens/Plan";
import { ShareProcessor } from "./share";
import { ShellCtx, Tab } from "./shell";

const NAV: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "activity", label: "Activity", icon: List },
  { id: "plan", label: "Plan", icon: Target },
  { id: "ask", label: "Ask", icon: MessageCircle },
  { id: "accounts", label: "Accounts", icon: UserRound },
];

const fromHash = (): Tab => {
  const h = location.hash.replace("#/", "") as Tab;
  return NAV.some((n) => n.id === h) ? h : "home";
};

export function App() {
  const { access, synced } = useData();
  const [tab, setTab] = useState<Tab>(fromHash);
  const [add, setAdd] = useState<AddRequest | null>(null);

  useEffect(() => {
    const on = () => setTab(fromHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  const go = useCallback((t: Tab) => {
    location.hash = `/${t}`;
    scrollTo({ top: 0 });
  }, []);
  const openAdd = useCallback((req: AddRequest = {}) => setAdd(req), []);
  const shell = useMemo(() => ({ tab, go, openAdd }), [tab, go, openAdd]);

  if (access !== "ready") return <Login />;

  const Screen = { home: Home, activity: Activity, plan: Plan, ask: Ask, accounts: Accounts }[tab];
  const mobileNav = NAV.filter((n) => n.id !== "accounts");

  return (
    <ShellCtx.Provider value={shell}>
      <div className="app">
        <aside className="sidebar">
          <div className="row-between" style={{ paddingRight: 4 }}>
            <div className="brand"><span className="brand-mark">K</span>Kosh</div>
            <EyeButton />
          </div>
          <button className="btn btn-primary" onClick={() => openAdd()}><Plus size={18} /> Add</button>
          {NAV.map((n) => (
            <button key={n.id} className="side-link" aria-current={tab === n.id ? "page" : undefined} onClick={() => go(n.id)}>
              <n.icon size={19} strokeWidth={1.8} /> {n.label}
            </button>
          ))}
          <div className="spacer" />
          {!synced && <div className="tiny muted row" style={{ gap: 8, padding: "0 12px" }}><i className="sync-dot" /> Saved on this device, syncing…</div>}
        </aside>

        <main className="main">
          <MobileTop tab={tab} go={go} synced={synced} />
          <Screen />
        </main>

        <nav className="tabbar" aria-label="Main">
          {mobileNav.slice(0, 2).map((n) => <TabBtn key={n.id} n={n} tab={tab} go={go} />)}
          <button className="tab-add" onClick={() => openAdd()} aria-label="Add transaction"><Plus size={26} /></button>
          {mobileNav.slice(2).map((n) => <TabBtn key={n.id} n={n} tab={tab} go={go} />)}
        </nav>
      </div>
      <ShareProcessor />
      {add && <AddSheet req={add} onClose={() => setAdd(null)} />}
    </ShellCtx.Provider>
  );
}

function TabBtn({ n, tab, go }: { n: (typeof NAV)[number]; tab: Tab; go: (t: Tab) => void }) {
  return (
    <button className="tab" aria-current={tab === n.id ? "page" : undefined} onClick={() => go(n.id)}>
      <n.icon size={22} strokeWidth={tab === n.id ? 2.2 : 1.8} />
      {n.label}
    </button>
  );
}

// Phone-only strip: brand, the show/hide-amounts eye, and a way into Accounts.
function MobileTop({ tab, go, synced }: { tab: Tab; go: (t: Tab) => void; synced: boolean }) {
  return (
    <div className="mobile-top">
      <div className="brand"><span className="brand-mark">K</span>Kosh{!synced && <i className="sync-dot" title="Syncing" />}</div>
      <div className="row" style={{ gap: 2 }}>
        <EyeButton />
        <button className="icon-btn" aria-label="Accounts & goals" aria-current={tab === "accounts" ? "page" : undefined} onClick={() => go("accounts")}>
          <UserRound size={20} />
        </button>
      </div>
    </div>
  );
}

// Amounts start hidden on every open; this shows them until the app is left again.
function EyeButton() {
  const { hidden, toggleHidden } = useData();
  return (
    <button className="icon-btn" onClick={toggleHidden} aria-pressed={!hidden}
      aria-label={hidden ? "Show amounts" : "Hide amounts"} title={hidden ? "Show amounts" : "Hide amounts"}>
      {hidden ? <EyeOff size={20} /> : <Eye size={20} />}
    </button>
  );
}
