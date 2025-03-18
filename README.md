# AI Hover Assistant
A Chrome Extension for Using AI to Interact With Web Pages

## Features

- AI-powered floating assistant with Claude and Perplexity integration
- Context-aware responses based on web page content
- Voice input and output support
- Shadow DOM implementation for style isolation
- Smart model delegation based on query type
- Usage tracking and management

## API Keys Configuration

This extension requires API keys for the following services:
- Claude API (Anthropic)
- Perplexity API
- OpenAI API (optional, for voice transcription)

### Setting API Keys

API keys can be configured in two ways:

1. **Using the extension popup**: Click on the extension icon, then click "Configure API Keys" to enter your API keys directly. These keys will be securely stored in Chrome's local storage.

2. **Using a .env file**: For development, you can create a `.env` file in the root directory with the following format:
   ```
   # API Keys
   CLAUDE_API_KEY="your-claude-api-key-here"
   PERPLEXITY_API_KEY="your-perplexity-api-key-here"
   OPENAI_API_KEY="your-openai-api-key-here"
   ```

The extension will first check Chrome's local storage for API keys, then fall back to the `.env` file if needed.

### Troubleshooting API Key Issues

If you're experiencing issues with API keys, follow these steps:

1. **Verify API Key Format**
   - Claude API keys should start with `sk-ant-` or just `sk-` for newer keys
   - Perplexity API keys should start with `pplx-`
   - OpenAI API keys should start with `sk-`

2. **Use the Diagnostic Tools**
   - Open the browser console (F12 or Right-click > Inspect > Console)
   - Copy and paste the entire content of `api-key-checker.js` into the console
   - Run the following commands:
     ```javascript
     // To check key status:
     checkApiKeys();
     
     // To directly test API connectivity:
     testDirectApiCall();
     
     // To reset keys:
     resetApiKeys();
     ```

3. **Common Error Messages and Fixes**
   - `Invalid x-api-key`: Verify your Claude API key is correctly copied from the Anthropic console
   - `API keys are missing`: Enter your keys in the extension popup or create a .env file
   - `API access verification failed`: The key format is incorrect or the API is unavailable
   - `Cannot read properties of undefined (reading 'slice')`: API key is null or undefined
   - `Could not load content.css`: Non-critical CSS loading warning (fallback styles will be used)

4. **Advanced Troubleshooting**
   - Check your key permissions in the Anthropic console
   - If your key works in Python but not in the extension, verify the header format
   - For Claude API specifically, try both `x-api-key` and `Authorization: Bearer` headers
   - Clear Chrome's storage and reinstall the extension if problems persist
   - Check for CORS issues if direct API calls work but extension requests fail

## Installation

1. Clone this repository
2. Configure your API keys (see above)
3. Load the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the extension directory

## Development

The extension structure:

- `manifest.json`: Extension configuration
- `popup/`: Extension popup UI
- `src/background/`: Background service worker
- `src/content/`: Content scripts for webpage integration
- `src/services/`: Core services (AI, context, memory, etc.)
- `api-key-checker.js`: Utility for diagnosing API key issues
- `reset-keys.js`: Utility for resetting API keys

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Safety Note

Never expose your API keys. The extension stores them securely in Chrome's local storage, but be careful when sharing your extension directory or logs.

## Changelog

### v1.0.0 
- Initial release with Claude and Perplexity integration
- Shadow DOM implementation for better style isolation
- Usage tracking and voice support
- API key management with validation