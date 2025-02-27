/**
 * AIHoverBox - Shadow DOM implementation to prevent CSS leakage
 */
class AIHoverBox {
    constructor() {
        // Core state
        this.rootElement = null;
        this.shadowRoot = null;
        this.box = null;
        this.isVisible = false;
        this.isCollapsed = false;
        this.position = { x: 0, y: 0 };
        this.dragOffset = { x: 0, y: 0 };
        this.messageQueue = Promise.resolve();
        this.activeModel = 'claude';
        
        // Services
        this.aiService = null;
        this.contextService = null;
        this.usageTracker = null;
        this.voiceService = null;
        
        // Bound methods to maintain context
        this._boundResizeHandler = this._handleResize.bind(this);
        this._boundVisibilityHandler = this._handleVisibilityChange.bind(this);
        this._boundUnloadHandler = this.cleanup.bind(this);
        
        // Initialize
        this.initPromise = this._initialize();
    }
    
    /**
     * Initialize the hover box with shadow DOM
     */
    async _initialize() {
        try {
            // Wait for services to be available
            await this._initializeServices();
            
            // Create root element and shadow DOM
            this.rootElement = document.createElement('div');
            this.rootElement.id = 'ai-hover-assistant-root';
            this.rootElement.style.all = 'initial';
            
            // Create shadow DOM
            this.shadowRoot = this.rootElement.attachShadow({ mode: 'closed' });
            
            // Add styles
            const styles = document.createElement('style');
            styles.textContent = this._getStyles();
            this.shadowRoot.appendChild(styles);
            
            // Create hover box
            this.box = document.createElement('div');
            this.box.className = 'ai-hover-box';
            this.shadowRoot.appendChild(this.box);
            
            // Set up the hover box content
            this._createBoxContent();
            
            // Add to document
            document.body.appendChild(this.rootElement);
            
            // Set initial position
            this._setInitialPosition();
            
            // Add event listeners
            this._attachEventListeners();
            
            // Set up credits display
            const credits = await this.usageTracker.checkUsageLimit();
            await this._updateCreditsDisplay(credits);
            
            // Load stored size
            await this._loadSavedSize();
            
            return true;
        } catch (error) {
            console.error('AIHoverBox initialization failed:', error);
            await this.cleanup();
            throw error;
        }
    }
    
    /**
     * Create the HTML content for the hover box
     */
    _createBoxContent() {
        this.box.innerHTML = `
            <div class="hover-box-header">
                <div class="header-left">
                    <button class="collapse-btn" aria-label="Toggle collapse">−</button>
                    <span class="header-title">AI Assistant</span>
                </div>
                <div class="header-middle">
                    <select class="model-selector" aria-label="Select AI model">
                        <option value="claude">Claude</option>
                        <option value="perplexity">Perplexity</option>
                        <option value="openai">OpenAI</option>
                    </select>
                </div>
                <div class="header-right">
                    <span class="credits-badge">-- credits</span>
                    <button class="close-btn" aria-label="Close">×</button>
                </div>
            </div>
            <div class="chat-container" role="log" aria-live="polite"></div>
            <div class="input-container">
                <div class="voice-controls">
                    <label class="voice-toggle">
                        <input type="checkbox" class="voice-input-toggle">
                        <span>Voice Input</span>
                    </label>
                    <label class="voice-toggle">
                        <input type="checkbox" class="voice-output-toggle">
                        <span>Voice Output</span>
                    </label>
                </div>
                <textarea 
                    placeholder="Ask anything about this page..." 
                    rows="3" 
                    aria-label="Message input"
                ></textarea>
                <div class="input-controls">
                    <button class="mic-btn" aria-label="Voice input">
                        🎤
                        <div class="recording-indicator"></div>
                    </button>
                    <button class="send-btn" aria-label="Send message">Send</button>
                    <div class="export-dropdown">
                        <button class="export-btn" aria-label="Export conversation">⤓</button>
                        <div class="export-options">
                            <button data-format="txt">Export as TXT</button>
                            <button data-format="json">Export as JSON</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="resize-handle" aria-label="Resize"></div>
        `;
    }
    
