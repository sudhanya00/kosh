// The spreadsheet's formulas, as functions — over pay cycles instead of calendar months.
// A cycle is keyed "YYYY-MM" by the month it funds: salary landing on 30 Oct opens "2026-11".
import {
  AccountSets, Bill, CATEGORIES, Draft, FRIENDS, REPAY, SAVINGS_CATEGORIES, Settings, Txn, emptyDraft, isRepayment, isWriteOff,
  myShare, pad, todayISO,
} from "./model";
import { inr } from "./format";

export const monthOf = (date: string) => date.slice(0, 7);
export const currentMonth = () => monthOf(todayISO());

export function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function monthLabel(m: string, style: "long" | "short" = "long"): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-IN", { month: style, year: "numeric" });
}

export function daysInMonth(m: string): number {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo, 0).getDate();
}

const dayIn = (m: string, day: number) => `${m}-${pad(Math.min(day, daysInMonth(m)))}`;

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ---- Pay cycles ----

export interface Period {
  key: string; // the month it funds
  start: string; // inclusive
  end: string; // inclusive
  estimated: boolean; // start came from "usual payday", not a logged salary
}

// Salary on/after the 15th funds next month; earlier funds this month.
export const fundsMonth = (date: string) => (Number(date.slice(8)) >= 15 ? shiftMonth(monthOf(date), 1) : monthOf(date));

export class Cycles {
  private salary = new Map<string, string>();
  constructor(private settings: Settings, txns: Txn[]) {
    for (const t of txns) {
      if (t.type !== "Income" || t.category !== "Salary") continue;
      const k = fundsMonth(t.date);
      const cur = this.salary.get(k);
      if (!cur || t.date < cur) this.salary.set(k, t.date);
    }
  }

  get payday() {
    return this.settings.cycle.mode === "payday";
  }

  private start(key: string): { date: string; estimated: boolean } {
    if (!this.payday) return { date: `${key}-01`, estimated: false };
    const s = this.salary.get(key);
    if (s) return { date: s, estimated: false };
    const d = this.settings.cycle.paydayDay || 1;
    return { date: d >= 15 ? dayIn(shiftMonth(key, -1), d) : dayIn(key, d), estimated: true };
  }

  get(key: string): Period {
    const s = this.start(key);
    return { key, start: s.date, end: addDays(this.start(shiftMonth(key, 1)).date, -1), estimated: s.estimated };
  }

  keyOf(date: string): string {
    const m = monthOf(date);
    for (const k of [shiftMonth(m, 1), m, shiftMonth(m, -1)]) {
      const p = this.get(k);
      if (date >= p.start && date <= p.end) return k;
    }
    return m;
  }
}

export const inPeriod = (t: { date: string }, p: Period) => t.date >= p.start && t.date <= p.end;

export function periodRange(p: Period) {
  return `${shortDate(p.start)} – ${shortDate(p.end)}`;
}

// ---- Summaries ----

export interface Summary {
  income: number;
  spent: number;
  saved: number;
  available: number; // income - spent - saved (cash-flow, not a balance forecast)
  byCategory: Record<string, number>;
  incomeBy: Record<string, number>;
  savedBy: Record<string, number>;
  count: number;
}

export function summarize(txns: Txn[], p: Period): Summary {
  const s: Summary = { income: 0, spent: 0, saved: 0, available: 0, byCategory: {}, incomeBy: {}, savedBy: {}, count: 0 };
  for (const t of txns) {
    if (!inPeriod(t, p)) continue;
    s.count++;
    if (t.type === "Income") {
      s.income += t.amount;
      s.incomeBy[t.category] = (s.incomeBy[t.category] || 0) + t.amount;
    } else if (t.type === "Expense") {
      // Split bills count only your share; friends' parts are money they owe you.
      const mine = myShare(t);
      s.spent += mine;
      if (mine) s.byCategory[t.category] = (s.byCategory[t.category] || 0) + mine;
    } else if (SAVINGS_CATEGORIES.includes(t.category)) {
      s.saved += t.amount;
      s.savedBy[t.category] = (s.savedBy[t.category] || 0) + t.amount;
    }
  }
  s.available = s.income - s.spent - s.saved;
  return s;
}

