// Cloudflare Pages Function: receives the website enquiry form and notifies you.
// Set these in Cloudflare Pages > Settings > Variables and Secrets.
//
// Telegram phone notification (recommended):
//   TELEGRAM_BOT_TOKEN  (secret)  the token BotFather gives you
//   TELEGRAM_CHAT_ID              your chat ID with the bot
//
// Email via Resend (optional backup, leave unset to skip):
//   RESEND_API_KEY  (secret)  your Resend API key
//   ENQUIRY_TO               the inbox enquiries should go to
//   ENQUIRY_FROM             a sender on your verified Resend domain, e.g. "Khulisa Website <enquiries@khulisagroup.com>"
//
// The enquiry counts as sent if at least one channel succeeds.

const escape = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sendTelegram(env, e) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return null;
  const text =
    `<b>New Khulisa enquiry</b>\n\n` +
    `<b>Name:</b> ${escape(e.name)}\n` +
    `<b>Email:</b> ${escape(e.email)}\n` +
    `<b>Organisation:</b> ${escape(e.organisation) || "Not given"}\n` +
    `<b>Type:</b> ${escape(e.orgtype)}\n` +
    `<b>Based in:</b> ${escape(e.location)}\n` +
    `<b>Service:</b> ${escape(e.service)}\n\n` +
    `${escape(e.message).slice(0, 3500)}`;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  });
  return res.ok;
}

async function sendEmail(env, e) {
  if (!env.RESEND_API_KEY || !env.ENQUIRY_TO || !env.ENQUIRY_FROM) return null;
  const html = `
    <h2>New website enquiry</h2>
    <p><strong>Name:</strong> ${escape(e.name)}</p>
    <p><strong>Email:</strong> ${escape(e.email)}</p>
    <p><strong>Organisation:</strong> ${escape(e.organisation) || "Not given"}</p>
    <p><strong>Type:</strong> ${escape(e.orgtype)}</p>
    <p><strong>Based in:</strong> ${escape(e.location)}</p>
    <p><strong>Service:</strong> ${escape(e.service)}</p>
    <p><strong>Message:</strong></p>
    <p>${escape(e.message).replace(/\n/g, "<br>")}</p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.ENQUIRY_FROM,
      to: [env.ENQUIRY_TO],
      reply_to: e.email,
      subject: `Website enquiry (${e.location}): ${e.service} (${e.name})`,
      html,
    }),
  });
  return res.ok;
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  // Spam trap: real people never fill in the hidden "website" field.
  if (data.website) return json({ ok: true });

  const e = {
    name: (data.name || "").trim().slice(0, 120),
    email: (data.email || "").trim().slice(0, 200),
    organisation: (data.organisation || "").trim().slice(0, 160),
    service: (data.service || "").trim().slice(0, 100),
    orgtype: (data.orgtype || "").trim().slice(0, 80),
    location: (data.location || "").trim().slice(0, 40),
    message: (data.message || "").trim().slice(0, 5000),
  };

  if (!e.name || !e.message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)) {
    return json({ error: "Missing or invalid fields" }, 400);
  }

  const results = await Promise.allSettled([sendTelegram(env, e), sendEmail(env, e)]);
  const anySent = results.some((r) => r.status === "fulfilled" && r.value === true);

  if (!anySent) return json({ error: "Notification failed" }, 502);
  return json({ ok: true });
}
