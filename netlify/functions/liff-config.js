exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ liffId: process.env.LIFF_ID || "" }),
  };
};
