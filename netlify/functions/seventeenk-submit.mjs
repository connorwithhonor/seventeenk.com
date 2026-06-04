// seventeenk-submit.mjs
// Netlify Function — handles lead form submissions from seventeenk.com/system
// Upserts a contact into HonorElevate (LeadConnector) SCV123 sub-account with
// SeventeenK tags. Mirrors bridgeport-submit.mjs.
//
// Required Netlify env vars (set on the seventeenk Netlify site):
//   GHL_PIT          — Private Integration Token (pit-...) from HonorElevate
//   GHL_LOCATION_ID  — SCV123 sub-account id (fallback hardcoded below)

const GHL_BASE = "https://services.leadconnectorhq.com";
const DEFAULT_LOCATION_ID = "XrUKgftiwmJB0sd9bgXt"; // SCV123

// SCV123 custom field IDs (TEXT fields only here, to avoid picklist mismatch)
const CF = {
  campaign_source:  "HmGljkwiq0gWwHv5WeBR", // TEXT
  property_address: "uHZ9V0kMLLmB7uI0fsyS", // TEXT
};

const TIMELINE_TAG = {
  "just-curious":   "timeline-just-curious",
  "ready-now":      "timeline-ready-now",
  "6-12-months":    "timeline-6-12-months",
  "12-plus-months": "timeline-12-plus-months",
};
const VALID_TIMELINES = Object.keys(TIMELINE_TAG);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonRes(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "https://seventeenk.com",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    },
  });
}

function normalizePhone(input) {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (String(input).trim().startsWith("+")) return "+" + digits;
  return null;
}

function sanitizeText(s, max = 200) {
  if (s == null) return "";
  return String(s).trim().slice(0, max);
}

export default async (req, _context) => {
  if (req.method === "OPTIONS") return jsonRes(204, {});
  if (req.method !== "POST") return jsonRes(405, { ok: false, message: "Method not allowed" });

  let payload;
  try { payload = await req.json(); }
  catch { return jsonRes(400, { ok: false, message: "Invalid JSON" }); }

  // Honeypot
  if (payload._hp && String(payload._hp).trim() !== "") {
    return jsonRes(200, { ok: true, message: "Thanks!" });
  }

  const first_name = sanitizeText(payload.first_name, 80);
  const last_name  = sanitizeText(payload.last_name, 80);
  const email      = sanitizeText(payload.email, 200).toLowerCase();
  const phoneRaw   = sanitizeText(payload.phone, 40);
  const address    = sanitizeText(payload.property_address, 200);
  const timeline   = sanitizeText(payload.timeline, 40);
  const consent    = payload.consent === "on" || payload.consent === true || payload.consent === "true";
  const sourceUrl  = sanitizeText(payload.source_url, 200) || "https://seventeenk.com/system";
  const campaign   = sanitizeText(payload.campaign_source, 60) || "seventeenk-web";

  if (!first_name || !last_name) return jsonRes(400, { ok: false, message: "Name required." });
  if (!EMAIL_RE.test(email))     return jsonRes(400, { ok: false, message: "Valid email required." });
  if (!consent)                  return jsonRes(400, { ok: false, message: "Please confirm the consent checkbox." });
  if (timeline && !VALID_TIMELINES.includes(timeline)) {
    return jsonRes(400, { ok: false, message: "Please choose a valid timeline." });
  }

  const token = process.env.GHL_PIT;
  if (!token) {
    console.error("seventeenk-submit: missing GHL_PIT env var");
    return jsonRes(500, { ok: false, message: "Server misconfigured. Try again later." });
  }
  const locationId = process.env.GHL_LOCATION_ID || DEFAULT_LOCATION_ID;

  const tags = [
    "seventeenk",
    "seventeenk-web-lead",
    "seventeenk-subscriber",
    campaign,
    "form submission",
    "source-scv123",
    timeline ? TIMELINE_TAG[timeline] : null,
  ].filter(Boolean);

  const customFields = [{ id: CF.campaign_source, value: campaign }];
  if (address) customFields.push({ id: CF.property_address, value: address });

  const phone = normalizePhone(phoneRaw);
  const ghlPayload = { locationId, firstName: first_name, lastName: last_name, email, tags, customFields, source: sourceUrl };
  if (phone)   ghlPayload.phone = phone;
  if (address) ghlPayload.address1 = address;

  let ghlRes, ghlBody;
  try {
    ghlRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Version": "2021-07-28",
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(ghlPayload),
    });
    ghlBody = await ghlRes.json().catch(() => ({}));
  } catch (e) {
    console.error("seventeenk-submit: GHL upsert network error", e);
    return jsonRes(502, { ok: false, message: "Upstream temporarily unavailable. Please retry." });
  }

  if (!ghlRes.ok) {
    console.error("seventeenk-submit: GHL upsert non-2xx", ghlRes.status, ghlBody);
    return jsonRes(502, { ok: false, message: "Could not send right now. Please retry or text 661-263-4801." });
  }

  const contactId = ghlBody?.contact?.id || ghlBody?.id || null;
  console.log(`seventeenk-submit: ok contactId=${contactId} email=${email}`);
  return jsonRes(200, { ok: true, message: "Thanks. Connor will send your numbers shortly.", contactId });
};

export const config = { path: "/.netlify/functions/seventeenk-submit" };
