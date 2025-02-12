// Constants for configuration
const CONFIG = {
    COOLDOWN_TIME: 10,
    MAX_PROCESSED_MESSAGES: 1000,
    MAX_RETRIES: 3,
    TIMEOUT: 15000,
    MAX_DEBUG_ENTRIES: 500,
    DEFAULT_AVATAR: '/icons/default_avatar.png',
    DEFAULT_THUMBNAIL: '/icons/default_thumbnail.png'
};

// Utility functions
const sanitizeHTML = (str) => {
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
};

const createSafeElement = (tag, attributes = {}, textContent = '') => {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'className') {
            element.className = value;
        } else if (key.startsWith('data-')) {
            element.setAttribute(key, value);
        } else {
            element[key] = value;
        }
    }
    if (textContent) {
        element.textContent = textContent;
    }
    return element;
};

// Enhanced debug message handler with memory management
class MessageHandler {
    constructor(maxSize = CONFIG.MAX_PROCESSED_MESSAGES) {
        this.processedMessages = new Set(); // Change to Set for simpler deduplication
        this.maxSize = maxSize;
        this.currentSearchId = null;
    }

    addMessage(message) {
        // Ignore messages without text
        if (!message.text) return false;

        // Update currentSearchId if this is a new search
        if (message.text.includes('Starting search #')) {
            const match = message.text.match(/Starting search #(\d+)/);
            if (match) {
                this.currentSearchId = parseInt(match[1]);
                this.processedMessages.clear(); // Clear messages when starting new search
            }
        }

        // Only process messages from the current search
        if (message.searchId && message.searchId !== this.currentSearchId) {
            return false;
        }

        // Use messageId for deduplication
        if (this.processedMessages.has(message.messageId)) {
            return false;
        }

        // Clean up old messages if we're at the limit
        if (this.processedMessages.size >= this.maxSize) {
            const oldestMessage = Array.from(this.processedMessages)[0];
            this.processedMessages.delete(oldestMessage);
        }

        this.processedMessages.add(message.messageId);
        return true;
    }

    reset() {
        this.processedMessages.clear();
        this.currentSearchId = null;
    }
}

// Improved debug console with memory management
class DebugConsole {
    constructor() {
        this.logElement = document.getElementById('debugLog');
        this.maxEntries = CONFIG.MAX_DEBUG_ENTRIES;
        this.entries = [];
        this.messageHandler = new MessageHandler();
        this.setupClearButton();
        this.initializeMessageListener();
        this.loadStoredLogs();
    }

    async loadStoredLogs() {
        try {
            const { storedLogs } = await browser.storage.local.get('storedLogs');
            if (storedLogs) {
                storedLogs.forEach(entry => this.log(entry.type, entry.message));
            }
        } catch (error) {
            this.log('error', 'Failed to load stored logs: ' + error.message);
        }
    }

    initializeMessageListener() {
        browser.runtime.onMessage.addListener((message) => {
            if (message.type === 'debugLog') {
                if (this.messageHandler.addMessage(message)) {
                    this.log(message.logType, message.text);
                }
                return true;
            }
            return false;
        });
    }

    log(type, ...args) {
        if (!this.logElement) return;

        const entry = this.createLogEntry(type, args);
        this.entries.push(entry);

        // Manage entry limit
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
            this.renderLogs();
        } else {
            this.logElement.appendChild(entry);
        }

        // Store logs in local storage
        this.storeLog(type, args);
        
        // Auto-scroll to bottom
        this.logElement.scrollTop = this.logElement.scrollHeight;
    }

    async storeLog(type, args) {
        try {
            const { storedLogs = [] } = await browser.storage.local.get('storedLogs');
            const newLog = {
                type,
                message: args.join(' '),
                timestamp: new Date().toISOString()
            };
            
            storedLogs.push(newLog);
            
            // Keep only the last maxEntries logs
            if (storedLogs.length > this.maxEntries) {
                storedLogs.shift();
            }
            
            await browser.storage.local.set({ storedLogs });
        } catch (error) {
            console.error('Failed to store log:', error);
        }
    }

    createLogEntry(type, args) {
        const entry = document.createElement('div');
        entry.className = `debug-entry ${type}`;

        const message = args.map(arg => {
            if (arg instanceof Error) return `${arg.message}\n${arg.stack}`;
            if (typeof arg === 'object') return JSON.stringify(arg, null, 2);
            return String(arg);
        }).join(' ');

        const time = new Date().toLocaleTimeString();
        entry.textContent = `[${time}] ${message}`;
        return entry;
    }

    setupClearButton() {
        const clearButton = document.getElementById('clearDebug');
        if (clearButton) {
            clearButton.addEventListener('click', () => this.clearLogs());
        }
    }

    clearLogs() {
        if (this.logElement) {
            this.entries = [];
            this.logElement.innerHTML = '';
            this.messageHandler.reset(); // Reset message handler when clearing logs
            browser.storage.local.remove('storedLogs');
        }
    }

