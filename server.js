// server.js — Autosserviço PagBank (PIX dinâmico) → libera ESP32 por polling
// CommonJS (node server.js)

const express = require("express");
const crypto  = require("crypto");

const app = express();

/* ===================== Middlewares ===================== */
// Guarda o corpo CRU (necessário p/ validar a assinatura do PagBank)
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); }
}));
app.use(express.urlencoded({
  extended: false,
  verify: (req, _res, buf) => { req.rawBody = (req.rawBody || "") + buf.toString("utf8"); }
}));
// CORS simples (útil p/ testes no navegador)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-authenticity-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

<<<<<<< HEAD
/* ENV */
const PORT          = process.env.PORT;                    // Render injeta (SEM fallback)
const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN || "";
const ESP32_URL     = process.env.ESP32_URL || "";
const PRICE_CENTS   = Number(process.env.PRICE_CENTS ?? 800); // 800 = R$ 8,00
=======
/* ===================== ENV ===================== */
const PORT                     = Number(process.env.PORT || 10000);
// Token para ASSINATURA do webhook (iBanking → Integrações → Token)
const PAGBANK_WEBHOOK_TOKEN    = process.env.PAGBANK_WEBHOOK_TOKEN
                              || process.env.PAGBANK_TOKEN || "";
// Token para CHAMAR API do PagBank (Bearer produção)
const PAGBANK_ACCESS_TOKEN     = process.env.PAGBANK_ACCESS_TOKEN || "";
// Preço em centavos (ex.: 800 = R$ 8,00)
const PRICE_CENTS              = Number(process.env.PRICE_CENTS ?? 800);
// Janela de liberação em segundos
const POUR_SECONDS             = Number(process.env.POUR_SECONDS ?? 10);
// “Senha” simples para o ESP32 chamar o /esp32/poll
const ESP32_DEVICE_KEY         = process.env.ESP32_DEVICE_KEY || "bd-esp32";
// Descrição do pedido (opcional)
const ORDER_DESCRIPTION        = process.env.ORDER_DESCRIPTION || "Chope Black Donkey - Tap1";
// Caso queira forçar a URL do webhook ao criar orders
const WEBHOOK_URL              = process.env.WEBHOOK_URL || "";
>>>>>>> 1fad05d (Autosserviço: webhook PagBank + polling ESP32 + /order)

/* ===================== Estado ===================== */
let unlockUntilMs = 0;                 // quando expira a liberação
const processed   = new Set();         // dedupe de eventos

/* ===================== Utils ===================== */
const fetch = (...args) =>
  (global.fetch ? global.fetch(...args) : import("node-fetch").then(({ default: f }) => f(...args)));

function log(...a){ console.log(new Date().toISOString(), ...a); }

/* ===================== Rotas de verificação ===================== */
app.get("/", (_req, res) => res.send("OK - webhook online"));
app.get("/healthz", (_req, res) => res.send("ok"));

/* ===================== Criar pedido + QR PIX ===================== */
/**
 * POST /order
 * body: { value_cents?: number }
 * -> Cria um pedido com QR PIX único e retorna EMV/PNG/Base64.
 */
