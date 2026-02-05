// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3600;

// Connect to Discord bot database
const dbPath = process.env.DB_PATH || '/home/mason/discord_data/discord_tracker.db';
let db;

try {
  db = new Database(dbPath, {
    readonly: false,
    fileMustExist: true,
    timeout: 5000,
  });
  console.log('✅ Connected to Discord bot database');
} catch (error) {
  console.error('❌ Failed to connect to Discord bot database:', error);
  console.log('⚠️  Using placeholder mode - some endpoints will return empty data');
  db = null;
}

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://mxn.au',
    /\.mxn\.au$/
  ],
  credentials: true
}));

app.use(express.json());

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const expectedKey = process.env.BOT_API_KEY;

  if (!expectedKey) {
    console.error('BOT_API_KEY not set in environment');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const providedKey = authHeader.substring(7);
  if (providedKey !== expectedKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  next();
}

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: db ? 'connected' : 'not connected'
  });
});

// ============================================================
// GUILDS ENDPOINT
// ============================================================

app.get('/api/guilds', authMiddleware, (req, res) => {
  if (!db) {
    return res.json([]);
  }

  try {
    const guilds = db.prepare('SELECT * FROM guilds').all();
    
    const formatted = guilds.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      memberCount: g.member_count || 0
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Failed to get guilds:', error);
    res.status(500).json({ error: 'Failed to load guilds' });
  }
});

// ============================================================
// CHANNELS ENDPOINT
// ============================================================

