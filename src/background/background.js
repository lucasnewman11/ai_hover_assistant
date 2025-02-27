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

async function loadApiKeys(retryCount = 3) {
    for (let i = 0; i < retryCount; i++) {
        try {
            // First try to get from memory
            if (apiKeys.claude && apiKeys.perplexity && apiKeys.openai) {
                return true;
            }

            // Then try to get from storage
            const storedKeys = await chrome.storage.local.get(['claudeKey', 'perplexityKey', 'openaiKey']);
            if (storedKeys.claudeKey && storedKeys.perplexityKey) {
                apiKeys.claude = storedKeys.claudeKey;
                apiKeys.perplexity = storedKeys.perplexityKey;
                apiKeys.openai = storedKeys.openaiKey || '';
                return true;
            }

            // Finally, load from files
            const claudeResponse = await fetch(chrome.runtime.getURL('apikey/claude.txt'));
            const perplexityResponse = await fetch(chrome.runtime.getURL('apikey/perplexity.txt'));
            const openaiResponse = await fetch(chrome.runtime.getURL('apikey/openai.txt'));
            
            if (!claudeResponse.ok || !perplexityResponse.ok) {
                throw new Error('Failed to load API keys from files');
            }
            
            apiKeys.claude = (await claudeResponse.text()).trim();
            apiKeys.perplexity = (await perplexityResponse.text()).trim();
            
            // OpenAI key is optional for now
            if (openaiResponse.ok) {
                apiKeys.openai = (await openaiResponse.text()).trim();
            }

            // Store in local storage for faster subsequent loads
            await chrome.storage.local.set({
                claudeKey: apiKeys.claude,
                perplexityKey: apiKeys.perplexity,
                openaiKey: apiKeys.openai
            });
            
            return true;
        } catch (error) {
            console.error(`Error loading API keys (attempt ${i + 1}/${retryCount}):`, error);
            if (i === retryCount - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
    return false;
}

async function ensureApiKeys() {
    if (!apiKeys.claude || !apiKeys.perplexity) {
        const storedKeys = await chrome.storage.local.get(['claudeKey', 'perplexityKey', 'openaiKey']);
        apiKeys.claude = storedKeys.claudeKey || '';
        apiKeys.perplexity = storedKeys.perplexityKey || '';
        apiKeys.openai = storedKeys.openaiKey || '';

        if (!apiKeys.claude || !apiKeys.perplexity) {
            console.error('API keys are missing. Ensure they are set in Chrome storage.');
            return false;
        }
    }
    return true;
}

// Load API keys on startup
loadApiKeys();

async function handlePerplexityRequest(message, retryCount = 2) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

    for (let i = 0; i < retryCount; i++) {
        try {
            await ensureApiKeys();
            
            // Validate and process message
            if (!message?.prompt) {
                throw new Error('Invalid request: Missing prompt');
            }

            // Handle context
            let enhancedPrompt = message.prompt;
            if (message.context?.contextString) {
                enhancedPrompt = `Current Webpage Content:
                ${message.context.contextString}

                URL: ${message.context.url || 'Not provided'}
                Title: ${message.context.title || 'Not provided'}

                User Question: ${message.prompt}

                Instructions:
                1. Base your response primarily on the webpage content above
                2. Only include information that is explicitly present in the content
                3. Format your response clearly and directly`;
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
                        content: enhancedPrompt
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
            
            // Validate and clean response
            const responseText = data.choices?.[0]?.message?.content;
            if (!responseText) {
                throw new Error('Invalid response format from API');
            }
            
            // Log success for monitoring
            console.debug('Perplexity request successful', {
                promptLength: message.prompt.length,
                responseLength: responseText.length,
                hasContext: !!message.context?.contextString
            });

            return {
                success: true,
                data: { 
                    content: [{ 
                        text: responseText 
                    }] 
                }
            };

        } catch (error) {
            console.error(`Perplexity API error (attempt ${i + 1}/${retryCount}):`, error);
            
            if (i === retryCount - 1) {
                // Return graceful fallback on final retry
                return {
                    success: true,
                    data: { 
                        content: [{ 
                            text: `I apologize, but I couldn't process your request. Please try again later.` 
                        }] 
                    }
                };
            }
            
            // Exponential backoff before retry
            await new Promise(resolve => 
                setTimeout(resolve, Math.min(1000 * Math.pow(2, i), 8000))
            );
        } finally {
            // Cleanup
            if (timeout) clearTimeout(timeout);
        }
    }
}

async function handleClaudeRequest(message, retryCount = 2) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
        for (let i = 0; i < retryCount; i++) {
            try {
                await ensureApiKeys();
                const { prompt, context } = message;

                // Build messages array for Claude API
                const messages = [];
                
                // Add context if available
                if (context?.contextString) {
                    messages.push({
                        role: "user",
                        content: `Webpage Content:\n${context.contextString}\n\nQuestion: ${prompt}`
                    });
                } else {
                    messages.push({
                        role: "user",
                        content: prompt
                    });
                }

                const requestBody = {
                    model: "claude-3-sonnet-20240229",
                    messages: messages,
                    max_tokens: 4096,
                    temperature: 0.7,
                    system: "You are a helpful AI assistant providing information about the current webpage."
                };

                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKeys.claude,
                        'anthropic-version': '2023-06-01'
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Claude API Error (${response.status}): ${errorText}`);
                }

                const data = await response.json();
                const responseText = data.content[0].text;

                return {
                    success: true,
                    data: {
                        content: [{ text: responseText }]
                    }
                };

            } catch (error) {
                console.error(`Claude request attempt ${i + 1} failed:`, error);
                
                if (i === retryCount - 1) {
                    throw new Error(`Claude API Error: ${error.message}`);
                }
                
                await new Promise(resolve => 
                    setTimeout(resolve, Math.min(Math.pow(2, i) * 1000, 8000))
                );
            }
        }
        
        throw new Error('All retry attempts failed');

    } finally {
        clearTimeout(timeout);
    }
}

async function handleOpenAIRequest(message, retryCount = 2) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
        for (let i = 0; i < retryCount; i++) {
            try {
                await ensureApiKeys();
                
                if (!apiKeys.openai) {
                    throw new Error('OpenAI API key not configured');
                }
                
                const { prompt, context } = message;

                let enhancedPrompt = prompt;
                if (context?.contextString) {
                    enhancedPrompt = `Webpage Content:\n${context.contextString}\n\nQuestion: ${prompt}`;
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
                                content: enhancedPrompt
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
                console.error(`OpenAI request attempt ${i + 1} failed:`, error);
                
                if (i === retryCount - 1) {
                    throw new Error(`OpenAI API Error: ${error.message}`);
                }
                
                await new Promise(resolve => 
                    setTimeout(resolve, Math.min(Math.pow(2, i) * 1000, 8000))
                );
            }
        }
        
        throw new Error('All retry attempts failed');

    } finally {
        clearTimeout(timeout);
    }
}

async function transcribeAudio(base64Audio, key) {
    // Create form data
    const formData = new FormData();
    const blob = await fetch(`data:audio/webm;base64,${base64Audio}`).then(r => r.blob());
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${key || apiKeys.openai}`
        },
        body: formData
    });

    if (!response.ok) {
        throw new Error(`Transcription failed: ${response.status}`);
    }

    const data = await response.json();
    return data.text;
}

async function validateOpenAIKey(key) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`OpenAI API validation failed: ${response.status}`);
            return false;
        }

        const data = await response.json();
        return Array.isArray(data.data);
    } catch (error) {
        console.error('OpenAI key validation error:', error);
        return false;
    }
}

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

        // If not injected, inject the required scripts in order
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

        // Inject CSS
        await chrome.scripting.insertCSS({
            target: { tabId },
            files: ['src/content/content.css']
        });

        console.log('Scripts injected successfully');
        return true;
    } catch (error) {
        console.error('Script injection failed:', error);
        return false;
    }
}

