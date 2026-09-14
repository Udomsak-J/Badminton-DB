const { getDb, admin } = require("./firebaseAdmin");

const BANGKOK_OFFSET_HOURS = 7;

// แปลงเวลา "HH:mm" (ตามเวลาไทย) ของ "วันนี้" ให้เป็น Date (UTC) เก็บลง Firestore
function bangkokTimeTodayToUtcDate(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const now = new Date();
  // เวลาปัจจุบันที่ Bangkok = UTC + 7
  const bangkokNow = new Date(now.getTime() + BANGKOK_OFFSET_HOURS * 3600 * 1000);
  const y = bangkokNow.getUTCFullYear();
  const mo = bangkokNow.getUTCMonth();
  const d = bangkokNow.getUTCDate();
  // สร้างเวลา "HH:mm วันนี้ตามเวลาไทย" แล้วลบ offset กลับเป็น UTC จริง
  const asIfUtc = Date.UTC(y, mo, d, h, m, 0);
  return new Date(asIfUtc - BANGKOK_OFFSET_HOURS * 3600 * 1000);
}

function formatBangkokTime(date) {
  return new Date(date.getTime() + BANGKOK_OFFSET_HOURS * 3600 * 1000)
    .toISOString()
    .slice(11, 16);
}

const HELP_TEXT = [
  "📋 คำสั่งที่ใช้ได้:",
  "สร้างรอบ — เปิดหน้าเว็บสำหรับผู้จัดก๊วนกรอกฟอร์มเปิดรอบ",
  "เปิดรอบ [ชื่อสนาม] [HH:mm-HH:mm] ค่าสนาม [บาท] ค่าอื่นๆ [บาท] — เปิดรอบด้วยข้อความ (ไม่ผ่านเว็บ)",
  "  เช่น: เปิดรอบ สนามA 19:00-21:00 ค่าสนาม 600 ค่าอื่นๆ 100",
  "เข้าร่วม — เข้าร่วมรอบล่าสุดที่เปิดอยู่",
  "ออกจากรอบ — ถอนตัวจากรอบล่าสุด",
  "เพิ่มค่าใช้จ่าย [บาท] [รายละเอียด] — เพิ่มค่าใช้จ่ายอื่นๆ เข้ารอบ",
  "สรุปรอบ — ปิดรอบและคิดบิลทันที (ไม่ต้องรอหมดเวลา)",
  "ยกเลิกรอบ — ยกเลิกรอบล่าสุดโดยไม่คิดเงิน",
].join("\n");

function parseOpenSessionCommand(text) {
  // ตัวอย่าง: "เปิดรอบ สนามA 19:00-21:00 ค่าสนาม 600 ค่าอื่นๆ 100"
  const re =
    /^เปิดรอบ\s+(\S+)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+ค่าสนาม\s+(\d+(?:\.\d+)?)(?:\s+ค่าอื่นๆ\s+(\d+(?:\.\d+)?))?/u;
  const match = text.trim().match(re);
  if (!match) return null;
  const [, courtName, startStr, endStr, courtFeeStr, extraFeeStr] = match;
  return {
    courtName,
    startStr,
    endStr,
    courtFee: parseFloat(courtFeeStr),
    extraFee: extraFeeStr ? parseFloat(extraFeeStr) : 0,
  };
}

function parseAddExpenseCommand(text) {
  // ตัวอย่าง: "เพิ่มค่าใช้จ่าย 100 ลูกแบด"
  const re = /^เพิ่มค่าใช้จ่าย\s+(\d+(?:\.\d+)?)\s*(.*)$/u;
  const match = text.trim().match(re);
  if (!match) return null;
  return { amount: parseFloat(match[1]), note: match[2]?.trim() || "" };
}

