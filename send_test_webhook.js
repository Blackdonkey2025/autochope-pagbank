// send_test_webhook.js
const fs = require("fs");
const crypto = require("crypto");
const fetch = (...a) => import("node-fetch").then(({default:f}) => f(...a));

// seu token do iBanking (o MESMO que está nas envs do Render)
const TOKEN = process.env.PAGBANK_TOKEN;
if (!TOKEN) { console.error("Defina PAGBANK_TOKEN"); process.exit(1); }

// 1) lê o payload CRU
const raw = fs.readFileSync("payload.json", "utf8");

// 2) gera a assinatura
const sig = crypto.createHash("sha256").update(`${TOKEN}-${raw}`, "utf8").digest("hex");
console.log("Assinatura:", sig);

// 3) envia pro webhook no Render
(async () => {
  const res = await fetch("https://autochope-pagbank.onrender.com/pagbank/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-authenticity-token": sig },
    body: raw
  });
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Resposta:", text);
})();
