// server.js
const express = require("express");
const crypto = require("crypto");
const fetch = (...args) => import("node-fetch").then(({default: f}) => f(...args));

const app = express();

// Captura o corpo cru p/ validar a assinatura
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); }
}));

const PORT = process.env.PORT || 10000;
const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN || ""; // Token da sua conta (iBanking)
const ESP32_URL = process.env.ESP32_URL || "http://192.168.0.50/unlock";
const ESP32_TOKEN = process.env.ESP32_TOKEN || "";

// idempotência simples
const processed = new Set();

function checkSignature(rawBody, headerSig) {
  if (!PAGBANK_TOKEN || !headerSig) return false;
  const expected = crypto.createHash("sha256")
    .update(`${PAGBANK_TOKEN}-${rawBody}`, "utf8")
    .digest("hex");
  return expected === headerSig;
}

async function openTap({ referenceId, amount, endToEndId }) {
  const res = await fetch(ESP32_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "OPEN_TAP",
      referenceId,
      amount,        // em centavos
      endToEndId,
      token: ESP32_TOKEN || undefined
    })
  });
  if (!res.ok) throw new Error(`ESP32 falhou: ${res.status}`);
}

// Healthcheck
app.get("/", (req, res) => res.send("OK - webhook online"));

// Webhook PagBank
app.post("/pagbank/webhook", async (req, res) => {
  const sig = req.get("x-authenticity-token") || "";

  // 1) valida assinatura
  if (!checkSignature(req.rawBody || "", sig)) {
    console.warn("Assinatura inválida");
    return res.sendStatus(401);
  }

  const body = req.body || {};
  const charge = body?.charges?.[0];
  const status = charge?.status;
  const method = charge?.payment_method?.type;
  const e2e = charge?.payment_method?.pix?.end_to_end_id;
  const amount = charge?.amount?.value;
  const referenceId = body?.reference_id || charge?.reference_id || body?.id;
  const dedup = charge?.payment_method?.pix?.notification_id || charge?.id || body?.id;

  console.log("[Webhook]", { status, method, referenceId, amount });

  if (dedup && processed.has(dedup)) {
    return res.json({ ok: true, duplicated: true });
  }

  if (status === "PAID" && method === "PIX") {
    if (dedup) processed.add(dedup);
    try {
      await openTap({ referenceId, amount, endToEndId: e2e });
      console.log("[Torneira] Liberada:", referenceId);
      return res.json({ ok: true });
    } catch (e) {
      console.error("Falha ESP32:", e);
      // responde 200 para o PagBank não reenviar sem fim
      return res.status(200).json({ ok: false, esp32: true });
    }
  }

  return res.json({ ok: true, ignored: true });
});

// Endpoint de teste manual para a torneira
app.post("/tap/test", async (req, res) => {
  try {
    await openTap({ referenceId: "TESTE_LOCAL", amount: 1000, endToEndId: "LOCAL" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(PORT, () => console.log("Servidor na porta", PORT));
