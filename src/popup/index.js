import { PlayerFinder } from './playerFinder.js';

/**
 * Global instance of PlayerFinder
 * @type {PlayerFinder|null}
 */
let playerFinder = null;

/**
 * Initialize the popup
 */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Only initialize PlayerFinder if not already initialized
        if (!playerFinder) {
            playerFinder = new PlayerFinder();
            await playerFinder.initialize();
        }
    } catch (error) {
        console.error('Failed to initialize popup:', error);
        
        // Show error in UI if possible
        const resultDiv = document.getElementById('result');
        if (resultDiv) {
            resultDiv.innerHTML = `
                <div class="result error">
                    <span>Failed to initialize popup</span>
                    <div class="verbose">
                        <span>${error.message}</span>
                    </div>
                </div>
            `;
        }
    }
});

/**
 * Handle popup unload
 */
window.addEventListener('unload', async () => {
    if (playerFinder) {
        playerFinder.cleanup();
        playerFinder = null;
    }
});

/**
 * Handle visibility changes
 */
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && playerFinder) {
        playerFinder.handleStorageUpdate();
    }
});

/**
 * Error handler for uncaught errors
 */
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    
    // Show error in UI if possible
    const resultDiv = document.getElementById('result');
    if (resultDiv) {
        resultDiv.innerHTML = `
            <div class="result error">
                <span>An error occurred</span>
                <div class="verbose">
                    <span>${event.error?.message || 'Unknown error'}</span>
                </div>
            </div>
        `;
    }
});

/**
 * Error handler for unhandled promise rejections
 */
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    
    // Show error in UI if possible
    const resultDiv = document.getElementById('result');
    if (resultDiv) {
        resultDiv.innerHTML = `
            <div class="result error">
                <span>An error occurred</span>
                <div class="verbose">
                    <span>${event.reason?.message || 'Unknown error'}</span>
                </div>
            </div>
        `;
    }
});