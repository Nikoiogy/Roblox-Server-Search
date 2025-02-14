import { CONFIG } from './config.js';
import { RateLimiter } from './rateLimiter.js';

/**
 * Main background search functionality
 */
export class BackgroundSearch {
    constructor() {
        // Search state
        this.isSearching = false;
        this.currentPlaceId = null;
        this.serverSizeMoreThan5 = false;
        this.abortController = new AbortController();
        
        // Rate limiting and delays
        this.rateLimiter = new RateLimiter();
        this.baseDelay = 1000;
        this.maxDelay = 30000;
        this.currentDelay = this.baseDelay;
        
        // Search target info
        this.targetAvatarUrl = null;
        
        // Progress tracking
        this.totalServersFound = 0;
        this.currentBatchProgress = 0;
        this.batchSize = CONFIG.BATCH_SIZE;
    }

    /**
     * Reset search state and clear storage
     */
    async resetSearchState() {
        if (this.isSearching) {
            this.abortController.abort();
            this.abortController = new AbortController();
            this.isSearching = false;
            this.totalServersFound = 0;
            this.currentBatchProgress = 0;
            
            await browser.storage.local.set({
                searchState: null,
                searchResult: null,
                searchError: null,
                searchProgress: null
            });
        }
    }

    /**
     * Start a new search
     */
    async startSearch(placeId, userId, avatarUrl, username, serverSizeMoreThan5) {
        if (this.isSearching) {
            return { error: 'Search already in progress' };
        }
        
        try {
            await browser.storage.local.remove('storedLogs');
            this.isSearching = true;
            this.targetAvatarUrl = avatarUrl;
            this.currentPlaceId = placeId;
            this.serverSizeMoreThan5 = serverSizeMoreThan5;
            this.totalServersFound = 0;
            this.currentBatchProgress = 0;
            this.abortController = new AbortController();
            let searchStartTime = Date.now();
            
            // First try to find by presence
            try {
                const presenceResponse = await fetch(
                    "https://presence.roblox.com/v1/presence/users",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ userIds: [userId] })
                    }
                );
    
