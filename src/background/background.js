// Track tabs where scripts have been injected
const injectedTabs = new Set();

// Initialize API keys storage
let apiKeys = {
    claude: '',
    perplexity: ''
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
            if (apiKeys.claude && apiKeys.perplexity) {
                return true;
            }

            // Then try to get from storage
            const storedKeys = await chrome.storage.local.get(['claudeKey', 'perplexityKey']);
            if (storedKeys.claudeKey && storedKeys.perplexityKey) {
                apiKeys.claude = storedKeys.claudeKey;
                apiKeys.perplexity = storedKeys.perplexityKey;
                return true;
            }

            // Finally, load from files
            const claudeResponse = await fetch(chrome.runtime.getURL('apikey/claude.txt'));
            const perplexityResponse = await fetch(chrome.runtime.getURL('apikey/perplexity.txt'));
            
            if (!claudeResponse.ok || !perplexityResponse.ok) {
                throw new Error('Failed to load API keys from files');
            }
            
            apiKeys.claude = (await claudeResponse.text()).trim();
            apiKeys.perplexity = (await perplexityResponse.text()).trim();

            // Store in local storage for faster subsequent loads
            await chrome.storage.local.set({
                claudeKey: apiKeys.claude,
                perplexityKey: apiKeys.perplexity
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

async function handleApiKeyFailure() {
    // Clear any stored keys that might be invalid
    await chrome.storage.local.remove(['claudeKey', 'perplexityKey']);
    
    // Reset the memory keys
    apiKeys.claude = '';
    apiKeys.perplexity = '';
    
    // Notify all open tabs
    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
            action: 'apiKeyError',
            error: 'Service temporarily unavailable. Please try again later.'
        }).catch(() => {});
    });
}

async function ensureApiKeys() {
    if (!apiKeys.claude || !apiKeys.perplexity) {
        const storedKeys = await chrome.storage.local.get(['claudeKey', 'perplexityKey']);
        apiKeys.claude = storedKeys.claudeKey || '';
        apiKeys.perplexity = storedKeys.perplexityKey || '';

        if (!apiKeys.claude || !apiKeys.perplexity) {
            console.error('API keys are missing. Ensure they are set in Chrome storage.');
            return false;
        }
    }
    return true;
}

loadApiKeys();

async function handlePerplexityRequest(message, retryCount = 2) {
    const controller = new AbortController();
    // Add to handlePerplexityRequest system message
    const systemMessage = `You are a real-time information assistant. Format responses following these EXACT rules:

    For event listings or similar items:
    1. **[Event Name]**
    Location: [precise location]
    Date: [specific date]
    Time: [exact times]
    Price: [cost or "Free"]
    Description: [brief description]
    Additional listings in numbered list

    For recommendations or similar queries:
    1. **[Activity Name]** - [one-line description]
    - Location: [area/address]
    - When: [specific dates/times]
    - Cost: [price range or "Free"]
    Additional details in bullet points if needed
    Additional recommendations in numbered list

    For factual corrections:
    - Start with "Correction:" in bold
    - State the accurate information first
    - Explain what was incorrect
    - Provide source if available

    For real-time queries:
    - Always include current date context
    - Specify if information is verified current
    - Note any recent changes or updates
    - Include relevant timing details
    
    For general information:
    1. Use clear paragraphs
    2. Start with a brief overview
    3. Add specific details in subsequent paragraphs

    Special formatting:
    - Use **bold** only for titles and important info
    - Put details on separate lines with clear labels
    - Use bullet points for additional information
    - Include a summary paragraph at the end
    - Avoid nested lists or complex formatting

    Always include specific details when available:
    - Addresses
    - Hours
    - Prices
    - Recent reviews/ratings`;

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
                        content: systemMessage
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
                throw new Error(`API Error: ${response.status} - ${await response.text()}`);
            }

            const data = await response.json();
            clearTimeout(timeout);
            
            // Validate and clean response
            const responseText = data.choices?.[0]?.message?.content;
            if (!responseText) {
                throw new Error('Invalid response format from API');
            }

            // Format response
            const formattedResponse = formatResponse(responseText, 'perplexity');
            
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
                        text: formattedResponse 
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
                            text: `I apologize, but I couldn't process your request about "${message.prompt}". To get accurate information, you might want to:

                            1. Refresh the page and try again
                            2. Check if the webpage has finished loading
                            3. Ensure you're connected to the internet
                            4. Try rephrasing your question` 
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

