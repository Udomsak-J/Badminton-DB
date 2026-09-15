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

  const { idToken, groupId, sessionId } = payload;
  if (!idToken || !groupId || !sessionId) return jsonRes(400, { error: "missing_fields" });

  try {
    await verifyIdToken(idToken);
  } catch (err) {
    console.error(err);
    return jsonRes(401, { error: "invalid_token" });
  }

  try {
    const session = await svc.getSessionById(sessionId);
    if (!session || session.groupId !== groupId) {
      return jsonRes(404, { error: "not_found" });
    }
    if (session.status !== "open") {
      return jsonRes(409, { error: "not_open" });
    }
    const { billText } = await svc.closeAndBillSession(sessionId);
    await pushMessage(groupId, textMessage(billText));
    return jsonRes(200, { ok: true });
  } catch (err) {
    console.error("close-session-web error:", err);
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
