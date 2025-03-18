class AIService {
    constructor() {
        this.messageQueue = Promise.resolve();
        this.pendingRequests = new Map();
        this.memoryService = new window.MemoryService();
        this.delegationService = new window.ModelDelegationService(this);
        this.initPromise = this.initialize();
        this.requestTimeouts = new Map();
        this.stats = {
            claudeResponses: 0,
            perplexityResponses: 0,
            errors: 0
        };
    }

    async initialize() {
        try {
            // Wait for all required services
            await Promise.all([
                this.memoryService.initPromise,
                this.verifyAPIAccess()
            ]);

            // Initialize delegation service
            this.delegationService = new ModelDelegationService(this);

            return true;
        } catch (error) {
            console.error('AI Service initialization failed:', error);
            return false;
        }
    }

    async verifyAPIAccess() {
        // Verify API access and keys
        const apis = ['claude', 'perplexity'];
        console.log('Verifying API access for:', apis.join(', '));
        
        const results = await Promise.all(
            apis.map(api => this.testAPIAccess(api))
        );
        
        if (results.some(result => !result)) {
            console.error('API access verification failed for one or more services');
            throw new Error('API access verification failed. Please check your API keys.');
        }
        
        console.log('API access verification successful for all services');
    }

    async testAPIAccess(api) {
        try {
            // Verify the API key is available through the background service
            console.log(`Testing API access for ${api}...`);
            
            const validationResult = await this.isApiKeyValid(api);
            console.log(`API key validation for ${api}: ${validationResult ? 'Success' : 'Failed'}`);
            
            return validationResult;
        } catch (error) {
            console.error(`${api} API test failed:`, error);
            return false;
        }
    }
    
    async isApiKeyValid(model) {
        console.log(`Validating API key for model: ${model}`);
        
        if (!model) {
            console.error('Model parameter is required');
            return false;
        }
        
        // Send validation request to background script
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'validateAPIKey',
                model: model
            });
            
            return response?.success === true;
        } catch (error) {
            console.error(`API key validation failed for ${model}:`, error);
            return false;
        }
    }

    async determineModelForQuery(prompt, context) {
        const lowercasePrompt = prompt.toLowerCase().trim();
    
        // 1. Event lookup patterns - Check these first
        const eventPatterns = [
            /when is .* this year/i,
            /lookup .* event/i,
            /schedule for .*/i,
            /dates? for .*/i,
            /time[s]? for .*/i
        ];
    
        if (eventPatterns.some(pattern => pattern.test(prompt))) {
            return {
                model: 'perplexity',
                useWebpageContext: false,
                reasoning: 'Event lookup query'
            };
        }
    
        // 2. Location detection - More flexible pattern
        const locationPattern = /\b(?:in|at|near|around)\s+([A-Za-z\s]+(?:,\s*[A-Za-z\s]+)?)\b/i;
        const hasLocation = locationPattern.test(prompt);
    
        // 3. Expanded real-time keywords
        const realTimeKeywords = [
            'recommend', 'pizza', 'restaurant', 'cafe', 'bar', 'food',
            'near', 'open', 'current', 'today', 'weather', 'price',
            'available', 'location', 'address', 'weekend', 'tonight', 
            'event', 'happening', 'things to do', 'what\'s on', 
            'activities', 'tomorrow', 'upcoming', 'this week', 
            'next week', 'show', 'playing', 'screening', 'showing',
            'hours', 'time', 'schedule', 'booking'
        ];
    
        // 4. Keep existing event keywords for backward compatibility
        const eventKeywords = [
            'this weekend', 'tonight', 'today',
            'things to do', 'activities', 'events',
            'what\'s happening', 'going on'
        ];
    
        // 5. Check for location + event keywords
        if (hasLocation && eventKeywords.some(kw => lowercasePrompt.includes(kw))) {
            return {
                model: 'perplexity',
                useWebpageContext: false,
                reasoning: 'Query requires current local event information'
            };
        }
    
        // 6. Check for location + real-time keywords
        if (hasLocation && realTimeKeywords.some(kw => lowercasePrompt.includes(kw.toLowerCase()))) {
            return {
                model: 'perplexity',
                useWebpageContext: false,
                reasoning: 'Query requires current local information'
            };
        }
    
        // 7. Handle standalone real-time queries
        const hasRealTimeKeyword = realTimeKeywords.some(kw => 
            lowercasePrompt.includes(kw.toLowerCase())
        );
    
        if (hasRealTimeKeyword && 
            !lowercasePrompt.startsWith('what is') && 
            !lowercasePrompt.startsWith('how does')) {
            return {
                model: 'perplexity',
                useWebpageContext: false,
                reasoning: 'Real-time information query'
            };
        }
    
        // 8. Keep existing company info logic
        const companyInfoPatterns = [
            /who (?:runs|owns|started|founded|leads|manages|operates)/i,
            /founder|ceo|owner|president|director/i,
            /when (?:was|did).*(?:found|start|begin|establish)/i,
            /company leadership|management team/i
        ];
    
        const isCompanyInfoQuery = companyInfoPatterns.some(pattern => pattern.test(prompt));
        
        if (isCompanyInfoQuery && context?.visibleText) {
            const relevance = this.calculateContextRelevance(prompt, context.visibleText);
            if (relevance < 0.3) {
                return {
                    model: 'perplexity',
                    useWebpageContext: false,
                    reasoning: 'Company information query requiring external search'
                };
            }
        }
    
        // 9. Check webpage-specific queries
        if (this.isWebpageQuery(prompt)) {
            return {
                model: 'perplexity',
                useWebpageContext: true,
                reasoning: 'Query is about current webpage'
            };
        }
    
        // 10. Basic greeting check - only exact matches
        const basicQueries = [
            'hello', 'hi', 'hey', 'good morning', 'good afternoon', 
            'good evening', 'help', 'what can you do'
        ];
        
        if (basicQueries.includes(lowercasePrompt)) {
            return {
                model: 'claude',
                useWebpageContext: false,
                reasoning: 'Basic greeting'
            };
        }
    
        // Default to Claude
        return {
            model: 'claude',
            useWebpageContext: false,
            reasoning: 'General knowledge query'
        };
    }

    async processWebContext(context) {
        if (!context?.visibleText) return {};
    
        return {
            url: context.url,
            title: context.title,
            content: context.visibleText,
            metadata: context.metadata || {}
        };
    }

    enhancePromptWithDateContext(prompt) {
        const currentDate = new Date();
        const dayOfWeek = currentDate.getDay();
        const daysToWeekend = 6 - dayOfWeek; // Days until next weekend
    
        return `Current date: ${currentDate.toISOString().split('T')[0]}
        Next weekend dates: ${this.getUpcomingWeekendDates()}
        
        User query: ${prompt}
        
        Important:
        - Today is ${currentDate.toLocaleString()}
        - If events happened in the past, clearly state they are past events
        - For future events, verify they are actually upcoming
        - For weekend recommendations, focus on ${daysToWeekend <= 0 ? 'next' : 'this'} weekend`;
    }
    
    getUpcomingWeekendDates() {
        const today = new Date();
        const friday = new Date(today);
        friday.setDate(today.getDate() + ((5 - today.getDay() + 7) % 7));
        const sunday = new Date(friday);
        sunday.setDate(friday.getDate() + 2);
        return `${friday.toLocaleDateString()} - ${sunday.toLocaleDateString()}`;
    }

    isWebpageQuery(prompt) {
    const lowercasePrompt = prompt.toLowerCase();
    
    // Explicit webpage references
    const explicitTerms = [
        'this page',
        'this website',
        'this site',
        'this company',
        'the page',
        'the website',
        'the company',
        'this webpage'
    ];
    
    // Contextual webpage references
    const contextualTerms = [
        'what does',
        'tell me about',
        'explain',
        'describe'
    ];
    
    return explicitTerms.some(term => lowercasePrompt.includes(term)) ||
        (contextualTerms.some(term => lowercasePrompt.includes(term)) && 
         lowercasePrompt.includes('this'));
    }

    getDefaultDecision(prompt) {
        // Check for common real-time query indicators
        const realTimeKeywords = [
            'recommend', 'restaurant', 'near', 'open',
            'current', 'today', 'weather', 'price',
            'available', 'location', 'address'
        ];
        
        const needsRealTime = realTimeKeywords.some(keyword => 
            prompt.toLowerCase().includes(keyword)
        );
        
        return {
            model: needsRealTime ? 'perplexity' : 'claude',
            useWebpageContext: false,
            reasoning: 'Fallback decision based on query keywords'
        };
    }

    validateModelDecision(modelDecision) {
        try {
            const decision = modelDecision.toLowerCase().trim();
            return ['claude', 'perplexity'].includes(decision) ? decision : 'claude';
        } catch (error) {
            console.warn('Model validation error:', error);
            return 'claude';
        }
    }

    async logModelDecision(data) {
        try {
            const decisions = await chrome.storage.local.get(['model_decisions']) || { model_decisions: [] };
            decisions.model_decisions.push(data);
            
            // Keep last 1000 decisions
            if (decisions.model_decisions.length > 1000) {
                decisions.model_decisions.shift();
            }

            await chrome.storage.local.set({ model_decisions: decisions.model_decisions });
        } catch (error) {
            console.error('Failed to log model decision:', error);
        }
    }

    async logError(type, error) {
        try {
            const errors = await chrome.storage.local.get(['error_log']) || { error_log: [] };
            errors.error_log.push({
                type,
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            // Keep last 100 errors
            if (errors.error_log.length > 100) {
                errors.error_log.shift();
            }

            await chrome.storage.local.set({ error_log: errors.error_log });
        } catch (logError) {
            console.error('Failed to log error:', logError);
        }
    }

    getResponseStats() {
        return {
            ...this.stats,
            ratio: this.stats.claudeResponses / 
                (this.stats.perplexityResponses || 1)
        };
    }
    
    async preprocessWebpageContent(context) {
        if (!context?.visibleText) return '';
    
        try {
            // Clean and normalize text
            let cleaned = context.visibleText
                .replace(/\s+/g, ' ')
                .replace(/[^\w\s.,?!-]/g, '')
                .trim();
    
            // Limit length while preserving meaning
            if (cleaned.length > 2000) {
                const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [];
                cleaned = sentences
                    .slice(0, 10)
                    .join(' ')
                    .trim();
                cleaned += '... [truncated]';
            }
    
            return cleaned;
    
        } catch (error) {
            console.error('Error preprocessing webpage content:', error);
            return '';
        }
    }

    async queryHybrid(prompt, context = {}, requestId) {
        try {
            // 1. First, get raw data from Perplexity
            const perplexityPrompt = `${prompt}\nProvide detailed, factual information. Include specific details like names, addresses, ratings, and any relevant current data.`;
            const perplexityResponse = await this.queryPerplexity(perplexityPrompt, context, requestId);
    
            if (!perplexityResponse?.text) {
                return {
                    text: "I couldn't retrieve real-time data, but here's my best answer based on what I know:\n\n" +
                          await this.queryClaude(prompt, context, false).text,
                    model: 'Claude (fallback)'
                };
            }            
    
            // 2. Then have Claude format and enhance the response
            const formattingPrompt = `I have raw data about "${prompt}" that needs to be formatted into a clear, well-organized response. 
    Here's the raw data:
    ${perplexityResponse.text}
    
    Please format this information into a clear, helpful response that:
    1. Organizes the information logically
    2. Highlights the most relevant details
    3. Makes it easy to understand and act on
    4. Adds any relevant context or tips
    
    Format the response in a user-friendly way, but don't add any information that wasn't in the original data.`;
    
            const claudeResponse = await this.queryClaude(formattingPrompt, {}, false);
    
            return {
                text: claudeResponse.text,
                model: 'hybrid (Perplexity + Claude)',
                originalData: perplexityResponse.text
            };
        } catch (error) {
            console.error('Hybrid query error:', error);
            throw error;
        }
    }

    calculateContextRelevance(prompt, contextText) {
        const promptWords = new Set(prompt.toLowerCase().split(/\W+/).filter(w => w.length > 3));
        const contextWords = new Set(contextText.toLowerCase().slice(0, 1000).split(/\W+/).filter(w => w.length > 3));
        
        let matches = 0;
        for (const word of promptWords) {
            if (contextWords.has(word)) matches++;
        }
        
        return matches / promptWords.size;
    }

    async optimizeQuery(prompt, targetModel) {
        try {
            // Different optimization prompts based on the model
            const optimizationPrompt = targetModel === 'perplexity' ?
                `Rewrite this query to get the best real-time information:
    Original: "${prompt}"
    
    Make it explicitly ask for current, up-to-date information. Include:
    1. Clear location details
    2. Specific request for current/active businesses
    3. Ask for important details like ratings, hours, contact info
    4. Emphasize needing recent/verified information
    
    Respond with ONLY the rewritten query.` :
                `Rewrite this query for analytical response:
    Original: "${prompt}"
    
    Optimize for:
    1. Clear analytical requirements
    2. Specific format requests
    3. Explicit constraints
    4. Context requirements
    
    Respond with ONLY the rewritten query.`;
    
            const response = await this.queryClaude(optimizationPrompt, {}, true);
            return response?.text?.trim() || prompt;
        } catch (error) {
            console.error('Query optimization failed:', error);
            return prompt;
        }
    }

    async queryByModel(prompt, context = {}, model = null) {
        try {
            await this.initPromise;
            
            // Process context first
            const processedContext = await this.processContext(context, prompt);
            
            // Determine model using local logic first
            let modelToUse = 'claude'; // Default model
            let finalPrompt = prompt;
    
            // Check for basic queries first (fast path)
            const basicQueries = ['hello', 'hi', 'hey', 'help'];
            if (basicQueries.includes(prompt.toLowerCase().trim())) {
                return {
                    text: "Hi! I'm your AI assistant. How can I help you today?",
                    model: 'claude'
                };
            }
    
            // Company/Organization Information Patterns
            const companyInfoPatterns = [
                /who (?:runs|owns|started|founded|leads|manages|operates)/i,
                /founder|ceo|owner|president|director/i,
                /when (?:was|did).*(?:found|start|begin|establish)/i,
                /company leadership|management team/i,
                /about the company|company information/i
            ];
    
            const isCompanyInfoQuery = companyInfoPatterns.some(pattern => pattern.test(prompt));
    
            // If it's a company info query, use Perplexity to get current data
            if (isCompanyInfoQuery) {
                modelToUse = 'perplexity';
                finalPrompt = `Find current, accurate information about: ${prompt}
                When searching, focus on ${context.url || 'the company'}.
                Include specific details about leadership, founding, and company structure.`;
            }
            // Check for webpage content analysis
            else if (processedContext.useContext) {
                finalPrompt = `Analyze this webpage content and answer the following question:
    Content:
    ${processedContext.contextString}
    Question: ${prompt}
    Provide a detailed response based only on the webpage content above.`;
                modelToUse = 'claude';
            } else {
                // Real-time indicators check
                const realTimeKeywords = [
                    'current', 'now', 'today', 'tonight', 'weather',
                    'open', 'hours', 'price', 'near', 'location',
                    'restaurant', 'store', 'shop', 'movie', 'showing'
                ];
                
                const hasLocation = /\b(?:in|at|near|around)\s+([A-Za-z\s]+(?:,\s*[A-Za-z\s]+)?)\b/i.test(prompt);
                
                if (hasLocation && realTimeKeywords.some(keyword => 
                    prompt.toLowerCase().includes(keyword))) {
                    modelToUse = 'perplexity';
                    finalPrompt = `Find current, accurate information about: ${prompt}
                    Include specific details like addresses, hours, ratings, and prices if applicable.`;
                }
            }
    
            console.debug('Query execution details:', {
                model: modelToUse,
                isCompanyQuery: isCompanyInfoQuery,
                useContext: processedContext.useContext,
                promptLength: finalPrompt.length
            });
    
            const queryMessage = {
                action: 'queryAPI',
                prompt: finalPrompt,
                context: processedContext,
                modelDecision: {
                    model: modelToUse,
                    isHybrid: false,
                    useContext: processedContext.useContext
                }
            };
    
            const response = await this.sendMessageWithRetry(queryMessage);
            if (!response.success) {
                throw new Error(`Query failed: ${response.error || 'Unknown error'}`);
            }
    
            return {
                text: this.formatResponse(response.data.content[0].text),
                model: modelToUse
            };
    
        } catch (error) {
            console.error('Query error:', error);
            // Fallback to Claude for errors
            if (!error.message.includes('Query failed')) {
                return this.queryClaude(prompt, {}, false);
            }
            throw error;
        }
    }

    cleanHtmlTags(text) {
        if (!text) return '';
        return text
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/&[^;]+;/g, '') // Remove HTML entities
            .trim();
    }

    // Add response formatting method
    formatResponse(text) {
        if (!text) return '';
        
        // First clean HTML but preserve bold marks
        text = text
            .replace(/<[^>]*>/g, '')  // Remove HTML
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // Convert bold
            .replace(/•/g, '•'); // Normalize bullets
        
        // Split into sections
        const sections = text.split(/\n\n+/);
        let formatted = [];
        
        sections.forEach(section => {
            if (section.trim().startsWith('1.')) {
                // Numbered list section
                const items = section.split(/(?=\d+\.)/);
                formatted.push('<div class="event-list">');
                items.forEach(item => {
                    if (!item.trim()) return;
                    
                    const [title, ...details] = item.split('\n');
                    const titleMatch = title.match(/\d+\.\s*(.+)/);
                    if (!titleMatch) return;
                    
                    formatted.push('<div class="event-item">');
                    formatted.push(`<h3>${titleMatch[1]}</h3>`);
                    
                    const detailsHtml = details
                        .map(detail => {
                            const labelMatch = detail.match(/^\s*(Location|Date|Time|Price|Cost|When):\s*(.+)/i);
                            if (labelMatch) {
                                return `<div class="event-detail"><strong>${labelMatch[1]}:</strong> ${labelMatch[2]}</div>`;
                            }
                            return `<div class="event-description">${detail.trim()}</div>`;
                        })
                        .join('\n');
                    
                    formatted.push(detailsHtml);
                    formatted.push('</div>');
                });
                formatted.push('</div>');
            } else if (section.match(/^[-•]/m)) {
                // Bullet list
                const items = section.split(/^[-•]\s*/m).filter(i => i.trim());
                formatted.push('<ul>');
                items.forEach(item => formatted.push(`<li>${item.trim()}</li>`));
                formatted.push('</ul>');
            } else {
                // Regular paragraph
                formatted.push(`<p>${section.trim()}</p>`);
            }
        });
        
        return formatted.join('\n');
    }
    
    // Helper method to format list item content
    formatListItemContent(content) {
        // Look for and format location/time/price info within list items
        const parts = content.split(/(?=\s+(?:Location|Price|Time|Dates?|Hours?):\s+)/i);
        
        if (parts.length > 1) {
            // First part is the main content, rest are info pieces
            const mainContent = parts[0].trim();
            const infoPieces = parts.slice(1).map(piece => {
                const match = piece.match(/^\s*(Location|Price|Time|Dates?|Hours?):\s+(.+)/i);
                return match ? `<br><strong>${match[1]}:</strong> ${match[2]}` : piece;
            });
            
            return mainContent + infoPieces.join('');
        }
        
        return content;
    }

    shouldStartList(line, allLines) {
        // Check if this line might be the start of an implicit list
        const nextLine = allLines[allLines.indexOf(line) + 1];
        if (!nextLine) return false;

        // Check for common list patterns
        const listIndicators = [
            'First',
            'To start',
            'Begin by',
            'Here are',
            'Some',
            'The following'
        ];

        return listIndicators.some(indicator => 
            line.toLowerCase().includes(indicator.toLowerCase())
        );
    }

    formatClaudePrompt(payload) {
        if (payload.webpage_snippet) {
            return `Context from webpage:\n${payload.webpage_snippet}\n\nQuery: ${payload.query}`;
        }
        return payload.query;
    }

    async processContext(context, prompt) {
        if (!context?.visibleText || !prompt) {
            return { 
                useContext: false, 
                contextString: '',
                url: context?.url || '',
                title: context?.title || ''
            };
        }
    
        // Clean and prepare the context
        const cleanContext = context.visibleText
            .replace(/\s+/g, ' ')
            .slice(0, 5000)
            .trim();
    
        // Build rich context string with proper structure
        const contextString = [
            `Current webpage content:`,
            cleanContext,
            `\nURL: ${context.url || 'Not provided'}`,
            `Title: ${context.title || 'Not provided'}`
        ].filter(Boolean).join('\n');
    
        // We should always use context when available and the query is about the webpage
        const isWebpageQuery = prompt.toLowerCase().includes('webpage') || 
            prompt.toLowerCase().includes('this page') ||
            prompt.toLowerCase().includes('company') ||
            prompt.toLowerCase().includes('website');
    
        return {
            useContext: isWebpageQuery, // Only use context for webpage queries
            contextString,
            url: context.url,
            title: context.title,
            metadata: context.metadata || {}
        };
    }

    async queryPerplexity(prompt, context = {}, requestId) {
        try {
            // Only process context if there is context and it's meant to be used
            const shouldUseContext = Object.keys(context).length > 0;
            const fullPrompt = shouldUseContext ?
                `Question: ${prompt}\n\nRelevant webpage content: ${context.visibleText || ''}`
                : prompt;
    
            const response = await this.sendMessageWithRetry({
                action: 'queryAPI',
                model: 'perplexity',
                prompt: fullPrompt,
                context: shouldUseContext ? context : {},
                requestId: requestId
            });
    
            if (!response?.success) {
                throw new Error(response?.error || 'API request failed');
            }
    
            const responseText = response.data?.content?.[0]?.text;
            if (!responseText) {
                throw new Error('Invalid API response format');
            }
    
            await this.memoryService.storeConversation(prompt, responseText, 'perplexity');
    
            return {
                text: responseText,
                model: 'perplexity'
            };
        } catch (error) {
            console.error('Perplexity API error:', error);
            throw new Error(`Perplexity API error: ${error.message || 'Failed to fetch response'}`);
        }
    }
    
    async queryClaude(prompt, context = {}, isRoutingQuery = false) {
        try {
            // First validate that the API key exists and is properly formatted
            const isKeyValid = await this.isApiKeyValid('claude');
            if (!isKeyValid) {
                throw new Error('Claude API key is invalid or not set. Please check your API key in the extension settings.');
            }
            
            // For routing queries, never use context
            const shouldUseContext = !isRoutingQuery && Object.keys(context).length > 0;
            
            // Different system messages based on query type
            const systemMessage = isRoutingQuery ? 
                `You are a query router. Determine if this query needs real-time web information (PERPLEXITY) or can be answered with built-in knowledge (CLAUDE).` :
                "You are a helpful AI assistant. Provide accurate, focused answers. If given webpage context, use it appropriately. Keep responses clear and direct.";
    
            const fullPrompt = shouldUseContext ?
                `Webpage content: ${context.visibleText || ''}\n\nQuestion: ${prompt}` :
                prompt;
            
            // Log the request details for debugging
            console.log('Sending Claude API request with parameters:', {
                model: 'claude',
                hasContext: shouldUseContext,
                promptLength: fullPrompt.length,
                isRoutingQuery
            });
    
            const response = await this.sendMessageWithRetry({
                action: 'queryAPI',
                model: 'claude',
                prompt: fullPrompt,
                context: shouldUseContext ? context : {},
                requestId: Date.now().toString(),
                system: systemMessage,
                temperature: isRoutingQuery ? 0.1 : 0.7
            });
    
            if (!response?.success) {
                throw new Error(response?.error || 'API request failed');
            }
    
            const responseText = response.data?.content?.[0]?.text;
            if (!responseText) {
                throw new Error('Invalid API response format');
            }
    
            // Don't store routing queries in conversation history
            if (!isRoutingQuery) {
                await this.memoryService.storeConversation(prompt, responseText, 'claude');
            }
    
            return {
                text: responseText,
                model: 'claude',
                isRoutingQuery
            };
        } catch (error) {
            console.error('Claude API error:', error);
            throw error;
        }
    }
    
    async getStoredConversations() { // <-- Ensure function is async
        const sessionId = await this.getSessionId();
        const key = `conversation_${sessionId}`;
        let history = await chrome.storage.local.get([key]);
        return history[key] || [];
    }
    
    async storeConversation(prompt, response, model) { // <-- Ensure function is async
        const sessionId = await this.getSessionId();
        const key = `conversation_${sessionId}`;
    
        let history = await chrome.storage.local.get([key]);
        history = history[key] || [];
    
        history.push({ timestamp: Date.now(), prompt, response, model });
    
        if (history.length > 50) history.shift(); // Keep only last 50 messages
        await chrome.storage.local.set({ [key]: history });
    }
    
    async sendMessageWithRetry(message, maxRetries = 3, timeout = 30000) {
        console.debug('Sending message with context:', {
            hasContext: !!message.context,
            contextLength: message.context?.contextString?.length,
            prompt: message.prompt.slice(0, 100) + '...'
        });

        let currentAttempt = 0;
        
        while (currentAttempt < maxRetries) {
            try {
                // Pre-validate message
                if (!message?.prompt) {
                    throw new Error('Invalid message: prompt is required');
                }
    
                // Create formatted message
                const formattedMessage = {
                    action: 'queryAPI',
                    prompt: message.prompt,
                    modelDecision: {
                        model: message.model || message.modelDecision?.model || 'claude',
                        isHybrid: message.isHybrid || message.modelDecision?.isHybrid || false,
                        useContext: message.modelDecision?.useContext ?? true
                    },
                    context: this.sanitizeContext(message.context || {}),
                    timestamp: Date.now(),
                    attempt: currentAttempt + 1,
                    requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`
                };
    
                // Execute request
                const response = await this.executeRequest(formattedMessage, timeout);
                
                // Track metrics
                if (this.stats) {
                    this.stats.successfulAttempts = (this.stats.successfulAttempts || 0) + 1;
                    this.stats.averageAttempts = this.stats.successfulAttempts / (currentAttempt + 1);
                }
                
                return response;
    
            } catch (error) {
                currentAttempt++;
                console.debug(`Attempt ${currentAttempt} failed:`, error);
                
                if (currentAttempt === maxRetries) {
                    // Return error message after all retries have failed
                    return {
                        success: true,
                        data: {
                            content: [{
                                text: `Sorry, I encountered an error while trying to process your request: ${error.message}. Please check your API keys and try again.`
                            }]
                        }
                    };
                }
                
                // Exponential backoff
                await new Promise(resolve => 
                    setTimeout(resolve, Math.min(1000 * Math.pow(2, currentAttempt), 8000))
                );
            }
        }
    }

    async executeRequest(message, timeout) {
        return new Promise((resolve, reject) => {
            const port = chrome.runtime.connect({ 
                name: `ai-request-${Date.now()}` 
            });
            
            const timeoutId = setTimeout(() => {
                port.disconnect();
                reject(new Error('Request timeout'));
            }, timeout);
    
            port.onMessage.addListener((response) => {
                clearTimeout(timeoutId);
                if (response.success) {
                    resolve(response);
                } else {
                    reject(new Error(response.error || 'Request failed'));
                }
            });
    
            port.postMessage(message);
        });
    }
    
    // Helper method for context sanitization
    sanitizeContext(context) {
        if (!context || typeof context !== 'object') {
            return {};
        }
    
        // Remove potentially problematic fields
        const sanitized = { ...context };
        delete sanitized.port;
        delete sanitized.chrome;
        delete sanitized.window;
        
        // Ensure text fields are strings
        if (sanitized.visibleText) {
            sanitized.visibleText = String(sanitized.visibleText).slice(0, 5000);
        }
        if (sanitized.selectedText) {
            sanitized.selectedText = String(sanitized.selectedText).slice(0, 1000);
        }
        
        return sanitized;
    }

    cleanup() {
        // Clear all pending timeouts
        for (const timeoutId of this.requestTimeouts.values()) {
            clearTimeout(timeoutId);
        }
        this.requestTimeouts.clear();
        this.pendingRequests.clear();
    }
}

class QueryHandler {
    constructor(aiService, delegationService) {
        this.aiService = aiService;
        this.delegationService = delegationService;
        this.retryLimit = 3;
        this.retryDelay = 1000;
    }

    async handleQuery(query, context = {}) {
        let attempts = 0;
        let lastError = null;

        while (attempts < this.retryLimit) {
            try {
                // Optimize query
                const optimizedQuery = await this.optimizeQuery(query);
                
                // Get model decision
                const modelDecision = await this.delegationService.determineModelForQuery(optimizedQuery);
                
                // Execute query with appropriate model
                const response = await this.delegationService.executeQuery(optimizedQuery, context);
                
                // Process and return response
                return await this.processResponse(response, modelDecision);
                
            } catch (error) {
                attempts++;
                lastError = error;
                
                if (attempts < this.retryLimit) {
                    await new Promise(resolve => 
                        setTimeout(resolve, this.retryDelay * attempts)
                    );
                }
            }
        }

        // If all retries failed, throw the last error
        throw lastError;
    }

    async optimizeQuery(query) {
        // Implement query optimization logic
        return query;
    }

    async processResponse(response, modelDecision) {
        if (!response?.text) {
            throw new Error('Invalid response format');
        }

        return {
            text: response.text,
            model: modelDecision.model,
            metadata: {
                timestamp: Date.now(),
                reasoning: modelDecision.reasoning
            }
        };
    }
}

// Ensure singleton instance
if (!window.AIService) {
    window.AIService = AIService;
}