function formatResponse(text, model = 'claude') {
    if (!text) return '';

    // First clean and standardize
    text = text
        .replace(/<[^>]*>/g, '')  // Remove HTML
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // Convert bold
        .replace(/[•*]\s/g, '- ')  // Standardize bullets
        .replace(/\n{3,}/g, '\n\n')  // Normalize breaks
        .trim();

    // Split into sections
    const sections = text.split(/\n\n+/);
    let formatted = [];
    let inList = false;
    let listType = null;

    sections.forEach(section => {
        const trimmedSection = section.trim();

        // Handle key-value headers (e.g., "Location: 123 Main St")
        const headerMatch = trimmedSection.match(/^([A-Z][^:]+):\s*(.+)$/m);
        if (headerMatch && !trimmedSection.includes('\n')) {
            if (inList) {
                formatted.push(listType === 'ol' ? '</ol>' : '</ul>');
                inList = false;
            }
            formatted.push(`<div class="info-row"><strong>${headerMatch[1]}:</strong> ${headerMatch[2]}</div>`);
            return;
        }

        // Handle numbered lists
        if (trimmedSection.match(/^\d+\./m)) {
            if (!inList || listType !== 'ol') {
                if (inList) formatted.push(listType === 'ol' ? '</ol>' : '</ul>');
                formatted.push('<ol class="numbered-list">');
                inList = true;
                listType = 'ol';
            }

            const items = trimmedSection.split(/(?=^\d+\.)/m).filter(i => i.trim());
            items.forEach(item => {
                const lines = item.split('\n').map(l => l.trim()).filter(l => l);
                if (lines.length > 0) {
                    formatted.push('<li>');
                    
                    // Handle the title line (remove number)
                    const titleLine = lines[0].replace(/^\d+\.\s*/, '');
                    formatted.push(titleLine);

                    // Handle details in a list item
                    if (lines.length > 1) {
                        formatted.push('<div class="details">');
                        lines.slice(1).forEach(line => {
                            const detailMatch = line.match(/^([^:]+):\s*(.+)$/);
                            if (detailMatch) {
                                formatted.push(`<div class="detail-row"><strong>${detailMatch[1]}:</strong> ${detailMatch[2]}</div>`);
                            } else if (line.startsWith('-')) {
                                if (!formatted.includes('<ul class="sub-list">')) {
                                    formatted.push('<ul class="sub-list">');
                                }
                                formatted.push(`<li>${line.substring(1).trim()}</li>`);
                            } else {
                                if (formatted.includes('<ul class="sub-list">')) {
                                    formatted.push('</ul>');
                                }
                                formatted.push(`<div class="description">${line}</div>`);
                            }
                        });
                        if (formatted.includes('<ul class="sub-list">')) {
                            formatted.push('</ul>');
                        }
                        formatted.push('</div>');
                    }
                    formatted.push('</li>');
                }
            });
        }
        // Handle bullet points
        else if (trimmedSection.match(/^[-•]/m)) {
            if (!inList || listType !== 'ul') {
                if (inList) formatted.push(listType === 'ol' ? '</ol>' : '</ul>');
                formatted.push('<ul class="bullet-list">');
                inList = true;
                listType = 'ul';
            }

            const items = trimmedSection.split(/^[-•]\s*/m).filter(i => i.trim());
            items.forEach(item => {
                const lines = item.split('\n').map(l => l.trim()).filter(l => l);
                if (lines.length > 0) {
                    formatted.push('<li>');
                    
                    // Check for key-value pair in first line
                    const keyValueMatch = lines[0].match(/^([^:]+):\s*(.+)$/);
                    if (keyValueMatch) {
                        formatted.push(`<div class="key-value"><strong>${keyValueMatch[1]}:</strong> ${keyValueMatch[2]}</div>`);
                    } else {
                        formatted.push(`<div class="item-title">${lines[0]}</div>`);
                    }

                    // Handle additional details
                    if (lines.length > 1) {
                        formatted.push('<div class="details">');
                        lines.slice(1).forEach(line => {
                            const detailMatch = line.match(/^([^:]+):\s*(.+)$/);
                            if (detailMatch) {
                                formatted.push(`<div class="detail-row"><strong>${detailMatch[1]}:</strong> ${detailMatch[2]}</div>`);
                            } else {
                                formatted.push(`<div class="detail-text">${line}</div>`);
                            }
                        });
                        formatted.push('</div>');
                    }
                    formatted.push('</li>');
                }
            });
        }
        // Regular paragraphs or sections
        else if (trimmedSection) {
            if (inList) {
                formatted.push(listType === 'ol' ? '</ol>' : '</ul>');
                inList = false;
            }
            
            // Check if it's a header-style section
            if (trimmedSection.match(/^[A-Z][^:]+:$/m)) {
                formatted.push(`<h3>${trimmedSection}</h3>`);
            } else {
                formatted.push(`<p>${trimmedSection}</p>`);
            }
        }
    });

    // Close any open lists
    if (inList) {
        formatted.push(listType === 'ol' ? '</ol>' : '</ul>');
    }

    return formatted.join('\n');
}

