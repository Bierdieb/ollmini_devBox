// Settings Manager Module
// Handles application settings (model parameters and UI preferences)

// Default settings
const defaultSettings = {
    // Ollama Settings
    ollamaEndpoint: 'http://localhost:11434',
    // RAG Settings
    ragEnabled: false,
    // RAG Advanced Configuration
    ragConfig: {
        // Embedding Models (1024D)
        textEmbeddingModel: 'snowflake-arctic-embed2:568m',
        codeEmbeddingModel: 'qwen3-embedding:0.6b',
        embeddingMode: 'auto',   // 'auto' | 'manual-text' | 'manual-code'
        dimension: 1024,         // Embedding dimension
        rerankerModel: 'xitao/bge-reranker-v2-m3',

        // Chunking Configuration
        chunkSize: 512,
        chunkOverlap: 50,
        semanticChunking: true,

        // Search Configuration
        retrieveTopK: 20,        // Stage 1: Candidates
        rerankTopN: 3,           // Stage 2: Final results
        useReranking: true,      // Enable/disable re-ranking (ML-based Cross-Encoder)

        // Tool Integration
        toolIntegrationEnabled: true,
        toolDefaultLimit: 3
    },
    // WebSearch Settings
    webSearchProvider: 'disabled', // disabled, ollama, searx
    ollamaApiKey: '', // Ollama API Key for web_search/web_fetch
    searxUrl: '', // Searx/SearxNG instance URL
    // Model Settings
    temperature: 0.7,
    num_ctx: 4096,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    seed: null,
    // UI Settings
    fontSize: 14,
    codeFontSize: 13,
    syntaxTheme: 'atom-one-dark',
    chatWidth: 85,
    inputWidth: 75,
    autoScroll: true,
    chainExpanded: false,
    compactMode: false,
    typewriterEffect: false,
    showThinkingBlocks: true,  // Default: show thinking blocks
    thinkingLevel: 'low'  // Default thinking level: low
};

// Load settings from localStorage
let modelSettings = { ...defaultSettings };
try {
    const saved = localStorage.getItem('ollmini-devbox-settings');
    if (saved) {
        const parsedSettings = JSON.parse(saved);
        // Deep merge: Merge ragConfig property-by-property instead of replacing entire object
        modelSettings = {
            ...defaultSettings,
            ...parsedSettings,
            ragConfig: {
                ...defaultSettings.ragConfig,
                ...(parsedSettings.ragConfig || {})
            }
        };
    }
} catch (e) {
    console.error('Failed to load settings:', e);
}

