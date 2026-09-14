# 🏸 Badminton Billing Bot

บอท LINE สำหรับกลุ่มตีแบด: ผู้จัดก๊วนเปิดรอบผ่าน **หน้าเว็บ (LIFF)** หรือพิมพ์คำสั่งก็ได้, สมาชิกลงชื่อเข้าร่วมในแชท, และระบบ **สรุป+ส่งบิลเข้ากลุ่มอัตโนมัติ** หลังหมดเวลารอบ
สร้างด้วย Firebase (Firestore) + Netlify Functions + LINE Messaging API + LIFF — ใช้ได้ฟรีทั้งหมดในระดับการใช้งานกลุ่มเล็ก

---

## สถาปัตยกรรมโดยสรุป

```
ผู้จัดก๊วนแตะลิงก์ในแชท --> หน้าเว็บ LIFF (create-session.html) --> create-session-web.js --> Firestore
                                                                                                  ^
กลุ่ม LINE  <--webhook-->  Netlify Function (line-webhook)  <---------------------------------------┘
                                                                    ^
Netlify Scheduled Function (billing-check, ทุก 10 นาที) -----------┘
      ตรวจรอบที่หมดเวลา -> คำนวณบิล -> push เข้ากลุ่ม LINE
```

- **create-session.html (LIFF)**: หน้าเว็บฟอร์มให้ผู้จัดก๊วนกรอกชื่อสนาม/เวลา/ค่าใช้จ่าย เปิดจากในกลุ่ม LINE จึงรู้ groupId เองอัตโนมัติ
- **create-session-web.js**: รับข้อมูลจากฟอร์ม ตรวจสอบว่าเป็นคนที่ล็อกอิน LINE จริง แล้วสร้างรอบ + แจ้งเข้ากลุ่ม
- **line-webhook**: รับคำสั่งข้อความจากกลุ่ม (สร้างรอบ / เข้าร่วม / เพิ่มค่าใช้จ่าย ฯลฯ)
- **billing-check**: รันอัตโนมัติทุก 10 นาที (ตั้งค่าใน `netlify.toml`) ตรวจหารอบที่ถึงเวลาสิ้นสุดแล้วยังไม่ได้ปิดบิล แล้วส่งสรุปเข้ากลุ่มให้เอง — **ไม่ต้องมีใครกดอะไร**
- **Firestore**: เก็บข้อมูลรอบ (collection `sessions`)

---

## คำสั่งที่ใช้ในกลุ่ม

| คำสั่ง | ความหมาย |
|---|---|
| `สร้างรอบ` | บอทส่งลิงก์หน้าเว็บ (LIFF) ให้ผู้จัดก๊วนกรอกฟอร์มเปิดรอบ **← แนะนำให้ใช้ทางนี้** |
| `เปิดรอบ สนามA 19:00-21:00 ค่าสนาม 600 ค่าอื่นๆ 100` | เปิดรอบด้วยข้อความล้วน (ไม่ผ่านเว็บ) |
| `เข้าร่วม` | ลงชื่อเข้าร่วมรอบล่าสุดที่เปิดอยู่ |
| `ออกจากรอบ` | ถอนชื่อออกจากรอบ |
| `เพิ่มค่าใช้จ่าย 100 ลูกแบด` | เพิ่มค่าใช้จ่ายเข้ารอบที่เปิดอยู่ระหว่างเล่น |
| `สรุปรอบ` | ปิดรอบและคิดบิลทันที ไม่ต้องรอหมดเวลา |
| `ยกเลิกรอบ` | ยกเลิกรอบโดยไม่คิดเงิน |
| `ช่วยเหลือ` | แสดงคำสั่งทั้งหมด |

สูตรคำนวณ: `(ค่าสนาม + ค่าอื่นๆ) / จำนวนคนที่เข้าร่วม = ค่าใช้จ่ายต่อคน`

---

## ขั้นตอนติดตั้ง (ทำครั้งเดียว)

