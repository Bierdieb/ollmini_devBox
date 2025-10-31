// Ollama Client Module
// Handles Ollama API integration, streaming, and tool execution

const { ipcRenderer } = require('electron');
const Diff = require('diff');
const { encoding_for_model } = require('tiktoken');
const { SYSTEM_TOOLS } = require('./system-tools');
const { WEB_TOOLS } = require('./web-tools');
const { PermissionManager } = require('./permission-manager');
const { applyFilterToWebResults } = require('./unicode-filter');
const http = require('http');
const https = require('https');

// API Configuration
let OLLAMA_API_URL = 'http://localhost:11434';
let currentModel = 'gpt-oss:20custom';
let conversationHistory = [];
let isStreaming = false;
let abortController = null;
let webSearchCallCount = 0; // Counter to prevent infinite WebSearch loops
const MAX_WEBSEARCH_PER_CONVERSATION = 3; // Maximum WebSearch calls per conversation
let currentContextUsage = {
    promptTokens: 0,
    responseTokens: 0,
    totalTokens: 0,
    maxTokens: 4096
};

// Permission Manager
let permissionManager = null;

// Tool Capability Detection
// Known model prefixes that support Ollama Tool Calling API
const TOOL_CAPABLE_MODEL_PREFIXES = [
    'gpt-oss',       // Confirmed working in this project
    'qwen',          // qwen2.5, qwen3, etc.
    'llama3',        // llama3.1, llama3.2, etc.
    'mistral'        // Mistral models
];

// Map to cache model capability detection results
const modelToolCapabilities = new Map();

// Model Context Length Limits
// Maps model name prefixes to their maximum context window sizes (in tokens)
const MODEL_CONTEXT_LIMITS = {
    'gpt-oss': 128000,          // Custom model (20B variant)
    'llama3.2': 128000,
    'llama3.1': 128000,
    'llama3': 8192,
    'mistral-small3.2': 128000, // mistral-small3.2:24b
    'mistral-nemo': 128000,
    'mistral': 32768,
    'qwen3': 40000,             // qwen3:8b, qwen3:14b (40K context)
    'qwen2.5-coder': 32768,     // qwen2.5-coder models
    'qwen2.5': 32768,
    'qwen2': 32768,
    'gemma2': 8192,
    'gemma': 8192,
    'deepcoder': 128000,        // deepcoder models
    'phi3': 4096,
    'phi3:*-128k': 128000,      // Wildcard for phi3 128k variants
    'deepseek-r1': 128000,
    'deepseek-r1:671b': 160000, // Specific variant with larger context
    'deepseek-coder': 128000,   // deepseek-coder models (128K context)
    'codellama': 16384,
    'codellama:70b': 2048,      // Larger variant with smaller context
    'default': 4096             // Fallback for unknown models
};

// Token Counting (tiktoken for accurate counting)
let tokenEncoder = null;
let totalInputTokens = 0;
let totalOutputTokens = 0;
let previousHistoryTokens = 0;

// RAG Error Handling
let ragConsecutiveFailures = 0;
const MAX_RAG_FAILURES = 3;
let ragAutoDisabled = false;

// Initialize tiktoken encoder
try {
    tokenEncoder = encoding_for_model('gpt-4');
} catch (error) {
    console.error('Failed to load tiktoken encoder:', error);
}

// Model Settings (will be injected by settings-manager)
let modelSettings = {
    temperature: 0.7,
    num_ctx: 4096,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    seed: null,
    typewriterEffect: true
};

