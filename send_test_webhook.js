// send_test_webhook.js (CommonJS)
const fs = require("fs");
const crypto = require("crypto");
const fetch = (...a) => import("node-fetch").then(({default:f}) => f(...a));

const TOKEN = process.env.PAGBANK_TOKEN;
if (!TOKEN) {
  console.error("Defina PAGBANK_TOKEN antes de rodar (set PAGBANK_TOKEN=...)");
  process.exit(1);
}

// 1) lê o payload cru
const raw = fs.readFileSync("payload.json", "utf8");

// 2) gera a assinatura
const sig = crypto.createHash("sha256").update(`${TOKEN}-${raw}`, "utf8").digest("hex");
console.log("Assinatura gerada:", sig);

// 3) envia para o webhook local
(async () => {
  try {
    const res = await fetch("http://localhost:10000/pagbank/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-authenticity-token": sig
      },
      body: raw
    });
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Resposta:", text);
  } catch (e) {
    console.error("Falha ao enviar:", e);
  }
})();
