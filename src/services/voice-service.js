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
            
            // Text-to-speech support
            this.synth = window.speechSynthesis;
            this.utterance = null;
            this.isSpeaking = false;
            this.voiceActivationEnabled = false;
            this.listeningForActivation = false;
            this.activationPhrase = "hey assistant";
            this.activationRecognition = null;
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
                    
                    // Get OpenAI key from Chrome storage
                    this.log('Loading key from Chrome storage');
                    
                    let key = null;
                    try {
                        const result = await chrome.storage.local.get(['openaiKey']);
                        if (!result.openaiKey) {
                            throw new Error('OpenAI key not found in storage');
                        }
                        key = result.openaiKey;
                        this.log('Key loaded from storage, validating...');
                    } catch (error) {
                        this.log('Storage key error:', error);
                        
                        // Try loading from .env as fallback
                        try {
                            const envResponse = await fetch(chrome.runtime.getURL('.env'));
                            if (envResponse.ok) {
                                const envText = await envResponse.text();
                                const match = envText.match(/OPENAI_API_KEY="?([^"\s]+)"?/);
                                if (match && match[1]) {
                                    key = match[1];
                                    this.log('Key loaded from .env, validating...');
                                }
                            }
                        } catch (envError) {
                            this.log('Failed to load key from .env:', envError);
                        }
                        
                        if (!key) {
                            throw new Error('No OpenAI key available');
                        }
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
            
            // Clean up text-to-speech
            this.stopSpeaking();
            
            // Clean up voice activation
            this.stopVoiceActivation();
        }

        isSupported() {
            return !!(navigator.mediaDevices?.getUserMedia);
        }
        
        /**
         * Text-to-speech implementation using Web Speech API
         */
        speakText(text) {
            if (!text || !this.synth) {
                this.log('Speech synthesis not available or empty text');
                return false;
            }
            
            // Cancel any ongoing speech
            this.stopSpeaking();
            
            // Create utterance
            this.utterance = new SpeechSynthesisUtterance(text);
            
            // Select a voice (optional)
            const voices = this.synth.getVoices();
            if (voices.length > 0) {
                // Try to find a female voice for better quality
                const femaleVoice = voices.find(voice => 
                    voice.name.includes('Female') || 
                    voice.name.includes('Samantha') || 
                    voice.name.includes('Google US English Female')
                );
                if (femaleVoice) {
                    this.utterance.voice = femaleVoice;
                }
            }
            
            // Set properties
            this.utterance.rate = 1.0;
            this.utterance.pitch = 1.0;
            this.utterance.volume = 1.0;
            
            // Add event handlers
            this.utterance.onstart = () => {
                this.isSpeaking = true;
                this.log('Started speaking');
            };
            
            this.utterance.onend = () => {
                this.isSpeaking = false;
                this.utterance = null;
                this.log('Finished speaking');
            };
            
            this.utterance.onerror = (error) => {
                this.log('Speech error:', error);
                this.isSpeaking = false;
                this.utterance = null;
            };
            
            // Start speaking
            this.synth.speak(this.utterance);
            return true;
        }
        
        stopSpeaking() {
            if (this.synth && this.isSpeaking) {
                this.synth.cancel();
                this.isSpeaking = false;
                this.utterance = null;
                this.log('Speech cancelled');
            }
        }
        
        /**
         * Request microphone permission
         */
        async requestPermission() {
            if (!navigator.mediaDevices?.getUserMedia) {
                this.log('Media devices API not supported');
                return false;
            }
            
            try {
                // First, try to request permission through background script
                // This helps with permission popups being properly displayed
                const response = await chrome.runtime.sendMessage({
                    action: 'requestVoicePermission'
                });
                
                return response?.success || false;
            } catch (error) {
                this.log('Permission request error:', error);
                
                // Fallback: try direct permission request
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    stream.getTracks().forEach(track => track.stop());
                    return true;
                } catch (error) {
                    this.log('Direct permission request failed:', error);
                    return false;
                }
            }
        }
        
        /**
         * Voice activation implementation using Web Speech API's continuous recognition
         */
        async startVoiceActivation(callback) {
            if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
                this.log('Voice activation not supported');
                return false;
            }
            
            if (this.listeningForActivation) {
                this.log('Already listening for activation');
                return true;
            }
            
            // Request permission first
            const hasPermission = await this.requestPermission();
            if (!hasPermission) {
                this.log('Microphone permission denied');
                return false;
            }
            
            try {
                // Create recognition object
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                this.activationRecognition = new SpeechRecognition();
                
                // Configure
                this.activationRecognition.continuous = true;
                this.activationRecognition.interimResults = false;
                this.activationRecognition.lang = 'en-US';
                
                // Event handlers
                this.activationRecognition.onresult = (event) => {
                    const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
                    this.log('Heard:', transcript);
                    
                    if (transcript.includes(this.activationPhrase)) {
                        this.log('Activation phrase detected!');
                        // Stop listening temporarily
                        this.stopVoiceActivation();
                        
                        // Call the callback to activate the UI
                        callback();
                    }
                };
                
                this.activationRecognition.onstart = () => {
                    this.listeningForActivation = true;
                    this.log('Started listening for activation phrase');
                };
                
                this.activationRecognition.onend = () => {
                    if (this.voiceActivationEnabled) {
                        // Restart if it stops and we still want to be listening
                        this.activationRecognition.start();
                    } else {
                        this.listeningForActivation = false;
                        this.log('Stopped listening for activation phrase');
                    }
                };
                
                this.activationRecognition.onerror = (event) => {
                    this.log('Voice activation error:', event.error);
                    this.listeningForActivation = false;
                };
                
                // Start listening
                this.activationRecognition.start();
                this.voiceActivationEnabled = true;
                return true;
                
            } catch (error) {
                this.log('Error starting voice activation:', error);
                return false;
            }
        }
        
        stopVoiceActivation() {
            if (this.activationRecognition && this.listeningForActivation) {
                this.voiceActivationEnabled = false;
                this.activationRecognition.stop();
                this.log('Voice activation stopped');
            }
        }
        
        setActivationPhrase(phrase) {
            if (phrase && phrase.trim().length > 0) {
                this.activationPhrase = phrase.trim().toLowerCase();
                this.log('Activation phrase set to:', this.activationPhrase);
                return true;
            }
            return false;
        }
    };
}