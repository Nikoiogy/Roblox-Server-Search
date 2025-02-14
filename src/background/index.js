import { BackgroundSearch } from './backgroundSearch.js';

// Initialize background search
const backgroundSearch = new BackgroundSearch();

// Add listener for popup disconnection
browser.runtime.onConnect.addListener((port) => {
    port.onDisconnect.addListener(async () => {
        await backgroundSearch.resetSearchState();
    });
});

// Message listener for search requests
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'startSearch') {
        backgroundSearch.startSearch(
            message.placeId,
            message.userId,
            message.avatarUrl,
            message.username,
            message.serverSizeMoreThan5
        ).then((result) => {
            sendResponse({ success: true, result });
        }).catch(error => {
            sendResponse({ error: error.message });
        });
        return true; // Required for async sendResponse
    }
    return false;
});