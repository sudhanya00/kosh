// Shapes and starting values. The defaults are lifted from the original spreadsheet
// ("YOUR MONEY SYSTEM"): three bank accounts with three roles and a credit card. Accounts are
// user-editable; everything else reads them from Settings rather than hard-coding names.

export type TxnType = "Income" | "Expense" | "Transfer";

export interface Txn {
  id: string;
  date: string; // YYYY-MM-DD
  type: TxnType;
  from: string;
  to: string;
  category: string;
  description: string;
  amount: number; // always positive
  notes: string;
  ref?: string; // UPI ref / UTR, used to skip duplicates
  split?: Share[] | null; // Expense paid for a group: friends' shares (amount still owes the full bill)
  person?: string | null; // repayments and write-offs: the friend it settles
  review?: boolean; // logged automatically from a share; not yet checked by the user
  source?: "manual" | "ai" | "bill" | "share";
  createdAt?: number;
}

export type Draft = Omit<Txn, "id" | "createdAt" | "source"> & { assumption?: string };

export interface Share { person: string; amount: number }

export type AccountKind = "bank" | "card" | "cash";

export interface Account {
  name: string;
  kind: AccountKind;
  role: string;
  opening: number;
  goal: number; // banks: reserve goal (0 = none)
  limit: number; // cards: credit limit (0 = not set)
  guidance: string;
  hints: string; // how it appears in UPI apps / SMS: last 4 digits, UPI IDs, bank name
  archived?: boolean;
}

// What Kosh has learned from the user's own corrections and confirmations.
export interface Person { name: string; group: "family" | "friend" | "other"; relation: string } // relation: "Mother", "Flatmate"…
export interface MerchantRule { name: string; type: TxnType; category: string }

export interface Settings {
  accounts: Account[];
  people: Person[];
  merchants: MerchantRule[];
  savingsTarget: number;
  budgets: Record<string, number>;
  cycle: { mode: "payday" | "calendar"; paydayDay: number };
  aiNotes: string; // free-form rules the AI follows ("payments from Rakesh are from Dad")
}

export type BillKind = "EMI" | "Credit Card" | "Subscription" | "Insurance" | "Utility" | "Other";
export type BillFrequency = "Monthly" | "Quarterly" | "Annual" | "One-off";
export type BillMark = "Paid" | "Scheduled";

export interface Bill {
  id: string;
  name: string;
  kind: BillKind;
  dueDay: number | null;
  amount: number;
  payFrom: string;
  payTo?: string; // credit-card bills: the card being paid off
  autoDebit: "Yes" | "No" | "Check";
  frequency: BillFrequency;
  anchor: string; // YYYY-MM of a month it's due; drives quarterly/annual/one-off
  category: string;
  notes: string;
  marks: Record<string, BillMark>; // calendar YYYY-MM of the due date -> mark
}

export const EXTERNAL = "External";
// Not a real account: the pool of money friends owe you. Splits add to it, repayments
// (Transfer Friends → bank) and write-offs (Expense from Friends) draw it down.
export const FRIENDS = "Friends";
export const REPAY = "Friend repayment";

export const KIND_LABEL: Record<AccountKind, string> = { bank: "Bank account", card: "Credit card", cash: "Cash / wallet" };

export const CATEGORIES: Record<TxnType, string[]> = {
  Income: [
    "Salary", "Side income", "Family support", "Gifts received", "Interest & dividends", "Refunds & cashback", "Other income",
  ],
  Expense: [
    "Groceries", "Food & dining", "Fuel & commute", "Rent & utilities", "Household", "Travel",
    "Work travel", "Shopping", "Subscriptions", "Insurance", "Health", "Gifts & events",
    "Education loan EMI", "Other EMIs", "Miscellaneous",
  ],
  Transfer: [
    "Emergency savings", "Flexibility savings", "Bike savings", "Investing transfer",
    "Loan funding", "Credit card funding", "Credit card payment", "Internal transfer", REPAY,
  ],
};

