if (!window.ContextService) {
    window.ContextService = class ContextService {
        constructor() {
            // Basic configuration
            this.lastCapture = null;
            this.captureInterval = 5000;
            this.textBuffer = new Array(1000); // Pre-allocate for performance
            this.bufferIndex = 0;
            this.processingChunkSize = 500;
            this.isCapturingMore = false;

            // Bind methods for proper 'this' context
            this.boundMutationCallback = this.handleMutation.bind(this);

            // Initialize state
            this.cachedContext = null;
            this.mutationObserver = null;

            // Define selectors and filters
            this.ignoredTags = new Set([
                'script', 'style', 'noscript', 'meta', 'link'
            ]);
            

            this.ignoredClasses = new Set([
                'ai-hover-box', 
                'credits-badge', 
                'usage-section',
                'autonomi-edit-button',
                'ad', 'advertisement',
                'cookie-banner',
                'newsletter-signup',
                'popup',
                'modal',
                'overlay',
                'social-share',
                'comments-section'
            ]);

            this.importantSelectors = [
                'article',
                'main',
                '[role="main"]',
                '[role="article"]',
                '.article-content',
                '.post-content',
                '#article-body',
                '.story-body',
                '.entry-content',
                '.content-body',
                '.article-body',
                '[itemprop="articleBody"]'
            ];

            // Setup mutation observer
            this.setupMutationObserver();
        }

        handleMutation(mutations) {
            // Invalidate cache when content changes
            this.lastCapture = null;
            this.cachedContext = null;
        }

        setupMutationObserver() {
            if (this.mutationObserver) {
                this.mutationObserver.disconnect();
            }

            this.mutationObserver = new MutationObserver(this.boundMutationCallback);
            this.mutationObserver.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'hidden']
            });
        }

        async captureContext() {
            try {
                if (this.lastCapture && (Date.now() - this.lastCapture) < this.captureInterval) {
                    console.debug('Returning cached context');
                    return this.cachedContext;
                }
        
                console.debug('Capturing new context');
                const context = {
                    url: window.location.href,
                    title: document.title,
                    timestamp: Date.now(),
                    selectedText: window.getSelection().toString()
                };
        
                const mainContent = await this.captureMainContent();
                console.debug('Main content captured:', !!mainContent);
                
                const visibleContent = mainContent || await this.captureVisibleContent();
                console.debug('Visible content captured:', !!visibleContent);
        
                if (visibleContent) {
                    context.visibleText = this.processText(visibleContent);
                    context.metadata = await this.captureMetadata();
                }
        
                this.lastCapture = Date.now();
                this.cachedContext = context;
        
                console.debug('Context captured:', {
                    url: context.url,
                    title: context.title,
                    contentLength: context.visibleText?.length,
                    hasMetadata: !!context.metadata
                });
        
                return context;
            } catch (error) {
                console.error('Error capturing context:', error);
                return this.getFallbackContext();
            }
        }
        
        getFallbackContext() {
            return {
                url: window.location.href,
                title: document.title,
                timestamp: Date.now(),
                selectedText: window.getSelection().toString(),
                visibleText: '',
                error: 'Failed to capture page content'
            };
        }

        async captureVisibleContent() {
            const contentParts = [];
            
            // Debug the content capture
            console.debug('Starting content capture');
            
            // Get main content first - important for websites
            const mainContent = await this.captureMainContent();
            if (mainContent) {
                console.debug('Main content length:', mainContent.length);
                contentParts.push(mainContent);
            }
            
            // Capture everything in <main> or <article> tags
            const mainElements = document.querySelectorAll('main, article');
            for (const element of mainElements) {
                if (this.isNodeVisible(element)) {
                    const text = await this.extractTextFromElement(element, true);
                    if (text) contentParts.push(text);
                }
            }
            
            // Fallback to all visible paragraphs if no main content
            if (contentParts.length === 0) {
                const paragraphs = Array.from(document.querySelectorAll('p'))
                    .filter(p => this.isNodeVisible(p))
                    .map(p => p.textContent.trim())
                    .join('\n\n');
                if (paragraphs) contentParts.push(paragraphs);
            }
            
            const content = contentParts.join('\n\n');
            console.debug('Total captured content length:', content.length);
            return content;
        }
        
        async captureMainContent() {
            // Try to find main content container
            const mainSelectors = [
                'main',
                'article',
                '[role="main"]',
                '.main-content',
                '#content',
                '.content',
                '.post-content',
                '.article-content'
            ];
        
            let content = '';
            
            // Try each selector
            for (const selector of mainSelectors) {
                const element = document.querySelector(selector);
                if (element && this.isNodeVisible(element)) {
                    const text = await this.extractTextFromElement(element, true);
                    if (text.length > 100) {
                        content = text;
                        break;
                    }
                }
            }
        
            return content;
        }

        async captureMetadata() {
            const metadata = {
                domain: window.location.hostname,
                path: window.location.pathname,
                language: document.documentElement.lang || 'en',
                isGoogleDocs: window.location.hostname.includes('docs.google.com'),
                isArticle: this.isArticlePage(),
                publisher: this.getPublisher(),
                author: this.getAuthor(),
                datePublished: this.getDatePublished(),
                paywall: this.hasPaywall(),
                readingTime: this.estimateReadingTime(),
                pageType: this.determinePageType()
            };

            // Capture meta tags
            const metaTags = {};
            document.querySelectorAll('meta').forEach(meta => {
                const name = meta.getAttribute('name') || meta.getAttribute('property');
                const content = meta.getAttribute('content');
                if (name && content) {
                    metaTags[name] = content;
                }
            });
            metadata.meta = metaTags;

            return metadata;
        }

        determinePageType() {
            if (this.isArticlePage()) return 'article';
            if (window.location.hostname.includes('docs.google.com')) return 'googleDocs';
            if (document.querySelector('form')) return 'form';
            if (document.querySelector('.product') || document.querySelector('[data-product]')) return 'product';
            return 'general';
        }

        estimateReadingTime() {
            const text = document.body.textContent;
            const wordCount = text.trim().split(/\s+/).length;
            const readingTimeMinutes = Math.ceil(wordCount / 200); // Assume 200 words per minute
            return readingTimeMinutes;
        }

        async captureGoogleDocsContent() {
            try {
                const content = [];

                // Method 1: Editor container
                const editorContent = document.querySelector('.kix-appview-editor');
                if (editorContent) {
                    const text = this.extractTextFromGoogleDocsElement(editorContent);
                    if (text) content.push(text);
                }

                // Method 2: Individual paragraphs
                const paragraphs = document.querySelectorAll('.kix-paragraphrenderer');
                if (paragraphs.length > 0) {
                    paragraphs.forEach(p => {
                        const text = this.extractTextFromGoogleDocsElement(p);
                        if (text) content.push(text);
                    });
                }

                // Method 3: Canvas content
                const canvas = document.querySelector('.kix-canvas-tile-content');
                if (canvas && content.length === 0) {
                    const text = canvas.getAttribute('aria-label');
                    if (text) content.push(text);
                }

                // Method 4: Accessibility layer
                const accessibilityLayer = document.querySelector('.docs-accessibility-reader');
                if (accessibilityLayer) {
                    const text = accessibilityLayer.textContent.trim();
                    if (text) content.push(text);
                }

                return content.join('\n\n') || 'Unable to capture Google Docs content. Please ensure you have edit access.';
            } catch (error) {
                console.error('Error capturing Google Docs content:', error);
                return 'Error accessing Google Docs content. Please check permissions.';
            }
        }

        async captureArticleContent() {
            let content = '';
            
            // Try semantic article selectors first
            for (const selector of this.importantSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    const text = await this.extractTextFromElement(element, true);
                    if (text.length > 100) {
                        content = text;
                        break;
                    }
                }
            }

            // If no content found, try alternative methods
            if (!content) {
                // Try finding the largest text block
                const textBlocks = Array.from(document.querySelectorAll('p, article, section'))
                    .map(el => ({
                        element: el,
                        textLength: el.textContent.trim().length
                    }))
                    .filter(block => block.textLength > 100)
                    .sort((a, b) => b.textLength - a.textLength);

                if (textBlocks.length > 0) {
                    content = await this.extractTextFromElement(textBlocks[0].element, true);
                }
            }

            // Fallback to general content
            if (!content) {
                content = await this.captureGeneralContent();
            }

            return content;
        }

        async captureGeneralContent() {
            this.bufferIndex = 0;
            const seenNodes = new Set();

            const processChunk = async (nodes, startIndex) => {
                const endIndex = Math.min(startIndex + this.processingChunkSize, nodes.length);
                
                for (let i = startIndex; i < endIndex; i++) {
                    const node = nodes[i];
                    if (seenNodes.has(node) || this.shouldIgnoreNode(node)) continue;
                    
                    const text = node.textContent.trim();
                    if (text) {
                        this.textBuffer[this.bufferIndex++] = text;
                        seenNodes.add(node);
                    }
                }

                if (endIndex < nodes.length) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                    return processChunk(nodes, endIndex);
                }
            };

            // Process main content
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: (node) => {
                        if (seenNodes.has(node) || this.shouldIgnoreNode(node)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

            while (walker.nextNode()) {
                const node = walker.currentNode;
                const text = node.textContent.trim();
                if (text) {
                    this.textBuffer[this.bufferIndex++] = text;
                    seenNodes.add(node);
                }
            }

            // Process shadow DOM
            const shadowRoots = this.getAllShadowRoots(document.body);
            for (const root of shadowRoots) {
                const shadowText = await this.extractTextFromElement(root, true);
                if (shadowText) {
                    this.textBuffer[this.bufferIndex++] = shadowText;
                }
            }

            // Process iframes
            const iframeTexts = await this.captureAccessibleIframeContent();
            iframeTexts.forEach(text => {
                this.textBuffer[this.bufferIndex++] = text;
            });

            // Handle lazy-loaded content
            if (this.hasLazyContent() && !this.isCapturingMore) {
                this.isCapturingMore = true;
                await new Promise(resolve => setTimeout(resolve, 1000));
                this.isCapturingMore = false;
                return this.captureGeneralContent();
            }

            return this.textBuffer.slice(0, this.bufferIndex).join(' ');
        }

        hasLazyContent() {
            return (
                document.querySelectorAll('img[loading="lazy"]').length > 0 ||
                document.querySelectorAll('[data-src]').length > 0 ||
                this.isNearBottom()
            );
        }

        isNearBottom() {
            return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200;
        }

        getAllShadowRoots(element) {
            const roots = [];
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_ELEMENT
            );

            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (node.shadowRoot) {
                    roots.push(node.shadowRoot);
                }
            }

            return roots;
        }

        async captureAccessibleIframeContent() {
            const texts = [];
            const iframes = document.querySelectorAll('iframe');
            
            for (const iframe of iframes) {
                try {
                    if (this.shouldIgnoreIframe(iframe)) continue;
                    
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (iframeDoc) {
                        const text = await this.extractTextFromElement(iframeDoc.body, true);
                        if (text) texts.push(text);
                    }
                } catch (e) {
                    // Skip inaccessible iframes
                    continue;
                }
            }
            
            return texts;
        }

        shouldIgnoreNode(node) {
            const parent = node.parentElement;
            if (!parent) return true;

            // Check ignored tags
            if (this.ignoredTags.has(parent.tagName.toLowerCase())) return true;
            
            // Check ignored classes
            for (const className of this.ignoredClasses) {
                if (parent.classList.contains(className)) return true;
            }

            // Check visibility
            return !this.isNodeVisible(parent);
        }

        shouldIgnoreIframe(iframe) {
            const src = (iframe.src || '').toLowerCase();
            return (
                src.includes('ads') ||
                src.includes('tracking') ||
                src.includes('analytics') ||
                src.includes('recaptcha') ||
                iframe.width === '1' ||
                iframe.height === '1'
            );
        }

        isNodeVisible(node) {
            if (!node || !node.style) return true;

            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();

            return !(
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                style.opacity === '0' ||
                rect.height === 0 ||
                rect.width === 0 ||
                (style.position === 'fixed' && rect.top < 0) ||
                style.clipPath === 'inset(100%)'
            );
        }

        async extractTextFromElement(element, recursive = false) {
            if (!element || !this.isNodeVisible(element)) return '';

            const texts = [];
            
            if (recursive) {
                const walker = document.createTreeWalker(
                    element,
                    NodeFilter.SHOW_TEXT,
                    {
                        acceptNode: (node) => {
                            return this.shouldIgnoreNode(node) ? 
                                NodeFilter.FILTER_REJECT : 
                                NodeFilter.FILTER_ACCEPT;
                        }
                    }
                );

                while (walker.nextNode()) {
                    const text = walker.currentNode.textContent.trim();
                    if (text) texts.push(text);
                }
            } else {
                texts.push(element.textContent.trim());
            }

            return texts.join(' ');
        }

        processText(text) {
            return text
                .replace(/\s+/g, ' ')  // Normalize spaces
                .replace(/\[\s*\]/g, '')  // Remove empty brackets
                .replace(/\(\s*\)/g, '')  // Remove empty parentheses
                .replace(/\n\s*\n/g, '\n')  // Remove multiple newlines
                .replace(/[^\S\n]+/g, ' ')  // Normalize spaces but keep newlines
                .trim()
                .slice(0, 5000);  // Capture more webpage content
        }    

        isArticlePage() {
            return !!(
                document.querySelector('article') ||
                document.querySelector('[role="article"]') ||
                document.querySelector('.article-content') ||
                document.querySelector('.post-content') ||
                document.querySelector('meta[property="article:published_time"]') ||
                document.querySelector('[itemtype*="Article"]') ||
                document.querySelector('.entry-content') ||
                // Check for common news site patterns
                (document.querySelector('.story') && document.querySelector('.byline')) ||
                // Check for blog patterns
                (document.querySelector('.post') && document.querySelector('.post-title'))
            );
        }

        getPublisher() {
            return (
                document.querySelector('meta[property="og:site_name"]')?.content ||
                document.querySelector('meta[name="publisher"]')?.content ||
                document.querySelector('[itemtype*="Organization"]')?.querySelector('[itemprop="name"]')?.content ||
                document.querySelector('.publisher')?.textContent?.trim() ||
                window.location.hostname.replace(/^www\./, '')
            );
        }

        getAuthor() {
            return (
                document.querySelector('meta[name="author"]')?.content ||
                document.querySelector('meta[property="article:author"]')?.content ||
                document.querySelector('[itemtype*="Person"]')?.querySelector('[itemprop="name"]')?.content ||
                document.querySelector('.author')?.textContent?.trim() ||
                document.querySelector('[rel="author"]')?.textContent?.trim() ||
                document.querySelector('.byline')?.textContent?.trim()
            );
        }

        getDatePublished() {
            // Try meta tags first
            const metaDate = 
                document.querySelector('meta[property="article:published_time"]')?.content ||
                document.querySelector('meta[name="date"]')?.content ||
                document.querySelector('meta[name="published_date"]')?.content;
            
            if (metaDate) {
                try {
                    return new Date(metaDate).toISOString();
                } catch (e) {
                    console.debug('Error parsing meta date:', e);
                }
            }

            // Try time elements
            const timeElement = document.querySelector('time[datetime]');
            if (timeElement) {
                try {
                    return new Date(timeElement.getAttribute('datetime')).toISOString();
                } catch (e) {
                    console.debug('Error parsing time element:', e);
                }
            }

            // Try common date selectors
            const dateSelectors = [
                '.published-date',
                '.post-date',
                '.article-date',
                '.entry-date',
                '[itemprop="datePublished"]'
            ];

            for (const selector of dateSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    try {
                        return new Date(element.textContent.trim()).toISOString();
                    } catch (e) {
                        console.debug(`Error parsing date from ${selector}:`, e);
                    }
                }
            }

            return null;
        }

        hasPaywall() {
            // Check for common paywall indicators
            return !!(
                document.querySelector('.paywall') ||
                document.querySelector('.subscriber-only') ||
                document.querySelector('[data-paywall]') ||
                document.querySelector('.premium-content') ||
                document.querySelector('.subscription-required') ||
                // Check for common paywall overlay patterns
                document.querySelector('.modal.paywall') ||
                document.querySelector('[id*="paywall"]') ||
                // Check for subscription CTAs
                document.querySelector('[class*="subscribe"]') ||
                // Check for blurred/truncated content
                document.querySelector('.article-body.truncated') ||
                document.querySelector('.article-body.blurred')
            );
        }

        extractTextFromGoogleDocsElement(element) {
            try {
                // Get text content without formatting
                const textContent = element.textContent;
                
                // Remove Google Docs specific artifacts
                return textContent
                    .replace(/\u200B/g, '') // Remove zero-width spaces
                    .replace(/\u200C/g, '') // Remove zero-width non-joiners
                    .replace(/\uFEFF/g, '') // Remove byte order marks
                    .replace(/[^\S\n]+/g, ' ') // Normalize spaces but keep newlines
                    .trim();
            } catch (error) {
                console.debug('Error extracting text from Google Docs element:', error);
                return '';
            }
        }

        cleanup() {
            // Disconnect mutation observer
            if (this.mutationObserver) {
                this.mutationObserver.disconnect();
                this.mutationObserver = null;
            }

            // Clear cached data
            this.cachedContext = null;
            this.lastCapture = null;

            // Clear text buffer
            this.textBuffer = new Array(1000);
            this.bufferIndex = 0;

            // Reset flags
            this.isCapturingMore = false;
        }
    };
}