const crypto = require("crypto");

const LINE_API = "https://api.line.me/v2/bot/message";
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// ตรวจลายเซ็นของ webhook ว่ามาจาก LINE จริง ป้องกันคนอื่นยิง request ปลอมเข้ามา
function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const hash = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  return hash === signatureHeader;
}

async function callLineApi(path, body) {
  const res = await fetch(`${LINE_API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(
      "LINE API error:",
      res.status,
      errText,
      "| request body:",
      JSON.stringify(body)
    );
  }
  return res;
}

// ตอบกลับในบทสนทนาเดิม (ใช้ replyToken ที่ได้จาก event ได้ภายใน 1 นาที และใช้ได้ครั้งเดียว)
function replyMessage(replyToken, messages) {
  return callLineApi("/reply", {
    replyToken,
    messages: Array.isArray(messages) ? messages : [messages],
  });
}

// ส่งข้อความเข้ากลุ่ม/ห้องแบบไม่ผูกกับ event ใด ๆ (ใช้สำหรับแจ้งเตือนอัตโนมัติจาก scheduled function)
function pushMessage(to, messages) {
  return callLineApi("/push", {
    to,
    messages: Array.isArray(messages) ? messages : [messages],
  });
}

function textMessage(text) {
  return { type: "text", text };
}

module.exports = { verifySignature, replyMessage, pushMessage, textMessage };
