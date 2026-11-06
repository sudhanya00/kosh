// Ask Kosh's tools: exact lookups and maths over the user's data, so the model reads results
// instead of guessing. Pure functions over settings/transactions/bills — bundled for the server
// (functions/lib/core.js) from the same calculations the app itself uses.
import {
  Cycles, Period, balances, billState, billsIn, budgetRows, cashTotal, friendBalances, monthOf, owed, shiftMonth, summarize,
  utilisation,
} from "./calc";
import { memKey } from "./memory";
import { Bill, SAVINGS_CATEGORIES, Settings, Txn, myShare } from "./model";

export interface KoshData { settings: Settings; txns: Txn[]; bills: Bill[]; today: string }

interface Filters {
  month?: string; // a budget month key "YYYY-MM" (payday-to-payday if the user uses pay cycles)
  from?: string; // YYYY-MM-DD inclusive
  to?: string;
  type?: "Income" | "Expense" | "Transfer";
  categories?: string[];
  account?: string;
  text?: string; // merchant / description / notes contains
  person?: string; // friend in a split, repayment or write-off
  min_amount?: number;
  max_amount?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const lc = (s: string) => s.trim().toLowerCase();

function window(d: KoshData, f: Filters): { from: string; to: string; label: string } {
  if (f.month) {
    const p = new Cycles(d.settings, d.txns).get(f.month);
    return { from: p.start, to: p.end, label: `${f.month} (${p.start} to ${p.end})` };
  }
  const from = f.from || "0000-01-01";
  const to = f.to || d.today;
  return { from, to, label: f.from || f.to ? `${from} to ${to}` : "all time" };
}

function peopleOf(t: Txn): string[] {
  return [...(t.split || []).map((x) => x.person), ...(t.person ? [t.person] : [])];
}

function matches(t: Txn, f: Filters, w: { from: string; to: string }): boolean {
  if (t.date < w.from || t.date > w.to) return false;
  if (f.type && t.type !== f.type) return false;
  if (f.categories?.length && !f.categories.some((c) => lc(c) === lc(t.category))) return false;
  if (f.account && lc(t.from) !== lc(f.account) && lc(t.to) !== lc(f.account)) return false;
  if (f.min_amount != null && t.amount < f.min_amount) return false;
  if (f.max_amount != null && t.amount > f.max_amount) return false;
  if (f.text) {
    const hay = memKey(`${t.description} ${t.notes} ${t.category}`);
    const words = memKey(f.text).split(" ").filter(Boolean);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  if (f.person) {
    const p = lc(f.person);
    if (!peopleOf(t).some((x) => lc(x).includes(p) || p.includes(lc(x)))) return false;
  }
  return true;
}

function row(t: Txn) {
  return {
    date: t.date, type: t.type, from: t.from, to: t.to, category: t.category, description: t.description, amount: t.amount,
    ...(t.split?.length ? { my_share: myShare(t), split: t.split.map((x) => `${x.person} ${x.amount}`).join(", ") } : {}),
    ...(t.person ? { friend: t.person } : {}),
    ...(t.notes ? { notes: t.notes } : {}),
  };
}

// What counts as "your spending": expenses at your share, write-offs included.
const spentValue = (t: Txn) => (t.type === "Expense" ? myShare(t) : 0);

export function findTransactions(d: KoshData, a: Filters & { sort?: string; limit?: number }) {
  const w = window(d, a);
  const list = d.txns.filter((t) => matches(t, a, w));
  const sort = a.sort || "date_desc";
  list.sort((x, y) =>
    sort === "amount_desc" ? y.amount - x.amount : sort === "amount_asc" ? x.amount - y.amount
      : sort === "date_asc" ? x.date.localeCompare(y.date) : y.date.localeCompare(x.date));
  const limit = Math.min(Math.max(a.limit || 30, 1), 100);
  return {
    period: w.label,
    count: list.length,
    total_amount: r2(list.reduce((n, t) => n + t.amount, 0)),
    total_my_spending: r2(list.reduce((n, t) => n + spentValue(t), 0)),
    rows: list.slice(0, limit).map(row),
    ...(list.length > limit ? { note: `Showing ${limit} of ${list.length}. Use summarize for totals.` } : {}),
  };
}

type GroupBy = "month" | "category" | "merchant" | "account" | "person" | "weekday" | "type";
type Metric = "spending" | "income" | "saved" | "amount" | "count" | "net_flow";

export function summarizeBy(d: KoshData, a: Filters & { group_by: GroupBy; metric?: Metric }) {
  const metric: Metric = a.metric || "spending";
  const f: Filters = { ...a };
  if (metric === "spending") f.type = "Expense";
  if (metric === "income") f.type = "Income";
  if (metric === "saved") { f.type = "Transfer"; f.categories = f.categories?.length ? f.categories : SAVINGS_CATEGORIES; }
  if (metric === "net_flow" && !f.account) return { error: "net_flow needs an account." };
  const w = window(d, f);
  const cycles = new Cycles(d.settings, d.txns);
  const groups = new Map<string, { key: string; value: number; count: number }>();
  const add = (key: string, value: number) => {
    const k = memKey(key) || key;
    const g = groups.get(k) ?? { key, value: 0, count: 0 };
    g.value += value;
    g.count += 1;
    groups.set(k, g);
  };
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const t of d.txns) {
    if (!matches(t, f, w)) continue;
    const value = metric === "spending" ? spentValue(t) : metric === "count" ? 1
      : metric === "net_flow" ? (lc(t.to) === lc(f.account!) ? t.amount : 0) - (lc(t.from) === lc(f.account!) ? t.amount : 0)
      : t.amount;
    if (a.group_by === "person") {
      if (t.split?.length) for (const x of t.split) add(x.person, metric === "count" ? 1 : x.amount);
      else if (t.person) add(t.person, metric === "count" ? 1 : t.amount);
      continue;
    }
    const key = a.group_by === "month" ? cycles.keyOf(t.date)
      : a.group_by === "category" ? t.category
      : a.group_by === "merchant" ? t.description || "(no description)"
      : a.group_by === "account" ? (t.type === "Income" ? t.to : t.from)
      : a.group_by === "weekday" ? days[new Date(`${t.date}T00:00:00`).getDay()]
      : t.type;
    add(key, value);
  }
  const list = [...groups.values()].map((g) => ({ ...g, value: r2(g.value) }));
  list.sort((x, y) => (a.group_by === "month" ? x.key.localeCompare(y.key) : y.value - x.value));
  return {
    period: w.label, metric, group_by: a.group_by,
    total: r2(list.reduce((n, g) => n + g.value, 0)),
    groups: list.slice(0, 40),
    ...(list.length > 40 ? { note: `${list.length - 40} smaller groups not shown` } : {}),
  };
}

export function payCycles(d: KoshData, a: { count?: number; ending?: string }) {
  const cycles = new Cycles(d.settings, d.txns);
  const end = a.ending || cycles.keyOf(d.today);
  const n = Math.min(Math.max(a.count || 6, 1), 36);
  return {
    months_run: d.settings.cycle.mode === "payday" ? "payday to payday; named after the month the salary funds" : "calendar months",
    current: cycles.keyOf(d.today),
    cycles: Array.from({ length: n }, (_, i) => {
      const p: Period = cycles.get(shiftMonth(end, -i));
      return { month: p.key, from: p.start, to: p.end, ...(p.estimated ? { estimated: true } : {}) };
    }),
  };
}

export function balancesAsOf(d: KoshData, a: { as_of?: string }) {
  const asOf = a.as_of || d.today;
  const txns = d.txns.filter((t) => t.date <= asOf);
  const b = balances(d.settings, txns);
  return {
    as_of: asOf,
    accounts: d.settings.accounts.filter((x) => !x.archived).map((x) => {
      if (x.kind === "card") {
        const due = owed(b, x.name);
        const u = utilisation(x.limit, due);
        return { name: x.name, kind: "credit card", owed: r2(due), ...(x.limit ? { limit: x.limit, used_pct: Math.round(u!.pct) } : {}) };
      }
      return { name: x.name, kind: x.kind, role: x.role, balance: r2(b[x.name] ?? 0), ...(x.goal ? { goal: x.goal } : {}) };
    }),
    bank_cash_total: r2(cashTotal(d.settings, b)),
    friends_owe_you: friendBalances(txns).map((f) => ({ person: f.person, owed: f.owed, since: f.since })),
  };
}

export function billsFor(d: KoshData, a: { month?: string }) {
  const cycles = new Cycles(d.settings, d.txns);
  const p = cycles.get(a.month || cycles.keyOf(d.today));
  return {
    month: p.key, from: p.start, to: p.end,
    bills: billsIn(d.bills, p).map((x) => ({
      name: x.bill.name, kind: x.bill.kind, due: x.due, amount: x.bill.amount || "varies", pay_from: x.bill.payFrom,
      status: billState(x, d.today),
    })),
  };
}

export function budgetFor(d: KoshData, a: { month?: string }) {
  const cycles = new Cycles(d.settings, d.txns);
  const p = cycles.get(a.month || cycles.keyOf(d.today));
  const s = summarize(d.txns, p);
  return {
    month: p.key, from: p.start, to: p.end,
    income: s.income, income_by_type: s.incomeBy, spent: r2(s.spent), saved: s.saved, left: r2(s.available),
    savings_target: d.settings.savingsTarget,
    categories: budgetRows(d.settings, s).filter((r) => r.planned || r.spent)
      .map((r) => ({ category: r.category, limit: r.planned || null, spent: r2(r.spent), left: r.remaining == null ? null : r2(r.remaining), status: r.status })),
  };
}

// ---- Maths ----

// A small, safe arithmetic evaluator (no eval): + - * / % ^, parentheses, and a few functions.
export function evaluate(expression: string): number {
  const src = expression.replace(/₹|rs\.?|inr/gi, "").replace(/(\d)_(?=\d)/g, "$1");
  const tokens = src.match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z_]+|\*\*|[-+*/%^(),]/gi) || [];
  if (tokens.join("").replace(/\s/g, "").length !== src.replace(/\s/g, "").length) throw new Error("Only numbers, + - * / % ^ ( ) and functions like min, max, round are allowed.");
  let i = 0;
  const peek = () => tokens[i];
  const take = (t?: string) => {
    const v = tokens[i++];
    if (t && v !== t) throw new Error(`Expected ${t}`);
    return v;
  };
  const FN: Record<string, (...x: number[]) => number> = {
    min: Math.min, max: Math.max, round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d, floor: Math.floor, ceil: Math.ceil,
    abs: Math.abs, sqrt: Math.sqrt, log: Math.log, ln: Math.log, log10: Math.log10, exp: Math.exp, pow: Math.pow,
  };
  const CONST: Record<string, number> = { pi: Math.PI, e: Math.E };
  const expr = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") v = take() === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = take();
      const r = power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const power = (): number => {
    const base = unary();
    if (peek() === "^" || peek() === "**") { take(); return base ** power(); }
    return base;
  };
  const unary = (): number => (peek() === "-" ? (take(), -unary()) : peek() === "+" ? (take(), unary()) : primary());
  const primary = (): number => {
    const t = take();
    if (t === undefined) throw new Error("Expression ended early.");
    if (t === "(") { const v = expr(); take(")"); return v; }
    if (/^\d|^\./.test(t)) return Number(t);
    const name = t.toLowerCase();
    if (name in CONST) return CONST[name];
    if (name in FN) {
      take("(");
      const args = [expr()];
      while (peek() === ",") { take(); args.push(expr()); }
      take(")");
      return FN[name](...args);
    }
    throw new Error(`Unknown "${t}".`);
  };
  const v = expr();
  if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}".`);
  if (!Number.isFinite(v)) throw new Error("The result isn't a finite number.");
  return v;
}