// Apply loaded settings to UI elements
function applySettingsToUI() {
    document.getElementById('temperature-slider').value = modelSettings.temperature;
    document.getElementById('temperature-value').textContent = modelSettings.temperature.toFixed(2);

    document.getElementById('context-slider').value = modelSettings.num_ctx;
    document.getElementById('context-value').textContent = modelSettings.num_ctx;

    document.getElementById('top-p-slider').value = modelSettings.top_p;
    document.getElementById('top-p-value').textContent = modelSettings.top_p.toFixed(2);

    document.getElementById('top-k-input').value = modelSettings.top_k;
    document.getElementById('top-k-value').textContent = modelSettings.top_k;

    document.getElementById('repeat-penalty-slider').value = modelSettings.repeat_penalty;
    document.getElementById('repeat-penalty-value').textContent = modelSettings.repeat_penalty.toFixed(2);

    if (modelSettings.seed !== null) {
        document.getElementById('seed-input').value = modelSettings.seed;
        document.getElementById('seed-value').textContent = modelSettings.seed;
    } else {
        document.getElementById('seed-input').value = '';
        document.getElementById('seed-value').textContent = 'Random';
    }

    // UI Settings
    document.getElementById('font-size-slider').value = modelSettings.fontSize;
    document.getElementById('font-size-value').textContent = modelSettings.fontSize + 'px';

    document.getElementById('code-font-size-slider').value = modelSettings.codeFontSize;
    document.getElementById('code-font-size-value').textContent = modelSettings.codeFontSize + 'px';

    document.getElementById('syntax-theme-select').value = modelSettings.syntaxTheme;

    document.getElementById('chat-width-slider').value = modelSettings.chatWidth;
    document.getElementById('chat-width-value').textContent = modelSettings.chatWidth + '%';

    document.getElementById('input-width-slider').value = modelSettings.inputWidth;
    document.getElementById('input-width-value').textContent = modelSettings.inputWidth + '%';

    document.getElementById('auto-scroll-toggle').checked = modelSettings.autoScroll;
    document.getElementById('chain-expanded-toggle').checked = modelSettings.chainExpanded;
    document.getElementById('compact-mode-toggle').checked = modelSettings.compactMode;
    document.getElementById('typewriter-toggle').checked = modelSettings.typewriterEffect;
    // Sync checkbox with current UI state (body class is the source of truth)
    document.getElementById('show-thinking-toggle').checked = !document.body.classList.contains('hide-thinking');

    // Ollama Settings
    document.getElementById('ollama-endpoint-input').value = modelSettings.ollamaEndpoint;
    document.getElementById('ollama-endpoint-value').textContent = modelSettings.ollamaEndpoint;

    // RAG Settings
    document.getElementById('rag-enabled-toggle').checked = modelSettings.ragEnabled;

    // Update RAG Status Display in RAG Configuration tab
    const ragStatusLabel = document.getElementById('rag-status-label');
    const ragOllamaEndpointDisplay = document.getElementById('rag-ollama-endpoint-display');

    if (ragStatusLabel) {
        ragStatusLabel.textContent = modelSettings.ragEnabled ? 'RAG System: Enabled' : 'RAG System: Disabled';
    }

    if (ragOllamaEndpointDisplay) {
        ragOllamaEndpointDisplay.textContent = modelSettings.ollamaEndpoint;
    }

    // RAG Configuration Settings (ensure ragConfig exists and fill missing properties)
    if (!modelSettings.ragConfig) {
        modelSettings.ragConfig = {};
    }
    // Fill in missing properties from defaults without overwriting existing values
    modelSettings.ragConfig = {
        ...defaultSettings.ragConfig,
        ...modelSettings.ragConfig
    };

    // Embedding Models (1024D)
    document.getElementById('rag-text-model-select').value = modelSettings.ragConfig.textEmbeddingModel || defaultSettings.ragConfig.textEmbeddingModel;
    document.getElementById('rag-code-model-select').value = modelSettings.ragConfig.codeEmbeddingModel || defaultSettings.ragConfig.codeEmbeddingModel;
    document.getElementById('embedding-mode-select').value = modelSettings.ragConfig.embeddingMode || defaultSettings.ragConfig.embeddingMode;
    document.getElementById('reranker-model-select').value = modelSettings.ragConfig.rerankerModel;

    document.getElementById('chunk-size-slider').value = modelSettings.ragConfig.chunkSize;
    document.getElementById('chunk-size-value').textContent = modelSettings.ragConfig.chunkSize;

    document.getElementById('chunk-overlap-slider').value = modelSettings.ragConfig.chunkOverlap;
    document.getElementById('chunk-overlap-value').textContent = modelSettings.ragConfig.chunkOverlap;

    document.getElementById('semantic-chunking-toggle').checked = modelSettings.ragConfig.semanticChunking;

    document.getElementById('retrieve-topk-slider').value = modelSettings.ragConfig.retrieveTopK;
    document.getElementById('retrieve-topk-value').textContent = modelSettings.ragConfig.retrieveTopK;

    document.getElementById('rerank-topn-slider').value = modelSettings.ragConfig.rerankTopN;
    document.getElementById('rerank-topn-value').textContent = modelSettings.ragConfig.rerankTopN;

    document.getElementById('use-reranking-toggle').checked = modelSettings.ragConfig.useReranking;

    document.getElementById('tool-integration-toggle').checked = modelSettings.ragConfig.toolIntegrationEnabled;

    document.getElementById('tool-default-limit-slider').value = modelSettings.ragConfig.toolDefaultLimit;
    document.getElementById('tool-default-limit-value').textContent = modelSettings.ragConfig.toolDefaultLimit;

    // WebSearch Settings
    document.getElementById('websearch-provider-select').value = modelSettings.webSearchProvider;
    document.getElementById('websearch-provider-value').textContent = modelSettings.webSearchProvider;
    document.getElementById('ollama-apikey-input').value = modelSettings.ollamaApiKey || '';
    document.getElementById('ollama-apikey-value').textContent = modelSettings.ollamaApiKey ? '••••••••' : '(not set)';
    document.getElementById('searx-url-input').value = modelSettings.searxUrl || '';
    document.getElementById('searx-url-value').textContent = modelSettings.searxUrl || '(not set)';
    // Show/hide WebSearch settings groups based on provider selection
    document.getElementById('ollama-apikey-group').style.display = modelSettings.webSearchProvider === 'ollama' ? 'block' : 'none';
    document.getElementById('searx-url-group').style.display = modelSettings.webSearchProvider === 'searx' ? 'block' : 'none';
}

// Apply UI settings to DOM
function applyUISettings() {
    // Font sizes
    document.documentElement.style.setProperty('--message-font-size', modelSettings.fontSize + 'px');
    document.documentElement.style.setProperty('--code-font-size', modelSettings.codeFontSize + 'px');

    // Widths via CSS variables
    document.documentElement.style.setProperty('--chat-width', modelSettings.chatWidth + '%');
    document.documentElement.style.setProperty('--input-width', modelSettings.inputWidth + '%');

    // Compact mode
    if (modelSettings.compactMode) {
        document.body.classList.add('compact-mode');
    } else {
        document.body.classList.remove('compact-mode');
    }

    // Thinking blocks visibility
    if (!modelSettings.showThinkingBlocks) {
        document.body.classList.add('hide-thinking');
    } else {
        document.body.classList.remove('hide-thinking');
    }

    // RAG disabled state
    if (!modelSettings.ragEnabled) {
        document.body.classList.add('rag-disabled');
    } else {
        document.body.classList.remove('rag-disabled');
    }
}

