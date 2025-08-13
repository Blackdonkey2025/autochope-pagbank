// server.js (PagBank → Webhook → ESP32) — valor fixo R$ 8,00 por padrão
const express = require("express");
const crypto  = require("crypto");

const app = express();

// ===== Middlewares =====
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); }
}));

// (Opcional) CORS simples
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-authenticity-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ===== Env =====
const PORT           = process.env.PORT;                    // Render injeta
const PAGBANK_TOKEN  = process.env.PAGBANK_TOKEN || "";     // iBanking → Integrações → Token
const ESP32_URL      = process.env.ESP32_URL || "";         // ex.: http://192.168.0.50/unlock
const PRICE_CENTS    = Number(process.env.PRICE_CENTS ?? 800); // *** R$ 8,00 ***

// ===== Rotas básicas =====
app.get("/", (_req, res) => res.send("OK - webhook online"));
app.get("/healthz", (_req, res) => res.send("ok"));

// (Opcional) teste manual de liberação
app.post("/test/unlock", async (_req, res) => {
  try {
    const fetch = global.fetch || (await import("node-fetch")).default;
    if (!ESP32_URL) return res.status(400).send("Defina ESP32_URL no Environment");
    const r = await fetch(ESP32_URL, { method: "POST" });
    return res.status(200).send(`POST ${ESP32_URL} => ${r.status}`);
  } catch (e) {
    console.error("Erro /test/unlock:", e);
    return res.status(500).send(String(e));
  }
});

// ===== Webhook PagBank =====
const processed = new Set(); // evita processar o mesmo pagamento 2x

app.post("/webhook", async (req, res) => {
  const sig = req.get("x-authenticity-token") || "";
  const raw = req.rawBody || "";

  // assinatura: sha256(PAGBANK_TOKEN + "-" + corpoCru)
  const calc = crypto.createHash("sha256")
    .update(`${PAGBANK_TOKEN}-${raw}`)
    .digest("hex");

  if (calc !== sig) {
    console.warn("Assinatura inválida");
    return res.status(401).send("invalid signature");
  }

  try {
    const evt    = req.body;
    const charge = evt?.charges?.[0];
    const status = charge?.status;                // esperado: "PAID"
    const cents  = Number(charge?.amount?.value); // centavos recebidos
    const evtId  = evt?.id || charge?.id;

    if (!evtId || processed.has(evtId)) return res.sendStatus(200);

    const methodType = (charge?.payment_method?.type || "").toUpperCase();

    // *** Libera somente PIX pago e com o valor exato configurado ***
    if (status === "PAID" && cents === PRICE_CENTS && methodType === "PIX") {
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
      console.log("Evento ignorado:", { status, cents, methodType, required: PRICE_CENTS });
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error("Erro webhook:", e);
    return res.sendStatus(500);
  }
});

// ===== Start =====
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor na porta ${PORT} | PRICE_CENTS=${PRICE_CENTS}`);
});
