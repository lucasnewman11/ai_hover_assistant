// API Key Checker Utility
// Run this script in the browser console when the extension is active
// to diagnose API key issues
//
// How to use:
// 1. Load the extension in your browser
// 2. Open Developer Tools (F12 or Ctrl+Shift+I) 
// 3. In the Console tab, copy and paste this entire script
// 4. Run the following commands:
//    - checkApiKeys() - Check API keys in storage
//    - testDirectApiCall() - Test direct API calls with stored keys
//    - resetApiKeys() - Reset API keys if needed

async function checkApiKeys() {
  console.log('======= AI HOVER ASSISTANT API KEY CHECKER =======');
  console.log('Checking API keys in all available locations...');
  
  // Check Chrome storage
  console.log('\n[1] Checking Chrome storage:');
  try {
    const keys = await chrome.storage.local.get(['claudeKey', 'perplexityKey', 'openaiKey']);
    
    // Claude key
    if (keys.claudeKey) {
      const maskedKey = keys.claudeKey.substring(0, 8) + '...' + keys.claudeKey.substring(keys.claudeKey.length - 6);
      console.log('✅ Claude key found in storage:', maskedKey);
      console.log('   Key starts with correct prefix:', keys.claudeKey.startsWith('sk-ant-api03-') || keys.claudeKey.startsWith('sk-ant-') ? '✅ Yes' : '❌ No');
      console.log('   Key length:', keys.claudeKey.length);
    } else {
      console.log('❌ No Claude key found in storage');
    }
    
    // Perplexity key
    if (keys.perplexityKey) {
      const maskedKey = keys.perplexityKey.substring(0, 6) + '...' + keys.perplexityKey.substring(keys.perplexityKey.length - 4);
      console.log('✅ Perplexity key found in storage:', maskedKey);
      console.log('   Key starts with correct prefix:', keys.perplexityKey.startsWith('pplx-') ? '✅ Yes' : '❌ No');
      console.log('   Key length:', keys.perplexityKey.length);
    } else {
      console.log('❌ No Perplexity key found in storage');
    }
  } catch (error) {
    console.error('Error checking Chrome storage:', error);
  }
  
  // Check .env file
  console.log('\n[2] Checking .env file:');
  try {
    const envUrl = chrome.runtime.getURL('.env');
    console.log('ENV file URL:', envUrl);
    
    const response = await fetch(envUrl, { cache: 'no-store' });
    console.log('Fetch response status:', response.status);
    
    if (response.ok) {
      const envText = await response.text();
      console.log('ENV file loaded, length:', envText.length);
      
      // Check for Claude key
      const claudeKeyMatch = envText.match(/CLAUDE_API_KEY=["']([^"']+)["']/);
      if (claudeKeyMatch && claudeKeyMatch[1]) {
        const key = claudeKeyMatch[1];
        const maskedKey = key.substring(0, 8) + '...' + key.substring(key.length - 6);
        console.log('✅ Claude key found in .env file:', maskedKey);
        console.log('   Key starts with correct prefix:', key.startsWith('sk-ant-api03-') || key.startsWith('sk-ant-') ? '✅ Yes' : '❌ No');
        console.log('   Key length:', key.length);
      } else {
        console.log('❌ No Claude key found in .env file');
      }
      
      // Check for Perplexity key
      const perplexityKeyMatch = envText.match(/PERPLEXITY_API_KEY=["']([^"']+)["']/);
      if (perplexityKeyMatch && perplexityKeyMatch[1]) {
        const key = perplexityKeyMatch[1];
        const maskedKey = key.substring(0, 6) + '...' + key.substring(key.length - 4);
        console.log('✅ Perplexity key found in .env file:', maskedKey);
        console.log('   Key starts with correct prefix:', key.startsWith('pplx-') ? '✅ Yes' : '❌ No');
        console.log('   Key length:', key.length);
      } else {
        console.log('❌ No Perplexity key found in .env file');
      }
    } else {
      console.log('❌ Failed to load .env file');
    }
  } catch (error) {
    console.error('Error checking .env file:', error);
  }

  // Test API validation
  console.log('\n[3] Testing API key validation:');
  try {
    console.log('Validating Claude API key...');
    const claudeResponse = await chrome.runtime.sendMessage({
      action: 'validateAPIKey',
      model: 'claude'
    });
    
    console.log('Claude API key validation result:', claudeResponse.success ? '✅ Valid' : '❌ Invalid', claudeResponse.error || '');
    
    console.log('Validating Perplexity API key...');
    const perplexityResponse = await chrome.runtime.sendMessage({
      action: 'validateAPIKey',
      model: 'perplexity'
    });
    
    console.log('Perplexity API key validation result:', perplexityResponse.success ? '✅ Valid' : '❌ Invalid', perplexityResponse.error || '');
  } catch (error) {
    console.error('Error testing API validation:', error);
  }
  
  console.log('\n[4] Check if any errors have been logged:');
  try {
    const errors = await chrome.storage.local.get(['error_log']);
    if (errors.error_log && errors.error_log.length > 0) {
      console.log(`Found ${errors.error_log.length} logged errors. Most recent 3:`);
      errors.error_log.slice(-3).forEach((err, i) => {
        console.log(`Error ${i+1}:`);
        console.log('  Type:', err.errorType);
        console.log('  Message:', err.message);
        console.log('  Location:', err.location);
        console.log('  Timestamp:', err.timestamp);
      });
    } else {
      console.log('No errors found in log');
    }
  } catch (error) {
    console.error('Error checking error log:', error);
  }
  
  console.log('\n======= API KEY CHECKER COMPLETE =======');
  console.log('Copy and share this output with developers to help diagnose API key issues');
}

