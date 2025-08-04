require("dotenv").config();
const express = require("express");
const cors = require("cors");
const translateRoute = require("./routes/translate");

const app = express();
const PORT = process.env.PORT || 3600;

app.use(cors());
app.use(express.json());

app.use("/translate", translateRoute);

app.get("/health", async (req, res) => {
  try {
    const db = require("./services/pgClient");
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(500).json({ status: "db-error" });
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Translate API running at http://localhost:${PORT}`);
});
