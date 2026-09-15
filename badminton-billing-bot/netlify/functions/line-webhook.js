const {
  verifySignature,
  replyMessage,
  pushMessage,
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

  await Promise.all(events.map(handleEvent));

  return { statusCode: 200, body: "OK" };
};

async function handleEvent(evt) {
  try {
    const groupId = evt.source.groupId || evt.source.roomId;
    if (!groupId) {
      if (evt.type === "message" && evt.message.type === "text") {
        await replyMessage(
          evt.replyToken,
          textMessage("บอทนี้ใช้งานได้เฉพาะในกลุ่มไลน์เท่านั้นครับ")
        );
      }
      return;
    }

    if (evt.type === "postback") {
      await handlePostback(evt, groupId);
      return;
    }

    if (evt.type !== "message" || evt.message.type !== "text") return;

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
        textMessage(`👉 แตะลิงก์นี้เพื่อเปิดหน้าจัดการรอบ (ดูสถานะ/เปิดรอบใหม่):\nhttps://liff.line.me/${liffId}`)
      );
      return;
    }

    if (text.startsWith("เปิดรอบ")) {
      const parsed = svc.parseOpenSessionCommand(text);
      if (!parsed) {
        await replyMessage(
          evt.replyToken,
          textMessage(
            "รูปแบบไม่ถูกต้องครับ ใช้แบบนี้:\nเปิดรอบ สนามA 20/09/2026 19:00-21:00 ค่าสนาม 600 ค่าลูกแบต 100"
          )
        );
        return;
      }
      const session = await svc.createSession(groupId, userId, parsed);
      await replyMessage(evt.replyToken, svc.buildSessionAnnouncement(session));
      return;
    }

    if (text === "เข้าร่วม" || text === "ออกจากรอบ") {
      const openSessions = await svc.findOpenSessions(groupId);
      if (openSessions.length === 0) {
        await replyMessage(evt.replyToken, textMessage("ยังไม่มีรอบที่เปิดอยู่ครับ"));
        return;
      }
      if (openSessions.length > 1) {
        await replyMessage(
          evt.replyToken,
          textMessage("ตอนนี้มีหลายรอบเปิดอยู่พร้อมกัน กรุณากดปุ่มที่ข้อความของรอบที่ต้องการแทนครับ")
        );
        return;
      }
      const session = openSessions[0];
      if (text === "เข้าร่วม") {
        const result = await svc.joinSessionById(session.id, userId, displayName);
        const msg = !result.ok
          ? `${displayName} เข้าร่วมรอบนี้อยู่แล้วครับ`
          : `✅ ${displayName} เข้าร่วมแล้ว (ตอนนี้ ${(result.session.participants || []).length + 1} คน)`;
        await replyMessage(evt.replyToken, textMessage(msg));
      } else {
        const result = await svc.leaveSessionById(session.id, userId);
        const msg = result.ok ? `↩️ ${displayName} ออกจากรอบแล้ว` : "คุณยังไม่ได้เข้าร่วมรอบนี้ครับ";
        await replyMessage(evt.replyToken, textMessage(msg));
      }
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
        ? `💰 เพิ่มค่าใช้จ่าย ${parsed.amount} บาท${parsed.note ? ` (${parsed.note})` : ""} เข้ารอบล่าสุดแล้ว`
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
      const { billText } = await svc.prepareBill(session.id);
      // ส่งข้อความให้สำเร็จก่อน แล้วค่อย mark billed — กันเคสส่งไม่สำเร็จแต่ปิดรอบไปแล้ว
      await replyMessage(evt.replyToken, textMessage(billText));
      await svc.markSessionBilled(session.id);
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
      if (evt.replyToken) {
        await replyMessage(evt.replyToken, textMessage("เกิดข้อผิดพลาดในระบบ ลองใหม่อีกครั้งครับ"));
      }
    } catch (_) {
      /* ignore secondary failure */
    }
  }
}

async function handlePostback(evt, groupId) {
  const userId = evt.source.userId;
  const params = new URLSearchParams(evt.postback.data);
  const action = params.get("action");
  const sessionId = params.get("sessionId");
  if (!action || !sessionId) return;

  const displayName = await getDisplayNameSafe(groupId, userId);

  if (action === "join") {
    const result = await svc.joinSessionById(sessionId, userId, displayName);
    let msg;
    if (result.ok) {
      msg = `✅ ${displayName} เข้าร่วมแล้ว (ตอนนี้ ${(result.session.participants || []).length + 1} คน)`;
    } else if (result.reason === "already_joined") {
      msg = `${displayName} เข้าร่วมรอบนี้อยู่แล้วครับ`;
    } else {
      msg = "รอบนี้ปิดรับแล้ว หรือไม่พบรอบนี้ในระบบครับ";
    }
    await replyMessage(evt.replyToken, textMessage(msg));
    return;
  }

  if (action === "leave") {
    const result = await svc.leaveSessionById(sessionId, userId);
    const msg = result.ok ? `↩️ ${displayName} ออกจากรอบแล้ว` : "คุณยังไม่ได้เข้าร่วมรอบนี้ครับ";
    await replyMessage(evt.replyToken, textMessage(msg));
    return;
  }
}

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