// Helper function to clean responses
function cleanResponse(text) {
    // Remove any existing HTML
    text = text.replace(/<[^>]*>/g, '');
    
    // Clean up common formatting issues
    text = text
        .replace(/^\d+\.\s+\d+\.\s+/, '') // Remove nested numbering
        .replace(/^[-•]\s*$\n/gm, '') // Remove empty bullets
        .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
        .trim();

    return text;
}

// In background.js, update handleClaudeRequest
async function handleClaudeRequest(message, retryCount = 2) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
        for (let i = 0; i < retryCount; i++) {
            try {
                await ensureApiKeys();
                const { prompt, context, isModelSelection } = message;

                // Modified system message for model selection
                const systemMessage = isModelSelection ?
                    `You are a classifier. For queries needing real-time data, respond "perplexity". For general knowledge, respond "claude". No other text.` :
                    `You are a helpful AI assistant. Format responses consistently:
                    - Use numbered lists for sequential items
                    - Use bullet points for non-sequential items
                    - Bold important terms with **text**
                    - Include specific details when available
                    - Structure information clearly with headers`;

                // Build messages array correctly for Claude API
                const messages = [];
                
                // Add system message first
                messages.push({
                    role: "assistant",
                    content: systemMessage
                });

                // Add context if available
                if (!isModelSelection && context?.visibleText) {
                    messages.push({
                        role: "user",
                        content: `Relevant webpage content: ${context.visibleText}`
                    });
                }

                // Add the actual prompt
                messages.push({
                    role: "user",
                    content: message.context?.contextString ? 
                        `Webpage Content:\n${message.context.contextString}\n\nQuestion: ${message.prompt}` :
                        message.prompt
                });

                const requestBody = {
                    model: "claude-3-sonnet-20240229",
                    messages: messages,
                    max_tokens: 4096,
                    temperature: isModelSelection ? 0.1 : 0.7,
                    system: systemMessage  // Add system message in correct location
                };

                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKeys.claude,
                        'anthropic-version': '2023-06-01',
                        'anthropic-dangerous-direct-browser-access': 'true' 
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Claude API Error (${response.status}): ${errorText}`);
                }

                const data = await response.json();
                
                // Process the response text
                let responseText = data.content[0].text;
                
                // Handle different response types
                if (isModelSelection) {
                    responseText = responseText.toLowerCase().trim();
                    if (!['claude', 'perplexity'].includes(responseText)) {
                        responseText = 'claude';
                    }
                } else {
                    responseText = formatResponse(responseText, 'claude');
                }

                return {
                    success: true,
                    data: {
                        content: [{ text: responseText }]
                    }
                };

            } catch (error) {
                console.error(`Claude request attempt ${i + 1} failed:`, error);
                // Extract the error message from the response if available
                let errorMessage = error.message;
                try {
                    const errorData = JSON.parse(error.message);
                    errorMessage = errorData.error?.message || errorMessage;
                } catch (e) {
                    // Keep original error message if parsing fails
                }
                
                if (i === retryCount - 1) {
                    throw new Error(`Claude API Error: ${errorMessage}`);
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

async function getUserId() {
    const result = await chrome.storage.local.get(['userId']);
    if (result.userId) {
        return result.userId;
    }
    const newUserId = 'user_' + Date.now();
    await chrome.storage.local.set({ userId: newUserId });
    return newUserId;
}

async function getConversationHistory(userId) {
    const result = await chrome.storage.local.get([`conversation_${userId}`]);
    return result[`conversation_${userId}`] || [];
}

async function storeConversation(userId, message, response) {
    const history = await getConversationHistory(userId);
    history.push({
        timestamp: Date.now(),
        message,
        response
    });
    
    // Keep only last 50 messages
    if (history.length > 50) {
        history.shift();
    }
    
    await chrome.storage.local.set({
        [`conversation_${userId}`]: history
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'openExtensionPopup' && message.forceOpen) {
        // Force open the popup
        chrome.action.openPopup()
            .catch(error => console.error('Failed to open popup:', error));
        sendResponse({ success: true });
        return true;
    }
    if (message.action === 'toggleSidebar') {
        handleToggleSidebar(message.tabId)
            .then(result => {
                sendResponse({ success: result });
                return true; // Keep message channel open
            })
            .catch(error => {
                console.error('Toggle sidebar failed:', error);
                sendResponse({ success: false, error: error.message });
                return true; // Keep message channel open
            });
        return true; // Required for async response
    }
    if (message.action === 'validateOpenAIKey') {
        validateOpenAIKey(message.key)
            .then(result => sendResponse({ success: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
    }
    
    if (message.action === 'transcribeAudio') {
        transcribeAudio(message.audio, message.key)
            .then(result => sendResponse({ success: true, text: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    return false;
});

async function transcribeAudio(base64Audio, key) {
    // Create form data
    const formData = new FormData();
    const blob = await fetch(`data:audio/webm;base64,${base64Audio}`).then(r => r.blob());
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${key}`
        },
        body: formData
    });

    if (!response.ok) {
        throw new Error(`Transcription failed: ${response.status}`);
    }

    const data = await response.json();
    return data.text;
}