export function calculate(a: { expression: string }) {
  try {
    return { expression: a.expression, result: r2(evaluate(a.expression)) };
  } catch (e) {
    return { expression: a.expression, error: (e as Error).message };
  }
}

export function finance(d: KoshData, a: {
  kind: "months_to_goal" | "emi" | "loan_payoff" | "savings_rate";
  target?: number; current?: number; monthly?: number; principal?: number; annual_rate?: number; months?: number; emi?: number;
  income?: number; saved?: number;
}) {
  const n = (x?: number) => Number(x || 0);
  switch (a.kind) {
    case "months_to_goal": {
      const gap = n(a.target) - n(a.current);
      if (gap <= 0) return { months: 0, note: "Already at or above the goal." };
      if (n(a.monthly) <= 0) return { error: "Needs a monthly amount above zero." };
      const months = Math.ceil(gap / n(a.monthly));
      return { gap: r2(gap), months, reached_by_month: shiftMonth(monthOf(d.today), months) };
    }
    case "emi": {
      const P = n(a.principal), m = n(a.months), r = n(a.annual_rate) / 1200;
      if (P <= 0 || m <= 0) return { error: "Needs principal and months." };
      const emi = r === 0 ? P / m : (P * r * (1 + r) ** m) / ((1 + r) ** m - 1);
      return { emi: r2(emi), total_paid: r2(emi * m), total_interest: r2(emi * m - P) };
    }
    case "loan_payoff": {
      const P = n(a.principal), r = n(a.annual_rate) / 1200, e = n(a.emi);
      if (P <= 0 || e <= 0) return { error: "Needs principal and emi." };
      if (r > 0 && e <= P * r) return { error: "That EMI doesn't cover the monthly interest; the loan never ends." };
      const months = r === 0 ? Math.ceil(P / e) : Math.ceil(-Math.log(1 - (r * P) / e) / Math.log(1 + r));
      return { months, paid_off_by_month: shiftMonth(monthOf(d.today), months), total_paid: r2(e * months), total_interest: r2(e * months - P) };
    }
    case "savings_rate": {
      if (n(a.income) <= 0) return { error: "Needs income above zero." };
      return { savings_rate_pct: r2((n(a.saved) / n(a.income)) * 100) };
    }
  }
  return { error: "Unknown kind." };
}