async function findLatestOpenSession(groupId) {
  const db = getDb();
  const snap = await db
    .collection("sessions")
    .where("groupId", "==", groupId)
    .where("status", "==", "open")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function createSession(groupId, userId, parsed) {
  const db = getDb();
  const endTime = bangkokTimeTodayToUtcDate(parsed.endStr);
  const startTime = bangkokTimeTodayToUtcDate(parsed.startStr);
  const doc = await db.collection("sessions").add({
    groupId,
    courtName: parsed.courtName,
    courtFee: parsed.courtFee,
    extraFee: parsed.extraFee,
    startTime: admin.firestore.Timestamp.fromDate(startTime),
    endTime: admin.firestore.Timestamp.fromDate(endTime),
    status: "open",
    createdBy: userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    participants: [],
  });
  return doc.id;
}

async function joinSession(groupId, userId, displayName) {
  const session = await findLatestOpenSession(groupId);
  if (!session) return { ok: false, reason: "no_open_session" };
  const already = (session.participants || []).some((p) => p.userId === userId);
  if (already) return { ok: false, reason: "already_joined", session };
  const db = getDb();
  await db
    .collection("sessions")
    .doc(session.id)
    .update({
      participants: admin.firestore.FieldValue.arrayUnion({ userId, displayName }),
    });
  return { ok: true, session };
}

async function leaveSession(groupId, userId) {
  const session = await findLatestOpenSession(groupId);
  if (!session) return { ok: false, reason: "no_open_session" };
  const target = (session.participants || []).find((p) => p.userId === userId);
  if (!target) return { ok: false, reason: "not_joined" };
  const db = getDb();
  await db
    .collection("sessions")
    .doc(session.id)
    .update({
      participants: admin.firestore.FieldValue.arrayRemove(target),
    });
  return { ok: true, session };
}

async function addExpense(groupId, amount, note) {
  const session = await findLatestOpenSession(groupId);
  if (!session) return { ok: false, reason: "no_open_session" };
  const db = getDb();
  await db
    .collection("sessions")
    .doc(session.id)
    .update({
      extraFee: admin.firestore.FieldValue.increment(amount),
      extraNotes: admin.firestore.FieldValue.arrayUnion(
        note ? `${note} (${amount} บาท)` : `${amount} บาท`
      ),
    });
  return { ok: true, session };
}

async function cancelSession(groupId) {
  const session = await findLatestOpenSession(groupId);
  if (!session) return { ok: false, reason: "no_open_session" };
  const db = getDb();
  await db.collection("sessions").doc(session.id).update({ status: "cancelled" });
  return { ok: true, session };
}

// คำนวณบิลและสร้างข้อความสรุป
function buildBillText(session) {
  const total = (session.courtFee || 0) + (session.extraFee || 0);
  const participants = session.participants || [];
  const count = participants.length;

  const lines = [
    `🏸 สรุปค่าใช้จ่าย: ${session.courtName}`,
    `เวลา ${formatBangkokTime(session.startTime.toDate())}-${formatBangkokTime(
      session.endTime.toDate()
    )} น.`,
    `ค่าสนาม: ${session.courtFee} บาท`,
  ];
  if (session.extraFee) lines.push(`ค่าใช้จ่ายอื่นๆ: ${session.extraFee} บาท`);
  lines.push(`รวมทั้งหมด: ${total} บาท`);
  lines.push("");

  if (count === 0) {
    lines.push("⚠️ ไม่มีผู้เข้าร่วมในรอบนี้ จึงไม่มีการคิดบิล");
    return lines.join("\n");
  }

  const perPerson = Math.round((total / count) * 100) / 100;
  lines.push(`หารกัน ${count} คน คนละ ${perPerson} บาท`);
  lines.push("");
  lines.push("รายชื่อผู้ต้องชำระ:");
  participants.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.displayName} — ${perPerson} บาท`);
  });
  return lines.join("\n");
}

// ปิดรอบและคิดบิลทันที (ใช้ทั้งจากคำสั่ง "สรุปรอบ" และจาก scheduled function)
async function closeAndBillSession(sessionId) {
  const db = getDb();
  const ref = db.collection("sessions").doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const session = { id: snap.id, ...snap.data() };
  const billText = buildBillText(session);
  await ref.update({ status: "billed", billedAt: admin.firestore.FieldValue.serverTimestamp() });
  return { session, billText };
}

async function findSessionsDueForBilling() {
  const db = getDb();
  const now = admin.firestore.Timestamp.now();
  const snap = await db
    .collection("sessions")
    .where("status", "==", "open")
    .where("endTime", "<=", now)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = {
  HELP_TEXT,
  parseOpenSessionCommand,
  parseAddExpenseCommand,
  findLatestOpenSession,
  createSession,
  joinSession,
  leaveSession,
  addExpense,
  cancelSession,
  buildBillText,
  closeAndBillSession,
  findSessionsDueForBilling,
};
