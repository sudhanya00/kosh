// The only server code in Kosh: one callable that talks to Gemini on Vertex AI, so no
// credentials ever reach the browser. Reading payments lives in kosh-ai.js; Ask Kosh in agent.js.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { ask } from "./agent.js";
import { SERVICE_ACCOUNT, parse } from "./kosh-ai.js";

// The shared date helpers (pay cycles, "today") work in the user's local time.
process.env.TZ = "Asia/Kolkata";

// Keep in sync with firestore.rules.
const OWNER_EMAIL = "sudhanyak357@gmail.com";

export const ai = onCall(
  { region: "asia-south1", serviceAccount: SERVICE_ACCOUNT, timeoutSeconds: 150, memory: "512MiB", maxInstances: 3 },
  async (req) => {
    const token = req.auth?.token;
    if (!token || token.email !== OWNER_EMAIL || !token.email_verified) {
      throw new HttpsError("permission-denied", "This app is private.");
    }
    const { task } = req.data || {};
    if (task === "parse") return parse(req.data);
    if (task === "ask") return ask(req.auth.uid, req.data);
    throw new HttpsError("invalid-argument", "Unknown task.");
  },
);
