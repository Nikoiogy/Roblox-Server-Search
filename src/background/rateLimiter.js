import { CONFIG } from './config.js';

/**
 * RateLimiter class to manage API request rates
 */
export class RateLimiter {
    constructor() {
        this.requests = new Map();
        this.lastCleanup = Date.now();
    }

    /**
     * Wait for a token before making a request
     * @param {string} key - Identifier for the request type
     * @param {number} cooldownTime - Time to wait between requests
     * @returns {Promise<void>}
     */
    async waitForToken(key, cooldownTime) {
        const now = Date.now();
        
        // Cleanup old entries if needed
        if (now - this.lastCleanup > CONFIG.CACHE_DURATION) {
            this.cleanup();
        }
        
        // Check if we need to wait
        const lastRequest = this.requests.get(key) || 0;
        const timeToWait = lastRequest + cooldownTime - now;
        
        if (timeToWait > 0) {
            await new Promise(resolve => setTimeout(resolve, timeToWait));
        }
        
        // Update last request time
        this.requests.set(key, Date.now());
    }

    /**
     * Clean up old entries from the requests map
     */
    cleanup() {
        const now = Date.now();
        for (const [key, timestamp] of this.requests.entries()) {
            if (now - timestamp > CONFIG.CACHE_DURATION) {
                this.requests.delete(key);
            }
        }
        this.lastCleanup = now;
    }
}