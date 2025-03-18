if (!window.UsageTracker) {
  window.UsageTracker = class UsageTracker {
    constructor() {
        this.USAGE_KEY = 'ai_sidebar_usage';
        this.MAX_FREE_USES = 25;
        this.initialized = false;
        this.initPromise = this.initialize();
        this.updateLock = Promise.resolve();
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

    async getUsageCount() {
        await this.ensureInitialized();
        const userId = await this.getUserId();
        return new Promise((resolve) => {
            chrome.storage.local.get([`${this.USAGE_KEY}_${userId}`], (result) => {
                resolve(result[`${this.USAGE_KEY}_${userId}`] || 0);
            });
        });
    }

    async broadcastUsageUpdate() {
      const usageInfo = await this.checkUsageLimit();
      
      // Broadcast to all tabs and popup
      this.broadcastToAllTargets(usageInfo);
    }

    async broadcastToAllTargets(usageInfo) {
      // First try popup
      try {
          await chrome.runtime.sendMessage({
              action: 'updateCredits',
              credits: usageInfo
          });
      } catch (error) {
          console.debug('No popup available for credits update');
      }

      // Then try all tabs using chrome runtime instead of tabs API
      try {
          chrome.runtime.sendMessage({
              action: 'updateCredits',
              credits: usageInfo
          }).catch(error => {
              console.debug('Error broadcasting to tabs:', error);
          });
      } catch (error) {
          console.debug('Error broadcasting usage update:', error);
      }
    }

    async incrementUsage() {
      return new Promise((resolve) => {
          this.updateLock = this.updateLock.then(async () => {
              try {
                  const userId = await this.getUserId();
                  const currentUsage = await this.getUsageCount();
                  const newUsage = currentUsage + 1;

                  // Update storage first
                  await chrome.storage.local.set({
                      [`${this.USAGE_KEY}_${userId}`]: newUsage
                  });

                  // Then calculate and broadcast
                  const usageInfo = {
                      currentUsage: newUsage,
                      remaining: Math.max(0, this.MAX_FREE_USES - newUsage),
                      exceeded: newUsage >= this.MAX_FREE_USES
                  };

                  // Ensure broadcast completes
                  await this.broadcastToAllTargets(usageInfo);
                  resolve(usageInfo);
              } catch (error) {
                  console.error('Error in incrementUsage:', error);
                  resolve({
                      currentUsage: 0,
                      remaining: this.MAX_FREE_USES,
                      exceeded: false
                  });
              }
          });
      });
    }

    calculateUsageInfo(usage) {
      return {
          currentUsage: usage,
          remaining: Math.max(0, this.MAX_FREE_USES - usage),
          exceeded: usage >= this.MAX_FREE_USES
      };
    }

    async checkUsageLimit() {
        const currentUsage = await this.getUsageCount();
        const remaining = Math.max(0, this.MAX_FREE_USES - currentUsage);
        return {
            hasRemainingUses: currentUsage < this.MAX_FREE_USES,
            remaining,
            currentUsage,
            exceeded: currentUsage >= this.MAX_FREE_USES
        };
    }

    async resetUsage() {
        const userId = await this.getUserId();
        return new Promise((resolve) => {
            chrome.storage.local.set({
                [`${this.USAGE_KEY}_${userId}`]: 0
            }, () => resolve({
                currentUsage: 0,
                remaining: this.MAX_FREE_USES,
                exceeded: false
            }));
        });
    }

    async showUpgradePrompt() {
        return {
            title: 'Usage Limit Reached',
            message: 'You have used all your free credits. Upgrade to continue using the AI assistant.',
            actionUrl: 'https://getautonomi.com',
            actionText: 'Upgrade Now'
        };
    }
  };
}