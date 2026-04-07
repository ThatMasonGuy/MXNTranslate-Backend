// MXNTranslate-Backend/server/middleware/auth.js
/**
 * API Key authentication middleware
 * Verifies the Bearer token matches BOT_API_KEY from environment
 */
function verifyApiKey(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ 
      error: "Missing or invalid authorization header",
      message: "Expected: Authorization: Bearer <api-key>"
    });
  }

  const token = authHeader.substring(7);
  const validKey = process.env.BOT_API_KEY;

  if (!validKey) {
    console.error("BOT_API_KEY not configured in environment!");
    return res.status(500).json({ error: "Server configuration error" });
  }

  if (token !== validKey) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  next();
}

module.exports = { verifyApiKey };