async function handleApiRequest(message) {
    try {
        if (!message?.prompt) {
            throw new Error('Invalid request format');
        }

        const model = message.model || 'claude';
        
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
        const response = await handler(message);
        
        // Track success
        await updateMetrics(`${model}_success`);
        
        return response;
    } catch (error) {
        console.error('API request error:', error);
        
        // Track error
        await updateMetrics(`${message.model || 'claude'}_error`);
        
        // Return graceful error response
        return {
            success: false,
            error: error.message || 'Unknown error occurred'
        };
    }
}

async function updateMetrics(metricName, value = 1) {
    try {
        // Get existing metrics or initialize if not exists
        const result = await chrome.storage.local.get(['api_metrics']);
        const metrics = result.api_metrics || {
            request_count: 0,
            claude_success: 0,
            perplexity_success: 0,
            openai_success: 0,
            claude_error: 0,
            perplexity_error: 0,
            openai_error: 0,
            response_time: 0
        };
        
        // Ensure the metric exists
        if (typeof metrics[metricName] === 'undefined') {
            metrics[metricName] = 0;
        }

        // Update the metric
        if (metricName === 'response_time') {
            // For response time, maintain an average
            const count = metrics.request_count || 1;
            metrics[metricName] = 
                (metrics[metricName] * (count - 1) + value) / count;
        } else {
            metrics[metricName] += value;
        }

        // Update request count for non-time metrics
        if (metricName !== 'response_time') {
            metrics.request_count = (metrics.request_count || 0) + 1;
        }

        // Store updated metrics
        await chrome.storage.local.set({ api_metrics: metrics });
    } catch (error) {
        console.error('Failed to update metrics:', error);
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

// Event Listeners

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'openExtensionPopup') {
        // Force open the popup
        chrome.action.openPopup()
            .catch(error => console.error('Failed to open popup:', error));
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === 'toggleSidebar') {
        handleToggleSidebar(message.tabId || sender.tab.id)
            .then(result => sendResponse({ success: result }))
            .catch(error => sendResponse({ 
                success: false, 
                error: error.message 
            }));
        return true; // Keep message channel open for async response
    }
    
    if (message.action === 'validateOpenAIKey') {
        validateOpenAIKey(message.key)
            .then(result => sendResponse({ success: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open
    }
    
    if (message.action === 'transcribeAudio') {
        transcribeAudio(message.audio, message.key)
            .then(result => sendResponse({ success: true, text: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open
    }
    
    if (message.action === 'updateAPIKey') {
        // Update API key
        const keyType = message.keyType;
        const key = message.key;
        
        if (!keyType || !key) {
            sendResponse({ success: false, error: 'Missing key type or key' });
            return true;
        }
        
        // Store in memory
        apiKeys[keyType] = key;
        
        // Store in storage
        chrome.storage.local.set({ [`${keyType}Key`]: key })
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ 
                success: false, 
                error: error.message 
            }));
        return true;
    }
    
    if (message.action === 'queryAPI') {
        handleApiRequest(message)
            .then(response => sendResponse(response))
            .catch(error => sendResponse({ 
                success: false, 
                error: error.message 
            }));
        return true; // Keep channel open
    }
    
    // Default response for unknown actions
    sendResponse({ success: false, error: `Unknown action: ${message.action}` });
    return false;
});

chrome.runtime.onConnect.addListener((port) => {
    const portId = port.name;
    
    // Create timeout handler
    const timeoutId = setTimeout(() => {
        try {
            const connection = activeConnections.get(portId);
            if (connection?.port) {
                connection.port.postMessage({ 
                    success: false, 
                    error: 'Request timed out' 
                });
            }
        } finally {
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
            console.debug('Received port message:', {
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

// Connection cleanup interval
setInterval(() => {
    const now = Date.now();
    for (const [portId, connection] of activeConnections.entries()) {
        if (now - connection.startTime > 35000) { // 35 seconds
            cleanupConnection(portId);
        }
    }
}, CLEANUP_INTERVAL);