    /**
     * CSS styles for the shadow DOM
     */
    _getStyles() {
        return `
            .ai-hover-box {
                position: fixed;
                top: 50px;
                right: 20px;
                width: 450px;
                height: 500px;
                background: rgba(30, 30, 30, 0.95);
                border-radius: 10px;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                transition: opacity 0.3s ease, transform 0.3s ease;
                display: none;
                flex-direction: column;
                padding: 0;
                color: #ffffff;
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                opacity: 0;
                transform: translateY(-10px);
            }
            
            .ai-hover-box.visible {
                display: flex;
                opacity: 1;
                transform: translateY(0);
            }
            
            .hover-box-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 15px;
                background: rgba(20, 20, 20, 0.8);
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 10px 10px 0 0;
                user-select: none;
            }
            
            .header-left, .header-right, .header-middle {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .header-title {
                font-size: 14px;
                font-weight: 500;
                white-space: nowrap;
            }
            
            .model-selector {
                background: rgba(40, 40, 40, 0.8);
                color: white;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 4px;
                padding: 4px 8px;
                font-size: 12px;
                outline: none;
            }
            
            .model-selector option {
                background: #333;
            }
            
            .credits-badge {
                font-size: 11px;
                padding: 2px 6px;
                background: rgba(74, 144, 226, 0.2);
                border-radius: 10px;
                white-space: nowrap;
            }
            
            .collapse-btn, .close-btn {
                background: none;
                border: none;
                color: white;
                cursor: pointer;
                font-size: 16px;
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: background-color 0.2s;
            }
            
            .collapse-btn:hover, .close-btn:hover {
                background: rgba(255, 255, 255, 0.1);
            }
            
            .chat-container {
                flex: 1;
                overflow-y: auto;
                padding: 15px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                scrollbar-width: thin;
                scrollbar-color: rgba(100, 100, 100, 0.4) rgba(30, 30, 30, 0.2);
            }
            
            .chat-container::-webkit-scrollbar {
                width: 6px;
            }
            
            .chat-container::-webkit-scrollbar-track {
                background: rgba(30, 30, 30, 0.2);
                border-radius: 3px;
            }
            
            .chat-container::-webkit-scrollbar-thumb {
                background: rgba(100, 100, 100, 0.4);
                border-radius: 3px;
            }
            
            .message {
                max-width: 85%;
                padding: 10px 12px;
                border-radius: 12px;
                font-size: 14px;
                line-height: 1.4;
                animation: fadeIn 0.2s ease-out;
            }
            
            .message.user {
                background: rgba(43, 92, 155, 0.6);
                align-self: flex-end;
                border-bottom-right-radius: 4px;
            }
            
            .message.assistant {
                background: rgba(56, 56, 56, 0.6);
                align-self: flex-start;
                border-bottom-left-radius: 4px;
            }
            
            .message.error {
                background: rgba(185, 28, 28, 0.6);
                align-self: center;
                text-align: center;
                font-size: 13px;
            }
            
            .message-timestamp {
                font-size: 10px;
                color: rgba(255, 255, 255, 0.5);
                margin-bottom: 4px;
            }
            
            .input-container {
                padding: 10px 15px 15px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .voice-controls {
                display: flex;
                gap: 15px;
                margin-bottom: 8px;
                font-size: 12px;
            }
            
            .voice-toggle {
                display: flex;
                align-items: center;
                gap: 5px;
                cursor: pointer;
                user-select: none;
            }
            
            .voice-toggle input {
                margin: 0;
            }
            
            textarea {
                width: 100%;
                padding: 10px 12px;
                background: rgba(40, 40, 40, 0.8);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: white;
                font-family: inherit;
                font-size: 14px;
                resize: none;
                outline: none;
                margin-bottom: 8px;
                box-sizing: border-box;
                line-height: 1.4;
                min-height: 60px;
                max-height: 150px;
                transition: border-color 0.2s;
            }
            
            textarea:focus {
                border-color: #4a90e2;
            }
            
            .input-controls {
                display: flex;
                gap: 8px;
                align-items: center;
            }
            
            .send-btn {
                flex: 1;
                padding: 8px 16px;
                background: #4a90e2;
                color: white;
                border: none;
                border-radius: 4px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: background-color 0.2s;
            }
            
            .send-btn:hover {
                background: #3a7bc8;
            }
            
            .send-btn:disabled {
                background: rgba(74, 144, 226, 0.5);
                cursor: not-allowed;
            }
            
            .mic-btn {
                width: 34px;
                height: 34px;
                background: rgba(60, 60, 60, 0.8);
                border: none;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                position: relative;
                transition: background-color 0.2s;
            }
            
            .mic-btn:hover {
                background: rgba(80, 80, 80, 0.8);
            }
            
            .recording-indicator {
                position: absolute;
                top: 3px;
                right: 3px;
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #ff4444;
                opacity: 0;
            }
            
            .mic-btn.recording .recording-indicator {
                opacity: 1;
                animation: blink 1.5s infinite;
            }
            
            .export-dropdown {
                position: relative;
            }
            
            .export-btn {
                width: 34px;
                height: 34px;
                background: rgba(60, 60, 60, 0.8);
                border: none;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 16px;
                transition: background-color 0.2s;
            }
            
            .export-btn:hover {
                background: rgba(80, 80, 80, 0.8);
            }
            
            .export-options {
                position: absolute;
                bottom: 100%;
                right: 0;
                background: rgba(40, 40, 40, 0.95);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 4px;
                padding: 5px;
                display: none;
                flex-direction: column;
                gap: 5px;
                margin-bottom: 5px;
                width: 120px;
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
            }
            
            .export-dropdown:hover .export-options {
                display: flex;
            }
            
            .export-options button {
                background: none;
                border: none;
                color: white;
                padding: 8px;
                text-align: left;
                font-size: 12px;
                cursor: pointer;
                border-radius: 3px;
                transition: background-color 0.2s;
            }
            
            .export-options button:hover {
                background: rgba(255, 255, 255, 0.1);
            }
            
            .resize-handle {
                position: absolute;
                bottom: 0;
                left: 50%;
                transform: translateX(-50%);
                width: 40px;
                height: 4px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 2px;
                cursor: ns-resize;
                transition: background-color 0.2s;
            }
            
            .resize-handle:hover {
                background: rgba(255, 255, 255, 0.3);
            }
            
            .ai-hover-box.collapsed {
                width: 40px;
                height: 40px;
                border-radius: 20px;
                overflow: hidden;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .ai-hover-box.collapsed .collapse-btn {
                position: absolute;
                transform: rotate(45deg);
                transition: transform 0.3s;
            }
            
            @keyframes fadeIn {
                from {
                    opacity: 0;
                    transform: translateY(5px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            @keyframes blink {
                0% { opacity: 1; }
                50% { opacity: 0.3; }
                100% { opacity: 1; }
            }
        `;
    }
    
