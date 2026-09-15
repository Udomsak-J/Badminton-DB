const { verifyIdToken } = require("./lib/lineLogin");
const { pushMessage } = require("./lib/lineClient");
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

  const { idToken, groupId, location, dateStr, startStr, endStr, courtFee, shuttlecockFee, otherFee } = payload;

  if (!idToken || !groupId || !location || !dateStr || !startStr || !endStr || courtFee == null) {
    return jsonRes(400, { error: "missing_fields" });
  }

  let profile;
  try {
    profile = await verifyIdToken(idToken);
  } catch (err) {
    console.error(err);
    return jsonRes(401, { error: "invalid_token" });
  }

  const parsed = {
    location: String(location).trim(),
    dateStr: String(dateStr).trim(),
    startStr: String(startStr).trim(),
    endStr: String(endStr).trim(),
    courtFee: parseFloat(courtFee),
    shuttlecockFee: shuttlecockFee ? parseFloat(shuttlecockFee) : 0,
    otherFee: otherFee ? parseFloat(otherFee) : 0,
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.dateStr)) {
    return jsonRes(400, { error: "invalid_date_format" });
  }
  if (!/^\d{1,2}:\d{2}$/.test(parsed.startStr) || !/^\d{1,2}:\d{2}$/.test(parsed.endStr)) {
    return jsonRes(400, { error: "invalid_time_format" });
  }
  if (Number.isNaN(parsed.courtFee) || parsed.courtFee < 0) {
    return jsonRes(400, { error: "invalid_court_fee" });
  }

  try {
    const session = await svc.createSession(groupId, profile.sub, parsed);
    await pushMessage(groupId, svc.buildSessionAnnouncement(session));
    return jsonRes(200, { ok: true, sessionId: session.id });
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
