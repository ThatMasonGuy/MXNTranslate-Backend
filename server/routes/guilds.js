// ~/MXNTranslate-Backend/server/routes/guilds.js
const express = require("express");
const router = express.Router();
const discordService = require("../services/discord");
const configService = require("../services/config");

/**
 * GET /api/guilds
 * Returns list of all guilds the bot is in
 */
router.get("/", async (req, res) => {
  try {
    const guilds = await discordService.getGuilds();
    
    // Add config status and stats for each guild
    const guildsWithStats = await Promise.all(
      guilds.map(async (guild) => {
        const config = await configService.getConfig(guild.id);
        
        return {
          ...guild,
          channels: 0, // You can add channel count here if needed
          hasConfig: config.updatedAt ? true : false,
        };
      })
    );

    res.json(guildsWithStats);
  } catch (error) {
    console.error("Error fetching guilds:", error);
    res.status(500).json({ 
      error: "Failed to fetch guilds",
      message: error.message 
    });
  }
});

/**
 * GET /api/guilds/:guildId
 * Returns details for a specific guild
 */
router.get("/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    
    // Verify guild exists
    const hasAccess = await discordService.verifyGuildAccess(guildId);
    
    if (!hasAccess) {
      return res.status(404).json({ error: "Guild not found or bot not in guild" });
    }

    const guilds = await discordService.getGuilds();
    const guild = guilds.find(g => g.id === guildId);
    
    if (!guild) {
      return res.status(404).json({ error: "Guild not found" });
    }

    const config = await configService.getConfig(guildId);
    const channels = await discordService.getGuildChannels(guildId);

    res.json({
      ...guild,
      channels: channels.length,
      hasConfig: config.updatedAt ? true : false,
    });
  } catch (error) {
    console.error("Error fetching guild:", error);
    res.status(500).json({ 
      error: "Failed to fetch guild",
      message: error.message 
    });
  }
});

module.exports = router;