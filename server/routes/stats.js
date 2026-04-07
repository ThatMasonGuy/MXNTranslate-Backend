// ~/MXNTranslate-Backend/server/routes/stats.js
const express = require('express');
const router = express.Router();
const db = require('../services/database');

// Get stats for a specific guild
router.get('/:serverId', async (req, res) => {
  try {
    const { serverId } = req.params;

    const stats = db.getTranslationStats(serverId);
    const guild = db.getGuild(serverId);

    res.json({
      guild: {
        id: guild?.id,
        name: guild?.name,
        icon: guild?.icon
      },
      stats: {
        totalTranslations: stats.translations,
        activeChannels: stats.channels,
        languagesSupported: 45, // Your translation service supports 45 languages
        languagesUsed: stats.languages,
        totalMessages: stats.messages
      }
    });
  } catch (error) {
    console.error('Failed to get stats:', error);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

module.exports = router;