/**
 * AI Hover Assistant - Content Script
 * 
 * This script is injected into web pages to provide an AI assistant
 * that can help users understand and interact with page content.
 */

// Global hover box reference
if (!window.hoverBox) {
    window.hoverBox = null;
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.debug('Content script received message:', message);
    
    if (message.action === 'toggleHoverBox') {
        initAndToggleHoverBox(sendResponse);
        return true; // Keep the message channel open for async response
    }
    
    // Default response for unknown actions
    sendResponse({ 
        success: false, 
        error: `Unknown action: ${message.action}` 
    });
    return false;
});

/**
 * Initialize and toggle the hover box
 */
async function initAndToggleHoverBox(sendResponse) {
    // Set a timeout to ensure we don't hang
    const responseTimeout = setTimeout(() => {
        if (sendResponse) {
            sendResponse({ 
                success: false, 
                error: 'Operation timed out while waiting for response' 
            });
        }
    }, 5000);
    
    try {
        // Check for required services
        if (!window.AIService || !window.ContextService || !window.UsageTracker) {
            throw new Error('Required services not loaded. Please refresh the page.');
        }

        // Create new hover box if needed
        if (!window.hoverBox || !window.hoverBox.box) {
            console.debug('Initializing new AIHoverBox');
            
            // Clean up existing instance if needed
            if (window.hoverBox) {
                await window.hoverBox.cleanup();
            }
            
            // Create new hover box
            window.hoverBox = new window.AIHoverBox();
            
            // Wait for initialization with timeout
            const initialized = await Promise.race([
                window.hoverBox.initPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Initialization timed out')), 10000)
                )
            ]);
            
            if (!initialized) {
                throw new Error('Hover box initialization failed');
            }
        }

        // Toggle the hover box
        await window.hoverBox.toggle();
        
        // Send success response
        clearTimeout(responseTimeout);
        sendResponse({ 
            success: true,
            status: window.hoverBox.isVisible ? 'opened' : 'closed'
        });

    } catch (error) {
        console.error('Error in toggleHoverBox:', error);
        
        // Clean up on error
        if (window.hoverBox) {
            try {
                await window.hoverBox.cleanup();
            } catch (cleanupError) {
                console.error('Cleanup error:', cleanupError);
            }
            window.hoverBox = null;
        }

        // Send error response
        clearTimeout(responseTimeout);
        sendResponse({ 
            success: false, 
            error: error.message || 'Unknown error occurred',
            details: {
                type: error.name,
                stack: error.stack
            }
        });
    }
}

// Log that content script is loaded
console.log('AI Hover Assistant content script loaded');