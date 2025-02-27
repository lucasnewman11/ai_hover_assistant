// Global hover box reference
if (!window.hoverBox) {
    window.hoverBox = null;
}

class TextEditHandler {
    constructor(hoverBox) {
        this.hoverBox = hoverBox;
        this.selectedText = '';
        this.setupSelectionListener();
        this.createEditButton();
    }

    parseAIResponse(responseText) {
        // Match everything up to EXPLANATION or end of string
        const rewrittenMatch = responseText.match(/REWRITTEN TEXT:\s*([\s\S]*?)(?=\s*\n\s*EXPLANATION:|\s*$)/i);
        
        if (rewrittenMatch) {
            // Extract and clean the rewritten text only
            const cleanedText = rewrittenMatch[1]
                .trim()
                .replace(/^["']|["']$/g, '') // Remove quotes
                .replace(/\n+/g, ' ') // Replace newlines with spaces
                .replace(/<\/?[^>]+(>|$)/g, '') // Remove HTML tags
                .trim();
                
            return {
                rewrittenText: cleanedText,
                explanation: null
            };
        }
        
        // Fallback: If no clear sections, use first paragraph
        const firstParagraph = responseText.split(/\n\n/)[0]
            .trim()
            .replace(/^["']|["']$/g, '')
            .replace(/\n+/g, ' ')
            .replace(/<\/?[^>]+(>|$)/g, '') // Remove HTML tags
            .trim();
            
        return {
            rewrittenText: firstParagraph,
            explanation: null
        };
    }

    createEditButton() {
        this.editButton = document.createElement('div');
        this.editButton.className = 'autonomi-edit-button';
        this.editButton.innerHTML = `
            <button class="edit-text-btn">
                <span>✏️ Edit with AI</span>
                <small>⌘/Ctrl+Shift+E</small>
            </button>
        `;
        document.body.appendChild(this.editButton);
        
        this.editButton.addEventListener('click', () => {
            this.handleEditRequest();
        });
    }

    setupSelectionListener() {
        let selectionTimeout;
        
        document.addEventListener('selectionchange', () => {
            if (selectionTimeout) {
                clearTimeout(selectionTimeout);
            }
            
            selectionTimeout = setTimeout(() => {
                this.handleSelectionChange();
            }, 500);
        });

        // Add keyboard shortcut
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
                e.preventDefault();
                this.handleEditRequest();
            }
        });
    }

    async handleSelectionChange() {
        const selection = window.getSelection();
        this.selectedText = selection.toString().trim();

        if (!this.selectedText || this.selectedText.length < 3) {
            this.hideEditButton();
            return;
        }

        // Special handling for Google Docs
        if (window.location.hostname.includes('docs.google.com')) {
            const isInEditor = this.isGoogleDocsEditor(selection.anchorNode);
            if (!isInEditor) {
                this.hideEditButton();
                return;
            }
        }

        this.showEditButton(selection);
    }

    isGoogleDocsEditor(node) {
        let current = node;
        while (current) {
            if (current.classList && 
                (current.classList.contains('kix-appview-editor') || 
                 current.classList.contains('kix-paragraphrenderer'))) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    showEditButton(selection) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        // Position the button below the selection
        this.editButton.style.left = `${rect.left}px`;
        this.editButton.style.top = `${rect.bottom + 10}px`;
        this.editButton.style.display = 'block';

        // Ensure button is within viewport
        const buttonRect = this.editButton.getBoundingClientRect();
        if (buttonRect.right > window.innerWidth) {
            this.editButton.style.left = `${window.innerWidth - buttonRect.width - 10}px`;
        }
        if (buttonRect.bottom > window.innerHeight) {
            this.editButton.style.top = `${rect.top - buttonRect.height - 10}px`;
        }
    }

    hideEditButton() {
        if (this.editButton) {
            this.editButton.style.display = 'none';
        }
    }

    async handleEditRequest() {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (!selectedText) return;
    
        if (!this.hoverBox.box.classList.contains('visible')) {
            this.hoverBox.toggle();
        }
    
        this.hoverBox.addMessageToChat(
            `Help me improve this text:\n\n"${selectedText}"`,
            'user'
        );
    
        try {
            const context = await this.hoverBox.contextService.captureContext();
            const editPrompt = `Rewrite and improve this text. Respond with ONLY the rewritten version, no explanations:\n\n"${selectedText}"`;
            
            const response = await this.hoverBox.aiService.queryByModel(
                editPrompt,
                context,
                this.hoverBox.activeModel
            );
    
            if (!response?.text) {
                throw new Error('Invalid response from AI');
            }
    
            const parsedResponse = this.parseAIResponse(response.text);
            
            if (!parsedResponse.rewrittenText) {
                throw new Error('Failed to parse AI response');
            }
    
            await navigator.clipboard.writeText(parsedResponse.rewrittenText);
    
            const message = `${parsedResponse.rewrittenText}\n\n<br><br>(📋 Copied to clipboard!)`; // Add zero-width space to force newline
            this.hoverBox.addMessageToChat(message, 'assistant');
    
        } catch (error) {
            console.error('Error getting AI edit:', error);
            this.hoverBox.addMessageToChat(
                `Error: ${error.message}. Please try again.`,
                'error'
            );
        }
    
        this.hideEditButton();
    }
}

class AIEditModal {
    constructor(voiceService) {
        this.voiceService = voiceService;
        this.modal = null;
        this.textarea = null;
        this.onSubmit = null;
        this.isRecording = false;
        this.createModal();
    }

    createModal() {
        this.modal = document.createElement('div');
        this.modal.className = 'ai-edit-modal';
        this.modal.innerHTML = `
            <div class="ai-edit-modal-header">
                <div class="header-left">
                    <span class="header-title">Edit with AI</span>
                </div>
                <div class="header-right">
                    <button class="mic-btn" title="Voice Input">
                        🎤
                        <div class="recording-indicator"></div>
                    </button>
                </div>
            </div>
            <div class="ai-edit-modal-content">
                <textarea 
                    placeholder="How would you like to edit this text?" 
                    rows="4"
                    aria-label="Edit instructions"
                ></textarea>
            </div>
            <div class="ai-edit-modal-actions">
                <button class="secondary" data-action="cancel">Cancel</button>
                <button class="primary" data-action="submit">Edit Text</button>
            </div>
        `;

        document.body.appendChild(this.modal);
        this.textarea = this.modal.querySelector('textarea');
        this.setupEventListeners();
    }

    setupEventListeners() {
        const micBtn = this.modal.querySelector('.mic-btn');
        micBtn.addEventListener('click', () => this.toggleVoiceInput());

        this.modal.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action === 'cancel') {
                this.hide();
                this.onSubmit?.(null);
            } else if (action === 'submit') {
                const instructions = this.textarea.value.trim();
                if (instructions) {
                    this.hide();
                    this.onSubmit?.(instructions);
                }
            }
        });

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.classList.contains('visible')) {
                this.hide();
                this.onSubmit?.(null);
            }
        });

        // Submit on Ctrl/Cmd + Enter
        this.textarea.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                const instructions = this.textarea.value.trim();
                if (instructions) {
                    this.hide();
                    this.onSubmit?.(instructions);
                }
            }
        });
    }

    async toggleVoiceInput() {
        const micBtn = this.box.querySelector('.mic-btn');
        const textarea = this.box.querySelector('textarea');
        
        try {
            if (micBtn.classList.contains('recording')) {
                micBtn.classList.remove('recording');
                this.voiceService?.stopListening();
                return;
            }

            // Initialize voice service with better error handling
            if (!this.voiceService?.isInitialized) {
                this.addMessageToChat('Initializing voice service...', 'info');
                try {
                    this.voiceService = new window.VoiceService();
                    await this.voiceService.initPromise;
                    
                    if (!this.voiceService.isInitialized) {
                        throw new Error('Voice service initialization failed');
                    }
                } catch (error) {
                    micBtn.classList.remove('recording');
                    this.addMessageToChat('Voice service initialization failed. Retrying...', 'error');
                    
                    // One retry attempt with backup key
                    try {
                        this.voiceService = new window.VoiceService();
                        await this.voiceService.initPromise;
                    } catch (retryError) {
                        this.addMessageToChat('Voice service unavailable. Please try again later.', 'error');
                        return;
                    }
                }
            }

            micBtn.classList.add('recording');
            await this.voiceService.startListening(
                (text) => {
                    textarea.value = text;
                    micBtn.classList.remove('recording');
                    textarea.focus();
                },
                (error) => {
                    console.error('Voice input error:', error);
                    micBtn.classList.remove('recording');
                    this.addMessageToChat(`Voice input error: ${error.message}`, 'error');
                }
            );
        } catch (error) {
            micBtn.classList.remove('recording');
            console.error('Voice input error:', error);
            this.addMessageToChat('Voice service error. Please try again.', 'error');
        }
    }
    
    async initializeVoiceService() {
        if (!this.voiceService) {
            this.voiceService = new window.VoiceService();
            try {
                await this.voiceService.initPromise;
            } catch (error) {
                this.voiceService = null;
                throw new Error('Failed to initialize voice service. Please check your API key configuration.');
            }
        }
        return this.voiceService;
    }

    showError(message) {
        const existingError = this.modal.querySelector('.error-message');
        if (existingError) existingError.remove();

        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        this.modal.querySelector('.ai-edit-modal-content').appendChild(errorDiv);

        setTimeout(() => errorDiv.remove(), 3000);
    }

    show() {
        this.modal.classList.add('visible');
        this.textarea.focus();
        return new Promise(resolve => {
            this.onSubmit = resolve;
        });
    }

    hide() {
        this.modal.classList.remove('visible');
        this.textarea.value = '';
        if (this.isRecording) {
            this.toggleVoiceInput();
        }
    }
}