    /**
     * Initialize the service dependencies
     */
    async _initializeServices() {
        // Wait for required services
        const servicesAvailable = await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (window.AIService && window.ContextService && 
                    window.VoiceService && window.UsageTracker) {
                    clearInterval(checkInterval);
                    resolve(true);
                }
            }, 200);
            
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve(false);
            }, 5000);
        });
        
        if (!servicesAvailable) {
            throw new Error('Required services not available');
        }
        
        // Initialize services
        this.aiService = new window.AIService();
        await this.aiService.initPromise;
        
        this.contextService = new window.ContextService();
        
        this.usageTracker = new window.UsageTracker();
        await this.usageTracker.initPromise;
        
        // Voice service is optional
        if (navigator.mediaDevices?.getUserMedia) {
            try {
                this.voiceService = new window.VoiceService();
                await this.voiceService.initPromise;
            } catch (error) {
                console.warn('Voice service initialization failed, continuing without voice support:', error);
                this.voiceService = null;
            }
        }
    }
    
    /**
     * Set initial position based on viewport
     */
    _setInitialPosition() {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        this.position.x = Math.max(20, Math.min(viewportWidth - 470, viewportWidth / 2 - 225));
        this.position.y = Math.max(20, Math.min(viewportHeight - 520, viewportHeight / 2 - 250));
        
        this.box.style.left = `${this.position.x}px`;
        this.box.style.top = `${this.position.y}px`;
    }
    
    /**
     * Attach all event listeners
     */
    _attachEventListeners() {
        window.addEventListener('resize', this._boundResizeHandler);
        window.addEventListener('unload', this._boundUnloadHandler);
        document.addEventListener('visibilitychange', this._boundVisibilityHandler);
        
        // Header event listeners
        const header = this.box.querySelector('.hover-box-header');
        const collapseBtn = this.box.querySelector('.collapse-btn');
        const closeBtn = this.box.querySelector('.close-btn');
        
        // Make draggable
        this._makeDraggable(header);
        
        // Collapse button
        collapseBtn.addEventListener('click', () => this._toggleCollapse());
        
        // Close button
        closeBtn.addEventListener('click', () => this.toggle(false));
        
        // Text input
        const textarea = this.box.querySelector('textarea');
        const sendBtn = this.box.querySelector('.send-btn');
        const micBtn = this.box.querySelector('.mic-btn');
        
        // Send message on Enter
        textarea.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._sendMessage();
            }
        });
        
        // Auto-resize textarea
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(150, Math.max(60, textarea.scrollHeight)) + 'px';
        });
        
        // Send button
        sendBtn.addEventListener('click', () => this._sendMessage());
        
        // Voice input
        micBtn.addEventListener('click', () => this._toggleVoiceInput());
        
        // Voice toggles
        const voiceInputToggle = this.box.querySelector('.voice-input-toggle');
        const voiceOutputToggle = this.box.querySelector('.voice-output-toggle');
        
        voiceInputToggle.addEventListener('change', () => {
            this._setVoiceInputEnabled(voiceInputToggle.checked);
        });
        
        voiceOutputToggle.addEventListener('change', () => {
            this._setVoiceOutputEnabled(voiceOutputToggle.checked);
        });
        
        // Model selector
        const modelSelector = this.box.querySelector('.model-selector');
        modelSelector.value = this.activeModel;
        modelSelector.addEventListener('change', () => {
            this.activeModel = modelSelector.value;
            this._savePreferences();
        });
        
        // Export buttons
        const exportOptions = this.box.querySelectorAll('.export-options button');
        exportOptions.forEach(button => {
            button.addEventListener('click', () => {
                this._exportConversation(button.dataset.format);
            });
        });
        
        // Resize handle
        this._makeResizable();
    }
    
    /**
     * Make the box draggable
     */
    _makeDraggable(headerElement) {
        headerElement.style.cursor = 'move';
        
        headerElement.addEventListener('mousedown', (e) => {
            // Skip if clicking buttons or select
            if (e.target.tagName === 'BUTTON' || 
                e.target.tagName === 'SELECT' ||
                e.target.tagName === 'OPTION') {
                return;
            }
            
            const rect = this.box.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            
            // Remove transitions during drag
            this.box.style.transition = 'none';
            
            const mouseMoveHandler = (e) => {
                this.position.x = e.clientX - this.dragOffset.x;
                this.position.y = e.clientY - this.dragOffset.y;
                
                // Ensure box stays within viewport
                this._constrainToViewport();
                this.box.style.left = `${this.position.x}px`;
                this.box.style.top = `${this.position.y}px`;
            };
            
            const mouseUpHandler = () => {
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);
                
                // Restore transitions
                this.box.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                
                // Save position
                this._savePosition();
            };
            
            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        });
    }
    
    /**
     * Make the box resizable
     */
    _makeResizable() {
        const resizeHandle = this.box.querySelector('.resize-handle');
        
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            
            const startY = e.clientY;
            const startHeight = this.box.offsetHeight;
            const MIN_HEIGHT = 300;
            const MAX_HEIGHT = window.innerHeight - 100;
            
            // Disable transitions during resize
            this.box.style.transition = 'none';
            
            const mouseMoveHandler = (e) => {
                const deltaY = e.clientY - startY;
                const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + deltaY));
                this.box.style.height = `${newHeight}px`;
            };
            
            const mouseUpHandler = () => {
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);
                
                // Restore transitions
                this.box.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                
                // Save size
                this._saveSize();
            };
            
            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        });
    }
    
    /**
     * Constrain the box position to viewport
     */
    _constrainToViewport() {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const boxWidth = this.isCollapsed ? 40 : this.box.offsetWidth;
        const boxHeight = this.isCollapsed ? 40 : this.box.offsetHeight;
        
        this.position.x = Math.max(0, Math.min(viewportWidth - boxWidth, this.position.x));
        this.position.y = Math.max(0, Math.min(viewportHeight - boxHeight, this.position.y));
    }
    
    /**
     * Handle window resize
     */
    _handleResize() {
        this._constrainToViewport();
        this.box.style.left = `${this.position.x}px`;
        this.box.style.top = `${this.position.y}px`;
    }
    
    /**
     * Handle visibility change
     */
    _handleVisibilityChange() {
        if (document.hidden && this.isVisible) {
            this._savePosition();
            this._saveSize();
        }
    }
    
    /**
     * Toggle the box visibility
     */
    toggle(forceState) {
        // If forceState is provided, use it, otherwise toggle
        const shouldBeVisible = forceState !== undefined ? forceState : !this.isVisible;
        
        if (shouldBeVisible === this.isVisible) return;
        
        if (shouldBeVisible) {
            // Show
            this.box.style.display = 'flex';
            // Force reflow
            this.box.offsetHeight;
            
            requestAnimationFrame(() => {
                this.box.classList.add('visible');
            });
            
            this.isVisible = true;
        } else {
            // Hide
            this.box.classList.remove('visible');
            
            setTimeout(() => {
                if (!this.box) return; // Check if box still exists
                this.box.style.display = 'none';
            }, 300); // Match transition duration
            
            this.isVisible = false;
        }
    }
    
    /**
     * Toggle collapse state
     */
    _toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        this.box.classList.toggle('collapsed', this.isCollapsed);
        
        const collapseBtn = this.box.querySelector('.collapse-btn');
        collapseBtn.textContent = this.isCollapsed ? '+' : '−';
        collapseBtn.setAttribute('aria-label', this.isCollapsed ? 'Expand' : 'Collapse');
        
        this._constrainToViewport();
    }
    
    /**
     * Send a message
     */
    async _sendMessage() {
        const textarea = this.box.querySelector('textarea');
        const message = textarea.value.trim();
        
        if (!message) return;
        
        try {
            // Add loading state
            const sendBtn = this.box.querySelector('.send-btn');
            textarea.disabled = true;
            sendBtn.disabled = true;
            sendBtn.textContent = 'Sending...';
            
            // Add user message to chat
            this._addMessageToChat(message, 'user');
            
            // Clear input
            textarea.value = '';
            
            // Get context and query AI
            const context = await this.contextService.captureContext();
            const response = await this.aiService.queryByModel(
                message,
                context,
                this.activeModel
            );
            
            // Update usage
            const usageInfo = await this.usageTracker.incrementUsage();
            await this._updateCreditsDisplay(usageInfo);
            
            // Add response to chat
            this._addMessageToChat(response.text, 'assistant');
            
            // Check if voice output is enabled
            const voiceOutputEnabled = this.box.querySelector('.voice-output-toggle').checked;
            if (voiceOutputEnabled && this.voiceService) {
                this._speakResponse(response.text);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            this._addMessageToChat(`Error: ${error.message}. Please try again.`, 'error');
        } finally {
            // Reset loading state
            textarea.disabled = false;
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
            textarea.focus();
        }
    }
    
    /**
     * Add a message to the chat
     */
    _addMessageToChat(text, type) {
        if (!text) return;
        
        const chatContainer = this.box.querySelector('.chat-container');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        const timestamp = document.createElement('div');
        timestamp.className = 'message-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        
        const content = document.createElement('div');
        content.className = 'message-content';
        content.textContent = text;
        
        messageDiv.appendChild(timestamp);
        messageDiv.appendChild(content);
        
        chatContainer.appendChild(messageDiv);
        
        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    
    /**
     * Update the credits display
     */
    async _updateCreditsDisplay(creditsInfo = null) {
        try {
            const creditsBadge = this.box.querySelector('.credits-badge');
            if (!creditsBadge) return;
            
            // Get credits if not provided
            const credits = creditsInfo || await this.usageTracker.checkUsageLimit();
            
            if (credits && typeof credits.remaining === 'number') {
                creditsBadge.textContent = `${credits.remaining} credits`;
                
                // Update styling based on remaining credits
                if (credits.remaining <= 5 && !credits.exceeded) {
                    creditsBadge.style.background = 'rgba(255, 165, 0, 0.2)';
                } else if (credits.exceeded) {
                    creditsBadge.style.background = 'rgba(255, 59, 48, 0.2)';
                    this._showUpgradePrompt();
                } else {
                    creditsBadge.style.background = 'rgba(74, 144, 226, 0.2)';
                }
            } else {
                creditsBadge.textContent = '-- credits';
            }
        } catch (error) {
            console.error('Error updating credits display:', error);
        }
    }
    
    /**
     * Show upgrade prompt when credits are exhausted
     */
    async _showUpgradePrompt() {
        // Get upgrade info from usage tracker
        const upgradeInfo = await this.usageTracker.showUpgradePrompt();
        
        // Remove existing prompt if any
        const existingPrompt = this.shadowRoot.querySelector('.upgrade-prompt');
        if (existingPrompt) existingPrompt.remove();
        
        // Create prompt element
        const prompt = document.createElement('div');
        prompt.className = 'upgrade-prompt';
        prompt.innerHTML = `
            <h3>${upgradeInfo.title}</h3>
            <p>${upgradeInfo.message}</p>
            <a href="${upgradeInfo.actionUrl}" target="_blank">${upgradeInfo.actionText}</a>
        `;
        
        // Add styles
        const styles = document.createElement('style');
        styles.textContent = `
            .upgrade-prompt {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(30, 30, 30, 0.95);
                padding: 20px;
                border-radius: 8px;
                text-align: center;
                width: 80%;
                z-index: 10;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            }
            
            .upgrade-prompt h3 {
                margin: 0 0 10px 0;
                font-size: 16px;
            }
            
            .upgrade-prompt p {
                margin: 0 0 15px 0;
                font-size: 14px;
                opacity: 0.8;
            }
            
            .upgrade-prompt a {
                display: inline-block;
                padding: 8px 16px;
                background: #4a90e2;
                color: white;
                text-decoration: none;
                border-radius: 4px;
                font-weight: 500;
            }
            
            .upgrade-prompt a:hover {
                background: #3a7bc8;
            }
        `;
        
        this.shadowRoot.appendChild(styles);
        this.box.appendChild(prompt);
        
        // Disable input
        const textarea = this.box.querySelector('textarea');
        const sendBtn = this.box.querySelector('.send-btn');
        textarea.disabled = true;
        sendBtn.disabled = true;
    }
    
    /**
     * Toggle voice input
     */
    async _toggleVoiceInput() {
        if (!this.voiceService) {
            this._addMessageToChat('Voice service is not available.', 'error');
            return;
        }
        
        const micBtn = this.box.querySelector('.mic-btn');
        const textarea = this.box.querySelector('textarea');
        
        // If already recording, stop
        if (micBtn.classList.contains('recording')) {
            micBtn.classList.remove('recording');
            this.voiceService.stopListening();
            return;
        }
        
        // Start recording
        try {
            micBtn.classList.add('recording');
            
            await this.voiceService.startListening(
                (text) => {
                    // Success callback
                    textarea.value = text;
                    micBtn.classList.remove('recording');
                    textarea.focus();
                    
                    // Trigger auto-resize
                    const event = new Event('input');
                    textarea.dispatchEvent(event);
                },
                (error) => {
                    // Error callback
                    console.error('Voice input error:', error);
                    micBtn.classList.remove('recording');
                    this._addMessageToChat(`Voice input error: ${error.message}`, 'error');
                }
            );
        } catch (error) {
            console.error('Voice input error:', error);
            micBtn.classList.remove('recording');
            this._addMessageToChat(`Voice input error: ${error.message}`, 'error');
        }
    }
    
    /**
     * Speak a response using text-to-speech
     */
    async _speakResponse(text) {
        // If TTS is not yet implemented, show message
        this._addMessageToChat('Text-to-speech not yet implemented', 'info');
    }
    
    /**
     * Enable/disable voice input
     */
    _setVoiceInputEnabled(enabled) {
        const micBtn = this.box.querySelector('.mic-btn');
        micBtn.style.display = enabled ? 'flex' : 'none';
        this._savePreferences();
    }
    
    /**
     * Enable/disable voice output
     */
    _setVoiceOutputEnabled(enabled) {
        // Save preference
        this._savePreferences();
    }
    
    /**
     * Export conversation
     */
    async _exportConversation(format = 'txt') {
        try {
            // Get all messages
            const messages = Array.from(this.box.querySelectorAll('.message'));
            let output = '';
            
            if (format === 'txt') {
                // Plain text format
                messages.forEach(msg => {
                    const timestamp = msg.querySelector('.message-timestamp').textContent;
                    const content = msg.querySelector('.message-content').textContent;
                    const type = msg.classList.contains('user') ? 'User' : 'Assistant';
                    
                    output += `[${timestamp}] ${type}: ${content}\n\n`;
                });
            } else if (format === 'json') {
                // JSON format
                const jsonOutput = messages.map(msg => {
                    const timestamp = msg.querySelector('.message-timestamp').textContent;
                    const content = msg.querySelector('.message-content').textContent;
                    const type = msg.classList.contains('user') ? 'user' : 'assistant';
                    
                    return {
                        timestamp,
                        type,
                        content
                    };
                });
                
                output = JSON.stringify(jsonOutput, null, 2);
            }
            
            // Create download
            const blob = new Blob([output], { type: format === 'json' ? 'application/json' : 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `conversation-${new Date().toISOString().slice(0, 10)}.${format}`;
            a.click();
            
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error exporting conversation:', error);
            this._addMessageToChat(`Error exporting conversation: ${error.message}`, 'error');
        }
    }
    
    /**
     * Save box position to storage
     */
    _savePosition() {
        try {
            chrome.storage.local.set({
                'ai_box_position': {
                    x: this.position.x,
                    y: this.position.y,
                    timestamp: Date.now()
                }
            });
        } catch (error) {
            console.warn('Failed to save position:', error);
        }
    }
    
    /**
     * Save box size to storage
     */
    _saveSize() {
        try {
            chrome.storage.local.set({
                'ai_box_size': {
                    height: this.box.offsetHeight,
                    timestamp: Date.now()
                }
            });
        } catch (error) {
            console.warn('Failed to save size:', error);
        }
    }
    
    /**
     * Save user preferences
     */
    _savePreferences() {
        try {
            const voiceInputEnabled = this.box.querySelector('.voice-input-toggle').checked;
            const voiceOutputEnabled = this.box.querySelector('.voice-output-toggle').checked;
            
            chrome.storage.local.set({
                'ai_box_preferences': {
                    activeModel: this.activeModel,
                    voiceInputEnabled,
                    voiceOutputEnabled,
                    timestamp: Date.now()
                }
            });
        } catch (error) {
            console.warn('Failed to save preferences:', error);
        }
    }
    
    /**
     * Load saved box size
     */
    async _loadSavedSize() {
        try {
            const result = await chrome.storage.local.get('ai_box_size');
            if (result.ai_box_size && Date.now() - result.ai_box_size.timestamp < 86400000) {
                const { height } = result.ai_box_size;
                if (height) {
                    this.box.style.height = `${height}px`;
                }
            }
        } catch (error) {
            console.warn('Failed to load saved size:', error);
        }
    }
    
    /**
     * Load saved preferences
     */
    async _loadSavedPreferences() {
        try {
            const result = await chrome.storage.local.get('ai_box_preferences');
            if (result.ai_box_preferences) {
                const { activeModel, voiceInputEnabled, voiceOutputEnabled } = result.ai_box_preferences;
                
                // Set model
                if (activeModel) {
                    this.activeModel = activeModel;
                    this.box.querySelector('.model-selector').value = activeModel;
                }
                
                // Set voice toggles
                if (voiceInputEnabled !== undefined) {
                    this.box.querySelector('.voice-input-toggle').checked = voiceInputEnabled;
                    this._setVoiceInputEnabled(voiceInputEnabled);
                }
                
                if (voiceOutputEnabled !== undefined) {
                    this.box.querySelector('.voice-output-toggle').checked = voiceOutputEnabled;
                }
            }
        } catch (error) {
            console.warn('Failed to load preferences:', error);
        }
    }
    
    /**
     * Clean up all resources
     */
    async cleanup() {
        try {
            // Remove event listeners
            window.removeEventListener('resize', this._boundResizeHandler);
            window.removeEventListener('unload', this._boundUnloadHandler);
            document.removeEventListener('visibilitychange', this._boundVisibilityHandler);
            
            // Save state
            if (this.isVisible) {
                this._savePosition();
                this._saveSize();
                this._savePreferences();
            }
            
            // Cleanup services
            if (this.voiceService) {
                this.voiceService.cleanup();
                this.voiceService = null;
            }
            
            // Remove DOM elements
            if (this.rootElement) {
                this.rootElement.remove();
                this.rootElement = null;
                this.shadowRoot = null;
                this.box = null;
            }
            
            console.log('AIHoverBox cleanup completed');
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }
}

// Export the class
window.AIHoverBox = AIHoverBox;