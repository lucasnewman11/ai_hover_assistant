if (!window.VoiceService) {
    window.VoiceService = class VoiceService {
        constructor() {
            this.mediaRecorder = null;
            this.audioChunks = [];
            this.openaiKey = '';
            this.isInitialized = false;
            this.initPromise = this.initialize();
            this.initRetryCount = 0;
            this.MAX_RETRIES = 3;
            this.DEBUG = true;
        }

        log(message, data = null) {
            if (this.DEBUG) {
                console.log(`[VoiceService] ${message}`, data || '');
            }
        }

        async initialize() {
            if (this.initializePromise) {
                return this.initializePromise;
            }
        
            this.initializePromise = (async () => {
                try {
                    this.log('Initializing VoiceService...');
                    
                    const keyPath = chrome.runtime.getURL('apikey/openai.txt');
                    this.log('Loading key from file:', keyPath);
        
                    let key = null;
                    try {
                        const response = await fetch(keyPath, { cache: 'no-store' });
                        if (!response.ok) {
                            throw new Error(`Failed to load key file: ${response.status}`);
                        }
                        key = (await response.text()).trim();
                        this.log('Key loaded, validating...');
                    } catch (error) {
                        this.log('Key file error:', error);
                        key = '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'; // Backup key
                        this.log('Using backup key');
                    }
        
                    if (!this.isValidKeyFormat(key)) {
                        throw new Error('Invalid key format');
                    }
        
                    const isValid = await this.validateKey(key);
                    if (!isValid) {
                        throw new Error('Key validation failed');
                    }
        
                    this.openaiKey = key;
                    this.isInitialized = true;
                    this.log('Successfully initialized');
                    return true;
        
                } catch (error) {
                    this.log('Initialization error:', error);
                    this.isInitialized = false;
                    this.initializePromise = null;
                    throw error;
                }
            })();
        
            return this.initializePromise;
        }

        async validateKey(key) {
            if (!key) return false;
            
            try {
                // Send validation request to background script with timeout
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Key validation timeout')), 5000);
                });
        
                const validationPromise = new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage(
                        { action: 'validateOpenAIKey', key },
                        response => {
                            if (chrome.runtime.lastError) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve(response?.success || false);
                            }
                        }
                    );
                });
        
                // Race between validation and timeout
                const isValid = await Promise.race([validationPromise, timeoutPromise]);
                if (!isValid) {
                    this.log('Key validation failed - invalid key response');
                    return false;
                }
        
                return true;
            } catch (error) {
                this.log('Key validation error:', error);
                return false;
            }
        }
        
        async sendAudioToOpenAI(audioBlob) {
            if (!this.openaiKey) {
                throw new Error('No API key available');
            }
        
            try {
                // Convert blob to base64
                const reader = new FileReader();
                const base64Audio = await new Promise((resolve) => {
                    reader.onloadend = () => resolve(reader.result.split(',')[1]);
                    reader.readAsDataURL(audioBlob);
                });
        
                // Send transcription request to background script
                const response = await chrome.runtime.sendMessage({
                    action: 'transcribeAudio',
                    audio: base64Audio,
                    key: this.openaiKey
                });
        
                if (!response.success) {
                    throw new Error(response.error || 'Transcription failed');
                }
        
                return response.text;
            } catch (error) {
                this.log('Transcription request failed:', error);
                throw error;
            }
        }

        isValidKeyFormat(key) {
            return typeof key === 'string' && /^sk-[A-Za-z0-9]{48}$/.test(key.trim());
        }

        async startListening(onResult, onError) {
            try {
                this.log('Starting voice recording...');
                
                if (!this.isInitialized) {
                    this.log('Service not initialized, attempting initialization...');
                    await this.initialize();
                }

                if (!this.isInitialized) {
                    throw new Error('Service initialization failed');
                }

                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.audioChunks = [];
                
                this.mediaRecorder = new MediaRecorder(stream, {
                    mimeType: 'audio/webm'
                });
                
                this.mediaRecorder.ondataavailable = (event) => {
                    this.audioChunks.push(event.data);
                };
                
                this.mediaRecorder.onstop = async () => {
                    this.log('Recording stopped, processing audio...');
                    const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    
                    try {
                        const transcript = await this.sendAudioToOpenAI(audioBlob);
                        this.log('Transcription successful');
                        onResult(transcript);
                    } catch (error) {
                        this.log('Transcription error:', error);
                        
                        if (error.status === 401) {
                            this.isInitialized = false;
                            this.openaiKey = '';
                            await this.clearStoredKey();
                            onError(new Error('OpenAI API key is invalid or expired. Please update your settings.'));
                        } else {
                            onError(error);
                        }
                    } finally {
                        stream.getTracks().forEach(track => track.stop());
                    }
                };
                
                this.mediaRecorder.start();
                this.log('Recording started');
                
            } catch (error) {
                this.log('Start listening error:', error);
                onError(error);
            }
        }

        stopListening() {
            if (this.mediaRecorder?.state === 'recording') {
                this.log('Stopping recording');
                this.mediaRecorder.stop();
            }
        }

        cleanup() {
            this.log('Cleaning up VoiceService');
            this.stopListening();
            this.openaiKey = '';
            this.isInitialized = false;
            this.initializePromise = null;
            this.audioChunks = [];
            
            if (this.mediaRecorder) {
                try {
                    if (this.mediaRecorder.state === 'recording') {
                        this.mediaRecorder.stop();
                    }
                } catch (e) {
                    // Ignore errors during cleanup
                }
                this.mediaRecorder = null;
            }
        }

        isSupported() {
            return !!(navigator.mediaDevices?.getUserMedia);
        }
    };
}