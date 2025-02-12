class PlayerFinder {
    constructor() {
        this.COOLDOWN_TIME = 10;
        this.lastSearchTime = 0;
        this.currentPlaceId = null;
        this.debugConsole = new DebugConsole();
        this.serverSizeMoreThan5 = false;
        this.activePlayersInGame = 0;
        this.progressBar = null;
        this.lastInputValue = '';
        this.isSearching = false;
        this.initializeTheme();
    }

    async initialize() {
        try {
            // Restore state from storage
            const storage = await new Promise(resolve => {
                chrome.storage.local.get(['lastSearchTime', 'lastInput'], resolve);
            });
            this.lastSearchTime = storage.lastSearchTime || 0;
            this.lastInputValue = storage.lastInput || '';

            // Get current tab URL
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const url = tab.url;

            // Extract game ID and validate
            this.currentPlaceId = this.extractGameId(url);
            if (!this.currentPlaceId) {
                this.showError('Invalid page', 'Please open a Roblox game page');
                return;
            }

            // Initialize progress bar
            this.progressBar = document.getElementById('searchProgress');

            // Get universe ID
            const universeResponse = await fetch(`https://apis.roblox.com/universes/v1/places/${this.currentPlaceId}/universe`);
            if (!universeResponse.ok) throw new Error(`Failed to get universe ID: ${universeResponse.status}`);
            const universeData = await universeResponse.json();
            const universeId = universeData.universeId;

            // Get game details
            const gameDetail = await fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`).then(res => res.json());
            if (!gameDetail.data?.[0]) throw new Error('Failed to get game details');

            this.serverSizeMoreThan5 = gameDetail.data[0].maxPlayers > 5;
            this.activePlayersInGame = gameDetail.data[0].playing;

            // Setup UI and restore input
            await this.setupGameInfo();
            this.setupEventListeners();
            this.restoreInput();
            this.updateCooldownState();
        } catch (error) {
            this.showError('Initialization failed', error.message);
            console.error('Init error:', error);
        }
    }

    createSafeElement(tag, attributes = {}, textContent = '') {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(attributes)) {
            if (key === 'className') {
                element.className = value;
            } else {
                element.setAttribute(key, value);
            }
        }
        if (textContent) {
            element.textContent = textContent;
        }
        return element;
    }

    restoreInput() {
        const input = document.getElementById('username');
        input.value = this.lastInputValue;
        input.dispatchEvent(new Event('input'));
    }

    updateProgress(percentage) {
        if (this.progressBar) {
            this.progressBar.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
        }
    }

    resetProgress() {
        this.updateProgress(0);
    }

    async startCooldown(button) {
        if (this.isSearching) return;
        
        this.isSearching = true;
        button.disabled = true;
        this.lastSearchTime = Date.now() / 1000;
        
        await new Promise(resolve => {
            chrome.storage.local.set({ lastSearchTime: this.lastSearchTime }, resolve);
        });
        button.textContent = 'Searching...';

        const cooldownInterval = setInterval(() => {
            const remaining = Math.ceil(this.COOLDOWN_TIME - ((Date.now() / 1000) - this.lastSearchTime));
            if (remaining <= 0) {
                button.disabled = false;
                button.textContent = 'Search';
                clearInterval(cooldownInterval);
                this.isSearching = false;
            } else {
                button.textContent = `Wait ${remaining}s`;
            }
        }, 1000);
    }

    async updateCooldownState() {
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
        }
    }

    initializeTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.body.className = `${savedTheme}-mode`;

        document.getElementById('themeToggle').addEventListener('click', () => {
            const currentTheme = document.body.className.includes('light') ? 'dark' : 'light';
            document.body.className = `${currentTheme}-mode`;
            localStorage.setItem('theme', currentTheme);
        });
    }

    async setupGameInfo() {
        this.showLoadingMessage('Loading game info...');
        const gameInfo = await this.fetchGameInfo(this.currentPlaceId);
        document.getElementById('gameThumbnail').src = gameInfo.thumbnailUrl;
        document.getElementById('gameTitle').textContent = gameInfo.name;
        this.clearLoadingMessage();
    }

    setupEventListeners() {
        const searchButton = document.getElementById('searchButton');
        const input = document.getElementById('username');

        searchButton.addEventListener('click', () => this.handleSearch());

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !searchButton.disabled) {
                this.handleSearch();
            }
        });

        input.addEventListener('input', () => {
            input.value = input.value.replace(/[^a-zA-Z0-9_]/g, '');
            this.lastInputValue = input.value;
            chrome.storage.local.set({ lastInput: this.lastInputValue });

            if (input.value.length < 3 || input.value.length > 20) {
                searchButton.style.cursor = "not-allowed";
                searchButton.disabled = true;
            } else {
                searchButton.style.cursor = "";
                searchButton.disabled = false;
            }

            this.progressBar.style.width = "0%";
            document.getElementById('result').innerHTML = '';
        });
    }

    async fetchGameInfo(placeId) {
        try {
            console.info(`Fetching game info for place ID: ${placeId}`);
    
            // First get the universe ID
            const universeResponse = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
            if (!universeResponse.ok) throw new Error(`Failed to get universe ID: ${universeResponse.status}`);
            const universeData = await universeResponse.json();
            const universeId = universeData.universeId;
    
            // Then fetch game info and thumbnail using universe ID
            const [gameResponse, thumbnailResponse] = await Promise.all([
                fetch(`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeId}`),
                fetch(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${universeId}&returnPolicy=PlaceHolder&size=768x432&format=Png&isCircular=false`)
            ]);
    
            if (!gameResponse.ok) throw new Error(`Game info failed: ${gameResponse.status}`);
            if (!thumbnailResponse.ok) throw new Error(`Thumbnail failed: ${thumbnailResponse.status}`);
    
            const [gameData, thumbnailData] = await Promise.all([
                gameResponse.json(),
                thumbnailResponse.json()
            ]);
    
            if (!gameData?.[0]) throw new Error('Game not found');
            if (!thumbnailData.data?.[0]?.thumbnails?.[0]) throw new Error('Thumbnail not found');
    
            return {
                name: gameData[0].name,
                thumbnailUrl: thumbnailData.data[0].thumbnails[0].imageUrl
            };
        } catch (error) {
            console.error('Fetch game info error:', error);
            throw error;
        }
    }

    async findPlayer(targetPlayer) {
        this.resetProgress();
        let username;
        let avatarImageUrl;
        let allTokens = [];

        // Get player info
        if (!/^\d+$/.test(targetPlayer)) {
            username = targetPlayer;
            const userData = await fetch("https://users.roblox.com/v1/usernames/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    "usernames": [targetPlayer],
                    "excludeBannedUsers": true
                })
            }).then(x => x.json());

            targetPlayer = userData.data?.[0]?.id;
        }
        if (!targetPlayer) {
            this.updateProgress(100);
            return [0]; // User doesn't exist
        }

        this.updateProgress(20);

        // Get username if we only had ID
        if (!username) {
            const userResponse = await fetch(`https://users.roblox.com/v1/users/${targetPlayer}`);
            if (!userResponse.ok) {
                this.updateProgress(100);
                return [0];
            }
            const userData = await userResponse.json();
            username = userData.name;
        }

        this.updateProgress(40);

        // Get avatar headshot
        const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${targetPlayer}&size=150x150&format=Png&isCircular=true`)
        .then(x => x.json());

        if (avatarResponse.errors || avatarResponse.data.length === 0) {
            this.updateProgress(100);
            return [0];
        }
        avatarImageUrl = avatarResponse.data[0].imageUrl;

        this.updateProgress(60);

        // Check presence
        const presenceResponse = await fetch("https://presence.roblox.com/v1/presence/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userIds: [targetPlayer] })
        }).then(x => x.json());

        if (!presenceResponse.userPresences?.[0]) {
            this.updateProgress(100);
            return [1];
        }

        const presence = presenceResponse.userPresences[0];
        const statusId = presence.userPresenceType;
        const statusPlaceId = presence.placeId;

        this.updateProgress(80);

        // Handle different presence states
        if (statusId < 2 || statusId === 3) {
            this.updateProgress(100);
            return [statusId === 3 ? 3 : statusId + 1]; // Offline/Online/Studio
        }

        if (statusPlaceId !== null) {
            if (statusPlaceId !== parseInt(this.currentPlaceId)) {
                this.updateProgress(100);
                return [6, presence, avatarImageUrl, username]; // In different game
            }
            if (presence.gameId) {
                this.updateProgress(100);
                return [7, presence.gameId, avatarImageUrl, username]; // Found in current game
            }
        }
    
        // If we get here, we need to search through servers
        return await this.searchServers(avatarImageUrl, username);
    }

    async searchServers(avatarImageUrl, username) {
        let cursor = "";
        let currentProgress = 50;
        let allTokens = [];

        do {
            if (cursor) {
                await this.sleep(this.serverSizeMoreThan5 ? 20000 : 50);
            }

            const servers = await fetch(
                `https://games.roblox.com/v1/games/${this.currentPlaceId}/servers/0?limit=100&cursor=${cursor}`,
                {
                    credentials: this.serverSizeMoreThan5 ? "omit" : "include"
                }
            ).then(response => response.json());

            if (servers.errors) {
                await this.sleep(this.serverSizeMoreThan5 ? 20000 : 1000);
                continue;
            }

            // Collect all player tokens
            for (let server of servers.data) {
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

            // Check the tokens in batches
            if (allTokens.length > 0) {
                const result = await this.checkTokenBatch(allTokens, avatarImageUrl);
                if (result) {
                    return [7, result, avatarImageUrl, username];
                }
            }

            cursor = servers.nextPageCursor;
            allTokens = [];

            // Update progress
            if (currentProgress < 90) {
                currentProgress += 5;
                this.progressBar.style.width = `${currentProgress}%`;
            }

        } while (cursor);

        this.progressBar.style.width = "100%";
        return [5]; // Player not found in any server
    }

    async checkTokenBatch(tokens, targetAvatarUrl) {
        const chunkedTokens = this.splitTokensIntoChunks(tokens, 50);

        for (let chunk of chunkedTokens) {
            let retries = 3;
            while (retries > 0) {
                try {
                    await this.sleep(1000);
                    const response = await fetch("https://thumbnails.roblox.com/v1/batch", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(chunk)
                    }).then(x => x.json());

                    if (response.errors) {
                        if (response.errors.some(e => e.code === 0)) {
                            await this.sleep(5000);
                            retries--;
                            continue;
                        }
                        console.error('Batch check error:', response.errors);
                        break;
                    }

                    const match = response.data.find(data => data.imageUrl === targetAvatarUrl);
                    if (match) return match.requestId;
                    break;
                } catch (error) {
                    console.error('Batch check error:', error);
                    await this.sleep(5000);
                    retries--;
                }
            }
        }
        return null;
    }

    splitTokensIntoChunks(array, size = 100) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async handleSearch() {
        if (this.isSearching) return;
        
        const searchButton = document.getElementById('searchButton');
        const input = document.getElementById('username').value.trim();

        this.resetProgress();

        // Cooldown check
        const currentTime = Date.now() / 1000;
        const timeElapsed = currentTime - this.lastSearchTime;
        if (timeElapsed < this.COOLDOWN_TIME) {
            const remainingTime = Math.ceil(this.COOLDOWN_TIME - timeElapsed);
            this.showError('Please wait', `You can search again in ${remainingTime} seconds`);
            return;
        }

        if (!input) {
            this.showError('Please enter a username or ID');
            return;
        }

        await this.startCooldown(searchButton);

        try {
            this.showStatus('Looking up user...');
            this.updateProgress(10);
            const result = await this.findPlayer(input);
            this.updateProgress(100);

            switch (result[0]) {
                case 0: this.showError("User doesn't exist!"); break;
                case 1: this.showError("Player is offline!"); break;
                case 2: this.showError("Player is online, but not in a game."); break;
                case 3: this.showError("Player is in Roblox Studio!"); break;
                case 4: this.showError("No Servers Found!"); break;
                case 5: this.showError("Player not found in this game!"); break;
                case 6: this.showPlayerInOtherGame(result[1], result[2], result[3]); break;
                case 7: this.displayJoinOption(result[1], result[2], result[3]); break;
                default: this.showError("An unknown error occurred");
            }
        } catch (error) {
            this.updateProgress(100);
            this.showError('Search failed', error.message);
        }
    }

    async getGameAuthInfo() {
        try {
            // First verify authentication
            const authCheck = await fetch('https://users.roblox.com/v1/users/authenticated', {
                method: 'GET',
                credentials: 'include'
            });

            if (!authCheck.ok) {
                throw new Error('Please login to Roblox first');
            }

            // Get CSRF token
            const tokenResponse = await fetch('https://auth.roblox.com/v2/logout', {
                method: 'POST',
                credentials: 'include'
            });

            const csrfToken = tokenResponse.headers.get('x-csrf-token');
            if (!csrfToken) {
                throw new Error('Failed to get security token');
            }

            return { csrfToken };
        } catch (error) {
            console.error('Auth info error:', error);
            throw error;
        }
    }

    displayJoinOption(gameId, avatarUrl, username) {
        const resultDiv = document.getElementById('result');
        resultDiv.textContent = ''; // Clear existing content
    
        // Create container
        const container = this.createSafeElement('div', { className: 'result success' });
        
        // Add status text
        container.appendChild(this.createSafeElement('span', {}, 'Player found!'));
        
        // Add server info
        const verboseDiv = this.createSafeElement('div', { className: 'verbose' });
        verboseDiv.appendChild(
            this.createSafeElement('span', {}, `Found in ${gameId ? 'public' : 'private'} server!`)
        );
        container.appendChild(verboseDiv);
        
        // Add join button container
        const buttonContainer = this.createSafeElement('div', { className: 'join-button' });
        const joinButton = this.createSafeElement('button', {
            className: 'join-link',
            id: 'joinButton'
        }, 'Join Game');
        buttonContainer.appendChild(joinButton);
        container.appendChild(buttonContainer);
        
        // Add to page
        resultDiv.appendChild(container);
    
        // Add event listener
        joinButton.addEventListener('click', async () => {
            try {
                const button = document.getElementById('joinButton');
                button.textContent = 'Launching...';
                button.disabled = true;

                console.info('Starting game launch process...');

                // Get game auth info
                const { csrfToken } = await this.getGameAuthInfo();
                console.info('Got security token');

                // Generate URLs for both protocols
                const placeUrl = `https://www.roblox.com/games/${this.currentPlaceId}${gameId ? `?gameInstanceId=${gameId}` : ''}`;
                const protocolUrl = `roblox://placeId=${this.currentPlaceId}${gameId ? `&gameInstanceId=${gameId}` : ''}`;
                
                // Try browser detection for optimal protocol
                const isChromium = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
                
                if (isChromium) {
                    console.info('Detected Chromium browser, using primary protocol');
                    // For Chromium, try the roblox-player protocol first
                    const chromiumUrl = `roblox-player://1+launchmode:play+gameinfo:${this.currentPlaceId}+launchtime:${Date.now()}+placelauncherurl:${encodeURIComponent(placeUrl)}`;
                    window.location.href = chromiumUrl;
                    
                    // Fallback to alternate protocol after a short delay
                    setTimeout(() => {
                        console.info('Trying fallback protocol...');
                        window.location.href = protocolUrl;
                    }, 1000);
                } else {
                    // For other browsers, use the standard protocol
                    console.info('Using standard protocol');
                    window.location.href = protocolUrl;
                }

                // Always open the web page as final fallback
                setTimeout(() => {
                    console.info('Opening web page as fallback');
                    window.open(placeUrl, '_blank');
                }, 2000);

            } catch (error) {
                console.error('Launch error:', error);
                this.showError('Failed to launch game', error.message);
                const button = document.getElementById('joinButton');
                button.textContent = 'Join Game';
                button.disabled = false;
            }
        });
    }
    
    showPlayerInOtherGame(presence, avatarUrl, username) {
        const resultDiv = document.getElementById('result');
        resultDiv.textContent = ''; // Clear existing content
    
        // Create the main container
        const container = this.createSafeElement('div', { className: 'result warning' });
    
        // Add the main text
        container.appendChild(
            this.createSafeElement('span', {}, `Player is in a different game: ${presence.lastLocation}`)
        );
    
        // Create verbose info container
        const verboseDiv = this.createSafeElement('div', { className: 'verbose' });
    
        // Add Game ID
        verboseDiv.appendChild(
            this.createSafeElement('span', {}, `Game ID: ${presence.placeId}`)
        );
    
        // Add line break
        verboseDiv.appendChild(document.createElement('br'));
    
        // Add Server ID
        verboseDiv.appendChild(
            this.createSafeElement('span', {}, `Server ID: ${presence.gameId || 'Private Server'}`)
        );
    
        // Add verbose div to container
        container.appendChild(verboseDiv);
    
        // Add everything to the result div
        resultDiv.appendChild(container);
    }

    showLoadingMessage(message) {
        const resultDiv = document.getElementById('result');
        resultDiv.textContent = ''; // Clear existing content
    
        const container = this.createSafeElement('div', { className: 'result warning' });
        container.appendChild(this.createSafeElement('span', {}, message));
        resultDiv.appendChild(container);
    }

    clearLoadingMessage() {
        const resultDiv = document.getElementById('result');
        resultDiv.textContent = ''; // Clear existing content
    }

    showError(message, details = '') {
        const resultDiv = document.getElementById('result');
        resultDiv.textContent = ''; // Clear existing content
    
        const container = this.createSafeElement('div', { className: 'result error' });
        container.appendChild(this.createSafeElement('span', {}, message));
    
        if (details) {
            const verboseDiv = this.createSafeElement('div', { className: 'verbose' });
            verboseDiv.appendChild(this.createSafeElement('span', {}, details));
            container.appendChild(verboseDiv);
        }
    
        resultDiv.appendChild(container);
    }

    showStatus(message, details = '') {
        const resultDiv = document.getElementById('result');
        resultDiv.textContent = ''; // Clear existing content
    
        const container = this.createSafeElement('div', { className: 'result warning' });
        container.appendChild(this.createSafeElement('span', {}, message));
    
        if (details) {
            const verboseDiv = this.createSafeElement('div', { className: 'verbose' });
            verboseDiv.appendChild(this.createSafeElement('span', {}, details));
            container.appendChild(verboseDiv);
        }
    
        resultDiv.appendChild(container);
    }

    extractGameId(url) {
        const match = url.match(/roblox\.com\/games\/(\d+)/);
        return match ? match[1] : null;
    }
}

