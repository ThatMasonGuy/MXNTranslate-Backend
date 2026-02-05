// MXNTranslate-Backend/server/service/discord.js
/**
 * Discord API Service
 * Provides methods to interact with Discord API using the bot token
 */
class DiscordService {
  constructor() {
    this.botToken = process.env.DISCORD_BOT_TOKEN;
    this.baseUrl = "https://discord.com/api/v10";
    
    if (!this.botToken) {
      throw new Error("DISCORD_BOT_TOKEN not configured in environment");
    }
  }

  /**
   * Make authenticated request to Discord API
   */
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bot ${this.botToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Get all guilds the bot is in
   */
  async getGuilds() {
    const guilds = await this.makeRequest("/users/@me/guilds");
    
    // Fetch additional details for each guild
    const detailedGuilds = await Promise.all(
      guilds.map(async (guild) => {
        try {
          const fullGuild = await this.makeRequest(`/guilds/${guild.id}`);
          return {
            id: guild.id,
            name: guild.name,
            icon: guild.icon,
            memberCount: fullGuild.approximate_member_count || 0,
            ownerId: fullGuild.owner_id,
          };
        } catch (error) {
          console.error(`Error fetching guild ${guild.id}:`, error.message);
          return {
            id: guild.id,
            name: guild.name,
            icon: guild.icon,
            memberCount: 0,
          };
        }
      })
    );

    return detailedGuilds;
  }

  /**
   * Get channels for a specific guild
   */
  async getGuildChannels(guildId) {
    const channels = await this.makeRequest(`/guilds/${guildId}/channels`);
    
    // Return sorted by position
    return channels
      .map(channel => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        position: channel.position,
        parentId: channel.parent_id,
      }))
      .sort((a, b) => a.position - b.position);
  }

  /**
   * Verify a guild exists and bot has access
   */
  async verifyGuildAccess(guildId) {
    try {
      await this.makeRequest(`/guilds/${guildId}`);
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new DiscordService();