// ---- Declarations the model sees (JSON Schema) ----

const filterProps = {
  month: { type: "string", description: "Budget month key YYYY-MM. Months may run payday to payday; use pay_cycles to see dates." },
  from: { type: "string", description: "Start date YYYY-MM-DD (inclusive). Use instead of month for custom ranges." },
  to: { type: "string", description: "End date YYYY-MM-DD (inclusive). Defaults to today." },
  type: { type: "string", enum: ["Income", "Expense", "Transfer"] },
  categories: { type: "array", items: { type: "string" }, description: "Exact category names" },
  account: { type: "string", description: "Account or card name (matches either side)" },
  text: { type: "string", description: "Words that must all appear in the merchant/description/notes/category, e.g. 'swiggy'" },
  person: { type: "string", description: "Friend name in a split, repayment or write-off" },
  min_amount: { type: "number" },
  max_amount: { type: "number" },
};

export const TOOL_DECLARATIONS = [
  {
    name: "find_transactions",
    description: "List matching transactions (newest first by default) with exact count and totals. Use for 'show me', 'when did I', 'biggest', and checking details.",
    parametersJsonSchema: { type: "object", properties: { ...filterProps,
      sort: { type: "string", enum: ["date_desc", "date_asc", "amount_desc", "amount_asc"] },
      limit: { type: "integer", description: "Rows to return, max 100 (totals always cover all matches)" } } },
  },
  {
    name: "summarize",
    description: "Exact totals grouped by month, category, merchant, account, person, weekday or type over any period. Use for 'how much', 'where does my money go', trends and comparisons. 'spending' counts only the user's share of split bills.",
    parametersJsonSchema: { type: "object", required: ["group_by"], properties: { ...filterProps,
      group_by: { type: "string", enum: ["month", "category", "merchant", "account", "person", "weekday", "type"] },
      metric: { type: "string", enum: ["spending", "income", "saved", "amount", "count", "net_flow"],
        description: "Default spending. net_flow (needs account) = money in minus money out of that account; use it to project an account's balance." } } },
  },
  {
    name: "pay_cycles",
    description: "The user's budget months with their real date ranges (payday to payday when enabled). Use to resolve 'last month', 'last 3 months', etc.",
    parametersJsonSchema: { type: "object", properties: { count: { type: "integer" }, ending: { type: "string", description: "Month key to end at, default current" } } },
  },
  {
    name: "balances",
    description: "Account balances, card amounts owed with limit usage, total bank cash and what friends owe, as of a date (default today).",
    parametersJsonSchema: { type: "object", properties: { as_of: { type: "string", description: "YYYY-MM-DD" } } },
  },
  {
    name: "budget",
    description: "A month's income, spending, savings, money left and each category against its limit.",
    parametersJsonSchema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM, default current" } } },
  },
  {
    name: "bills",
    description: "Bills and subscriptions due in a month with due dates and paid/overdue status.",
    parametersJsonSchema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM, default current" } } },
  },
  {
    name: "calculate",
    description: "Evaluate arithmetic exactly. Use for ANY arithmetic you would otherwise do in your head. No thousands separators: 125000 not 1,25,000.",
    parametersJsonSchema: { type: "object", required: ["expression"], properties: { expression: { type: "string", description: "e.g. (300000-12000)/20000 or round(48320/6, 0)" } } },
  },
  {
    name: "finance",
    description: "Finance formulas: months_to_goal(target, current, monthly), emi(principal, annual_rate %, months), loan_payoff(principal, annual_rate %, emi), savings_rate(income, saved).",
    parametersJsonSchema: { type: "object", required: ["kind"], properties: {
      kind: { type: "string", enum: ["months_to_goal", "emi", "loan_payoff", "savings_rate"] },
      target: { type: "number" }, current: { type: "number" }, monthly: { type: "number" }, principal: { type: "number" },
      annual_rate: { type: "number" }, months: { type: "integer" }, emi: { type: "number" }, income: { type: "number" }, saved: { type: "number" } } },
  },
  {
    name: "search_memory",
    description: "Search by meaning across merchant names, transaction notes and past conversations. Use for fuzzy ideas ('food delivery', 'the gift for mom', 'what did we discuss about my card') — then use find_transactions/summarize with the exact names it returns.",
    parametersJsonSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, kind: { type: "string", enum: ["any", "merchants", "notes", "chats"] } } },
  },
];

