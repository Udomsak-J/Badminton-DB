const { verifyIdToken } = require("./lib/lineLogin");
const { pushMessage, textMessage } = require("./lib/lineClient");
const svc = require("./lib/sessionService");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return jsonRes(400, { error: "invalid_json" });
  }

  const { idToken, groupId, courtName, startStr, endStr, courtFee, extraFee } = payload;

  if (!idToken || !groupId || !courtName || !startStr || !endStr || courtFee == null) {
    return jsonRes(400, { error: "missing_fields" });
  }

  // ยืนยันว่าคนที่ยิง request มานี้ล็อกอินผ่าน LINE จริง ไม่ใช่มั่วขึ้นมาเอง
  let profile;
  try {
    profile = await verifyIdToken(idToken);
  } catch (err) {
    console.error(err);
    return jsonRes(401, { error: "invalid_token" });
  }

  const parsed = {
    courtName: String(courtName).trim(),
    startStr: String(startStr).trim(),
    endStr: String(endStr).trim(),
    courtFee: parseFloat(courtFee),
    extraFee: extraFee ? parseFloat(extraFee) : 0,
  };

  if (!/^\d{1,2}:\d{2}$/.test(parsed.startStr) || !/^\d{1,2}:\d{2}$/.test(parsed.endStr)) {
    return jsonRes(400, { error: "invalid_time_format" });
  }
  if (Number.isNaN(parsed.courtFee) || parsed.courtFee < 0) {
    return jsonRes(400, { error: "invalid_court_fee" });
  }

  try {
    const existing = await svc.findLatestOpenSession(groupId);
    if (existing) {
      return jsonRes(409, {
        error: "session_already_open",
        message: `มีรอบ "${existing.courtName}" เปิดอยู่แล้ว ต้องปิดรอบก่อน (พิมพ์ "สรุปรอบ" หรือ "ยกเลิกรอบ" ในแชท)`,
      });
    }

    const sessionId = await svc.createSession(groupId, profile.sub, parsed);

    await pushMessage(
      groupId,
      textMessage(
        `✅ ${profile.name || "ผู้จัดก๊วน"} เปิดรอบ "${parsed.courtName}" แล้ว\n` +
          `เวลา ${parsed.startStr}-${parsed.endStr}\n` +
          `ค่าสนาม ${parsed.courtFee} บาท${parsed.extraFee ? ` + ค่าอื่นๆ ${parsed.extraFee} บาท` : ""}\n\n` +
          `พิมพ์ "เข้าร่วม" เพื่อลงชื่อเข้าเล่นได้เลยครับ ระบบจะสรุปบิลอัตโนมัติหลังหมดเวลา`
      )
    );

    return jsonRes(200, { ok: true, sessionId });
  } catch (err) {
    console.error("create-session-web error:", err);
    return jsonRes(500, { error: "server_error" });
  }
};

function jsonRes(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