    renderLogs() {
        if (!this.logElement) return;
        this.logElement.innerHTML = '';
        this.entries.forEach(entry => {
            this.logElement.appendChild(entry);
        });
    }
}

// Enhanced API client with retry logic and timeout
class RobloxAPI {
    constructor(debugConsole) {
        this.debugConsole = debugConsole;
        this.controller = new AbortController();
    }

    async fetchWithRetry(url, options = {}, retries = CONFIG.MAX_RETRIES) {
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
                const timeoutId = setTimeout(() => this.controller.abort(), CONFIG.TIMEOUT);
                const response = await fetch(url, finalOptions);
                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return await response.json();
            } catch (error) {
                lastError = error;
                this.debugConsole.log('error', `API call failed (attempt ${i + 1}/${retries}):`, error);
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
                }
            }
        }
        throw lastError;
    }

    async getUserDetails(userId) {
        return this.fetchWithRetry(`https://users.roblox.com/v1/users/${userId}`);
    }

    async getUserPresence(userId) {
        return this.fetchWithRetry("https://presence.roblox.com/v1/presence/users", {
            method: "POST",
            body: JSON.stringify({ userIds: [userId] })
        });
    }

    async getGameDetails(placeId) {
        const universeResponse = await this.fetchWithRetry(
            `https://apis.roblox.com/universes/v1/places/${placeId}/universe`
        );
        const universeId = universeResponse.universeId;
        return this.fetchWithRetry(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
    }

    async getGameThumbnail(placeId) {
        return this.fetchWithRetry(
            `https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${placeId}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`
        );
    }

    async getUserAvatar(userId) {
        return this.fetchWithRetry(
            `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png`
        );
    }
}

// Main PlayerFinder class with improvements
class PlayerFinder {
    constructor() {
        // Core state
        this.currentPlaceId = null;
        this.currentUserId = null;
        this.pageType = null;
        this.api = null;
    
        // Search related
        this.COOLDOWN_TIME = CONFIG.COOLDOWN_TIME;
        this.lastSearchTime = 0;
        this.isSearching = false;
        this.progressBar = null;
        this.progressInterval = null;
    
        // User info cache
        this.userAvatar = null;
        this.userName = null;
    
        // Game info cache
        this.serverSizeMoreThan5 = false;
        this.activePlayersInGame = 0;
    
        // UI State
        this.lastInputValue = '';
    
        // Initialize debug console
        this.debugConsole = new DebugConsole();
        
        // Initialize API client
        this.api = new RobloxAPI(this.debugConsole);
    
        // Initialize message handler
        this.messageHandler = new MessageHandler();
    
        // Theme state
        this.currentTheme = localStorage.getItem('theme') || 'light';
    
        // Bind all handler methods
        this.handleSearch = this.handleGameSearch.bind(this);
        this.handleGameSearch = this.handleGameSearch.bind(this);
        this.handleProfileSearch = this.handleProfileSearch.bind(this);
        this.updateProgress = this.updateProgress.bind(this);
        this.showError = this.showError.bind(this);
        this.showStatus = this.showStatus.bind(this);
        this.searchPlayerInGame = this.searchPlayerInGame.bind(this);
        this.searchSpecificGames = this.searchSpecificGames.bind(this);
        this.searchUserGames = this.searchUserGames.bind(this);
        this.displayJoinOption = this.displayJoinOption.bind(this);
        this.launchGame = this.launchGame.bind(this);
        this.restoreInput = this.restoreInput.bind(this);
        this.updateCooldownState = this.updateCooldownState.bind(this);
        this.applyTheme = this.applyTheme.bind(this);

        // Also add cooldownInterval property
        this.cooldownInterval = null;

        // Setup cleanup
        window.addEventListener('unload', this.cleanup.bind(this));
    }

