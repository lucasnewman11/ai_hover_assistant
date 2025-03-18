document.addEventListener('DOMContentLoaded', async () => {
    let usageTracker;

    const updateUsageCount = async () => {
        try {
            if (!usageTracker) {
                usageTracker = new window.UsageTracker();
            }
            const { remaining } = await usageTracker.checkUsageLimit();
            const counter = document.getElementById('usagetracker');
            if (counter) {
                counter.textContent = `${remaining}`;
            }
        } catch (error) {
            console.error('Error updating usage count:', error);
            const counter = document.getElementById('usagetracker');
            if (counter) {
                counter.textContent = '--';
            }
        }
    };     

    const initializeUsage = async () => {
        const userIdResult = await chrome.storage.local.get(['userId']);
        if (!userIdResult.userId) {
            const newUserId = 'user_' + Date.now();
            await chrome.storage.local.set({ 
                userId: newUserId,
                [`ai_sidebar_usage_${newUserId}`]: 0
            });
        }
    };

    const initializeSettings = async () => {
        const result = await chrome.storage.local.get(['settings']);
        const settings = result.settings || { voiceEnabled: true };
        const voiceToggle = document.getElementById('voiceEnabled');
        if (voiceToggle) {
            voiceToggle.checked = settings.voiceEnabled;
        }
    };

    // Initialize API Key modal functionality
    const initializeApiKeyModal = () => {
        const modal = document.getElementById('apiKeyModal');
        const openModalBtn = document.getElementById('configureApiKeys');
        const closeBtn = document.querySelector('.modal .close');
        const form = document.getElementById('apiKeyForm');
        
        // Load existing API keys
        chrome.storage.local.get(['claudeKey', 'perplexityKey', 'openaiKey'], (result) => {
            if (result.claudeKey) {
                document.getElementById('claudeKey').value = result.claudeKey;
            }
            if (result.perplexityKey) {
                document.getElementById('perplexityKey').value = result.perplexityKey;
            }
            if (result.openaiKey) {
                document.getElementById('openaiKey').value = result.openaiKey;
            }
        });
        
        // Open modal
        openModalBtn.addEventListener('click', () => {
            modal.style.display = 'block';
            document.getElementById('keyError').style.display = 'none';
            document.getElementById('keySuccess').style.display = 'none';
        });
        
        // Close modal
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
        
        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
        
        // Submit form
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const claudeKey = document.getElementById('claudeKey').value.trim();
            const perplexityKey = document.getElementById('perplexityKey').value.trim();
            const openaiKey = document.getElementById('openaiKey').value.trim();
            
            if (!claudeKey || !perplexityKey) {
                document.getElementById('keyError').textContent = 'Both Claude and Perplexity keys are required.';
                document.getElementById('keyError').style.display = 'block';
                return;
            }
            
            try {
                // Store keys in Chrome's local storage
                await chrome.storage.local.set({
                    claudeKey,
                    perplexityKey,
                    openaiKey: openaiKey || ''
                });
                
                // Update keys in memory
                await chrome.runtime.sendMessage({
                    action: 'updateAPIKey',
                    keyType: 'claude',
                    key: claudeKey
                });
                
                await chrome.runtime.sendMessage({
                    action: 'updateAPIKey',
                    keyType: 'perplexity',
                    key: perplexityKey
                });
                
                if (openaiKey) {
                    await chrome.runtime.sendMessage({
                        action: 'updateAPIKey',
                        keyType: 'openai',
                        key: openaiKey
                    });
                }
                
                // Update .env file content (available in developer mode only)
                try {
                    const envContent = `# API Keys
CLAUDE_API_KEY="${claudeKey}"
PERPLEXITY_API_KEY="${perplexityKey}"
OPENAI_API_KEY="${openaiKey || ''}"
`;
                    
                    await chrome.runtime.sendMessage({
                        action: 'updateEnvFile',
                        content: envContent
                    });
                } catch (envError) {
                    console.warn('Could not update .env file. This is expected in production.', envError);
                }
                
                // Show success and close modal
                document.getElementById('keySuccess').style.display = 'block';
                setTimeout(() => {
                    modal.style.display = 'none';
                    document.getElementById('keyError').style.display = 'none';
                    document.getElementById('keySuccess').style.display = 'none';
                }, 1500);
            } catch (error) {
                document.getElementById('keyError').textContent = `Error: ${error.message}`;
                document.getElementById('keyError').style.display = 'block';
            }
        });
    };

    // Event Listeners with Error Handling
    const setupEventListeners = () => {
        const voiceToggle = document.getElementById('voiceEnabled');
        if (voiceToggle) {
            voiceToggle.addEventListener('change', async (e) => {
                try {
                    const result = await chrome.storage.local.get(['settings']);
                    const settings = result.settings || {};
                    settings.voiceEnabled = e.target.checked;
                    await chrome.storage.local.set({ settings });
                } catch (error) {
                    console.error('Error saving voice settings:', error);
                }
            });
        }

        const clearHistoryBtn = document.getElementById('clearHistory');
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', async () => {
                try {
                    await chrome.storage.local.set({ chatHistory: [] });
                    alert('Chat history cleared!');
                } catch (error) {
                    console.error('Error clearing history:', error);
                    alert('Failed to clear history. Please try again.');
                }
            });
        }

        const resetUsageBtn = document.getElementById('resetUsage');
        if (resetUsageBtn) {
            resetUsageBtn.addEventListener('click', async () => {
                try {
                    const userIdResult = await chrome.storage.local.get(['userId']);
                    const userId = userIdResult.userId || 'user_' + Date.now();
                    
                    await chrome.storage.local.set({
                        [`ai_sidebar_usage_${userId}`]: 0
                    });
                    await updateUsageCount();
                    alert('Usage count reset!');
                } catch (error) {
                    console.error('Error resetting usage:', error);
                    alert('Failed to reset usage. Please try again.');
                }
            });
        }

        const openSidebarBtn = document.getElementById('openSidebar');
        if (openSidebarBtn) {
            openSidebarBtn.addEventListener('click', async () => {
                try {
                    openSidebarBtn.disabled = true;

                    // Get the active tab
                    const [tab] = await chrome.tabs.query({ 
                        active: true, 
                        currentWindow: true 
                    });
                    
                    if (!tab?.id) {
                        throw new Error('No active tab found');
                    }

                    // Send message to background script with tab ID
                    const response = await new Promise((resolve, reject) => {
                        chrome.tabs.sendMessage(
                            tab.id, 
                            { 
                                action: 'toggleHoverBox',
                                timestamp: Date.now()
                            },
                            (response) => {
                                if (chrome.runtime.lastError) {
                                    reject(chrome.runtime.lastError);
                                } else {
                                    resolve(response);
                                }
                            }
                        );
                    });

                    if (!response?.success) {
                        throw new Error(response?.error || 'Failed to toggle sidebar');
                    }

                    window.close(); // Close popup after successful toggle

                } catch (error) {
                    console.error('Failed to open sidebar:', error);
                    openSidebarBtn.disabled = false;
                    // Optionally show error to user
                    alert('Failed to open sidebar. Please refresh the page and try again.');
                }
            });
        }
    };

    // Initialize
    try {
        await initializeUsage();
        await initializeSettings();
        await updateUsageCount();
        initializeApiKeyModal();
        setupEventListeners();
    } catch (error) {
        console.error('Initialization error:', error);
    }
});