// Save settings
function saveSettings() {
    // Model Settings
    modelSettings.temperature = parseFloat(document.getElementById('temperature-slider').value);
    modelSettings.num_ctx = parseInt(document.getElementById('context-slider').value);
    modelSettings.top_p = parseFloat(document.getElementById('top-p-slider').value);
    modelSettings.top_k = parseInt(document.getElementById('top-k-input').value);
    modelSettings.repeat_penalty = parseFloat(document.getElementById('repeat-penalty-slider').value);

    const seedValue = document.getElementById('seed-input').value;
    modelSettings.seed = seedValue ? parseInt(seedValue) : null;

    // UI Settings
    modelSettings.fontSize = parseInt(document.getElementById('font-size-slider').value);
    modelSettings.codeFontSize = parseInt(document.getElementById('code-font-size-slider').value);
    modelSettings.syntaxTheme = document.getElementById('syntax-theme-select').value;
    modelSettings.chatWidth = parseInt(document.getElementById('chat-width-slider').value);
    modelSettings.inputWidth = parseInt(document.getElementById('input-width-slider').value);
    modelSettings.autoScroll = document.getElementById('auto-scroll-toggle').checked;
    modelSettings.chainExpanded = document.getElementById('chain-expanded-toggle').checked;
    modelSettings.compactMode = document.getElementById('compact-mode-toggle').checked;
    modelSettings.typewriterEffect = document.getElementById('typewriter-toggle').checked;
    modelSettings.showThinkingBlocks = document.getElementById('show-thinking-toggle').checked;

    // Ollama Settings
    const endpointValue = document.getElementById('ollama-endpoint-input').value.trim();
    if (!validateEndpoint(endpointValue)) {
        alert('Ungültiges Endpoint-Format. Bitte verwenden Sie: http(s)://hostname:port');
        return;
    }
    modelSettings.ollamaEndpoint = endpointValue;

    // Update Ollama client endpoint
    const ollamaClient = require('./ollama-client');
    if (typeof ollamaClient.setOllamaEndpoint === 'function') {
        ollamaClient.setOllamaEndpoint(endpointValue);
    }

    // RAG Settings
    const ragWasEnabled = modelSettings.ragEnabled;
    modelSettings.ragEnabled = document.getElementById('rag-enabled-toggle').checked;

    // RAG Configuration Settings (ensure ragConfig exists and fill missing properties)
    if (!modelSettings.ragConfig) {
        modelSettings.ragConfig = {};
    }
    // Fill in missing properties from defaults without overwriting existing values
    modelSettings.ragConfig = {
        ...defaultSettings.ragConfig,
        ...modelSettings.ragConfig
    };

    // Embedding Models (1024D)
    modelSettings.ragConfig.textEmbeddingModel = document.getElementById('rag-text-model-select').value;
    modelSettings.ragConfig.codeEmbeddingModel = document.getElementById('rag-code-model-select').value;
    modelSettings.ragConfig.embeddingMode = document.getElementById('embedding-mode-select').value;
    modelSettings.ragConfig.dimension = 1024;
    modelSettings.ragConfig.rerankerModel = document.getElementById('reranker-model-select').value;
    modelSettings.ragConfig.chunkSize = parseInt(document.getElementById('chunk-size-slider').value);
    modelSettings.ragConfig.chunkOverlap = parseInt(document.getElementById('chunk-overlap-slider').value);
    modelSettings.ragConfig.semanticChunking = document.getElementById('semantic-chunking-toggle').checked;
    modelSettings.ragConfig.retrieveTopK = parseInt(document.getElementById('retrieve-topk-slider').value);
    modelSettings.ragConfig.rerankTopN = parseInt(document.getElementById('rerank-topn-slider').value);
    modelSettings.ragConfig.useReranking = document.getElementById('use-reranking-toggle').checked;
    modelSettings.ragConfig.toolIntegrationEnabled = document.getElementById('tool-integration-toggle').checked;
    modelSettings.ragConfig.toolDefaultLimit = parseInt(document.getElementById('tool-default-limit-slider').value);

    // WebSearch Settings
    modelSettings.webSearchProvider = document.getElementById('websearch-provider-select').value;
    modelSettings.ollamaApiKey = document.getElementById('ollama-apikey-input').value.trim();
    modelSettings.searxUrl = document.getElementById('searx-url-input').value.trim();

    // Validate Searx URL if searx provider is selected
    if (modelSettings.webSearchProvider === 'searx' && modelSettings.searxUrl) {
        if (!validateEndpoint(modelSettings.searxUrl)) {
            alert('Ungültiges Searx-URL-Format. Bitte verwenden Sie: http(s)://hostname:port');
            return;
        }
    }

    // Update RAG Manager via IPC
    if (typeof ipcRenderer !== 'undefined') {
        const { ipcRenderer } = require('electron');
        // RAG always uses main ollamaEndpoint
        ipcRenderer.invoke('rag-set-endpoint', endpointValue);

        // Update RAG configuration (including embedding models)
        ipcRenderer.invoke('rag-set-config', {
            textEmbeddingModel: modelSettings.ragConfig.textEmbeddingModel,
            codeEmbeddingModel: modelSettings.ragConfig.codeEmbeddingModel,
            embeddingMode: modelSettings.ragConfig.embeddingMode,
            dimension: modelSettings.ragConfig.dimension,
            chunkSize: modelSettings.ragConfig.chunkSize,
            chunkOverlap: modelSettings.ragConfig.chunkOverlap,
            semanticChunking: modelSettings.ragConfig.semanticChunking
        });

        // Initialize RAG database when enabled for the first time
        if (modelSettings.ragEnabled && !ragWasEnabled) {
            console.log('🔍 RAG Mode: Enabled - Initializing database...');
            ipcRenderer.invoke('rag-init').then(() => {
                console.log('✅ RAG Database initialized successfully');
            }).catch(error => {
                console.error('❌ Failed to initialize RAG database:', error);
                alert('Failed to initialize RAG database. Check console for details.');
            });
        } else if (!modelSettings.ragEnabled && ragWasEnabled) {
            console.log('🔍 RAG Mode: Disabled');
        }
    }

    localStorage.setItem('ollmini-devbox-settings', JSON.stringify(modelSettings));
    applyUISettings();

    // Update RAG button states based on new settings
    if (typeof window.updateRagButtonStates === 'function') {
        window.updateRagButtonStates();
    }

    // Update context display when num_ctx changes
    if (typeof window.updateContextDisplay === 'function') {
        const ollamaClient = require('./ollama-client');
        const contextUsage = ollamaClient.getContextUsage();
        window.updateContextDisplay({
            ...contextUsage,
            maxTokens: modelSettings.num_ctx
        });
    }

    console.log('✅ Settings saved:', modelSettings);
}

