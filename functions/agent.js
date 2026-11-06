// Ask Kosh: a Gemini agent that answers from the user's own data by calling exact tools
// (lookups, totals, balances, maths) instead of reading a big pasted summary.
//
//   phone ──ask(question, chatId)──▶ this function
//            1. load the user's settings/transactions/bills (Admin SDK, cached briefly)
//            2. Gemini + briefing + chat summary + recent turns ⇄ tools (≤ 6 rounds)
//            3. save both turns in users/{uid}/chats/{chatId}/messages, embed the Q&A for recall,
//               and fold older turns into the chat's rolling summary
//
// Tool maths lives in web/src/tools.ts (bundled to lib/core.js), the same code the app uses.
import { initializeApp, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { TOOL_DECLARATIONS, briefing, memKey, normalizeSettings, runTool } from "./lib/core.js";
import { GENERAL_RULES, MODEL, client, clip, friendly, generate } from "./kosh-ai.js";

if (!getApps().length) initializeApp();
const db = getFirestore();

const EMBED_MODEL = "text-multilingual-embedding-002";
const EMBED_LOCATION = process.env.VERTEX_LOCATION || "asia-south1";
const KEEP_TURNS = 8; // recent messages sent verbatim; older ones live in the rolling summary
const MAX_ROUNDS = 6;

// ---- Data (read fresh, reused for 30s so a burst of questions doesn't re-read everything) ----

const cache = new Map();
async function loadData(uid, today) {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < 30_000) return { ...hit.data, today };
  const root = db.collection("users").doc(uid);
  const [s, t, b] = await Promise.all([root.get(), root.collection("transactions").get(), root.collection("bills").get()]);
  const txns = t.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((x, y) => (x.date === y.date ? (y.createdAt || 0) - (x.createdAt || 0) : x.date < y.date ? 1 : -1));
  const data = { settings: normalizeSettings(s.data()), txns, bills: b.docs.map((d) => ({ id: d.id, marks: {}, ...d.data() })) };
  cache.set(uid, { at: Date.now(), data });
  return { ...data, today };
}
const forget = (uid) => cache.delete(uid);

// ---- Embeddings + recall (Firestore vector search over users/{uid}/recall) ----

async function embed(texts, taskType) {
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const res = await client(EMBED_LOCATION).models.embedContent({
      model: EMBED_MODEL, contents: texts.slice(i, i + 100).map((t) => clip(t, 2000)),
      config: { taskType, outputDimensionality: 768 },
    });
    out.push(...res.embeddings.map((e) => e.values));
  }
  return out;
}

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

const indexed = new Map(); // uid -> Set of recall ids known to exist

// Make sure every merchant and every note has an embedding (cheap after the first time).
async function syncRecall(uid, data) {
  const col = db.collection("users").doc(uid).collection("recall");
  if (!indexed.has(uid)) {
    const snap = await col.select().get();
    indexed.set(uid, new Set(snap.docs.map((d) => d.id)));
  }
  const have = indexed.get(uid);
  const want = new Map();
  const merchants = new Map();
  for (const t of data.txns) {
    if (!t.description?.trim() || t.type === "Transfer") continue;
    const k = memKey(t.description);
    const m = merchants.get(k) ?? { name: t.description.trim(), category: t.category, type: t.type, count: 0 };
    m.count++;
    merchants.set(k, m);
    if (t.notes?.trim()) want.set(`n_${t.id}`, { kind: "note", text: `${t.description}: ${t.notes}`, date: t.date, amount: t.amount, category: t.category });
  }
  for (const [k, m] of merchants) want.set(`m_${hash(k)}`, { kind: "merchant", text: `${m.name} — ${m.category}`, name: m.name, category: m.category, type: m.type });
  const missing = [...want.entries()].filter(([id]) => !have.has(id)).slice(0, 400);
  if (!missing.length) return;
  const vectors = await embed(missing.map(([, v]) => v.text), "RETRIEVAL_DOCUMENT");
  const batch = db.batch();
  missing.forEach(([id, v], i) => {
    batch.set(col.doc(id), { ...v, embedding: FieldValue.vector(vectors[i]), at: Date.now() });
    have.add(id);
  });
  await batch.commit();
}

async function searchMemory(uid, data, { query, kind = "any" }) {
  if (!String(query || "").trim()) return { error: "Empty query" };
  await syncRecall(uid, data);
  const [qv] = await embed([query], "RETRIEVAL_QUERY");
  const snap = await db.collection("users").doc(uid).collection("recall")
    .findNearest({ vectorField: "embedding", queryVector: qv, limit: 20, distanceMeasure: "COSINE", distanceResultField: "distance" })
    .get();
  const want = { merchants: "merchant", notes: "note", chats: "chat" }[kind];
  const hits = snap.docs.map((d) => d.data())
    .filter((h) => !want || h.kind === want)
    .filter((h) => h.distance < 0.6)
    .slice(0, 10)
    .map(({ embedding: _e, at: _a, ...h }) => ({ ...h, relevance: Math.round((1 - h.distance) * 100) / 100, distance: undefined }));
  return hits.length ? { query, results: hits } : { query, results: [], note: "Nothing similar found." };
}

