// ~/MXNTranslate-Backend/server/routes/channels.js
const express = require('express');
const router = express.Router();
const db = require('../services/database');

// Get channels for a specific server
router.get('/', async (req, res) => {
  try {
    const { serverId } = req.query;

    if (!serverId) {
      return res.status(400).json({ error: 'serverId is required' });
    }

    // Get channels from database
    const channels = db.getGuildChannels(serverId);

    // Format for frontend
    const formatted = channels.map(ch => ({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      position: ch.position,
      topic: ch.topic,
      nsfw: ch.nsfw === 1,
      parentId: ch.parent_id
    }));

    res.json({ channels: formatted });
  } catch (error) {
    console.error('Failed to get channels:', error);
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

module.exports = router;