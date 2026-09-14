const admin = require("firebase-admin");

// กัน error "app already exists" เวลา function ถูกเรียกซ้ำใน container เดียวกัน (warm start)
function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // ค่าที่ตั้งบน Netlify UI มักจะมี \n เป็น string literal ต้องแปลงกลับเป็น newline จริง
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
    });
  }
  return admin.firestore();
}

module.exports = { getDb, admin };
