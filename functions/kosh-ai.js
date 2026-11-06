// Gemini on Vertex AI: reading shares/messages into transactions (parse) and answering questions (ask).
//
// Same setup as reelforge: Vertex bills the reelforge GCP project (where the Cloud credits are).
// The function runs as kosh-ai@kosh-7d33a0, which holds roles/aiplatform.user on that project only.
import { HttpsError } from "firebase-functions/v2/https";
import { GoogleGenAI, Type } from "@google/genai";

// Reading shares should feel instant; 3.5 Flash reads receipts accurately in ~5s on Vertex vs ~25s for 3.8.
export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const VERTEX_PROJECT = process.env.VERTEX_PROJECT || "reelforge-509712";
// Mumbai: same region as the function and the data, ~1s per call; "global" is the fallback when it's busy.
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || "asia-south1";
export const SERVICE_ACCOUNT = "kosh-ai@kosh-7d33a0.iam.gserviceaccount.com";

const EXTERNAL = "External";
const FRIENDS = "Friends"; // virtual: money friends owe the user
const REPAY = "Friend repayment";
const CATEGORIES = {
  Income: ["Salary", "Side income", "Family support", "Gifts received", "Interest & dividends", "Refunds & cashback", "Other income"],
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
const ALL_CATEGORIES = [...CATEGORIES.Income, ...CATEGORIES.Expense, ...CATEGORIES.Transfer];

export const GENERAL_RULES = `
How money is logged (follow exactly):
- Amount is ALWAYS positive. Type + From/To give the direction. "${EXTERNAL}" = anyone/anywhere outside the user's own accounts.
- Income: From "${EXTERNAL}", To = the user's account that received it. Categories: ${CATEGORIES.Income.join(", ")}.
  Salary/payroll → Salary. Freelance, client, gig payouts → Side income. Money from family members → Family support.
  Bank interest, dividends → Interest & dividends. Refunds, cashback, reversals → Refunds & cashback.
- Expense: From = the user's account or card that paid, To = "${EXTERNAL}". A purchase on a credit card is an Expense from that card.
  Categories: ${CATEGORIES.Expense.join(", ")}.
- Transfer: money moving between two of the user's OWN accounts (both From and To are own accounts). Categories: ${CATEGORIES.Transfer.join(", ")}.
  Paying a credit-card bill = Transfer from the bank To the card, "Credit card payment" (never an Expense; the spending was counted on the card).
  Saving into a reserve account → the matching savings category. Otherwise "Internal transfer".
- Category hints for Indian merchants: Blinkit, Zepto, Instamart, BigBasket, DMart, kirana → Groceries. Swiggy, Zomato, restaurants, cafes → Food & dining.
  HP/Indian Oil/Bharat Petroleum/filling stations, Uber, Ola, Rapido, metro, FASTag, parking → Fuel & commute. Electricity, water, gas, broadband, mobile recharge, rent → Rent & utilities.
  Netflix, Spotify, YouTube Premium, iCloud, Google One → Subscriptions. Amazon, Flipkart, Myntra, Ajio → Shopping. Pharmacy, hospital, lab → Health.
  Flights, trains, hotels → Travel. Unknown small merchants → Miscellaneous.
`;

const UPI_RULES = `
Reading UPI apps (GPay, PhonePe, Paytm, BHIM, bank apps), receipts and bank SMS:
- A payment screenshot usually shows: amount, "Paid to"/"To" (payee), "From"/"Debited from" (payer + bank + last 4 digits), date/time, a note/message, and a UPI transaction ID / UTR / reference number.
- Map the payer/payee bank account to the user's account using the account list (bank names, last 4 digits, UPI IDs). If the payer is the user and no bank is shown, use the default account from the user's rules, else the first bank account.
- If BOTH payer and payee are the user themself (same name, different banks), it is a Transfer between those two own accounts. Use any note on the screenshot and the receiving account's role to pick the category: a note about saving → the savings category that fits the receiving account (Emergency savings for an emergency reserve, Flexibility savings for a flexibility reserve, Bike/Investing when named); "EMI"/"loan" → Loan funding; "card bill" → Credit card funding; otherwise Internal transfer.
  Its description is the note if there is one (e.g. "Nov Savings"), else "Transfer to <account name>"; never the user's own name.
- If the user RECEIVED money, it is Income into the matching account.
- Put the payment note/message (if any) in notes. Put the UPI transaction ID / UTR / reference number in ref (digits/letters only, no spaces); empty if none.
- Description = the other party's name as a short readable merchant/person name (e.g. "Blinkit", "HP Filling Station", "Rakesh Khajuria"), not "UPI payment".
- Skip failed, pending, declined or reversed-and-not-completed payments, OTP messages, balance alerts and promotions; mention any skipped item in message.
- Bank SMS: "debited"/"spent"/"sent" = money out, "credited"/"received" = money in.
`;

const FRIENDS_RULES = `
Paying for friends (splits) and getting paid back:
- When the user paid a bill for a group ("dinner 20k split with Rahul, Priya and Amit", "paid 3000 for movie, Neha owes 1000"), log ONE Expense for the FULL amount from the account that paid, and list each friend's share in split (person + amount). The user's own share is whatever is left. "Split equally/evenly with N friends" = amount ÷ (N + 1) each, rounded down to the rupee. Paid entirely for a friend = their share is the whole amount.
- Leave split empty for normal expenses. Never put the user themself in split.
- Money RECEIVED from a friend who owes the user (see the list below; match names loosely: first name, caps, initials) is a repayment, not income:
  type "Transfer", from "${FRIENDS}", to = the account it landed in, category "${REPAY}", person = that friend's name as written in the list. Description like "<Name> paid back".
  Notes such as "dinner", "my share", "split", "settle", "returning" also mean repayment, even if the friend isn't on the list.
- Only use "${FRIENDS}" as from for repayments. Money from family or anyone not settling a debt stays Income.
- When the user sends money TO a friend for their own share of something the friend paid ("sent Priya 800 for my part of the cab"), that's just the user's Expense in the matching category.
`;

function txnSchema(accounts) {
  return {
    type: Type.OBJECT,
    properties: {
      date: { type: Type.STRING, description: "YYYY-MM-DD" },
      type: { type: Type.STRING, enum: ["Income", "Expense", "Transfer"] },
      from: { type: Type.STRING, enum: [...accounts, EXTERNAL, FRIENDS] },
      to: { type: Type.STRING, enum: [...accounts, EXTERNAL] },
      category: { type: Type.STRING, enum: ALL_CATEGORIES },
      description: { type: Type.STRING, description: "Merchant or person, Title Case, no amounts" },
      amount: { type: Type.NUMBER, description: "Positive rupees" },
      notes: { type: Type.STRING, description: "Note/message shown on the payment, else empty" },
      ref: { type: Type.STRING, description: "UPI transaction ID / UTR / reference number, else empty" },
      person: { type: Type.STRING, description: "Repayments only: the friend paying back; else empty" },
      split: {
        type: Type.ARRAY, description: "Expenses paid for a group: each friend's share. Empty otherwise.",
        items: { type: Type.OBJECT, properties: { person: { type: Type.STRING }, amount: { type: Type.NUMBER } }, required: ["person", "amount"] },
      },
      assumption: { type: Type.STRING, description: "One short phrase if you guessed the account, date, category or a friend match; else empty" },
    },
    required: ["date", "type", "from", "to", "category", "description", "amount", "notes", "ref", "person", "split", "assumption"],
    propertyOrdering: ["date", "type", "from", "to", "category", "description", "amount", "notes", "ref", "person", "split", "assumption"],
  };
}

const clients = new Map();
export function client(location) {
  // Application Default Credentials: the function's service account in the cloud,
  // your `gcloud auth application-default login` when running in the emulator.
  // In the emulator those are user credentials, whose quota would otherwise land on whatever
  // project gcloud points at, so pin it (reelforge does the same). Not in the cloud: the service
  // account lacks serviceusage on that project and doesn't need it.
  const local = process.env.FUNCTIONS_EMULATOR === "true";
  if (!clients.has(location)) clients.set(location, new GoogleGenAI({
    vertexai: true, project: VERTEX_PROJECT, location,
    ...(local ? { googleAuthOptions: { scopes: ["https://www.googleapis.com/auth/cloud-platform"], clientOptions: { quotaProjectId: VERTEX_PROJECT } } } : {}),
  }));
  return clients.get(location);
}

export function friendly(err) {
  const msg = String(err?.message || err);
  if (/abort|timed? ?out|deadline/i.test(msg)) {
    return new HttpsError("deadline-exceeded", "Gemini took too long. Try again.");
  }
  if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return new HttpsError("resource-exhausted", "Gemini is busy right now. Try again in a minute.");
  }
  if (msg.includes("403") || /PERMISSION_DENIED|billing/i.test(msg)) {
    return new HttpsError("permission-denied", `Vertex AI refused the call. Check that ${SERVICE_ACCOUNT} has Vertex AI User on ${VERTEX_PROJECT} and billing is on.`);
  }
  return new HttpsError("internal", "Gemini didn't answer. Try again.");
}