class DebugConsole {
    constructor() {
        this.logElement = document.getElementById('debugLog');
        this.setupClearButton();
        this.interceptConsole();
    }

    setupClearButton() {
        document.getElementById('clearDebug').addEventListener('click', () => {
            this.logElement.innerHTML = '';
        });
    }

    interceptConsole() {
        const self = this;
        const originalConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn,
            info: console.info
        };

        Object.keys(originalConsole).forEach(type => {
            console[type] = function() {
                self.log(type, ...arguments);
                originalConsole[type].apply(console, arguments);
            };
        });
    }

    log(type, ...args) {
        const entry = document.createElement('div');
        entry.className = `debug-entry ${type}`;

        const message = args.map(arg => {
            if (arg instanceof Error) return `${arg.message}\n${arg.stack}`;
            if (typeof arg === 'object') return JSON.stringify(arg, null, 2);
            return String(arg);
        }).join(' ');

        const time = new Date().toLocaleTimeString();
        entry.textContent = `[${time}] ${message}`;

        this.logElement.appendChild(entry);
        this.logElement.scrollTop = this.logElement.scrollHeight;
    }
}

// Initialize extension
document.addEventListener('DOMContentLoaded', () => {
    const playerFinder = new PlayerFinder();
    playerFinder.initialize();
});