// Reset settings to defaults
function resetSettings() {
    if (confirm('Alle Einstellungen auf Standard zurücksetzen?\n\nDies überschreibt alle aktuellen Einstellungen und lädt die App neu.')) {
        // Reset to defaults
        modelSettings = { ...defaultSettings };
        localStorage.setItem('ollmini-devbox-settings', JSON.stringify(modelSettings));
        console.log('🔄 Settings reset to defaults');

        // Reload page to apply all settings
        location.reload();
    }
}

// Factory Reset Settings (ensures RAG and WebSearch are disabled)
function factoryResetSettings() {
    if (confirm('⚠️ FACTORY RESET - Alle Einstellungen\n\nDies setzt ALLE Einstellungen auf Werkseinstellungen zurück:\n• RAG wird DEAKTIVIERT\n• WebSearch wird DEAKTIVIERT\n• Alle anderen Einstellungen werden zurückgesetzt\n\nDie App wird neu geladen.\n\nFortfahren?')) {
        // Reset to defaults (which have ragEnabled=false and webSearchProvider='disabled')
        modelSettings = {
            ...defaultSettings,
            ragEnabled: false,
            webSearchProvider: 'disabled'
        };
        localStorage.setItem('ollmini-devbox-settings', JSON.stringify(modelSettings));
        console.log('🏭 Factory Reset: Settings reset to defaults (RAG + WebSearch disabled)');

        // Reload page to apply all settings
        location.reload();
    }
}

// Factory Reset Everything (RAG + Chats + Settings)
async function factoryResetEverything() {
    if (confirm('⚠️⚠️⚠️ MASTER RESET - ALLES LÖSCHEN ⚠️⚠️⚠️\n\nDies löscht UNWIDERRUFLICH:\n• ALLE RAG Datenbanken\n• ALLE Chat-Verläufe\n• ALLE Einstellungen (RAG + WebSearch deaktiviert)\n\nDIESE AKTION KANN NICHT RÜCKGÄNGIG GEMACHT WERDEN!\n\nMöchten Sie wirklich ALLES löschen?')) {
        try {
            console.log('🗑️ Master Reset: Starting complete factory reset...');

            // 1. Clear RAG Database
            if (typeof ipcRenderer !== 'undefined') {
                const { ipcRenderer } = require('electron');
                await ipcRenderer.invoke('rag-clear');
                console.log('✅ Master Reset: RAG database cleared');
            }

            // 2. Clear All Chats
            const chatHistoryManager = require('./chat-history-manager');
            if (typeof chatHistoryManager.clearAllChats === 'function') {
                chatHistoryManager.clearAllChats();
                console.log('✅ Master Reset: All chats cleared');
            }

            // 3. Reset Settings to Factory Defaults
            modelSettings = {
                ...defaultSettings,
                ragEnabled: false,
                webSearchProvider: 'disabled'
            };
            localStorage.setItem('ollmini-devbox-settings', JSON.stringify(modelSettings));
            console.log('✅ Master Reset: Settings reset to factory defaults');

            alert('✅ Master Reset erfolgreich!\n\nAlle Daten wurden gelöscht. Die App wird jetzt neu geladen.');

            // Reload page to apply all settings
            location.reload();
        } catch (error) {
            console.error('❌ Master Reset failed:', error);
            alert('❌ Fehler beim Master Reset!\n\n' + error.message + '\n\nBitte prüfen Sie die Konsole für Details.');
        }
    }
}

// Get current settings
function getSettings() {
    return modelSettings;
}

// Validate Ollama endpoint format
function validateEndpoint(endpoint) {
    // Pattern: http(s)://hostname:port
    const pattern = /^https?:\/\/[\w.-]+(:\d+)?$/;
    return pattern.test(endpoint);
}


