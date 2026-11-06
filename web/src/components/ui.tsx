import {
  ArrowLeftRight, BadgeIndianRupee, Bike, Briefcase, ChevronLeft, ChevronRight, Coins, CreditCard, Fuel, Gift,
  GraduationCap, HandCoins, HeartHandshake, HeartPulse, House, Landmark, Laptop, LucideIcon, Percent, PiggyBank, Plane, Repeat,
  Shapes, ShieldCheck, ShoppingBag, ShoppingBasket, Sofa, TrendingUp, Undo2, UtensilsCrossed, X,
} from "lucide-react";
import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Period, monthLabel, periodRange, shiftMonth } from "../calc";
import { maskText } from "../format";

const CAT_ICONS: Record<string, LucideIcon> = {
  Salary: BadgeIndianRupee, "Side income": Laptop, "Family support": HeartHandshake, "Gifts received": Gift,
  "Interest & dividends": Percent, "Refunds & cashback": Undo2, "Other income": Coins,
  Groceries: ShoppingBasket, "Food & dining": UtensilsCrossed, "Fuel & commute": Fuel, "Rent & utilities": House,
  Household: Sofa, Travel: Plane, "Work travel": Briefcase, Shopping: ShoppingBag, Subscriptions: Repeat,
  Insurance: ShieldCheck, Health: HeartPulse, "Gifts & events": Gift, "Education loan EMI": GraduationCap,
  "Other EMIs": Landmark, Miscellaneous: Shapes,
  "Emergency savings": PiggyBank, "Flexibility savings": PiggyBank, "Bike savings": Bike,
  "Investing transfer": TrendingUp, "Loan funding": Landmark, "Credit card funding": CreditCard,
  "Credit card payment": CreditCard, "Internal transfer": ArrowLeftRight, "Friend repayment": HandCoins,
};

export function CatIcon({ category, size = 18 }: { category: string; size?: number }) {
  const I = CAT_ICONS[category] || Shapes;
  return <I size={size} strokeWidth={1.8} />;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grip" />
        <div className="sheet-h">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Steps through budget months; in payday mode the dates under the name show the actual cycle.
export function MonthPicker({ period, setMonth, payday }: { period: Period; setMonth: (m: string) => void; payday: boolean }) {
  return (
    <div className="month-picker">
      <button className="icon-btn" onClick={() => setMonth(shiftMonth(period.key, -1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
      <span>
        {monthLabel(period.key, "short")}
        {payday && <small title={period.estimated ? "Starts on your usual payday until the salary is logged" : "Starts the day salary landed"}>
          {periodRange(period)}{period.estimated ? "*" : ""}
        </small>}
      </span>
      <button className="icon-btn" onClick={() => setMonth(shiftMonth(period.key, 1))} aria-label="Next month"><ChevronRight size={18} /></button>
    </div>
  );
}

export function Bar({ value, max, tone }: { value: number; max: number; tone?: "over" | "near" | "ok" | "warn" | "bad" | "" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div className={`bar ${tone || ""}`}><span style={{ width: `${pct}%` }} /></div>;
}

export function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      {children}
    </div>
  );
}

// Tiny markdown: paragraphs, "- " bullets and **bold**. Never injects HTML.
export function Markdown({ text: raw }: { text: string }) {
  const text = maskText(raw);
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^([-*•]|\d+\.)\s+(.*)$/);
    if (m) list.push(m[2]);
    else {
      flush();
      if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ""))}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

// ---- Toasts (with an optional action, e.g. Undo) ----

interface Toast { text: string; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(t: Toast) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number>(undefined);
  const show = useCallback((t: Toast) => {
    setToast(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), t.action ? 6000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
