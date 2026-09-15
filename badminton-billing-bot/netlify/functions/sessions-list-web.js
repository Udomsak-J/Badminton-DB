const { verifyIdToken } = require("./lib/lineLogin");
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

  const { idToken, groupId } = payload;
  if (!idToken || !groupId) return jsonRes(400, { error: "missing_fields" });

  try {
    await verifyIdToken(idToken);
  } catch (err) {
    console.error(err);
    return jsonRes(401, { error: "invalid_token" });
  }

  try {
    const recent = await svc.findRecentSessions(groupId, 20);
    const sessions = recent.map((session) => ({
      id: session.id,
      location: session.location,
      dateDisplay: session.dateDisplay,
      startStr: session.startStr,
      endStr: session.endStr,
      courtFee: session.courtFee || 0,
      shuttlecockFee: session.shuttlecockFee || 0,
      otherFee: session.otherFee || 0,
      total: svc.sessionTotal(session),
      status: session.status,
      participants: (session.participants || []).map((p) => p.displayName),
    }));
    return jsonRes(200, { ok: true, sessions });
  } catch (err) {
    console.error("sessions-list-web error:", err);
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
