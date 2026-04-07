// ~/MXNTranslate-Backend/server/routes/config.js
const express = require('express');
const router = express.Router();
const db = require('../services/database');

// Get guild configuration
router.get('/:serverId', async (req, res) => {
  try {
    const { serverId } = req.params;
    
    // Get all config data from database
    const baseConfig = db.getTranslationConfig(serverId);
    const blockedChannels = db.getBlockedChannels(serverId);
    const announcementChannels = db.getAnnouncementChannels(serverId);
    const autoTranslateChannels = db.getAutoTranslateChannels(serverId);

    // Format config to match dashboard expectations
    const config = {
      autoTranslate: {
        enabled: autoTranslateChannels.length > 0,
        channels: autoTranslateChannels.map(ch => ch.source_channel_id),
        defaultLanguage: autoTranslateChannels[0]?.target_language || 'en'
      },
      announcements: {
        enabled: announcementChannels.length > 0,
        sourceChannel: announcementChannels[0]?.source_channel_id || null,
        targetChannels: announcementChannels.map(ch => ({
          language: 'en', // You might need to store this in DB if you want per-channel languages
          channelId: ch.announcement_channel_id
        }))
      },
      general: {
        replyAsThread: true, // Store these in translation_config if needed
        showOriginalLanguage: true,
        allowDMTranslations: true
      },
      restrictions: {
        blockedChannels: blockedChannels
      }
    };

    res.json(config);
  } catch (error) {
    console.error('Failed to get config:', error);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

// Update guild configuration
router.post('/:serverId', async (req, res) => {
  try {
    const { serverId } = req.params;
    const config = req.body;

    console.log(`Updating config for guild ${serverId}:`, config);

    // Update database
    const result = db.updateTranslationConfig(serverId, config);

    if (result.success) {
      res.json({ success: true, message: 'Configuration updated' });
    } else {
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  } catch (error) {
    console.error('Failed to update config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Reset guild configuration to defaults
router.delete('/:serverId', async (req, res) => {
  try {
    const { serverId } = req.params;

    // Clear all config
    const transaction = db.db.transaction(() => {
      db.db.prepare(`
        DELETE FROM blocked_translation_channels WHERE guild_id = ?
      `).run(serverId);
      
      db.db.prepare(`
        DELETE FROM announcement_translation_channels WHERE guild_id = ?
      `).run(serverId);
      
      db.db.prepare(`
        UPDATE translation_config SET enabled = 1 WHERE guild_id = ?
      `).run(serverId);
      
      db.db.prepare(`
        UPDATE auto_translate_channels SET is_active = 0 WHERE guild_id = ?
      `).run(serverId);
    });

    transaction();

    res.json({ success: true, message: 'Configuration reset to defaults' });
  } catch (error) {
    console.error('Failed to reset config:', error);
    res.status(500).json({ error: 'Failed to reset configuration' });
  }
});

module.exports = router;