// All-time balance: opening + money in - money out (sheet's "Calculated balance").
// Cards go negative as you spend: -balance is what you owe.
export function balances(settings: Settings, txns: Txn[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of settings.accounts) out[a.name] = a.opening;
  for (const t of txns) {
    if (t.to in out) out[t.to] += t.amount;
    if (t.from in out) out[t.from] -= t.amount;
  }
  return out;
}

export function cashTotal(settings: Settings, b: Record<string, number>) {
  return settings.accounts.filter((a) => a.kind !== "card" && !a.archived).reduce((n, a) => n + (b[a.name] || 0), 0);
}

export const owed = (b: Record<string, number>, card: string) => Math.max(0, -(b[card] || 0));

export function cardsOwed(settings: Settings, b: Record<string, number>) {
  return settings.accounts.filter((a) => a.kind === "card").reduce((n, a) => n + owed(b, a.name), 0);
}

// Share of the credit limit in use; under 30% is the usual healthy mark.
export function utilisation(limit: number, used: number): { pct: number; tone: "ok" | "warn" | "bad" } | null {
  if (!(limit > 0)) return null;
  const pct = (used / limit) * 100;
  return { pct, tone: pct < 30 ? "ok" : pct < 70 ? "warn" : "bad" };
}

export interface BudgetRow {
  category: string;
  planned: number;
  spent: number;
  remaining: number | null;
  status: "unset" | "ok" | "near" | "over";
}

export function budgetRows(settings: Settings, s: Summary): BudgetRow[] {
  return CATEGORIES.Expense.map((category) => {
    const planned = settings.budgets[category] || 0;
    const spent = s.byCategory[category] || 0;
    const status: BudgetRow["status"] =
      planned === 0 ? "unset" : spent > planned ? "over" : spent >= planned * 0.85 && spent < planned ? "near" : "ok";
    return { category, planned, spent, remaining: planned ? planned - spent : null, status };
  });
}

// ---- Bills ----

export function billDueIn(b: Bill, m: string): boolean {
  if (b.frequency === "Monthly") return true;
  const diff = monthsBetween(b.anchor, m);
  if (b.frequency === "One-off") return diff === 0;
  if (diff < 0) return false;
  return b.frequency === "Quarterly" ? diff % 3 === 0 : diff % 12 === 0;
}

// One occurrence of a bill inside a cycle. `mark` is the calendar month its marks are stored under.
export interface BillDue { bill: Bill; mark: string; due: string | null }

export function billsIn(bills: Bill[], p: Period): BillDue[] {
  const out: BillDue[] = [];
  for (const bill of bills) {
    if (bill.dueDay == null) {
      if (billDueIn(bill, p.key)) out.push({ bill, mark: p.key, due: null });
      continue;
    }
    for (const m of new Set([monthOf(p.start), monthOf(p.end)])) {
      if (!billDueIn(bill, m)) continue;
      const due = dayIn(m, bill.dueDay);
      if (due >= p.start && due <= p.end) out.push({ bill, mark: m, due });
    }
  }
  return out.sort((a, b) => (a.due ?? "9") .localeCompare(b.due ?? "9") || a.bill.name.localeCompare(b.bill.name));
}

export type BillState = "paid" | "scheduled" | "overdue" | "due" | "auto";

export function billState({ bill, mark, due }: BillDue, today = todayISO()): BillState {
  const m = bill.marks?.[mark];
  if (m === "Paid") return "paid";
  if (m === "Scheduled") return "scheduled";
  if (bill.autoDebit === "Yes") return "auto";
  const late = due ? today > due : mark < monthOf(today);
  return late ? "overdue" : "due";
}