// Node.js HTTP Request Helper (to bypass CORS)
// Ollama server doesn't support CORS preflight (OPTIONS), so we use Node.js HTTP instead of fetch()
function makeOllamaRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(
            path.startsWith('http://') || path.startsWith('https://')
                ? path                           // Full URL: use directly
                : `${OLLAMA_API_URL}${path}`     // Relative path: prepend base
        );
        const httpModule = url.protocol === 'https:' ? https : http;

        const reqOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 10000 // 10 second timeout
        };

        const req = httpModule.request(reqOptions, (res) => {
            let data = '';

            res.on('data', chunk => {
                data += chunk.toString('utf8');
            });

            res.on('end', () => {
                // Return fetch-compatible Response-like object
                let jsonData = null;
                let parseError = null;

                try {
                    jsonData = JSON.parse(data);
                } catch (e) {
                    parseError = e;
                }

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    // Success case: return fetch-compatible response
                    resolve({
                        ok: true,
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        headers: res.headers,
                        text: async () => data,
                        json: async () => {
                            if (parseError) throw new Error('Invalid JSON');
                            return jsonData;
                        }
                    });
                } else {
                    // Error case: return fetch-compatible response with ok: false
                    resolve({
                        ok: false,
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        headers: res.headers,
                        text: async () => data,
                        json: async () => {
                            if (parseError) throw new Error('Invalid JSON');
                            return jsonData;
                        }
                    });
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Network error: ${error.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (options.body) {
            const bodyData = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
            req.write(bodyData);
        }

        req.end();
    });
}

// Smart Auto-Scroll State
let userScrolledAway = false;
let isProgrammaticScroll = false; // Flag to distinguish programmatic vs user scrolling
let scrollChunkCounter = 0;
const SCROLL_THRESHOLD = 100; // pixels from bottom to consider "at bottom"
const SCROLL_EVERY_N_CHUNKS = 5; // only scroll every N chunks during streaming

// DOM References (will be set externally)
let statusDot = null;
let statusText = null;
let modelSelect = null;
let chatContainer = null;
let activityText = null;
let sendBtn = null;

function setDOMReferences(refs) {
    statusDot = refs.statusDot;
    statusText = refs.statusText;
    modelSelect = refs.modelSelect;
    chatContainer = refs.chatContainer;
    activityText = refs.activityText;
    sendBtn = refs.sendBtn;

    // Setup scroll listener once chatContainer is available
    setupScrollListener();
}

function setModelSettings(settings) {
    modelSettings = settings;
}

// Smart Auto-Scroll Helper Functions
function isUserNearBottom() {
    if (!chatContainer) return true;
    const distanceFromBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
    return distanceFromBottom < SCROLL_THRESHOLD;
}

function smartAutoScroll() {
    if (!chatContainer) return;

    // Check if auto-scroll is enabled in settings
    if (!modelSettings.autoScroll) return;

    // Only auto-scroll if user is near bottom
    if (!userScrolledAway && isUserNearBottom()) {
        // Set flag to prevent scroll listener from triggering during programmatic scroll
        isProgrammaticScroll = true;
        chatContainer.scrollTop = chatContainer.scrollHeight;
        // Reset flag after scroll event has fired (50ms should be enough)
        setTimeout(() => { isProgrammaticScroll = false; }, 50);
    }
}

function throttledSmartScroll() {
    scrollChunkCounter++;
    if (scrollChunkCounter % SCROLL_EVERY_N_CHUNKS === 0) {
        smartAutoScroll();
    }
}

function setupScrollListener() {
    if (!chatContainer) return;

    chatContainer.addEventListener('scroll', () => {
        // Ignore programmatic scrolling - only track manual user scrolling
        if (isProgrammaticScroll) return;

        // Detect if user manually scrolled away from bottom
        userScrolledAway = !isUserNearBottom();
    });
}

function resetScrollState() {
    userScrolledAway = false;
    scrollChunkCounter = 0;
    // Disable smooth scrolling during streaming
    if (chatContainer) {
        chatContainer.style.scrollBehavior = 'auto';
    }
}

function restoreSmoothScroll() {
    // Re-enable smooth scrolling after streaming completes
    if (chatContainer) {
        chatContainer.style.scrollBehavior = 'smooth';
    }
}

// Activity Status Update Functions
function updateActivityStatus(status) {
    if (!activityText) return;
    activityText.textContent = status;
}

function updateSendButtonState(mode) {
    if (!sendBtn) return;

    const sendIcon = sendBtn.querySelector('.send-icon');
    const stopIcon = sendBtn.querySelector('.stop-icon');

    if (mode === 'stop') {
        sendBtn.dataset.mode = 'stop';
        sendBtn.title = 'Stop';
        if (sendIcon) sendIcon.style.display = 'none';
        if (stopIcon) stopIcon.style.display = 'block';
    } else {
        sendBtn.dataset.mode = 'send';
        sendBtn.title = 'Send';
        if (sendIcon) sendIcon.style.display = 'block';
        if (stopIcon) stopIcon.style.display = 'none';
    }
}

// Check Ollama Connection
async function checkOllamaConnection() {
    try {
        const response = await makeOllamaRequest('/api/tags');
        const data = await response.json();
        // If we get data, connection is successful
        if (data) {
            updateStatus(true, 'Connected');
        } else {
            updateStatus(false, 'Connection failed');
        }
    } catch (error) {
        updateStatus(false, 'Not connected');
        console.error('Connection error:', error);
    }
}

function updateStatus(connected, text) {
    statusText.textContent = text;
    if (connected) {
        statusDot.classList.add('connected');
    } else {
        statusDot.classList.remove('connected');
    }
}

// Check if a model supports tool calling
function supportsTools(modelName) {
    // Check cache first
    if (modelToolCapabilities.has(modelName)) {
        return modelToolCapabilities.get(modelName);
    }

    // Check against known prefixes
    const normalizedName = modelName.toLowerCase();
    const supports = TOOL_CAPABLE_MODEL_PREFIXES.some(prefix =>
        normalizedName.startsWith(prefix)
    );

    // Cache result
    modelToolCapabilities.set(modelName, supports);

    // Log detection
    console.log(`🔍 Tool capability detection for "${modelName}": ${supports ? '✅ SUPPORTED' : '❌ NOT SUPPORTED'}`);

    return supports;
}

// Get maximum context length for a model
function getModelContextLimit(modelName) {
    if (!modelName) return MODEL_CONTEXT_LIMITS['default'];

    const lowerModel = modelName.toLowerCase();

    // 1. Check for exact match
    if (MODEL_CONTEXT_LIMITS[lowerModel]) {
        return MODEL_CONTEXT_LIMITS[lowerModel];
    }

    // 2. Check for wildcard patterns (e.g., "phi3:*-128k")
    for (const [pattern, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
        if (pattern.includes('*')) {
            // Convert wildcard pattern to regex
            const regexPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
            const regex = new RegExp(`^${regexPattern}$`);
            if (regex.test(lowerModel)) {
                console.log(`📏 Context limit for "${modelName}": ${limit.toLocaleString()} tokens (matched pattern: ${pattern})`);
                return limit;
            }
        }
    }

    // 3. Check for prefix match (e.g., "llama3.2:3b" matches "llama3.2")
    for (const [prefix, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
        if (!prefix.includes('*') && prefix !== 'default' && lowerModel.startsWith(prefix)) {
            console.log(`📏 Context limit for "${modelName}": ${limit.toLocaleString()} tokens (matched prefix: ${prefix})`);
            return limit;
        }
    }

    // 4. Fallback to default
    console.log(`📏 Context limit for "${modelName}": ${MODEL_CONTEXT_LIMITS['default'].toLocaleString()} tokens (using default)`);
    return MODEL_CONTEXT_LIMITS['default'];
}

// Notify renderer about model capability (for UI updates)
function notifyModelCapability(modelName) {
    const capable = supportsTools(modelName);
    if (typeof window.updateCodeButtonState === 'function') {
        window.updateCodeButtonState(capable);
    }
}

// Load Available Models (Chat Models only, excludes embedding models)
async function loadModels() {
    try {
        const response = await makeOllamaRequest('/api/tags');
        const data = await response.json();

        modelSelect.innerHTML = '';

        if (data.models && data.models.length > 0) {
            // Filter out embedding models
            const chatModels = data.models.filter(model =>
                !model.name.toLowerCase().includes('embed')
            );

            if (chatModels.length > 0) {
                chatModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.name;
                    option.textContent = model.name;
                    modelSelect.appendChild(option);

                    // Detect tool capability for this model
                    supportsTools(model.name);
                });

                // Restore saved model selection from localStorage or fallback to first model
                const savedModel = localStorage.getItem('ollmini-selected-model');
                const modelNames = chatModels.map(m => m.name);

                if (savedModel && modelNames.includes(savedModel)) {
                    // Restore saved model
                    currentModel = savedModel;
                    modelSelect.value = savedModel;
                    console.log('🔧 Restored model from localStorage:', savedModel);
                } else {
                    // Fallback to first model
                    currentModel = chatModels[0].name;
                    modelSelect.value = currentModel;
                    console.log('📝 Using default model (first available):', currentModel);
                }

                // Notify UI about current model's tool capability
                notifyModelCapability(currentModel);

                // Initialize Permission Manager after models are loaded
                initPermissionManager();
            } else {
                modelSelect.innerHTML = '<option>No chat models available</option>';
            }
        } else {
            modelSelect.innerHTML = '<option>No models available</option>';
        }
    } catch (error) {
        console.error('Error loading models:', error);
        modelSelect.innerHTML = '<option>Error loading models</option>';
    }
}

// Load Embedding Models (for RAG settings dropdown)
async function loadEmbeddingModels() {
    try {
        const response = await makeOllamaRequest('/api/tags');
        const data = await response.json();

        if (data.models && data.models.length > 0) {
            // Filter only embedding models
            const embeddingModels = data.models.filter(model =>
                model.name.toLowerCase().includes('embed')
            );
            return embeddingModels.map(model => model.name);
        }
        return [];
    } catch (error) {
        console.error('Error loading embedding models:', error);
        return [];
    }
}

// Load Reranker Models (for RAG settings dropdown)
async function loadRerankerModels() {
    try {
        const response = await makeOllamaRequest('/api/tags');
        const data = await response.json();

        if (data.models && data.models.length > 0) {
            // Filter only reranker models
            const rerankerModels = data.models.filter(model =>
                model.name.toLowerCase().includes('rerank')
            );
            return rerankerModels.map(model => model.name);
        }
        return [];
    } catch (error) {
        console.error('Error loading reranker models:', error);
        return [];
    }
}

// Stream Response from Ollama
async function streamResponse(messageElement, codeModeEnabled, webSearchModeEnabled, parseThinkBlocks, renderMessageParts, createToolExecutionBox, currentThinkingLevel) {
    // Debug: Log entry to streamResponse for Agent Loop debugging
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📡 streamResponse() ENTRY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Code Mode: ${codeModeEnabled}`);
    console.log(`   WebSearch Mode: ${webSearchModeEnabled}`);
    console.log(`   Conversation length: ${conversationHistory.length}`);
    console.log(`   Last 3 messages:`, conversationHistory.slice(-3).map(m => `${m.role}: ${m.content?.substring(0, 50) || '[tool]'}...`));
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 DEBUG: After separator log (line 467)');

    // Reset WebSearch counter for new user queries (prevents infinite loops per query, allows new searches for new queries)
    console.log('🔍 DEBUG: Before lastMessage check (line 470)');
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    console.log('🔍 DEBUG: lastMessage =', lastMessage);

    if (lastMessage && lastMessage.role === 'user') {
        console.log('🔍 DEBUG: Inside user role check (line 471)');
        if (webSearchCallCount > 0) {
            console.log(`🔄 New user query detected - resetting WebSearch counter (was: ${webSearchCallCount})`);
        }
        webSearchCallCount = 0;
        console.log('🔍 DEBUG: After webSearchCallCount reset (line 475)');
    }
    console.log('🔍 DEBUG: After lastMessage if-block (line 476)');

    // Create new AbortController for this request
    console.log('🔍 DEBUG: Before AbortController creation (line 478)');
    abortController = new AbortController();
    console.log('🔍 DEBUG: After AbortController creation (line 479)');

    // Update button state to stop mode
    console.log('🔍 DEBUG: Before updateSendButtonState (line 481)');
    updateSendButtonState('stop');
    console.log('🔍 DEBUG: After updateSendButtonState (line 482)');

    // RAG: Check if RAG is enabled and perform search
    console.log('🔍 DEBUG: Before RAG variable declarations (line 484)');
    let ragContext = '';
    let ragData = null;
    let ragOriginalUserContent = null;  // Store original content for API copy
    console.log('🔍 DEBUG: After RAG variable declarations (line 487)');

    // Check if this is an agent loop follow-up (last message is 'tool')
    // Skip RAG during agent loop as tool results already provide context
    console.log('🔍 DEBUG: Before isAgentLoopFollowup check (line 489)');
    console.log('🔍 DEBUG: conversationHistory.length =', conversationHistory.length);
    console.log('🔍 DEBUG: conversationHistory[length-1] =', conversationHistory[conversationHistory.length - 1]);
    const isAgentLoopFollowup = conversationHistory.length > 0 &&
                                conversationHistory[conversationHistory.length - 1].role === 'tool';
    console.log('🔍 DEBUG: isAgentLoopFollowup =', isAgentLoopFollowup);

    // Check if RAG was auto-disabled due to failures
    console.log('🔍 DEBUG: Before ragEffectivelyEnabled check (line 494)');
    console.log('🔍 DEBUG: modelSettings.ragEnabled =', modelSettings.ragEnabled);
    console.log('🔍 DEBUG: ragAutoDisabled =', ragAutoDisabled);
    const ragEffectivelyEnabled = modelSettings.ragEnabled &&
                                  !ragAutoDisabled &&
                                  !isAgentLoopFollowup;
    console.log('🔍 DEBUG: ragEffectivelyEnabled =', ragEffectivelyEnabled);

    console.log('🔍 DEBUG: Before RAG if-statement (line 499)');
    if (ragEffectivelyEnabled) {
        // Update activity status
        updateActivityStatus('Searching RAG...');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🔍 RAG Mode: ENABLED');
        console.log('═══════════════════════════════════════════════════════════');
        try {
            // Get last user message
            const lastUserMessage = conversationHistory.filter(msg => msg.role === 'user').pop();
            if (lastUserMessage && lastUserMessage.content) {
                console.log(`   Query: "${lastUserMessage.content.substring(0, 100)}${lastUserMessage.content.length > 100 ? '...' : ''}"`);
                console.log('   Searching indexed documents...');

                const ragStartTime = Date.now();

                // Add timeout to prevent indefinite hanging during reranker model loading
                const RAG_TIMEOUT_MS = 30000; // 30 seconds
                try {
                    ragData = await Promise.race([
                        ipcRenderer.invoke('rag-search', lastUserMessage.content),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('RAG search timeout')), RAG_TIMEOUT_MS)
                        )
                    ]);
                } catch (timeoutError) {
                    console.error(`⏱️ RAG search timed out after ${RAG_TIMEOUT_MS}ms`);
                    console.error('   This may be caused by reranker model loading delays');
                    throw timeoutError; // Will be caught by outer try-catch at line 505
                }

                const ragDuration = Date.now() - ragStartTime;

                // Check if RAG search returned an error (not just "no results")
                if (ragData && ragData.error) {
                    throw new Error(ragData.errorMessage || 'RAG search failed');
                }

                if (ragData && ragData.results && ragData.results.length > 0) {
                    console.log(`   ✅ Search completed in ${ragDuration}ms`);
                    console.log(`   Found: ${ragData.chunksCount} chunks from ${ragData.sourcesCount} source files`);
                    console.log(`   Top results:`);
                    ragData.results.slice(0, 3).forEach((r, i) => {
                        console.log(`      ${i + 1}. ${r.filePath} (score: ${r.score?.toFixed(4) || 'N/A'})`);
                    });

                    ragContext = ragData.results.map((r, i) =>
                        `[${i + 1}] ${r.text}\n(Source: ${r.filePath})`
                    ).join('\n\n');

                    // Find last user message index for RAG context injection
                    const lastUserIndex = conversationHistory.findIndex((msg, idx) =>
                        msg.role === 'user' && idx === conversationHistory.length - 1 -
                        (conversationHistory[conversationHistory.length - 1].role === 'assistant' ? 1 : 0)
                    );

                    // Store original content for API copy (don't mutate conversationHistory!)
                    if (lastUserIndex !== -1) {
                        ragOriginalUserContent = conversationHistory[lastUserIndex].content;
                    }

                    // Update RAG Display UI
                    if (typeof window.updateRagDisplay === 'function') {
                        window.updateRagDisplay(ragData);
                    }

                    // Broadcast RAG query to dashboard
                    const scores = ragData.results.map(r => r.score || 0);
                    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
                    ipcRenderer.send('broadcast-query-update', {
                        timestamp: Date.now(),
                        query: lastUserMessage.content,
                        resultsCount: ragData.chunksCount,
                        avgScore: avgScore,
                        duration: ragDuration,
                        scores: scores
                    });

                    // Record RAG query for analytics tracking
                    if (typeof window.recordRagQuery === 'function') {
                        window.recordRagQuery({
                            timestamp: Date.now(),
                            query: lastUserMessage.content,
                            resultsCount: ragData.chunksCount,
                            avgScore: avgScore,
                            duration: ragDuration,
                            scores: scores
                        });
                    }

                    console.log(`   Context injected into conversation`);
                    console.log('═══════════════════════════════════════════════════════════');

                    // RAG Search succeeded - reset failure counter
                    ragConsecutiveFailures = 0;

                } else {
                    console.log('   ℹ️ No relevant documents found');
                    console.log('═══════════════════════════════════════════════════════════');
                    // Update RAG Display UI (no results)
                    if (typeof window.updateRagDisplay === 'function') {
                        window.updateRagDisplay({ chunksCount: 0, sourcesCount: 0, duration: ragData?.duration || 0 });
                    }

                    // No results is not a failure - reset counter
                    ragConsecutiveFailures = 0;
                }
            }
        } catch (error) {
            // RAG Search failed - increment failure counter
            ragConsecutiveFailures++;

            console.error('═══════════════════════════════════════════════════════════');
            console.error('❌ RAG Search Failed');
            console.error('═══════════════════════════════════════════════════════════');
            console.error(`   Error: ${error.message}`);
            console.error(`   Consecutive failures: ${ragConsecutiveFailures}/${MAX_RAG_FAILURES}`);
            console.error('═══════════════════════════════════════════════════════════');

            // Check if we should auto-disable RAG
            if (ragConsecutiveFailures >= MAX_RAG_FAILURES && !ragAutoDisabled) {
                ragAutoDisabled = true;
                console.error('🛡️ RAG Auto-Disabled due to persistent failures');
                console.error(`   Failed ${MAX_RAG_FAILURES}× consecutively`);
                console.error(`   RAG will be skipped for rest of session`);
                console.error('═══════════════════════════════════════════════════════════');

                // Notify user via UI
                if (typeof window.notifyRagAutoDisabled === 'function') {
                    window.notifyRagAutoDisabled();
                }
            }

            // Update RAG Display UI (error)
            if (typeof window.updateRagDisplay === 'function') {
                window.updateRagDisplay({ chunksCount: 0, sourcesCount: 0, duration: 0, error: true });
            }

            // Continue WITHOUT RAG context - don't throw error
            console.warn('⚠️ Continuing request WITHOUT RAG context');
        }
    } else if (modelSettings.ragEnabled && ragAutoDisabled) {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('⚪ RAG Mode: AUTO-DISABLED (persistent failures)');
        console.log('═══════════════════════════════════════════════════════════');
        // Update RAG Display to show auto-disabled state
        if (typeof window.updateRagDisplay === 'function') {
            window.updateRagDisplay({ chunksCount: 0, sourcesCount: 0, duration: 0, autoDisabled: true });
        }
    } else {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('⚪ RAG Mode: DISABLED');
        console.log('═══════════════════════════════════════════════════════════');
        // Update RAG Display to show disabled state
        if (typeof window.updateRagDisplay === 'function') {
            window.updateRagDisplay({ chunksCount: 0, sourcesCount: 0, duration: 0, disabled: true });
        }
    }

    // Build conversation with pinned messages
    let messagesToSend = conversationHistory;

    // Check if pin-manager is available and has pinned messages
    if (typeof window.buildConversationWithPins === 'function') {
        messagesToSend = window.buildConversationWithPins(conversationHistory);
        if (messagesToSend.length > conversationHistory.length) {
            console.log(`📌 Including ${messagesToSend.length - conversationHistory.length} pinned messages in request`);
        }
    }

    // Create deep copy for API request (preserves original conversationHistory)
    // This prevents RAG context from mutating the stored chat history
    // CRITICAL: Remove ALL internal metadata and compatibility fields before sending to Ollama API
    // When adding new metadata fields to messages, ensure they are deleted here to prevent HTTP 400 errors
    messagesToSend = messagesToSend.map(msg => {
        const cleaned = {...msg};
        delete cleaned.ToolName;   // gpt-oss template compatibility field
        delete cleaned.Content;    // gpt-oss template compatibility field
        delete cleaned._pinned;    // Pin Manager internal metadata (causes HTTP 400 if sent)
        delete cleaned._pinnedId;  // Pin Manager internal metadata (causes HTTP 400 if sent)
        delete cleaned._pinnedIds; // Pin Manager internal metadata (plural form, causes HTTP 400 if sent)
        delete cleaned.tool_name;  // Internal tool tracking field (causes HTTP 400 if sent to Ollama)
        return cleaned;
    });

    // PHASE 2: VALIDATION LAYER - Pre-send validation with auto-cleanup
    // Catches any metadata fields that escaped the cleanup above
    const invalidFields = ['ToolName', 'Content', '_pinned', '_pinnedId', '_pinnedIds', 'tool_name'];
    messagesToSend = messagesToSend.map((msg, idx) => {
        const foundInvalidFields = invalidFields.filter(field => msg.hasOwnProperty(field));

        if (foundInvalidFields.length > 0) {
            console.warn(`⚠️ VALIDATION: Message ${idx} contains invalid fields: ${foundInvalidFields.join(', ')}`);
            console.warn(`⚠️ Auto-cleaning these fields to prevent HTTP 400 error`);

            const cleaned = {...msg};
            foundInvalidFields.forEach(field => delete cleaned[field]);
            return cleaned;
        }

        return msg;
    });

    // Inject RAG context into API copy only (not original conversationHistory!)
    if (ragContext && ragOriginalUserContent !== null) {
        const lastUserIndex = messagesToSend.findIndex((msg, idx) =>
            msg.role === 'user' && idx === messagesToSend.length - 1 -
            (messagesToSend[messagesToSend.length - 1].role === 'assistant' ? 1 : 0)
        );

        if (lastUserIndex !== -1) {
            messagesToSend[lastUserIndex].content =
                `[CONTEXT - Retrieved from indexed documents]\n${ragContext}\n[/CONTEXT]\n\nUser Question: ${ragOriginalUserContent}`;
        }
    }

    // Validate that no uppercase dual-fields remain (debug check)
    messagesToSend.forEach((msg, idx) => {
        if (msg.ToolName || msg.Content) {
            console.error(`⚠️ VALIDATION FAILED: Message ${idx} still has uppercase fields!`, msg);
            console.error('   This will cause Ollama API rejection (HTTP 400)');
        }
    });

    // Build request body
    const requestBody = {
        model: currentModel,
        messages: messagesToSend,
        stream: true,
        options: {
            temperature: modelSettings.temperature,
            num_ctx: modelSettings.num_ctx,
            top_p: modelSettings.top_p,
            top_k: modelSettings.top_k,
            repeat_penalty: modelSettings.repeat_penalty
        }
    };

    // Add seed if specified
    if (modelSettings.seed !== null) {
        requestBody.options.seed = modelSettings.seed;
    }

    // Add tools based on enabled modes
    // IMPORTANT: Only add tools if model supports tool calling API
    if (codeModeEnabled && supportsTools(currentModel)) {
        requestBody.tools = SYSTEM_TOOLS;
    }
    // Only add WebSearch tools if provider is configured (not 'disabled')
    if (webSearchModeEnabled &&
        modelSettings.webSearchProvider !== 'disabled' &&
        supportsTools(currentModel)) {
        requestBody.tools = [...(requestBody.tools || []), ...WEB_TOOLS];
    }
    if ((codeModeEnabled || webSearchModeEnabled) && !supportsTools(currentModel)) {
        // Log warning when tools would be blocked
        console.warn(`⚠️ Tools not sent: Model "${currentModel}" does not support tool calling API`);
    }

    // Add thinking level for gpt-oss models only
    // Note: qwen3 uses different think parameter format (boolean via template, not string level)
    if (currentThinkingLevel && currentModel.startsWith('gpt-oss')) {
        requestBody.think = currentThinkingLevel;
    }

    // Debug: Log tools being sent to API
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 Ollama API Request');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Model: ${requestBody.model}`);
    console.log(`   Code Mode: ${codeModeEnabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   WebSearch Mode: ${webSearchModeEnabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   Tools Count: ${requestBody.tools?.length || 0}`);
    if (requestBody.tools && requestBody.tools.length > 0) {
        console.log(`   Available Tools:`);
        requestBody.tools.forEach(t => console.log(`      - ${t.function.name}`));
    }
    console.log(`   History Length: ${conversationHistory.length} messages`);
    console.log(`   Temperature: ${requestBody.options.temperature}`);
    console.log(`   Context Window: ${requestBody.options.num_ctx}`);
    // Log thinking parameter if present
    if (requestBody.think) {
        console.log(`   🧠 Thinking Level: ${requestBody.think}`);
    }
    console.log('═══════════════════════════════════════════════════════════');

    // Update activity status - starting generation
    updateActivityStatus('Generating response...');

    // Variables for streaming response processing
    let assistantMessage = '';
    let thinkingMessage = '';  // Separate thinking accumulator
    let toolCalls = [];

    // Reset scroll state for new streaming session
    resetScrollState();

    try {
        // Use Node.js HTTP instead of fetch() to bypass CORS preflight
        await new Promise((resolveStream, rejectStream) => {
            const url = new URL(`${OLLAMA_API_URL}/api/chat`);
            const httpModule = url.protocol === 'https:' ? https : http;

            const req = httpModule.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 120000  // 2 minute timeout for streaming
            }, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    // Read error response body from Ollama
                    let errorBody = '';
                    res.on('data', (chunk) => {
                        errorBody += chunk.toString();
                    });
                    res.on('end', () => {
                        // Log full request for debugging
                        console.error('═══════════════════════════════════════════════════════════');
                        console.error(`❌ HTTP ERROR: ${res.statusCode}`);
                        console.error('═══════════════════════════════════════════════════════════');
                        console.error('Request URL:', `${OLLAMA_API_URL}/api/chat`);
                        console.error('Request Body (AFTER cleanup):', JSON.stringify(cleanedBody, null, 2));
                        console.error('-----------------------------------------------------------');
                        console.error('Ollama Error Response:', errorBody);
                        console.error('═══════════════════════════════════════════════════════════');
                        rejectStream(new Error(`HTTP error! status: ${res.statusCode} - ${errorBody}`));
                    });
                    return;
                }

                console.log(`✅ HTTP Request successful, status: ${res.statusCode}`);

                const decoder = new TextDecoder();
                let buffer = '';  // Buffer for incomplete JSON lines

                res.on('data', async (value) => {
                    // Decode chunk and add to buffer
                    buffer += decoder.decode(value, { stream: true });

                    // Split by newlines but keep incomplete last line in buffer
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';  // Keep last incomplete line in buffer

                    // Process complete lines
                    for (const line of lines) {
                        if (!line.trim()) continue;

                        try {
                            const data = JSON.parse(line);

                // NEW: Extract thinking field from Ollama response
                if (data.message && data.message.thinking) {
                    thinkingMessage += data.message.thinking;
                }

                if (data.message && data.message.content) {
                    assistantMessage += data.message.content;

                    // Build parts array manually: thinking first, then content
                    const parts = [];

                    // Add thinking block if we have thinking content
                    if (thinkingMessage.trim()) {
                        parts.push({ type: 'think', text: thinkingMessage.trim() });
                    }

                    // Parse content for legacy channel tags (fallback for qwen3)
                    const contentParts = parseThinkBlocks(assistantMessage);
                    parts.push(...contentParts);

                    renderMessageParts(messageElement, parts, !data.done);

                    // Throttled smart scroll - only scroll every N chunks if user is at bottom
                    throttledSmartScroll();
                }

                // Check for tool calls from API
                if (data.message && data.message.tool_calls) {
                    // FIX: Normalize tool_calls.function.arguments to OBJECT
                    // Ollama API expects arguments as OBJECT, not STRING
                    // Root cause of HTTP 400: "cannot unmarshal string into Go struct field"
                    const normalizedCalls = data.message.tool_calls.map(tc => ({
                        ...tc,
                        function: {
                            ...tc.function,
                            arguments: typeof tc.function.arguments === 'string'
                                ? JSON.parse(tc.function.arguments)
                                : tc.function.arguments
                        }
                    }));
                    // Accumulate normalized tool calls instead of overwriting
                    toolCalls.push(...normalizedCalls);
                }

                if (data.done) {
                    messageElement.classList.remove('streaming');

                    // Update activity status and button state
                    updateActivityStatus('Ready');
                    updateSendButtonState('send');

                    // Final scroll to bottom if user is still near bottom
                    smartAutoScroll();
                    // Re-enable smooth scrolling now that streaming is done
                    restoreSmoothScroll();

                    // Extract context usage from API response
                    if (data.prompt_eval_count !== undefined && data.eval_count !== undefined) {
                        currentContextUsage = {
                            promptTokens: data.prompt_eval_count,
                            responseTokens: data.eval_count,
                            totalTokens: data.prompt_eval_count + data.eval_count,
                            maxTokens: modelSettings.num_ctx
                        };

                        // Update UI - Header context display
                        if (typeof window.updateContextDisplay === 'function') {
                            window.updateContextDisplay(currentContextUsage);
                        }

                        // Calculate Context Breakdown for detailed display
                        if (tokenEncoder && typeof window.updateContextBreakdown === 'function') {
                            try {
                                // 1. History tokens (conversation without RAG/tools)
                                const historyString = JSON.stringify(conversationHistory);
                                const historyTokens = tokenEncoder.encode(historyString).length;

                                // 2. RAG tokens (if RAG was used)
                                let ragTokens = 0;
                                if (ragContext && ragContext.length > 0) {
                                    ragTokens = tokenEncoder.encode(ragContext).length;
                                }

                                // 3. Tools tokens (if tools were sent)
                                let toolsTokens = 0;
                                if (requestBody.tools && requestBody.tools.length > 0) {
                                    const toolsString = JSON.stringify(requestBody.tools);
                                    toolsTokens = tokenEncoder.encode(toolsString).length;
                                }

                                // 4. System/Overhead tokens (difference)
                                const accountedTokens = historyTokens + ragTokens + toolsTokens;
                                const totalApiTokens = data.prompt_eval_count + data.eval_count;
                                const systemTokens = Math.max(0, totalApiTokens - accountedTokens);

                                // Send breakdown data to UI
                                window.updateContextBreakdown({
                                    totalTokens: totalApiTokens,
                                    maxTokens: modelSettings.num_ctx,
                                    breakdown: {
                                        history: historyTokens,
                                        rag: ragTokens,
                                        tools: toolsTokens,
                                        system: systemTokens
                                    }
                                });
                            } catch (error) {
                                console.error('❌ Context breakdown calculation error:', error);
                            }
                        }
                    }

                    // Token Counting (tiktoken for accurate counting)
                    let deltaInputTokens = 0;
                    let currentHistoryTokens = 0;
                    let outputTokensCount = 0;

                    if (tokenEncoder) {
                        try {
                            // Count current conversation history length (BEFORE adding new assistant message)
                            const messagesString = JSON.stringify(conversationHistory);
                            currentHistoryTokens = tokenEncoder.encode(messagesString).length;

                            // Count output tokens (assistant response)
                            if (assistantMessage.trim()) {
                                outputTokensCount = tokenEncoder.encode(assistantMessage).length;
                            }

                            // Calculate delta: only NEW INPUT tokens since last message
                            deltaInputTokens = currentHistoryTokens - previousHistoryTokens;
                        } catch (error) {
                            console.error('❌ Token encoding error:', error);
                        }
                    }

                    // Update token counter display with DELTA INPUT only
                    if (typeof window.updateTokenCounter === 'function') {
                        window.updateTokenCounter(deltaInputTokens, outputTokensCount, currentHistoryTokens);
                    }

                    // Update previousHistoryTokens for next delta calculation
                    previousHistoryTokens = currentHistoryTokens + outputTokensCount;

                    // Add assistant message to history
                    conversationHistory.push({
                        role: 'assistant',
                        content: assistantMessage,
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                    });

                    // Debug: Warn if assistant message is empty after streaming
                    if (!assistantMessage || !assistantMessage.trim()) {
                        console.warn('═══════════════════════════════════════════════════════════');
                        console.warn('⚠️ EMPTY ASSISTANT MESSAGE');
                        console.warn('═══════════════════════════════════════════════════════════');
                        console.warn(`   Tool calls: ${toolCalls.length}`);
                        console.warn(`   Thinking message: ${thinkingMessage.length} chars`);
                        console.warn('═══════════════════════════════════════════════════════════');
                    }

                    // Handle tool calls (final validation)
                    if (toolCalls.length > 0) {
                        await handleToolCalls(toolCalls, messageElement, codeModeEnabled, parseThinkBlocks, renderMessageParts, createToolExecutionBox, currentThinkingLevel);
                    }
                }
                        } catch (e) {
                            console.error('Error parsing JSON:', e);
                        }
                    }
                });

                res.on('end', () => {
                    // Process any remaining buffered data
                    if (buffer.trim()) {
                        try {
                            const data = JSON.parse(buffer);
                            // Process final chunk if needed
                        } catch (e) {
                            console.error('Error parsing final JSON chunk:', e);
                        }
                    }
                    resolveStream();
                });

                res.on('error', (error) => {
                    console.error('Response stream error:', error);
                    rejectStream(error);
                });
            });

            req.on('error', (error) => {
                console.error('Request error:', error);
                rejectStream(error);
            });

            req.on('timeout', () => {
                console.error('Request timeout');
                req.destroy();
                rejectStream(new Error('Request timeout'));
            });

            // AbortController support
            if (abortController) {
                abortController.signal.addEventListener('abort', () => {
                    console.log('🛑 Request aborted by user');
                    req.destroy();
                    const error = new Error('AbortError');
                    error.name = 'AbortError';
                    rejectStream(error);
                });
            }

            // VALIDATION: Check for ANY unexpected fields before sending to Ollama API
            // This catches cleanup failures early and prevents HTTP 400 errors
            const OLLAMA_ALLOWED_FIELDS = ['role', 'content', 'tool_calls', 'tool_name'];
            requestBody.messages.forEach((msg, idx) => {
                const unexpectedFields = Object.keys(msg).filter(k => !OLLAMA_ALLOWED_FIELDS.includes(k));
                if (unexpectedFields.length > 0) {
                    console.error(`🚨 CRITICAL: Message ${idx} has unexpected fields:`, unexpectedFields);
                    console.error('   Field cleanup failed! These will cause HTTP 400 error from Ollama API');
                    console.error('   Message:', msg);
                }
            });

            // STAGE 1 FIX: Final cleanup at serialization boundary
            // Addresses orphaned cleanup code from CORS→HTTP migration
            // Ensures NO metadata reaches Ollama API regardless of code path
            console.log('🧹 STAGE 1: Final cleanup before HTTP send');
            const cleanedBody = {
                ...requestBody,
                messages: requestBody.messages.map(msg => {
                    const cleaned = { ...msg };
                    // Remove dual-field compatibility metadata (gpt-oss template)
                    // CONDITIONAL: Only remove template fields for non-gpt-oss models
                    // gpt-oss models REQUIRE ToolName and Content fields in their template
                    if (!currentModel.toLowerCase().startsWith('gpt-oss')) {
                        delete cleaned.ToolName;
                        delete cleaned.Content;
                    }
                    // Remove internal tool tracking fields (but keep tool_name for role: 'tool')
                    if (msg.role !== 'tool') {
                        delete cleaned.tool_name;
                    }
                    delete cleaned.tool_call_id;  // Ollama API does NOT accept tool_call_id
                    // Remove Pin Manager internal metadata
                    delete cleaned._pinned;
                    delete cleaned._pinnedId;
                    delete cleaned._pinnedIds;

                    // FIX: Normalize tool_calls.function.arguments to OBJECT (Defense-in-Depth)
                    // This is the REAL fix for HTTP 400 errors in agent loop
                    // Ollama expects arguments as OBJECT, but they're stored as STRING in conversation history
                    if (cleaned.tool_calls && Array.isArray(cleaned.tool_calls)) {
                        cleaned.tool_calls = cleaned.tool_calls.map(tc => ({
                            ...tc,
                            function: {
                                ...tc.function,
                                arguments: typeof tc.function.arguments === 'string'
                                    ? JSON.parse(tc.function.arguments)
                                    : tc.function.arguments
                            }
                        }));
                    }

                    return cleaned;
                })
            };

            // VALIDATION: Verify tool_calls.function.arguments are OBJECTS, not STRINGS
            console.log('🔍 TOOL_CALLS VALIDATION:');
            let hasStringArguments = false;
            cleanedBody.messages.forEach((msg, idx) => {
                if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                    msg.tool_calls.forEach((tc, tcIdx) => {
                        const argType = typeof tc.function.arguments;
                        console.log(`   Message ${idx} (${msg.role}), Tool ${tcIdx}: arguments type = ${argType}`);
                        if (argType === 'string') {
                            console.error(`   ❌ CRITICAL: arguments is STRING, should be OBJECT!`);
                            hasStringArguments = true;
                        }
                    });
                }
            });
            if (!hasStringArguments) {
                console.log('   ✅ All tool_calls have arguments as OBJECT (correct format)');
            }

            req.write(JSON.stringify(cleanedBody));
            req.end();
        });
    } catch (error) {
        if (error.name === 'AbortError') {
            // Request was aborted by user
            console.log('🛑 Generation aborted by user');

            // Update activity status and button state
            updateActivityStatus('Ready');
            updateSendButtonState('send');

            // Clean up UI
            messageElement.classList.remove('streaming');
            restoreSmoothScroll();

            // Save partial response to conversation history if there's content
            if (assistantMessage && assistantMessage.trim()) {
                conversationHistory.push({
                    role: 'assistant',
                    content: assistantMessage + '\n\n[Generation stopped by user]'
                });

                // Update token counts with partial response
                if (tokenEncoder && assistantMessage.trim()) {
                    const outputTokensCount = tokenEncoder.encode(assistantMessage).length;
                    if (typeof window.updateTokenCounter === 'function') {
                        window.updateTokenCounter(0, outputTokensCount, previousHistoryTokens);
                    }
                    previousHistoryTokens += outputTokensCount;
                }
            }
        } else {
            // Re-throw other errors
            throw error;
        }
    } finally {
        // Clean up abort controller
        abortController = null;
    }
}

