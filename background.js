// Configuration constants
const CONFIG = {
    MAX_CONSECUTIVE_ERRORS: 5,
    INITIAL_BACKOFF_TIME: 1000,
    MAX_BACKOFF_TIME: 20000,
    BATCH_SIZE: 50,
    SERVER_BATCH_LIMIT: 100,
    CACHE_DURATION: 300000,
    REQUEST_TIMEOUT: 60000,
    RATE_LIMIT_COOLDOWN: {
        LARGE_SERVER: 5000,
        SMALL_SERVER: 50
    }
};

class RateLimiter {
    constructor() {
        this.requests = new Map();
        this.lastCleanup = Date.now();
    }

    async waitForToken(key, cooldownTime) {
        const now = Date.now();
        
        if (now - this.lastCleanup > 300000) {
            this.cleanup();
        }

        const lastRequest = this.requests.get(key) || 0;
        const timeToWait = lastRequest + cooldownTime - now;

        if (timeToWait > 0) {
            await new Promise(resolve => setTimeout(resolve, timeToWait));
        }

        this.requests.set(key, Date.now());
    }

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

class APIClient {
    constructor(debugLog) {
        this.debugLog = debugLog;
        this.rateLimiter = new RateLimiter();
        this.cache = new Map();
        this.lastCleanup = Date.now();
    }

    async fetchWithTimeout(url, options = {}) {
        await this.debugLog('info', `Making API request to: ${url}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, CONFIG.REQUEST_TIMEOUT);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            return data;
        } finally {
            clearTimeout(timeout);
        }
    }

    async fetchWithRetry(url, options = {}, maxRetries = 3) {
        await this.debugLog('info', `Starting API request with ${maxRetries} max retries`);
        let lastError;
        let delay = CONFIG.INITIAL_BACKOFF_TIME;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await this.fetchWithTimeout(url, options);
            } catch (error) {
                lastError = error;
                await this.debugLog('warn', `Attempt ${attempt + 1} failed:`, error.message);
                
                if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay = Math.min(delay * 2, CONFIG.MAX_BACKOFF_TIME);
                }
            }
        }
        
        throw lastError;
    }

    getCacheKey(url, options = {}) {
        return `${url}-${JSON.stringify(options)}`;
    }

    async getCachedResponse(url, options = {}) {
        const key = this.getCacheKey(url, options);
        const cached = this.cache.get(key);
        
        if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
            return cached.data;
        }
        
        const response = await this.fetchWithRetry(url, options);
        this.cache.set(key, {
            data: response,
            timestamp: Date.now()
        });
        
        return response;
    }

    cleanup() {
        const now = Date.now();
        if (now - this.lastCleanup > CONFIG.CACHE_DURATION) {
            for (const [key, value] of this.cache.entries()) {
                if (now - value.timestamp > CONFIG.CACHE_DURATION) {
                    this.cache.delete(key);
                }
            }
            this.lastCleanup = now;
        }
    }
}

class BackgroundSearch {
    constructor() {
        this.currentSearch = null;
        this.searchResults = null;
        this.isSearching = false;
        this.currentPlaceId = null;
        this.serverSizeMoreThan5 = false;
        this.abortController = new AbortController();
        this.totalServersProcessed = 0;
        this.searchId = 0; // Add a unique identifier for each search
        this._searchLock = false;  // Add this
    }

    async resetSearchState() {
        if (this.isSearching) {
            this.abortController.abort();
            this.abortController = new AbortController(); // Create new controller for next search
            this.isSearching = false;
            this.totalServersProcessed = 0;
            
            await browser.storage.local.set({
                searchState: null,
                searchResult: null,
                searchError: null,
                searchProgress: null
            });
            
            this.log('Search state reset due to popup disconnect');
        }
    }


    async startSearch(placeId, userId, avatarUrl, username, serverSizeMoreThan5) {
        if (this._searchLock) {
            return { error: 'Search already in progress' };
        }
        this._searchLock = true;
        
        try {    
            this.isSearching = true;
            this.searchId++; // Increment search ID
            const currentSearchId = this.searchId;
            
            this.currentPlaceId = placeId;
            this.serverSizeMoreThan5 = serverSizeMoreThan5;
            this.totalServersProcessed = 0;
            
            // Reset abort controller
            this.abortController = new AbortController();
            
            this.log(`Starting search #${currentSearchId} for ${username} in game ${placeId}`);
            
            // Clear any previous search state
            await browser.storage.local.set({
                searchState: {
                    id: currentSearchId,
                    isSearching: true,
                    placeId,
                    userId,
                    avatarUrl,
                    username,
                    startTime: Date.now()
                },
                searchResult: null,
                searchError: null
            });

            const result = await this.searchServers(avatarUrl, username, currentSearchId);
            
            // Only update state if this is still the current search
            if (this.searchId === currentSearchId) {
                this.log(`Search #${currentSearchId} completed. Found: ${result.found}`);
                
                await browser.storage.local.set({
                    searchState: null,
                    searchResult: result,
                    isSearching: false
                });
            }

            return result;
        } catch (error) {
            this.log(`Search error: ${error.message}`, 'error');
            await browser.storage.local.set({
                searchError: error.message,
                searchState: null,
                isSearching: false
            });
            throw error;
        } finally {
            this._searchLock = false;
            this.isSearching = false;
        }
    }

