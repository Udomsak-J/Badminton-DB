const { pushMessage, textMessage } = require("./lib/lineClient");
const svc = require("./lib/sessionService");

// ฟังก์ชันนี้ถูกเรียกอัตโนมัติตามตารางเวลาใน netlify.toml (schedule ของ "billing-check")
exports.handler = async () => {
  const dueSessions = await svc.findSessionsDueForBilling();

  console.log(`พบ ${dueSessions.length} รอบที่ถึงเวลาปิดและคิดบิล`);

  for (const session of dueSessions) {
    try {
      const { billText } = await svc.closeAndBillSession(session.id);
      await pushMessage(session.groupId, textMessage(billText));
      console.log(`ส่งบิลรอบ ${session.id} (${session.courtName}) เรียบร้อย`);
    } catch (err) {
      console.error(`ส่งบิลรอบ ${session.id} ล้มเหลว:`, err);
    }
  }

  return { statusCode: 200, body: `processed ${dueSessions.length} sessions` };
};
