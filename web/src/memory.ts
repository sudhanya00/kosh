// What Kosh learns from you: merchant → category from your corrections, and who people are
// (family, friends) from what you confirm. The AI is told all of it, and the merchant rules are
// also applied to its answers afterwards so a correction sticks even if the model drifts.
import {
  Draft, MerchantRule, Person, Settings, Txn, isRepayment, isWriteOff,
} from "./model";

// "URBAN PYRAMID PVT LTD" and "Urban Pyramid" are the same merchant.
export const memKey = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(pvt|private|ltd|limited|llp|india|upi|payment|payments|technologies|services)\b/g, " ")
    .replace(/\s+/g, " ").trim();

// Exact match, else one name is a word-prefix of the other ("priya" ~ "priya mehta"); longest wins.
function match<T extends { name: string }>(list: T[], name: string): T | undefined {
  const k = memKey(name);
  if (!k) return undefined;
  let best: T | undefined;
  let bestLen = 0;
  for (const item of list) {
    const ik = memKey(item.name);
    if (!ik) continue;
    if (ik === k) return item;
    if ((k.startsWith(ik + " ") || ik.startsWith(k + " ")) && ik.length > bestLen) {
      best = item;
      bestLen = ik.length;
    }
  }
  return best;
}

export const findMerchant = (s: Settings, description: string, type: Draft["type"]) =>
  match(s.merchants.filter((m) => m.type === type), description);
export const findPerson = (s: Settings, name: string) => match(s.people, name);

function upsertPerson(people: Person[], p: Person): Person[] {
  const existing = match(people, p.name);
  if (existing && memKey(existing.name) === memKey(p.name)) {
    // Never downgrade what the user said; only fill a missing group.
    return existing.group === "other" && p.group !== "other" ? people.map((x) => (x === existing ? { ...x, group: p.group } : x)) : people;
  }
  return [...people, p];
}

function upsertMerchant(list: MerchantRule[], r: MerchantRule): MerchantRule[] {
  const k = memKey(r.name);
  return [...list.filter((m) => !(memKey(m.name) === k && m.type === r.type)), r];
}

export interface Learned { patch: Partial<Settings>; notes: string[] }

const empty = (s: Settings): Learned => ({ patch: { people: s.people, merchants: s.merchants }, notes: [] });

// People implied by a transaction the user has saved or confirmed.
function peopleFrom(t: Pick<Txn, "type" | "category" | "description" | "person" | "split" | "from">): Person[] {
  const out: Person[] = [];
  if (t.type === "Income" && t.category === "Family support" && t.description.trim()) {
    out.push({ name: t.description.trim(), group: "family", relation: "" });
  }
  if ((isRepayment(t) || isWriteOff(t)) && t.person?.trim()) out.push({ name: t.person.trim(), group: "friend", relation: "" });
  for (const x of t.split || []) if (x.person.trim()) out.push({ name: x.person.trim(), group: "friend", relation: "" });
  return out;
}

function addPeople(res: Learned, found: Person[]) {
  for (const p of found) {
    const before = res.patch.people!;
    const after = upsertPerson(before, p);
    if (after !== before) {
      res.patch.people = after;
      if (after.length > before.length) res.notes.push(`${p.name} is ${p.group === "family" ? "family" : "a friend"}`);
    }
  }
}

// The user edited a transaction. A changed category (or type) on a named merchant becomes a rule.
export function learnFromEdit(s: Settings, before: Txn, after: Draft): Learned {
  const res = empty(s);
  addPeople(res, peopleFrom(after));
  const name = after.description.trim();
  const changed = before.category !== after.category || before.type !== after.type;
  const merchantish = (after.type === "Expense" || after.type === "Income") && !isWriteOff(after) && after.category !== "Family support";
  if (name && changed && merchantish) {
    res.patch.merchants = upsertMerchant(res.patch.merchants!, { name, type: after.type, category: after.category });
    res.notes.push(`${name} is ${after.category}`);
  }
  return res;
}

// The user confirmed (checked) transactions as they are, or saved a new one.
export function learnFromConfirm(s: Settings, txns: Pick<Txn, "type" | "category" | "description" | "person" | "split" | "from">[]): Learned {
  const res = empty(s);
  for (const t of txns) addPeople(res, peopleFrom(t));
  return res;
}

// Make the AI's rows obey what Kosh has learned.
export function applyMemory(s: Settings, drafts: Draft[]): Draft[] {
  return drafts.map((d) => {
    if (isRepayment(d) || isWriteOff(d) || d.type === "Transfer") return d;
    const rule = findMerchant(s, d.description, d.type);
    if (rule && rule.category !== d.category) return { ...d, category: rule.category, assumption: `Remembered: ${rule.name} is ${rule.category}` };
    if (d.type === "Income") {
      const p = findPerson(s, d.description);
      if (p?.group === "family" && d.category !== "Family support") {
        return { ...d, category: "Family support", assumption: `Remembered: ${p.name} is ${p.relation || "family"}` };
      }
    }
    return d;
  });
}

// Compact form for the AI prompt.
export function memoryForAI(s: Settings) {
  return {
    people: s.people.slice(0, 150).map((p) => ({ name: p.name, group: p.group, relation: p.relation })),
    merchants: s.merchants.slice(-300).map((m) => ({ name: m.name, type: m.type, category: m.category })),
  };
}