// Fix for the API keys issue
async function resetApiKeys() {
  console.log('Fixing API keys in storage...');
  
  try {
    // First, clear existing keys to ensure we don't have corrupted data
    await chrome.storage.local.remove(['claudeKey', 'perplexityKey', 'openaiKey']);
    console.log('Cleared existing API keys from storage');
    
    // Create new keys with proper format and structure
    const claudeKey = prompt("Enter your Claude API key (starts with sk-ant-):", "");
    const perplexityKey = prompt("Enter your Perplexity API key (starts with pplx-):", "");
    
    if (!claudeKey || !perplexityKey) {
      console.error('API keys are required');
      return false;
    }
    
    // Validate key formats
    if (!claudeKey.startsWith('sk-ant-')) {
      console.error('Claude API key must start with sk-ant-');
      return false;
    }
    
    if (!perplexityKey.startsWith('pplx-')) {
      console.error('Perplexity API key must start with pplx-');
      return false;
    }
    
    // Store keys in Chrome storage
    await chrome.storage.local.set({
      claudeKey: claudeKey,
      perplexityKey: perplexityKey
    });
    
    console.log('Successfully reset API keys in Chrome storage');
    
    // Create and download .env file
    const envContent = `# API Keys
CLAUDE_API_KEY="${claudeKey}"
PERPLEXITY_API_KEY="${perplexityKey}"
`;

    const blob = new Blob([envContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '.env';
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('Created .env file for download. Please place this file in your extension directory.');
    
    // Verify keys in storage
    const storedKeys = await chrome.storage.local.get(['claudeKey', 'perplexityKey']);
    if (storedKeys.claudeKey && storedKeys.perplexityKey) {
      console.log('✅ Verification successful - keys properly stored in Chrome storage');
      // Now try to reload the extension
      console.log('Please reload the extension for changes to take effect');
      return true;
    } else {
      console.error('❌ Verification failed - keys not properly stored');
      return false;
    }
  } catch (error) {
    console.error('Error resetting API keys:', error);
    return false;
  }
}

// Test direct API calls with stored keys
async function testDirectApiCall() {
  console.log('======= TESTING DIRECT API CALLS =======');

  try {
    // First, get the API keys from storage
    const keys = await chrome.storage.local.get(['claudeKey', 'perplexityKey']);
    
    if (!keys.claudeKey) {
      console.error('❌ No Claude API key found in storage. Please set it first.');
      return;
    }
    
    // FULL DEBUG OUTPUT OF THE KEY
    console.log('==== CLAUDE API KEY DEBUG ====');
    console.log(`Complete Claude key: ${keys.claudeKey}`);
    console.log(`Key length: ${keys.claudeKey.length}`);
    console.log(`Key type: ${typeof keys.claudeKey}`);
    console.log(`First 10 chars: ${keys.claudeKey.substring(0, 10)}`);
    console.log(`Last 5 chars: ${keys.claudeKey.substring(keys.claudeKey.length - 5)}`);
    console.log(`Key starts with sk-ant-: ${keys.claudeKey.startsWith('sk-ant-')}`);
    console.log(`Key starts with sk-: ${keys.claudeKey.startsWith('sk-')}`);
    
    // Check for whitespace or non-visible characters
    const hasLeadingSpace = keys.claudeKey.startsWith(' ');
    const hasTrailingSpace = keys.claudeKey.endsWith(' ');
    const keyWithoutSpaces = keys.claudeKey.trim();
    console.log(`Has leading whitespace: ${hasLeadingSpace}`);
    console.log(`Has trailing whitespace: ${hasTrailingSpace}`);
    console.log(`Key without spaces: ${keyWithoutSpaces}`);
    console.log(`Key without spaces length: ${keyWithoutSpaces.length}`);
    
    // Try to encode/decode to check for hidden characters
    console.log(`URL encoded key: ${encodeURIComponent(keys.claudeKey)}`);
    console.log('==== END KEY DEBUG ====');
    
    console.log('Testing a direct API call to the Claude API...');
    
    // Build a minimal Claude API request
    const claudeRequest = {
      model: "claude-3-sonnet-20240229",
      messages: [{
        role: "user",
        content: "Hello, this is a test request from the AI Hover Assistant extension."
      }],
      max_tokens: 50,
      temperature: 0.7,
      system: "You are a helpful AI assistant for testing purposes."
    };
    
    // Execute the request
    try {
      console.log('Making Claude API request...');
      // Try with a trimmed key in case there are hidden spaces
      const trimmedKey = keys.claudeKey.trim();
      
      // Log complete request details
      console.log('API Request URL:', 'https://api.anthropic.com/v1/messages');
      console.log('Request method:', 'POST');
      console.log('Request headers:', {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': '***KEY HIDDEN***' // Don't log the actual key in headers
      });
      console.log('Request body:', JSON.stringify(claudeRequest, null, 2));
      
      // Determine which authentication method to use based on key format
      const headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      };
      
      if (trimmedKey.startsWith('sk-') && !trimmedKey.startsWith('sk-ant-')) {
        // New format keys use Bearer authentication
        console.log('ATTEMPT 1: Using Authorization: Bearer header for newer sk- format key...');
        headers['Authorization'] = `Bearer ${trimmedKey}`;
      } else {
        // Old format keys use x-api-key
        console.log('ATTEMPT 1: Using x-api-key header for sk-ant- format key...');
        headers['x-api-key'] = trimmedKey;
      }
      
      const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(claudeRequest)
      });
      
      const claudeStatus = claudeResponse.status;
      const claudeData = await claudeResponse.text();
      
      console.log(`Claude API response status: ${claudeStatus}`);
      console.log('Claude API response:', claudeData);
      
      if (claudeResponse.ok) {
        console.log('✅ Claude API test SUCCESSFUL with x-api-key header');
        
        try {
          const jsonData = JSON.parse(claudeData);
          if (jsonData.content && jsonData.content[0].text) {
            console.log('Response text:', jsonData.content[0].text);
          }
        } catch (e) {
          console.warn('Could not parse JSON response:', e);
        }
      } else {
        console.error('❌ Claude API test FAILED with x-api-key header');
        console.error('Error details:', claudeData);
        
        // Try second attempt with the opposite authentication method
        console.log('\nATTEMPT 2: Trying alternative authentication method...');
        try {
          const altHeaders = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
          };
          
          // Use the opposite auth method from the first attempt
          if (headers['Authorization']) {
            console.log('Trying x-api-key header instead of Bearer token...');
            altHeaders['x-api-key'] = trimmedKey;
          } else {
            console.log('Trying Bearer token instead of x-api-key...');
            altHeaders['Authorization'] = `Bearer ${trimmedKey}`;
          }
          
          const bearerResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: altHeaders,
            body: JSON.stringify(claudeRequest)
          });
          
          const bearerStatus = bearerResponse.status;
          const bearerData = await bearerResponse.text();
          
          console.log(`Claude API response status with Bearer: ${bearerStatus}`);
          console.log('Claude API response with Bearer:', bearerData);
          
          if (bearerResponse.ok) {
            console.log('✅ Claude API test SUCCESSFUL with Bearer token');
          } else {
            console.error('❌ Claude API test FAILED with Bearer token too');
          }
        } catch (bearerError) {
          console.error('Bearer token attempt failed:', bearerError);
        }
      }
    } catch (error) {
      console.error('❌ Claude API call failed with error:', error);
    }
    
    // Also test Perplexity if key available
    if (keys.perplexityKey) {
      console.log('\nTesting a direct API call to the Perplexity API...');
      
      const perplexityRequest = {
        model: "sonar-medium-online",
        messages: [{
          role: "user", 
          content: "Hello, this is a test request from the AI Hover Assistant extension."
        }],
        temperature: 0.3,
        max_tokens: 50
      };
      
      try {
        console.log('Making Perplexity API request...');
        const perplexityResponse = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${keys.perplexityKey}`
          },
          body: JSON.stringify(perplexityRequest)
        });
        
        const perplexityStatus = perplexityResponse.status;
        const perplexityData = await perplexityResponse.text();
        
        console.log(`Perplexity API response status: ${perplexityStatus}`);
        console.log('Perplexity API response:', perplexityData);
        
        if (perplexityResponse.ok) {
          console.log('✅ Perplexity API test SUCCESSFUL');
        } else {
          console.error('❌ Perplexity API test FAILED');
        }
      } catch (error) {
        console.error('❌ Perplexity API call failed with error:', error);
      }
    }
    
  } catch (error) {
    console.error('Error testing API calls:', error);
  }
  
  console.log('======= API TESTS COMPLETE =======');
}

// Execute from browser console when needed
console.log('To check API keys, run: checkApiKeys()');
console.log('To test API calls directly, run: testDirectApiCall()');
console.log('To fix API key issues, run: resetApiKeys()');