async function rememberChatTurn(uid, chatId, title, msgId, question, answer, date) {
  try {
    const text = `Q: ${clip(question, 500)}\nA: ${clip(answer, 1200)}`;
    const [v] = await embed([text], "RETRIEVAL_DOCUMENT");
    await db.collection("users").doc(uid).collection("recall").doc(`c_${msgId}`)
      .set({ kind: "chat", chatId, title, date, text, embedding: FieldValue.vector(v), at: Date.now() });
    indexed.get(uid)?.add(`c_${msgId}`);
  } catch (e) {
    console.warn("chat recall skipped", e.message);
  }
}

// ---- Remembering durable facts the user states in chat ----

async function remember(uid, data, a) {
  const root = db.collection("users").doc(uid);
  if (a.kind === "person" && a.name) {
    const people = data.settings.people || [];
    const k = memKey(a.name);
    const group = ["family", "friend", "other"].includes(a.group) ? a.group : "other";
    const next = people.some((p) => memKey(p.name) === k)
      ? people.map((p) => (memKey(p.name) === k ? { ...p, group, relation: a.relation || p.relation } : p))
      : [...people, { name: clip(a.name, 60), group, relation: clip(a.relation || "", 40) }];
    await root.set({ people: next }, { merge: true });
    forget(uid);
    return { saved: `${a.name} = ${a.relation || group}` };
  }
  if (a.kind === "fact" && a.text) {
    const line = `- ${clip(a.text, 200)}`;
    const notes = data.settings.aiNotes || "";
    if (notes.includes(line)) return { saved: "already remembered" };
    const head = "\nRemembered from chat:";
    await root.set({ aiNotes: notes.includes(head) ? `${notes}\n${line}` : `${notes}${head}\n${line}` }, { merge: true });
    forget(uid);
    return { saved: a.text };
  }
  return { error: "Give kind 'fact' with text, or 'person' with name/group/relation." };
}

const REMEMBER_DECL = {
  name: "remember",
  description: "Save a lasting fact the user tells you (a goal, plan, preference, or who someone is) so it's known in every future chat and when reading payments. Only for durable facts the user stated, not for numbers you looked up.",
  parametersJsonSchema: { type: "object", required: ["kind"], properties: {
    kind: { type: "string", enum: ["fact", "person"] },
    text: { type: "string", description: "kind=fact: one short sentence, e.g. 'Saving ₹80,000 for a bike by March 2027'" },
    name: { type: "string" }, group: { type: "string", enum: ["family", "friend", "other"] }, relation: { type: "string", description: "e.g. Mother" } } },
};

// Short labels for the "what Kosh looked at" line under an answer.
function label(name, args, result) {
  const r = result || {};
  switch (name) {
    case "find_transactions": return `Looked up ${r.count ?? 0} transaction${r.count === 1 ? "" : "s"}`;
    case "summarize": return `Totalled ${args.metric || "spending"} by ${args.group_by}`;
    case "pay_cycles": return "Checked month dates";
    case "balances": return args.as_of ? `Balances on ${args.as_of}` : "Checked balances";
    case "budget": return `Budget for ${r.month || "this month"}`;
    case "bills": return "Checked bills";
    case "calculate": return "Calculated";
    case "finance": return `Ran ${String(args.kind || "").replace(/_/g, " ")}`;
    case "search_memory": return `Searched memory for “${clip(args.query, 30)}”`;
    case "remember": return "Saved to memory";
  }
  return name;
}

// ---- The agent ----

function systemPrompt(data, summary) {
  return `You are Kosh, the money assistant inside one person's private budgeting app in India. Today is ${data.today} (IST).

How to answer:
- You have tools over ALL of the user's data. Every number you state must come from the briefing below or a tool result. Never estimate or invent totals; use summarize / find_transactions. Use calculate for any arithmetic.
- Months may run payday to payday: resolve "last month", "last 3 months", "this year" with pay_cycles or explicit from/to dates.
- To project when an account reaches a goal, use its real monthly net change (summarize metric net_flow, group_by month, with the account) over recent full months, so EMIs and other outflows count, then finance months_to_goal. Say which months you averaged.
- For fuzzy references ("food delivery", "that gift", "what we discussed"), call search_memory first, then use the exact merchant names it returns with find_transactions/summarize.
- If the user tells you a lasting goal, plan, preference, or who someone is, save it with remember (briefly confirm you'll remember it).
- If the data can't answer it, say exactly what's missing.
${GENERAL_RULES}
Style: warm, direct, short. Lead with the answer. ₹ with Indian grouping (₹1,25,000; ₹3L ok). Short bullets only when listing several items. **Bold** sparingly. No headings, no tables.
You are not a licensed financial advisor: explain budgeting, saving and debt basics, but do not recommend specific investment products, stocks, funds or crypto.

The user's own rules and remembered facts:
${clip(data.settings.aiNotes, 3000) || "(none)"}

BRIEFING (current state; use tools for anything else):
${JSON.stringify(briefing(data))}
${summary ? `\nEARLIER IN THIS CONVERSATION (summary):\n${summary}` : ""}`;
}

