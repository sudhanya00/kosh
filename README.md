# Kosh

**A private, AI-assisted money tracker.** Kosh started as my own budgeting
spreadsheet and is now an installable web app I use every day: share a UPI
payment or bank SMS to it and it is logged, categorised and counted against
the month's budget, and an agent answers questions over the full history.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%7C%20Firestore%20%7C%20Functions%20%7C%20Hosting-FFCA28?logo=firebase&logoColor=black)
![Gemini](https://img.shields.io/badge/Gemini-Vertex%20AI-4285F4?logo=google&logoColor=white)

Kosh is a single-user app by design: sign-in is restricted to the owner's
Google account, enforced in both the Firestore rules and the Cloud Function.
To run your own copy, see [Run your own](#run-your-own).

## What it does

- **Log by sharing.** On Android, tap Share on a payment in GPay, PhonePe or
  Paytm, or share a bank SMS, and pick Kosh. It reads the payment, logs it
  marked *to review*, and skips anything already logged (same UPI reference).
- **Log by typing.** Write it like a text message ("dinner 2k on axis card
  split with Rahul and Priya"), paste an SMS, or attach up to five
  screenshots. Rows are shown for review before they save.
- **Ask Kosh.** A Gemini agent with tools over the full history: find
  transactions, exact totals grouped by month, category, merchant, account or
  friend, balances on any date, budgets, bills, and finance formulas such as
  months to a goal or loan payoff. It can also search by meaning across
  merchants, notes and past chats.
- **It learns.** Change a payment's category and that merchant keeps it from
  then on. People are remembered as family or friends, and plain-English
  rules ("payments from this person are family support") are followed by the
  AI. Everything learned can be edited or deleted.
- **Budgets, bills and goals.** Per-category limits, bills that tick off for
  the month when marked paid, reserve goals and a payday checklist.
- **Months run payday to payday.** A salary logged on the 30th starts the
  next month. Calendar months are available as a setting.
- **Splitting with friends.** The full bill leaves your account but only your
  share counts as spending. The rest is tracked as one running total per
  friend, and repayments settle it instead of counting as income.
- **Private on screen.** Amounts are hidden every time the app opens, AI
  answers included, until you reveal them.
- **Works offline.** Entries made offline sync when the connection returns.

## Engineering notes

- **Every number comes from a tool, not the model.** The agent
  (`functions/agent.js`) can call `find_transactions`, `summarize`,
  `pay_cycles`, `balances`, `budget`, `bills`, `calculate`, `finance` and
  `search_memory`, for up to six rounds per question. Totals and dates are
  computed in code; the model only decides what to ask for and how to explain
  the result.
- **One implementation of the maths.** The tool logic lives in
  `web/src/tools.ts` and is bundled, together with the app's own model and
  calculation modules, into the Cloud Function at deploy time. The app and
  the server cannot disagree about a balance.
- **Memory that stays bounded.** Conversations are saved; the last eight
  messages go to the model verbatim and older ones are folded into a rolling
  summary. Each exchange is embedded with a multilingual embedding model and
  stored for Firestore vector search.
- **No API keys anywhere.** The function calls Gemini on Vertex AI as a
  dedicated service account that holds only the roles it needs. It uses a
  regional endpoint and falls back to the global one when that is busy.
- **Android share target.** The PWA manifest registers a `share_target`, and
  the service worker receives shared text and images, so Kosh appears in the
  system share sheet without a native app.
- **Locked down by default.** Firestore rules allow reads and writes only
  under the owner's own `users/{uid}` tree, and only for a verified Google
  account. The function checks the same thing before doing any work.

## Stack

| Concern | Choice |
|---|---|
| App | React 19, TypeScript, Vite, installable PWA |
| Data | Firestore with offline persistence across tabs |
| Auth | Firebase Auth (Google sign-in) |
| Server | Cloud Functions for Firebase |
| AI | Gemini on Vertex AI, Firestore vector search for recall |
| Hosting | Firebase Hosting |

## Repository layout

| Path | What |
|---|---|
| `web/src/screens/` | Home, Activity, Plan, Accounts, Ask, Login |
| `web/src/model.ts`, `calc.ts`, `memory.ts` | Data model, pay-cycle and balance maths, learned rules |
| `web/src/tools.ts` | The agent's tools, shared with the server |
| `web/src/share.tsx`, `web/public/sw.js` | Android share target |
| `functions/agent.js` | The Ask Kosh agent loop, chat memory and recall |
| `functions/kosh-ai.js` | Parsing payments, SMS and screenshots |
| `firestore.rules` | Owner-only access |

## Run your own

Kosh needs a Firebase project on the Blaze plan with Google sign-in,
Firestore and Cloud Functions enabled, and a Google Cloud project with
Vertex AI.

1. Set the owner email in `firestore.rules` and `functions/index.js`.
2. Point `.firebaserc` at your project, and set `VERTEX_PROJECT` (and
   optionally `GEMINI_MODEL`) in `functions/.env`.
3. Grant the function's service account *Vertex AI User* on the Vertex
   project.

Install dependencies:

```bash
cd functions && npm install && cd ../web && npm install
```

Run against the local emulators (from the repository root), then start the
app:

```bash
firebase emulators:start --only auth,firestore,functions
```

```bash
npm --prefix web run dev -- --mode emulators
```

Open http://localhost:5173. In emulator mode, sign in from the browser
console with `__devSignIn("you@example.com", "Your Name")`. The local
function calls Vertex AI with your `gcloud auth application-default login`
credentials.

Deploy:

```bash
npm --prefix web run build && firebase deploy
```
