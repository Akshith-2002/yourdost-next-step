// Netlify Function: POST /api/next-step
// Keeps the Anthropic API key on the server (set ANTHROPIC_API_KEY in the Netlify site's environment variables).
// The page itself is hosted on GitHub Pages and calls this endpoint cross-origin.
import Anthropic from "@anthropic-ai/sdk";
import { buildPrompt, validate, rulesEngine, safetyScreen, RESULT_SCHEMA } from "../../shared.js";

export const config = { path: "/api/next-step" };

const client = new Anthropic();
const clip = (v, n) => String(v ?? "").slice(0, n);

// Only these pages may call the endpoint (override with ALLOWED_ORIGINS, comma-separated).
const ALLOWED = (process.env.ALLOWED_ORIGINS || "https://akshith-2002.github.io,http://localhost:8000,http://127.0.0.1:8000").split(",").map((s) => s.trim());

// Best-effort abuse limits per warm instance: per-IP burst limit plus an hourly ceiling.
const RATE = { perIp: 20, windowMs: 10 * 60 * 1000, perHour: Number(process.env.MAX_CALLS_PER_HOUR || 200) };
const hits = new Map();
let hour = { start: Date.now(), count: 0 };
function allow(ip) {
  const now = Date.now();
  if (now - hour.start > 3600000) hour = { start: now, count: 0 };
  if (hour.count >= RATE.perHour) return false;
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  if (list.length >= RATE.perIp) return false;
  list.push(now); hits.set(ip, list); hour.count++;
  return true;
}

// The browser sends the demo user's journey; keep only the fields the prompt uses, with length caps.
function sanitizePersona(p) {
  if (!p || typeof p !== "object") return null;
  return {
    name: clip(p.name, 40), role: clip(p.role, 80), lang: clip(p.lang, 80),
    counsellor: p.counsellor ? clip(p.counsellor, 20) : null, counsellorName: p.counsellorName ? clip(p.counsellorName, 60) : null,
    moods: (Array.isArray(p.moods) ? p.moods : []).slice(-7).map((m) => Math.min(5, Math.max(1, Number(m) || 3))),
    history: (Array.isArray(p.history) ? p.history : []).slice(-8).map((h) => ({ date: clip(h.date, 12), id: h.id ? clip(h.id, 30) : null, text: clip(h.text, 160) })),
  };
}

export default async (req, context) => {
  const origin = req.headers.get("origin") || "";
  const okOrigin = ALLOWED.includes(origin);
  const cors = okOrigin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type" } : {};
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } });

  // OPTIONS doubles as the page's "is live AI available here?" probe.
  if (req.method === "OPTIONS") return new Response(null, { status: okOrigin && process.env.ANTHROPIC_API_KEY ? 200 : 503, headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!okOrigin) return json({ error: "origin not allowed" }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const input = {
    text: clip(body.text, 2000),
    impact: Math.min(5, Math.max(1, Number(body.impact) || 3)),
    preference: ["talk", "self", "unsure"].includes(body.preference) ? body.preference : "unsure",
    clarifications: (Array.isArray(body.clarifications) ? body.clarifications : []).slice(0, 1).map((c) => ({ q: clip(c?.q, 200), a: clip(c?.a, 200) })),
    rejected: (Array.isArray(body.rejected) ? body.rejected : []).map(String).slice(0, 10),
    mood: body.mood == null ? null : Math.min(5, Math.max(1, Number(body.mood) || 3)),
    persona: sanitizePersona(body.persona),
  };

  // Safety never depends on the model.
  if (safetyScreen([input.text, ...input.clarifications.map((c) => c.a)].join(" ")) === "crisis") return json({ ...rulesEngine(input), risk_level: "crisis" });
  if (!allow(context?.ip || "unknown")) return json({ ...rulesEngine(input), _fallback: "rate_limited" });

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: RESULT_SCHEMA } },
      messages: [{ role: "user", content: buildPrompt(input) }],
    });
    if (response.stop_reason === "refusal") throw new Error("refusal");
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return json(validate(JSON.parse(text), input));
  } catch (err) {
    // Any AI failure degrades to the rules engine instead of an error screen.
    console.error("next-step AI error:", err?.status ?? "", err?.message ?? err);
    return json({ ...rulesEngine(input), _fallback: "ai_error" });
  }
};