app.get('/api/channels', authMiddleware, (req, res) => {
  const { serverId } = req.query;

  if (!serverId) {
    return res.status(400).json({ error: 'serverId is required' });
  }

  if (!db) {
    return res.json({ channels: [] });
  }

  try {
    // Get channels from messages (channels the bot has seen)
    const channelsFromMessages = db.prepare(`
      SELECT DISTINCT c.id, c.name, c.type, c.position, c.topic, c.nsfw, c.parent_id
      FROM channels c
      WHERE c.id IN (
        SELECT DISTINCT channel_id FROM messages WHERE guild_id = ?
      )
      ORDER BY c.position ASC, c.name ASC
    `).all(serverId);

    // Also get channels from auto-translate config
    const autoTranslateChannels = db.prepare(`
      SELECT DISTINCT c.id, c.name, c.type, c.position, c.topic, c.nsfw, c.parent_id
      FROM channels c
      WHERE c.id IN (
        SELECT channel_id FROM auto_translate_channels WHERE guild_id = ?
        UNION
        SELECT source_channel_id FROM auto_translate_channels WHERE guild_id = ?
      )
    `).all(serverId, serverId);

    // Merge and dedupe
    const channelMap = new Map();
    [...channelsFromMessages, ...autoTranslateChannels].forEach(ch => {
      if (!channelMap.has(ch.id)) {
        channelMap.set(ch.id, ch);
      }
    });

    const channels = Array.from(channelMap.values());

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

// ============================================================
// CONFIG ENDPOINTS - CORRECTED TO MATCH ACTUAL DB SCHEMA
// ============================================================

app.get('/api/config/:serverId', authMiddleware, (req, res) => {
  const { serverId } = req.params;

  if (!db) {
    return res.json({
      autoTranslate: { pairs: [] },
      announcements: { routes: [] },
      restrictions: { blockedChannels: [] },
      general: { enabled: true }
    });
  }

  try {
    // Get auto-translate channel pairs
    const autoTranslatePairs = db.prepare(`
      SELECT id, channel_id, source_channel_id, target_language, 
             webhook_id, is_active, created_at, updated_at
      FROM auto_translate_channels 
      WHERE guild_id = ?
      ORDER BY created_at DESC
    `).all(serverId);

    // Get blocked channels
    const blockedChannels = db.prepare(`
      SELECT channel_id FROM blocked_translation_channels WHERE guild_id = ?
    `).all(serverId).map(row => row.channel_id);

    // Get announcement routes
    const announcementRoutes = db.prepare(`
      SELECT id, source_channel_id, announcement_channel_id, created_at
      FROM announcement_translation_channels 
      WHERE guild_id = ?
    `).all(serverId);

    // Get general config (translation enabled)
    const generalConfig = db.prepare(`
      SELECT enabled FROM translation_config WHERE guild_id = ?
    `).get(serverId);

    res.json({
      autoTranslate: {
        pairs: autoTranslatePairs.map(p => ({
          id: p.id,
          channel_id: p.channel_id,
          source_channel_id: p.source_channel_id,
          target_language: p.target_language,
          webhook_id: p.webhook_id,
          is_active: p.is_active === 1,
          created_at: p.created_at,
          updated_at: p.updated_at
        }))
      },
      announcements: {
        routes: announcementRoutes.map(r => ({
          id: r.id,
          source_channel_id: r.source_channel_id,
          announcement_channel_id: r.announcement_channel_id,
          created_at: r.created_at
        }))
      },
      restrictions: {
        blockedChannels: blockedChannels
      },
      general: {
        enabled: generalConfig ? generalConfig.enabled === 1 : true
      }
    });
  } catch (error) {
    console.error('Failed to get config:', error);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

// Update general config (enabled toggle)
app.post('/api/config/:serverId/general', authMiddleware, (req, res) => {
  const { serverId } = req.params;
  const { enabled } = req.body;

  if (!db) {
    return res.json({ success: true });
  }

  try {
    db.prepare(`
      INSERT INTO translation_config (guild_id, enabled, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id) DO UPDATE SET enabled = ?, updated_at = CURRENT_TIMESTAMP
    `).run(serverId, enabled ? 1 : 0, enabled ? 1 : 0);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update general config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// ============================================================
// BLOCKED CHANNELS ENDPOINTS
// ============================================================

app.post('/api/config/:serverId/block-channel', authMiddleware, (req, res) => {
  const { serverId } = req.params;
  const { channelId } = req.body;

  if (!db) {
    return res.json({ success: true });
  }

  try {
    db.prepare(`
      INSERT OR IGNORE INTO blocked_translation_channels (guild_id, channel_id)
      VALUES (?, ?)
    `).run(serverId, channelId);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to block channel:', error);
    res.status(500).json({ error: 'Failed to block channel' });
  }
});

app.post('/api/config/:serverId/unblock-channel', authMiddleware, (req, res) => {
  const { serverId } = req.params;
  const { channelId } = req.body;

  if (!db) {
    return res.json({ success: true });
  }

  try {
    db.prepare(`
      DELETE FROM blocked_translation_channels 
      WHERE guild_id = ? AND channel_id = ?
    `).run(serverId, channelId);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to unblock channel:', error);
    res.status(500).json({ error: 'Failed to unblock channel' });
  }
});

// ============================================================
// ANNOUNCEMENT ROUTES ENDPOINTS
// ============================================================

app.post('/api/config/:serverId/announcement-route', authMiddleware, (req, res) => {
  const { serverId } = req.params;
  const { sourceChannelId, announcementChannelId } = req.body;

  if (!db) {
    return res.json({ success: true });
  }

  try {
    db.prepare(`
      INSERT INTO announcement_translation_channels (guild_id, source_channel_id, announcement_channel_id)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id, source_channel_id) DO UPDATE SET 
        announcement_channel_id = ?,
        created_at = CURRENT_TIMESTAMP
    `).run(serverId, sourceChannelId, announcementChannelId, announcementChannelId);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to add announcement route:', error);
    res.status(500).json({ error: 'Failed to add announcement route' });
  }
});

app.delete('/api/config/:serverId/announcement-route/:sourceChannelId', authMiddleware, (req, res) => {
  const { serverId, sourceChannelId } = req.params;

  if (!db) {
    return res.json({ success: true });
  }

  try {
    db.prepare(`
      DELETE FROM announcement_translation_channels 
      WHERE guild_id = ? AND source_channel_id = ?
    `).run(serverId, sourceChannelId);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to remove announcement route:', error);
    res.status(500).json({ error: 'Failed to remove announcement route' });
  }
});

// ============================================================
// SERVER EMOTES - Fetch from Discord API
// ============================================================

app.get('/api/discord/:serverId/emotes', authMiddleware, async (req, res) => {
  const { serverId } = req.params;
  
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  try {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${serverId}/emojis`,
      {
        headers: {
          'Authorization': `Bot ${botToken}`
        }
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Discord API error fetching emotes:', error);
      return res.status(response.status).json({ error: 'Failed to fetch emotes from Discord' });
    }

    const emotes = await response.json();
    
    // Format for frontend
    const formatted = emotes.map(e => ({
      id: e.id,
      name: e.name,
      animated: e.animated || false,
      url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}?size=32`
    }));

    res.json({ emotes: formatted });
  } catch (error) {
    console.error('Failed to fetch server emotes:', error);
    res.status(500).json({ error: 'Failed to fetch emotes' });
  }
});

// ============================================================
// CALENDAR / SCHEDULED MESSAGES ENDPOINTS
// ============================================================

// Get all scheduled messages for a server
app.get('/api/calendar/:serverId', authMiddleware, (req, res) => {
  const { serverId } = req.params;

  if (!db) {
    return res.json({ messages: [] });
  }

  try {
    const messages = db.prepare(`
      SELECT * FROM scheduled_messages 
      WHERE guild_id = ? AND is_active = 1
      ORDER BY next_run_at ASC
    `).all(serverId);

    res.json({ messages });
  } catch (error) {
    console.error('Failed to fetch scheduled messages:', error);
    res.json({ messages: [] });
  }
});

// Create a new scheduled message
app.post('/api/calendar/:serverId', authMiddleware, (req, res) => {
  const { serverId } = req.params;
  const {
    title,
    channelId,
    messageContent,
    scheduleType,
    scheduledAt,
    recurrenceRule,
    recurrenceDay,
    recurrenceTime,
    recurrenceEndAt,
    timezone,
    embedTimestamp,
    timestampTargetTime,
    timestampFormat,
    sendAs,
    pingEveryone,
    pingRoleId,
    creatorUserId,
    creatorUserName,
    creatorUserAvatar
  } = req.body;

  if (!db) {
    return res.json({ success: true, id: Date.now() });
  }

  if (!channelId || !messageContent || !scheduleType) {
    return res.status(400).json({ error: 'channelId, messageContent, and scheduleType are required' });
  }

  try {
    // Calculate next_run_at
    let nextRunAt = null;
    
    if (scheduleType === 'once' && scheduledAt) {
      // Convert local time to UTC
      nextRunAt = convertToUTC(scheduledAt, timezone);
    } else if (scheduleType === 'recurring') {
      // Calculate next occurrence
      nextRunAt = calculateNextRun(recurrenceRule, recurrenceDay, recurrenceTime, timezone);
    }

    const result = db.prepare(`
      INSERT INTO scheduled_messages (
        guild_id, channel_id, creator_user_id, creator_user_name, creator_user_avatar,
        title, message_content, send_as, schedule_type,
        scheduled_at, recurrence_rule, recurrence_day, recurrence_time, recurrence_timezone, recurrence_end_at,
        next_run_at, embed_timestamp, timestamp_target_time, timestamp_format,
        ping_role_id, ping_everyone, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      serverId,
      channelId,
      creatorUserId,
      creatorUserName,
      creatorUserAvatar,
      title || null,
      messageContent,
      sendAs || 'bot',
      scheduleType,
      scheduleType === 'once' ? nextRunAt : null,
      recurrenceRule || null,
      recurrenceDay ?? null,
      recurrenceTime || null,
      timezone || 'UTC',
      recurrenceEndAt ? convertToUTC(recurrenceEndAt + 'T23:59:59', timezone) : null,
      nextRunAt,
      embedTimestamp ? 1 : 0,
      timestampTargetTime || null,
      timestampFormat || 'R',
      pingRoleId || null,
      pingEveryone ? 1 : 0
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Failed to create scheduled message:', error);
    res.status(500).json({ error: 'Failed to create scheduled message' });
  }
});

// Update a scheduled message
app.put('/api/calendar/:serverId/:messageId', authMiddleware, (req, res) => {
  const { serverId, messageId } = req.params;
  const updates = req.body;

  if (!db) {
    return res.json({ success: true });
  }

  try {
    // Handle pause/unpause
    if ('isPaused' in updates) {
      db.prepare(`
        UPDATE scheduled_messages SET is_paused = ?, updated_at = ? WHERE id = ? AND guild_id = ?
      `).run(updates.isPaused ? 1 : 0, new Date().toISOString(), messageId, serverId);
      
      return res.json({ success: true });
    }

    // Full update
    const {
      title,
      channelId,
      messageContent,
      scheduleType,
      scheduledAt,
      recurrenceRule,
      recurrenceDay,
      recurrenceTime,
      recurrenceEndAt,
      timezone,
      embedTimestamp,
      timestampTargetTime,
      timestampFormat,
      sendAs,
      pingEveryone,
      pingRoleId
    } = updates;

    // Calculate next_run_at
    let nextRunAt = null;
    
    if (scheduleType === 'once' && scheduledAt) {
      nextRunAt = convertToUTC(scheduledAt, timezone);
    } else if (scheduleType === 'recurring') {
      nextRunAt = calculateNextRun(recurrenceRule, recurrenceDay, recurrenceTime, timezone);
    }

    db.prepare(`
      UPDATE scheduled_messages SET
        title = ?, channel_id = ?, message_content = ?, send_as = ?, schedule_type = ?,
        scheduled_at = ?, recurrence_rule = ?, recurrence_day = ?, recurrence_time = ?, 
        recurrence_timezone = ?, recurrence_end_at = ?, next_run_at = ?,
        embed_timestamp = ?, timestamp_target_time = ?, timestamp_format = ?,
        ping_role_id = ?, ping_everyone = ?, updated_at = ?
      WHERE id = ? AND guild_id = ?
    `).run(
      title || null,
      channelId,
      messageContent,
      sendAs || 'bot',
      scheduleType,
      scheduleType === 'once' ? nextRunAt : null,
      recurrenceRule || null,
      recurrenceDay ?? null,
      recurrenceTime || null,
      timezone || 'UTC',
      recurrenceEndAt ? convertToUTC(recurrenceEndAt + 'T23:59:59', timezone) : null,
      nextRunAt,
      embedTimestamp ? 1 : 0,
      timestampTargetTime || null,
      timestampFormat || 'R',
      pingRoleId || null,
      pingEveryone ? 1 : 0,
      new Date().toISOString(),
      messageId,
      serverId
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update scheduled message:', error);
    res.status(500).json({ error: 'Failed to update scheduled message' });
  }
});

// Delete a scheduled message
app.delete('/api/calendar/:serverId/:messageId', authMiddleware, (req, res) => {
  const { serverId, messageId } = req.params;

  if (!db) {
    return res.json({ success: true });
  }

  try {
    db.prepare(`
      UPDATE scheduled_messages SET is_active = 0, updated_at = ? WHERE id = ? AND guild_id = ?
    `).run(new Date().toISOString(), messageId, serverId);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete scheduled message:', error);
    res.status(500).json({ error: 'Failed to delete scheduled message' });
  }
});

// Helper: Convert local time to UTC
function convertToUTC(localDateTime, timezone) {
  try {
    // Use luxon for proper timezone handling including DST
    let DateTime;
    try {
      DateTime = require('luxon').DateTime;
    } catch (e) {
      console.error('[Calendar] ⚠️  LUXON NOT INSTALLED - TIMEZONES WILL BE WRONG!');
      console.error('[Calendar] Run: npm install luxon');
      console.error('[Calendar] Without luxon, all times are treated as server local time, not user timezone!');
      // Return as-is without timezone conversion - this will be wrong but at least predictable
      return new Date(localDateTime).toISOString();
    }

    // Parse the datetime in the specified timezone
    const dt = DateTime.fromISO(localDateTime, { zone: timezone });
    
    if (!dt.isValid) {
      console.error('[Calendar] Invalid datetime:', localDateTime, 'in timezone:', timezone, 'reason:', dt.invalidReason);
      return new Date(localDateTime).toISOString();
    }

    console.log(`[Calendar] Converting ${localDateTime} in ${timezone} -> ${dt.toUTC().toISO()} UTC`);
    
    // Convert to UTC
    return dt.toUTC().toISO();
  } catch (e) {
    console.error('[Calendar] Timezone conversion error:', e);
    return new Date(localDateTime).toISOString();
  }
}

// Helper: Calculate next run time for recurring schedules
function calculateNextRun(rule, day, time, timezone) {
  let DateTime;
  try {
    DateTime = require('luxon').DateTime;
  } catch (e) {
    // Fallback without luxon
    console.warn('[Calendar] luxon not installed - using basic calculation');
    const now = new Date();
    let nextRun = new Date();
    const [hours, minutes] = (time || '12:00').split(':').map(Number);
    
    switch (rule) {
      case 'daily':
        nextRun.setHours(hours, minutes, 0, 0);
        if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
        break;
      case 'weekly':
        nextRun.setHours(hours, minutes, 0, 0);
        const currentDay = nextRun.getDay();
        let daysUntil = (day - currentDay + 7) % 7;
        if (daysUntil === 0 && nextRun <= now) daysUntil = 7;
        nextRun.setDate(nextRun.getDate() + daysUntil);
        break;
      case 'biweekly':
        nextRun.setHours(hours, minutes, 0, 0);
        const currentDay2 = nextRun.getDay();
        let daysUntil2 = (day - currentDay2 + 7) % 7;
        if (daysUntil2 === 0 && nextRun <= now) daysUntil2 = 14;
        nextRun.setDate(nextRun.getDate() + daysUntil2);
        break;
      case 'monthly':
        nextRun.setDate(day);
        nextRun.setHours(hours, minutes, 0, 0);
        if (nextRun <= now) nextRun.setMonth(nextRun.getMonth() + 1);
        break;
      default:
        nextRun.setHours(hours, minutes, 0, 0);
        if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
    }
    return nextRun.toISOString();
  }

  // With luxon - proper timezone handling
  const [hours, minutes] = (time || '12:00').split(':').map(Number);
  const now = DateTime.now().setZone(timezone);
  let nextRun;

  switch (rule) {
    case 'daily':
      nextRun = now.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
      if (nextRun <= now) {
        nextRun = nextRun.plus({ days: 1 });
      }
      break;

    case 'weekly':
      // day is 0-6 (Sunday-Saturday), luxon uses 1-7 (Monday-Sunday)
      // Convert: Sunday(0)->7, Monday(1)->1, etc.
      const luxonDay = day === 0 ? 7 : day;
      nextRun = now.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
      
      // Find next occurrence of this weekday
      const currentWeekday = now.weekday; // 1-7 (Mon-Sun)
      let daysUntil = luxonDay - currentWeekday;
      if (daysUntil < 0 || (daysUntil === 0 && nextRun <= now)) {
        daysUntil += 7;
      }
      nextRun = nextRun.plus({ days: daysUntil });
      break;

    case 'biweekly':
      const luxonDay2 = day === 0 ? 7 : day;
      nextRun = now.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
      const currentWeekday2 = now.weekday;
      let daysUntil2 = luxonDay2 - currentWeekday2;
      if (daysUntil2 < 0 || (daysUntil2 === 0 && nextRun <= now)) {
        daysUntil2 += 14; // Two weeks for biweekly
      }
      nextRun = nextRun.plus({ days: daysUntil2 });
      break;

    case 'monthly':
      // Clamp to valid day of month
      const maxDay = now.daysInMonth;
      const targetDay = Math.min(day, maxDay);
      nextRun = now.set({ day: targetDay, hour: hours, minute: minutes, second: 0, millisecond: 0 });
      if (nextRun <= now) {
        nextRun = nextRun.plus({ months: 1 });
        // Re-clamp for next month
        nextRun = nextRun.set({ day: Math.min(day, nextRun.daysInMonth) });
      }
      break;

    default:
      nextRun = now.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
      if (nextRun <= now) {
        nextRun = nextRun.plus({ days: 1 });
      }
  }

  // Convert to UTC for storage
  return nextRun.toUTC().toISO();
}

// ============================================================
// AUDIT LOG ENDPOINTS
// ============================================================

// Get audit logs for a server
app.get('/api/audit/:serverId', authMiddleware, (req, res) => {
  const { serverId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const pageSize = Math.min(parseInt(req.query.pageSize) || 25, 100);
  const offset = (page - 1) * pageSize;

  if (!db) {
    return res.json({ logs: [], hasMore: false });
  }

  try {
    const logs = db.prepare(`
      SELECT * FROM dashboard_audit_log 
      WHERE guild_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(serverId, pageSize + 1, offset);

    const hasMore = logs.length > pageSize;
    if (hasMore) logs.pop();

    res.json({ logs, hasMore });
  } catch (error) {
    console.error('Failed to fetch audit logs:', error);
    res.json({ logs: [], hasMore: false });
  }
});

// Create audit log entry
app.post('/api/audit/:serverId', authMiddleware, (req, res) => {
  const { serverId } = req.params;
  const { userId, userName, userAvatar, action, category, details, metadata } = req.body;

  if (!db) {
    return res.json({ success: true });
  }

  if (!userId || !action || !category) {
    return res.status(400).json({ error: 'userId, action, and category are required' });
  }

  try {
    // Use UTC timestamp explicitly
    const utcTimestamp = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO dashboard_audit_log 
        (guild_id, user_id, user_name, user_avatar, action, category, details, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(serverId, userId, userName, userAvatar, action, category, details, metadata, utcTimestamp);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to create audit log:', error);
    res.status(500).json({ error: 'Failed to create audit log' });
  }
});

// ============================================================
// AUTO-TRANSLATE ENDPOINTS
// ============================================================

// Create auto-translate config
app.post('/api/config/:serverId/auto-translate', authMiddleware, (req, res) => {
  const { serverId } = req.params;
  const { 
    channelId, 
    sourceChannelId, 
    targetLanguage, 
    webhookId, 
    webhookToken,
    isActive 
  } = req.body;

  if (!db) {
    return res.json({ success: true, id: Date.now() });
  }

  if (!channelId || !sourceChannelId || !targetLanguage) {
    return res.status(400).json({ error: 'channelId, sourceChannelId, and targetLanguage are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO auto_translate_channels 
        (guild_id, channel_id, source_channel_id, target_language, webhook_id, webhook_token, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET 
        source_channel_id = ?,
        target_language = ?,
        webhook_id = ?,
        webhook_token = ?,
        is_active = ?,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      serverId, 
      channelId, 
      sourceChannelId, 
      targetLanguage, 
      webhookId || null, 
      webhookToken || null, 
      isActive !== false ? 1 : 0,
      sourceChannelId,
      targetLanguage,
      webhookId || null,
      webhookToken || null,
      isActive !== false ? 1 : 0
    );

    res.json({ success: true, id: result.lastInsertRowid || Date.now() });
  } catch (error) {
    console.error('Failed to create auto-translate config:', error);
    res.status(500).json({ error: 'Failed to create auto-translate config' });
  }
});

app.delete('/api/config/:serverId/auto-translate/:channelId', authMiddleware, (req, res) => {
  const { serverId, channelId } = req.params;

  if (!db) {
    return res.json({ success: true });
  }

  try {
    // Set is_active to 0 instead of deleting (preserve data)
    db.prepare(`
      UPDATE auto_translate_channels 
      SET is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE guild_id = ? AND channel_id = ?
    `).run(serverId, channelId);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to disable auto-translate:', error);
    res.status(500).json({ error: 'Failed to disable auto-translate' });
  }
});

// ============================================================
// ENHANCED STATS ENDPOINT
// ============================================================

app.get('/api/stats/:serverId', authMiddleware, (req, res) => {
  const { serverId } = req.params;

  if (!db) {
    return res.json({
      guild: { id: serverId, name: 'Unknown', icon: null },
      stats: {
        channels: { total: 0, mostActive: null, mostActiveCount: 0 },
        messages: { total: 0, lastWeek: 0 },
        users: { current: 0, total: 0, activeLastWeek: 0 },
        translations: { total: 0, lastWeek: 0, languagesUsed: 0, topLanguage: null },
        autoTranslate: { pairs: 0, activePairs: 0 },
        announcements: { routes: 0 },
        restrictions: { blockedChannels: 0 }
      }
    });
  }

  try {
    const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(serverId);

    const now = Date.now();
    const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const oneWeekAgoISO = new Date(oneWeekAgo).toISOString();

    // Channel stats
    const channelCount = db.prepare(`
      SELECT COUNT(DISTINCT channel_id) as count FROM messages WHERE guild_id = ?
    `).get(serverId);

    const mostActiveChannel = db.prepare(`
      SELECT m.channel_id, c.name as channel_name, COUNT(*) as message_count
      FROM messages m
      LEFT JOIN channels c ON m.channel_id = c.id
      WHERE m.guild_id = ?
      GROUP BY m.channel_id
      ORDER BY message_count DESC
      LIMIT 1
    `).get(serverId);

    // Message stats
    const messageCount = db.prepare(`
      SELECT COUNT(*) as count FROM messages WHERE guild_id = ?
    `).get(serverId);

    const messagesLastWeek = db.prepare(`
      SELECT COUNT(*) as count FROM messages WHERE guild_id = ? AND timestamp >= ?
    `).get(serverId, oneWeekAgoISO) || { count: 0 };

    // User stats
    const totalUsers = db.prepare(`
      SELECT COUNT(DISTINCT author_id) as count FROM messages WHERE guild_id = ?
    `).get(serverId);

    const activeUsersLastWeek = db.prepare(`
      SELECT COUNT(DISTINCT author_id) as count FROM messages WHERE guild_id = ? AND timestamp >= ?
    `).get(serverId, oneWeekAgoISO) || { count: 0 };

    let currentMemberCount = guild?.member_count || 0;

    // Translation stats
    let translationCount = { count: 0 };
    let translationsLastWeek = { count: 0 };
    let languagesUsed = { count: 0 };
    let topLanguage = null;

    try {
      translationCount = db.prepare(`
        SELECT COUNT(*) as count FROM translations t
        JOIN messages m ON t.message_id = m.id WHERE m.guild_id = ?
      `).get(serverId) || { count: 0 };

      translationsLastWeek = db.prepare(`
        SELECT COUNT(*) as count FROM translations t
        JOIN messages m ON t.message_id = m.id
        WHERE m.guild_id = ? AND t.created_at >= ?
      `).get(serverId, oneWeekAgoISO) || { count: 0 };

      languagesUsed = db.prepare(`
        SELECT COUNT(DISTINCT target_language) as count FROM translations t
        JOIN messages m ON t.message_id = m.id WHERE m.guild_id = ?
      `).get(serverId) || { count: 0 };

      topLanguage = db.prepare(`
        SELECT target_language, COUNT(*) as count FROM translations t
        JOIN messages m ON t.message_id = m.id WHERE m.guild_id = ?
        GROUP BY target_language ORDER BY count DESC LIMIT 1
      `).get(serverId);
    } catch (e) {
      console.log('Translations query failed:', e.message);
    }

    // Auto-translate stats
    const autoTranslateStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active
      FROM auto_translate_channels WHERE guild_id = ?
    `).get(serverId) || { total: 0, active: 0 };

    // Announcement stats
    const announcementCount = db.prepare(`
      SELECT COUNT(*) as count FROM announcement_translation_channels WHERE guild_id = ?
    `).get(serverId) || { count: 0 };

    // Blocked channels stats
    const blockedCount = db.prepare(`
      SELECT COUNT(*) as count FROM blocked_translation_channels WHERE guild_id = ?
    `).get(serverId) || { count: 0 };

    res.json({
      guild: {
        id: guild?.id || serverId,
        name: guild?.name || 'Unknown',
        icon: guild?.icon
      },
      stats: {
        channels: {
          total: channelCount?.count || 0,
          mostActive: mostActiveChannel?.channel_name || null,
          mostActiveCount: mostActiveChannel?.message_count || 0
        },
        messages: {
          total: messageCount?.count || 0,
          lastWeek: messagesLastWeek?.count || 0
        },
        users: {
          current: currentMemberCount,
          total: totalUsers?.count || 0,
          activeLastWeek: activeUsersLastWeek?.count || 0
        },
        translations: {
          total: translationCount?.count || 0,
          lastWeek: translationsLastWeek?.count || 0,
          languagesUsed: languagesUsed?.count || 0,
          topLanguage: topLanguage?.target_language || null
        },
        autoTranslate: {
          pairs: autoTranslateStats?.total || 0,
          activePairs: autoTranslateStats?.active || 0
        },
        announcements: {
          routes: announcementCount?.count || 0
        },
        restrictions: {
          blockedChannels: blockedCount?.count || 0
        }
      }
    });
  } catch (error) {
    console.error('Failed to get stats:', error);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ============================================================
// ERROR HANDLING
// ============================================================

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`🚀 MXN Translate Backend API running on port ${PORT}`);
  console.log(`📊 Database: ${db ? 'Connected' : 'Not connected'}`);
  console.log(`🔒 API Key authentication enabled`);
});