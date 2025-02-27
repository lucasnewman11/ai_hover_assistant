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
        setupEventListeners();
    } catch (error) {
        console.error('Initialization error:', error);
    }
});