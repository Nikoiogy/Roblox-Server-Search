/**
 * Constants for API configuration
 */
export const API_CONFIG = {
    // Request configuration
    TIMEOUT: 15000,
    MAX_RETRIES: 3,
    
    // Cooldown times (in seconds)
    COOLDOWN_TIME: {
        PRESENCE_ONLY: 3,    // Simple presence check
        ADVANCED_SEARCH: 10  // Full server search
    },
    
    // Default images
    DEFAULTS: {
        AVATAR: '/src/assets/icons/default_avatar.png',
        THUMBNAIL: '/src/assets/icons/default_thumbnail.png'
    },

    // Validation patterns
    PATTERNS: {
        USERNAME: /^[a-zA-Z0-9_]{3,20}$/,
        USERID: /^\d+$/
    }
};

/**
 * Handles all Roblox API interactions
 */
export class RobloxAPI {
    constructor() {
        this.controller = new AbortController();
    }

    /**
     * Fetch with retry and timeout functionality
     */
    async fetchWithRetry(url, options = {}, retries = API_CONFIG.MAX_RETRIES) {
        let lastError;
        const finalOptions = {
            ...options,
            signal: this.controller.signal,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        for (let i = 0; i < retries; i++) {
            try {
                const timeoutId = setTimeout(() => this.controller.abort(), API_CONFIG.TIMEOUT);
                const response = await fetch(url, finalOptions);
                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return await response.json();
            } catch (error) {
                lastError = error;
                console.error(`API call failed (attempt ${i + 1}/${retries}):`, error);
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
                }
            }
        }
        throw lastError;
    }

    /**
     * Get user details
     */
    async getUserDetails(userId) {
        return this.fetchWithRetry(`https://users.roblox.com/v1/users/${userId}`);
    }

    /**
     * Get user presence information
     */
    async getUserPresence(userId) {
        return this.fetchWithRetry("https://presence.roblox.com/v1/presence/users", {
            method: "POST",
            body: JSON.stringify({ userIds: [userId] })
        });
    }

    /**
     * Get game details
     */
    async getGameDetails(placeId) {
        const universeResponse = await this.fetchWithRetry(
            `https://apis.roblox.com/universes/v1/places/${placeId}/universe`
        );
        const universeId = universeResponse.universeId;
        return this.fetchWithRetry(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
    }

    /**
     * Get game thumbnail
     */
    async getGameThumbnail(placeId) {
        return this.fetchWithRetry(
            `https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${placeId}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`
        );
    }

    /**
     * Get user avatar
     */
    async getUserAvatar(userId) {
        return this.fetchWithRetry(
            `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png`
        );
    }

    /**
     * Get username details by ID or username
     */
    async getUserByNameOrId(input) {
        if (!API_CONFIG.PATTERNS.USERID.test(input)) {
            return this.fetchWithRetry(
                "https://users.roblox.com/v1/usernames/users",
                {
                    method: "POST",
                    body: JSON.stringify({
                        "usernames": [input],
                        "excludeBannedUsers": true
                    })
                }
            );
        }
        return this.getUserDetails(input);
    }

    /**
     * Abort all pending requests
     */
    abortRequests() {
        this.controller.abort();
        this.controller = new AbortController();
    }
}