### 1. สร้าง LINE Official Account + Messaging API channel
1. ไปที่ [LINE Developers Console](https://developers.line.biz/console/) → สร้าง Provider (ถ้ายังไม่มี) → สร้าง **Messaging API channel**
2. แท็บ **Messaging API**:
   - คัดลอก **Channel access token** (กด Issue ถ้ายังไม่มี) → เก็บไว้ใส่ `LINE_CHANNEL_ACCESS_TOKEN`
   - คัดลอก **Channel secret** จากแท็บ Basic settings → เก็บไว้ใส่ `LINE_CHANNEL_SECRET`
   - ปิด **Auto-reply messages** และ **Greeting messages** (เพื่อไม่ให้ชนกับบอท)
   - เปิด **Use webhook** เป็น ON (ต้อง deploy ขึ้น Netlify ก่อนถึงจะมี URL ใส่ได้ ข้ามไปทำข้อ 3-4 ก่อนแล้วค่อยกลับมาใส่)
3. เชิญบอทเข้ากลุ่มไลน์ที่จะใช้งาน

### 2. สร้าง Firebase project (ใช้แผน Spark ฟรี พอแล้ว ไม่ต้องผูกบัตรเครดิต)
1. ไปที่ [Firebase Console](https://console.firebase.google.com/) → สร้างโปรเจกต์ใหม่
2. เปิดใช้งาน **Firestore Database** (โหมด production ก็ได้ เพราะเราเข้าถึงผ่าน Admin SDK ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่ผ่าน client จึงไม่ต้องแก้ security rules)
3. Project settings (รูปเฟือง) → **Service accounts** → **Generate new private key** → จะได้ไฟล์ JSON
4. จากไฟล์ JSON นำค่า `project_id`, `client_email`, `private_key` ไปใส่ใน environment variables ของ Netlify (ดูขั้นตอนถัดไป)

### 3. Deploy ขึ้น Netlify (ฟรี)
1. Push โค้ดโปรเจกต์นี้ขึ้น GitHub repo ของคุณ
2. ที่ [Netlify](https://app.netlify.com/) → **Add new site → Import an existing project** → เลือก repo นี้
3. Build settings ปล่อยตามที่ตั้งไว้ใน `netlify.toml` ได้เลย (ไม่มีขั้นตอน build พิเศษ)
4. ไปที่ **Site settings → Environment variables** ใส่ตัวแปรตาม `.env.example`:
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY` (วางทั้งก้อนรวม `\n` ได้เลย โค้ดแปลงให้อัตโนมัติ)
5. Deploy site → เมื่อเสร็จจะได้ URL เช่น `https://your-site.netlify.app`

### 4. สร้าง LIFF app (หน้าเว็บสำหรับผู้จัดก๊วน)
1. ใน LINE Developers Console เข้า channel ของ Messaging API เดิม → แท็บ **LIFF** → **Add**
2. ตั้งค่า:
   - LIFF app name: `เปิดรอบตีแบด`
   - Size: `Full` หรือ `Tall`
   - Endpoint URL: `https://your-site.netlify.app/create-session.html`
   - Scope: เลือก `openid` และ `profile`
   - Bot link feature: `On (Aggressive)` ก็ได้ (ไม่บังคับ)
3. กด Add แล้วคัดลอก **LIFF ID** (รูปแบบ `1234567890-xxxxxxxx`)
4. ไปที่ Netlify → Environment variables เพิ่ม:
   - `LIFF_ID` = LIFF ID ที่ได้
   - `LINE_LOGIN_CHANNEL_ID` = Channel ID ของ Messaging API channel (ดูได้ในแท็บ Basic settings ตัวเลขเดียวกับที่ใช้สร้าง LIFF)
5. Trigger deploy ใหม่บน Netlify เพื่อให้ env vars มีผล

**วิธีใช้**: ในกลุ่ม LINE พิมพ์ `สร้างรอบ` → บอทจะส่งลิงก์ LIFF กลับมา → ผู้จัดก๊วนแตะลิงก์ (ต้องแตะจากในกลุ่มนั้นเท่านั้น ระบบถึงจะรู้ว่าจะเปิดรอบให้กลุ่มไหน) → กรอกฟอร์มแล้วกดเปิดรอบ

### 5. เชื่อม Webhook กลับเข้า LINE
กลับไปที่ LINE Developers Console → Messaging API → ช่อง **Webhook URL** ใส่:
```
https://your-site.netlify.app/.netlify/functions/line-webhook
```
กด **Verify** ให้ขึ้นสำเร็จ (ต้อง deploy เสร็จและตั้งค่า env vars ครบก่อน ไม่งั้นจะ verify ไม่ผ่าน)

### 6. สร้าง Firestore index (ทำครั้งแรกครั้งเดียว)
เมื่อเริ่มใช้งานจริงครั้งแรก (พิมพ์ `เปิดรอบ` หรือรอ `billing-check` ทำงาน) Firestore จะ error พร้อมลิงก์ให้กดสร้าง composite index อัตโนมัติ (สำหรับ query `groupId+status+createdAt` และ `status+endTime`) — กดลิงก์ในข้อความ error บน Netlify function logs แล้วรอ 1-2 นาทีให้ index สร้างเสร็จ ใช้งานต่อได้ปกติ

---

## ⚠️ เรื่องสำคัญเกี่ยวกับ "ต้องฟรี 100%"

- **Netlify Free tier**: 125,000 function requests/เดือน และรัน background/scheduled function ได้ในโควตาฟรี — เพียงพอมากสำหรับกลุ่มตีแบดทั่วไป
- **Firebase Spark plan (ฟรี)**: ไม่ต้องผูกบัตรเครดิต และ Firestore ฟรีในโควตาที่เกินพอสำหรับข้อมูลระดับนี้
- **LINE Messaging API แผนฟรี**: ข้อความ **reply** (ตอบกลับคำสั่งในแชท) ฟรีไม่จำกัด แต่ข้อความ **push** (ที่บอทส่งเข้ากลุ่มเองตอนหมดเวลา หรือ `pushMessage` ใน `billing-check.js`) มีโควตาฟรี **200 ข้อความ/เดือน** — สำหรับกลุ่มตีแบดที่เล่นไม่กี่รอบต่อสัปดาห์ (แต่ละรอบใช้ push แค่ 1 ข้อความ) โควตานี้เหลือเฟือ แต่ถ้าเล่นถี่มากควรติดตามยอดใน LINE Official Account Manager ด้วย

---

## โครงสร้างไฟล์

```
badminton-bot/
├── netlify.toml                     # ตั้งค่า Netlify + ตารางเวลา billing-check
├── package.json
├── .env.example                     # ตัวอย่าง environment variables
├── public/
│   ├── index.html                   # หน้า landing เฉยๆ
│   └── create-session.html          # หน้าเว็บ LIFF ให้ผู้จัดก๊วนเปิดรอบ
└── netlify/functions/
    ├── line-webhook.js              # รับคำสั่งจากกลุ่ม LINE
    ├── billing-check.js             # scheduled function ปิดรอบ+ส่งบิลอัตโนมัติ
    ├── liff-config.js               # ส่ง LIFF_ID ให้หน้าเว็บ (ไม่ต้อง hardcode)
    ├── create-session-web.js        # รับฟอร์มจากหน้าเว็บ ตรวจสิทธิ์ แล้วสร้างรอบ
    └── lib/
        ├── firebaseAdmin.js         # init Firebase Admin SDK
        ├── lineClient.js            # helper เรียก LINE API + verify signature
        ├── lineLogin.js             # ตรวจ id_token จาก LIFF
        └── sessionService.js        # โลจิกหลัก: parse คำสั่ง, คำนวณบิล, Firestore queries
```

## ทดสอบก่อน deploy จริง (ทางเลือก)

ติดตั้ง [Netlify CLI](https://docs.netlify.com/cli/get-started/) แล้วรัน:
```bash
npm install
netlify dev
```
จากนั้นใช้ ngrok หรือเครื่องมือ tunnel เพื่อทดสอบ webhook จากเครื่อง local (ต้องตั้งค่า env vars ในเครื่องด้วย `netlify env:pull` หรือสร้างไฟล์ `.env`)
