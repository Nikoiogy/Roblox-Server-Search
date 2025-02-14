/**
 * Sanitize HTML string to prevent XSS
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
export const sanitizeHTML = (str) => {
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
};

/**
 * Create a DOM element with safe attributes
 * @param {string} tag - HTML tag name
 * @param {Object} attributes - Element attributes
 * @param {string} textContent - Element text content
 * @returns {HTMLElement} Created element
 */
export const createSafeElement = (tag, attributes = {}, textContent = '') => {
    const element = document.createElement(tag);
    
    // Set allowed attributes
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'className') {
            element.className = value;
        } else if (key.startsWith('data-')) {
            element.setAttribute(key, value);
        } else if (['id', 'src', 'alt', 'title', 'type', 'role', 'aria-label', 'disabled'].includes(key)) {
            element[key] = value;
        }
    }
    
    // Set text content if provided
    if (textContent) {
        element.textContent = textContent;
    }
    
    return element;
};

/**
 * Create and display a result card
 * @param {string} type - Result type (success/error/warning)
 * @param {string} message - Main message
 * @param {string} details - Optional details
 * @param {string} avatarUrl - Optional avatar URL
 * @returns {HTMLElement} Created result card
 */
export const createResultCard = (type, message, details = '', avatarUrl = null) => {
    const container = createSafeElement('div', { className: `result ${type}` });

    if (avatarUrl) {
        const avatarImg = createSafeElement('img', {
            src: avatarUrl,
            alt: 'Avatar',
            className: 'avatar-image'
        });
        container.appendChild(avatarImg);
    }

    container.appendChild(createSafeElement('span', {}, message));

    if (details) {
        const verboseDiv = createSafeElement('div', { className: 'verbose' });
        verboseDiv.appendChild(createSafeElement('span', {}, details));
        container.appendChild(verboseDiv);
    }

    return container;
};

/**
 * Update user status display
 * @param {HTMLElement} statusDiv - Status container element
 * @param {Object} presence - User presence data
 */
export const updateUserStatus = (statusDiv, presence) => {
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
};