// Transfers in these categories count as "saved" on the dashboard (same as the sheet).
export const SAVINGS_CATEGORIES = ["Emergency savings", "Flexibility savings", "Bike savings", "Investing transfer"];

export const BILL_KINDS: BillKind[] = ["EMI", "Credit Card", "Subscription", "Insurance", "Utility", "Other"];
export const FREQUENCIES: BillFrequency[] = ["Monthly", "Quarterly", "Annual", "One-off"];

const DEFAULT_AI_NOTES = `Kotak is my default for UPI, debit card and anything that doesn't name a bank.
Kotak → PNB to cover the loan is "Loan funding"; the ₹8,000 EMI itself is an Expense from PNB, "Education loan EMI".
Kotak → PNB to save is "Emergency savings"; Kotak → Axis to save is "Flexibility savings"; Kotak → Axis for the card bill is "Credit card funding".
Money from my parents is "Family support".`;

export function newAccount(kind: AccountKind, name = ""): Account {
  return { name, kind, role: "", opening: 0, goal: 0, limit: 0, guidance: "", hints: "" };
}

export const DEFAULT_SETTINGS: Settings = {
  accounts: [
    { ...newAccount("bank", "Kotak"), role: "Salary + spending",
      guidance: "Salary, regular bills, everyday purchases. Keep a month-of-bills buffer." },
    { ...newAccount("bank", "PNB"), role: "Emergency reserve", goal: 300000,
      guidance: "₹1 lakh accessible + ₹2 lakh breakable FDs. Must also cover the next ₹8,000 EMI." },
    { ...newAccount("bank", "Axis"), role: "Flexibility reserve", goal: 220000,
      guidance: "₹2 lakh available + ₹20,000 minimum balance. Card bills are extra." },
    { ...newAccount("card", "Axis Credit Card"), role: "Credit card",
      guidance: "Card purchases are spending; paying the bill is a transfer." },
  ],
  savingsTarget: 20000,
  budgets: Object.fromEntries(
    CATEGORIES.Expense.map((c) => [c, c === "Education loan EMI" ? 8000 : c === "Other EMIs" ? 5500 : 0]),
  ),
  cycle: { mode: "payday", paydayDay: 30 },
  aiNotes: DEFAULT_AI_NOTES,
  people: [],
  merchants: [],
};

// Fill in fields added after a user's settings were first saved.
export function normalizeSettings(d: Partial<Settings> | undefined): Settings {
  const accounts = (d?.accounts ?? DEFAULT_SETTINGS.accounts).map((a) => ({
    ...newAccount(a.kind ?? (/credit card/i.test(a.name) ? "card" : "bank")), ...a,
  }));
  return {
    accounts,
    savingsTarget: d?.savingsTarget ?? DEFAULT_SETTINGS.savingsTarget,
    budgets: { ...DEFAULT_SETTINGS.budgets, ...d?.budgets },
    cycle: { ...DEFAULT_SETTINGS.cycle, ...d?.cycle },
    aiNotes: d?.aiNotes ?? DEFAULT_SETTINGS.aiNotes,
    people: d?.people ?? [],
    merchants: d?.merchants ?? [],
  };
}

// ---- Account lists, derived from settings ----

export interface AccountSets {
  all: Account[]; // including archived (for balances and old transactions)
  own: string[]; // active, any kind
  money: string[]; // active banks + cash: can receive income / pay bills
  cards: string[]; // active cards
  primary: string; // default account when nothing is named
}

export function accountSets(s: Settings): AccountSets {
  const active = s.accounts.filter((a) => !a.archived);
  const money = active.filter((a) => a.kind !== "card").map((a) => a.name);
  return {
    all: s.accounts,
    own: active.map((a) => a.name),
    money,
    cards: active.filter((a) => a.kind === "card").map((a) => a.name),
    primary: money[0] ?? active[0]?.name ?? "",
  };
}