async function withRetry(fn, maxRetries = 3) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
    throw lastError;
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'editWithAI',
        title: 'Edit with AI',
        contexts: ['selection']
    });
});

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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'editWithAI') {
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'editText',
            selectedText: info.selectionText
        });
    }
});

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
    const startTime = Date.now();
    let retryCount = 0;
    const MAX_RETRIES = 3;
    
    while (retryCount < MAX_RETRIES) {
        try {
            if (!message?.prompt) {
                throw new Error('Invalid request format');
            }

            // First determine the model if not already set
            const modelDecision = message.modelDecision || await aiService.delegationService.determineModelForQuery(message.prompt);
            
            // Get handler based on validated model decision
            const handler = modelDecision.model === 'perplexity' ? 
                handlePerplexityRequest : 
                handleClaudeRequest;

            // Process context
            const shouldIncludeContext = !message.isModelSelection && message.context?.visibleText;
            
            // Execute query with proper error handling
            const response = await handler({
                ...message,
                context: shouldIncludeContext ? message.context : {},
                modelDecision
            });
            
            // Track metrics with proper error handling
            try {
                const metricName = `${modelDecision.model}_success`;
                await updateMetrics(metricName);
                await updateMetrics('response_time', Date.now() - startTime);
            } catch (error) {
                console.warn('Metrics update failed but request succeeded:', error);
            }
            
            return response;

        } catch (error) {
            retryCount++;
            console.error(`API request error (attempt ${retryCount}):`, error);
            
            if (retryCount === MAX_RETRIES) {
                await logApiError({
                    model: message.modelDecision?.model || 'unknown',
                    error: error.message,
                    attempts: retryCount,
                    context: {
                        url: message.context?.url,
                        timestamp: Date.now()
                    }
                });
                
                throw error;
            }
            
            await new Promise(resolve => 
                setTimeout(resolve, Math.min(1000 * Math.pow(2, retryCount), 8000))
            );
        }
    }
}

async function handleModelQuery(prompt, context, modelDecision) {
    // Validate and normalize context
    const normalizedContext = await normalizeContext(context);
    
    // Get appropriate handler based on model
    const handler = modelDecision?.model === 'perplexity' ?
        handlePerplexityRequest :
        handleClaudeRequest;

    // Execute query
    const response = await handler({
        prompt,
        context: normalizedContext,
        modelDecision
    });

    return response;
}

async function normalizeContext(context) {
    if (!context || typeof context !== 'object') {
        return {};
    }

    // Ensure all expected fields are present
    return {
        url: context.url || window.location.href,
        title: context.title || document.title,
        visibleText: context.visibleText || '',
        selectedText: context.selectedText || '',
        timestamp: context.timestamp || Date.now()
    };
}

