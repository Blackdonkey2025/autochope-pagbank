// server.js — PagBank webhook (PIX fixo) → libera ESP32
const express = require("express");
const crypto  = require("crypto");

const app = express();

/* Middlewares */
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); }
}));
app.use(express.urlencoded({
  extended: false,
  verify: (req, _res, buf) => { req.rawBody = (req.rawBody || "") + buf.toString("utf8"); }
}));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-authenticity-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ENV */
const PORT          = process.env.PORT;                    // Render injeta (SEM fallback)
const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN || "";
const ESP32_URL     = process.env.ESP32_URL || "";
const PRICE_CENTS   = Number(process.env.PRICE_CENTS ?? 800); // 800 = R$ 8,00

/* Rotas de verificação */
app.get("/", (_req, res) => res.send("OK - webhook online"));
app.get("/healthz", (_req, res) => res.send("ok"));

/* Teste manual de liberação */
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

/* Webhook PagBank */
const processed = new Set();

app.post("/webhook", async (req, res) => {
  const sig = req.get("x-authenticity-token") || "";
  const raw = req.rawBody || "";
  const calc = crypto.createHash("sha256")
    .update(`${PAGBANK_TOKEN}-${raw}`)
    .digest("hex");
  if (calc !== sig) return res.status(401).send("invalid signature");

  try {
    const evt    = req.body || {};
    const charge = Array.isArray(evt?.charges) ? evt.charges[0] : undefined;
    const status = charge?.status;
    const cents  = Number(charge?.amount?.value);
    const evtId  = evt?.id || charge?.id || evt?.reference_id;
    const method = (charge?.payment_method?.type || "").toUpperCase();

    if (!evtId || processed.has(evtId)) return res.sendStatus(200);

    if (status === "PAID" && method === "PIX" && cents === PRICE_CENTS) {
      processed.add(evtId);
      try {
        const fetch = global.fetch || (await import("node-fetch")).default;
        if (ESP32_URL) {
          await fetch(ESP32_URL, { method: "POST" });
          console.log(`✅ ESP32 liberado | evt=${evtId} | valor=${cents}`);
        } else {
          console.error("ESP32_URL não definida no Environment");
        }
      } catch (e) {
        console.error("Erro ao chamar ESP32:", e);
      }
    } else {
      console.log("Evento ignorado:", { status, method, cents, required: PRICE_CENTS });
    }
    res.sendStatus(200);
  } catch (e) {
    console.error("Erro webhook:", e);
    res.sendStatus(500);
  }
});

/* Start */
app.listen(process.env.PORT, "0.0.0.0", () => {
  console.log(`Servidor na porta ${process.env.PORT} | PRICE_CENTS=${PRICE_CENTS}`);
});
