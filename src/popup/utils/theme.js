/**
 * Theme configuration constants
 */
const THEME_CONFIG = {
    STORAGE_KEY: 'theme',
    THEMES: {
        LIGHT: 'light',
        DARK: 'dark'
    },
    DEFAULT_THEME: 'light'
};

/**
 * Manages theme switching and persistence
 */
export class ThemeManager {
    constructor() {
        // Get theme from localStorage or default to light
        this.currentTheme = localStorage.getItem(THEME_CONFIG.STORAGE_KEY) || THEME_CONFIG.DEFAULT_THEME;
        this.init();
    }

    /**
     * Initialize theme manager
     */
    init() {
        const root = document.documentElement;
        const body = document.body;
        
        // Set initial theme
        this.applyTheme();
        
        // Setup theme toggle
        this.setupThemeToggle();
    }

    /**
     * Setup theme toggle button
     */
    setupThemeToggle() {
        const themeToggle = document.getElementById('themeToggle');
        if (!themeToggle) return;

        themeToggle.addEventListener('click', () => {
            this.toggleTheme();
        });
    }

    /**
     * Toggle between light and dark themes
     */
    toggleTheme() {
        // Store current card states
        const gameCard = document.getElementById('gameCard');
        const userCard = document.getElementById('userCard');
        const gameCardDisplay = gameCard ? gameCard.style.display : 'none';
        const userCardDisplay = userCard ? userCard.style.display : 'none';

        // Toggle theme
        this.currentTheme = this.currentTheme === THEME_CONFIG.THEMES.LIGHT 
            ? THEME_CONFIG.THEMES.DARK 
            : THEME_CONFIG.THEMES.LIGHT;
        
        // Apply new theme
        this.applyTheme();
        
        // Persist theme choice
        localStorage.setItem(THEME_CONFIG.STORAGE_KEY, this.currentTheme);

        // Restore card states
        if (gameCard) gameCard.style.display = gameCardDisplay;
        if (userCard) userCard.style.display = userCardDisplay;
    }

    /**
     * Apply current theme to document
     */
    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.currentTheme);
        document.body.className = `${this.currentTheme}-mode initialized`;
    }

    /**
     * Get current theme
     * @returns {string} Current theme ('light' or 'dark')
     */
    getCurrentTheme() {
        return this.currentTheme;
    }

    /**
     * Set theme directly
     * @param {string} theme - Theme to set ('light' or 'dark')
     */
    setTheme(theme) {
        if (Object.values(THEME_CONFIG.THEMES).includes(theme)) {
            this.currentTheme = theme;
            this.applyTheme();
            localStorage.setItem(THEME_CONFIG.STORAGE_KEY, theme);
        }
    }
}

/**
 * Storage utilities for theme
 */
export const themeStorage = {
    /**
     * Save theme preference
     * @param {string} theme - Theme to save
     */
    saveTheme(theme) {
        if (Object.values(THEME_CONFIG.THEMES).includes(theme)) {
            localStorage.setItem(THEME_CONFIG.STORAGE_KEY, theme);
        }
    },

    /**
     * Get saved theme
     * @returns {string} Saved theme or default theme if none saved
     */
    getSavedTheme() {
        return localStorage.getItem(THEME_CONFIG.STORAGE_KEY) || THEME_CONFIG.DEFAULT_THEME;
    }
};

// Export config for use in other components
export const CONFIG = THEME_CONFIG;