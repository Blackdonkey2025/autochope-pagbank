// createOrderPix.js
const fetch = (...a) => import("node-fetch").then(({default:f}) => f(...a));

const API_BASE     = process.env.PAGBANK_BASE || "https://sandbox.api.pagseguro.com"; // produção: https://api.pagseguro.com
const ACCESS_TOKEN = process.env.PAGBANK_ACCESS_TOKEN;  // Access Token da API (não é o iBanking)
const WEBHOOK_URL  = process.env.WEBHOOK_URL;           // ex.: https://autochope-pagbank.onrender.com/pagbank/webhook
const VALUE_CENTS  = parseInt(process.env.ORDER_VALUE || "100", 10); // valor em centavos (default R$1,00)
const EXP_MINUTES  = parseInt(process.env.QR_EXPIRE_MIN || "10", 10);

if (!ACCESS_TOKEN || !WEBHOOK_URL) {
  console.error("Defina PAGBANK_ACCESS_TOKEN e WEBHOOK_URL antes de rodar.");
  process.exit(1);
}

const isoPlusMinutes = m => new Date(Date.now() + m*60*1000).toISOString();

(async () => {
  try {
    const body = {
      reference_id: `chope-${Date.now()}`,
      items: [{ name: "Chope Pilsen 300ml", quantity: 1, unit_amount: VALUE_CENTS }],
      customer: {
        name:  process.env.CUSTOMER_NAME  || "Cliente Teste",
        email: process.env.CUSTOMER_EMAIL || "cliente@teste.com",
        tax_id:process.env.CUSTOMER_TAX_ID|| "12345678909",
        phones: [{ country:"55", area: process.env.CUSTOMER_AREA||"11", number:process.env.CUSTOMER_PHONE||"999999999", type:"MOBILE" }]
      },
      qr_codes: [{ amount: { value: VALUE_CENTS }, expiration_date: isoPlusMinutes(EXP_MINUTES) }],
      notification_urls: [WEBHOOK_URL]
    };

    const res = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Falha ao criar pedido:", res.status, JSON.stringify(data, null, 2));
      process.exit(1);
    }

    const qr = data.qr_codes?.[0] || {};
    const linkPng = qr.links?.find(l => l.rel === "QRCODE.PNG")?.href;

    console.log("order_id:     ", data.id);
    console.log("reference_id: ", data.reference_id);
    console.log("QR copia-cola:", qr.text);
    console.log("QR PNG:       ", linkPng);
    console.log("Expira em:    ", body.qr_codes[0].expiration_date);
  } catch (e) {
    console.error("Erro:", e);
    process.exit(1);
  }
})();