app.post("/order", async (req, res) => {
  try {
    const value = Number(req.body?.value_cents ?? PRICE_CENTS);
    if (!PAGBANK_ACCESS_TOKEN) {
      return res.status(500).json({ error: "missing PAGBANK_ACCESS_TOKEN" });
    }

    // Define notification_url: usa ENV se houver, senão monta com host atual
    const notifyUrl = WEBHOOK_URL || `https://${req.get("host")}/webhook`;

    const payload = {
      reference_id: `tap1-${Date.now()}`,
      items: [{ name: ORDER_DESCRIPTION, quantity: 1, unit_amount: value }],
      qr_codes: [{ amount: { value } }],          // gera QR PIX
      notification_urls: [ notifyUrl ]
    };

    const r = await fetch("https://api.pagseguro.com/orders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PAGBANK_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json();
    if (!r.ok) {
      log("Erro /order:", r.status, data);
      return res.status(500).json({ error: "order_create_failed", details: data });
    }

    const qr = (data && data.qr_codes && data.qr_codes[0]) || {};
    const links = Array.isArray(qr.links) ? qr.links : [];
    const linkPng   = links.find(l => l.rel === "QRCODE.PNG")?.href || null;
    const linkB64   = links.find(l => l.rel === "QRCODE.BASE64")?.href || null;

    res.json({
      ok: true,
      order_id: data.id,
      amount: value,
      qr_emv: qr.text || null,
      qr_png: linkPng,
      qr_base64: linkB64,
      notification_url: notifyUrl
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "order_exception" });
  }
});

/* ===================== Webhook PagBank ===================== */
/**
 * POST /webhook
 * Valida assinatura x-authenticity-token = sha256(TOKEN + "-" + rawBody)
 * Se PAID/PIX pelo valor esperado, agenda liberação por POUR_SECONDS.
 */
app.post("/webhook", async (req, res) => {
  // 1) Validar assinatura
  try {
    const sig = req.get("x-authenticity-token") || "";
    const raw = req.rawBody || "";
    const expected = crypto.createHash("sha256")
      .update(`${PAGBANK_WEBHOOK_TOKEN}-${raw}`)
      .digest("hex");

    if (expected !== sig) {
      log("Assinatura inválida");
      return res.status(401).send("invalid signature");
    }
  } catch (err) {
    log("Falha ao validar assinatura", err);
    // por segurança, não processa
    return res.sendStatus(200);
  }

  try {
    // 2) Extrair dados
    const evt    = req.body || {};
    const charge = Array.isArray(evt?.charges) ? evt.charges[0] : undefined;
    const status = charge?.status;
    const cents  = Number(charge?.amount?.value);
    const evtId  = evt?.id || charge?.id || evt?.reference_id || null;
    const method = (charge?.payment_method?.type || "").toUpperCase();

    // 3) Dedupe
    if (!evtId || processed.has(evtId)) return res.sendStatus(200);

    // 4) Regra de liberação
    if (status === "PAID" && method === "PIX" && cents === PRICE_CENTS) {
      processed.add(evtId);
      unlockUntilMs = Date.now() + POUR_SECONDS * 1000;
      log(`✅ Liberação agendada por ${POUR_SECONDS}s | evt=${evtId} | valor=${cents}`);
    } else {
      log("Evento ignorado", { status, method, cents, required: PRICE_CENTS });
    }

    // 5) Sempre 200 para evitar retries excessivos
    res.sendStatus(200);
  } catch (e) {
    console.error("Erro webhook:", e);
    res.sendStatus(200);
  }
});

<<<<<<< HEAD
/* Start */
app.listen(process.env.PORT, "0.0.0.0", () => {
  console.log(`Servidor na porta ${process.env.PORT} | PRICE_CENTS=${PRICE_CENTS}`);
=======
/* ===================== Polling do ESP32 ===================== */
/**
 * GET /esp32/poll?key=...
 * -> { release_ms: number }
 */
app.get("/esp32/poll", (req, res) => {
  if (ESP32_DEVICE_KEY && req.query.key !== ESP32_DEVICE_KEY) {
    return res.status(401).send("unauthorized");
  }
  const ms = Math.max(0, unlockUntilMs - Date.now());
  res.json({ release_ms: ms });
});

/* ===================== Debug (opcional) ===================== */
// Liberação manual para teste sem pagamento
app.post("/debug/unlock", (_req, res) => {
  unlockUntilMs = Date.now() + POUR_SECONDS * 1000;
  res.json({ ok: true, until: unlockUntilMs });
});

/* ===================== Start ===================== */
app.listen(PORT, "0.0.0.0", () => {
  log(`Servidor na porta ${PORT} | PRICE_CENTS=${PRICE_CENTS}`);
>>>>>>> 1fad05d (Autosserviço: webhook PagBank + polling ESP32 + /order)
});