// Setup event listeners for settings UI
function setupSettingsListeners() {
    const settingsModal = document.getElementById('settings-modal');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsCancelBtn = document.getElementById('settings-cancel');
    const settingsSaveBtn = document.getElementById('settings-save');
    const settingsResetBtn = document.getElementById('settings-reset');

    // Settings Button - Open Modal
    settingsBtn.addEventListener('click', async () => {
        // Reload models from Ollama to get latest list (including newly created models)
        if (loadModelsCallback) {
            await loadModelsCallback();
        }

        // Update context slider maximum for current model
        if (updateContextSliderCallback) {
            updateContextSliderCallback();
        }

        // Load available modelfiles for setup
        await loadModelfiles();

        applySettingsToUI();
        settingsModal.classList.add('show');
    });

    // Settings Cancel
    settingsCancelBtn.addEventListener('click', () => {
        settingsModal.classList.remove('show');
    });

    // Settings Save
    settingsSaveBtn.addEventListener('click', () => {
        saveSettings();
        settingsModal.classList.remove('show');
    });

    // Settings Reset
    settingsResetBtn.addEventListener('click', () => {
        resetSettings();
    });

    // Settings Tab Navigation
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            // Update nav items
            document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update tabs
            document.querySelectorAll('.settings-tab').forEach(tab => tab.classList.remove('active'));
            document.getElementById(`${tabId}-tab`).classList.add('active');
        });
    });

    // Link to Ollama Settings from RAG tab
    const linkToOllamaSettings = document.getElementById('link-to-ollama-settings');
    if (linkToOllamaSettings) {
        linkToOllamaSettings.addEventListener('click', (e) => {
            e.preventDefault();

            // Switch to ollama tab
            document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
            const ollamaNavBtn = document.querySelector('[data-tab="ollama"]');
            if (ollamaNavBtn) {
                ollamaNavBtn.classList.add('active');
            }

            // Update tabs
            document.querySelectorAll('.settings-tab').forEach(tab => tab.classList.remove('active'));
            document.getElementById('ollama-tab').classList.add('active');
        });
    }

    // Live update setting values
    document.getElementById('temperature-slider').addEventListener('input', (e) => {
        document.getElementById('temperature-value').textContent = parseFloat(e.target.value).toFixed(2);
    });

    document.getElementById('context-slider').addEventListener('input', (e) => {
        document.getElementById('context-value').textContent = e.target.value;
    });

    document.getElementById('top-p-slider').addEventListener('input', (e) => {
        document.getElementById('top-p-value').textContent = parseFloat(e.target.value).toFixed(2);
    });

    document.getElementById('top-k-input').addEventListener('input', (e) => {
        document.getElementById('top-k-value').textContent = e.target.value;
    });

    document.getElementById('repeat-penalty-slider').addEventListener('input', (e) => {
        document.getElementById('repeat-penalty-value').textContent = parseFloat(e.target.value).toFixed(2);
    });

    document.getElementById('seed-input').addEventListener('input', (e) => {
        document.getElementById('seed-value').textContent = e.target.value || 'Random';
    });

    // UI Settings live updates
    document.getElementById('font-size-slider').addEventListener('input', (e) => {
        document.getElementById('font-size-value').textContent = e.target.value + 'px';
    });

    document.getElementById('code-font-size-slider').addEventListener('input', (e) => {
        document.getElementById('code-font-size-value').textContent = e.target.value + 'px';
    });

    document.getElementById('chat-width-slider').addEventListener('input', (e) => {
        document.getElementById('chat-width-value').textContent = e.target.value + '%';
        // Apply immediately for live preview
        document.documentElement.style.setProperty('--chat-width', e.target.value + '%');
    });

    document.getElementById('input-width-slider').addEventListener('input', (e) => {
        document.getElementById('input-width-value').textContent = e.target.value + '%';
        // Apply immediately for live preview
        document.documentElement.style.setProperty('--input-width', e.target.value + '%');
    });

    // Ollama Settings live updates
    document.getElementById('ollama-endpoint-input').addEventListener('input', (e) => {
        const endpoint = e.target.value;
        document.getElementById('ollama-endpoint-value').textContent = endpoint;

        // Also update RAG Ollama Endpoint Display in RAG Configuration tab
        const ragOllamaEndpointDisplay = document.getElementById('rag-ollama-endpoint-display');
        if (ragOllamaEndpointDisplay) {
            ragOllamaEndpointDisplay.textContent = endpoint;
        }
    });

    // RAG Settings Event Listeners
    document.getElementById('rag-enabled-toggle').addEventListener('change', async (e) => {
        const isEnabled = e.target.checked;

        // If enabling RAG, validate model compatibility first
        if (isEnabled && typeof ipcRenderer !== 'undefined') {
            const { ipcRenderer } = require('electron');
            const currentTextModel = document.getElementById('rag-text-model-select').value;
            const currentCodeModel = document.getElementById('rag-code-model-select').value;

            try {
                const validation = await ipcRenderer.invoke('rag-validate-models', currentTextModel, currentCodeModel);

                if (validation.hasDatabaseContent && !validation.compatible) {
                    console.warn('[RAG Validation] ⚠️ Cannot enable RAG - model mismatch with database');
                    showRagEnableWarning(validation);
                    return; // Prevent RAG from enabling
                } else if (validation.hasDatabaseContent) {
                    console.log('[RAG Validation] ✅ Models compatible with database - enabling RAG');
                } else {
                    console.log('[RAG Validation] ✅ No database content - enabling RAG (first time setup)');
                }
            } catch (error) {
                console.error('[RAG Validation] ❌ Validation failed on RAG toggle:', error);
                // On validation error, prevent enabling RAG
                document.getElementById('rag-enabled-toggle').checked = false;
                alert('❌ Failed to validate RAG models!\n\n' + error.message);
                return;
            }
        }

        // Update body CSS class for RAG disabled state
        if (isEnabled) {
            document.body.classList.remove('rag-disabled');
        } else {
            document.body.classList.add('rag-disabled');
        }

        // Update RAG Status Label in RAG Configuration tab
        const ragStatusLabel = document.getElementById('rag-status-label');
        if (ragStatusLabel) {
            ragStatusLabel.textContent = isEnabled ? 'RAG System: Enabled' : 'RAG System: Disabled';
        }
    });

    // WebSearch Settings Event Listeners
    document.getElementById('websearch-provider-select').addEventListener('change', (e) => {
        const provider = e.target.value;
        document.getElementById('websearch-provider-value').textContent = provider;

        // Show/hide provider-specific settings
        const ollamaKeyGroup = document.getElementById('ollama-apikey-group');
        const searxUrlGroup = document.getElementById('searx-url-group');

        ollamaKeyGroup.style.display = provider === 'ollama' ? 'block' : 'none';
        searxUrlGroup.style.display = provider === 'searx' ? 'block' : 'none';

        // Update body CSS class for WebSearch disabled state
        if (provider === 'disabled') {
            document.body.classList.add('websearch-disabled');
        } else {
            document.body.classList.remove('websearch-disabled');
        }
    });

    document.getElementById('ollama-apikey-input').addEventListener('input', (e) => {
        const value = e.target.value.trim();
        document.getElementById('ollama-apikey-value').textContent = value ? '••••••••' : '(not set)';
    });

    document.getElementById('searx-url-input').addEventListener('input', (e) => {
        const value = e.target.value.trim();
        document.getElementById('searx-url-value').textContent = value || '(not set)';
    });

    // RAG Configuration Settings Event Listeners

    // Text Embedding Model Validation (Change Detection)
    document.getElementById('rag-text-model-select').addEventListener('change', async (e) => {
        const newTextModel = e.target.value;
        const currentCodeModel = document.getElementById('rag-code-model-select').value;

        console.log(`[RAG Validation] Text model changed to: ${newTextModel}`);

        // Validate compatibility with existing database
        if (typeof ipcRenderer !== 'undefined') {
            const { ipcRenderer } = require('electron');
            try {
                const validation = await ipcRenderer.invoke('rag-validate-models', newTextModel, currentCodeModel);

                if (validation.hasDatabaseContent && !validation.compatible) {
                    console.warn('[RAG Validation] ⚠️ Text model incompatible with database');
                    showModelMismatchWarning(validation, 'text');
                } else if (validation.hasDatabaseContent) {
                    console.log('[RAG Validation] ✅ Text model compatible with database');
                } else {
                    console.log('[RAG Validation] ✅ No database content - text model compatible (first time setup)');
                }
            } catch (error) {
                console.error('[RAG Validation] ❌ Validation failed for text model:', error);
            }
        }
    });

    // Code Embedding Model Validation (Change Detection)
    document.getElementById('rag-code-model-select').addEventListener('change', async (e) => {
        const newCodeModel = e.target.value;
        const currentTextModel = document.getElementById('rag-text-model-select').value;

        console.log(`[RAG Validation] Code model changed to: ${newCodeModel}`);

        // Validate compatibility with existing database
        if (typeof ipcRenderer !== 'undefined') {
            const { ipcRenderer } = require('electron');
            try {
                const validation = await ipcRenderer.invoke('rag-validate-models', currentTextModel, newCodeModel);

                if (validation.hasDatabaseContent && !validation.compatible) {
                    console.warn('[RAG Validation] ⚠️ Code model incompatible with database');
                    showModelMismatchWarning(validation, 'code');
                } else if (validation.hasDatabaseContent) {
                    console.log('[RAG Validation] ✅ Code model compatible with database');
                } else {
                    console.log('[RAG Validation] ✅ No database content - code model compatible (first time setup)');
                }
            } catch (error) {
                console.error('[RAG Validation] ❌ Validation failed for code model:', error);
            }
        }
    });

    document.getElementById('chunk-size-slider').addEventListener('input', (e) => {
        document.getElementById('chunk-size-value').textContent = e.target.value;
    });

    document.getElementById('chunk-overlap-slider').addEventListener('input', (e) => {
        document.getElementById('chunk-overlap-value').textContent = e.target.value;
    });

    document.getElementById('retrieve-topk-slider').addEventListener('input', (e) => {
        document.getElementById('retrieve-topk-value').textContent = e.target.value;
    });

    document.getElementById('rerank-topn-slider').addEventListener('input', (e) => {
        document.getElementById('rerank-topn-value').textContent = e.target.value;
    });

    document.getElementById('tool-default-limit-slider').addEventListener('input', (e) => {
        document.getElementById('tool-default-limit-value').textContent = e.target.value;
    });

    // Close settings on background click
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('show');
        }
    });

    // ===================================================================
    // FACTORY RESET BUTTONS (Advanced Tab)
    // ===================================================================

    // Factory Reset RAG Databases
    const factoryResetRagBtn = document.getElementById('factory-reset-rag-btn');
    if (factoryResetRagBtn) {
        factoryResetRagBtn.addEventListener('click', async () => {
            if (confirm('⚠️ RESET ALL RAG DATABASES\n\nDies löscht ALLE indizierten Dokumente und RAG-Datenbanken.\n\nDIESE AKTION KANN NICHT RÜCKGÄNGIG GEMACHT WERDEN!\n\nFortfahren?')) {
                try {
                    if (typeof ipcRenderer !== 'undefined') {
                        const { ipcRenderer } = require('electron');
                        await ipcRenderer.invoke('rag-clear');
                        console.log('✅ Factory Reset: RAG database cleared');
                        alert('✅ RAG Datenbank erfolgreich gelöscht!');
                    }
                } catch (error) {
                    console.error('❌ Factory Reset RAG failed:', error);
                    alert('❌ Fehler beim Löschen der RAG-Datenbank!\n\n' + error.message);
                }
            }
        });
    }

    // Factory Reset All Chats
    const factoryResetChatsBtn = document.getElementById('factory-reset-chats-btn');
    if (factoryResetChatsBtn) {
        factoryResetChatsBtn.addEventListener('click', () => {
            if (confirm('⚠️ RESET ALL CHATS\n\nDies löscht ALLE gespeicherten Chat-Verläufe.\n\nDIESE AKTION KANN NICHT RÜCKGÄNGIG GEMACHT WERDEN!\n\nFortfahren?')) {
                try {
                    const chatHistoryManager = require('./chat-history-manager');
                    if (typeof chatHistoryManager.clearAllChats === 'function') {
                        chatHistoryManager.clearAllChats();
                        console.log('✅ Factory Reset: All chats cleared');
                        alert('✅ Alle Chats erfolgreich gelöscht!');
                    }
                } catch (error) {
                    console.error('❌ Factory Reset Chats failed:', error);
                    alert('❌ Fehler beim Löschen der Chats!\n\n' + error.message);
                }
            }
        });
    }

    // Factory Reset Settings
    const factoryResetSettingsBtn = document.getElementById('factory-reset-settings-btn');
    if (factoryResetSettingsBtn) {
        factoryResetSettingsBtn.addEventListener('click', () => {
            factoryResetSettings();
        });
    }

    // Factory Reset EVERYTHING (Master Reset)
    const factoryResetEverythingBtn = document.getElementById('factory-reset-everything-btn');
    if (factoryResetEverythingBtn) {
        factoryResetEverythingBtn.addEventListener('click', async () => {
            await factoryResetEverything();
        });
    }

    // ===================================================================
    // MODEL SETUP EVENT LISTENERS
    // ===================================================================

    // Apply Models Button
    const applyModelsBtn = document.getElementById('apply-models-btn');
    if (applyModelsBtn) {
        applyModelsBtn.addEventListener('click', async () => {
            await applySelectedModels();
        });
    }

    // Checkbox change event (delegated to container for dynamic elements)
    const modelfileList = document.getElementById('modelfile-list');
    if (modelfileList) {
        modelfileList.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') {
                updateModelSetupStatus();
            }
        });
    }
}

