const {
  verifySignature,
  replyMessage,
  textMessage,
} = require("./lib/lineClient");
const svc = require("./lib/sessionService");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  const signature = event.headers["x-line-signature"] || event.headers["X-Line-Signature"];
  if (!verifySignature(rawBody, signature)) {
    console.error("Invalid LINE signature");
    return { statusCode: 401, body: "Invalid signature" };
  }

  const body = JSON.parse(rawBody);
  const events = body.events || [];

  // ประมวลผลทุก event แบบขนาน แล้วค่อยตอบ 200 กลับ LINE
  await Promise.all(events.map(handleEvent));

  return { statusCode: 200, body: "OK" };
};

async function handleEvent(evt) {
  try {
    if (evt.type !== "message" || evt.message.type !== "text") return;

    // รับเฉพาะข้อความจากกลุ่ม/ห้อง (ไม่รองรับแชทเดี่ยว เพราะระบบออกแบบมาสำหรับกลุ่ม)
    const groupId = evt.source.groupId || evt.source.roomId;
    if (!groupId) {
      await replyMessage(
        evt.replyToken,
        textMessage("บอทนี้ใช้งานได้เฉพาะในกลุ่มไลน์เท่านั้นครับ")
      );
      return;
    }

    const userId = evt.source.userId;
    const text = evt.message.text.trim();
    const displayName = await getDisplayNameSafe(groupId, userId);

    if (text === "ช่วยเหลือ" || text.toLowerCase() === "help") {
      await replyMessage(evt.replyToken, textMessage(svc.HELP_TEXT));
      return;
    }

    if (text === "สร้างรอบ") {
      const liffId = process.env.LIFF_ID;
      if (!liffId) {
        await replyMessage(
          evt.replyToken,
          textMessage("ยังไม่ได้ตั้งค่าหน้าเว็บ (LIFF_ID) บนระบบครับ ใช้คำสั่ง \"เปิดรอบ ...\" แบบข้อความไปก่อนได้")
        );
        return;
      }
      await replyMessage(
        evt.replyToken,
        textMessage(`👉 แตะลิงก์นี้เพื่อเปิดฟอร์มสร้างรอบ:\nhttps://liff.line.me/${liffId}`)
      );
      return;
    }

    if (text.startsWith("เปิดรอบ")) {
      const parsed = svc.parseOpenSessionCommand(text);
      if (!parsed) {
        await replyMessage(
          evt.replyToken,
          textMessage(
            "รูปแบบไม่ถูกต้องครับ ใช้แบบนี้:\nเปิดรอบ สนามA 19:00-21:00 ค่าสนาม 600 ค่าอื่นๆ 100"
          )
        );
        return;
      }
      await svc.createSession(groupId, userId, parsed);
      await replyMessage(
        evt.replyToken,
        textMessage(
          `✅ เปิดรอบ "${parsed.courtName}" เวลา ${parsed.startStr}-${parsed.endStr} แล้ว\nพิมพ์ "เข้าร่วม" เพื่อลงชื่อเข้าเล่นได้เลยครับ\nระบบจะสรุปบิลอัตโนมัติหลังหมดเวลา`
        )
      );
      return;
    }

    if (text === "เข้าร่วม") {
      const result = await svc.joinSession(groupId, userId, displayName);
      if (!result.ok) {
        const msg =
          result.reason === "no_open_session"
            ? "ยังไม่มีรอบที่เปิดอยู่ครับ พิมพ์ \"เปิดรอบ\" เพื่อเปิดรอบใหม่"
            : `${displayName} เข้าร่วมรอบนี้อยู่แล้วครับ`;
        await replyMessage(evt.replyToken, textMessage(msg));
        return;
      }
      const count = (result.session.participants || []).length + 1;
      await replyMessage(
        evt.replyToken,
        textMessage(`✅ ${displayName} เข้าร่วมแล้ว (ตอนนี้ ${count} คน)`)
      );
      return;
    }

    if (text === "ออกจากรอบ") {
      const result = await svc.leaveSession(groupId, userId);
      const msg = result.ok
        ? `↩️ ${displayName} ออกจากรอบแล้ว`
        : "คุณยังไม่ได้เข้าร่วมรอบนี้ครับ";
      await replyMessage(evt.replyToken, textMessage(msg));
      return;
    }

    if (text.startsWith("เพิ่มค่าใช้จ่าย")) {
      const parsed = svc.parseAddExpenseCommand(text);
      if (!parsed) {
        await replyMessage(
          evt.replyToken,
          textMessage('รูปแบบไม่ถูกต้องครับ ใช้แบบนี้: "เพิ่มค่าใช้จ่าย 100 ลูกแบด"')
        );
        return;
      }
      const result = await svc.addExpense(groupId, parsed.amount, parsed.note);
      const msg = result.ok
        ? `💰 เพิ่มค่าใช้จ่าย ${parsed.amount} บาท${parsed.note ? ` (${parsed.note})` : ""} แล้ว`
        : "ยังไม่มีรอบที่เปิดอยู่ครับ";
      await replyMessage(evt.replyToken, textMessage(msg));
      return;
    }

    if (text === "สรุปรอบ") {
      const session = await svc.findLatestOpenSession(groupId);
      if (!session) {
        await replyMessage(evt.replyToken, textMessage("ยังไม่มีรอบที่เปิดอยู่ครับ"));
        return;
      }
      const { billText } = await svc.closeAndBillSession(session.id);
      await replyMessage(evt.replyToken, textMessage(billText));
      return;
    }

    if (text === "ยกเลิกรอบ") {
      const result = await svc.cancelSession(groupId);
      const msg = result.ok ? "🗑️ ยกเลิกรอบล่าสุดแล้ว (ไม่มีการคิดเงิน)" : "ยังไม่มีรอบที่เปิดอยู่ครับ";
      await replyMessage(evt.replyToken, textMessage(msg));
      return;
    }
  } catch (err) {
    console.error("handleEvent error:", err);
    try {
      await replyMessage(evt.replyToken, textMessage("เกิดข้อผิดพลาดในระบบ ลองใหม่อีกครั้งครับ"));
    } catch (_) {
      /* ignore secondary failure */
    }
  }
}

// ดึงชื่อสมาชิกกลุ่มจาก LINE Profile API (ถ้าดึงไม่ได้ให้ fallback เป็น userId ย่อ)
async function getDisplayNameSafe(groupId, userId) {
  try {
    const res = await fetch(
      `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`,
      { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    return data.displayName || userId.slice(0, 6);
  } catch (err) {
    console.error("getDisplayName failed:", err);
    return userId.slice(0, 6);
  }
}
