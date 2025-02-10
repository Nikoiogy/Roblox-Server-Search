# Roblox Server Search

A modern browser extension that helps you find and join specific players in Roblox game servers. This extension provides a streamlined way to search for players and join their games directly from your browser.

## Features

- 🔍 **Quick Player Search**: Search for players by username or ID
- 🎮 **Direct Game Join**: Join players' servers with a single click
- 🌐 **Public/Private Server Detection**: Identifies if a player is in a public or private server
- ⚡ **Real-time Progress**: Visual feedback on search progress
- 🌓 **Dark/Light Theme**: Comfortable viewing in any lighting condition
- 🛡️ **Rate Limit Protection**: Built-in cooldown system to prevent API abuse
- 🪲 **Debug Console**: Built-in debugging tools for troubleshooting

## Installation

### Firefox
1. Download the latest release from the releases page
2. Navigate to `about:addons` in Firefox
3. Click the gear icon and select "Install Add-on From File"
4. Select the downloaded `.xpi` file

### Chrome
1. Download and extract the latest release
2. Navigate to `chrome://extensions`
3. Enable "Developer Mode" in the top right
4. Click "Load Unpacked" and select the extracted folder

## Usage

1. Navigate to any Roblox game page (URL format: `https://www.roblox.com/games/[GAME_ID]/...`)
2. Click the extension icon to open the popup
3. Enter the username or ID of the player you want to find
4. Click "Search" and wait for the results
5. If the player is found, click "Join Game" to join their server

## Features in Detail

### Player Status Detection
The extension can detect various player states:
- Offline
- Online (not in game)
- In Roblox Studio
- In a different game
- In the current game (public server)
- In the current game (private server)

### Search Progress
- Real-time progress bar shows search status
- Detailed status messages keep you informed
- Built-in cooldown system prevents API abuse

### Theme Support
- Automatic light/dark theme detection
- Manual theme toggle available
- Smooth transitions between themes

### Debug Console
- Real-time logging of search operations
- Error tracking and debugging information
- Clear log functionality

## Technical Details

### Permissions
The extension requires the following permissions:
- `activeTab`: To interact with the current Roblox game page
- `storage`: To save user preferences and cooldown times
- `cookies`: To handle authentication with Roblox
- `*://*.roblox.com/*`: To access Roblox APIs

### API Usage
The extension interacts with several Roblox APIs:
- Users API for player information
- Presence API for player status
- Games API for server information
- Thumbnails API for avatar images

### Rate Limiting
- 10-second cooldown between searches
- Automatic retry system for failed requests
- Batch processing for server searches

## Development

### Prerequisites
- Web browser (Firefox 109.0+ or Chrome)
- Basic understanding of JavaScript and browser extensions

### Project Structure
```
roblox-server-search/
├── manifest.json        # Extension configuration
├── popup.html          # Main UI
├── popup.js            # Core functionality
└── icons/              # Extension icons
```

### Building
1. Clone the repository
2. Make desired modifications
3. Test using browser's developer mode
4. Package for distribution

## Contributing

Contributions are welcome! Please follow these steps:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0). This means:

### Allowed
- Personal use
- Modification and adaptation
- Distribution of non-commercial versions
- Sharing with proper attribution

### Not Allowed
- Commercial use
- Using the code in commercial products
- Selling or monetizing the extension or its derivatives

For the full license text, see the LICENSE file or visit: https://creativecommons.org/licenses/by-nc/4.0/