// Vertex's shared capacity answers 429/5xx now and then; quick retries usually clear it. All attempts
// share one budget so we answer (or fail clearly) before the function's 120s limit.
export async function generate(req, budgetMs = 100_000) {
  const end = Date.now() + budgetMs;
  for (let attempt = 0; ; attempt++) {
    const left = end - Date.now();
    try {
      // Alternate regional and global endpoints, so one busy pool doesn't sink the call.
      const location = attempt % 2 === 0 ? VERTEX_LOCATION : "global";
      return await client(location).models.generateContent({ ...req, config: { ...req.config, httpOptions: { timeout: Math.min(45_000, left) } } });
    } catch (err) {
      const msg = String(err?.message || err);
      const wait = [500, 2000, 5000][attempt] + Math.random() * 500;
      const retryable = /\b(404|429|500|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|NOT_FOUND|abort|timed? ?out/i.test(msg);
      if (!retryable || attempt >= 3 || end - Date.now() < wait + 8000) throw err;
      console.warn(`retrying after ${msg.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export const clip = (s, n) => String(s ?? "").slice(0, n);

const SETTLE_WORDS = /\b(split|share|settle|settling|returning|return|back|paid back|payback|owe|owed|dinner|lunch|trip|cab|movie)\b/i;
const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
// "Priya" matches "PRIYA MEHTA"; "Rahul Sharma" matches "Rahul".
function sameName(a, b) {
  const x = nameKey(a), y = nameKey(b);
  return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " ") || x.split(" ")[0] === y.split(" ")[0] && (x.split(" ").length === 1 || y.split(" ").length === 1));
}

// People and merchant rules the user taught by confirming and correcting.
function memoryLines(memory) {
  const people = (Array.isArray(memory?.people) ? memory.people : []).slice(0, 150)
    .map((p) => `${clip(p.name, 60)} = ${p.relation ? clip(p.relation, 40) + ", " : ""}${p.group === "family" ? "family (money from them is Family support)" : p.group === "friend" ? "friend" : "known contact"}`);
  const merchants = (Array.isArray(memory?.merchants) ? memory.merchants : []).slice(-300)
    .map((m) => `${clip(m.name, 60)} → ${m.type} / ${clip(m.category, 40)}`);
  return [
    people.length ? `People:\n${people.join("\n")}` : "People: (none yet)",
    merchants.length
      ? `Merchant rules (always use these categories for these payees, matching loosely by name):\n${merchants.join("\n")}`
      : "Merchant rules: (none yet)",
  ].join("\n");
}

export async function parse(data) {
  const { text = "", images = [], today, recent = [], me = "", notes = "" } = data;
  const imgs = (Array.isArray(images) ? images : []).filter((i) => i?.data).slice(0, 5);
  if (data.image?.data) imgs.push(data.image); // older clients
  if (!String(text).trim() && !imgs.length) throw new HttpsError("invalid-argument", "Nothing to read.");

  const accounts = (Array.isArray(data.accounts) ? data.accounts : [])
    .filter((a) => a?.name && a.name !== EXTERNAL).slice(0, 30)
    .map((a) => ({ name: clip(a.name, 60), kind: a.kind === "card" ? "credit card" : a.kind === "cash" ? "cash" : "bank account", role: clip(a.role, 80), hints: clip(a.hints, 200) }));
  if (!accounts.length) throw new HttpsError("failed-precondition", "Add an account first.");

  const system = `You turn what the user types, pastes, forwards or screenshots into transaction rows for their personal money tracker in India. Currency is INR.
Today is ${today} (IST). Resolve "yesterday", weekday names etc. against today. Never use a future date. Use the date printed on a screenshot/SMS when there is one.
The user's name is "${clip(me, 80) || "unknown"}" (names on UPI screens may be in caps or abbreviated).

The user's own accounts (use these exact names):
${accounts.map((a) => `- "${a.name}" — ${a.kind}${a.role ? `, ${a.role}` : ""}${a.hints ? `. Shows up as: ${a.hints}` : ""}`).join("\n")}
${GENERAL_RULES}${UPI_RULES}${FRIENDS_RULES}
Friends who currently owe the user money: ${(Array.isArray(data.friendsOwing) ? data.friendsOwing : []).slice(0, 40).map((f) => `${clip(f.person, 60)} (₹${Number(f.owed) || 0})`).join(", ") || "(nobody)"}
What Kosh has learned from the user (follow it):
${memoryLines(data.memory)}
Other friends the user has split with before: ${(Array.isArray(data.people) ? data.people : []).slice(0, 60).map((p) => clip(p, 60)).join(", ") || "(none)"}

The user's own rules (these override the defaults above):
${clip(notes, 3000) || "(none)"}

Return one row per real, completed transaction. If several screenshots show the same payment, return it once. Invent nothing.
If there is nothing to log, return an empty list and say why in message.
The user's recent rows, to match their usual names and categories:
${recent.slice(0, 40).map((r) => `${clip(r.description, 60)} -> ${r.type}/${r.category}/${r.from}->${r.to}`).join("\n") || "(none yet)"}`;

  const parts = imgs.map((i) => ({ inlineData: { mimeType: i.mimeType || "image/jpeg", data: i.data } }));
  parts.push({ text: String(text).trim() || (imgs.length > 1 ? "Read the transactions in these images." : "Read the transaction in this image.") });

  try {
    const res = await generate({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transactions: { type: Type.ARRAY, items: txnSchema(accounts.map((a) => a.name)) },
            message: { type: Type.STRING, description: "Empty, or one short sentence if something was skipped or needs the user's attention" },
          },
          required: ["transactions", "message"],
        },
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });
    const out = JSON.parse(res.text || "{}");
    const owing = (Array.isArray(data.friendsOwing) ? data.friendsOwing : []).map((f) => String(f.person || ""));
    out.transactions = (out.transactions || [])
      .filter((t) => t.amount > 0)
      .map((row) => {
        let t = row;
        const split = t.type === "Expense" ? (t.split || []).filter((x) => x?.person?.trim() && x.amount > 0) : [];
        let repay = t.type === "Transfer" && t.category === REPAY;
        // A friend paying you is a repayment only if they owe you or the note says it settles something.
        const owes = owing.some((f) => sameName(f, t.person || t.description));
        if (repay && !owes && !SETTLE_WORDS.test(t.notes || "")) {
          repay = false;
          t = { ...t, type: "Income", category: "Other income", from: EXTERNAL, description: t.person || String(t.description).replace(/\s*paid back$/i, ""),
            assumption: `${t.person || "They"} didn't owe you anything in Kosh, so this is income. Change it to a repayment if it settles something.` };
        }
        return {
          ...t, amount: Math.round(Math.abs(t.amount) * 100) / 100, ref: String(t.ref || "").replace(/\s+/g, ""), split,
          person: repay ? String(t.person || "").trim() : "",
          from: repay ? FRIENDS : t.from === FRIENDS ? EXTERNAL : t.from,
        };
      });
    return out;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("parse failed", err);
    throw friendly(err);
  }
}

