// Simple script to test loading API keys from .env file
// Run this in the background service worker context

async function testLoadEnvFile() {
  console.log('Testing .env file loading...');
  
  try {
    const response = await fetch(chrome.runtime.getURL('.env'));
    console.log('Fetch response status:', response.status);
    
    if (!response.ok) {
      console.error('Failed to load .env file. Status:', response.status);
      return null;
    }
    
    const envText = await response.text();
    console.log('ENV text length:', envText.length);
    console.log('ENV text first 40 chars:', envText.substring(0, 40));
    
    const claudeKeyMatch = envText.match(/CLAUDE_API_KEY=["']([^"']+)["']/);
    if (claudeKeyMatch && claudeKeyMatch[1]) {
      // Mask most of the key for security
      const key = claudeKeyMatch[1];
      const maskedKey = key.substring(0, 10) + '...' + key.substring(key.length - 6);
      console.log('Found Claude API Key:', maskedKey);
      return key;
    } else {
      console.error('Claude API Key not found in .env file');
      return null;
    }
  } catch (error) {
    console.error('Error loading .env file:', error);
    return null;
  }
}

// This should be run in the background service worker
testLoadEnvFile().then(key => {
  console.log('Test complete. Key extracted successfully:', !!key);
});