// Reference to loadModels callback (injected from renderer.js)
let loadModelsCallback = null;
let updateContextSliderCallback = null;

function setLoadModelsCallback(callback) {
    loadModelsCallback = callback;
}

function setUpdateContextSliderCallback(callback) {
    updateContextSliderCallback = callback;
}

// ===================================================================
// RAG MODEL VALIDATION FUNCTIONS
// ===================================================================

/**
 * Show warning dialog when user tries to change embedding model with incompatible database
 * @param {object} validation - Validation result from validateEmbeddingModelCompatibility
 * @param {string} modelType - 'text' or 'code' - which model is being changed
 */
function showModelMismatchWarning(validation, modelType) {
    const modelDimension = modelType === 'text' ? validation.newTextModelDimension : validation.newCodeModelDimension;
    const newModelName = modelType === 'text' ? validation.newTextModel : validation.newCodeModel;
    const currentModelName = modelType === 'text' ? validation.currentTextModel : validation.currentCodeModel;

    const message =
        `⚠️ EMBEDDING MODEL MISMATCH\n\n` +
        `Your database contains ${validation.databaseChunks} indexed chunks.\n\n` +
        `Database vectors: ${validation.currentDimension}D\n` +
        `New model "${newModelName}": ${modelDimension}D\n\n` +
        `Changing to an incompatible model will break RAG.\n\n` +
        `Click OK to clear database and apply new model.\n` +
        `Click Cancel to keep current model: "${currentModelName}"`;

    if (confirm(message)) {
        // User confirmed: Clear database and apply new model
        console.log(`[RAG Validation] User confirmed: Clearing database and applying ${modelType} model`);

        // Clear database via IPC
        if (typeof ipcRenderer !== 'undefined') {
            const { ipcRenderer } = require('electron');
            ipcRenderer.invoke('rag-clear').then(() => {
                console.log('✅ Database cleared, new embedding model can be used');
                alert(`✅ Database cleared!\n\nYou can now use the new ${modelType} embedding model.\nPlease re-index your documents from the Working Directory menu.`);
            }).catch(error => {
                console.error('❌ Failed to clear database:', error);
                alert('❌ Failed to clear database!\n\n' + error.message);
                // Revert dropdown on failure
                revertEmbeddingModelDropdown(modelType, currentModelName);
            });
        }
    } else {
        // User cancelled: Revert dropdown to current model
        console.log(`[RAG Validation] User cancelled: Reverting ${modelType} model dropdown`);
        revertEmbeddingModelDropdown(modelType, currentModelName);
    }
}

