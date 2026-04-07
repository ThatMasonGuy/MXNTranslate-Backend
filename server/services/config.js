// ~/MXNTranslate-Backend/server/services/config.js
const fs = require("fs").promises;
const path = require("path");

/**
 * Configuration Storage Service
 * Stores bot configurations per guild in a JSON file
 * Can be easily swapped for database storage later
 */
class ConfigService {
  constructor() {
    this.configFile = path.join(__dirname, "../../data/configs.json");
    this.defaultConfig = {
      autoTranslate: {
        enabled: false,
        channels: [],
        defaultLanguage: "en",
      },
      announcements: {
        enabled: false,
        sourceChannel: null,
        targetChannels: [],
      },
      general: {
        replyAsThread: true,
        showOriginalLanguage: true,
        allowDMTranslations: true,
      },
      restrictions: {
        blockedChannels: [],
      },
    };
  }

  /**
   * Ensure config file and directory exist
   */
  async ensureConfigFile() {
    const dir = path.dirname(this.configFile);
    
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }

    try {
      await fs.access(this.configFile);
    } catch {
      await fs.writeFile(this.configFile, JSON.stringify({}, null, 2));
    }
  }

  /**
   * Read all configs from file
   */
  async readConfigs() {
    await this.ensureConfigFile();
    const data = await fs.readFile(this.configFile, "utf-8");
    return JSON.parse(data);
  }

  /**
   * Write all configs to file
   */
  async writeConfigs(configs) {
    await this.ensureConfigFile();
    await fs.writeFile(this.configFile, JSON.stringify(configs, null, 2));
  }

  /**
   * Get configuration for a specific guild
   */
  async getConfig(guildId) {
    const configs = await this.readConfigs();
    
    if (!configs[guildId]) {
      // Return default config
      return { ...this.defaultConfig };
    }

    // Merge with defaults to ensure all fields exist
    return {
      ...this.defaultConfig,
      ...configs[guildId],
      autoTranslate: {
        ...this.defaultConfig.autoTranslate,
        ...(configs[guildId].autoTranslate || {}),
      },
      announcements: {
        ...this.defaultConfig.announcements,
        ...(configs[guildId].announcements || {}),
      },
      general: {
        ...this.defaultConfig.general,
        ...(configs[guildId].general || {}),
      },
      restrictions: {
        ...this.defaultConfig.restrictions,
        ...(configs[guildId].restrictions || {}),
      },
    };
  }

  /**
   * Update configuration for a specific guild
   */
  async updateConfig(guildId, newConfig) {
    const configs = await this.readConfigs();
    
    // Merge with existing config
    configs[guildId] = {
      ...configs[guildId],
      ...newConfig,
      updatedAt: new Date().toISOString(),
    };

    await this.writeConfigs(configs);
    
    return configs[guildId];
  }

  /**
   * Delete configuration for a specific guild
   */
  async deleteConfig(guildId) {
    const configs = await this.readConfigs();
    delete configs[guildId];
    await this.writeConfigs(configs);
  }

  /**
   * Get all guild IDs that have custom configs
   */
  async getConfiguredGuilds() {
    const configs = await this.readConfigs();
    return Object.keys(configs);
  }
}

module.exports = new ConfigService();