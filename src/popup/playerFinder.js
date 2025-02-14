import { ProgressManager } from './components/progressManager.js';
import { RobloxAPI, API_CONFIG } from './components/robloxAPI.js';
import { ThemeManager } from './utils/theme.js';
import { createSafeElement, updateUserStatus, createResultCard } from './utils/dom.js';

/**
 * Main controller for the popup functionality
 */
export class PlayerFinder {
    constructor() {
        this.currentPlaceId = null;
        this.currentUserId = null;
        this.pageType = null;
        this.api = new RobloxAPI();
        this.COOLDOWN_TIME = API_CONFIG.COOLDOWN_TIME.ADVANCED_SEARCH;
        this.lastSearchTime = 0;
        this.isSearching = false;
        this.progressBar = null;
        this.progressInterval = null;
        this.progressManager = null;
        this.userAvatar = null;
        this.userName = null;
        this.serverSizeMoreThan5 = false;
        this.activePlayersInGame = 0;
        this.lastInputValue = '';
        this.cooldownInterval = null;
        this.storageListener = null;

        window.addEventListener('unload', this.cleanup.bind(this));
        this.setupStorageListener();
    }

    /**
     * Initialize the PlayerFinder
     */
    async initialize() {
        try {
            console.log('Initializing PlayerFinder...');
                
            // Get all storage data first
            const storage = await browser.storage.local.get([
                'lastSearchTime',
                'lastInput',
                'searchState',
                'searchResult',
                'searchError',
                'searchProgress'
            ]);
            
            // Initialize stored values
            this.lastSearchTime = storage.lastSearchTime || 0;
            this.lastInputValue = storage.lastInput || '';
            
            // Initialize theme
            this.themeManager = new ThemeManager();
            
            // Initialize UI elements
            this.progressBar = document.getElementById('searchProgress');
            this.progressManager = new ProgressManager(this.progressBar);
            
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
    
            // Setup event listeners
            this.setupEventListeners();
            
            // Restore state including search progress if any
            // await this.restoreState(storage);
            
            // Add visibility change handler
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    this.handleStorageUpdate();
                }
            });       

            // Mark as initialized
            document.body.classList.add('initialized');
            
        } catch (error) {
            console.error('Initialization failed:', error);
            this.showError('Initialization failed', error.message);
            
            // Clean up on initialization failure
            this.isSearching = false;
            if (this.progressManager) {
                this.progressManager.reset();
            }
            await browser.storage.local.set({
                searchState: null,
                searchResult: null,
                searchError: null,
                searchProgress: null
            });
        }
    }

    /**
     * Initialize profile page
     */
    async initializeProfilePage(userId) {
        try {
            const userData = await this.api.getUserDetails(userId);
            const avatarData = await this.api.getUserAvatar(userId);
    
            this.userAvatar = avatarData.data[0]?.imageUrl || API_CONFIG.DEFAULTS.AVATAR;
            this.userName = userData.displayName || userData.name;
    
            const userCard = document.getElementById('userCard');
            const userAvatarElement = document.getElementById('userAvatar');
            
            if (userAvatarElement) {
                userAvatarElement.src = this.userAvatar;
                userAvatarElement.onerror = () => {
                    userAvatarElement.src = API_CONFIG.DEFAULTS.AVATAR;
                };
            }
            
            const userNameElement = document.getElementById('userName');
            if (userNameElement) {
                userNameElement.textContent = this.userName;
            }
            
            if (userCard) {
                userCard.style.display = 'block';
                void userCard.offsetHeight; // Force reflow
            }
    
            const presence = await this.api.getUserPresence(userId);
            this.updateUserStatus(presence);
    
        } catch (error) {
            console.error('Profile initialization error:', error);
            this.showError('Failed to load profile', error.message);
        }
    }

    /**
     * Initialize game page
     */
    async initializeGamePage(placeId) {
        try {
            const gameData = await this.api.getGameDetails(placeId);
            const game = gameData.data[0];
            
            if (!game) {
                throw new Error('Failed to get game details');
            }
    
            this.serverSizeMoreThan5 = game.maxPlayers > 5;
            this.activePlayersInGame = game.playing;
    
            const thumbnailData = await this.api.getGameThumbnail(placeId);
            const thumbnailUrl = thumbnailData.data[0]?.imageUrl || API_CONFIG.DEFAULTS.THUMBNAIL;
    
            const gameCard = document.getElementById('gameCard');
            const gameThumbnail = document.getElementById('gameThumbnail');
            
            if (gameThumbnail) {
                gameThumbnail.src = thumbnailUrl;
                gameThumbnail.onerror = () => {
                    gameThumbnail.src = API_CONFIG.DEFAULTS.THUMBNAIL;
                };
            }
    
            const gameTitleElement = document.getElementById('gameTitle');
            if (gameTitleElement) {
                gameTitleElement.textContent = game.name;
            }
    
            const gameMetaElement = document.getElementById('gameMeta');
            if (gameMetaElement) {
                gameMetaElement.textContent = `${this.activePlayersInGame} active players`;
            }
    
            if (gameCard) {
                gameCard.style.display = 'block';
                void gameCard.offsetHeight; // Force reflow
            }
    
        } catch (error) {
            console.error('Game initialization error:', error);
            this.showError('Failed to load game info', error.message);
        }
    }

    /**
     * Setup event listeners for search functionality
     */
    setupEventListeners() {
        const searchButton = document.getElementById('searchButton');
        const input = document.getElementById('searchInput');
    
        if (this.pageType === 'profile') {
            input.placeholder = 'Search specific games (optional)';
            searchButton.textContent = 'Find User';
            
            searchButton.addEventListener('click', async () => {
                if (!this.isSearching && !(await this.isCoolingDown())) {
                    const searchText = input.value.trim();
                    if (searchText) {
                        const gameNames = searchText.split(',').map(s => s.trim());
                        this.searchSpecificGames(gameNames);
                    } else {
                        this.searchUserGames();
                    }
                }
            });
    
            input.addEventListener('keypress', async (e) => {
                if (e.key === 'Enter' && !searchButton.disabled && !this.isSearching && 
                    !(await this.isCoolingDown())) {
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
            input.placeholder = 'Enter username to find in this game';
            searchButton.textContent = 'Search Game';
            
            searchButton.addEventListener('click', async () => {
                if (!this.isSearching && !(await this.isCoolingDown())) {
                    this.handleGameSearch();
                }
            });
    
            input.addEventListener('keypress', async (e) => {
                if (e.key === 'Enter' && !searchButton.disabled && !this.isSearching && 
                    !(await this.isCoolingDown())) {
                    this.handleGameSearch();
                }
            });
        }
    
        input.addEventListener('input', async () => {
            if (this.pageType === 'game') {
                input.value = input.value.replace(/[^a-zA-Z0-9_]/g, '');
            }
            
            this.lastInputValue = input.value;
            browser.storage.local.set({ lastInput: this.lastInputValue });
    
            if (!this.isSearching) {
                this.progressManager.reset();
                document.getElementById('result').innerHTML = '';
            }
    
            if (await this.isCoolingDown()) {
                const storage = await browser.storage.local.get(['searchType']);
                const cooldownTime = storage.searchType === 'advanced' ? 
                    API_CONFIG.COOLDOWN_TIME.ADVANCED_SEARCH : 
                    API_CONFIG.COOLDOWN_TIME.PRESENCE_ONLY;
                const remainingTime = Math.ceil(cooldownTime - ((Date.now() / 1000) - this.lastSearchTime));
                searchButton.textContent = `Wait ${remainingTime}s`;
                searchButton.disabled = true;
                return;
            }
    
            if (!this.isSearching) {
                if (this.pageType === 'game') {
                    searchButton.disabled = input.value.length < 3 || input.value.length > 20;
                    if (!searchButton.disabled) {
                        searchButton.textContent = 'Search';
                    }
                } else {
                    searchButton.disabled = false;
                    searchButton.textContent = 'Find User';
                }
            }
        });
    }

    /**
     * Handle game search functionality
     */
    async handleGameSearch() {
        if (this.isSearching) {
            console.warn('Search already in progress');
            return;
        }
    
        const input = document.getElementById('searchInput').value.trim();
        if (!input) {
            this.showError('Please enter a username or ID');
            return;
        }
    
        this.setSearchState(true);
        
        try {
            const searchButton = document.getElementById('searchButton');
            searchButton.textContent = 'Searching...';
            await this.searchPlayerInGame(input);
        } catch (error) {
            console.error('Search failed:', error);
            this.progressManager.complete();
            await this.showError('Search failed', error.message);
        } finally {
            this.isSearching = false;
            this.setSearchState(false);
            this.progressManager.complete();
            this.updateCooldownState();
        }
    }

    /**
     * Search for a player in the current game
     */
    async searchPlayerInGame(input) {
        try {
            let username;
            let targetId;
            let avatarImageUrl;

            // Get user ID from username or use provided ID
            if (!API_CONFIG.PATTERNS.USERID.test(input)) {
                username = input;
                const userData = await this.api.getUserByNameOrId(input);
                targetId = userData.data?.[0]?.id;
            } else {
                targetId = input;
            }

            if (!targetId) {
                await this.progressManager.complete();
                await this.showError("User doesn't exist!");
                return;
            }

            this.progressManager.setProgress(20);

            // Get username if not already known
            if (!username) {
                const userData = await this.api.getUserDetails(targetId);
                username = userData.name;
            }

            this.progressManager.setProgress(40);

            // Get user avatar
            const avatarData = await this.api.getUserAvatar(targetId);
            if (!avatarData.data?.[0]?.imageUrl) {
                this.progressManager.complete();
                await this.showError("Failed to get user avatar");
                return;
            }
            avatarImageUrl = avatarData.data[0].imageUrl;

            this.progressManager.setProgress(60);

            // Check user presence
            const presenceResponse = await this.api.getUserPresence(targetId);
            const presence = presenceResponse.userPresences?.[0];
            if (!presence) {
                this.progressManager.complete();
                await this.showError("User is offline");
                return;
            }

            const statusId = presence.userPresenceType;
            const statusPlaceId = presence.placeId;

            this.progressManager.setProgress(80);

            if (statusId < 2 || statusId === 3) {
                this.progressManager.complete();
                await this.showError(
                    statusId === 3 ? "Player is in Roblox Studio" : "Player is not playing a game"
                );
                return;
            }

            if (statusPlaceId !== null) {
                if (statusPlaceId !== parseInt(this.currentPlaceId)) {
                    this.progressManager.complete();
                    await this.showPlayerInOtherGame(presence, avatarImageUrl, username);
                    return;
                }
                if (presence.gameId) {
                    this.progressManager.complete();
                    await this.displayJoinOption(presence.gameId, avatarImageUrl, username);
                    return;
                }
            }

            this.isSearching = true;
            await this.showStatus('Starting server search...');
            
            // Start background search
            const message = {
                type: 'startSearch',
                placeId: this.currentPlaceId,
                userId: targetId,
                avatarUrl: avatarImageUrl,
                username: username,
                serverSizeMoreThan5: this.serverSizeMoreThan5
            };

            try {
                const response = await browser.runtime.sendMessage(message);
                
                if (response.error) {
                    throw new Error(response.error);
                }

                if (response.result) {
                    this.progressManager.complete();
                    if (response.result.found) {
                        await this.displayJoinOption(
                            response.result.gameId,
                            response.result.avatarUrl,
                            response.result.username
                        );
                    } else {
                        await this.showError(
                            'Player not found',
                            response.result.cancelled ? 'Search was cancelled' : 'Not found in any server'
                        );
                    }
                }

            } catch (error) {
                console.error('Failed to send search message:', error);
                throw error;
            }

        } catch (error) {
            console.error('Search failed:', error);
            this.progressManager.complete();
            await this.showError('Search failed', error.message);
        } finally {
            this.isSearching = false;
            this.setSearchState(false);
            this.progressManager.complete();
            this.updateCooldownState();
        }
    }

    /**
     * Check search progress and update UI
     */
    async checkSearchProgress() {
        const storageListener = (changes, area) => {
            if (area === 'local') {
                this.handleStorageUpdate();
            }
        };
    
        browser.storage.onChanged.addListener(storageListener);
    
        // Auto-cleanup after 60 seconds
        const timeout = setTimeout(() => {
            this.showError('Search timed out', 'No progress for 60 seconds');
            browser.storage.onChanged.removeListener(storageListener);
        }, 60000);
    
        // Cleanup when search completes
        const completionListener = (changes, area) => {
            if (area === 'local' && (changes.searchResult || changes.searchError)) {
                browser.storage.onChanged.removeListener(storageListener);
                browser.storage.onChanged.removeListener(completionListener);
                clearTimeout(timeout);
            }
        };
    
        browser.storage.onChanged.addListener(completionListener);
    }

    /**
     * Handle storage updates
     */
    async handleStorageUpdate() {
        try {
            const state = await browser.storage.local.get([
                'searchProgress', 
                'searchResult',
                'searchError'
            ]);
    
            if (state.searchProgress) {
                const progress = state.searchProgress;
                const timeSinceUpdate = Date.now() - progress.timestamp;
                
                // Only update if data is fresh (less than 5 seconds old)
                if (timeSinceUpdate < 5000) {
                    this.progressManager.setProgress(progress.progressPercent);
                    
                    let statusMessage = 'Starting server search...';
                    let details = '';
                    
                    if (progress.serversChecked > 0) {
                        statusMessage = 'Searching servers...';
                        details = `Checked ${progress.serversChecked} servers`;
                    }
                    
                    if (progress.currentBatch !== null) {
                        statusMessage = 'Processing player data...';
                        details = `Batch ${progress.currentBatch}/${progress.totalBatches}`;
                    }
                    
                    await this.showStatus(statusMessage, details);
                }
            }
    
            // Handle final results
            if (state.searchResult) {
                this.progressManager.complete();
                if (state.searchResult.found) {
                    await this.displayJoinOption(
                        state.searchResult.gameId,
                        state.searchResult.avatarUrl,
                        state.searchResult.username
                    );
                } else {
                    const message = state.searchResult.cancelled 
                        ? 'Search was cancelled' 
                        : 'Not found in any server';
                    await this.showError('Player not found', message);
                }
                await this.cleanupSearch();
            }
    
            if (state.searchError) {
                this.progressManager.complete();
                await this.showError('Search failed', state.searchError);
                await this.cleanupSearch();
            }
    
        } catch (error) {
            console.error('Error handling storage update:', error);
        }
    }

    /**
     * Display join option for found player
     */
    displayJoinOption(gameId, avatarImageUrl, username, isRestoring = false) {
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
                avatarImg.src = API_CONFIG.DEFAULTS.AVATAR;
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

    /**
     * Show player in other game
     */
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
                avatarImg.src = API_CONFIG.DEFAULTS.AVATAR;
            };
            container.appendChild(avatarImg);
        }

        container.appendChild(createSafeElement('span', {}, 
            `Player is in a different game: ${presence.lastLocation}`));

        const verboseDiv = createSafeElement('div', { className: 'verbose' });
        verboseDiv.appendChild(createSafeElement('span', {}, 
            `Game ID: ${presence.placeId}\nServer ID: ${presence.gameId || 'Private Server'}`));
        container.appendChild(verboseDiv);

        resultDiv.appendChild(container);
    }

    /**
     * Launch the game
     */
    async launchGame(placeId, gameId) {
        let button;
        try {
            button = document.getElementById('joinButton');
            if (button) {
                button.textContent = 'Launching...';
                button.disabled = true;
            }

            const placeUrl = `https://www.roblox.com/games/${placeId}${gameId ? `?gameInstanceId=${gameId}` : ''}`;
            window.open(placeUrl, '_blank');

            const protocolUrl = `roblox://placeId=${placeId}${gameId ? `&gameInstanceId=${gameId}` : ''}`;
            window.location.href = protocolUrl;

        } catch (error) {
            console.error('Launch error:', error);
            this.showError('Failed to launch game', error.message);
            if (button) {
                button.textContent = 'Join Game';
                button.disabled = false;
            }
        }
    }

    /**
     * Show error message
     */
    async showError(message, details = '') {
        this.progressManager.complete();
        const resultDiv = document.getElementById('result');
        resultDiv.innerHTML = '';
        resultDiv.appendChild(createResultCard('error', message, details));
    }

    /**
     * Show status message
     */
    async showStatus(message, details = '') {
        const resultDiv = document.getElementById('result');
        resultDiv.innerHTML = '';
        resultDiv.appendChild(createResultCard('warning', message, details));
    }

    /**
     * Check if search is in cooldown
     */
    async isCoolingDown() {
        const storage = await browser.storage.local.get(['searchCompleted', 'searchType']);
        if (!storage.searchCompleted) return false;
        
        const currentTime = Date.now();
        const cooldownTime = (storage.searchType === 'advanced' ? 
            API_CONFIG.COOLDOWN_TIME.ADVANCED_SEARCH : 
            API_CONFIG.COOLDOWN_TIME.PRESENCE_ONLY) * 1000;
        
        return (currentTime - storage.searchCompleted) < cooldownTime;
    }

    /**
     * Get remaining cooldown time
     */
    async getRemainingCooldown() {
        const storage = await browser.storage.local.get(['searchCompleted', 'searchType']);
        if (!storage.searchCompleted) return 0;
        
        const currentTime = Date.now();
        const cooldownTime = (storage.searchType === 'advanced' ? 
            API_CONFIG.COOLDOWN_TIME.ADVANCED_SEARCH : 
            API_CONFIG.COOLDOWN_TIME.PRESENCE_ONLY) * 1000;
        
        const remaining = Math.ceil((storage.searchCompleted + cooldownTime - currentTime) / 1000);
        return Math.max(0, remaining);
    }

    /**
     * Update search state
     */
    async setSearchState(isSearching) {
        this.isSearching = isSearching;
        await this.updateCooldownState();
    }

    /**
     * Update cooldown state
     */
    async updateCooldownState() {
        try {
            const searchButton = document.getElementById('searchButton');
            const input = document.getElementById('searchInput');
            const storage = await browser.storage.local.get(['searchCompleted', 'searchType']);
            
            const searchCompleted = Number.isInteger(storage.searchCompleted) ? storage.searchCompleted : 0;
            const cooldownTime = (storage.searchType === 'advanced' ? 
                API_CONFIG.COOLDOWN_TIME.ADVANCED_SEARCH : 
                API_CONFIG.COOLDOWN_TIME.PRESENCE_ONLY) * 1000;
    
            const currentTime = Date.now();
            const remaining = Math.ceil((searchCompleted + cooldownTime - currentTime) / 1000);
            const displayRemaining = Math.max(0, remaining);
    
            if (displayRemaining > 0) {
                searchButton.textContent = `Wait ${displayRemaining}s`;
                searchButton.disabled = true;
                input.disabled = true;
                input.style.opacity = '0.6';
                
                if (this.cooldownInterval) clearInterval(this.cooldownInterval);
                this.cooldownInterval = setInterval(() => {
                    const newRemaining = Math.max(0, 
                        Math.ceil((searchCompleted + cooldownTime - Date.now()) / 1000)
                    );
                    if (newRemaining > 0) {
                        searchButton.textContent = `Wait ${newRemaining}s`;
                    } else {
                        this.updateCooldownState();
                    }
                }, 1000);
            } else {
                searchButton.disabled = false;
                input.disabled = false;
                input.style.opacity = '1';
                searchButton.textContent = this.pageType === 'game' ? 'Search' : 'Find User';
                if (this.cooldownInterval) {
                    clearInterval(this.cooldownInterval);
                    this.cooldownInterval = null;
                }
            }
        } catch (error) {
            console.error('Failed to update cooldown state:', error);
        }
    }

    /**
     * Clean up search state
     */
    async cleanupSearch() {
        this.isSearching = false;
        this.setSearchState(false);
        await browser.storage.local.set({
            searchState: null,
            searchResult: null,
            searchError: null,
            searchProgress: null
        });
    }

    /**
     * Setup storage listener
     */
    setupStorageListener() {
        this.storageListener = (changes, area) => {
            if (area === 'local') {
                this.handleStorageUpdate();
            }
        };
        browser.storage.onChanged.addListener(this.storageListener);
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
        if (this.cooldownInterval) {
            clearInterval(this.cooldownInterval);
            this.cooldownInterval = null;
        }
        if (this.progressManager) {
            this.progressManager.reset();
        }
        if (this.storageListener) {
            browser.storage.onChanged.removeListener(this.storageListener);
        }
    }
}