class AIHoverBox {
    constructor() {
        console.log('Initializing AIHoverBox');
        
        // Core state initialization
        this.box = null;
        this.isCollapsed = false;
        this.dragOffset = { x: 0, y: 0 };
        this.messageQueue = Promise.resolve();
        this.activeModel = 'claude';
        this.responseMode = 'chat';
        
        // Bound event handlers to maintain context and allow proper cleanup
        this._boundResizeHandler = () => {
            if (this.resizeThrottle) {
                clearTimeout(this.resizeThrottle);
            }
            this.resizeThrottle = setTimeout(() => {
                this.ensureBoxInViewport();
                this.saveBoxSize();
            }, 100);
        };
        
        this._boundUnloadHandler = () => {
            this.cleanup();
        };
        
        this._boundVisibilityHandler = () => {
            if (document.hidden && this.box?.classList.contains('visible')) {
                this.saveBoxSize();
            }
        };
        
        // Initialize event listeners
        window.addEventListener('resize', this._boundResizeHandler, { passive: true });
        window.addEventListener('unload', this._boundUnloadHandler);
        document.addEventListener('visibilitychange', this._boundVisibilityHandler);
        
        // Initialize text edit handler
        this.textEditHandler = new TextEditHandler(this);
        
        // Services initialization
        if (typeof window.UsageTracker === 'function') {
            this.usageTracker = new window.UsageTracker();
        } else {
            console.error('UsageTracker is missing! Ensure it is injected.');
            this.usageTracker = null;
        }
        
        // Initialize UI state tracking
        this.scrollThrottle = null;
        this.resizeThrottle = null;
        this.isResizing = false;
        this.isDragging = false;
        
        // Async initialization
        this.initPromise = this.initializeServices().then(async () => {
            if (this.usageTracker) {
                const credits = await this.usageTracker.checkUsageLimit();
                await this.updateCreditsDisplay(credits);
            }
            return true;
        }).catch(error => {
            console.error('Initialization failed:', error);
            this.cleanup();
            throw error;
        });
        
        // Set up credit listener
        this.setupCreditListener();
    }
    
