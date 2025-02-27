if (!window.MemoryService) {
  window.MemoryService = class MemoryService {
    constructor() {
        this.MEMORY_KEY = 'ai_sidebar_memory';
        this.MAX_MESSAGES = 50;
        this.SESSION_ID = Date.now().toString();
        this.initialized = false;
        this.initPromise = this.initialize();
    }

    async initialize() {
        try {
            await chrome.storage.local.get(['userId']);
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('Storage initialization failed:', error);
            return false;
        }
    }

    async ensureInitialized() {
        if (!this.initialized) {
            await this.initPromise;
        }
    }

    async getUserId() {
        await this.ensureInitialized();
        return new Promise((resolve) => {
            chrome.storage.local.get(['userId'], (result) => {
                if (result.userId) {
                    resolve(result.userId);
                } else {
                    const newUserId = 'user_' + Date.now();
                    chrome.storage.local.set({ userId: newUserId });
                    resolve(newUserId);
                }
            });
        });
    }

    async storeConversation(message, response, model) {
        if (!message || !response) {
            console.warn('Invalid message or response');
            return null;
        }

        await this.ensureInitialized();
        const userId = await this.getUserId();
        const conversationKey = `${this.MEMORY_KEY}_${userId}`;
        
        return new Promise((resolve) => {
            chrome.storage.local.get([conversationKey], (result) => {
                const conversations = result[conversationKey] || [];
                const newConversation = {
                    timestamp: Date.now(),
                    sessionId: this.SESSION_ID,
                    message,
                    response,
                    model
                };

                conversations.push(newConversation);
                
                if (conversations.length > this.MAX_MESSAGES) {
                    conversations.shift();
                }

                chrome.storage.local.set({
                    [conversationKey]: conversations
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('Storage error:', chrome.runtime.lastError);
                        resolve(null);
                    } else {
                        resolve(conversations);
                    }
                });
            });
        });
    }

    async getConversationsBySession() {
        await this.ensureInitialized();
        const userId = await this.getUserId();
        const conversationKey = `${this.MEMORY_KEY}_${userId}`;
        
        return new Promise((resolve) => {
            chrome.storage.local.get([conversationKey], (result) => {
                const conversations = result[conversationKey] || [];
                const sessionConversations = conversations.filter(
                    conv => conv.sessionId === this.SESSION_ID
                );
                resolve(sessionConversations);
            });
        });
    }

    async getAllConversations() {
        await this.ensureInitialized();
        const userId = await this.getUserId();
        const conversationKey = `${this.MEMORY_KEY}_${userId}`;
        
        return new Promise((resolve) => {
            chrome.storage.local.get([conversationKey], (result) => {
                resolve(result[conversationKey] || []);
            });
        });
    }

    async clearConversations() {
        await this.ensureInitialized();
        const userId = await this.getUserId();
        const conversationKey = `${this.MEMORY_KEY}_${userId}`;
        
        return new Promise((resolve) => {
            chrome.storage.local.set({
                [conversationKey]: []
            }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Clear error:', chrome.runtime.lastError);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }
  };
}