// Handle Tool Calls
async function handleToolCalls(toolCalls, messageElement, codeModeEnabled, parseThinkBlocks, renderMessageParts, createToolExecutionBox, currentThinkingLevel) {
    // Remove empty messageElement (from tool-only response)
    if (messageElement && !messageElement.textContent.trim()) {
        messageElement.style.display = 'none';
    }

    for (const toolCall of toolCalls) {
        if (toolCall.function.name === 'web_search' || toolCall.function.name === 'web_fetch') {
            // WebSearch Tool Execution
            try {
                const args = typeof toolCall.function.arguments === 'string'
                    ? JSON.parse(toolCall.function.arguments)
                    : toolCall.function.arguments;

                console.log(`🌐 Executing web tool: ${toolCall.function.name}`);
                console.log(`   Parameters:`, JSON.stringify(args, null, 2));

                const toolStartTime = Date.now();

                // Execute web tool (routes to Ollama or Searx provider)
                const result = await executeWebTool(toolCall.function.name, args);

                const toolDuration = Date.now() - toolStartTime;

                console.log(`✅ Web tool completed: ${toolCall.function.name}`);
                console.log(`   Duration: ${toolDuration}ms`);
                console.log(`   Success: ${result.success}`);

                // Add tool response to history
                // Dual-field approach: Standard API fields + gpt-oss template fields
                conversationHistory.push({
                    role: 'tool',
                    content: JSON.stringify(result),        // Standard Ollama API field
                    tool_name: toolCall.function.name,      // Standard Ollama API field
                    ToolName: toolCall.function.name,       // gpt-oss template compatibility
                    Content: JSON.stringify(result)         // gpt-oss template compatibility
                });

                // Display web tool result using web-result-renderer
                if (typeof window.renderWebToolResult === 'function') {
                    const webResultHtml = window.renderWebToolResult(toolCall, result);
                    const webResultDiv = document.createElement('div');
                    webResultDiv.innerHTML = webResultHtml;
                    // Ensure block-level display for vertical stacking
                    webResultDiv.style.width = '100%';
                    webResultDiv.style.display = 'block';

                    // Insert web result into message-content (for proper vertical stacking with thinking block)
                    const messageContent = messageElement ? messageElement.querySelector('.message-content') : null;
                    if (messageContent) {
                        messageContent.appendChild(webResultDiv);
                    } else {
                        // Fallback: append to chat container if message-content not found
                        chatContainer.appendChild(webResultDiv);
                    }
                    smartAutoScroll();
                } else {
                    console.warn('⚠️ renderWebToolResult function not available');
                }

            } catch (error) {
                console.error(`❌ Web tool execution failed: ${toolCall.function.name}`);
                console.error(`   Error message: ${error.message}`);
                const errorContent = JSON.stringify({
                    success: false,
                    error: error.message
                });
                conversationHistory.push({
                    role: 'tool',
                    content: errorContent,
                    tool_name: toolCall.function.name,
                    ToolName: toolCall.function.name,
                    Content: errorContent
                });
            }
        } else {
            // System Tool Execution (read, write, edit, glob, bash)
            try {
                // Sanitize tool name: Remove channel syntax if present (gpt-oss bug)
                if (toolCall.function.name.includes('<|channel|>')) {
                    const originalName = toolCall.function.name;
                    toolCall.function.name = toolCall.function.name.split('<|channel|>')[0];
                    console.log(`🧹 Sanitized tool name: "${originalName}" → "${toolCall.function.name}"`);
                }

                // Validate tool name AFTER sanitization
                const validToolNames = SYSTEM_TOOLS.map(t => t.function.name);
                const toolName = toolCall.function.name;

                if (!validToolNames.includes(toolName)) {
                    console.error('═══════════════════════════════════════════════════════════');
                    console.error('❌ INVALID TOOL NAME');
                    console.error('═══════════════════════════════════════════════════════════');
                    console.error(`   Requested tool: "${toolName}"`);
                    console.error(`   Valid tools: ${validToolNames.join(', ')}`);
                    console.error('═══════════════════════════════════════════════════════════');

                    // Send error response to model
                    const errorContent = JSON.stringify({
                        success: false,
                        error: `INVALID_TOOL: Tool "${toolName}" does not exist. Valid tools are: ${validToolNames.join(', ')}. Please use a valid tool name without mixing it with channel syntax.`
                    });
                    conversationHistory.push({
                        role: 'tool',
                        content: errorContent,
                        tool_name: toolName,
                        ToolName: toolName,
                        Content: errorContent
                    });

                    continue; // Skip to next tool call
                }

                const args = typeof toolCall.function.arguments === 'string'
                    ? JSON.parse(toolCall.function.arguments)
                    : toolCall.function.arguments;

                const toolStartTime = Date.now();

                // ⭐ PERMISSION CHECK
                if (permissionManager && !permissionManager.isAllowed(toolCall.function.name, args)) {
                    const userChoice = await showPermissionDialog(toolCall, args);

                    if (userChoice === 'deny') {
                        // User denied - send response to model

                        const deniedContent = JSON.stringify({
                            success: false,
                            message: 'DENIED_BY_USER: Respond with exactly: "Der Tool-Call wurde abgelehnt. Wie kann ich dir sonst helfen?"'
                        });
                        conversationHistory.push({
                            role: 'tool',
                            content: deniedContent,
                            tool_name: toolCall.function.name,
                            ToolName: toolCall.function.name,
                            Content: deniedContent
                        });

                        continue; // Skip this tool, move to next
                    } else if (userChoice === 'allow-always') {
                        // Add to permanent allow list
                        permissionManager.addAllowed(toolCall.function.name, args);
                    }
                    // 'allow-once' → Just continue, don't save anything
                }

                // ⭐ LIVE-ANZEIGE: Tool-Execution-Box erstellen
                const execBox = createToolExecutionBox(toolCall, 'executing', smartAutoScroll);
                chatContainer.appendChild(execBox);
                smartAutoScroll(); // Smart scroll after adding tool execution box

                // Execute the system tool via IPC (runs in main process with correct CWD)
                const result = await ipcRenderer.invoke('execute-system-tool', toolCall.function.name, args);

                const toolDuration = Date.now() - toolStartTime;

                // ⭐ Execution-Box als "completed" markieren
                execBox.className = 'tool-execution-box completed';
                execBox.querySelector('.exec-status').innerHTML = '✅ Done';

                // Add tool response to history
                // Dual-field approach: Standard API fields + gpt-oss template fields
                conversationHistory.push({
                    role: 'tool',
                    content: JSON.stringify(result),        // Standard Ollama API field
                    tool_name: toolCall.function.name,      // Standard Ollama API field
                    ToolName: toolCall.function.name,       // gpt-oss template compatibility
                    Content: JSON.stringify(result)         // gpt-oss template compatibility
                });

                // ⭐ Display Tool Result in Chat
                const toolResultDiv = document.createElement('div');
                toolResultDiv.className = `tool-result-section ${result.success ? 'success' : 'error'}`;

                const icon = result.success
                    ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                    </svg>`
                    : `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>`;

                const toggleIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M7 10l5 5 5-5z"/>
                </svg>`;

                let resultContent = '';
                let diffHtml = '';

                // Diff-Detection für edit-Tool mit Kontext
                if (toolCall.function.name === 'edit' && args.old_string && args.new_string) {
                    const changes = Diff.diffLines(args.old_string, args.new_string);
                    const CONTEXT_LINES = 4;

                    diffHtml = '<div class="diff-output"><strong>Changes:</strong>';

                    // Alle Zeilen sammeln mit ihrem Typ
                    const allLines = [];
                    changes.forEach(part => {
                        const lines = part.value.split('\n').filter(l => l.trim());
                        lines.forEach(line => {
                            allLines.push({
                                content: line,
                                type: part.added ? 'add' : part.removed ? 'remove' : 'context'
                            });
                        });
                    });

                    // Zeilen mit Kontext anzeigen
                    const displayedIndices = new Set();

                    // Finde alle geänderten Zeilen und merke Indices
                    allLines.forEach((line, idx) => {
                        if (line.type !== 'context') {
                            // Geänderte Zeile + Kontext drumherum
                            for (let i = Math.max(0, idx - CONTEXT_LINES);
                                 i <= Math.min(allLines.length - 1, idx + CONTEXT_LINES);
                                 i++) {
                                displayedIndices.add(i);
                            }
                        }
                    });

                    // Zeilen ausgeben
                    Array.from(displayedIndices).sort((a, b) => a - b).forEach(idx => {
                        const line = allLines[idx];
                        const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
                        const className = line.type === 'add' ? 'diff-add' :
                                         line.type === 'remove' ? 'diff-remove' : 'diff-context';
                        diffHtml += `<div class="${className}">${prefix} ${line.content}</div>`;
                    });

                    diffHtml += '</div>';
                }

                // Output OHNE Limit - scrollbar stattdessen
                if (result.stdout && result.stdout.trim()) {
                    resultContent = `<div class="result-output scrollable"><strong>Output:</strong><pre>${result.stdout}</pre></div>`;
                } else if (result.content) {
                    resultContent = `<div class="result-output scrollable"><strong>Content:</strong><pre>${result.content}</pre></div>`;
                } else if (result.files) {
                    resultContent = `<div class="result-output scrollable"><strong>Files Found (${result.count}):</strong><pre>${result.files.join('\n')}</pre></div>`;
                } else if (result.message) {
                    resultContent = `<div class="result-message">${result.message}</div>`;
                }

                if (result.error) {
                    resultContent += `<div class="result-error"><strong>Error:</strong> ${result.error}</div>`;
                }

                const header = document.createElement('div');
                header.className = 'tool-result-header';
                header.style.cursor = 'pointer';
                header.innerHTML = `
                    <span class="result-icon">${icon}</span>
                    <span class="result-label"><strong>${toolCall.function.name}</strong> - ${result.success ? 'Success' : 'Error'}</span>
                    <span class="toggle-icon">${toggleIcon}</span>
                `;

                const content = document.createElement('div');
                content.className = 'tool-result-content';
                content.innerHTML = `
                    ${diffHtml}
                    ${resultContent}
                    <details class="result-raw" open>
                        <summary><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                            <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm0 4c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm6 12H6v-1.4c0-2 4-3.1 6-3.1s6 1.1 6 3.1V19z"/>
                        </svg> Raw JSON</summary>
                        <pre><code class="language-json">${JSON.stringify(result, null, 2)}</code></pre>
                    </details>
                `;

                header.addEventListener('click', () => {
                    toolResultDiv.classList.toggle('expanded');
                });

                toolResultDiv.appendChild(header);
                toolResultDiv.appendChild(content);

                chatContainer.appendChild(toolResultDiv);
                smartAutoScroll(); // Smart scroll after adding tool result

            } catch (error) {
                console.error(`❌ System tool execution failed: ${toolCall.function.name}`);
                console.error(`   Error message: ${error.message}`);
                console.error(`   Error stack:`, error.stack);
                console.error(`   Tool args:`, JSON.stringify(args, null, 2));
                const errorContent = JSON.stringify({
                    success: false,
                    error: error.message
                });
                conversationHistory.push({
                    role: 'tool',
                    content: errorContent,
                    tool_name: toolCall.function.name,
                    ToolName: toolCall.function.name,
                    Content: errorContent
                });
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 🔄 AGENT LOOP: Request follow-up from model after tool execution
    // ═══════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔄 AGENT LOOP: All tools executed, requesting follow-up');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Tools executed: ${toolCalls.length}`);
    console.log(`   Conversation history length: ${conversationHistory.length}`);
    console.log(`   Last message role: ${conversationHistory[conversationHistory.length - 1]?.role}`);
    console.log(`   Last message has ToolName: ${!!conversationHistory[conversationHistory.length - 1]?.ToolName}`);
    console.log('═══════════════════════════════════════════════════════════');

    // ═══════════════════════════════════════════════════════════
    // 🛡️ AGENT LOOP SAFETY CHECKS - 5 Layer Protection System
    // ═══════════════════════════════════════════════════════════
    console.log('🛡️ Running Agent Loop Safety Checks...');

    try {
        // LAYER 1: Context Window Protection (90% threshold)
        const contextUsage = calculateContextUsage(conversationHistory);
        if (contextUsage > 0.90) {
            throw new AgentLoopError(
                `Context window critically full (${(contextUsage * 100).toFixed(1)}%). Forcing final response to prevent context overflow.`,
                1
            );
        }

        // LAYER 2: Duplicate Tool Detection (same tool called twice with same params)
        const lastTwoTools = getLastNToolCalls(conversationHistory, 2);
        if (lastTwoTools.length === 2 &&
            lastTwoTools[0].name === lastTwoTools[1].name &&
            JSON.stringify(lastTwoTools[0].params) === JSON.stringify(lastTwoTools[1].params)) {

            console.warn('⚠️ DUPLICATE TOOL DETECTED - Injecting guidance message');
            conversationHistory.push({
                role: 'user',
                content: 'You called the same tool twice with identical parameters. This suggests you may be stuck in a loop. Please provide your final answer based on the tool results you already have, or try a different approach.'
            });
        }

        // LAYER 3: Empty Response Counter (Progressive Prompting)
        const emptyResponseCount = countConsecutiveEmptyResponses(conversationHistory);

        if (emptyResponseCount === 2) {
            console.warn('⚠️ 2 consecutive empty responses - Injecting hint');
            conversationHistory.push({
                role: 'user',
                content: 'Based on the tool results above, please now provide your text response to my original question.'
            });
        } else if (emptyResponseCount === 3) {
            console.warn('⚠️ 3 consecutive empty responses - Injecting explicit instruction');
            conversationHistory.push({
                role: 'user',
                content: 'You MUST provide a text response now. Summarize the tool results and answer my question. Do not call more tools without providing text first.'
            });
        } else if (emptyResponseCount >= 4) {
            throw new AgentLoopError(
                `Model generated ${emptyResponseCount} consecutive tool calls without text response. This indicates an agent loop bug. Aborting to prevent infinite loop.`,
                3
            );
        }

        // LAYER 4: Model-Specific Handling
        if (currentModel.toLowerCase().startsWith('gpt-oss') && emptyResponseCount >= 2) {
            console.log('🧠 gpt-oss detected with empty responses - Adding model-specific guidance');
            conversationHistory.push({
                role: 'user',
                content: 'Provide your final answer based on the tool results. Focus on answering the original question with the information you gathered.'
            });
        }

        if (currentModel.toLowerCase().startsWith('qwen')) {
            // Strip thinking content from history to prevent pollution
            conversationHistory = stripThinkingFromHistory(conversationHistory);
        }

        // LAYER 5: Emergency Brake (Absolute limit)
        const totalToolCalls = countTotalToolCalls(conversationHistory);
        if (totalToolCalls > 50) {
            throw new AgentLoopError(
                `Safety limit exceeded: ${totalToolCalls} tool calls in this conversation. This suggests a possible infinite loop. Please start a new conversation.`,
                5
            );
        }

        console.log('✅ All safety checks passed');

    } catch (error) {
        if (error instanceof AgentLoopError) {
            console.error('═══════════════════════════════════════════════════════════');
            console.error(`🛑 AGENT LOOP SAFETY TRIGGER - Layer ${error.layer}`);
            console.error('═══════════════════════════════════════════════════════════');
            console.error(`   Reason: ${error.message}`);
            console.error('═══════════════════════════════════════════════════════════');

            // Add safety error message to chat
            const safetyMessageDiv = document.createElement('div');
            safetyMessageDiv.className = 'message system';
            safetyMessageDiv.innerHTML = `
                <div class="message-content">
                    <div style="padding: 12px; background: rgba(255, 152, 0, 0.1); border-left: 3px solid #ff9800; border-radius: 6px;">
                        <strong>🛡️ Agent Loop Safety System</strong><br>
                        ${error.message}
                    </div>
                </div>
            `;
            chatContainer.appendChild(safetyMessageDiv);
            smartAutoScroll();

            // Stop agent loop - do NOT continue
            return;
        } else {
            // Re-throw non-safety errors
            throw error;
        }
    }

    // ✨ Request follow-up from model (Agent Loop)
    // After tool execution, model continues with tools enabled for multi-step reasoning

    try {
        // Create a new message element for the follow-up using existing addMessage function
        // This automatically sets _messageId, _messageRole, _messageDiv metadata required for buttons
        const messageContent = window.messageRendererModule.addMessage('assistant', '', true);

        // PHASE 3: ENHANCED AGENT LOOP LOGGING - Track execution state
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📡 AGENT LOOP: Initiating streamResponse for follow-up');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`   Code Mode: ${codeModeEnabled ? 'ENABLED' : 'DISABLED'}`);
        console.log(`   Conversation messages: ${conversationHistory.length}`);
        console.log(`   Payload size: ${JSON.stringify(conversationHistory).length} characters`);
        console.log(`   Last 3 message roles:`, conversationHistory.slice(-3).map(m => m.role));

        // Check for any remaining metadata before streamResponse
        const hasMetadata = conversationHistory.some(msg =>
            msg._pinned || msg._pinnedId || msg._pinnedIds || msg.ToolName || msg.Content || msg.tool_name
        );
        if (hasMetadata) {
            console.warn('⚠️ WARNING: Conversation still contains metadata fields!');
            console.warn('   This should have been cleaned by validation layer');
        }

        console.log('📡 Calling streamResponse for follow-up (tools enabled)...');
        const agentLoopStartTime = Date.now();

        // PHASE 5: TIMEOUT PROTECTION - Wrap streamResponse with timeout
        const AGENT_LOOP_TIMEOUT_MS = 120000; // 2 minutes (generous for slow models)

        try {
            // Stream the follow-up WITH tools (Agent Loop - model can continue working on the task)
            await Promise.race([
                streamResponse(messageContent, codeModeEnabled, false, parseThinkBlocks, renderMessageParts, createToolExecutionBox, currentThinkingLevel),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Agent loop timeout after ${AGENT_LOOP_TIMEOUT_MS}ms`)), AGENT_LOOP_TIMEOUT_MS)
                )
            ]);

            const agentLoopDuration = Date.now() - agentLoopStartTime;
            console.log('═══════════════════════════════════════════════════════════');
            console.log('✅ AGENT LOOP: streamResponse completed successfully');
            console.log('═══════════════════════════════════════════════════════════');
            console.log(`   Duration: ${agentLoopDuration}ms`);
            console.log('═══════════════════════════════════════════════════════════');
        } catch (timeoutError) {
            const agentLoopDuration = Date.now() - agentLoopStartTime;
            console.error('═══════════════════════════════════════════════════════════');
            console.error('⏱️ AGENT LOOP: TIMEOUT DETECTED');
            console.error('═══════════════════════════════════════════════════════════');
            console.error(`   Elapsed time: ${agentLoopDuration}ms`);
            console.error(`   Timeout limit: ${AGENT_LOOP_TIMEOUT_MS}ms`);
            console.error(`   Error message: ${timeoutError.message}`);
            console.error('═══════════════════════════════════════════════════════════');
            throw timeoutError; // Re-throw to outer catch block
        }

        // Add pin buttons to tool explanation message (after streaming is complete)
        // messageContent now has metadata set by addMessage(), so we can access it directly
        const explanationMessageDiv = messageContent._messageDiv;
        const explanationMessageId = messageContent._messageId;
        const explanationRole = messageContent._messageRole;
        if (explanationMessageDiv && explanationMessageId && explanationRole) {
            if (typeof window.addPinButtonsToMessage === 'function') {
                window.addPinButtonsToMessage(explanationMessageDiv, explanationMessageId, explanationRole, modelSettings.ragEnabled);
            }
        }
    } catch (error) {
        console.error('═══════════════════════════════════════════════════════════');
        console.error('❌ AGENT LOOP FAILED');
        console.error('═══════════════════════════════════════════════════════════');
        console.error(`   Error: ${error.message}`);
        console.error(`   Error name: ${error.name}`);
        console.error(`   Stack:`, error.stack);
        console.error('═══════════════════════════════════════════════════════════');

        // Don't throw - let the app continue, just log the error
        // User will see no follow-up response, which is the symptom we're debugging
        console.warn('⚠️ Agent Loop failed, but tool results are already visible in chat');
        return;  // Prevent error propagation - tool results are already displayed
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// WebSearch Tool Execution (Ollama & Searx providers)
// ═══════════════════════════════════════════════════════════════════════════

// Execute Web Tool (Router function)
async function executeWebTool(toolName, args) {
    console.log(`🌐 Executing web tool: ${toolName}`, args);
    console.log(`🔍 WebSearch Provider Diagnostic:`, {
        provider: modelSettings.webSearchProvider,
        searxUrl: modelSettings.searxUrl || '(not set)',
        ollamaApiKey: modelSettings.ollamaApiKey ? '(set)' : '(not set)',
        willRoute: modelSettings.webSearchProvider === 'searx' ? 'Searx' : 'Ollama'
    });

    // Check WebSearch call limit to prevent infinite loops
    if (toolName === 'web_search') {
        if (webSearchCallCount >= MAX_WEBSEARCH_PER_CONVERSATION) {
            console.warn(`⚠️ WebSearch limit reached: ${webSearchCallCount}/${MAX_WEBSEARCH_PER_CONVERSATION} calls`);
            return {
                success: false,
                error: `WebSearch limit reached (${MAX_WEBSEARCH_PER_CONVERSATION} searches per conversation). This prevents infinite search loops. Please start a new conversation to search again.`
            };
        }
        webSearchCallCount++;
        console.log(`🔢 WebSearch call count: ${webSearchCallCount}/${MAX_WEBSEARCH_PER_CONVERSATION}`);
    }

    // Route to provider-specific implementation
    if (modelSettings.webSearchProvider === 'searx') {
        console.log('✅ Routing to Searx provider');
        return await executeSearxTool(toolName, args);
    } else {
        console.log(`📡 Routing to Ollama provider (provider="${modelSettings.webSearchProvider}")`);
        // Ollama provider (default)
        return await executeOllamaWebTool(toolName, args);
    }
}

// Execute Ollama Web Tool (official Ollama API)
async function executeOllamaWebTool(toolName, args) {
    // Check if API key is set
    if (!modelSettings.ollamaApiKey || modelSettings.ollamaApiKey.trim() === '') {
        return {
            success: false,
            error: 'Ollama API Key is not set. Please configure your API key in Settings → WebSearch Settings → Ollama API Key.\n\nGet a free API key at: https://ollama.com/settings/keys'
        };
    }

    try {
        let endpoint;
        let requestBody;

        if (toolName === 'web_search') {
            endpoint = 'https://ollama.com/api/web_search';
            // Defense Layer 1: Input validation - clamp max_results to 1-10 range
            const maxResults = Math.min(Math.max(args.max_results || 5, 1), 10);
            requestBody = {
                query: args.query,
                max_results: maxResults
            };
        } else if (toolName === 'web_fetch') {
            endpoint = 'https://ollama.com/api/web_fetch';
            requestBody = {
                url: args.url
            };
        } else {
            return {
                success: false,
                error: `Unknown web tool: ${toolName}`
            };
        }

        console.log(`🌐 Calling ${endpoint} with:`, requestBody);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${modelSettings.ollamaApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Web Tool API Error (${response.status}):`, errorText);

            if (response.status === 401) {
                return {
                    success: false,
                    error: 'Invalid API Key (401 Unauthorized). Please check your API key in Settings.\n\nGet a free API key at: https://ollama.com/settings/keys'
                };
            }

            return {
                success: false,
                error: `HTTP ${response.status}: ${errorText}`
            };
        }

        const result = await response.json();
        console.log(`✅ Web Tool Result:`, result);

        // Defense Layer 2: Response validation - limit results to max 10
        if (result.results && result.results.length > 10) {
            console.warn(`⚠️ Ollama API returned ${result.results.length} results, limiting to 10 for performance`);
            result.results = result.results.slice(0, 10);
        }

        // Defense Layer 3: Unicode Filter - sanitize for prompt injection prevention
        console.log('🛡️ Applying Unicode filter to WebSearch results...');
        const sanitizedResult = applyFilterToWebResults(result);

        return {
            success: true,
            ...sanitizedResult
        };

    } catch (error) {
        console.error(`❌ Ollama Web Tool Execution Error:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Execute Searx/SearxNG Web Tool (self-hosted)
async function executeSearxTool(toolName, args) {
    // Check if Searx URL is set
    if (!modelSettings.searxUrl || modelSettings.searxUrl.trim() === '') {
        return {
            success: false,
            error: 'Searx Server URL is not set. Please configure your Searx instance URL in Settings → WebSearch Settings → Searx Server URL.\n\nExample: http://localhost:8888 or https://searx.example.com'
        };
    }

    const searxBaseUrl = modelSettings.searxUrl.replace(/\/$/, ''); // Remove trailing slash

    try {
        if (toolName === 'web_search') {
            // Searx search API
            const query = args.query;
            // Defense Layer 1: Input validation - clamp max_results to 1-10 range
            const maxResults = Math.min(Math.max(args.max_results || 5, 1), 10);

            // Searx search endpoint: /search?q=query&format=json
            const searchUrl = `${searxBaseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;

            console.log(`🌐 Calling Searx at: ${searchUrl}`);

            const response = await makeOllamaRequest(searchUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Searx API Error (${response.status}):`, errorText);

                if (response.status === 404) {
                    return {
                        success: false,
                        error: `Searx endpoint not found (404). Check if your Searx instance is running at ${searxBaseUrl} and supports JSON format (/search?format=json)`
                    };
                }

                return {
                    success: false,
                    error: `HTTP ${response.status}: ${errorText}`
                };
            }

            const result = await response.json();

            // Defense Layer 2: Response validation - limit to maxResults (already clamped to 10)
            const rawResults = result.results || [];
            if (rawResults.length > maxResults) {
                console.warn(`⚠️ Searx returned ${rawResults.length} results, limiting to ${maxResults}`);
            }

            // Map Searx results to Ollama format
            const mappedResults = rawResults
                .slice(0, maxResults)
                .map(r => ({
                    title: r.title || 'No title',
                    url: r.url || '',
                    content: r.content || r.description || 'No description available'
                }));

            console.log(`✅ Searx returned ${mappedResults.length} results (from ${rawResults.length} total)`);

            // Defense Layer 3: Unicode Filter - sanitize for prompt injection prevention
            console.log('🛡️ Applying Unicode filter to Searx results...');
            const sanitizedResult = applyFilterToWebResults({
                success: true,
                results: mappedResults
            });

            return sanitizedResult;

        } else if (toolName === 'web_fetch') {
            // web_fetch: Direct fetch (same for both providers, no API needed)
            const url = args.url;

            console.log(`🌐 Fetching URL directly: ${url}`);

            const response = await makeOllamaRequest(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: `HTTP ${response.status}: Failed to fetch ${url}`
                };
            }

            const html = await response.text();

            // Simple HTML-to-text conversion (basic)
            const textContent = html
                .replace(/<script[^>]*>.*?<\/script>/gis, '')
                .replace(/<style[^>]*>.*?<\/style>/gis, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 10000); // Limit to 10K chars

            console.log(`✅ Fetched ${textContent.length} chars from ${url}`);

            // Defense Layer 3: Unicode Filter - sanitize for prompt injection prevention
            console.log('🛡️ Applying Unicode filter to fetched content...');
            const sanitizedResult = applyFilterToWebResults({
                success: true,
                content: textContent,
                url: url
            });

            return sanitizedResult;

        } else {
            return {
                success: false,
                error: `Unknown web tool: ${toolName}`
            };
        }

    } catch (error) {
        console.error(`❌ Searx Tool Execution Error:`, error);

        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            return {
                success: false,
                error: `Failed to connect to Searx server at ${searxBaseUrl}. Check if the URL is correct and the server is running.\n\nError: ${error.message}`
            };
        }

        return {
            success: false,
            error: error.message
        };
    }
}

// Show permission dialog and get user choice
function showPermissionDialog(toolCall, args) {
    return new Promise((resolve) => {
        const modal = document.getElementById('permission-modal');
        const commandDisplay = document.getElementById('perm-command');
        const modelName = getCurrentModel().split(':')[0]; // "gpt-oss" from "gpt-oss:20b"

        // Display command
        let commandText = '';
        if (args.command) {
            commandText = `${toolCall.function.name}: ${args.command}`;
        } else if (args.file_path) {
            commandText = `${toolCall.function.name}: ${args.file_path}`;
        } else if (args.pattern) {
            commandText = `${toolCall.function.name}: ${args.pattern}`;
        } else {
            commandText = toolCall.function.name;
        }

        commandDisplay.textContent = commandText;

        // Get buttons
        const btnOnce = document.getElementById('allow-once');
        const btnAlways = document.getElementById('allow-always');
        const btnDeny = document.getElementById('deny-btn');

        // Update deny button text with model name
        btnDeny.textContent = `💬 No, tell ${modelName} what to do`;

        // Remove old event listeners by cloning
        const newBtnOnce = btnOnce.cloneNode(true);
        const newBtnAlways = btnAlways.cloneNode(true);
        const newBtnDeny = btnDeny.cloneNode(true);
        btnOnce.replaceWith(newBtnOnce);
        btnAlways.replaceWith(newBtnAlways);
        btnDeny.replaceWith(newBtnDeny);

        // Add event listeners
        newBtnOnce.onclick = () => {
            modal.classList.remove('show');
            resolve('allow-once');
        };

        newBtnAlways.onclick = () => {
            modal.classList.remove('show');
            resolve('allow-always');
        };

        newBtnDeny.onclick = () => {
            modal.classList.remove('show');
            resolve('deny');
        };

        // Show modal
        modal.classList.add('show');
    });
}

// Get current model name from dropdown
function getCurrentModel() {
    const selectElement = document.getElementById('modelSelect');
    return selectElement ? selectElement.value : 'gpt-oss:20b';
}

// Set current model
function setCurrentModel(modelName) {
    currentModel = modelName;
    console.log('📝 Model switched to:', currentModel);
    // Notify UI about new model's tool capability
    notifyModelCapability(modelName);
}

// Initialize permission manager
function initPermissionManager() {
    const modelName = getCurrentModel();
    permissionManager = new PermissionManager(modelName, process.cwd());
    console.log(`🔐 Permission Manager initialized for ${modelName} in ${process.cwd()}`);
}

// Unload model from memory (clears server-side context)
async function unloadModel() {
    try {
        const response = await makeOllamaRequest('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: {
                model: currentModel,
                messages: [],
                keep_alive: 0
            }
        });

        const data = await response.json();
        const success = data.done_reason === 'unload';

        if (success) {
            console.log(`✅ Model ${currentModel} unloaded from memory`);
        } else {
            console.warn(`⚠️ Model unload response: ${data.done_reason}`);
        }

        return success;
    } catch (error) {
        console.error('Failed to unload model:', error);
        return false;
    }
}

// Clear conversation history and unload model
async function clearConversationHistory() {
    conversationHistory = [];  // Create NEW array (prevents reference sharing)
    webSearchCallCount = 0; // Reset WebSearch counter
    previousHistoryTokens = 0; // Reset token tracking to prevent negative deltas
    await unloadModel();
}

// Add message to history
function addToHistory(role, content, toolCalls) {
    conversationHistory.push({
        role,
        content,
        tool_calls: toolCalls
    });
}

// Get streaming status
function getStreamingStatus() {
    return isStreaming;
}

// Set streaming status
function setStreamingStatus(status) {
    isStreaming = status;
}

// Set Ollama endpoint
function setOllamaEndpoint(endpoint) {
    OLLAMA_API_URL = endpoint;
    console.log('🔧 Ollama endpoint updated:', OLLAMA_API_URL);
    // Reinitialize permission manager with new endpoint
    if (permissionManager) {
        initPermissionManager();
    }
}

// Get token encoder for use by other modules
function getTokenEncoder() {
    return tokenEncoder;
}

// Abort current generation
function abortGeneration() {
    if (abortController) {
        console.log('🛑 Aborting current generation...');
        abortController.abort();
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🛡️ AGENT LOOP SAFETY SYSTEM - 5 Layer Protection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Layer 1: Calculate context window usage percentage
 * Returns value between 0 and 1 (e.g., 0.85 = 85% full)
 */
function calculateContextUsage(history) {
    if (!tokenEncoder) return 0;

    try {
        // Estimate conversation size in tokens
        const historyString = JSON.stringify(history);
        const estimatedTokens = tokenEncoder.encode(historyString).length;

        // Get max context for current model
        const maxContext = modelSettings.num_ctx || getModelContextLimit(currentModel);

        const usage = estimatedTokens / maxContext;

        console.log(`📊 Context usage: ${estimatedTokens.toLocaleString()} / ${maxContext.toLocaleString()} tokens (${(usage * 100).toFixed(1)}%)`);

        return usage;
    } catch (error) {
        console.error('❌ Context usage calculation error:', error);
        return 0;
    }
}

/**
 * Layer 2: Count consecutive empty assistant responses (tool calls without text)
 * Returns count of consecutive empty responses at end of history
 */
function countConsecutiveEmptyResponses(history) {
    let count = 0;

    // Walk backwards through history
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];

        // Only count assistant messages
        if (msg.role !== 'assistant') continue;

        // Check if message is empty (tool call without text content)
        const isEmpty = (!msg.content || !msg.content.trim()) && msg.tool_calls && msg.tool_calls.length > 0;

        if (isEmpty) {
            count++;
        } else {
            // Stop counting when we hit a non-empty assistant message
            break;
        }
    }

    if (count > 0) {
        console.log(`⚠️ Consecutive empty responses detected: ${count}`);
    }

    return count;
}

/**
 * Layer 3: Get last N tool calls from history
 * Returns array of tool call objects with name and params
 */
function getLastNToolCalls(history, n) {
    const toolCalls = [];

    // Walk backwards through history to find tool calls
    for (let i = history.length - 1; i >= 0 && toolCalls.length < n; i--) {
        const msg = history[i];

        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            // Extract tool call info
            msg.tool_calls.forEach(tc => {
                if (toolCalls.length < n) {
                    const params = typeof tc.function.arguments === 'string'
                        ? JSON.parse(tc.function.arguments)
                        : tc.function.arguments;

                    toolCalls.push({
                        name: tc.function.name,
                        params: params
                    });
                }
            });
        }
    }

    return toolCalls.reverse(); // Return in chronological order
}

/**
 * Layer 4: Strip thinking content from history for qwen models
 * Prevents thinking content from polluting conversation history
 */
function stripThinkingFromHistory(history) {
    // Only strip for qwen models
    if (!currentModel.toLowerCase().startsWith('qwen')) {
        return history;
    }

    console.log('🧹 Stripping thinking content from history (qwen model detected)');

    return history.map(msg => {
        if (msg.role === 'assistant' && msg.content) {
            // Remove <think> blocks
            let cleaned = msg.content.replace(/<think>.*?<\/think>/gs, '');

            // Remove channel syntax thinking
            cleaned = cleaned.replace(/<\|channel\|>analysis.*?<\|channel\|>final/gs, '');
            cleaned = cleaned.replace(/<\|channel\|>commentary.*?<\|channel\|>final/gs, '');

            return {
                ...msg,
                content: cleaned.trim()
            };
        }
        return msg;
    });
}

/**
 * Layer 5: Count total tool calls in conversation
 * Returns total number of tool calls across all messages
 */
function countTotalToolCalls(history) {
    let count = 0;

    history.forEach(msg => {
        if (msg.role === 'assistant' && msg.tool_calls) {
            count += msg.tool_calls.length;
        }
    });

    if (count > 30) {
        console.log(`📊 Total tool calls in conversation: ${count}`);
    }

    return count;
}

/**
 * Custom Error class for Agent Loop safety triggers
 */
class AgentLoopError extends Error {
    constructor(message, layer) {
        super(message);
        this.name = 'AgentLoopError';
        this.layer = layer;
    }
}

module.exports = {
    OLLAMA_API_URL,
    currentModel,
    get conversationHistory() { return conversationHistory; },  // Getter returns current array
    set conversationHistory(value) { conversationHistory = value; },  // Setter allows assignment
    isStreaming,
    setDOMReferences,
    setModelSettings,
    smartAutoScroll,
    setOllamaEndpoint,
    checkOllamaConnection,
    updateStatus,
    loadModels,
    loadEmbeddingModels,
    loadRerankerModels,
    streamResponse,
    handleToolCalls,
    showPermissionDialog,
    getCurrentModel,
    setCurrentModel,
    initPermissionManager,
    clearConversationHistory,
    unloadModel,
    addToHistory,
    getStreamingStatus,
    setStreamingStatus,
    abortGeneration,
    currentContextUsage,
    getContextUsage: () => currentContextUsage,
    modelSettings,
    getTokenEncoder,
    supportsTools,
    getModelContextLimit,
    executeWebTool
};
