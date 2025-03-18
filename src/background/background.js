// Track tabs where scripts have been injected
const injectedTabs = new Set();

// Initialize API keys storage
let apiKeys = {
    claude: '',
    perplexity: '',
    openai: ''
};

let activeConnections = new Map();

const API_TIMEOUT = 15000; // 15 seconds
const MAX_CONTEXT_LENGTH = 1000;
const MAX_HISTORY_MESSAGES = 5;
const PORT_TIMEOUT = 30000;
const CLEANUP_INTERVAL = 10000;

async function loadApiKeysFromEnv() {
    try {
        console.log('Loading API keys from .env file...');
        const envUrl = chrome.runtime.getURL('.env');
        
        const response = await fetch(envUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to load .env file. Status: ${response.status}`);
        }
        
        const envText = await response.text();
        
        // Parse keys using regex
        const claudeKeyMatch = envText.match(/CLAUDE_API_KEY=["']([^"']+)["']/);
        const perplexityKeyMatch = envText.match(/PERPLEXITY_API_KEY=["']([^"']+)["']/);
        const openaiKeyMatch = envText.match(/OPENAI_API_KEY=["']([^"']+)["']/);
        
        const claudeKey = claudeKeyMatch ? claudeKeyMatch[1] : '';
        const perplexityKey = perplexityKeyMatch ? perplexityKeyMatch[1] : '';
        const openaiKey = openaiKeyMatch ? openaiKeyMatch[1] : '';
        
        if (claudeKey) {
            console.log('Found Claude API Key in .env file');
        }
        
        if (perplexityKey) {
            console.log('Found Perplexity API Key in .env file');
        }
        
        if (openaiKey) {
            console.log('Found OpenAI API Key in .env file');
        }
        
        return {
            claude: claudeKey,
            perplexity: perplexityKey,
            openai: openaiKey
        };
    } catch (error) {
        console.error('Error loading API keys from .env:', error);
        return null;
    }
}

async function loadApiKeys() {
    try {
        // First try to get from memory
        if (apiKeys.claude && apiKeys.perplexity) {
            console.log('Using API keys already in memory');
            return true;
        }

        // Then try to get from storage
        console.log('Checking Chrome storage for API keys...');
        const storedKeys = await chrome.storage.local.get(['claudeKey', 'perplexityKey', 'openaiKey']);
        if (storedKeys.claudeKey && storedKeys.perplexityKey) {
            console.log('Found API keys in Chrome storage');
            
            // Debug output for Claude key
            console.log('CLAUDE KEY DEBUG:');
            console.log('- Value:', storedKeys.claudeKey);
            console.log('- Type:', typeof storedKeys.claudeKey);
            console.log('- Length:', storedKeys.claudeKey.length);
            console.log('- First chars:', storedKeys.claudeKey.substring(0, 10));
            console.log('- Has spaces:', storedKeys.claudeKey !== storedKeys.claudeKey.trim());
            
            apiKeys.claude = storedKeys.claudeKey.trim(); // Ensure no whitespace
            apiKeys.perplexity = storedKeys.perplexityKey.trim(); // Ensure no whitespace
            apiKeys.openai = storedKeys.openaiKey ? storedKeys.openaiKey.trim() : '';
            return true;
        }

        // Try to load from .env file
        console.log('Trying to load API keys from .env file...');
        const envKeys = await loadApiKeysFromEnv();
        if (envKeys && envKeys.claude && envKeys.perplexity) {
            console.log('Successfully loaded API keys from .env file');
            apiKeys = envKeys;
            
            // Store in local storage for faster subsequent loads
            await chrome.storage.local.set({
                claudeKey: apiKeys.claude,
                perplexityKey: apiKeys.perplexity,
                openaiKey: apiKeys.openai
            });
            console.log('Saved .env API keys to Chrome storage');
            
            return true;
        }
        
        console.log('Failed to load API keys. Please set them in extension popup.');
        return false;
    } catch (error) {
        console.error('Error loading API keys:', error);
        return false;
    }
}

// Load API keys on startup
loadApiKeys();

async function handlePerplexityRequest(message) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
        // Load API keys if needed
        await loadApiKeys();
        
        if (!apiKeys.perplexity) {
            throw new Error('Perplexity API key is not set');
        }
        
        // Handle context
        let promptText = message.prompt;
        if (message.context?.contextString) {
            promptText = `Current Webpage Content:
            ${message.context.contextString}

            URL: ${message.context.url || 'Not provided'}
            Title: ${message.context.title || 'Not provided'}

            User Question: ${message.prompt}`;
        }

        // Prepare API request
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKeys.perplexity}`
            },
            body: JSON.stringify({
                model: 'sonar-pro',
                messages: [{
                    role: 'system',
                    content: 'You are a helpful AI assistant providing information about the current webpage.'
                }, {
                    role: 'user',
                    content: promptText
                }],
                temperature: 0.3,
                max_tokens: 4096,
                top_p: 0.9,
                stream: false
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        clearTimeout(timeout);
        
        // Extract text from response
        const responseText = data.choices?.[0]?.message?.content;
        if (!responseText) {
            throw new Error('Invalid response format from API');
        }
        
        console.log('Perplexity request successful');
        return {
            success: true,
            data: { 
                content: [{ 
                    text: responseText 
                }] 
            }
        };

    } catch (error) {
        console.error('Perplexity API error:', error);
        return {
            success: false,
            error: `Perplexity API Error: ${error.message}`,
            data: { 
                content: [{ 
                    text: `I apologize, but I couldn't process your request: ${error.message}` 
                }] 
            }
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function handleClaudeRequest(message) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
        // Load API keys if needed
        await loadApiKeys();
        
        if (!apiKeys.claude) {
            throw new Error('Claude API key is not set');
        }
        
        console.log('Using Claude API key');
        
        // EXTREME DEBUG - Print full details about the key
        console.log('====== CLAUDE API KEY DEBUG IN REQUEST HANDLER ======');
        console.log('Claude key value:', apiKeys.claude);
        console.log('Key length:', apiKeys.claude?.length);
        console.log('Key type:', typeof apiKeys.claude);
        console.log('Prefix check (sk-ant-):', apiKeys.claude?.startsWith('sk-ant-'));
        console.log('Prefix check (sk-):', apiKeys.claude?.startsWith('sk-'));
        console.log('======= END DEBUG =======');
        
        // Prepare message content
        let promptText = message.prompt;
        if (message.context?.contextString) {
            promptText = `Webpage Content:\n${message.context.contextString}\n\nQuestion: ${message.prompt}`;
        }

        // Build request body
        const requestBody = {
            model: "claude-3-sonnet-20240229",
            messages: [{
                role: "user",
                content: promptText
            }],
            max_tokens: 4096,
            temperature: 0.7,
            system: "You are a helpful AI assistant providing information about the current webpage."
        };
        
        console.log('Sending request to Claude API...');

        // Ensure the key has no whitespace
        const trimmedKey = apiKeys.claude.trim();
        console.log('Making Claude API request with this key prefix:', trimmedKey.substring(0, 10));
        
        // Determine the right header format based on the key format
        const headers = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
        };
        
        // Try to determine if this is a newer key format
        if (trimmedKey.startsWith('sk-') && !trimmedKey.startsWith('sk-ant-')) {
            // New format keys use Bearer authentication
            headers['Authorization'] = `Bearer ${trimmedKey}`;
            console.log('Using Bearer token authentication for Claude API');
        } else {
            // Old format keys use x-api-key
            headers['x-api-key'] = trimmedKey;
            console.log('Using x-api-key authentication for Claude API');
        }
        
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        console.log(`Claude API response status: ${response.status}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Claude API error response: ${errorText}`);
            throw new Error(`Claude API Error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        console.log('Successfully received Claude API response');
        
        const responseText = data.content[0].text;

        return {
            success: true,
            data: {
                content: [{ text: responseText }]
            }
        };

    } catch (error) {
        console.error('Claude API error:', error);
        return {
            success: false,
            error: `Claude API Error: ${error.message}`,
            data: {
                content: [{ 
                    text: `I apologize, but I couldn't process your request: ${error.message}` 
                }]
            }
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function handleOpenAIRequest(message) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
        // Load API keys if needed
        await loadApiKeys();
        
        if (!apiKeys.openai) {
            throw new Error('OpenAI API key is not set');
        }
        
        // Prepare message content
        let promptText = message.prompt;
        if (message.context?.contextString) {
            promptText = `Webpage Content:\n${message.context.contextString}\n\nQuestion: ${message.prompt}`;
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKeys.openai}`
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful AI assistant providing information about the current webpage."
                    },
                    {
                        role: "user",
                        content: promptText
                    }
                ],
                temperature: 0.7,
                max_tokens: 4000
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`OpenAI API Error: ${response.status}`);
        }

        const data = await response.json();
        const responseText = data.choices[0]?.message?.content;

        return {
            success: true,
            data: {
                content: [{ text: responseText }]
            }
        };

    } catch (error) {
        console.error('OpenAI API error:', error);
        return {
            success: false,
            error: `OpenAI API Error: ${error.message}`,
            data: {
                content: [{ 
                    text: `I apologize, but I couldn't process your request: ${error.message}` 
                }]
            }
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function handleApiRequest(message) {
    try {
        if (!message?.prompt) {
            throw new Error('Invalid request format');
        }

        const model = message.model || 'claude';
        
        // Log API request for debugging
        console.log(`Making API request to ${model} with prompt: ${message.prompt.substring(0, 100)}...`);
        
        // Get handler for the requested model
        let handler;
        switch (model.toLowerCase()) {
            case 'perplexity':
                handler = handlePerplexityRequest;
                break;
            case 'openai':
                handler = handleOpenAIRequest;
                break;
            case 'claude':
            default:
                handler = handleClaudeRequest;
        }

        // Process the request with the appropriate handler
        console.log(`Calling ${model} API handler...`);
        const response = await handler(message);
        console.log(`API response received from ${model}: ${response.success}`);
        
        return response;
    } catch (error) {
        console.error('API request error:', error);
        
        // Return error response
        return {
            success: false,
            error: `API Error: ${error.message || 'Unknown error occurred'}`,
            data: {
                content: [{
                    text: `Sorry, I encountered an error: ${error.message}. Please verify your API keys and try again.`
                }]
            }
        };
    }
}

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'validateAPIKey') {
        const model = message.model;
        
        if (!model) {
            sendResponse({ success: false, error: 'Missing model parameter' });
            return true;
        }
        
        // Validate API key format based on model
        if (model === 'claude') {
            if (!apiKeys.claude) {
                sendResponse({ success: false, error: 'Claude API key is not set' });
                return true;
            }
            
            // Accept all Claude API key formats (sk-ant- or sk-)
            // Ensure key exists and has a valid format
            if (!apiKeys.claude || typeof apiKeys.claude !== 'string' || 
                (!apiKeys.claude.startsWith('sk-ant-') && !apiKeys.claude.startsWith('sk-'))) {
                sendResponse({ success: false, error: 'Invalid Claude API key format. Should start with sk-ant- or sk-' });
                return true;
            }
            
            sendResponse({ success: true });
        } 
        else if (model === 'perplexity') {
            if (!apiKeys.perplexity) {
                sendResponse({ success: false, error: 'Perplexity API key is not set' });
                return true;
            }
            
            if (!apiKeys.perplexity.startsWith('pplx-')) {
                sendResponse({ success: false, error: 'Invalid Perplexity API key format. Should start with pplx-' });
                return true;
            }
            
            sendResponse({ success: true });
        }
        else if (model === 'openai') {
            if (!apiKeys.openai) {
                sendResponse({ success: false, error: 'OpenAI API key is not set' });
                return true;
            }
            
            sendResponse({ success: true });
        }
        else {
            sendResponse({ success: false, error: 'Invalid model' });
        }
        
        return true;
    }
    
    if (message.action === 'updateAPIKey') {
        const keyType = message.keyType;
        const key = message.key;
        
        if (!keyType || !key) {
            sendResponse({ success: false, error: 'Missing key type or key' });
            return true;
        }
        
        console.log(`Updating ${keyType} API key`);
        
        // Store in memory
        apiKeys[keyType] = key;
        
        // Store in storage
        chrome.storage.local.set({ [`${keyType}Key`]: key })
            .then(() => {
                console.log(`${keyType} API key saved to storage`);
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error(`Failed to save ${keyType} API key to storage:`, error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
    
    if (message.action === 'queryAPI') {
        handleApiRequest(message)
            .then(response => sendResponse(response))
            .catch(error => sendResponse({ 
                success: false, 
                error: error.message,
                data: {
                    content: [{
                        text: `Sorry, I encountered an error: ${error.message}. Please try again.`
                    }]
                }
            }));
        return true;
    }
    
    // Handle other actions
    if (message.action === 'toggleSidebar') {
        handleToggleSidebar(message.tabId || sender.tab.id)
            .then(result => sendResponse({ success: result }))
            .catch(error => sendResponse({ 
                success: false, 
                error: error.message 
            }));
        return true;
    }
    
    sendResponse({ success: false, error: `Unknown action: ${message.action}` });
    return false;
});

// Handle connection to the extension
chrome.runtime.onConnect.addListener((port) => {
    const portId = port.name;
    
    // Create timeout handler
    const timeoutId = setTimeout(() => {
        if (activeConnections.has(portId)) {
            const connection = activeConnections.get(portId);
            if (connection.port) {
                connection.port.postMessage({ 
                    success: false, 
                    error: 'Request timed out' 
                });
            }
            cleanupConnection(portId);
        }
    }, PORT_TIMEOUT);

    // Store connection info
    activeConnections.set(portId, {
        port,
        timeoutId,
        startTime: Date.now()
    });

    // Handle disconnection
    port.onDisconnect.addListener(() => {
        cleanupConnection(portId);
    });

    // Message handler
    port.onMessage.addListener(async (message) => {
        try {
            console.log('Received port message:', {
                type: message.action,
                prompt: message.prompt?.slice(0, 50) + '...'
            });

            const connection = activeConnections.get(portId);
            if (!connection) {
                throw new Error('Connection not found');
            }

            // Handle the message based on type
            if (message.action === 'queryAPI') {
                const response = await handleApiRequest(message);
                if (connection.port) {
                    connection.port.postMessage(response);
                }
            } else {
                throw new Error('Unknown action type');
            }
        } catch (error) {
            if (port) {
                port.postMessage({
                    success: false,
                    error: error.message || 'Unknown error occurred'
                });
            }
        }
    });
});

function cleanupConnection(portId) {
    const connection = activeConnections.get(portId);
    if (connection) {
        clearTimeout(connection.timeoutId);
        try {
            connection.port.disconnect();
        } catch (e) {
            console.debug('Port already disconnected:', e);
        }
        activeConnections.delete(portId);
    }
}

// Helper functions for content script injection
async function injectContentScript(tabId) {
    try {
        // Check if the content script is already running
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => !!window.hoverBox
        });

        if (result?.result) {
            console.log('Content script already running');
            return true;
        }

        // If not injected, inject the required scripts
        await chrome.scripting.executeScript({
            target: { tabId },
            files: [
                'src/services/usage-tracker.js',
                'src/services/memory-service.js',
                'src/services/ai-service.js',
                'src/services/voice-service.js',
                'src/services/context-service.js',
                'src/services/model-delegation-service.js',
                'src/content/hover-box.js',
                'src/content/content.js'
            ]
        });

        console.log('Scripts injected successfully');
        return true;
    } catch (error) {
        console.error('Script injection failed:', error);
        return false;
    }
}