    cleanup() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
        }
        if (this.cooldownInterval) {
            clearInterval(this.cooldownInterval);
        }
        this.controller?.abort();
    }
    
    async initialize() {
        try {
            this.debugConsole.log('info', 'Initializing PlayerFinder...');
            
            // Reset search state when popup opens
            this.isSearching = false;
            await browser.storage.local.set({
                searchState: null,
                searchResult: null,
                searchError: null
            });
            
            // Initialize theme
            this.initializeTheme();
            
            // Get storage data
            const storage = await browser.storage.local.get(['lastSearchTime', 'lastInput']);
            this.lastSearchTime = storage.lastSearchTime || 0;
            this.lastInputValue = storage.lastInput || '';
            
            // Initialize UI elements
            this.progressBar = document.getElementById('searchProgress');
            
            // Get current tab URL and determine page type
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            const url = tabs[0].url;
            
            const profileMatch = url.match(/roblox\.com\/users\/(\d+)\/profile/);
            const gameMatch = url.match(/roblox\.com\/games\/(\d+)/);
    
            if (profileMatch) {
                this.pageType = 'profile';
                this.currentUserId = profileMatch[1];
                await this.initializeProfilePage(this.currentUserId);
            } else if (gameMatch) {
                this.pageType = 'game';
                this.currentPlaceId = gameMatch[1];
                await this.initializeGamePage(this.currentPlaceId);
            } else {
                throw new Error('Invalid page URL');
            }
    
            // Setup event listeners and restore state
            this.setupEventListeners();
            this.restoreInput();
            this.updateCooldownState();
            
        } catch (error) {
            this.debugConsole.log('error', 'Initialization failed:', error);
            this.showError('Initialization failed', error.message);
        }
    }    
    
    async initializeProfilePage(userId) {
        try {
            // Get user details
            const userData = await this.api.getUserDetails(userId);
            const avatarData = await this.api.getUserAvatar(userId);
    
            // Store user info
            this.userAvatar = avatarData.data[0]?.imageUrl || CONFIG.DEFAULT_AVATAR;
            this.userName = userData.displayName || userData.name;
    
            // Update UI
            const userAvatarElement = document.getElementById('userAvatar');
            userAvatarElement.src = this.userAvatar;
            userAvatarElement.onerror = () => {
                userAvatarElement.src = CONFIG.DEFAULT_AVATAR;
            };
            
            document.getElementById('userName').textContent = this.userName;
            document.getElementById('userCard').style.display = 'block';
    
            // Update status
            const presence = await this.getUserPresence(userId);
            this.updateUserStatus(presence);
    
        } catch (error) {
            this.debugConsole.log('error', 'Profile initialization error:', error);
            this.showError('Failed to load profile', error.message);
        }
    }

    async initializeGamePage(placeId) {
        try {
            // Get game details
            const gameData = await this.api.getGameDetails(placeId);
            const game = gameData.data[0];
            
            if (!game) {
                throw new Error('Failed to get game details');
            }

            this.serverSizeMoreThan5 = game.maxPlayers > 5;
            this.activePlayersInGame = game.playing;

            // Get thumbnail
            const thumbnailData = await this.api.getGameThumbnail(placeId);
            const thumbnailUrl = thumbnailData.data[0]?.imageUrl || CONFIG.DEFAULT_THUMBNAIL;

            // Update UI
            const gameThumbnail = document.getElementById('gameThumbnail');
            gameThumbnail.src = thumbnailUrl;
            gameThumbnail.onerror = () => {
                gameThumbnail.src = CONFIG.DEFAULT_THUMBNAIL;
            };

            document.getElementById('gameTitle').textContent = game.name;
            document.getElementById('gameMeta').textContent = `${this.activePlayersInGame} active players`;
            document.getElementById('gameCard').style.display = 'block';

        } catch (error) {
            this.debugConsole.log('error', 'Game initialization error:', error);
            this.showError('Failed to load game info', error.message);
        }
    }

    initializeTheme() {
        const root = document.documentElement;
        root.setAttribute('data-theme', this.currentTheme);
        document.body.className = `${this.currentTheme}-mode`;

        const themeToggle = document.getElementById('themeToggle');
        themeToggle.addEventListener('click', () => {
            this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
            root.setAttribute('data-theme', this.currentTheme);
            document.body.className = `${this.currentTheme}-mode`;
            localStorage.setItem('theme', this.currentTheme);
        });
    }

    applyTheme(theme) {
        try {
            document.documentElement.setAttribute('data-theme', theme);
            document.body.className = `${theme}-mode`;
            localStorage.setItem('theme', theme);
        } catch (error) {
            this.debugConsole.log('error', 'Failed to apply theme:', error);
        }
    }

    updateUserStatus(presence) {
        const statusDiv = document.getElementById('userStatus');
        statusDiv.innerHTML = '';

        const indicator = createSafeElement('span', { 
            className: 'status-indicator' 
        });

        let statusClass = '';
        let statusText = '';

        if (!presence || presence.userPresenceType === 0) {
            statusClass = 'status-offline';
            statusText = 'Offline';
        } else if (presence.userPresenceType === 1) {
            statusClass = 'status-online';
            statusText = 'Online';
        } else if (presence.userPresenceType === 2) {
            statusClass = 'status-ingame';
            statusText = `In Game: ${sanitizeHTML(presence.lastLocation || 'Unknown')}`;
        } else if (presence.userPresenceType === 3) {
            statusClass = 'status-studio';
            statusText = 'In Studio';
        }

        indicator.classList.add(statusClass);
        statusDiv.appendChild(indicator);
        statusDiv.appendChild(document.createTextNode(statusText));
    }

    setupEventListeners() {
        const searchButton = document.getElementById('searchButton');
        const input = document.getElementById('searchInput');
    
        // Debug to check if elements are found
        this.debugConsole.log('info', 'Setting up event listeners');
        this.debugConsole.log('info', 'Search button found:', !!searchButton);
        this.debugConsole.log('info', 'Input found:', !!input);
    
        if (this.pageType === 'profile') {
            // For profile pages
            input.placeholder = 'Search specific games (optional)';
            searchButton.textContent = 'Find User';
            
            searchButton.addEventListener('click', () => {
                this.debugConsole.log('info', 'Profile search button clicked');
                if (!this.isSearching) {
                    const searchText = input.value.trim();
                    if (searchText) {
                        const gameNames = searchText.split(',').map(s => s.trim());
                        this.searchSpecificGames(gameNames);
                    } else {
                        this.searchUserGames();
                    }
                }
            });
    
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !searchButton.disabled && !this.isSearching) {
                    const searchText = input.value.trim();
                    if (searchText) {
                        const gameNames = searchText.split(',').map(s => s.trim());
                        this.searchSpecificGames(gameNames);
                    } else {
                        this.searchUserGames();
                    }
                }
            });
        } else {
            // Game page setup
            input.placeholder = 'Enter username to find in this game';
            searchButton.textContent = 'Search Game';
            
            searchButton.addEventListener('click', () => {
                this.debugConsole.log('info', 'Game search button clicked');
                if (!this.isSearching) {
                    this.handleGameSearch();
                }
            });
    
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !searchButton.disabled && !this.isSearching) {
                    this.handleGameSearch();
                }
            });
        }
    
        // Input validation and state management
        input.addEventListener('input', () => {
            if (this.pageType === 'game') {
                input.value = input.value.replace(/[^a-zA-Z0-9_]/g, '');
            }
            
            this.lastInputValue = input.value;
            browser.storage.local.set({ lastInput: this.lastInputValue });
    
            // Reset UI elements
            this.updateProgress(0);
            document.getElementById('result').innerHTML = '';
    
            // Validate input
            searchButton.disabled = this.pageType === 'game' && 
                (input.value.length < 3 || input.value.length > 20);
        });
    }

    async handleProfileSearch() {
        if (this.isSearching) return;
        
        const input = document.getElementById('searchInput');
        const searchText = input.value.trim();

        if (searchText) {
            const gameNames = searchText.split(',').map(s => s.trim());
            await this.searchSpecificGames(gameNames);
        } else {
            await this.searchUserGames();
        }
    }

    async handleGameSearch() {
        if (this.isSearching) {
            this.debugConsole.log('warn', 'Search already in progress');
            return;
        }
    
        const input = document.getElementById('searchInput').value.trim();
        if (!input) {
            this.showError('Please enter a username or ID');
            return;
        }
    
        // Check cooldown before proceeding
        const currentTime = Date.now() / 1000;
        const timeElapsed = currentTime - this.lastSearchTime;
        if (timeElapsed < this.COOLDOWN_TIME) {
            const remainingTime = Math.ceil(this.COOLDOWN_TIME - timeElapsed);
            this.showError('Please wait', `You can search again in ${remainingTime} seconds`);
            return;
        }
    
        // Start the cooldown before the search
        const searchButton = document.getElementById('searchButton');
        searchButton.disabled = true;
        this.lastSearchTime = Date.now() / 1000;
        await browser.storage.local.set({ lastSearchTime: this.lastSearchTime });
    
        try {
            this.isSearching = true;
            searchButton.textContent = 'Searching...';
            await this.searchPlayerInGame(input);
        } catch (error) {
            this.debugConsole.log('error', 'Search failed:', error);
            this.showError('Search failed', error.message);
        } finally {
            this.isSearching = false;
            this.updateCooldownState();
        }
    }

    async searchSpecificGames(gameNames) {
        this.resetProgress();
        this.showStatus('Searching specified games...');
        this.updateProgress(10);

        try {
            for (const gameName of gameNames) {
                const games = await this.searchGames(gameName);
                for (const game of games) {
                    this.currentPlaceId = game.placeId;
                    const result = await this.searchServers(this.userAvatar, this.userName);
                    if (result === true) return;
                    await this.sleep(1000);
                }
            }

            this.showStatus('Not found in specified games, checking recent activity...');
            await this.searchUserGames();

        } catch (error) {
            this.updateProgress(100);
            this.showError('Search failed', error.message);
        }
    }

    async searchUserGames() {
        this.resetProgress();
        this.showStatus('Searching user activity...');
        this.updateProgress(10);

        try {
            const [badgeGames, favoriteGames] = await Promise.all([
                this.getRecentGamesFromBadges(this.currentUserId),
                this.getFavoriteGames(this.currentUserId)
            ]);

            this.updateProgress(50);

            const uniqueGames = [...new Map([...badgeGames, ...favoriteGames]
                .map(game => [game.placeId, game])).values()];

            let currentProgress = 50;
            const progressIncrement = 40 / uniqueGames.length;

            for (const game of uniqueGames) {
                try {
                    this.currentPlaceId = game.placeId;
                    const result = await this.searchServers(this.userAvatar, this.userName);
                    if (result === true) return;
                    
                    currentProgress += progressIncrement;
                    this.updateProgress(Math.min(90, currentProgress));
                    await this.sleep(1000);
                } catch (error) {
                    this.debugConsole.log('error', `Error searching game ${game.name}:`, error);
                    continue;
                }
            }

            this.updateProgress(100);
            this.showError('User not found', 'Not found in any recent or favorite games');

        } catch (error) {
            this.updateProgress(100);
            this.showError('Search failed', error.message);
        }
    }

    async searchPlayerInGame(input) {
        this.debugConsole.messageHandler.reset();
        this.debugConsole.log('info', 'Starting player search in game:', input);
        
        // Force reset search state
        this.isSearching = false;
        await browser.storage.local.set({
            searchState: null,
            searchResult: null,
            searchError: null
        });
        
        try {
            let username;
            let targetId;
            let avatarImageUrl;

            if (!/^\d+$/.test(input)) {
                username = input;
                const userData = await this.api.fetchWithRetry(
                    "https://users.roblox.com/v1/usernames/users",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            "usernames": [input],
                            "excludeBannedUsers": true
                        })
                    }
                );

                targetId = userData.data?.[0]?.id;
            } else {
                targetId = input;
            }

            if (!targetId) {
                this.updateProgress(100);
                this.showError("User doesn't exist!");
                return;
            }

            this.updateProgress(20);

            if (!username) {
                const userData = await this.api.getUserDetails(targetId);
                username = userData.name;
            }

            this.updateProgress(40);

            const avatarData = await this.api.getUserAvatar(targetId);
            if (!avatarData.data?.[0]?.imageUrl) {
                this.updateProgress(100);
                this.showError("Failed to get user avatar");
                return;
            }
            avatarImageUrl = avatarData.data[0].imageUrl;

            this.updateProgress(60);

            const presenceResponse = await this.api.fetchWithRetry(
                "https://presence.roblox.com/v1/presence/users",
                {
                    method: "POST",
                    body: JSON.stringify({ userIds: [targetId] })
                }
            );

            const presence = presenceResponse.userPresences?.[0];
            if (!presence) {
                this.updateProgress(100);
                this.showError("User is offline");
                return;
            }

            const statusId = presence.userPresenceType;
            const statusPlaceId = presence.placeId;

            this.updateProgress(80);

            if (statusId < 2 || statusId === 3) {
                this.updateProgress(100);
                this.showError(statusId === 3 ? "Player is in Roblox Studio" : "Player is not in game");
                return;
            }

            if (statusPlaceId !== null) {
                if (statusPlaceId !== parseInt(this.currentPlaceId)) {
                    this.updateProgress(100);
                    this.showPlayerInOtherGame(presence, avatarImageUrl, username);
                    return;
                }
                if (presence.gameId) {
                    this.updateProgress(100);
                    this.displayJoinOption(presence.gameId, avatarImageUrl, username);
                    return;
                }
            }

            this.isSearching = true;
            
            // Add debug logs for message sending
            this.debugConsole.log('info', 'Preparing to send search message to background script');
            const message = {
                type: 'startSearch',
                placeId: this.currentPlaceId,
                userId: targetId,
                avatarUrl: avatarImageUrl,
                username: username,
                serverSizeMoreThan5: this.serverSizeMoreThan5
            };
            this.debugConsole.log('info', 'Search message:', message);
            
            try {
                await browser.runtime.sendMessage(message);
                this.debugConsole.log('info', 'Search message sent successfully');
            } catch (error) {
                this.debugConsole.log('error', 'Failed to send search message:', error);
                throw error;
            }
            
            this.showStatus('Starting server search...');
            this.checkSearchProgress();

        } catch (error) {
            if (this.progressInterval) clearInterval(this.progressInterval);
            this.debugConsole.log('error', 'Search failed:', error);
            this.updateProgress(100);
            this.showError('Search failed', error.message);
            this.isSearching = false;
            await browser.storage.local.set({ 
                searchState: null,
                searchError: error.message 
            });
        }
    }

    async checkSearchProgress() {
        let lastProgressUpdate = Date.now();
        let lastServersChecked = 0;
        const PROGRESS_TIMEOUT = 60000; // 60 seconds timeout
        const PROGRESS_CHECK_INTERVAL = 1000; // Check every second
        
        const checkInterval = setInterval(async () => {
            try {
                // First check if popup is still connected and search is valid
                const { searchState } = await browser.storage.local.get('searchState');
                if (!searchState || !searchState.isSearching) {
                    this.debugConsole.log('info', 'Search state no longer valid, cleaning up');
                    await this.cleanupSearch(checkInterval);
                    return;
                }
    
                // Get latest search status
                const state = await browser.storage.local.get([
                    'searchState',
                    'searchResult',
                    'searchError',
                    'searchProgress'
                ]);
    
                // Handle search error
                if (state.searchError) {
                    this.debugConsole.log('error', 'Search error detected:', state.searchError);
                    await this.cleanupSearch(checkInterval);
                    await this.showError('Search failed', state.searchError);
                    return;
                }
    
                // Handle completed search
                if (state.searchResult) {
                    this.debugConsole.log('info', 'Search completed with result:', state.searchResult);
                    await this.cleanupSearch(checkInterval);
                    
                    if (state.searchResult.found) {
                        await this.displayJoinOption(
                            state.searchResult.gameId,
                            state.searchResult.avatarUrl,
                            state.searchResult.username
                        );
                    } else {
                        const message = state.searchResult.cancelled ? 
                            'Search was cancelled' : 
                            'Not found in any server';
                        await this.showError('Player not found', message);
                    }
                    return;
                }
    
                // Update progress if we have new data
                if (state.searchProgress) {
                    if (state.searchProgress.timestamp > lastProgressUpdate) {
                        lastProgressUpdate = state.searchProgress.timestamp;
                        
                        // Only update UI if servers checked has changed
                        if (state.searchProgress.serversChecked !== lastServersChecked) {
                            lastServersChecked = state.searchProgress.serversChecked;
                            const progressPercent = Math.min(90, 
                                50 + (state.searchProgress.serversChecked / 100) * 40);
                            await this.updateProgress(progressPercent);
                            
                            // Update status message
                            await this.showStatus(
                                'Searching servers...', 
                                `Checked ${state.searchProgress.serversChecked} servers`
                            );
                        }
                    }
                }
    
                // Check for timeout
                const timeSinceUpdate = Date.now() - lastProgressUpdate;
                if (timeSinceUpdate > PROGRESS_TIMEOUT) {
                    this.debugConsole.log('warn', 'Search timed out - no progress updates received');
                    await this.cleanupSearch(checkInterval);
                    await this.showError(
                        'Search timed out', 
                        'No progress updates received for 60 seconds'
                    );
                    return;
                }
    
            } catch (error) {
                this.debugConsole.log('error', 'Progress check error:', error);
                await this.cleanupSearch(checkInterval);
                await this.showError('Search error', error.message);
            }
        }, PROGRESS_CHECK_INTERVAL);
    
        // Store interval reference
        this.progressInterval = checkInterval;
    
        // Setup cleanup on window unload
        window.addEventListener('unload', () => {
            if (checkInterval) {
                clearInterval(checkInterval);
            }
        });
    }
    
    // Helper method for search cleanup
    async cleanupSearch(interval) {
        if (interval) {
            clearInterval(interval);
        }
        if (this.progressInterval === interval) {
            this.progressInterval = null;
        }
        
        this.isSearching = false;
        
        await browser.storage.local.set({
            searchState: null,
            searchResult: null,
            searchError: null,
            searchProgress: null
        });
        
        // Reset UI state
        await this.updateProgress(100);
        this.updateCooldownState();
    }

    async startCooldown() {
        if (this.isSearching) return;
        
        const searchButton = document.getElementById('searchButton');
        searchButton.disabled = true;
        this.lastSearchTime = Date.now() / 1000;
        await browser.storage.local.set({ lastSearchTime: this.lastSearchTime });
        searchButton.textContent = 'Searching...';

        return new Promise((resolve) => {
            const cooldownInterval = setInterval(() => {
                const remaining = Math.ceil(this.COOLDOWN_TIME - ((Date.now() / 1000) - this.lastSearchTime));
                if (remaining <= 0) {
                    searchButton.disabled = false;
                    searchButton.textContent = 'Search';
                    clearInterval(cooldownInterval);
                    resolve();
                } else {
                    searchButton.textContent = `Wait ${remaining}s`;
                }
            }, 1000);
        });
    }

    async updateCooldownState() {
        try {
            const searchButton = document.getElementById('searchButton');
            const currentTime = Date.now() / 1000;
            const timeElapsed = currentTime - this.lastSearchTime;
            
            if (timeElapsed < this.COOLDOWN_TIME) {
                const remainingTime = Math.ceil(this.COOLDOWN_TIME - timeElapsed);
                searchButton.disabled = true;
                searchButton.textContent = `Wait ${remainingTime}s`;
                
                if (this.cooldownInterval) {
                    clearInterval(this.cooldownInterval);
                }
                
                this.cooldownInterval = setInterval(() => {
                    const currentRemaining = Math.ceil(this.COOLDOWN_TIME - ((Date.now() / 1000) - this.lastSearchTime));
                    if (currentRemaining <= 0) {
                        searchButton.disabled = false;
                        searchButton.textContent = 'Search';
                        clearInterval(this.cooldownInterval);
                        this.cooldownInterval = null;
                    } else {
                        searchButton.textContent = `Wait ${currentRemaining}s`;
                    }
                }, 1000);
            } else {
                searchButton.disabled = false;
                searchButton.textContent = 'Search';
                if (this.cooldownInterval) {
                    clearInterval(this.cooldownInterval);
                    this.cooldownInterval = null;
                }
            }
        } catch (error) {
            this.debugConsole.log('error', 'Failed to update cooldown state:', error);
        }
    }

    async displayJoinOption(gameId, avatarImageUrl, username, isRestoring = false) {
        if (!isRestoring) {
            await this.storeVisualState('success', {
                gameId,
                avatarUrl: avatarImageUrl,
                username
            });
        }

        const resultDiv = document.getElementById('result');
        resultDiv.innerHTML = '';

        const container = createSafeElement('div', { className: 'result success' });

        if (avatarImageUrl) {
            const avatarImg = createSafeElement('img', {
                src: avatarImageUrl,
                alt: 'Player avatar',
                className: 'avatar-image'
            });
            avatarImg.onerror = () => {
                avatarImg.src = CONFIG.DEFAULT_AVATAR;
            };
            container.appendChild(avatarImg);
        }
        
        container.appendChild(createSafeElement('span', {}, 'Player found!'));

        const verboseDiv = createSafeElement('div', { className: 'verbose' });
        verboseDiv.appendChild(
            createSafeElement('span', {}, 
                `Found in ${gameId ? 'public' : 'private'} server`)
        );
        container.appendChild(verboseDiv);

        if (gameId) {
            const buttonContainer = createSafeElement('div', { className: 'join-button' });
            const joinButton = createSafeElement('button', {
                className: 'join-link',
                id: 'joinButton'
            }, 'Join Game');
            
            joinButton.addEventListener('click', () => this.launchGame(this.currentPlaceId, gameId));
            buttonContainer.appendChild(joinButton);
            container.appendChild(buttonContainer);
        }

        resultDiv.appendChild(container);
    }

    showPlayerInOtherGame(presence, avatarImageUrl, username) {
        const resultDiv = document.getElementById('result');
        resultDiv.innerHTML = '';

        const container = createSafeElement('div', { className: 'result warning' });
        
        if (avatarImageUrl) {
            const avatarImg = createSafeElement('img', {
                src: avatarImageUrl,
                alt: 'Player avatar',
                className: 'avatar-image'
            });
            avatarImg.onerror = () => {
                avatarImg.src = CONFIG.DEFAULT_AVATAR;
            };
            container.appendChild(avatarImg);
        }

        container.appendChild(createSafeElement('span', {}, 
            `Player is in a different game: ${sanitizeHTML(presence.lastLocation)}`));

        const verboseDiv = createSafeElement('div', { className: 'verbose' });
        verboseDiv.appendChild(createSafeElement('span', {}, 
            `Game ID: ${presence.placeId}\nServer ID: ${presence.gameId || 'Private Server'}`));
        container.appendChild(verboseDiv);

        resultDiv.appendChild(container);
    }

    async launchGame(placeId, gameId) {
        try {
            const button = document.getElementById('joinButton');
            if (button) {
                button.textContent = 'Launching...';
                button.disabled = true;
            }

            const placeUrl = `https://www.roblox.com/games/${placeId}${gameId ? `?gameInstanceId=${gameId}` : ''}`;
            window.open(placeUrl, '_blank');

            const protocolUrl = `roblox://placeId=${placeId}${gameId ? `&gameInstanceId=${gameId}` : ''}`;
            window.location.href = protocolUrl;

        } catch (error) {
            this.debugConsole.log('error', 'Launch error:', error);
            this.showError('Failed to launch game', error.message);
            if (button) {
                button.textContent = 'Join Game';
                button.disabled = false;
            }
        }
    }

    showError(message, details = '') {
        const resultDiv = document.getElementById('result');
        resultDiv.innerHTML = '';

        const container = createSafeElement('div', { className: 'result error' });
        container.appendChild(createSafeElement('span', {}, sanitizeHTML(message)));

        if (details) {
            const verboseDiv = createSafeElement('div', { className: 'verbose' });
            verboseDiv.appendChild(createSafeElement('span', {}, sanitizeHTML(details)));
            container.appendChild(verboseDiv);
        }

        resultDiv.appendChild(container);
        this.storeVisualState('error', { message, details });
    }

    async showStatus(message, details = '') {
        const resultDiv = document.getElementById('result');
        resultDiv.innerHTML = '';
    
        const container = createSafeElement('div', { className: 'result warning' });
        container.appendChild(createSafeElement('span', {}, sanitizeHTML(message)));
    
        if (details) {
            const verboseDiv = createSafeElement('div', { className: 'verbose' });
            verboseDiv.appendChild(createSafeElement('span', {}, sanitizeHTML(details)));
            container.appendChild(verboseDiv);
        }
    
        resultDiv.appendChild(container);
        await this.storeVisualState('status', { message, details });
    }

    async storeVisualState(type, data = {}) {
        const visualState = {
            timestamp: Date.now(),
            type: type,
            theme: this.currentTheme,
            progressBarWidth: this.progressBar ? this.progressBar.style.width : '0%',
            searchButtonState: {
                text: document.getElementById('searchButton').textContent,
                disabled: document.getElementById('searchButton').disabled
            },
            resultState: {
                type: type,
                html: document.getElementById('result').innerHTML,
                avatarUrl: data.avatarUrl,
                username: data.username,
                gameId: data.gameId,
                message: data.message,
                details: data.details,
                placeId: this.currentPlaceId
            },
            searchState: {
                isSearching: this.isSearching,
                lastSearchTime: this.lastSearchTime
            }
        };
        await browser.storage.local.set({ visualState });
    }
    
    async restoreVisualState() {
        try {
            this.debugConsole.log('info', 'Restoring visual state...');
            const storage = await browser.storage.local.get(['visualState', 'searchState', 'searchProgress', 'searchResult']);
            
            // If visualState exists, restore it
            if (storage.visualState) {
                // Verify that the stored state matches the current context
                if (storage.visualState.resultState?.placeId !== this.currentPlaceId) {
                    this.debugConsole.log('info', 'Stored visual state placeId does not match current, skipping restoration');
                    await browser.storage.local.remove('visualState');
                } else {
                    // Restore theme
                    if (storage.visualState.theme) {
                        this.currentTheme = storage.visualState.theme;
                        this.applyTheme(this.currentTheme);
                    }
    
                    // Restore progress bar width
                    if (this.progressBar && storage.visualState.progressBarWidth) {
                        this.progressBar.style.width = storage.visualState.progressBarWidth;
                    }
    
                    // Restore search button state
                    const searchButton = document.getElementById('searchButton');
                    if (searchButton && storage.visualState.searchButtonState) {
                        searchButton.textContent = storage.visualState.searchButtonState.text;
                        searchButton.disabled = storage.visualState.searchButtonState.disabled;
                    }
    
                    // Restore result content based on type
                    const resultState = storage.visualState.resultState;
                    if (resultState) {
                        switch (resultState.type) {
                            case 'success':
                                await this.displayJoinOption(
                                    resultState.gameId,
                                    resultState.avatarUrl,
                                    resultState.username,
                                    true
                                );
                                break;
                            case 'error':
                                await this.showError(resultState.message, resultState.details);
                                break;
                            case 'status':
                                await this.showStatus(resultState.message, resultState.details);
                                break;
                        }
                    }
    
                    // Restore search state
                    if (storage.visualState.searchState) {
                        this.isSearching = storage.visualState.searchState.isSearching;
                        this.lastSearchTime = storage.visualState.searchState.lastSearchTime;
                    }
                }
            }
        
            // If a search was ongoing, resume the progress check
            if (storage.searchState?.isSearching) {
                this.isSearching = true;
                this.checkSearchProgress();
            }
        
        } catch (error) {
            this.debugConsole.log('error', 'Failed to restore visual state:', error);
            this.isSearching = false;
            await browser.storage.local.set({ 
                searchState: null,
                searchError: error.message 
            });
        }
    }        

    async restoreInput() {
        try {
            const input = document.getElementById('searchInput');
            if (input) {
                input.value = this.lastInputValue;
                // Create and dispatch an input event to trigger any listeners
                const event = new Event('input', {
                    bubbles: true,
                    cancelable: true,
                });
                input.dispatchEvent(event);
            }
        } catch (error) {
            this.debugConsole.log('error', 'Failed to restore input:', error);
        }
    }

    async updateProgress(percentage) {
        if (this.progressBar) {
            this.progressBar.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
            await this.storeVisualState('progress', { progressPercentage: percentage });
        }
    }    

    resetProgress() {
        this.updateProgress(0);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async searchGames(query) {
        const response = await this.api.fetchWithRetry(
            `https://games.roblox.com/v1/games/list?keyword=${encodeURIComponent(query)}&limit=10`
        );
        return response.games || [];
    }

    async getRecentGamesFromBadges(userId) {
        try {
            const response = await this.api.fetchWithRetry(
                `https://badges.roblox.com/v1/users/${userId}/badges?limit=25&sortOrder=Desc`
            );
            
            const games = response.data
                .filter(badge => badge.awardedDate && badge.placeId)
                .map(badge => ({
                    placeId: badge.placeId,
                    name: badge.awardingGame?.name || 'Unknown Game',
                    lastPlayed: new Date(badge.awardedDate)
                }));
    
            return this.deduplicate(games);
        } catch (error) {
            this.debugConsole.log('error', 'Failed to get badge games:', error);
            return [];
        }
    }
    
    async getFavoriteGames(userId) {
        try {
            const response = await this.api.fetchWithRetry(
                `https://www.roblox.com/users/favorites/list-json?assetTypeId=9&itemsPerPage=50&pageNumber=1&userId=${userId}`
            );
            
            return response.Data.Items.map(game => ({
                placeId: game.Item.AssetId,
                name: game.Item.Name
            }));
        } catch (error) {
            this.debugConsole.log('error', 'Failed to get favorite games:', error);
            return [];
        }
    }
    
    deduplicate(games) {
        return [...new Map(games.map(game => [game.placeId, game])).values()];
    }
}

// Initialize extension
let initialized = false;  // Add this flag

document.addEventListener('DOMContentLoaded', async () => {
    const { isInitialized } = await browser.storage.local.get('isInitialized');
    if (isInitialized) {
        await browser.storage.local.set({ isInitialized: false });
        return;
    }
    await browser.storage.local.set({ isInitialized: true });
    
    // Initialize debug console first
    window.debugConsole = new DebugConsole();    
    
    // Initialize PlayerFinder
    const playerFinder = new PlayerFinder();
    playerFinder.initialize().catch(error => {
        window.debugConsole.log('error', 'Failed to initialize PlayerFinder:', error);
    });
});