export function daysUntil(due: string | null, today = todayISO()): number | null {
  if (!due) return null;
  return Math.round((new Date(`${due}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
}

// The transaction a bill payment should create (EMIs are spending; a card bill is a transfer).
export function billDraft(acc: AccountSets, { bill, due }: BillDue): Draft {
  const today = todayISO();
  const date = due && due < today ? due : today;
  if (bill.kind === "Credit Card") {
    return { ...emptyDraft(acc, "Transfer", date), from: bill.payFrom, to: bill.payTo || acc.cards[0] || "",
      category: "Credit card payment", description: `${bill.name} bill`, amount: bill.amount };
  }
  return { ...emptyDraft(acc, "Expense", date), from: bill.payFrom, category: bill.category || "Miscellaneous",
    description: bill.name, amount: bill.amount };
}

// ---- Payday checklist (the sheet's "what to do each payday", ticked off from real data) ----

export interface PaydayStep { label: string; done: boolean; hint: string; draft: Draft; due?: BillDue }

export function paydaySteps(settings: Settings, acc: AccountSets, txns: Txn[], p: Period, s: Summary, dues: BillDue[]): PaydayStep[] {
  const inP = txns.filter((t) => inPeriod(t, p));
  const today = todayISO();
  const steps: PaydayStep[] = [
    { label: "Salary logged", done: inP.some((t) => t.type === "Income" && t.category === "Salary"),
      hint: `Record the salary credit as Income into ${acc.primary}.`,
      draft: { ...emptyDraft(acc, "Income", today), description: "Salary" } },
  ];
  if (settings.savingsTarget > 0) {
    const reserve = settings.accounts.find((a) => !a.archived && a.kind === "bank" && a.goal > 0)?.name;
    steps.push({ label: `Saved ${inr(settings.savingsTarget)}`, done: s.saved >= settings.savingsTarget,
      hint: "Move savings to a reserve account as a Transfer.",
      draft: { ...emptyDraft(acc, "Transfer", today), to: reserve ?? acc.own[1] ?? acc.primary, category: "Emergency savings",
        amount: Math.max(0, settings.savingsTarget - s.saved), description: "Monthly savings" } });
  }
  for (const d of dues.filter((x) => x.bill.kind === "EMI")) {
    const b = d.bill;
    if (b.payFrom !== acc.primary && acc.money.includes(b.payFrom)) {
      steps.push({ label: `${inr(b.amount)} sent to ${b.payFrom} for ${b.name}`,
        done: inP.some((t) => t.type === "Transfer" && t.to === b.payFrom && t.category === "Loan funding"),
        hint: `Transfer ${acc.primary} → ${b.payFrom}, category Loan funding.`,
        draft: { ...emptyDraft(acc, "Transfer", today), to: b.payFrom, category: "Loan funding", amount: b.amount, description: `${b.name} money` } });
    }
    steps.push({ label: `${b.name} paid`, done: b.marks?.[d.mark] === "Paid" || inP.some((t) => t.type === "Expense" && t.category === b.category && t.from === b.payFrom),
      hint: `Log it as an Expense from ${b.payFrom}.`, draft: billDraft(acc, d), due: d });
  }
  return steps;
}

// ---- Friends: who owes you what (like Splitwise balances) ----

export interface FriendBalance {
  person: string; // display name as first written
  owed: number; // > 0 they owe you; < 0 you've been overpaid
  since: string | null; // date the current unpaid stretch began
  lastCategory: string; // category of their latest split, for write-offs
}

const personKey = (p: string) => p.trim().toLowerCase().replace(/\s+/g, " ");

export function friendBalances(txns: Txn[]): FriendBalance[] {
  const map = new Map<string, FriendBalance>();
  const get = (p: string) => {
    const k = personKey(p);
    if (!map.has(k)) map.set(k, { person: p.trim(), owed: 0, since: null, lastCategory: "Miscellaneous" });
    return map.get(k)!;
  };
  // Oldest first, so "since" tracks when each friend last went from settled to owing.
  for (const t of [...txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)))) {
    const moves: [string, number][] = [];
    if (t.type === "Expense" && t.split?.length) {
      for (const x of t.split) moves.push([x.person, x.amount]);
    }
    if (t.person && (isRepayment(t) || isWriteOff(t))) moves.push([t.person, -t.amount]);
    for (const [p, delta] of moves) {
      if (!p?.trim()) continue;
      const f = get(p);
      const before = f.owed;
      f.owed = Math.round((f.owed + delta) * 100) / 100;
      if (delta > 0) f.lastCategory = t.category;
      if (before <= 0 && f.owed > 0) f.since = t.date;
      if (f.owed <= 0) f.since = null;
    }
  }
  return [...map.values()].filter((f) => Math.abs(f.owed) >= 1).sort((a, b) => b.owed - a.owed);
}

export function knownPeople(txns: Txn[]): string[] {
  const seen = new Map<string, string>();
  for (const t of txns) {
    for (const p of [...(t.split || []).map((x) => x.person), t.person || ""]) {
      if (p?.trim() && !seen.has(personKey(p))) seen.set(personKey(p), p.trim());
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function repaymentDraft(acc: AccountSets, f: FriendBalance): Draft {
  return { ...emptyDraft(acc, "Transfer"), from: FRIENDS, to: acc.primary, category: REPAY, person: f.person,
    amount: Math.max(0, f.owed), description: `${f.person} paid back` };
}

export function writeOffDraft(acc: AccountSets, f: FriendBalance): Draft {
  return { ...emptyDraft(acc, "Expense"), from: FRIENDS, category: f.lastCategory, person: f.person,
    amount: Math.max(0, f.owed), description: `${f.person}'s share (not paid back)`, notes: "Written off" };
}

// ---- Compact snapshot sent to the AI with each question ----

export function snapshot(settings: Settings, cycles: Cycles, txns: Txn[], bills: Bill[], p: Period) {
  const b = balances(settings, txns);
  const keys = Array.from({ length: 6 }, (_, i) => shiftMonth(p.key, -i));
  return {
    budgetMonthsRun: cycles.payday ? "payday to payday (a month is named after the month the salary funds)" : "calendar months",
    selectedMonth: { key: p.key, from: p.start, to: p.end },
    accounts: settings.accounts.filter((a) => !a.archived).map((a) => ({
      name: a.name, type: a.kind, role: a.role, balance: Math.round(b[a.name] ?? 0),
      ...(a.kind === "card" ? { owed: Math.round(owed(b, a.name)), limit: a.limit || undefined } : { goal: a.goal || undefined }),
      guidance: a.guidance || undefined,
    })),
    monthlySavingsTarget: settings.savingsTarget,
    budgets: Object.fromEntries(Object.entries(settings.budgets).filter(([, v]) => v > 0)),
    months: keys.map((k) => {
      const pp = cycles.get(k);
      const s = summarize(txns, pp);
      return { month: k, from: pp.start, to: pp.end, income: s.income, incomeByCategory: s.incomeBy, spent: s.spent,
        saved: s.saved, available: s.available, spentByCategory: s.byCategory, transactions: s.count };
    }),
    billsThisMonth: billsIn(bills, p).map((d) => ({
      name: d.bill.name, kind: d.bill.kind, due: d.due, amount: d.bill.amount, payFrom: d.bill.payFrom, status: billState(d),
    })),
    friendsOweYou: friendBalances(txns).map((f) => ({ person: f.person, owed: f.owed, since: f.since })),
    people: settings.people.map((p) => ({ name: p.name, is: p.relation || p.group })),
    note: "Expense amounts are the full bill; when split, only 'mine' counts as the user's spending and the rest is owed by friends. 'Friend repayment' transfers and write-offs settle what friends owe.",
    recentTransactions: txns.slice(0, 80).map((t) => [t.date, t.type, t.from, t.to, t.category, t.description, t.amount,
      t.split?.length ? `split, mine ${myShare(t)}: ${t.split.map((x) => `${x.person} ${x.amount}`).join(", ")}` : t.person ? `friend: ${t.person}` : ""].join(" | ")),
  };
}
