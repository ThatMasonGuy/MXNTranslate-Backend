// ============================================================
// Scheduled Message Executor Service
// ============================================================
// Run this as a background process or integrate into your Discord bot
// 
// Usage:
//   node scheduler-service.js
//
// Or with PM2:
//   pm2 start scheduler-service.js --name "scheduler"
//
// Environment variables needed:
//   - DB_PATH: Path to your SQLite database
//   - DISCORD_BOT_TOKEN: Your Discord bot token
// ============================================================

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from parent directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import { DateTime } from 'luxon';

// Configuration
const DB_PATH = process.env.DB_PATH || '/home/mason/discord_data/discord_tracker.db';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHECK_INTERVAL = 30 * 1000; // Check every 30 seconds

// Verify token is loaded
if (!DISCORD_BOT_TOKEN) {
  console.error('[Scheduler] ERROR: DISCORD_BOT_TOKEN not found in environment!');
  console.error('[Scheduler] Make sure your .env file contains DISCORD_BOT_TOKEN');
  process.exit(1);
}

console.log('[Scheduler] Bot token loaded:', DISCORD_BOT_TOKEN.substring(0, 10) + '...');

// Initialize database
let db;
try {
  db = new Database(DB_PATH, { readonly: false });
  console.log('[Scheduler] Connected to database');
} catch (error) {
  console.error('[Scheduler] Failed to connect to database:', error);
  process.exit(1);
}

// Discord API helpers
async function sendDiscordMessage(channelId, content, webhookId, webhookToken) {
  try {
    let url, headers, body;

    if (webhookId && webhookToken) {
      // Send via webhook (as user)
      url = `https://discord.com/api/v10/webhooks/${webhookId}/${webhookToken}`;
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({ content });
    } else {
      // Send via bot
      url = `https://discord.com/api/v10/channels/${channelId}/messages`;
      headers = {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      };
      body = JSON.stringify({ content });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error: ${response.status} - ${error}`);
    }

    // Handle empty responses (204 No Content)
    const text = await response.text();
    if (!text) {
      return { success: true, messageId: null };
    }
    
    try {
      const result = JSON.parse(text);
      return { success: true, messageId: result.id };
    } catch {
      return { success: true, messageId: null };
    }
  } catch (error) {
    console.error('[Scheduler] Failed to send message:', error);
    return { success: false, error: error.message };
  }
}

// Send message via webhook with custom name/avatar
async function sendWebhookMessage(webhookId, webhookToken, content, username, avatarUrl) {
  try {
    const response = await fetch(
      `https://discord.com/api/v10/webhooks/${webhookId}/${webhookToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          username: username || undefined,
          avatar_url: avatarUrl || undefined
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Webhook error: ${response.status} - ${error}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return { success: true, messageId: null };
    }
    
    try {
      const result = JSON.parse(text);
      return { success: true, messageId: result.id };
    } catch {
      return { success: true, messageId: null };
    }
  } catch (error) {
    console.error('[Scheduler] Failed to send webhook message:', error);
    return { success: false, error: error.message };
  }
}

// Create webhook for "send as me"
async function createUserWebhook(channelId) {
  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/webhooks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'MXN Scheduled Message'
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create webhook: ${response.status} - ${error}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[Scheduler] Failed to create webhook:', error);
    return null;
  }
}

// Fetch user's nickname in a guild
async function fetchGuildMemberNickname(guildId, userId) {
  try {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
      {
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
        }
      }
    );

    if (!response.ok) {
      // User might not be in guild anymore, or bot can't see them
      console.log(`[Scheduler] Could not fetch member ${userId} in guild ${guildId}: ${response.status}`);
      return null;
    }

    const member = await response.json();
    return member.nick || null; // Returns null if no nickname set
  } catch (error) {
    console.error('[Scheduler] Failed to fetch guild member:', error);
    return null;
  }
}

// Delete webhook after use
async function deleteWebhook(webhookId, webhookToken) {
  try {
    await fetch(
      `https://discord.com/api/v10/webhooks/${webhookId}/${webhookToken}`,
      { method: 'DELETE' }
    );
  } catch (error) {
    console.error('[Scheduler] Failed to delete webhook:', error);
  }
}

