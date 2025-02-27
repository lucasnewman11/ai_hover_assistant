if (!window.ModelDelegationService) {
    window.ModelDelegationService = class ModelDelegationService {
        constructor(aiService) {
            this.aiService = aiService;
            this.realTimeKeywords = [
                'now', 'today', 'current', 'latest', 'near', 'live', 'breaking', 'this weekend',
                'weather', 'traffic', 'price', 'available', 'open', 'schedule', 'events'
            ];
            this.analyticalKeywords = [
                'explain', 'analyze', 'compare', 'historical', 'why', 'theory', 'break down',
                'how does', 'what causes', 'implications', 'evaluate', 'assess'
            ];
        }

        async determineModelForQuery(query) {
            const lowercaseQuery = query.toLowerCase();
            
            // Enhanced pattern detection
            const realTimeScore = this.calculateKeywordScore(lowercaseQuery, this.realTimeKeywords);
            const analyticalScore = this.calculateKeywordScore(lowercaseQuery, this.analyticalKeywords);
            
            // Hybrid detection thresholds
            const HYBRID_THRESHOLD = 0.3;
            const SINGLE_MODEL_THRESHOLD = 0.5;

            // Determine model based on scores
            if (realTimeScore > HYBRID_THRESHOLD && analyticalScore > HYBRID_THRESHOLD) {
                return {
                    model: 'hybrid',
                    reasoning: 'Query requires both real-time data and analysis',
                    scores: { realTime: realTimeScore, analytical: analyticalScore }
                };
            }

            if (realTimeScore > SINGLE_MODEL_THRESHOLD) {
                return {
                    model: 'perplexity',
                    reasoning: 'Query requires real-time data',
                    scores: { realTime: realTimeScore, analytical: analyticalScore }
                };
            }

            if (analyticalScore > SINGLE_MODEL_THRESHOLD) {
                return {
                    model: 'claude',
                    reasoning: 'Query requires analytical processing',
                    scores: { realTime: realTimeScore, analytical: analyticalScore }
                };
            }

            // Enhanced contextual analysis for ambiguous queries
            const contextualDecision = this.analyzeQueryContext(query);
            if (contextualDecision) {
                return contextualDecision;
            }

            // Default to hybrid for complex queries
            return {
                model: 'hybrid',
                reasoning: 'Complex query requiring comprehensive response',
                scores: { realTime: realTimeScore, analytical: analyticalScore }
            };
        }

        calculateKeywordScore(query, keywords) {
            const matches = keywords.filter(keyword => query.includes(keyword));
            return matches.length / Math.max(query.split(' ').length, 1);
        }

        analyzeQueryContext(query) {
            // Location-based queries
            if (/\b(?:in|at|near|around)\s+([A-Za-z\s]+(?:,\s*[A-Za-z\s]+)?)\b/i.test(query)) {
                return {
                    model: 'perplexity',
                    reasoning: 'Location-based query requiring current data'
                };
            }

            // Time-sensitive queries
            if (/\b(?:when|time|schedule|hours|open|closes?|available)\b/i.test(query)) {
                return {
                    model: 'perplexity',
                    reasoning: 'Time-sensitive query requiring current data'
                };
            }

            return null;
        }

        async processHybridResponse(perplexityResponse, claudeResponse) {
            const enhancementPrompt = `
            I have two responses to merge and enhance:

            Real-time Data:
            ${perplexityResponse}

            Analysis:
            ${claudeResponse}

            Please create a comprehensive response that:
            1. Combines the most relevant information from both sources
            2. Removes any redundancies
            3. Presents a clear, logical flow of information
            4. Adds any missing context
            5. Ensures consistent formatting

            Format the response to be highly readable with:
            - Clear section headings
            - Bullet points for key details
            - Numbered lists for steps or sequences
            - Bold text for important information
            `;

            const enhancedResponse = await this.aiService.queryClaude(enhancementPrompt, {});
            return enhancedResponse;
        }

        async executeQuery(query, context = {}) {
            try {
                const modelDecision = await this.determineModelForQuery(query);
                
                if (modelDecision.model === 'hybrid') {
                    // Execute parallel queries for efficiency
                    const [perplexityResponse, claudeResponse] = await Promise.all([
                        this.aiService.queryPerplexity(query, context),
                        this.aiService.queryClaude(query, context)
                    ]);

                    // Merge and enhance responses
                    const enhancedResponse = await this.processHybridResponse(
                        perplexityResponse.text,
                        claudeResponse.text
                    );

                    return {
                        text: enhancedResponse.text,
                        model: 'hybrid',
                        metadata: {
                            perplexityResponse,
                            claudeResponse,
                            modelDecision
                        }
                    };
                }

                // Single model execution
                const handler = modelDecision.model === 'perplexity' ?
                    this.aiService.queryPerplexity.bind(this.aiService) :
                    this.aiService.queryClaude.bind(this.aiService);

                const response = await handler(query, context);
                return {
                    text: response.text,
                    model: modelDecision.model,
                    metadata: { modelDecision }
                };

            } catch (error) {
                console.error('Query execution error:', error);
                throw error;
            }
        }
    };
}