                if (presenceResponse.ok) {
                    const presence = await presenceResponse.json();
                    const userPresence = presence.userPresences?.[0];
                    
                    if (userPresence && userPresence.placeId === parseInt(placeId) && userPresence.gameId) {
                        // Player found directly through presence
                        const result = {
                            found: true,
                            gameId: userPresence.gameId,
                            avatarUrl,
                            username,
                            searchType: 'presence'
                        };
    
                        await browser.storage.local.set({
                            searchState: null,
                            searchResult: result,
                            searchCompleted: Date.now(),
                            searchType: 'presence',
                            isSearching: false
                        });
    
                        return result;
                    }
                }
            } catch (error) {
                console.error('Presence check failed:', error);
                // Continue to advanced search if presence check fails
            }
    
            // If presence check didn't find the player, proceed with advanced search
            await browser.storage.local.set({
                searchState: {
                    isSearching: true,
                    placeId,
                    userId,
                    avatarUrl,
                    username,
                    startTime: searchStartTime
                },
                searchResult: null,
                searchError: null
            });
    
            const result = await this.searchServers(avatarUrl, username);
            
            // Add searchType to the result
            result.searchType = 'advanced';
            
            await browser.storage.local.set({
                searchState: null,
                searchResult: result,
                searchCompleted: Date.now(),
                searchType: 'advanced',
                isSearching: false
            });
    
            return result;
        } catch (error) {
            console.error(`Search error: ${error.message}`);
            await browser.storage.local.set({
                searchError: error.message,
                searchState: null,
                isSearching: false
            });
            throw error;
        } finally {
            this.isSearching = false;
        }
    }

    /**
     * Update search progress
     */
    async updateProgress(serversChecked, currentBatch = null, totalBatches = null) {
        let progressPercent;
        const SERVER_PHASE_WEIGHT = 0.4; // 40% of total progress
        const BATCH_PHASE_WEIGHT = 0.6; // 60% of total progress
    
        if (currentBatch !== null && totalBatches !== null) {
            // Batch processing phase
            const batchProgress = currentBatch / totalBatches;
            progressPercent = (SERVER_PHASE_WEIGHT * 100) + (batchProgress * BATCH_PHASE_WEIGHT * 100);
        } else {
            // Server checking phase
            const maxServersToCheck = 200;
            const serverProgress = Math.min(1, serversChecked / maxServersToCheck);
            progressPercent = serverProgress * SERVER_PHASE_WEIGHT * 100;
        }
    
        // Throttle updates to 500ms
        const currentTime = Date.now();
        const lastUpdate = this.lastProgressUpdate || 0;
        if (currentTime - lastUpdate > 500) {
            await browser.storage.local.set({
                searchProgress: {
                    serversChecked,
                    currentBatch,
                    totalBatches,
                    progressPercent,
                    timestamp: currentTime
                }
            });
            this.lastProgressUpdate = currentTime;
        }
    }

    /**
     * Search through servers for player
     */
    async searchServers(avatarUrl, username) {
        let cursor = "";
        let allTokens = [];
        let totalServersChecked = 0;
        let consecutiveErrors = 0;
        await this.updateProgress(0);
        
        try {
            do {
                if (this.abortController.signal.aborted) {
                    return { found: false, cancelled: true };
                }

                try {
                    await this.rateLimiter.waitForToken('servers', this.currentDelay);
                    
                    const response = await fetch(
                        `https://games.roblox.com/v1/games/${this.currentPlaceId}/servers/0?limit=100&cursor=${cursor}`,
                        {
                            credentials: this.serverSizeMoreThan5 ? "omit" : "include",
                            signal: this.abortController.signal
                        }
                    );

                    if (response.status === 429) {
                        this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
                        continue;
                    }

                    if (!response.ok) {
                        throw new Error(`Server fetch failed: ${response.status}`);
                    }

                    this.currentDelay = this.baseDelay;
                    consecutiveErrors = 0;

                    const servers = await response.json();
                    
                    if (servers.errors) {
                        continue;
                    }

                    totalServersChecked += servers.data.length;
                    await this.updateProgress(totalServersChecked);
                    
                    for (let server of servers.data) {
                        if (this.abortController.signal.aborted) {
                            return { found: false, cancelled: true };
                        }
                        
                        allTokens.push(...server.playerTokens.map(token => ({
                            requestId: server.id,
                            token: token,
                            type: "AvatarHeadshot",
                            size: "150x150",
                            format: "png",
                            isCircular: true
                        })));
                    }

                    if (allTokens.length > 0) {
                        const result = await this.checkTokenBatch(allTokens);
                        if (result) {
                            return {
                                found: true,
                                gameId: result,
                                avatarUrl,
                                username
                            };
                        }
                    }

                    cursor = servers.nextPageCursor;
                    allTokens = [];

                } catch (error) {
                    consecutiveErrors++;
                    
                    if (consecutiveErrors >= CONFIG.MAX_CONSECUTIVE_ERRORS) {
                        throw new Error('Too many consecutive errors');
                    }
                    
                    const errorDelay = Math.min(this.baseDelay * Math.pow(2, consecutiveErrors), this.maxDelay);
                    await this.sleep(errorDelay);
                }

            } while (cursor && !this.abortController.signal.aborted);

            return { found: false };
            
        } catch (error) {
            if (error.name === 'AbortError') {
                return { found: false, cancelled: true };
            }
            throw error;
        }
    }

    /**
     * Check a batch of player tokens
     */
    async checkTokenBatch(tokens) {
        const chunkedTokens = this.splitTokensIntoChunks(tokens, CONFIG.BATCH_SIZE);
        const totalBatches = chunkedTokens.length;
    
        await this.updateProgress(this.totalServersFound, 0, totalBatches);
    
        for (let i = 0; i < chunkedTokens.length; i++) {
            await this.updateProgress(this.totalServersFound, i + 1, totalBatches);
            try {
                await this.rateLimiter.waitForToken('tokens', this.currentDelay);
                
                await this.updateProgress(
                    this.totalServersFound, 
                    i + 1, 
                    chunkedTokens.length
                );

                const response = await fetch("https://thumbnails.roblox.com/v1/batch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(chunkedTokens[i]),
                    signal: this.abortController.signal
                });

                if (response.status === 429) {
                    this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
                    i--; // Retry this batch
                    continue;
                }

                if (!response.ok) {
                    throw new Error(`Batch check failed: ${response.status}`);
                }

                this.currentDelay = this.baseDelay;
                const data = await response.json();
                
                if (data.data) {
                    const match = data.data.find(item => item.imageUrl === this.targetAvatarUrl);
                    if (match) {
                        return match.requestId;
                    }
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    return null;
                }
                
                this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
                await this.sleep(this.currentDelay);
                i--; // Retry this batch
            }
        }
        await this.updateProgress(this.totalServersFound, totalBatches, totalBatches);
        return null;
    }

    /**
     * Split tokens into smaller chunks for processing
     */
    splitTokensIntoChunks(array, size = CONFIG.SERVER_BATCH_LIMIT) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Sleep with abort controller support
     */
    sleep(ms) {
        return new Promise(resolve => {
            const timeout = setTimeout(resolve, ms);
            this.abortController.signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }
}