// Everything except search_memory runs on the data alone.
export function runTool(d: KoshData, name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "find_transactions": return findTransactions(d, args as unknown as Parameters<typeof findTransactions>[1]);
    case "summarize": return summarizeBy(d, args as unknown as Parameters<typeof summarizeBy>[1]);
    case "pay_cycles": return payCycles(d, args);
    case "balances": return balancesAsOf(d, args);
    case "budget": return budgetFor(d, args);
    case "bills": return billsFor(d, args);
    case "calculate": return calculate(args as unknown as { expression: string });
    case "finance": return finance(d, args as unknown as Parameters<typeof finance>[1]);
  }
  return { error: `Unknown tool ${name}` };
}

// A short orientation the model gets up front (current month, accounts, people) so simple
// questions need no tool call at all.
export function briefing(d: KoshData) {
  const cycles = new Cycles(d.settings, d.txns);
  const p = cycles.get(cycles.keyOf(d.today));
  const s = summarize(d.txns, p);
  const b = balancesAsOf(d, {});
  return {
    today: d.today,
    current_month: { month: p.key, from: p.start, to: p.end, income: s.income, spent: r2(s.spent), saved: s.saved, left: r2(s.available) },
    months_run: d.settings.cycle.mode === "payday" ? "payday to payday" : "calendar",
    accounts: b.accounts, bank_cash_total: b.bank_cash_total, friends_owe_you: b.friends_owe_you,
    savings_target: d.settings.savingsTarget,
    budget_limits: Object.fromEntries(Object.entries(d.settings.budgets).filter(([, v]) => v > 0)),
    people: d.settings.people.map((x) => `${x.name} (${x.relation || x.group})`),
    categories_in_use: [...new Set(d.txns.map((t) => t.category))],
    transactions_total: d.txns.length,
    first_transaction: d.txns.length ? d.txns.reduce((m, t) => (t.date < m ? t.date : m), d.today) : null,
    review_pending: d.txns.filter((t) => t.review).length,
    notes: "Expense amounts are full bills; only the user's share counts as spending. 'Friend repayment' transfers settle IOUs and are not income.",
  };
}