    cleanup() {
        try {
            // Clear all timeouts
            if (this.scrollThrottle) clearTimeout(this.scrollThrottle);
            if (this.resizeThrottle) clearTimeout(this.resizeThrottle);
            
            // Remove event listeners
            window.removeEventListener('resize', this._boundResizeHandler);
            window.removeEventListener('unload', this._boundUnloadHandler);
            document.removeEventListener('visibilitychange', this._boundVisibilityHandler);
            
            // Save state before cleanup if box is visible
            if (this.box?.classList.contains('visible')) {
                this.saveBoxSize();
            }
            
            // Cleanup resize handler
            this.cleanupResize();
            
            // Remove DOM elements
            if (this.box) {
                this.box.remove();
                this.box = null;
            }
            
            // Cleanup text edit handler
            if (this.textEditHandler) {
                this.textEditHandler.cleanup();
            }
            
            // Cleanup services
            if (this.aiService) {
                this.aiService.cleanup();
                this.aiService = null;
            }
            
            if (this.contextService) {
                this.contextService.cleanup();
                this.contextService = null;
            }
            
            if (this.voiceService) {
                this.voiceService.cleanup();
                this.voiceService = null;
            }
            
            if (this.usageTracker) {
                this.usageTracker = null;
            }
            
            // Reset state
            this.isCollapsed = false;
            this.isDragging = false;
            this.isResizing = false;
            this.messageQueue = Promise.resolve();
            
            console.log('AIHoverBox cleanup completed successfully');
        } catch (error) {
            console.error('Error during cleanup:', error);
            // Continue with cleanup even if there are errors
        }
    }

    ensureBoxInViewport() {
        if (!this.box || this.isCollapsed) return;
        
        const rect = this.box.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        if (rect.right > viewportWidth) {
            this.box.style.left = `${viewportWidth - rect.width - 20}px`;
        }
        if (rect.bottom > viewportHeight) {
            this.box.style.top = `${viewportHeight - rect.height - 20}px`;
        }
    }

    async isExtensionContextValid() {
        try {
            return !!chrome.runtime?.id;
        } catch {
            return false;
        }
    }

    setLoadingState() {
        const textarea = this.box.querySelector('textarea');
        const sendBtn = this.box.querySelector('.send-btn');
        
        // Clear and disable input immediately
        textarea.value = '';
        textarea.disabled = true;
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';
        
        return () => {
            textarea.disabled = false;
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
            textarea.placeholder = 'Ask anything...';
            textarea.style.height = 'auto';
            textarea.focus();
        };
    }

