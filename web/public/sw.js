// Kosh service worker. Its only job: receive things shared to Kosh from other Android apps
// (UPI screenshots, bank SMS text) via the manifest's share_target, park them in Cache Storage,
// and hand off to the app, which reads them with AI. No page caching — the app always loads fresh.
const INBOX = "kosh-share-inbox";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.pathname === "/share-target") e.respondWith(receive(e.request));
});

async function receive(request) {
  const form = await request.formData();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const files = form.getAll("media").filter((f) => f && typeof f !== "string" && f.size > 0);
  const text = [form.get("title"), form.get("text"), form.get("url")].filter((v) => typeof v === "string" && v.trim()).join("\n").trim();
  const cache = await caches.open(INBOX);
  for (let i = 0; i < files.length; i++) {
    await cache.put(`/inbox/${id}/file/${i}`, new Response(files[i], { headers: { "content-type": files[i].type || "image/jpeg" } }));
  }
  // Meta last: the app only picks up a share once all its parts are stored.
  await cache.put(`/inbox/${id}/meta`, new Response(JSON.stringify({ id, text, files: files.length, at: Date.now() }), {
    headers: { "content-type": "application/json" },
  }));
  return Response.redirect(`/?share=${id}#/home`, 303);
}