// Process Discord timestamps in message - handles new inline format {timestamp:HH:MM:FORMAT}
function processTimestamp(message, timezone) {
  const tz = timezone || 'UTC';
  let result = message;
  
  // New format: {ts:UNIX:FORMAT} - Unix timestamp already calculated by frontend
  const unixFormatRegex = /\{ts:(\d+):([A-Za-z])\}/g;
  const unixMatches = [...message.matchAll(unixFormatRegex)];
  
  for (const match of unixMatches) {
    const [fullMatch, unix, format] = match;
    const discordTimestamp = `<t:${unix}:${format}>`;
    result = result.replace(fullMatch, discordTimestamp);
  }
  
  // Legacy format: {timestamp:HH:MM:FORMAT} - calculate based on timezone
  const timestampRegex = /\{timestamp:(\d{2}:\d{2}):([A-Za-z])\}/g;
  const matches = [...result.matchAll(timestampRegex)];
  
  for (const match of matches) {
    const [fullMatch, time, format] = match;
    const [hours, minutes] = time.split(':').map(Number);
    
    // Get today in the target timezone and set the time
    let targetDate = DateTime.now().setZone(tz).set({ 
      hour: hours, 
      minute: minutes, 
      second: 0, 
      millisecond: 0 
    });
    
    // If the target time has passed today in that timezone, use tomorrow
    if (targetDate <= DateTime.now()) {
      targetDate = targetDate.plus({ days: 1 });
    }
    
    const unixTimestamp = Math.floor(targetDate.toSeconds());
    const discordTimestamp = `<t:${unixTimestamp}:${format}>`;
    
    result = result.replace(fullMatch, discordTimestamp);
  }
  
  // Very old format: {timestamp} (for backwards compatibility)
  if (result.includes('{timestamp}')) {
    const unixTimestamp = Math.floor(Date.now() / 1000);
    result = result.replace('{timestamp}', `<t:${unixTimestamp}:R>`);
  }
  
  return result;
}