    setupCreditListener() {
        chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
            if (message.action === 'updateCredits' && this.box) {
                try {
                    await this.updateCreditsDisplay(message.credits);
                    sendResponse({ success: true });
                } catch (error) {
                    console.error('Error updating credits:', error);
                    sendResponse({ success: false });
                }
                return true;
            }
        });
    }  
    
    setResponseMode(mode) {
        this.responseMode = mode;
        // Update UI
        const buttons = this.box.querySelectorAll('.mode-btn');
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }

    async initializeServices() {
        try {
            // Wait for required services with improved timeout
            await Promise.race([
                this.checkServices(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Service initialization timeout')), 10000)
                )
            ]);
    
            // Initialize services
            if (window.AIService) {
                this.aiService = new window.AIService();
                await this.aiService.initPromise;
            } else {
                throw new Error('AIService not available');
            }
    
            if (window.UsageTracker) {
                this.usageTracker = new window.UsageTracker();
                await this.usageTracker.initPromise;
            } else {
                throw new Error('UsageTracker not available');
            }
    
            this.contextService = new window.ContextService();
            
            // Initialize voice service if supported, but don't block on failure
            if (navigator.mediaDevices?.getUserMedia) {
                try {
                    this.voiceService = new window.VoiceService();
                    await this.voiceService.initPromise;
                } catch (error) {
                    console.warn('Voice service initialization failed, continuing without voice support:', error);
                    this.voiceService = null;
                }
            }
    
            // Initialize UI in correct order
            await this.initializeBox();
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            if (this.box?.isConnected) {
                this.initializeResizable();
                this.setupResizeListener();
                await this.loadStoredConversations();
                await this.updateCreditsDisplay();
                await this.loadSavedBoxSize();
            }
    
            return true;
        } catch (error) {
            console.error('Service initialization failed:', error);
            await this.cleanup();
            throw error;
        }
    }
    
    // Add helper methods
    setupResizeListener() {
        if (this._resizeListener) {
            window.removeEventListener('resize', this._resizeListener);
        }
        
        this._resizeListener = () => {
            this.ensureBoxInViewport();
            this.initializeResizable();
        };
        
        window.addEventListener('resize', this._resizeListener);
    }
    
    async loadSavedBoxSize() {
        try {
            if (!await this.isExtensionContextValid()) {
                console.warn('Extension context invalid, using default size');
                return;
            }
    
            const result = await chrome.storage.local.get('ai_box_size');
            if (result.ai_box_size && 
                Date.now() - result.ai_box_size.timestamp < 86400000) { // 24 hours
                const { height } = result.ai_box_size;
                if (height && this.box) {
                    this.box.style.height = `${height}px`;
                    const chatContainer = this.box.querySelector('.chat-container');
                    if (chatContainer) {
                        const headerHeight = this.box.querySelector('.hover-box-header').offsetHeight;
                        const inputHeight = this.box.querySelector('.input-container').offsetHeight;
                        chatContainer.style.height = `${height - headerHeight - inputHeight - 24}px`;
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to load saved box size:', error);
            // Use default size - non-critical functionality
        }
    }
    
    cleanupResize() {
        const resizeHandle = this.box.querySelector('.resize-handle');
        if (resizeHandle) {
            resizeHandle.remove();
        }
    }

    async checkServices() {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (window.AIService && window.ContextService && window.VoiceService && window.UsageTracker) {
                    clearInterval(checkInterval);
                    resolve(true);
                }
            }, 200);
    
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve(false);
            }, 5000);
        });
    }    

    async loadStoredConversations() {
        try {
            const conversations = await this.aiService.memoryService.getConversationsBySession();
            const chatContainer = this.box.querySelector('.chat-container');
            
            // Clear existing messages
            chatContainer.innerHTML = '';
            
            // Add messages with proper animation delays
            conversations.forEach((conv, index) => {
                setTimeout(() => {
                    this.addMessageToChat(conv.message, 'user');
                    this.addMessageToChat(conv.response, 'assistant');
                }, index * 100);
            });

            // Scroll to bottom after all messages are added
            setTimeout(() => {
                this.scrollToBottom(true);
            }, conversations.length * 100);
        } catch (error) {
            console.error('Failed to load conversations:', error);
        }
    }

    async initializeBox() {
        try {
            if (this.box) return;
    
            // Create hover box container
            this.box = document.createElement('div');
            this.box.className = 'ai-hover-box';
    
            // Fetch initial credits
            const credits = await this.usageTracker.checkUsageLimit();
    
            // Set up the hover box content
            this.box.innerHTML = `
                <div class="hover-box-header">
                    <div class="header-left">
                        <button class="collapse-btn" aria-label="Toggle collapse">−</button>
                        <span class="header-title">Autonomi Executive Assistant</span>
                        <span class="credits-badge">${credits.remaining ?? '--'} credits</span>
                    </div>
                    <div class="header-right">
                        <button class="mic-btn" title="Voice Input" aria-label="Toggle voice input">
                            🎤
                            <div class="recording-indicator"></div>
                        </button>
                        <button class="settings-btn" title="Settings" aria-label="Open settings">⚙️</button>
                    </div>
                </div>
                <div class="chat-container" role="log" aria-live="polite"></div>
                <div class="input-container">
                    <textarea 
                        placeholder="Ask anything..." 
                        rows="3" 
                        aria-label="Message input"
                    ></textarea>
                    <div class="input-controls">
                        <button class="send-btn" aria-label="Send message">Send</button>
                    </div>
                </div>
            `;
    
            // Append the hover box to the document body
            document.body.appendChild(this.box);
    
            // Add event listener for settings button
            const settingsBtn = this.box.querySelector('.settings-btn');
            settingsBtn.addEventListener('click', async () => {
                console.log('Settings button clicked');

                // Close the sidebar first
                this.toggle();

                // Wait a brief moment for animation
                await new Promise(resolve => setTimeout(resolve, 300));

                // Open the extension popup
                await chrome.runtime.sendMessage({ 
                    action: 'openExtensionPopup',
                    forceOpen: true  // New flag to force popup open
                });
            });
    
            // Update the credits display dynamically
            await this.updateCreditsDisplay(credits);
    
            // Set box position
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            this.box.style.left = `${Math.max(20, Math.min(viewportWidth - 470, viewportWidth / 2 - 225))}px`;
            this.box.style.top = `${Math.max(20, Math.min(viewportHeight - 520, viewportHeight / 2 - 250))}px`;
                
            // Initialize other box functionalities
            await this.setupModelToggle();
            await this.attachEventListeners();
            await this.initializeScrolling();
    
            console.log('Hover box initialized successfully');
        } catch (error) {
            console.error('Failed to initialize hover box:', error);
            throw error;
        }
    }    

    async updateCreditsDisplay(creditsInfo = null) {
        try {
            const creditsBadge = this.box.querySelector('.credits-badge');
            if (!creditsBadge) return;
    
            // Retrieve the credits from UsageTracker if not passed
            const credits = creditsInfo || await this.usageTracker.checkUsageLimit();
    
            if (credits && typeof credits.remaining === 'number') {
                creditsBadge.textContent = `${credits.remaining} credits`; // Show only remaining credits
            } else {
                creditsBadge.textContent = '-- credits'; // Fallback display
            }
        } catch (error) {
            console.error('Error updating credits display:', error);
            const creditsBadge = this.box.querySelector('.credits-badge');
            if (creditsBadge) creditsBadge.textContent = '-- credits';
        }
    }    

    handleCreditsError(badge) {
        if (badge) {
            badge.textContent = '-- credits';
            badge.style.background = 'rgba(75, 75, 75, 0.2)';
        }
    }

    async handleTextEdit(selectedText, editPrompt) {
        try {
            const context = await this.contextService.captureContext();
            const fullPrompt = `Edit the following text according to these instructions: "${editPrompt}"\n\nText to edit: "${selectedText}"`;
            
            const response = await this.aiService.queryByModel(fullPrompt, context, this.activeModel);
            
            if (!response?.text) {
                throw new Error('Invalid response from API');
            }

            return response.text;
        } catch (error) {
            console.error('Text edit error:', error);
            throw error;
        }
    }

    async broadcastCreditsUpdate(credits) {
        try {
            await chrome.runtime.sendMessage({
                action: 'updateCredits',
                credits: credits
            });
        } catch (error) {
            console.debug('Popup not open for credit sync');
        }
    }

    updateCreditStyles(badge, credits) {
        badge.style.background = 'rgba(74, 144, 226, 0.2)';
        badge.style.transition = 'background-color 0.3s ease';
    
        if (credits.remaining <= 5 && !credits.exceeded) {
            badge.style.background = 'rgba(255, 165, 0, 0.2)';
        }
        
        if (credits.exceeded) {
            badge.style.background = 'rgba(255, 59, 48, 0.2)';
            this.showUpgradePrompt();
        }
    }

    async showUpgradePrompt() {
        const upgradeInfo = await this.usageTracker.showUpgradePrompt();
        
        // Remove existing prompt if any
        const existingPrompt = document.querySelector('.upgrade-prompt');
        if (existingPrompt) existingPrompt.remove();
        
        const prompt = document.createElement('div');
        prompt.className = 'upgrade-prompt';
        prompt.innerHTML = `
            <h3>${upgradeInfo.title}</h3>
            <p>${upgradeInfo.message}</p>
            <a href="${upgradeInfo.actionUrl}" target="_blank">${upgradeInfo.actionText}</a>
        `;
        
        this.box.appendChild(prompt);
        
        // Disable input and buttons
        const textarea = this.box.querySelector('textarea');
        const sendBtn = this.box.querySelector('.send-btn');
        textarea.disabled = true;
        sendBtn.disabled = true;
    }

    initializeScrolling() {
        const chatContainer = this.box.querySelector('.chat-container');
        
        // Smooth scrolling
        chatContainer.addEventListener('scroll', () => {
            if (this.scrollThrottle) {
                clearTimeout(this.scrollThrottle);
            }
            
            this.scrollThrottle = setTimeout(() => {
                const { scrollTop, scrollHeight, clientHeight } = chatContainer;
                const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
                
                // Show/hide scroll indicator
                chatContainer.classList.toggle('at-bottom', isAtBottom);
            }, 100);
        });

        // Initial scroll position
        this.scrollToBottom(true);
    }

    initializeResizable() {
        // Remove existing resize handle first
        this.cleanupResize();
        
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        this.box.appendChild(resizeHandle);
    
        let initialY, initialBoxHeight;
        const MIN_HEIGHT = 300;
        const MAX_HEIGHT = window.innerHeight - 100;
    
        const startResize = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Prevent text selection during resize
            document.body.style.userSelect = 'none';
            
            initialY = e.clientY;
            initialBoxHeight = this.box.offsetHeight;
            
            // Store initial heights
            const chatContainer = this.box.querySelector('.chat-container');
            const headerHeight = this.box.querySelector('.hover-box-header').offsetHeight;
            const inputHeight = this.box.querySelector('.input-container').offsetHeight;
            
            const resize = (e) => {
                const deltaY = e.clientY - initialY;
                const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, initialBoxHeight + deltaY));
                
                // Update box height
                this.box.style.height = `${newHeight}px`;
                
                // Update chat container height
                const newChatHeight = newHeight - headerHeight - inputHeight - 24;
                chatContainer.style.height = `${newChatHeight}px`;
                
                // Force layout recalculation for Chrome
                window.getComputedStyle(chatContainer).getPropertyValue('height');
                
                // Update scroll position
                chatContainer.scrollTop = chatContainer.scrollTop;
            };
            
            const stopResize = () => {
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', resize);
                document.removeEventListener('mouseup', stopResize);
                
                // Save size and restore transitions
                this.saveBoxSize();
                this.box.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            };
            
            document.addEventListener('mousemove', resize);
            document.addEventListener('mouseup', stopResize);
        };
    
        resizeHandle.addEventListener('mousedown', startResize);
        
        // Store reference for cleanup
        this._resizeHandle = resizeHandle;
    }
    
    // Add this helper method
    saveBoxSize() {
        try {
            // Check if extension context is still valid
            if (!chrome.runtime?.id) {
                console.warn('Extension context invalidated, skipping box size save');
                return;
            }
    
            chrome.storage.local.set({
                'ai_box_size': {
                    height: this.box?.offsetHeight || 500, // Default height if box is not available
                    timestamp: Date.now()
                }
            }).catch(error => {
                console.warn('Failed to save box size:', error);
                // Continue execution - this is non-critical functionality
            });
        } catch (error) {
            console.warn('Error in saveBoxSize:', error);
            // Fail gracefully - don't throw errors for non-critical operations
        }
    }

    scrollToBottom(force = false) {
        const chatContainer = this.box.querySelector('.chat-container');
        if (!chatContainer) return;
    
        // Always scroll to the bottom when a new message is added
        setTimeout(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }, 100);
    }
    

    async setupModelToggle() {
        const toggleBtns = this.box.querySelectorAll('.toggle-btn');
        toggleBtns.forEach(btn => {
            btn.addEventListener('click', async () => { // <-- Make sure this function is async
                toggleBtns.forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-checked', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-checked', 'true');
                
                this.activeModel = btn.dataset.model;
                this.box.querySelector('.model-name').textContent = 
                    this.activeModel.charAt(0).toUpperCase() + this.activeModel.slice(1);
            });
        });
    }

    async sendMessage() {
        // Check credits before sending
        const usageInfo = await this.usageTracker.checkUsageLimit();
        if (usageInfo.exceeded) {
            await this.showUpgradePrompt();
            return;
        }

        this.messageQueue = this.messageQueue.then(() => this._processSendMessage());
        return this.messageQueue;
    }

    loadingMessages = [
        "Hamster Wheels Turning",
        "Polling Local Grandmas",
        "Asking Your Mom",
        "Consulting Magic 8 Ball",
        "Bribing the AI",
        "Feeding the Gremlins",
        "Summoning Digital Spirits"
    ];
    
    cycleLoadingMessage(sendBtn) {
        let index = 0;
        const interval = setInterval(() => {
            sendBtn.textContent = this.loadingMessages[index];
            index = (index + 1) % this.loadingMessages.length;
        }, 2000);
        return interval;
    }

    async _processSendMessage() {
        const textarea = this.box.querySelector('textarea');
        const message = textarea.value.trim();
        
        if (!message) return;
        
        let resetLoadingState = null;
        
        try {
            // Set loading state and get reset function
            resetLoadingState = this.setLoadingState();
            
            // Add message to chat immediately
            this.addMessageToChat(message, 'user');
    
            // Validate AI service
            if (!this.aiService?.initPromise) {
                throw new Error('AI Service not initialized');
            }
    
            // Get context and send query
            const context = await this.contextService.captureContext();
            const response = await this.aiService.queryByModel(
                message, 
                context,
                this.activeModel
            );
    
            // Validate response
            if (!response?.text) {
                throw new Error('Invalid response format');
            }
    
            const usageInfo = await this.usageTracker.incrementUsage();
            
            // Update credits display immediately
            await this.updateCreditsDisplay(usageInfo);
            
            // Add response to chat
            this.addMessageToChat(response.text, 'assistant');

            // Update usage tracking
            await this.usageTracker.incrementUsage();
            
        } catch (error) {
            console.error('Error in sendMessage:', error);
            this.addMessageToChat(
                `Error: ${error.message}. Please try again.`, 
                'error'
            );
        } finally {
            // Reset loading state
            if (resetLoadingState) {
                resetLoadingState();
            }
        }
    }

    addMessageToChat(text, type) {
        if (!text) return;
    
        const chatContainer = this.box.querySelector('.chat-container');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.setAttribute('role', type === 'user' ? 'complementary' : 'article');
        
        const timestamp = document.createElement('div');
        timestamp.className = 'message-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    
        const content = document.createElement('div');
        content.className = 'message-content';
        
        // Format the text and set innerHTML
        const formattedText = this.formatMessageText(text);
        content.innerHTML = formattedText;
        
        messageDiv.appendChild(timestamp);
        messageDiv.appendChild(content);
        
        messageDiv.style.opacity = '0';
        chatContainer.appendChild(messageDiv);
        
        messageDiv.offsetHeight; // Trigger reflow
        
        messageDiv.style.transition = 'opacity 0.3s ease';
        messageDiv.style.opacity = '1';
    
        setTimeout(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }, 100);
    }

    formatMessageText(text) {
        if (!text) return '';
        
        // Split by newlines while preserving them
        const lines = text.split(/(\n)/);
        let formattedHtml = '';
        let inNumberedList = false;
        let inBulletList = false;
        let currentNumber = 1;
        let consecutiveNewlines = 0;
        
        for (let line of lines) {
            // Handle consecutive newlines
            if (line === '\n') {
                consecutiveNewlines++;
                if (consecutiveNewlines >= 2) {
                    formattedHtml += '<br>';
                }
                continue;
            }
            consecutiveNewlines = 0;
    
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
    
            const numberMatch = trimmedLine.match(/^(\d+)\.\s(.+)/);
            const bulletMatch = trimmedLine.match(/^[-•]\s(.+)/);
            const clipboardMatch = trimmedLine.match(/^\(📋\s*Copied to clipboard!\)$/);
            
            if (clipboardMatch) {
                // Special handling for clipboard message
                if (inNumberedList) {
                    formattedHtml += '</ol>';
                    inNumberedList = false;
                }
                if (inBulletList) {
                    formattedHtml += '</ul>';
                    inBulletList = false;
                }
                formattedHtml += '<br><br><span class="clipboard-message">' + trimmedLine + '</span>';
            } else if (numberMatch) {
                // ... existing numbered list handling ...
                if (!inNumberedList) {
                    if (inBulletList) {
                        formattedHtml += '</ul>';
                        inBulletList = false;
                    }
                    formattedHtml += '<ol>';
                    inNumberedList = true;
                    currentNumber = parseInt(numberMatch[1]);
                }
                formattedHtml += `<li value="${currentNumber}">${numberMatch[2]}</li>`;
                currentNumber++;
            } else if (bulletMatch) {
                // ... existing bullet list handling ...
                if (!inBulletList) {
                    if (inNumberedList) {
                        formattedHtml += '</ol>';
                        inNumberedList = false;
                    }
                    formattedHtml += '<ul>';
                    inBulletList = true;
                }
                formattedHtml += `<li>${bulletMatch[1]}</li>`;
            } else {
                // Regular text handling
                if (inNumberedList) {
                    formattedHtml += '</ol>';
                    inNumberedList = false;
                }
                if (inBulletList) {
                    formattedHtml += '</ul>';
                    inBulletList = false;
                }
                
                formattedHtml += `<span>${trimmedLine}</span>`;
            }
        }
        
        // Close any open lists
        if (inNumberedList) {
            formattedHtml += '</ol>';
        }
        if (inBulletList) {
            formattedHtml += '</ul>';
        }
        
        return formattedHtml;
    }

    async attachEventListeners() {
        try {
            const collapseBtn = this.box.querySelector('.collapse-btn');
            collapseBtn.addEventListener('click', () => this.toggleCollapse());
    
            const textarea = this.box.querySelector('textarea');
            const sendBtn = this.box.querySelector('.send-btn');
    
            textarea.addEventListener('keypress', async (e) => { // <-- Make sure this function is async
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    await this.sendMessage();
                }
            });
    
            sendBtn.addEventListener('click', async () => await this.sendMessage());
    
            // Add voice button handler
            const micBtn = this.box.querySelector('.mic-btn');
            micBtn.addEventListener('click', () => this.toggleVoiceInput());
    
            this.makeBoxDraggable();
    
            // Cleanup on page unload
            window.addEventListener('unload', () => {
                this.cleanup();
            });
    
            console.log('Event listeners attached successfully');
        } catch (error) {
            console.error('Failed to attach event listeners:', error);
            throw error;
        }
    }

    makeBoxDraggable() {
        const header = this.box.querySelector('.hover-box-header');
        let isDragging = false;
        let startX, startY;

        if (!this.box.style.left || !this.box.style.top) {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            this.box.style.left = `${Math.max(20, Math.min(viewportWidth - 470, viewportWidth / 2 - 225))}px`;
            this.box.style.top = `${Math.max(20, Math.min(viewportHeight - 520, viewportHeight / 2 - 250))}px`;
        }
    
        const onMouseDown = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            
            isDragging = true;
            const rect = this.box.getBoundingClientRect();
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;
            
            // Remove any existing transition
            this.box.style.transition = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
    
        const onMouseMove = (e) => {
            if (!isDragging) return;
            
            // Calculate new position
            const newX = e.clientX - startX;
            const newY = e.clientY - startY;
            
            // Ensure box stays within viewport bounds with a 20px margin
            const maxX = window.innerWidth - this.box.offsetWidth - 20;
            const maxY = window.innerHeight - this.box.offsetHeight - 20;
            
            this.box.style.left = `${Math.max(20, Math.min(maxX, newX))}px`;
            this.box.style.top = `${Math.max(20, Math.min(maxY, newY))}px`;
        };
    
        const onMouseUp = () => {
            isDragging = false;
            this.box.style.transition = 'all 0.3s ease';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    
        header.addEventListener('mousedown', onMouseDown);
    }

    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        this.box.classList.toggle('collapsed');
        
        const btn = this.box.querySelector('.collapse-btn');
        btn.textContent = this.isCollapsed ? '+' : '−';
        btn.setAttribute('aria-label', this.isCollapsed ? 'Expand' : 'Collapse');
    }

    toggle() {
        if (!this.box) {
            console.error('Box not initialized');
            return;
        }
    
        const isVisible = this.box.classList.contains('visible');
        
        if (isVisible) {
            // Hide
            this.box.style.opacity = '0';
            this.box.style.transform = 'translateY(-10px)';
            
            setTimeout(() => {
                this.box.classList.remove('visible');
                this.box.style.display = 'none';
            }, 300); // Match transition duration
        } else {
            // Show
            this.box.style.display = 'flex';
            // Force reflow
            this.box.offsetHeight;
            
            requestAnimationFrame(() => {
                this.box.classList.add('visible');
                this.box.style.opacity = '1';
                this.box.style.transform = 'translateY(0)';
            });
        }
    }

    // In your AIHoverBox class
    async toggleVoiceInput() {
        const micBtn = this.box.querySelector('.mic-btn');
        const textarea = this.box.querySelector('textarea');
        
        try {
            if (micBtn.classList.contains('recording')) {
                micBtn.classList.remove('recording');
                this.voiceService?.stopListening();
                return;
            }
    
            // Reinitialize voice service if needed
            if (!this.voiceService?.isInitialized) {
                this.addMessageToChat('Initializing voice service...', 'info');
                try {
                    this.voiceService = new window.VoiceService();
                    const initialized = await this.voiceService.initialize();
                    
                    if (!initialized) {
                        throw new Error('Voice service initialization failed');
                    }
                } catch (error) {
                    this.addMessageToChat('Please check your OpenAI API key configuration in settings.', 'error');
                    this.addMessageToChat('Click the ⚙️ settings icon to configure your API key.', 'info');
                    return;
                }
            }
    
            micBtn.classList.add('recording');
            await this.voiceService.startListening(
                (text) => {
                    textarea.value = text;
                    micBtn.classList.remove('recording');
                    textarea.focus();
                },
                (error) => {
                    console.error('Voice input error:', error);
                    micBtn.classList.remove('recording');
                    
                    if (error.message.includes('401') || error.message.includes('API key')) {
                        this.voiceService = null; // Reset service
                        this.addMessageToChat('OpenAI API key is invalid. Please update your settings.', 'error');
                        this.addMessageToChat('Click the ⚙️ settings icon to configure your API key.', 'info');
                    } else {
                        this.addMessageToChat(`Voice input error: ${error.message}`, 'error');
                    }
                }
            );
        } catch (error) {
            micBtn.classList.remove('recording');
            console.error('Voice input error:', error);
            this.addMessageToChat(`Voice input error: ${error.message}`, 'error');
        }
    }

    cleanup() {
        this.stopListening();
        this.openaiKey = '';
        this.isInitialized = false;
        this.audioChunks = [];
        if (this.mediaRecorder) {
            try {
                this.mediaRecorder.stop();
            } catch (e) {
                // Ignore errors during cleanup
            }
            this.mediaRecorder = null;
        }
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.debug('Content script received message:', message);
    
    if (message.action === 'toggleHoverBox') {
        let cleanup = {
            responseTimeout: null,
            initTimeout: null,
            clear: function() {
                if (this.responseTimeout) clearTimeout(this.responseTimeout);
                if (this.initTimeout) clearTimeout(this.initTimeout);
            }
        };

        cleanup.responseTimeout = setTimeout(() => {
            cleanup.clear();
            if (sendResponse) {
                sendResponse({ 
                    success: false, 
                    error: 'Operation timed out while waiting for response' 
                });
            }
        }, 5000);

        const initAndToggle = async () => {
            try {
                // Check for required services first
                if (!window.AIService || !window.ContextService || !window.UsageTracker) {
                    throw new Error('Required services not loaded. Please refresh the page.');
                }

                if (!window.hoverBox || !window.hoverBox.box) {
                    console.debug('Initializing new AIHoverBox');
                    
                    if (window.hoverBox) {
                        await window.hoverBox.cleanup();
                    }
                    
                    window.hoverBox = new AIHoverBox();
                    
                    cleanup.initTimeout = setTimeout(() => {
                        throw new Error('HoverBox initialization timed out');
                    }, 10000);

                    await window.hoverBox.initPromise;
                    clearTimeout(cleanup.initTimeout);
                    
                    if (!window.hoverBox.box?.isConnected) {
                        throw new Error('HoverBox failed to initialize properly');
                    }
                }

                await window.hoverBox.toggle();
                
                cleanup.clear();
                sendResponse({ 
                    success: true,
                    status: window.hoverBox.box.classList.contains('visible') ? 'opened' : 'closed'
                });

            } catch (error) {
                console.error('Error in toggleHoverBox:', error);
                
                if (window.hoverBox) {
                    try {
                        await window.hoverBox.cleanup();
                    } catch (cleanupError) {
                        console.error('Cleanup error:', cleanupError);
                    }
                    window.hoverBox = null;
                }

                cleanup.clear();
                sendResponse({ 
                    success: false, 
                    error: error.message || 'Unknown error occurred',
                    details: {
                        type: error.name,
                        stack: error.stack
                    }
                });
            }
        };

        initAndToggle().catch(error => {
            console.error('Unhandled error in initAndToggle:', error);
            cleanup.clear();
            sendResponse({ 
                success: false, 
                error: error.message || 'Unhandled error occurred',
                details: {
                    type: error.name,
                    message: error.message,
                    stack: error.stack
                }
            });
        });

        return true;
    }
    
    sendResponse({ 
        success: false, 
        error: `Unknown action: ${message.action}` 
    });
    return false;
});

function showEditPrompt() {
    return new Promise((resolve) => {
        const prompt = window.prompt('How would you like to edit this text?');
        resolve(prompt);
    });
}

async function replaceSelectedText(newText) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return false;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const editable = container.nodeType === Node.TEXT_NODE ? 
        container.parentElement.isContentEditable : 
        container.isContentEditable;

    if (!editable) return false;

    try {
        range.deleteContents();
        range.insertNode(document.createTextNode(newText));
        return true;
    } catch (error) {
        console.error('Error replacing text:', error);
        return false;
    }
}

// Log that content script is loaded
console.log('Content script loaded and ready');