export function defaultBills(anchor: string): Omit<Bill, "id">[] {
  return [
    { name: "Education loan EMI", kind: "EMI", dueDay: null, amount: 8000, payFrom: "PNB", autoDebit: "Yes",
      frequency: "Monthly", anchor, category: "Education loan EMI", marks: {},
      notes: "PNB needs EMI money beyond the emergency reserve." },
    { name: "Other EMIs", kind: "EMI", dueDay: null, amount: 5500, payFrom: "Kotak", autoDebit: "Check",
      frequency: "Monthly", anchor, category: "Other EMIs", marks: {},
      notes: "Estimate. Replace with the exact combined monthly amount." },
    { name: "Axis Credit Card", kind: "Credit Card", dueDay: null, amount: 0, payFrom: "Axis", payTo: "Axis Credit Card",
      autoDebit: "Check", frequency: "Monthly", anchor, category: "Credit card payment", marks: {},
      notes: "Pay the FULL statement balance. Fund Axis from Kotak first." },
  ];
}

export function emptyDraft(acc: AccountSets, type: TxnType = "Expense", date = todayISO()): Draft {
  const other = acc.own.find((a) => a !== acc.primary) ?? acc.primary;
  return {
    date, type, amount: 0, description: "", notes: "",
    from: type === "Income" ? EXTERNAL : acc.primary,
    to: type === "Expense" ? EXTERNAL : type === "Income" ? acc.primary : other,
    category: type === "Income" ? "Salary" : type === "Expense" ? "Groceries" : "Emergency savings",
  };
}

// Keep from/to/category consistent when the type changes.
export function retype(acc: AccountSets, d: Draft, type: TxnType): Draft {
  if (d.type === type) return d;
  const base = emptyDraft(acc, type, d.date);
  const fromOk = acc.own.includes(d.from);
  return {
    ...d, type, split: type === "Expense" ? d.split : null, person: null,
    from: type === "Income" ? EXTERNAL : fromOk ? d.from : base.from,
    to: type === "Expense" ? EXTERNAL
      : type === "Income" ? (acc.money.includes(d.to) ? d.to : base.to)
      : acc.own.includes(d.to) && d.to !== (fromOk ? d.from : base.from) ? d.to : base.to,
    category: CATEGORIES[type].includes(d.category) ? d.category : base.category,
  };
}

export const splitTotal = (d: { split?: Share[] | null }) => (d.split || []).reduce((n, x) => n + (x.amount || 0), 0);

// What a transaction costs *you*: the full bill minus friends' shares.
export const myShare = (t: { type: TxnType; amount: number; split?: Share[] | null }) =>
  t.type === "Expense" ? Math.max(0, t.amount - splitTotal(t)) : 0;

export const isRepayment = (d: Pick<Draft, "type" | "category">) => d.type === "Transfer" && d.category === REPAY;
export const isWriteOff = (d: Pick<Draft, "type" | "from">) => d.type === "Expense" && d.from === FRIENDS;

export function validate(acc: AccountSets, d: Draft): string | null {
  const known = acc.all.map((a) => a.name);
  if (!(d.amount > 0)) return "Enter an amount above zero.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "Pick a date.";
  if (!CATEGORIES[d.type].includes(d.category)) return `Pick a ${d.type.toLowerCase()} category.`;
  if (isRepayment(d) || isWriteOff(d)) {
    if (!d.person?.trim()) return "Which friend?";
    if (isRepayment(d) && !known.includes(d.to)) return "Which account did it land in?";
    return null;
  }
  if (d.type === "Expense" && !known.includes(d.from)) return "Which account paid?";
  if (d.type === "Income" && !known.includes(d.to)) return "Which account received it?";
  if (d.type === "Transfer") {
    if (!known.includes(d.from) || !known.includes(d.to)) return "Pick both accounts.";
    if (d.from === d.to) return "From and To must differ.";
  }
  if (d.split?.length) {
    if (d.split.some((x) => !x.person.trim())) return "Name everyone in the split.";
    if (d.split.some((x) => !(x.amount > 0))) return "Each friend's share must be above zero.";
    if (splitTotal(d) > d.amount + 0.001) return "Friends' shares add up to more than the bill.";
  }
  return null;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function pad(n: number) {
  return String(n).padStart(2, "0");
}