/**
 * Show warning when user tries to enable RAG with incompatible models
 * @param {object} validation - Validation result from validateEmbeddingModelCompatibility
 */
function showRagEnableWarning(validation) {
    const textCompatible = validation.newTextModelDimension === validation.currentDimension;
    const codeCompatible = validation.newCodeModelDimension === validation.currentDimension;

    let incompatibleModel = '';
    if (!textCompatible) {
        incompatibleModel = `Text model "${validation.newTextModel}": ${validation.newTextModelDimension}D`;
    } else if (!codeCompatible) {
        incompatibleModel = `Code model "${validation.newCodeModel}": ${validation.newCodeModelDimension}D`;
    }

    const message =
        `⚠️ CANNOT ENABLE RAG - MODEL MISMATCH\n\n` +
        `Your database contains ${validation.databaseChunks} chunks with ${validation.currentDimension}D vectors.\n\n` +
        `Incompatible model:\n${incompatibleModel}\n\n` +
        `Database models:\n` +
        `• Text: "${validation.currentTextModel}" (${validation.currentDimension}D)\n` +
        `• Code: "${validation.currentCodeModel}" (${validation.currentDimension}D)\n\n` +
        `Please either:\n` +
        `1. Clear database (Working Directory → Clear Database), OR\n` +
        `2. Revert to compatible embedding models`;

    alert(message);

    // Uncheck RAG toggle
    document.getElementById('rag-enabled-toggle').checked = false;
    document.body.classList.add('rag-disabled');

    // Update status label
    const ragStatusLabel = document.getElementById('rag-status-label');
    if (ragStatusLabel) {
        ragStatusLabel.textContent = 'RAG System: Disabled';
    }
}