    async searchServers(avatarUrl, username, searchId) {
        let cursor = "";
        let allTokens = [];
        let totalServersChecked = 0;
        
        try {
            await browser.storage.local.set({
                searchState: {
                    id: searchId,
                    isSearching: true,
                    message: 'Starting server search...',
                    timestamp: Date.now()
                }
            });
    
            do {
                // Check if this search is still valid
                if (this.searchId !== searchId) {
                    this.log(`Search #${searchId} was superseded, stopping`);
                    return { found: false, cancelled: true };
                }
    
                if (this.abortController.signal.aborted) {
                    this.log(`Search #${searchId} aborted by user`);
                    return { found: false, cancelled: true };
                }
    
                this.log(`Fetching servers with cursor: ${cursor}`);
                
                if (cursor) {
                    const cooldownTime = this.serverSizeMoreThan5 ? 
                        CONFIG.RATE_LIMIT_COOLDOWN.LARGE_SERVER : 
                        CONFIG.RATE_LIMIT_COOLDOWN.SMALL_SERVER;
                    await this.sleep(cooldownTime);
                }
    
                const response = await fetch(
                    `https://games.roblox.com/v1/games/${this.currentPlaceId}/servers/0?limit=100&cursor=${cursor}`,
                    {
                        credentials: this.serverSizeMoreThan5 ? "omit" : "include",
                        signal: this.abortController.signal
                    }
                );
    
                if (!response.ok) {
                    throw new Error(`Server fetch failed: ${response.status}`);
                }
    
                const servers = await response.json();
    
                if (servers.errors) {
                    this.log(`Server fetch error: ${JSON.stringify(servers.errors)}`, 'warn');
                    await this.sleep(1000);
                    continue;
                }
    
                totalServersChecked += servers.data.length;
                this.totalServersProcessed += servers.data.length;
                
                await browser.storage.local.set({
                    searchState: {
                        id: searchId,
                        isSearching: true,
                        message: `Checking servers (${totalServersChecked} processed)...`,
                        timestamp: Date.now()
                    },
                    searchProgress: {
                        searchId: searchId,
                        cursor: cursor,
                        serversChecked: totalServersChecked,
                        totalProcessed: this.totalServersProcessed,
                        timestamp: Date.now()
                    }
                });
    
                this.log(`Processing ${servers.data.length} servers. Total checked: ${totalServersChecked}`);
    
                for (let server of servers.data) {
                    if (this.abortController.signal.aborted || this.searchId !== searchId) {
                        return { found: false, cancelled: true };
                    }
                    
                    for (let playerToken of server.playerTokens) {
                        allTokens.push({
                            requestId: server.id,
                            token: playerToken,
                            type: "AvatarHeadshot",
                            size: "150x150",
                            format: "png",
                            isCircular: true
                        });
                    }
                }
    
                if (allTokens.length > 0) {
                    this.log(`Checking batch of ${allTokens.length} tokens`);
                    const result = await this.checkTokenBatch(allTokens, avatarUrl);
                    if (result) {
                        this.log(`Player found in server: ${result}`);
                        
                        await browser.storage.local.set({
                            searchState: null,
                            searchResult: {
                                found: true,
                                gameId: result,
                                avatarUrl,
                                username
                            }
                        });
                        
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
    
            } while (cursor && !this.abortController.signal.aborted && this.searchId === searchId);
    
            this.log('Search completed - player not found');
            
            await browser.storage.local.set({
                searchState: null,
                searchResult: {
                    found: false,
                    message: 'Player not found in any server'
                }
            });
            
            return { found: false };
        } catch (error) {
            if (error.name === 'AbortError') {
                this.log('Search aborted');
                await browser.storage.local.set({
                    searchState: null,
                    searchResult: {
                        found: false,
                        cancelled: true
                    }
                });
                return { found: false, cancelled: true };
            }
            
            this.log(`Search error: ${error.message}`, 'error');
            
            await browser.storage.local.set({
                searchState: null,
                searchError: error.message
            });
            
            throw error;
        }
    }
    
    async checkTokenBatch(tokens, targetAvatarUrl) {
        const chunkedTokens = this.splitTokensIntoChunks(tokens, CONFIG.BATCH_SIZE);
        this.log(`Processing ${chunkedTokens.length} token batches`);
    
        for (let i = 0; i < chunkedTokens.length; i++) {
            const chunk = chunkedTokens[i];
            this.log(`Processing batch ${i + 1}/${chunkedTokens.length} (${chunk.length} tokens)`);
    
            if (this.abortController.signal.aborted) {
                return null;
            }
    
            let retries = CONFIG.MAX_CONSECUTIVE_ERRORS;
            while (retries > 0) {
                try {
                    await this.sleep(1000);
                    
                    const response = await fetch("https://thumbnails.roblox.com/v1/batch", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(chunk),
                        signal: this.abortController.signal
                    });
    
                    if (!response.ok) {
                        throw new Error(`Batch check failed: ${response.status}`);
                    }
    
                    const data = await response.json();
    
                    if (data.errors) {
                        if (data.errors.some(e => e.code === 0)) {
                            this.log('Rate limit hit, retrying...', 'warn');
                            await this.sleep(5000);
                            retries--;
                            continue;
                        }
                        break;
                    }
    
                    const match = data.data.find(item => item.imageUrl === targetAvatarUrl);
                    if (match) {
                        this.log(`Found matching avatar URL in batch ${i + 1}`);
                        return match.requestId;
                    }
                    break;
                } catch (error) {
                    if (error.name === 'AbortError') {
                        return null;
                    }
                    this.log(`Batch check error: ${error.message}`, 'error');
                    await this.sleep(5000);
                    retries--;
                }
            }
        }
        return null;
    }    

    splitTokensIntoChunks(array, size = CONFIG.SERVER_BATCH_LIMIT) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    sleep(ms) {
        return new Promise(resolve => {
            const timeout = setTimeout(resolve, ms);
            this.abortController.signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }

    async log(message, type = 'info') {
        // Don't send undefined messages
        if (!message) return;
    
        const logMessage = {
            type: 'debugLog',
            logType: type,
            text: typeof message === 'object' ? JSON.stringify(message, null, 2) : String(message),
            timestamp: Date.now(),
            searchId: this.searchId,
            messageId: `${this.searchId}-${Date.now()}-${Math.random()}` // Add unique message ID
        };
    
        await browser.storage.local.set({
            lastLogMessage: logMessage
        });
    
        try {
            await browser.runtime.sendMessage(logMessage);
        } catch (error) {
            if (!error.message.includes("Could not establish connection")) {
                console.error("Error sending log message:", error);
            }
        }
    }
}

// Initialize background search
const backgroundSearch = new BackgroundSearch();

// Add listener for popup disconnection
browser.runtime.onConnect.addListener((port) => {
    port.onDisconnect.addListener(async () => {
        await backgroundSearch.resetSearchState();
    });
});

// Update message listener
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'startSearch') {
        backgroundSearch.startSearch(
            message.placeId,
            message.userId,
            message.avatarUrl,
            message.username,
            message.serverSizeMoreThan5
        ).then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            sendResponse({ error: error.message });
        });
        return true;
    }
    return false;
});