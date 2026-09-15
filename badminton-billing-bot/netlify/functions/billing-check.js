const { pushMessage, textMessage } = require("./lib/lineClient");
const svc = require("./lib/sessionService");

// ฟังก์ชันนี้ถูกเรียกอัตโนมัติตามตารางเวลาใน netlify.toml (schedule ของ "billing-check")
exports.handler = async () => {
  const dueSessions = await svc.findSessionsDueForBilling();

  console.log(`พบ ${dueSessions.length} รอบที่ถึงเวลาปิดและคิดบิล`);

  for (const session of dueSessions) {
    try {
      const { billText } = await svc.prepareBill(session.id);
      // ส่งข้อความก่อน — ถ้า LINE API ล้มเหลว callLineApi จะ throw แล้วกระโดดไป catch ทันที
      // โดยที่ยังไม่ได้ mark ว่า billed รอบนี้จึงยังเป็น "open" รอให้รอบถัดไปของ billing-check ลองใหม่ได้
      await pushMessage(session.groupId, textMessage(billText));
      // ส่งสำเร็จแน่นอนแล้วเท่านั้น ถึงจะ mark ว่าปิดบิล
      await svc.markSessionBilled(session.id);
      console.log(`ส่งบิลรอบ ${session.id} (${session.location}) เรียบร้อย`);
    } catch (err) {
      console.error(`ส่งบิลรอบ ${session.id} ล้มเหลว:`, err);
    }
  }

  return { statusCode: 200, body: `processed ${dueSessions.length} sessions` };
};
