// ~/MXNTranslate-Backend/server/services/database.js
const Database = require('better-sqlite3');
const path = require('path');

// Connect to the same database the Discord bot uses
const dbPath = '/home/mason/discord_data/discord_tracker.db';

let db;
try {
  db = new Database(dbPath, {
    readonly: false, // We need write access for config updates
    fileMustExist: true,
    timeout: 5000,
  });
  console.log('✅ Connected to Discord bot database');
} catch (error) {
  console.error('❌ Failed to connect to Discord bot database:', error);
  process.exit(1);
}

class DiscordDatabase {
  constructor() {
    this.db = db;
  }

  // Get guild info
  getGuild(guildId) {
    return this.db.prepare(`
      SELECT * FROM guilds WHERE id = ?
    `).get(guildId);
  }

  // Get all channels for a guild
  getGuildChannels(guildId) {
    return this.db.prepare(`
      SELECT id, name, type, position, topic, nsfw, parent_id
      FROM channels
      WHERE id IN (
        SELECT DISTINCT channel_id FROM messages WHERE guild_id = ?
        UNION
        SELECT DISTINCT id FROM channels WHERE id LIKE ?
      )
      ORDER BY position ASC, name ASC
    `).all(guildId, `${guildId}%`);
  }

  // Get translation config for guild
  getTranslationConfig(guildId) {
    const config = this.db.prepare(`
      SELECT * FROM translation_config WHERE guild_id = ?
    `).get(guildId);

    if (!config) {
      // Create default config
      this.db.prepare(`
        INSERT INTO translation_config (guild_id, enabled)
        VALUES (?, 1)
      `).run(guildId);
      
      return { guild_id: guildId, enabled: 1 };
    }

    return config;
  }

  // Get blocked channels
  getBlockedChannels(guildId) {
    return this.db.prepare(`
      SELECT channel_id FROM blocked_translation_channels
      WHERE guild_id = ?
    `).all(guildId).map(row => row.channel_id);
  }

  // Get announcement channel mappings
  getAnnouncementChannels(guildId) {
    return this.db.prepare(`
      SELECT source_channel_id, announcement_channel_id
      FROM announcement_translation_channels
      WHERE guild_id = ?
    `).all(guildId);
  }

  // Get auto-translate channels
  getAutoTranslateChannels(guildId) {
    return this.db.prepare(`
      SELECT channel_id, source_channel_id, target_language, is_active
      FROM auto_translate_channels
      WHERE guild_id = ? AND is_active = 1
    `).all(guildId);
  }

  // Get translation stats for guild
  getTranslationStats(guildId) {
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as total_translations,
        COUNT(DISTINCT target_language) as languages_used
      FROM translations t
      JOIN messages m ON t.message_id = m.id
      WHERE m.guild_id = ?
    `).get(guildId);

    const messageCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM messages WHERE guild_id = ?
    `).get(guildId);

    const channelCount = this.db.prepare(`
      SELECT COUNT(DISTINCT channel_id) as count 
      FROM messages 
      WHERE guild_id = ?
    `).get(guildId);

    return {
      translations: stats.total_translations || 0,
      languages: stats.languages_used || 0,
      messages: messageCount.count || 0,
      channels: channelCount.count || 0
    };
  }

  // Update translation config
  updateTranslationConfig(guildId, config) {
    const transaction = this.db.transaction(() => {
      // Update or create base config
      this.db.prepare(`
        INSERT INTO translation_config (guild_id, enabled)
        VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled
      `).run(guildId, config.enabled ? 1 : 0);

      // Update blocked channels
      if (config.restrictions && config.restrictions.blockedChannels) {
        // Clear existing
        this.db.prepare(`
          DELETE FROM blocked_translation_channels WHERE guild_id = ?
        `).run(guildId);
        
        // Insert new
        const insertStmt = this.db.prepare(`
          INSERT INTO blocked_translation_channels (guild_id, channel_id)
          VALUES (?, ?)
        `);
        
        for (const channelId of config.restrictions.blockedChannels) {
          insertStmt.run(guildId, channelId);
        }
      }

      // Update announcement channels
      if (config.announcements) {
        // Clear existing
        this.db.prepare(`
          DELETE FROM announcement_translation_channels WHERE guild_id = ?
        `).run(guildId);
        
        // Insert new mappings
        if (config.announcements.enabled && config.announcements.targetChannels) {
          const insertStmt = this.db.prepare(`
            INSERT INTO announcement_translation_channels 
            (guild_id, source_channel_id, announcement_channel_id)
            VALUES (?, ?, ?)
          `);
          
          for (const mapping of config.announcements.targetChannels) {
            if (mapping.channelId && config.announcements.sourceChannel) {
              insertStmt.run(
                guildId, 
                config.announcements.sourceChannel, 
                mapping.channelId
              );
            }
          }
        }
      }

      // Auto-translate channels would go here if you're storing them in DB
      // For now, the auto-translate config seems to be in a different structure
    });

    transaction();
    return { success: true };
  }
}

module.exports = new DiscordDatabase();