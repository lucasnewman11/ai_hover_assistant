// This is a utility script to manually reset API keys in Chrome storage
// You can execute this in the browser console when the extension is loaded

async function resetApiKeys() {
  console.log('Resetting API keys in Chrome storage...');
  
  // Prompt the user to enter their API keys
  const claudeKey = prompt("Enter your Claude API key (starts with sk-ant- or sk-):", "");
  const perplexityKey = prompt("Enter your Perplexity API key (starts with pplx-):", "");
  
  try {
    // Clear existing keys first
    await chrome.storage.local.remove(['claudeKey', 'perplexityKey', 'openaiKey']);
    console.log('Cleared existing API keys from storage');
    
    // Set new keys
    await chrome.storage.local.set({
      claudeKey: claudeKey,
      perplexityKey: perplexityKey
    });
    
    console.log('Successfully reset API keys in Chrome storage');
    
    // Verify keys were set
    const storedKeys = await chrome.storage.local.get(['claudeKey', 'perplexityKey']);
    
    if (storedKeys.claudeKey && storedKeys.perplexityKey) {
      console.log('Verification successful - keys properly stored');
      console.log('Claude key length:', storedKeys.claudeKey.length);
      console.log('Perplexity key length:', storedKeys.perplexityKey.length);
    } else {
      console.error('Verification failed - keys not properly stored');
    }
    
    return true;
  } catch (error) {
    console.error('Error resetting API keys:', error);
    return false;
  }
}

// Execute from browser console when needed
console.log('To reset API keys, run: resetApiKeys()');