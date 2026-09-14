const { getDb, admin } = require("./firebaseAdmin");

const BANGKOK_OFFSET_HOURS = 7;

// แปลง "YYYY-MM-DD" + "HH:mm" (ตามเวลาไทย) ให้เป็น Date (UTC) เก็บลง Firestore
function bangkokDateTimeToUtc(dateStr, hhmm) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, h, m, 0);
  return new Date(asIfUtc - BANGKOK_OFFSET_HOURS * 3600 * 1000);
}

// "YYYY-MM-DD" -> "DD/MM/YYYY" สำหรับแสดงผล
function formatDateDisplay(dateStr) {
  const [y, mo, d] = dateStr.split("-");
  return `${d}/${mo}/${y}`;
}

// "DD/MM/YYYY" -> "YYYY-MM-DD"
function parseDateDDMMYYYY(str) {
  const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function todayDateStrBangkok() {
  const now = new Date();
  const bangkokNow = new Date(now.getTime() + BANGKOK_OFFSET_HOURS * 3600 * 1000);
  const y = bangkokNow.getUTCFullYear();
  const mo = String(bangkokNow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bangkokNow.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

const HELP_TEXT = [
  "📋 คำสั่งที่ใช้ได้:",
  "สร้างรอบ — เปิดหน้าเว็บสำหรับผู้จัดก๊วนดูสถานะ/เปิดรอบ",
  "เปิดรอบ [สถานที่] [DD/MM/YYYY] [HH:mm-HH:mm] ค่าสนาม [บาท] ค่าลูกแบต [บาท] ค่าอื่นๆ [บาท] — เปิดรอบด้วยข้อความ",
  "  เช่น: เปิดรอบ สนามA 20/09/2026 19:00-21:00 ค่าสนาม 600 ค่าลูกแบต 100",
  "เข้าร่วม / ออกจากรอบ — ใช้ได้เมื่อมีรอบเปิดอยู่รอบเดียว (ถ้ามีหลายรอบ ให้กดปุ่มที่ข้อความของรอบนั้นแทน)",
  "เพิ่มค่าใช้จ่าย [บาท] [รายละเอียด] — เพิ่มค่าใช้จ่ายเข้ารอบล่าสุดที่เปิดอยู่",
  "สรุปรอบ — ปิดรอบล่าสุดและคิดบิลทันที",
  "ยกเลิกรอบ — ยกเลิกรอบล่าสุดโดยไม่คิดเงิน",
].join("\n");

function parseOpenSessionCommand(text) {
  // เช่น "เปิดรอบ สนามA 20/09/2026 19:00-21:00 ค่าสนาม 600 ค่าลูกแบต 100 ค่าอื่นๆ 50"
  const re =
    /^เปิดรอบ\s+(\S+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+ค่าสนาม\s+(\d+(?:\.\d+)?)(?:\s+ค่าลูกแบต\s+(\d+(?:\.\d+)?))?(?:\s+ค่าอื่นๆ\s+(\d+(?:\.\d+)?))?/u;
  const match = text.trim().match(re);
  if (!match) return null;
  const [, location, dateDDMMYYYY, startStr, endStr, courtFeeStr, shuttlecockFeeStr, otherFeeStr] = match;
  const dateStr = parseDateDDMMYYYY(dateDDMMYYYY);
  if (!dateStr) return null;
  return {
    location,
    dateStr,
    startStr,
    endStr,
    courtFee: parseFloat(courtFeeStr),
    shuttlecockFee: shuttlecockFeeStr ? parseFloat(shuttlecockFeeStr) : 0,
    otherFee: otherFeeStr ? parseFloat(otherFeeStr) : 0,
  };
}

function parseAddExpenseCommand(text) {
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

// คืนรอบที่เปิดอยู่ทั้งหมดของกลุ่ม เรียงตามเวลาที่จะเริ่มเล่น (ใกล้สุดก่อน)
async function findOpenSessions(groupId) {
  const db = getDb();
  const snap = await db
    .collection("sessions")
    .where("groupId", "==", groupId)
    .where("status", "==", "open")
    .orderBy("startTime", "asc")
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// รอบล่าสุด (ทุกสถานะ) ของกลุ่ม ไว้แสดงประวัติในแดชบอร์ด
async function findRecentSessions(groupId, limit = 15) {
  const db = getDb();
  const snap = await db
    .collection("sessions")
    .where("groupId", "==", groupId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getSessionById(sessionId) {
  const db = getDb();
  const snap = await db.collection("sessions").doc(sessionId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function createSession(groupId, userId, parsed) {
  const db = getDb();
  const startTime = bangkokDateTimeToUtc(parsed.dateStr, parsed.startStr);
  const endTime = bangkokDateTimeToUtc(parsed.dateStr, parsed.endStr);
  const doc = await db.collection("sessions").add({
    groupId,
    location: parsed.location,
    dateStr: parsed.dateStr,
    dateDisplay: formatDateDisplay(parsed.dateStr),
    startStr: parsed.startStr,
    endStr: parsed.endStr,
    startTime: admin.firestore.Timestamp.fromDate(startTime),
    endTime: admin.firestore.Timestamp.fromDate(endTime),
    courtFee: parsed.courtFee,
    shuttlecockFee: parsed.shuttlecockFee || 0,
    otherFee: parsed.otherFee || 0,
    otherNotes: [],
    status: "open",
    createdBy: userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    participants: [],
  });
  const created = await doc.get();
  return { id: doc.id, ...created.data() };
}

async function joinSessionById(sessionId, userId, displayName) {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== "open") return { ok: false, reason: "not_open" };
  const already = (session.participants || []).some((p) => p.userId === userId);
  if (already) return { ok: false, reason: "already_joined", session };
  const db = getDb();
  await db
    .collection("sessions")
    .doc(sessionId)
    .update({
      participants: admin.firestore.FieldValue.arrayUnion({ userId, displayName }),
    });
  return { ok: true, session };
}

async function leaveSessionById(sessionId, userId) {
  const session = await getSessionById(sessionId);
  if (!session) return { ok: false, reason: "not_found" };
  const target = (session.participants || []).find((p) => p.userId === userId);
  if (!target) return { ok: false, reason: "not_joined" };
  const db = getDb();
  await db
    .collection("sessions")
    .doc(sessionId)
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
      otherFee: admin.firestore.FieldValue.increment(amount),
      otherNotes: admin.firestore.FieldValue.arrayUnion(
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

function sessionTotal(session) {
  return (session.courtFee || 0) + (session.shuttlecockFee || 0) + (session.otherFee || 0);
}

function buildBillText(session) {
  const total = sessionTotal(session);
  const participants = session.participants || [];
  const count = participants.length;

  const lines = [
    `🏸 สรุปค่าใช้จ่าย: ${session.location}`,
    `วันที่ ${session.dateDisplay} เวลา ${session.startStr}-${session.endStr} น.`,
    `ค่าสนาม: ${session.courtFee} บาท`,
  ];
  if (session.shuttlecockFee) lines.push(`ค่าลูกแบต: ${session.shuttlecockFee} บาท`);
  if (session.otherFee) lines.push(`ค่าใช้จ่ายอื่นๆ: ${session.otherFee} บาท`);
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

// ข้อความ template แบบมีปุ่ม "เข้าร่วม"/"ออกจากรอบ" ผูกกับ sessionId เจาะจง
function buildSessionAnnouncement(session) {
  const total = sessionTotal(session);
  const title = session.location.slice(0, 40);
  const text = `${session.dateDisplay} ${session.startStr}-${session.endStr} น. | รวม ${total} บาท`.slice(0, 60);
  return {
    type: "template",
    altText: `เปิดรอบ ${session.location} วันที่ ${session.dateDisplay} เวลา ${session.startStr}-${session.endStr}`,
    template: {
      type: "buttons",
      title,
      text,
      actions: [
        { type: "postback", label: "✅ เข้าร่วม", data: `action=join&sessionId=${session.id}` },
        { type: "postback", label: "❌ ออกจากรอบ", data: `action=leave&sessionId=${session.id}` },
      ],
    },
  };
}

module.exports = {
  HELP_TEXT,
  todayDateStrBangkok,
  formatDateDisplay,
  parseOpenSessionCommand,
  parseAddExpenseCommand,
  findLatestOpenSession,
  findOpenSessions,
  findRecentSessions,
  getSessionById,
  createSession,
  joinSessionById,
  leaveSessionById,
  addExpense,
  cancelSession,
  sessionTotal,
  buildBillText,
  closeAndBillSession,
  findSessionsDueForBilling,
  buildSessionAnnouncement,
};
