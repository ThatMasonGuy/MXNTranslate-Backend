const express = require("express");
const router = express.Router();
const redis = require("../services/redisClient");
const db = require("../services/pgClient");
const { spawn } = require("child_process");

// Util: generate a cache key
function makeKey(text, from, to) {
  return `translation:${from}:${to}:${text}`;
}

router.post("/", async (req, res) => {
  const { text, langFrom = "auto", langTo } = req.body;

  if (!text || !langTo) {
    return res.status(400).json({ error: "Missing text or langTo" });
  }

  const cacheKey = `translation:${langFrom}:${langTo}:${text}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({ translated: cached });
    }

    const { detectedLang, translatedText } = await runArgosTranslation(text, langFrom, langTo);

    await redis.set(cacheKey, translatedText, "EX", 86400);

    await db.query(
      `INSERT INTO translations (source, target, original_text, translated_text) VALUES ($1, $2, $3, $4)`,
      [detectedLang, langTo, text, translatedText]
    );

    res.json({ translated: translatedText });
  } catch (err) {
    console.error(" ^}^l Translation error:", err);
    res.status(500).json({ error: err.toString() });
  }
});

module.exports = router;

// -----------------------------------------
// Translation subprocess logic
function runArgosTranslation(text, from, to) {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", ["server/services/translate.py", from, to]);

    let output = "";
    let error = "";

    proc.stdout.on("data", (data) => (output += data.toString()));
    proc.stderr.on("data", (data) => (error += data.toString()));

    proc.on("close", (code) => {
      if (code !== 0 || error.includes("error:")) {
        return reject(error.trim());
      }

      const [detectedLang, translatedText] = output.trim().split("|||");
      resolve({ detectedLang, translatedText });
    });

    proc.stdin.write(text);
    proc.stdin.end();
  });
}
