// server.js — PagBank webhook (PIX fixo) → libera ESP32
const express = require("express");
const crypto  = require("crypto");

const app = express();

/* ===================== Middlewares ===================== */
// Captura o corpo CRU para validar a assinatura do PagBank
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); }
}));
// (opcional) aceita também x-www-form-urlencoded, se algum evento vier assim
app.use(express.urlencoded({
  extended: false,
  verify: (req, _res, buf) => { req.rawBody = (req.rawBody || "") + buf.toString("utf8"); }
}));
// CORS simples (útil se for chamar rotas via navegador/outra origem)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-authenticity-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ===================== ENV ===================== */
const PORT          = process.env.PORT;                    // Render injeta (NÃO usar fallback)
const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN || "";     // iBanking → Integrações → Token
const ESP32_URL     = process.env.ESP32_URL || "";         // ex.: http://192.168.0.50/unlock
const PRICE_CENTS   = Number(process.env.PRICE_CENTS ?? 800); // 800 = R$ 8,00

/* ===================== Rotas de verificação ===================== */
app.get("/", (_req, res) => res.send("OK - webhook online"));
app.get("/healthz", (_req, res) => res.send("ok"));

// Teste manual de liberação do ESP32
app.post("/test/unlock", async (_req, res) => {
  try {
    const fetch = global.fetch || (await import("node-fetch")).default;
    if (!ESP32_URL) return res.status(400).send("Defina ESP32_URL no Environment");
    const r = await fetch(ESP32_URL, { method: "POST" });
    res.status(200).send(`POST ${ESP32_URL} => ${r.status}`);
  } catch (e) {
    console.error("Erro /test/unlock:", e);
    res.status(500).send(String(e));
  }
});

/* ===================== Webhook PagBank ===================== */
// idempotência simples em memória (evita processar o mesmo evento 2x)
const processed = new Set();

app.post("/webhook", async (req, res) => {
  // 1) Valida assinatura: sha256(PAGBANK_TOKEN + "-" + corpoCru)
  const sig = req.get("x-authenticity-token") || "";
  const raw = req.rawBody || "";
  const calc = crypto.createHash("sha256")
    .update(`${PAGBANK_TOKEN}-${raw}`)
    .digest("hex");

  if (calc !== sig) return res.status(401).send("invalid signature");

  try {
    // 2) Lê evento e filtra
    const evt    = req.body || {};
    const charge = Array.isArray(evt?.charges) ? evt.charges[0] : undefined;
    const status = charge?.status;                 // esperado: "PAID"
    const cents  = Number(charge?.amount?.value);  // centavos recebidos
    const evtId  = evt?.id || charge?.id || evt?.reference_id;
    const method = (charge?.payment_method?.type || "").toUpperCase(); // "PIX"

    // 3) Idempotência
    if (!evtId || processed.has(evtId)) return res.sendStatus(200);

    // 4) Condição para liberar
    if (status === "PAID" && method === "PIX" && cents === PRICE_CENTS) {
      processed.add(evtId);
      try {
        const fetch = global.fetch || (await import("node-fetch")).default;
        if (!ESP32_URL) {
          console.error("ESP32_URL não definida no Environment");
        } else {
          await fetch(ESP32_URL, { method: "POST" });
          console.log(`✅ ESP32 liberado | evt=${evtId} | valor=${cents}`);
        }
      } catch (e) {
        console.error("Erro ao chamar ESP32:", e);
      }
    } else {
      console.log("Evento ignorado:", { status, method, cents, required: PRICE_CENTS });
    }

    // 5) Sempre 200 para o PagBank não re-tentar indefinidamente
    return res.sendStatus(200);
  } catch (e) {
    console.error("Erro webhook:", e);
    return res.sendStatus(500);
  }
});

/* ===================== Start ===================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor na porta ${PORT} | PRICE_CENTS=${PRICE_CENTS}`);
});
