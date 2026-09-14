// ตรวจ id_token ที่ฝั่งเว็บ (LIFF) ส่งมา ว่าออกโดย LINE จริงและยังไม่หมดอายุ
// อ้างอิง: https://developers.line.biz/en/reference/line-login/#verify-id-token
async function verifyIdToken(idToken) {
  const params = new URLSearchParams({
    id_token: idToken,
    client_id: process.env.LINE_LOGIN_CHANNEL_ID,
  });
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`verify id_token failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  // data.sub = LINE userId ของคนที่เปิดหน้าเว็บ, data.name = display name
  return data;
}

module.exports = { verifyIdToken };