async function updateMetrics(metricName, value = 1) {
    try {
        // Get existing metrics or initialize if not exists
        const result = await chrome.storage.local.get(['api_metrics']);
        const metrics = {
            api_metrics: result.api_metrics || {
                request_count: 0,
                claude_success: 0,
                perplexity_success: 0,
                claude_error: 0,
                perplexity_error: 0,
                response_time: 0
            }
        };
        
        // Ensure the metric exists
        if (typeof metrics.api_metrics[metricName] === 'undefined') {
            metrics.api_metrics[metricName] = 0;
        }

        // Update the metric
        if (metricName === 'response_time') {
            // For response time, maintain an average
            const count = metrics.api_metrics.request_count || 1;
            metrics.api_metrics[metricName] = 
                (metrics.api_metrics[metricName] * (count - 1) + value) / count;
        } else {
            metrics.api_metrics[metricName] += value;
        }

        // Update request count
        metrics.api_metrics.request_count = (metrics.api_metrics.request_count || 0) + 1;

        // Store updated metrics
        await chrome.storage.local.set({ api_metrics: metrics.api_metrics });
        
        // Log success for debugging
        console.debug('Metrics updated successfully:', {
            metric: metricName,
            value,
            currentTotal: metrics.api_metrics[metricName]
        });

    } catch (error) {
        // Log error but don't throw - metrics are non-critical
        console.error('Failed to update metrics:', error);
    }
}

async function logApiError(errorData) {
    try {
        const errors = await chrome.storage.local.get(['api_errors']) || { api_errors: [] };
        errors.api_errors.push(errorData);

        // Keep last 100 errors
        if (errors.api_errors.length > 100) {
            errors.api_errors.shift();
        }

        await chrome.storage.local.set({ api_errors: errors.api_errors });
    } catch (error) {
        console.error('Failed to log API error:', error);
    }
}

async function cleanupMetrics() {
    try {
        const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
        const metrics = await chrome.storage.local.get(['api_metrics', 'api_errors']);
        
        // Clear errors older than a week
        if (metrics.api_errors) {
            metrics.api_errors = metrics.api_errors.filter(error => 
                new Date(error.timestamp) > new Date(Date.now() - ONE_WEEK)
            );
        }

        // Reset cumulative metrics weekly
        const lastReset = await chrome.storage.local.get(['metrics_last_reset']);
        if (!lastReset.metrics_last_reset || 
            Date.now() - lastReset.metrics_last_reset > ONE_WEEK) {
            
            metrics.api_metrics = {
                request_count: 0,
                claude_success: 0,
                perplexity_success: 0,
                claude_error: 0,
                perplexity_error: 0,
                response_time: 0
            };

            await chrome.storage.local.set({
                api_metrics: metrics.api_metrics,
                metrics_last_reset: Date.now()
            });
        }
    } catch (error) {
        console.error('Failed to cleanup metrics:', error);
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
                await Promise.race([
                    new Promise((resolve, reject) => {
                        chrome.tabs.sendMessage(
                            tabId, 
                            { action: 'toggleHoverBox', timestamp: Date.now() },
                            response => {
                                if (chrome.runtime.lastError) {
                                    reject(chrome.runtime.lastError);
                                } else if (!response?.success) {
                                    reject(new Error(response?.error || 'Toggle failed'));
                                } else {
                                    resolve(response);
                                }
                            }
                        );
                    }),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Toggle timeout')), 5000)
                    )
                ]);
                
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

    // Single message handler
    port.onMessage.addListener(async (message) => {
        try {
            console.debug('Received port message:', {
                type: message.action,
                modelDecision: message.modelDecision,
                prompt: message.prompt?.slice(0, 100) + '...'
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

chrome.tabs.onRemoved.addListener((tabId) => {
    injectedTabs.delete(tabId);
    // Clean up any active connections for this tab
    for (const [portId, connection] of activeConnections.entries()) {
        if (connection.port.sender?.tab?.id === tabId) {
            cleanupConnection(portId);
        }
    }
});

setInterval(() => {
    const now = Date.now();
    for (const [portId, connection] of activeConnections.entries()) {
        if (now - connection.startTime > 35000) { // 35 seconds
            cleanupConnection(portId);
        }
    }
}, 10000);