async function runAgent(uid, data, history, question, summary) {
  const contents = [...history, { role: "user", parts: [{ text: question }] }];
  const tools = [{ functionDeclarations: [...TOOL_DECLARATIONS, REMEMBER_DECL] }];
  const trace = [];
  const deadline = Date.now() + 105_000;
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS;
    const res = await generate({
      model: MODEL, contents,
      config: {
        systemInstruction: systemPrompt(data, summary), tools, temperature: 0.3, thinkingConfig: { thinkingLevel: "LOW" },
        ...(last ? { toolConfig: { functionCallingConfig: { mode: "NONE" } } } : {}),
      },
    }, Math.max(15_000, deadline - Date.now()));
    const calls = res.functionCalls || [];
    if (!calls.length) return { answer: (res.text || "").trim() || "I couldn't find an answer to that.", trace };
    contents.push(res.candidates[0].content); // keeps Gemini's thought signatures for the next turn
    const parts = [];
    for (const call of calls) {
      const args = call.args || {};
      let result;
      try {
        if (call.name === "search_memory") result = await searchMemory(uid, data, args);
        else if (call.name === "remember") { result = await remember(uid, data, args); data = await loadData(uid, data.today); }
        else result = runTool(data, call.name, args);
      } catch (e) {
        console.error("tool failed", call.name, e);
        result = { error: `Tool failed: ${clip(e.message, 200)}` };
      }
      trace.push({ name: call.name, label: label(call.name, args, result) });
      parts.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { output: result } } });
    }
    contents.push({ role: "user", parts });
  }
  return { answer: "That took too many steps. Try asking more specifically.", trace };
}

// Fold turns that fell out of the recent window into the chat's running summary.
async function updateSummary(chatRef, chat, msgs) {
  const older = msgs.slice(chat.summarizedCount || 0, Math.max(0, msgs.length - KEEP_TURNS));
  if (older.length < 6) return;
  try {
    const res = await generate({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: `Current summary:\n${chat.summary || "(none)"}\n\nNew messages to fold in:\n${older.map((m) => `${m.role === "user" ? "User" : "Kosh"}: ${clip(m.text, 1500)}`).join("\n")}` }] }],
      config: {
        systemInstruction: "Update the running summary of a conversation between a user and Kosh, their budgeting assistant. Keep facts, figures with their periods, decisions, open questions and the user's goals or preferences. Drop chit-chat. At most 180 words, plain sentences.",
        temperature: 0.2, thinkingConfig: { thinkingLevel: "LOW" },
      },
    }, 30_000);
    await chatRef.set({ summary: (res.text || "").trim(), summarizedCount: (chat.summarizedCount || 0) + older.length }, { merge: true });
  } catch (e) {
    console.warn("summary skipped", e.message);
  }
}

export async function ask(uid, input) {
  const question = String(input.question || "").trim();
  if (!question) throw new HttpsError("invalid-argument", "Ask something.");
  const today = /^\d{4}-\d{2}-\d{2}$/.test(input.today || "") ? input.today : new Date().toISOString().slice(0, 10);
  const root = db.collection("users").doc(uid);
  const ephemeral = !!input.ephemeral; // Home's "Kosh's read": answer only, nothing saved

  let chatRef = null;
  let chat = {};
  let msgs = [];
  if (!ephemeral) {
    chatRef = input.chatId ? root.collection("chats").doc(String(input.chatId)) : root.collection("chats").doc();
    const snap = await chatRef.get();
    if (snap.exists) {
      chat = snap.data();
      msgs = (await chatRef.collection("messages").orderBy("at").get()).docs.map((d) => d.data());
    } else {
      chat = { title: clip(question, 70), createdAt: Date.now(), summary: "", summarizedCount: 0 };
      await chatRef.set({ ...chat, updatedAt: Date.now(), count: 0 });
    }
    await chatRef.collection("messages").add({ role: "user", text: question, at: Date.now() });
  }

  const data = await loadData(uid, today);
  const recent = msgs.slice(-KEEP_TURNS).map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] }));
  let out;
  try {
    out = await runAgent(uid, data, recent, question, chat.summary);
  } catch (e) {
    console.error("ask failed", e);
    throw friendly(e);
  }

  if (chatRef) {
    const ref = await chatRef.collection("messages").add({ role: "model", text: out.answer, at: Date.now(), tools: out.trace.map((t) => t.label) });
    await chatRef.set({ updatedAt: Date.now(), count: msgs.length + 2 }, { merge: true });
    await rememberChatTurn(uid, chatRef.id, chat.title, ref.id, question, out.answer, today);
    await updateSummary(chatRef, chat, [...msgs, { role: "user", text: question }, { role: "model", text: out.answer }]);
  }
  return { chatId: chatRef?.id ?? null, answer: out.answer, tools: out.trace.map((t) => t.label) };
}