// Fetch server emotes from Discord API
async function fetchServerEmotes(guildId) {
  try {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/emojis`,
      {
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
        }
      }
    );

    if (!response.ok) {
      console.log(`[Scheduler] Could not fetch emotes for guild ${guildId}: ${response.status}`);
      return [];
    }

    return await response.json();
  } catch (error) {
    console.error('[Scheduler] Failed to fetch server emotes:', error);
    return [];
  }
}

// Process emotes in message - convert :emoteName: to <:emoteName:id> or <a:emoteName:id>
async function processEmotes(message, guildId) {
  // Find all :emoteName: patterns
  const emoteRegex = /:([a-zA-Z0-9_]+):/g;
  const matches = message.match(emoteRegex);
  
  if (!matches || matches.length === 0) {
    return message;
  }

  // Fetch server emotes
  const emotes = await fetchServerEmotes(guildId);
  if (emotes.length === 0) {
    return message;
  }

  // Create lookup map
  const emoteMap = new Map(emotes.map(e => [e.name.toLowerCase(), e]));

  // Replace each emote
  let result = message;
  for (const match of matches) {
    const emoteName = match.slice(1, -1).toLowerCase(); // Remove : from both ends
    const emote = emoteMap.get(emoteName);
    
    if (emote) {
      const prefix = emote.animated ? 'a' : '';
      const replacement = `<${prefix}:${emote.name}:${emote.id}>`;
      result = result.replace(match, replacement);
    }
    // If emote not found, leave as-is (will show as text)
  }

  return result;
}

// Calculate next run time for recurring messages using luxon for proper timezone handling
function calculateNextRun(rule, day, time, timezone) {
  const tz = timezone || 'UTC';
  const [hours, minutes] = (time || '12:00').split(':').map(Number);
  
  // Get current time in the target timezone
  let next = DateTime.now().setZone(tz);
  
  switch (rule) {
    case 'daily':
      // Set to today at the specified time
      next = next.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
      // If that time has passed today, move to tomorrow
      if (next <= DateTime.now()) {
        next = next.plus({ days: 1 });
      }
      break;
      
    case 'weekly':
      // Set to this week on the specified day
      next = next.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
      const currentDay = next.weekday % 7; // luxon uses 1-7 (Mon-Sun), convert to 0-6 (Sun-Sat)
      const targetDay = day; // 0-6 (Sun-Sat)
      let daysUntil = (targetDay - currentDay + 7) % 7;
      
      next = next.plus({ days: daysUntil });
      // If that's today but the time has passed, add a week
      if (next <= DateTime.now()) {
        next = next.plus({ weeks: 1 });
      }
      break;
      
    case 'biweekly':
      // Same as weekly but add 2 weeks if needed
      next = next.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
      const currentDay2 = next.weekday % 7;
      const targetDay2 = day;
      let daysUntil2 = (targetDay2 - currentDay2 + 7) % 7;
      
      next = next.plus({ days: daysUntil2 });
      if (next <= DateTime.now()) {
        next = next.plus({ weeks: 2 });
      }
      break;
      
    case 'monthly':
      // Set to this month on the specified day
      next = next.set({ day: Math.min(day, next.daysInMonth), hour: hours, minute: minutes, second: 0, millisecond: 0 });
      if (next <= DateTime.now()) {
        next = next.plus({ months: 1 });
        // Handle months with fewer days
        next = next.set({ day: Math.min(day, next.daysInMonth) });
      }
      break;
      
    default:
      next = next.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
      if (next <= DateTime.now()) {
        next = next.plus({ days: 1 });
      }
  }
  
  // Convert to UTC ISO string for storage
  return next.toUTC().toISO();
}

// Log execution
function logExecution(messageId, guildId, channelId, status, errorMessage, discordMessageId) {
  try {
    db.prepare(`
      INSERT INTO scheduled_message_log 
        (scheduled_message_id, guild_id, channel_id, executed_at, status, error_message, discord_message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(messageId, guildId, channelId, new Date().toISOString(), status, errorMessage, discordMessageId);
  } catch (error) {
    console.error('[Scheduler] Failed to log execution:', error);
  }
}

// Process a single scheduled message
async function processMessage(message) {
  console.log(`[Scheduler] Processing message ${message.id}: "${message.title || 'Untitled'}"`);

  // Build the message content
  let content = message.message_content;

  // Process any inline timestamps {timestamp:HH:MM:FORMAT}
  content = processTimestamp(content, message.recurrence_timezone);

  // Process emotes - convert :emoteName: to <:emoteName:id>
  content = await processEmotes(content, message.guild_id);

  // Note: Pings (@everyone, @here, <@&roleId>) are now embedded directly in the message content
  // by the MessageComposer, so no need to prepend them here

  // Send the message
  let result;
  let tempWebhook = null;

  if (message.send_as === 'webhook') {
    // Get avatar URL - might be stored as full URL or need to construct it
    let avatarUrl = message.creator_user_avatar;
    
    // Fetch user's nickname in this guild (falls back to username if no nickname)
    const nickname = await fetchGuildMemberNickname(message.guild_id, message.creator_user_id);
    const displayName = nickname || message.creator_user_name;
    
    console.log(`[Scheduler] Sending as webhook - Display name: ${displayName}, Avatar URL: ${avatarUrl || 'none'}`);
    
    // Create temporary webhook to send as user
    tempWebhook = await createUserWebhook(message.channel_id);

    if (tempWebhook) {
      // Send with user's name and avatar
      result = await sendWebhookMessage(
        tempWebhook.id,
        tempWebhook.token,
        content,
        displayName,
        avatarUrl
      );
      
      // Clean up the webhook
      await deleteWebhook(tempWebhook.id, tempWebhook.token);
    } else {
      // Fallback to bot if webhook creation fails
      console.log('[Scheduler] Webhook creation failed, falling back to bot');
      result = await sendDiscordMessage(message.channel_id, content);
    }
  } else {
    // Send as bot
    result = await sendDiscordMessage(message.channel_id, content);
  }

  // Log the execution
  logExecution(
    message.id,
    message.guild_id,
    message.channel_id,
    result.success ? 'success' : 'failed',
    result.error || null,
    result.messageId || null
  );

  // Update the message
  if (message.schedule_type === 'once') {
    // Mark as inactive for one-time messages
    db.prepare(`
      UPDATE scheduled_messages 
      SET is_active = 0, last_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), new Date().toISOString(), message.id);
    
    console.log(`[Scheduler] One-time message ${message.id} completed`);
  } else {
    // Calculate next run for recurring messages
    const nextRun = calculateNextRun(
      message.recurrence_rule,
      message.recurrence_day,
      message.recurrence_time,
      message.recurrence_timezone
    );

    // Check if we've passed the end date
    if (message.recurrence_end_at && new Date(nextRun) > new Date(message.recurrence_end_at)) {
      db.prepare(`
        UPDATE scheduled_messages 
        SET is_active = 0, last_run_at = ?, updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), new Date().toISOString(), message.id);
      
      console.log(`[Scheduler] Recurring message ${message.id} ended (past end date)`);
    } else {
      db.prepare(`
        UPDATE scheduled_messages 
        SET next_run_at = ?, last_run_at = ?, updated_at = ?
        WHERE id = ?
      `).run(nextRun, new Date().toISOString(), new Date().toISOString(), message.id);
      
      console.log(`[Scheduler] Recurring message ${message.id} next run: ${nextRun}`);
    }
  }
}

// Main scheduler loop
async function checkAndProcessMessages() {
  try {
    const now = new Date().toISOString();

    // Find all messages that are due
    const dueMessages = db.prepare(`
      SELECT * FROM scheduled_messages
      WHERE is_active = 1 
        AND is_paused = 0 
        AND next_run_at <= ?
      ORDER BY next_run_at ASC
      LIMIT 10
    `).all(now);

    if (dueMessages.length > 0) {
      console.log(`[Scheduler] Found ${dueMessages.length} due message(s)`);
    }

    for (const message of dueMessages) {
      await processMessage(message);
    }
  } catch (error) {
    console.error('[Scheduler] Error in check loop:', error);
  }
}

// Start the scheduler
console.log('[Scheduler] Starting scheduler service...');
console.log(`[Scheduler] Check interval: ${CHECK_INTERVAL / 1000}s`);

// Run immediately, then on interval
checkAndProcessMessages();
setInterval(checkAndProcessMessages, CHECK_INTERVAL);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[Scheduler] Shutting down...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Scheduler] Shutting down...');
  db.close();
  process.exit(0);
});