/**
 * Revert embedding model dropdown to previous value
 * @param {string} modelType - 'text' or 'code'
 * @param {string} previousModel - Model name to revert to
 */
function revertEmbeddingModelDropdown(modelType, previousModel) {
    const dropdown = modelType === 'text'
        ? document.getElementById('rag-text-model-select')
        : document.getElementById('rag-code-model-select');

    if (dropdown) {
        dropdown.value = previousModel;
    }
}

// ========================================
// Model Setup Functions
// ========================================

/**
 * Load available modelfiles from Models/ directory
 */
async function loadModelfiles() {
    const { ipcRenderer } = require('electron');

    try {
        const modelfiles = await ipcRenderer.invoke('model-scan-modelfiles');
        renderModelfileList(modelfiles);
    } catch (error) {
        console.error('Failed to load modelfiles:', error);
        const container = document.getElementById('modelfile-list');
        if (container) {
            container.innerHTML = '<div class="modelfile-loading" style="color: #e06c75;">Error loading modelfiles</div>';
        }
    }
}

/**
 * Render modelfile checkboxes in the UI
 * @param {Array} modelfiles - Array of modelfile objects
 */
function renderModelfileList(modelfiles) {
    const container = document.getElementById('modelfile-list');
    if (!container) return;

    container.innerHTML = '';

    if (modelfiles.length === 0) {
        container.innerHTML = '<div class="modelfile-loading">No modelfiles found in Models/ directory</div>';
        return;
    }

    modelfiles.forEach(mf => {
        const item = document.createElement('div');
        item.className = 'modelfile-item';
        item.innerHTML = `
            <input type="checkbox" id="model-${mf.name}" data-modelfile="${mf.name}">
            <label for="model-${mf.name}">
                <strong>${mf.name}</strong> → <code>${mf.targetName}</code>
                <br><span style="font-size:11px;opacity:0.7;">Base: ${mf.baseName}</span>
            </label>
        `;
        container.appendChild(item);
    });

    updateModelSetupStatus();
}

/**
 * Apply selected models to Ollama
 */
async function applySelectedModels() {
    const { ipcRenderer } = require('electron');

    const checkboxes = document.querySelectorAll('.modelfile-item input:checked');
    const selected = Array.from(checkboxes).map(cb => cb.dataset.modelfile);

    if (selected.length === 0) {
        alert('Please select at least one model to install');
        return;
    }

    const btn = document.getElementById('apply-models-btn');
    const statusEl = document.getElementById('model-setup-status');

    if (!btn || !statusEl) return;

    btn.disabled = true;
    btn.textContent = 'Installing...';
    statusEl.textContent = 'Installing models...';
    statusEl.className = 'model-setup-status';

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const modelName of selected) {
        try {
            statusEl.textContent = `Processing ${modelName}...`;

            // Check if model exists
            const exists = await ipcRenderer.invoke('model-check-exists', modelName);

            if (exists) {
                const overwrite = confirm(`Model ${modelName}_ollmini already exists. Overwrite?`);
                if (!overwrite) {
                    console.log(`Skipped ${modelName} (user choice)`);
                    continue;
                }
            }

            // Apply modelfile
            const result = await ipcRenderer.invoke('model-apply-modelfile', modelName);

            if (result.success) {
                console.log(`✅ ${result.targetName} created successfully`);
                successCount++;
            } else {
                console.error(`❌ Failed to create ${modelName}:`, result.error);
                errors.push(`${modelName}: ${result.error}`);
                errorCount++;
            }

        } catch (error) {
            console.error(`Error applying ${modelName}:`, error);
            errors.push(`${modelName}: ${error.message}`);
            errorCount++;
        }
    }

    // Final summary
    btn.disabled = false;
    btn.textContent = 'Apply Selected Models';

    if (errorCount === 0) {
        statusEl.textContent = `✅ Success: ${successCount} model(s) installed`;
        statusEl.className = 'model-setup-status success';
        alert(`Successfully installed ${successCount} model(s)!\n\nYou can now select them from the model dropdown.`);

        // Reload models in dropdown
        if (loadModelsCallback) {
            loadModelsCallback();
        }
    } else {
        statusEl.textContent = `⚠️ Completed: ${successCount} success, ${errorCount} errors`;
        statusEl.className = 'model-setup-status error';
        alert(`Installation completed with errors:\n\nSuccess: ${successCount}\nErrors: ${errorCount}\n\nCheck console for details:\n${errors.join('\n')}`);
    }

    // Uncheck all checkboxes
    checkboxes.forEach(cb => cb.checked = false);
    updateModelSetupStatus();
}

/**
 * Update status text based on selected checkboxes
 */
function updateModelSetupStatus() {
    const checkboxes = document.querySelectorAll('.modelfile-item input');
    const checked = document.querySelectorAll('.modelfile-item input:checked').length;
    const status = document.getElementById('model-setup-status');
    const btn = document.getElementById('apply-models-btn');

    if (!status || !btn) return;

    if (checked === 0) {
        status.textContent = 'Select models to install';
        status.className = 'model-setup-status';
        btn.disabled = true;
    } else {
        status.textContent = `Ready to install ${checked} model(s)`;
        status.className = 'model-setup-status success';
        btn.disabled = false;
    }
}

module.exports = {
    defaultSettings,
    modelSettings,
    applySettingsToUI,
    applyUISettings,
    saveSettings,
    resetSettings,
    factoryResetSettings,
    factoryResetEverything,
    getSettings,
    setupSettingsListeners,
    setLoadModelsCallback,
    setUpdateContextSliderCallback
};
