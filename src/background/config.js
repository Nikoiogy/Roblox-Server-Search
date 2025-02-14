// Configuration constants for the extension
export const CONFIG = {
    // Error handling
    MAX_CONSECUTIVE_ERRORS: 5,
    
    // Timing configurations
    INITIAL_BACKOFF_TIME: 1000,
    MAX_BACKOFF_TIME: 20000,
    REQUEST_TIMEOUT: 60000,
    
    // Cache and batch settings
    BATCH_SIZE: 50,
    SERVER_BATCH_LIMIT: 100,
    CACHE_DURATION: 300000,
    
    // Cooldown times (in seconds)
    COOLDOWN_TIME: {
        PRESENCE_ONLY: 3,    // Simple presence checks
        ADVANCED_SEARCH: 10  // Full server searches
    },
    
    // Rate limiting cooldowns (in milliseconds)
    RATE_LIMIT_COOLDOWN: {
        LARGE_SERVER: 5000,
        SMALL_SERVER: 50
    }
};