async function handleToggleSidebar(tabId) {
    try {
        console.debug('Handling toggle sidebar for tab:', tabId);
        
        const tab = await chrome.tabs.get(tabId);
        if (!tab) {
            throw new Error('Tab not found');
        }

        if (tab.url.startsWith('chrome://')) {
            throw new Error('Cannot inject into chrome:// URLs');
        }

        // Inject scripts if needed
        const needsInjection = !injectedTabs.has(tabId);
        if (needsInjection) {
            const injected = await injectContentScript(tabId);
            if (!injected) {
                throw new Error('Failed to inject scripts');
            }
            injectedTabs.add(tabId);
        }

        // Send toggle message with retry and timeout
        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Toggle timeout'));
                    }, 5000);
                    
                    chrome.tabs.sendMessage(
                        tabId, 
                        { action: 'toggleHoverBox', timestamp: Date.now() },
                        response => {
                            clearTimeout(timeout);
                            if (chrome.runtime.lastError) {
                                reject(chrome.runtime.lastError);
                            } else if (!response?.success) {
                                reject(new Error(response?.error || 'Toggle failed'));
                            } else {
                                resolve(response);
                            }
                        }
                    );
                });
                
                return true;
            } catch (error) {
                console.warn(`Toggle attempt ${i + 1} failed:`, error);
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, i), 8000)));
            }
        }
    } catch (error) {
        console.error('Toggle sidebar failed:', error);
        throw error;
    }
}

// Context menu setup
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'editWithAI',
        title: 'Ask about selection',
        contexts: ['selection']
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'editWithAI') {
        // First ensure scripts are injected
        if (!injectedTabs.has(tab.id)) {
            await injectContentScript(tab.id);
            injectedTabs.add(tab.id);
        }
        
        // Send selection to content script
        chrome.tabs.sendMessage(tab.id, {
            action: 'processSelection',
            selectedText: info.selectionText
        }).catch(error => {
            console.error('Error sending selection to content script:', error);
        });
    }
});

// Tab event handlers
chrome.tabs.onRemoved.addListener((tabId) => {
    injectedTabs.delete(tabId);
    
    // Clean up any active connections for this tab
    for (const [portId, connection] of activeConnections.entries()) {
        if (connection.port.sender?.tab?.id === tabId) {
            cleanupConnection(portId);
        }
    }
});

// Connection cleanup interval
setInterval(() => {
    const now = Date.now();
    for (const [portId, connection] of activeConnections.entries()) {
        if (now - connection.startTime > 35000) { // 35 seconds
            cleanupConnection(portId);
        }
    }
}, CLEANUP_INTERVAL);