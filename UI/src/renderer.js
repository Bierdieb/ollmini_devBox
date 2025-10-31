// Main Renderer Entry Point
// Orchestrates all modules and handles event coordination

const { ipcRenderer, shell } = require('electron');

// Import all modules
const { marked, copyCodeToClipboard } = require('./markdown-renderer');
const ollamaClient = require('./ollama-client');
const messageRenderer = require('./message-renderer');
const settingsManager = require('./settings-manager');
const fileBrowser = require('./file-browser');
const pinManager = require('./pin-manager');
const chatHistoryManager = require('./chat-history-manager');
const { renderWebToolResult } = require('./web-result-renderer');

// Import system tools for code mode
const { SYSTEM_TOOLS } = require('./system-tools');

// Make renderWebToolResult globally available for ollama-client.js
window.renderWebToolResult = renderWebToolResult;

// DOM Elements
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');
const dashboardBtn = document.getElementById('dashboardBtn');
const settingsBtn = document.getElementById('settingsBtn');
const modelSelect = document.getElementById('modelSelect');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const activityText = document.getElementById('activityText');
const inputContainer = document.getElementById('inputContainer');
const codeModeToggle = document.getElementById('codeModeToggle');
const mainContent = document.querySelector('.main-content');

// Chat History DOM elements
const sidebarToggle = document.getElementById('sidebarToggle');
const newChatBtn = document.getElementById('newChatBtn');
const chatHistoryList = document.getElementById('chatHistoryList');

// File Browser DOM elements
const cwdDisplay = document.getElementById('cwd-display');
const browseDirectoryBtn = document.getElementById('browse-directory-btn');
const copyCwdBtn = document.getElementById('copy-cwd-btn');
const setWorkingDirBtn = document.getElementById('set-working-dir-btn');
const setCurrentDirBtn = document.getElementById('set-current-dir-btn');
const setWorkingDirText = document.getElementById('set-working-dir-text');
const setCurrentDirText = document.getElementById('set-current-dir-text');
const refreshExplorerBtn = document.getElementById('refresh-explorer-btn');
const folderContent = document.getElementById('folder-content');
const breadcrumb = document.getElementById('breadcrumb');
const contextBarFill = document.getElementById('contextBarFill');
const contextText = document.getElementById('contextText');

// RAG DOM elements
const indexFilesBtn = document.getElementById('index-files-btn');
const clearDbBtn = document.getElementById('clear-db-btn');
const ragStatus = document.getElementById('rag-status');

// Global State
let codeModeEnabled = true; // Default: SYSTEM_TOOLS enabled
let webSearchModeEnabled = false; // Default: WebSearch disabled

// Thinking Level State
let currentThinkingLevel = 'low'; // Default: low
const thinkingLevels = ['low', 'medium', 'high'];

// Token Counter State
let totalInputTokens = 0;
let totalOutputTokens = 0;

// RAG Query Tracking State
let ragQueryHistory = [];
let ragTotalQueries = 0;
let ragTotalQueryTime = 0;
let ragTotalRelevanceScore = 0;

// RAG Indexing Timer State
let indexingStartTime = null;
let indexingFileCompletionTimes = []; // Track time per file for ETA calculation

// Pinned Panel DOM elements
const pinnedSidebar = document.getElementById('pinnedSidebar');
const pinnedSidebarToggle = document.getElementById('pinnedSidebarToggle');
const pinnedContent = document.getElementById('pinnedContent');
const pinnedCount = document.getElementById('pinnedCount');
const pinnedMax = document.getElementById('pinnedMax');
const pinnedTokens = document.getElementById('pinnedTokens');
// Pin indicator in header
const pinIndicator = document.getElementById('pinIndicator');
const headerPinnedCount = document.getElementById('headerPinnedCount');
const headerPinnedTokens = document.getElementById('headerPinnedTokens');

// Inject DOM references into modules
ollamaClient.setDOMReferences({
    statusDot,
    statusText,
    activityText,
    sendBtn,
    modelSelect,
    chatContainer
});

messageRenderer.setDOMReferences({
    chatContainer,
    inputContainer
});

fileBrowser.setDOMReferences({
    cwdDisplay,
    browseDirectoryBtn,
    copyCwdBtn,
    setWorkingDirBtn,
    setCurrentDirBtn,
    setWorkingDirText,
    setCurrentDirText,
    refreshExplorerBtn,
    folderContent,
    breadcrumb
});

chatHistoryManager.setDOMReferences({
    sidebarToggle,
    newChatBtn,
    chatHistoryList,
    chatContainer,
    inputContainer
});

// Share settings with modules
ollamaClient.setModelSettings(settingsManager.modelSettings);
messageRenderer.setModelSettings(settingsManager.modelSettings);
pinManager.setModelSettings(settingsManager.modelSettings);
chatHistoryManager.setModelSettings(settingsManager.modelSettings);

// Inject smartAutoScroll callback into message renderer (for thinking blocks and tool boxes)
messageRenderer.setScrollCallback(ollamaClient.smartAutoScroll);

// Inject module dependencies into chat-history-manager
chatHistoryManager.setModuleDependencies({
    ollamaClient,
    messageRenderer,
    pinManager
});

// Auto-resize textarea
function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
}

// Send Message
async function sendMessage() {
    console.log('🔍 DEBUG [sendMessage]: ENTRY');
    const message = messageInput.value.trim();
    console.log('🔍 DEBUG [sendMessage]: message =', message?.substring(0, 50));

    const isStreaming = ollamaClient.getStreamingStatus();
    console.log('🔍 DEBUG [sendMessage]: isStreaming =', isStreaming);

    if (!message || isStreaming) {
        console.log('🔍 DEBUG [sendMessage]: BLOCKED (no message or already streaming)');
        return;
    }

    console.log('🔍 DEBUG [sendMessage]: PROCEEDING');

    // Remove welcome message if exists
    const welcomeMsg = chatContainer.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }

    // Prepare user message content
    let userContent = message;

    // Add user message
    const userMsgElement = messageRenderer.addMessage('user', message);

    // Add pin buttons to user message (after rendering is complete)
    const userMessageDiv = userMsgElement.closest('.message');
    const userMessageId = userMsgElement._messageId;
    if (userMessageDiv && userMessageId) {
        const settings = settingsManager.getSettings();
        messageRenderer.addPinButtons(userMessageDiv, userMessageId, 'user', settings.ragEnabled);
    }

    // Add to history
    console.log('🔍 DEBUG [sendMessage]: Adding to history');
    ollamaClient.addToHistory('user', userContent);

    // Clear input
    messageInput.value = '';
    autoResizeTextarea();

    // Set streaming status (button stays enabled for Stop functionality)
    console.log('🔍 DEBUG [sendMessage]: Before setStreamingStatus(true)');
    ollamaClient.setStreamingStatus(true);
    console.log('🔍 DEBUG [sendMessage]: After setStreamingStatus(true)');

    // Create assistant message element
    console.log('🔍 DEBUG [sendMessage]: Creating assistant message element');
    const assistantMsgElement = messageRenderer.addMessage('assistant', '', true);

    console.log('🔍 DEBUG [sendMessage]: Before streamResponse call');
    try {
        await ollamaClient.streamResponse(
            assistantMsgElement,
            codeModeEnabled,
            webSearchModeEnabled,
            messageRenderer.parseThinkBlocks,
            messageRenderer.renderMessageParts,
            messageRenderer.createToolExecutionBox,
            currentThinkingLevel
        );

        // Add pin buttons to assistant message (after streaming is complete)
        const assistantMessageDiv = assistantMsgElement._messageDiv;  // Use stored reference instead of .closest()
        const assistantMessageId = assistantMsgElement._messageId;
        const assistantRole = assistantMsgElement._messageRole;
        if (assistantMessageDiv && assistantMessageId && assistantRole) {
            const settings = settingsManager.getSettings();
            messageRenderer.addPinButtons(assistantMessageDiv, assistantMessageId, assistantRole, settings.ragEnabled);
        }

        // Save current chat after successful message exchange
        chatHistoryManager.saveCurrentChat();
    } catch (error) {
        console.error('Error in sendMessage():', error);

        // Provide context-specific error message
        const lastMessage = ollamaClient.conversationHistory[ollamaClient.conversationHistory.length - 1];
        const isAfterToolUse = lastMessage && lastMessage.role === 'tool';

        if (isAfterToolUse) {
            assistantMsgElement.textContent = 'Error: Unable to get follow-up response after tool execution.\n\n' +
                'The tool executed successfully and results are visible above. However, the model failed to provide commentary on the results.';
        } else {
            assistantMsgElement.textContent = 'Error: Unable to get response from Ollama';
        }

        assistantMsgElement.classList.remove('streaming');
        messageRenderer.showError('Failed to communicate with Ollama. Make sure it is running.');
    } finally {
        ollamaClient.setStreamingStatus(false);
    }
}

// Clear Chat - Replaced by Chat History Manager's startNewChat()
async function clearChat() {
    // Delegate to chat history manager which handles all state cleanup
    chatHistoryManager.startNewChat();

    // Clear all pinned messages
    pinManager.clearAllPins();

    // Reset token counters
    totalInputTokens = 0;
    totalOutputTokens = 0;

    // Reset context display
    updateContextDisplay({
        totalTokens: 0,
        maxTokens: ollamaClient.modelSettings.num_ctx || 4096
    });

    // Hide token counter
    document.getElementById('tokenCounter').style.display = 'none';

    // Reset RAG query statistics
    resetRagQueryStats();

    // Clear all context pins
    pinManager.clearAllPins();
    updatePinnedPanel();
}

// Update Context Display
function updateContextDisplay(contextData) {
    const { totalTokens, maxTokens } = contextData;
    const percentage = Math.min((totalTokens / maxTokens) * 100, 100);
    const tokensRemaining = Math.max(maxTokens - totalTokens, 0);

    // Update Progress Bar
    contextBarFill.style.width = `${percentage}%`;

    // Update Color
    contextBarFill.classList.remove('warning', 'critical');
    if (percentage >= 85) {
        contextBarFill.classList.add('critical');
    } else if (percentage >= 60) {
        contextBarFill.classList.add('warning');
    }

    // Update Text
    const percentFormatted = percentage.toFixed(1);
    contextText.textContent = `Context: ${totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()} (${percentFormatted}%)`;
    contextText.title = `${tokensRemaining.toLocaleString()} tokens remaining`;
}

// Make function globally available for ollama-client.js
window.updateContextDisplay = updateContextDisplay;

// Update Context Slider Maximum for Model
function updateContextSliderForModel(modelName) {
    // Get model's context limit
    const contextLimit = ollamaClient.getModelContextLimit(modelName);

    // Warn if current num_ctx exceeds model limit (but don't auto-adjust)
    const currentNumCtx = settingsManager.modelSettings.num_ctx;
    if (currentNumCtx > contextLimit) {
        console.warn(`⚠️ Current context setting (${currentNumCtx.toLocaleString()}) exceeds model limit (${contextLimit.toLocaleString()}). Please adjust in Settings.`);
    }

    // Update context slider in settings if settings modal is open
    const contextSlider = document.getElementById('context-slider');
    const contextValue = document.getElementById('context-value');

    if (contextSlider && contextValue) {
        contextSlider.max = contextLimit;

        // If current value exceeds new max, adjust slider UI only (don't overwrite setting)
        if (parseInt(contextSlider.value) > contextLimit) {
            contextSlider.value = contextLimit;
            contextValue.textContent = contextLimit.toLocaleString();
        }

        console.log(`📏 Context slider maximum updated to ${contextLimit.toLocaleString()} tokens for model "${modelName}"`);
    }

    // Update context display with new limit
    updateContextDisplay({
        totalTokens: 0,
        maxTokens: contextLimit
    });
}

// Populate RAG Model Dropdowns (Reranker only - embedding models are now hardcoded for dual-embedding)
async function populateRagModelDropdowns() {
    try {
        // Get reranker dropdown element
        const rerankerSelect = document.getElementById('reranker-model-select');

        // Load reranker models from Ollama
        const rerankerModels = await ollamaClient.loadRerankerModels();

        // Populate reranker dropdown
        if (rerankerModels.length > 0) {
            rerankerSelect.innerHTML = '<option value="">None (Disabled)</option>'; // Keep "None" option
            rerankerModels.forEach(modelName => {
                const option = document.createElement('option');
                option.value = modelName;
                option.textContent = modelName;
                rerankerSelect.appendChild(option);
            });

            // Set saved value if exists
            const savedReranker = settingsManager.modelSettings.ragConfig?.rerankerModel;
            if (savedReranker) {
                // Exact match first
                if (rerankerModels.includes(savedReranker)) {
                    rerankerSelect.value = savedReranker;
                } else {
                    // Tag-agnostic fallback: match by base name
                    const baseNameMatch = rerankerModels.find(model => {
                        const baseName = model.split(':')[0];
                        const savedBaseName = savedReranker.split(':')[0];
                        return baseName === savedBaseName;
                    });

                    if (baseNameMatch) {
                        console.log(`✅ Tag-agnostic match found: "${savedReranker}" → "${baseNameMatch}"`);
                        rerankerSelect.value = baseNameMatch;
                    } else {
                        console.log('⚠️ Saved reranker model not found:', savedReranker);
                        rerankerSelect.value = ''; // Reset to "None"
                    }
                }
            }
        } else {
            rerankerSelect.innerHTML = '<option value="">None (Disabled)</option>';
            console.log('ℹ️ No reranker models found (optional feature)');
        }

        console.log('✅ RAG reranker dropdown populated (embedding models are now hardcoded for dual-embedding system)');
    } catch (error) {
        console.error('❌ Error populating RAG model dropdowns:', error);
    }
}

// Update Token Counter Display (simplified for Bierdieb - no thinking breakdown)
function updateTokenCounter(deltaTokens, outputTokens, currentHistoryTokens) {
    // Update cumulative totals with DELTA only
    totalInputTokens += deltaTokens;
    totalOutputTokens += outputTokens;

    // Format numbers with German locale (thousand separators)
    const formatNum = (num) => num.toLocaleString('de-DE');

    // Update DOM elements (with null checks for safety)
    const tokenInputEl = document.getElementById('tokenInput');
    const tokenOutputEl = document.getElementById('tokenOutput');
    const tokenTotalEl = document.getElementById('tokenTotal');
    const tokenCounterEl = document.getElementById('tokenCounter');

    if (tokenInputEl && tokenOutputEl && tokenTotalEl && tokenCounterEl) {
        tokenInputEl.textContent = formatNum(totalInputTokens);
        tokenOutputEl.textContent = formatNum(totalOutputTokens);
        tokenTotalEl.textContent = formatNum(totalInputTokens + totalOutputTokens);
        tokenCounterEl.style.display = 'flex';
    }

    // Update context progress bar
    const contextLimitValue = settingsManager.modelSettings.num_ctx || 30000;
    const actualHistoryLength = currentHistoryTokens; // currentHistoryTokens already includes all tokens (input + output)
    const percentUsed = Math.round((actualHistoryLength / contextLimitValue) * 100);

    document.getElementById('contextUsed').textContent = formatNum(actualHistoryLength);
    document.getElementById('contextLimit').textContent = formatNum(contextLimitValue);
    document.getElementById('contextPercent').textContent = `(${percentUsed}%)`;

    // Update progress bar width
    const progressFill = document.getElementById('contextProgressFill');
    progressFill.style.width = `${Math.min(percentUsed, 100)}%`;

    // Update progress bar color based on usage
    progressFill.classList.remove('warning', 'critical');
    if (percentUsed >= 85) {
        progressFill.classList.add('critical');
    } else if (percentUsed >= 60) {
        progressFill.classList.add('warning');
    }

    console.log('📊 Token Counter Updated:', {
        input: totalInputTokens,
        output: totalOutputTokens,
        total: totalInputTokens + totalOutputTokens,
        contextUsed: actualHistoryLength,
        contextLimit: contextLimitValue,
        percentUsed: percentUsed
    });

    // Broadcast token update to dashboard
    ipcRenderer.send('broadcast-token-update', {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        contextLimit: contextLimitValue,
        contextUsage: actualHistoryLength,
        contextPercentage: percentUsed
    });
}

// Make function globally available for ollama-client.js
window.updateTokenCounter = updateTokenCounter;

/**
 * Update Context Breakdown Display
 * Shows detailed breakdown of what's consuming context window
 * @param {Object} data - {totalTokens, maxTokens, breakdown: {history, rag, tools, system}}
 */
function updateContextBreakdown(data) {
    const { totalTokens, maxTokens, breakdown } = data;
    const { history, rag, tools, system } = breakdown;

    // Format number with German locale
    const formatNum = (num) => num.toLocaleString('de-DE');

    // Calculate percentages
    const percentUsed = Math.round((totalTokens / maxTokens) * 100);
    const historyPercent = totalTokens > 0 ? Math.round((history / totalTokens) * 100) : 0;
    const ragPercent = totalTokens > 0 ? Math.round((rag / totalTokens) * 100) : 0;
    const toolsPercent = totalTokens > 0 ? Math.round((tools / totalTokens) * 100) : 0;
    const systemPercent = totalTokens > 0 ? Math.round((system / totalTokens) * 100) : 0;

    // Update compact display
    document.getElementById('contextUsed').textContent = formatNum(totalTokens);
    document.getElementById('contextLimit').textContent = formatNum(maxTokens);
    document.getElementById('contextPercent').textContent = `(${percentUsed}%)`;

    // Update detailed breakdown
    document.getElementById('historyTokens').textContent = formatNum(history);
    document.getElementById('historyPercent').textContent = `(${historyPercent}%)`;
    document.getElementById('historyBar').style.width = `${historyPercent}%`;

    document.getElementById('ragTokens').textContent = formatNum(rag);
    document.getElementById('ragPercent').textContent = `(${ragPercent}%)`;
    document.getElementById('ragBar').style.width = `${ragPercent}%`;

    document.getElementById('toolsTokens').textContent = formatNum(tools);
    document.getElementById('toolsPercent').textContent = `(${toolsPercent}%)`;
    document.getElementById('toolsBar').style.width = `${toolsPercent}%`;

    document.getElementById('systemTokens').textContent = formatNum(system);
    document.getElementById('systemPercent').textContent = `(${systemPercent}%)`;
    document.getElementById('systemBar').style.width = `${systemPercent}%`;

    // Update main progress bar
    const progressFill = document.getElementById('contextProgressFill');
    progressFill.style.width = `${Math.min(percentUsed, 100)}%`;

    // Update progress bar color
    progressFill.classList.remove('warning', 'critical');
    if (percentUsed >= 85) {
        progressFill.classList.add('critical');
    } else if (percentUsed >= 60) {
        progressFill.classList.add('warning');
    }

    // Show container
    document.getElementById('contextBreakdownContainer').style.display = 'flex';

    console.log('📊 Context Breakdown:', {
        total: totalTokens,
        max: maxTokens,
        used: `${percentUsed}%`,
        breakdown: {
            history: `${history} (${historyPercent}%)`,
            rag: `${rag} (${ragPercent}%)`,
            tools: `${tools} (${toolsPercent}%)`,
            system: `${system} (${systemPercent}%)`
        }
    });
}

// Make function globally available for ollama-client.js
window.updateContextBreakdown = updateContextBreakdown;

// Reset token counter (called when starting new chat)
function resetTokenCounter() {
    totalInputTokens = 0;
    totalOutputTokens = 0;

    // Reset Context Breakdown Display
    document.getElementById('contextUsed').textContent = '0';
    document.getElementById('contextPercent').textContent = '(0%)';
    document.getElementById('contextProgressFill').style.width = '0%';
    document.getElementById('contextProgressFill').classList.remove('warning', 'critical');

    // Reset breakdown details
    document.getElementById('historyTokens').textContent = '0';
    document.getElementById('historyPercent').textContent = '(0%)';
    document.getElementById('historyBar').style.width = '0%';
    document.getElementById('ragTokens').textContent = '0';
    document.getElementById('ragPercent').textContent = '(0%)';
    document.getElementById('ragBar').style.width = '0%';
    document.getElementById('toolsTokens').textContent = '0';
    document.getElementById('toolsPercent').textContent = '(0%)';
    document.getElementById('toolsBar').style.width = '0%';
    document.getElementById('systemTokens').textContent = '0';
    document.getElementById('systemPercent').textContent = '(0%)';
    document.getElementById('systemBar').style.width = '0%';

    // Hide container
    document.getElementById('contextBreakdownContainer').style.display = 'none';

    // Reset top header context display
    const contextLimitValue = settingsManager.modelSettings.num_ctx || 30000;
    document.getElementById('contextText').textContent = `Context: 0 / ${contextLimitValue.toLocaleString()} (0.0%)`;

    // Reset top header progress bar
    contextBarFill.style.width = '0%';
    contextBarFill.classList.remove('warning', 'critical');

    // Broadcast reset to dashboard
    ipcRenderer.send('broadcast-token-update', {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextLimit: contextLimitValue,
        contextUsage: 0,
        contextPercentage: 0
    });

    console.log('🔄 Token Counter Reset');
}

// Make function globally available
window.resetTokenCounter = resetTokenCounter;

// Update RAG Display - REMOVED (now shown in Dashboard)
// RAG information is now displayed in the dedicated Dashboard window
// This stub function is kept for compatibility with ollama-client.js
function updateRagDisplay(ragData) {
    // No-op: RAG display removed from header, now in Dashboard
    return;
}

// Make function globally available for ollama-client.js
window.updateRagDisplay = updateRagDisplay;

// Notify user that RAG was auto-disabled due to failures
function notifyRagAutoDisabled() {
    const notificationDiv = document.createElement('div');
    notificationDiv.className = 'message system';
    notificationDiv.innerHTML = `
        <div class="message-content">
            <div style="padding: 12px; background: rgba(255, 152, 0, 0.1); border-left: 3px solid #ff9800; border-radius: 6px;">
                <strong>⚠️ RAG Auto-Disabled</strong><br>
                RAG search failed 3 times consecutively. RAG has been temporarily disabled for this session to prevent further errors.<br>
                <br>
                <strong>Possible causes:</strong><br>
                • Embedding models not loaded (qwen3-embedding, snowflake-arctic-embed2)<br>
                • Ollama server overloaded<br>
                • Network issues<br>
                <br>
                <strong>To fix:</strong><br>
                • Restart the app<br>
                • Check Ollama status: <code>ollama list</code><br>
                • Pull embedding models if missing
            </div>
        </div>
    `;
    chatContainer.appendChild(notificationDiv);

    // Auto-scroll to show notification
    chatContainer.scrollTop = chatContainer.scrollHeight;

    console.log('📢 RAG Auto-Disable notification displayed');
}

// Make function globally available for ollama-client.js
window.notifyRagAutoDisabled = notifyRagAutoDisabled;

// Update RAG Status
async function updateRagStatus() {
    try {
        const stats = await ipcRenderer.invoke('rag-stats');
        const count = stats.count || 0;

        if (count === 0) {
            ragStatus.textContent = 'Database empty';
            ragStatus.style.color = 'var(--text-secondary)';
        } else {
            ragStatus.textContent = `${count.toLocaleString()} chunks indexed`;
            ragStatus.style.color = '#98c379'; // Green
        }

        // Broadcast RAG analytics to dashboard
        broadcastRagAnalytics();
    } catch (error) {
        console.error('Failed to fetch RAG stats:', error);
        ragStatus.textContent = 'Status unavailable';
        ragStatus.style.color = 'var(--error-color)';
    }
}

// Update RAG button states based on RAG enabled status
function updateRagButtonStates() {
    const settings = settingsManager.getSettings();
    const isEnabled = settings.ragEnabled;

    if (indexFilesBtn) {
        indexFilesBtn.disabled = !isEnabled;
        indexFilesBtn.title = isEnabled
            ? 'Index Selected Files'
            : 'RAG muss zuerst in Settings aktiviert werden';
    }

    // Clear Database button is always enabled (can clear old data even when RAG is disabled)
    if (clearDbBtn) {
        clearDbBtn.title = 'Clear Database';
    }
}

// Make function globally available for settings-manager
window.updateRagButtonStates = updateRagButtonStates;

// Record RAG Query (called from ollama-client.js after each RAG search)
function recordRagQuery(queryData) {
    ragQueryHistory.push(queryData);
    ragTotalQueries++;
    ragTotalQueryTime += queryData.duration;
    ragTotalRelevanceScore += queryData.avgScore;

    console.log(`🔍 RAG Query Recorded (#${ragTotalQueries}):`, {
        query: queryData.query.substring(0, 60) + (queryData.query.length > 60 ? '...' : ''),
        resultsCount: queryData.resultsCount,
        avgScore: queryData.avgScore.toFixed(3),
        duration: queryData.duration.toFixed(2) + 'ms'
    });

    // Broadcast updated analytics to dashboard
    broadcastRagAnalytics();
}

// Make function globally available for ollama-client.js
window.recordRagQuery = recordRagQuery;

// Make pin-manager's buildConversationWithPins globally available for ollama-client.js
window.buildConversationWithPins = function(conversationHistory) {
    return pinManager.buildConversationWithPins(conversationHistory);
};

// Update Code Button State based on model tool capability
function updateCodeButtonState(capable) {
    if (!codeModeToggle) return;

    if (capable) {
        // Model supports tools - enable button
        codeModeToggle.disabled = false;
        codeModeToggle.style.opacity = '1';
        codeModeToggle.title = 'Toggle Code Mode (System Tools)';
        console.log('✅ Code button enabled - Model supports tools');
    } else {
        // Model does NOT support tools - disable button and force off
        codeModeToggle.disabled = true;
        codeModeToggle.style.opacity = '0.4';
        codeModeToggle.classList.remove('active');
        codeModeEnabled = false;
        codeModeToggle.title = 'Code Mode unavailable - Current model does not support tool calling';
        console.warn('⚠️ Code button disabled - Model does not support tools');
    }
}

// Make function globally available for ollama-client.js
window.updateCodeButtonState = updateCodeButtonState;

// Broadcast RAG Analytics to Dashboard
async function broadcastRagAnalytics() {
    try {
        const stats = await ipcRenderer.invoke('rag-stats');

        // Calculate averages from tracked data
        const analyticsData = {
            indexedChunks: stats.count || 0,
            totalQueries: ragTotalQueries,
            avgQueryTime: ragTotalQueries > 0 ? (ragTotalQueryTime / ragTotalQueries) : 0,
            avgRelevance: ragTotalQueries > 0 ? (ragTotalRelevanceScore / ragTotalQueries) : 0
        };

        console.log('📊 Broadcasting RAG Analytics to Dashboard:', {
            indexedChunks: analyticsData.indexedChunks,
            totalQueries: analyticsData.totalQueries,
            avgQueryTime: analyticsData.avgQueryTime.toFixed(2) + 'ms',
            avgRelevance: analyticsData.avgRelevance.toFixed(3)
        });

        ipcRenderer.send('broadcast-rag-update', analyticsData);
    } catch (error) {
        console.error('Failed to broadcast RAG analytics:', error);
    }
}

// Reset RAG Query Statistics
function resetRagQueryStats() {
    ragQueryHistory = [];
    ragTotalQueries = 0;
    ragTotalQueryTime = 0;
    ragTotalRelevanceScore = 0;

    console.log('🔄 RAG Query Stats reset');

    // Broadcast updated (zeroed) analytics to dashboard
    broadcastRagAnalytics();
}

// Update Pinned Panel UI
function updatePinnedPanel() {
    const pins = pinManager.getPinnedMessages();
    const count = pinManager.getPinnedCount();
    const totalTokens = pinManager.calculatePinnedTokens();

    // Update sidebar stats
    pinnedCount.textContent = count;
    pinnedMax.textContent = pinManager.MAX_PINNED;
    pinnedTokens.textContent = `${totalTokens.toLocaleString()} tokens`;

    // Update header indicator
    headerPinnedCount.textContent = `${count}/${pinManager.MAX_PINNED}`;
    headerPinnedTokens.textContent = `(${totalTokens.toLocaleString()})`;

    // Show/hide indicator based on count
    if (count === 0) {
        pinIndicator.classList.add('empty');
    } else {
        pinIndicator.classList.remove('empty');
    }

    // Show/hide sidebar based on pin count and collapsed state
    if (count === 0) {
        // Collapse sidebar and button instead of hiding with display:none
        // This keeps button visible at right edge (CSS: .collapsed { right: 0 })
        pinnedSidebar.style.display = 'flex'; // Keep in layout for transform to work
        pinnedSidebar.classList.add('collapsed');
        pinnedSidebarToggle.classList.add('collapsed');
        mainContent.classList.remove('pinned-sidebar-visible');
        inputContainer.classList.remove('pinned-sidebar-visible');
        console.log('[DEBUG updatePinnedPanel] No pins - removing classes. inputContainer:', inputContainer, 'classes:', inputContainer?.className);
        return;
    } else {
        pinnedSidebar.style.display = 'flex';

        // Only add margin class if sidebar is NOT collapsed
        const isCollapsed = pinnedSidebar.classList.contains('collapsed');
        if (!isCollapsed) {
            mainContent.classList.add('pinned-sidebar-visible');
            inputContainer.classList.add('pinned-sidebar-visible');
            console.log('[DEBUG updatePinnedPanel] Has pins & not collapsed - adding classes. inputContainer:', inputContainer, 'classes:', inputContainer?.className);
        } else {
            console.log('[DEBUG updatePinnedPanel] Has pins BUT collapsed - NOT adding classes. inputContainer:', inputContainer, 'classes:', inputContainer?.className);
        }
    }

    // Render pins
    pinnedContent.innerHTML = '';
    pins.forEach(pin => {
        const pinDiv = document.createElement('div');
        pinDiv.className = 'pinned-item';
        pinDiv.dataset.pinId = pin.id;

        const roleClass = pin.role === 'user' ? 'pinned-user' : 'pinned-assistant';
        const roleLabel = pin.role === 'user' ? 'User' : 'Assistant';

        // Truncate content for preview
        const preview = pin.content.length > 150 ? pin.content.substring(0, 150) + '...' : pin.content;

        pinDiv.innerHTML = `
            <div class="pinned-item-header ${roleClass}">
                <span class="pinned-role">${roleLabel}</span>
                <span class="pinned-item-tokens">${pin.tokens} tokens</span>
            </div>
            <div class="pinned-item-content">${preview}</div>
            <div class="pinned-item-actions">
                <button class="pinned-action-btn unpin-btn" data-pin-id="${pin.id}" title="Unpin">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M2,5.27L3.28,4L20,20.72L18.73,22L12.8,16.07V22H11.2V16.05L6,14V16H4V14L6,12V9.27L2,5.27M16,12V4H17V2H7V4H8V12L6,14V16H11.2V12.8L16,12Z"/>
                    </svg>
                </button>
                <button class="pinned-action-btn archive-btn" data-pin-id="${pin.id}" title="Archive to RAG">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M3,3H21V7H3V3M4,8H20V21H4V8M9.5,11A0.5,0.5 0 0,0 9,11.5V13H15V11.5A0.5,0.5 0 0,0 14.5,11H9.5Z"/>
                    </svg>
                </button>
            </div>
        `;

        pinnedContent.appendChild(pinDiv);
    });

    // Update context usage indicator
    const usage = pinManager.getContextUsage(totalInputTokens + totalOutputTokens);
    console.log('📊 Pin Context Usage:', usage);
}

// ============================================================================
// RAG INDEXING TIMER FUNCTIONS
// ============================================================================

/**
 * Format seconds into readable time string (MM:SS or HH:MM:SS)
 */
function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Start indexing timer
 */
function startIndexingTimer() {
    indexingStartTime = Date.now();
    indexingFileCompletionTimes = [];

    const timerContainer = document.getElementById('rag-timer-container');
    const timerElapsed = document.getElementById('rag-timer-elapsed');
    const timerEta = document.getElementById('rag-timer-eta');

    if (timerContainer) {
        timerContainer.style.display = 'flex';
    }
    if (timerElapsed) {
        timerElapsed.textContent = '⏱️ 00:00';
    }
    if (timerEta) {
        timerEta.style.display = 'none'; // ETA versteckt bis erste Berechnung
    }
}

/**
 * Update timer with ETA calculation
 * @param {number} completedFiles - Number of files completed
 * @param {number} totalFiles - Total number of files to index
 */
function updateIndexingTimer(completedFiles, totalFiles) {
    if (!indexingStartTime) return;

    const elapsed = Math.floor((Date.now() - indexingStartTime) / 1000);
    const timerElapsed = document.getElementById('rag-timer-elapsed');
    const timerEta = document.getElementById('rag-timer-eta');

    // Elapsed Time IMMER aktualisieren
    if (timerElapsed) {
        timerElapsed.textContent = `⏱️ ${formatTime(elapsed)}`;
    }

    // ETA nur anzeigen wenn berechenbar und sinnvoll
    if (timerEta) {
        if (completedFiles > 0 && completedFiles < totalFiles) {
            const avgTimePerFile = elapsed / completedFiles;
            const remainingFiles = totalFiles - completedFiles;
            const etaSeconds = Math.floor(avgTimePerFile * remainingFiles);

            // ETA nur anzeigen wenn > 0
            if (etaSeconds > 0) {
                timerEta.textContent = `ETA: ~${formatTime(etaSeconds)}`;
                timerEta.style.display = 'block';
            } else {
                timerEta.style.display = 'none';
            }
        } else {
            // Keine ETA wenn alle Files fertig oder noch kein File completed
            timerEta.style.display = 'none';
        }
    }
}

/**
 * Stop indexing timer and show final time
 * @param {boolean} success - Whether indexing completed successfully
 * @param {string} message - Optional custom message
 */
function stopIndexingTimer(success = true, message = null) {
    const timerContainer = document.getElementById('rag-timer-container');
    const timerElapsed = document.getElementById('rag-timer-elapsed');
    const timerEta = document.getElementById('rag-timer-eta');

    if (timerElapsed && indexingStartTime) {
        const elapsed = Math.floor((Date.now() - indexingStartTime) / 1000);

        if (message) {
            timerElapsed.textContent = message;
        } else if (success) {
            timerElapsed.textContent = `✓ ${formatTime(elapsed)}`;
            timerElapsed.style.color = '#98c379'; // Green
        } else {
            timerElapsed.textContent = `⚠️ ${formatTime(elapsed)}`;
            timerElapsed.style.color = '#e06c75'; // Red
        }
    }

    // ETA verstecken bei Stop
    if (timerEta) {
        timerEta.style.display = 'none';
    }

    // Hide timer container after 5 seconds
    setTimeout(() => {
        if (timerContainer) {
            timerContainer.style.display = 'none';
        }
        if (timerElapsed) {
            timerElapsed.style.color = '#e5c07b'; // Reset to yellow
        }
    }, 5000);

    indexingStartTime = null;
    indexingFileCompletionTimes = [];
}

/**
 * Get active snapshots from localStorage
 */
function getActiveSnapshotsFromStorage() {
    try {
        const stored = localStorage.getItem('active-snapshots');
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.error('Failed to load active snapshots:', error);
        return [];
    }
}

/**
 * Update active snapshots in localStorage
 */
function updateActiveSnapshotsStorage(snapshots) {
    try {
        localStorage.setItem('active-snapshots', JSON.stringify(snapshots));
    } catch (error) {
        console.error('Failed to save active snapshots:', error);
    }
}

/**
 * Render active snapshots list in UI
 */
function renderActiveSnapshotsList() {
    const container = document.getElementById('active-snapshots-list');
    const section = document.getElementById('active-snapshots-section');

    if (!container || !section) return;

    const activeSnapshots = getActiveSnapshotsFromStorage();

    if (activeSnapshots.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    container.innerHTML = '';

    activeSnapshots.forEach(snapshot => {
        const item = document.createElement('div');
        item.className = 'active-snapshot-item';

        const loadedDate = new Date(snapshot.loadedAt).toLocaleDateString();

        item.innerHTML = `
            <div class="active-snapshot-info">
                <div class="active-snapshot-name">${snapshot.name}</div>
                <div class="active-snapshot-details">
                    ${snapshot.fileCount} files • ${snapshot.model || 'N/A'} • Loaded ${loadedDate}
                </div>
            </div>
            <div class="active-snapshot-badge">Active</div>
        `;

        container.appendChild(item);
    });
}

// Pre-Index Dialog: Check if database has content and prompt for snapshot
async function checkAndShowPreIndexDialog() {
    return new Promise(async (resolve, reject) => {
        try {
            // Get current database stats
            const stats = await ipcRenderer.invoke('rag-stats');

            // If database is empty, proceed directly
            if (!stats || stats.count === 0) {
                resolve({ shouldProceed: true, saveSnapshot: false });
                return;
            }

            // Database has content - show pre-index dialog
            const modal = document.getElementById('pre-index-snapshot-modal');
            const countElem = document.getElementById('pre-index-db-count');
            const snapshotNameInput = document.getElementById('pre-index-snapshot-name');
            const saveCheckbox = document.getElementById('save-snapshot-before-index-checkbox');
            const continueBtn = document.getElementById('pre-index-continue-btn');
            const cancelBtn = document.getElementById('pre-index-cancel-btn');

            // Update dialog with current stats
            countElem.textContent = `${stats.count} documents`;

            // Generate auto-snapshot name with timestamp
            const now = new Date();
            const timestamp = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
            snapshotNameInput.value = `auto_backup_${timestamp}`;

            // Show modal
            modal.style.display = 'flex';

            // Setup button handlers (one-time)
            const handleContinue = async () => {
                modal.style.display = 'none';
                cleanup();

                const shouldSaveSnapshot = saveCheckbox.checked;
                const snapshotName = snapshotNameInput.value.trim();

                if (shouldSaveSnapshot && snapshotName) {
                    try {
                        console.log(`💾 Saving pre-index snapshot: ${snapshotName}`);
                        const saveResult = await ipcRenderer.invoke('rag-save-snapshot', {
                            name: snapshotName,
                            autoTimestamp: false // Name already has timestamp
                        });

                        if (saveResult.success) {
                            console.log(`✅ Snapshot saved: ${snapshotName}`);
                        } else {
                            console.error(`❌ Failed to save snapshot: ${saveResult.error}`);
                            alert(`Failed to save snapshot: ${saveResult.error}`);
                        }
                    } catch (error) {
                        console.error('Error saving pre-index snapshot:', error);
                        alert(`Error saving snapshot: ${error.message}`);
                    }
                }

                resolve({ shouldProceed: true, saveSnapshot: shouldSaveSnapshot });
            };

            const handleCancel = () => {
                modal.style.display = 'none';
                cleanup();
                resolve({ shouldProceed: false, saveSnapshot: false });
            };

            const cleanup = () => {
                continueBtn.removeEventListener('click', handleContinue);
                cancelBtn.removeEventListener('click', handleCancel);
            };

            continueBtn.addEventListener('click', handleContinue);
            cancelBtn.addEventListener('click', handleCancel);

        } catch (error) {
            console.error('Error in pre-index dialog:', error);
            reject(error);
        }
    });
}

// Setup RAG Event Listeners (can be called dynamically when RAG is enabled)
function setupRagEventListeners() {
    // Remove existing listeners to prevent duplicates
    if (indexFilesBtn) {
        const newIndexBtn = indexFilesBtn.cloneNode(true);
        indexFilesBtn.replaceWith(newIndexBtn);
        // Update reference
        const updatedIndexBtn = document.getElementById('index-files-btn');

        updatedIndexBtn.addEventListener('click', async () => {
            try {
                // Check if RAG is enabled
                const settings = settingsManager.getSettings();
                if (!settings.ragEnabled) {
                    alert('RAG ist nicht aktiviert.\\n\\nBitte aktivieren Sie RAG in Settings → Ollama Settings → RAG System.');
                    return;
                }

                // Get selected files from file browser (if any)
                let selectedFiles = fileBrowser.getSelectedFiles();

                // If no files selected, get all files from current directory
                if (selectedFiles.length === 0) {
                    const tbody = document.getElementById('file-list-body');
                    const fileRows = tbody.querySelectorAll('tr');

                    selectedFiles = Array.from(fileRows)
                        .filter(row => row.dataset.isDirectory === 'false') // Only files
                        .map(row => row.title)
                        .filter(path => path && path.length > 0);
                }

                console.log('📁 Files to index:', selectedFiles);

                if (selectedFiles.length === 0) {
                    alert('No files available to index. Navigate to a directory with files first.');
                    return;
                }

                // Dual-embedding is now hardcoded (jina-code + nomic-text) - no validation needed

                // Pre-Index Dialog: Check if database has content and prompt for snapshot
                const preIndexResult = await checkAndShowPreIndexDialog();
                if (!preIndexResult.shouldProceed) {
                    console.log('📋 Indexing cancelled by user (pre-index dialog)');
                    return; // User clicked Cancel in pre-index dialog
                }

                if (preIndexResult.saveSnapshot) {
                    console.log('✅ Pre-index snapshot saved, proceeding with indexing');
                } else {
                    console.log('📋 Proceeding with indexing without snapshot');
                }

                // Show processing state
                updatedIndexBtn.disabled = true;
                const originalText = updatedIndexBtn.textContent;
                updatedIndexBtn.textContent = 'Indexing...';
                ragStatus.textContent = 'Processing...';
                ragStatus.style.color = 'var(--text-secondary)';

                // Show Stop button during indexing
                const stopBtn = document.getElementById('stop-indexing-btn');
                if (stopBtn) stopBtn.style.display = '';

                // Start indexing timer
                startIndexingTimer();

                // Call IPC to index files (NON-BLOCKING - handle completion asynchronously)
                // This allows the event loop to continue and render DOM updates (stop button becomes visible)
                ipcRenderer.invoke('rag-index-files', selectedFiles)
                    .then(async (result) => {
                        // Hide Stop button when done
                        if (stopBtn) stopBtn.style.display = 'none';

                        // Update UI based on result
                        if (result.success) {
                            ragStatus.textContent = result.message || 'Indexing complete';
                            ragStatus.style.color = '#98c379'; // Green
                            await updateRagStatus(); // Refresh stats
                            stopIndexingTimer(true); // Stop timer with success
                        } else if (result.aborted) {
                            ragStatus.textContent = result.message || 'Indexing stopped by user';
                            ragStatus.style.color = '#e5c07b'; // Yellow
                            await updateRagStatus(); // Refresh stats (partial data may be indexed)
                            stopIndexingTimer(false); // Stop timer with abort
                        } else {
                            ragStatus.textContent = 'Indexing failed';
                            ragStatus.style.color = 'var(--error-color)';
                            stopIndexingTimer(false); // Stop timer with error
                        }

                        // Reset button state
                        updatedIndexBtn.textContent = originalText;
                        updatedIndexBtn.disabled = false;
                    })
                    .catch((error) => {
                        // Hide Stop button on error
                        if (stopBtn) stopBtn.style.display = 'none';

                        console.error('Failed to index files:', error);
                        ragStatus.textContent = 'Error during indexing';
                        ragStatus.style.color = 'var(--error-color)';

                        // Stop timer on error
                        stopIndexingTimer(false);

                        // Reset button state
                        updatedIndexBtn.textContent = originalText;
                        updatedIndexBtn.disabled = false;
                    });

                // Function returns immediately, allowing event loop to continue

            } catch (error) {
                // Handle synchronous errors (before IPC call)
                console.error('Failed to start indexing:', error);
                ragStatus.textContent = 'Error starting indexing';
                ragStatus.style.color = 'var(--error-color)';

                // Stop timer if it was started
                if (indexingStartTime) {
                    stopIndexingTimer(false);
                }

                const indexBtn = document.getElementById('index-files-btn');
                if (indexBtn) {
                    indexBtn.disabled = false;
                    indexBtn.textContent = 'Index Selected Files';
                }

                // Make sure stop button is hidden
                const stopBtn = document.getElementById('stop-indexing-btn');
                if (stopBtn) stopBtn.style.display = 'none';
            }
        });
    }

    if (clearDbBtn) {
        const newClearBtn = clearDbBtn.cloneNode(true);
        clearDbBtn.replaceWith(newClearBtn);
        // Update reference
        const updatedClearBtn = document.getElementById('clear-db-btn');

        updatedClearBtn.addEventListener('click', async () => {
            if (!confirm('Clear entire RAG database?\\n\\nThis will delete all indexed documents and cannot be undone.')) {
                return;
            }

            try {
                updatedClearBtn.disabled = true;
                const originalText = updatedClearBtn.textContent;
                updatedClearBtn.textContent = 'Clearing...';

                const result = await ipcRenderer.invoke('rag-clear');

                if (result.success) {
                    ragStatus.textContent = result.message || 'Database cleared';
                    ragStatus.style.color = 'var(--text-secondary)';
                    await updateRagStatus(); // Refresh stats
                    resetRagQueryStats(); // Reset query statistics

                    // Clear active snapshots tracking
                    updateActiveSnapshotsStorage([]);
                    renderActiveSnapshotsList();
                } else {
                    ragStatus.textContent = 'Failed to clear database';
                    ragStatus.style.color = 'var(--error-color)';
                }

                updatedClearBtn.textContent = originalText;
                updatedClearBtn.disabled = false;
            } catch (error) {
                console.error('Failed to clear database:', error);
                ragStatus.textContent = 'Error clearing database';
                ragStatus.style.color = 'var(--error-color)';
                document.getElementById('clear-db-btn').disabled = false;
            }
        });
    }

    // Stop Indexing button handler
    const stopIndexingBtn = document.getElementById('stop-indexing-btn');
    if (stopIndexingBtn) {
        const newStopBtn = stopIndexingBtn.cloneNode(true);
        stopIndexingBtn.replaceWith(newStopBtn);
        const updatedStopBtn = document.getElementById('stop-indexing-btn');

        updatedStopBtn.addEventListener('click', async () => {
            try {
                updatedStopBtn.disabled = true;
                const originalText = updatedStopBtn.textContent;
                updatedStopBtn.textContent = 'Stopping...';
                ragStatus.textContent = 'Stopping indexing...';
                ragStatus.style.color = '#e5c07b'; // Yellow

                await ipcRenderer.invoke('rag-abort-indexing');

                // UI will be updated by the Index Files handler when it receives abort result
            } catch (error) {
                console.error('Failed to stop indexing:', error);
                ragStatus.textContent = 'Error stopping indexing';
                ragStatus.style.color = 'var(--error-color)';
                updatedStopBtn.disabled = false;
            }
        });
    }

    console.log('✅ RAG Event Listeners initialized');
}

// Make function globally available for settings-manager
window.setupRagEventListeners = setupRagEventListeners;

// Event Listeners
function setupEventListeners() {
    // Security: Intercept all link clicks and open external links in system browser
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.href) {
            // Check if external link (not file://)
            if (!link.href.startsWith('file://')) {
                e.preventDefault();
                shell.openExternal(link.href);
                console.log('🔗 Opening external link in system browser:', link.href);
            }
        }
    }, true); // Capture phase to intercept early

    // Send message / Stop generation
    sendBtn.addEventListener('click', () => {
        if (sendBtn.dataset.mode === 'stop') {
            // Stop the current generation
            ollamaClient.abortGeneration();
        } else {
            // Send new message
            sendMessage();
        }
    });
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    messageInput.addEventListener('input', autoResizeTextarea);

    // Clear chat
    clearBtn.addEventListener('click', clearChat);

    // Context Breakdown Expand/Collapse Toggle
    const contextExpandBtn = document.getElementById('contextExpandBtn');
    const contextDetailed = document.getElementById('contextDetailed');
    if (contextExpandBtn && contextDetailed) {
        contextExpandBtn.addEventListener('click', () => {
            const isExpanded = contextDetailed.style.display === 'flex';
            if (isExpanded) {
                // Collapse
                contextDetailed.style.display = 'none';
                contextExpandBtn.textContent = '▼';
                contextExpandBtn.classList.remove('expanded');
                contextExpandBtn.title = 'Show breakdown';
            } else {
                // Expand
                contextDetailed.style.display = 'flex';
                contextExpandBtn.textContent = '▲';
                contextExpandBtn.classList.add('expanded');
                contextExpandBtn.title = 'Hide breakdown';
            }
        });
    }

    // Dashboard button
    dashboardBtn.addEventListener('click', () => {
        ipcRenderer.send('open-dashboard');
    });

    // Code mode toggle
    codeModeToggle.addEventListener('click', () => {
        codeModeEnabled = !codeModeEnabled;
        if (codeModeEnabled) {
            codeModeToggle.classList.add('active');
        } else {
            codeModeToggle.classList.remove('active');
        }

        // Save to localStorage
        localStorage.setItem('ollmini-tool-enabled', codeModeEnabled);
        console.log('🔧 Tool mode:', codeModeEnabled ? 'ENABLED' : 'DISABLED');
    });

    // WebSearch mode toggle
    const webSearchModeToggle = document.getElementById('webSearchModeToggle');
    if (webSearchModeToggle) {
        webSearchModeToggle.addEventListener('click', () => {
            webSearchModeEnabled = !webSearchModeEnabled;
            if (webSearchModeEnabled) {
                webSearchModeToggle.classList.add('active');
            } else {
                webSearchModeToggle.classList.remove('active');
            }

            // Save to localStorage
            localStorage.setItem('ollmini-websearch-enabled', webSearchModeEnabled);
            console.log('🌐 WebSearch mode:', webSearchModeEnabled ? 'ENABLED' : 'DISABLED');
        });
    }

    // Thinking level toggle
    const thinkingSwitch = document.getElementById('thinkingSwitch');
    if (thinkingSwitch) {
        thinkingSwitch.addEventListener('click', () => {
            const currentIndex = thinkingLevels.indexOf(currentThinkingLevel);
            const nextIndex = (currentIndex + 1) % thinkingLevels.length;
            currentThinkingLevel = thinkingLevels[nextIndex];

            thinkingSwitch.setAttribute('data-level', currentThinkingLevel);
            thinkingSwitch.querySelector('.thinking-level').textContent = currentThinkingLevel;

            // Save to localStorage
            settingsManager.modelSettings.thinkingLevel = currentThinkingLevel;
            localStorage.setItem('ollmini-devbox-settings', JSON.stringify(settingsManager.modelSettings));

            console.log('🧠 Thinking level changed to:', currentThinkingLevel);
        });
    }

    // Pinned Sidebar Toggle
    if (pinnedSidebarToggle) {
        pinnedSidebarToggle.addEventListener('click', () => {
            // Toggle collapsed class on both sidebar and button
            pinnedSidebar.classList.toggle('collapsed');
            pinnedSidebarToggle.classList.toggle('collapsed');

            const isCollapsed = pinnedSidebar.classList.contains('collapsed');

            // Update main-content margin only when NOT collapsed and has pins
            const hasPins = pinManager.getPinnedCount() > 0;
            if (isCollapsed || !hasPins) {
                mainContent.classList.remove('pinned-sidebar-visible');
                inputContainer.classList.remove('pinned-sidebar-visible');
                console.log('[DEBUG Toggle] Removing classes - isCollapsed:', isCollapsed, 'hasPins:', hasPins, 'inputContainer:', inputContainer, 'classes:', inputContainer?.className);
            } else {
                mainContent.classList.add('pinned-sidebar-visible');
                inputContainer.classList.add('pinned-sidebar-visible');
                console.log('[DEBUG Toggle] Adding classes - isCollapsed:', isCollapsed, 'hasPins:', hasPins, 'inputContainer:', inputContainer, 'classes:', inputContainer?.className);
            }

            // Save state to localStorage
            localStorage.setItem('pinned-sidebar-collapsed', isCollapsed);

            console.log('📌 Pinned sidebar collapsed:', isCollapsed);
        });
    }

    // Pin indicator in header - toggle sidebar
    if (pinIndicator) {
        pinIndicator.addEventListener('click', () => {
            // Toggle collapsed class on both sidebar and button
            pinnedSidebar.classList.toggle('collapsed');
            pinnedSidebarToggle.classList.toggle('collapsed');

            const isCollapsed = pinnedSidebar.classList.contains('collapsed');

            // Update main-content margin only when NOT collapsed and has pins
            const hasPins = pinManager.getPinnedCount() > 0;
            if (isCollapsed || !hasPins) {
                mainContent.classList.remove('pinned-sidebar-visible');
                inputContainer.classList.remove('pinned-sidebar-visible');
                console.log('[DEBUG Pin Indicator] Removing classes - isCollapsed:', isCollapsed, 'hasPins:', hasPins, 'inputContainer:', inputContainer, 'classes:', inputContainer?.className);
            } else {
                mainContent.classList.add('pinned-sidebar-visible');
                inputContainer.classList.add('pinned-sidebar-visible');
                console.log('[DEBUG Pin Indicator] Adding classes - isCollapsed:', isCollapsed, 'hasPins:', hasPins, 'inputContainer:', inputContainer, 'classes:', inputContainer?.className);
            }

            // Save state to localStorage
            localStorage.setItem('pinned-sidebar-collapsed', isCollapsed);

            console.log('📌 Pin indicator clicked - sidebar collapsed:', isCollapsed);
        });
    }

    // RAG initialization on first use (handled in settings-manager now)

    // Copy code button clicks (event delegation)
    chatContainer.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.copy-code-btn');
        if (copyBtn) {
            const codeBlock = copyBtn.nextElementSibling?.querySelector('code');
            if (codeBlock) {
                copyCodeToClipboard(copyBtn, codeBlock.textContent);
            }
        }
    });

    // Pin message button clicks (event delegation)
    chatContainer.addEventListener('click', async (e) => {
        const pinBtn = e.target.closest('.pin-message-btn');
        if (!pinBtn) return;

        const messageId = pinBtn.dataset.messageId;
        const messageDiv = pinBtn.closest('.message');

        if (!messageDiv) {
            console.error('📌 Could not find message div for pin button');
            return;
        }

        const role = messageDiv.classList.contains('user') ? 'user' : 'assistant';
        const contentDiv = messageDiv.querySelector('.message-content');

        if (!contentDiv) {
            console.error('📌 Could not find message content for pinning');
            return;
        }

        // Get raw text content (not rendered HTML)
        // For assistant messages, extract from .content-section to exclude think-blocks
        let content;
        if (role === 'assistant') {
            const contentSection = contentDiv.querySelector('.content-section');
            content = contentSection ? (contentSection.textContent || contentSection.innerText) : (contentDiv.textContent || contentDiv.innerText);
        } else {
            content = contentDiv.textContent || contentDiv.innerText;
        }

        // Check if already pinned
        if (pinManager.isPinned(messageId)) {
            // Unpin
            const result = pinManager.unpinMessage(messageId);
            if (result.success) {
                messageRenderer.updatePinButtonState(messageId, false);
                updatePinnedPanel();
                console.log('📌 Unpinned message:', messageId);
            }
        } else {
            // Pin
            const result = pinManager.pinMessage(messageId, role, content);

            if (result.success) {
                messageRenderer.updatePinButtonState(messageId, true);
                updatePinnedPanel();
                console.log('📌 Pinned message:', messageId, `(${result.pin.tokens} tokens)`);
            } else if (result.reason === 'max_reached') {
                alert(`Maximum number of pinned messages (${pinManager.MAX_PINNED}) reached.\n\nPlease unpin a message or archive it to RAG before pinning new ones.`);
            } else if (result.reason === 'already_pinned') {
                console.log('📌 Message already pinned:', messageId);
            }
        }

        // Update context usage display if needed
        const usage = pinManager.getContextUsage(totalInputTokens + totalOutputTokens);
        console.log('📊 Context usage after pin change:', usage);
    });

    // Pinned panel action buttons (event delegation)
    pinnedContent.addEventListener('click', async (e) => {
        const unpinBtn = e.target.closest('.unpin-btn');
        const archiveBtn = e.target.closest('.archive-btn');

        if (unpinBtn) {
            const pinId = unpinBtn.dataset.pinId;
            const result = pinManager.unpinMessage(pinId);
            if (result.success) {
                messageRenderer.updatePinButtonState(pinId, false);
                updatePinnedPanel();
                console.log('📌 Unpinned from panel:', pinId);
            }
        } else if (archiveBtn) {
            const pinId = archiveBtn.dataset.pinId;

            const result = await pinManager.archivePinToRAG(pinId);
            if (result.success) {
                messageRenderer.updatePinButtonState(pinId, false);
                updatePinnedPanel();
                console.log('🗄️ Archived pin to RAG:', pinId);
            } else {
                alert(`Failed to archive pin:\n${result.error || result.reason}`);
            }
        }
    });

    // RAG Pin System (separate from context pins)
    chatContainer.addEventListener('click', async (e) => {
        const ragPinBtn = e.target.closest('.rag-pin-message-btn');
        if (!ragPinBtn) return;

        // Check if RAG is enabled
        const settings = settingsManager.getSettings();
        if (!settings.ragEnabled) {
            messageRenderer.showToast('❌ RAG is not enabled', 'error');
            return;
        }

        const messageId = ragPinBtn.dataset.messageId;
        const messageDiv = ragPinBtn.closest('.message');

        if (!messageDiv) {
            console.error('🗄️ Could not find message div for RAG pin button');
            return;
        }

        const role = ragPinBtn.dataset.role;
        const contentDiv = messageDiv.querySelector('.message-content');
        const content = contentDiv ? (contentDiv.textContent || contentDiv.innerText) : '';

        // Check if already pinned to RAG
        const isCurrentlyPinned = ragPinBtn.classList.contains('pinned');

        if (isCurrentlyPinned) {
            // Unpin from RAG
            const result = await ipcRenderer.invoke('rag-unpin-message', messageId);
            if (result.success) {
                ragPinBtn.classList.remove('pinned');
                ragPinBtn.title = 'Pin to RAG (long-term storage)';
                messageRenderer.showToast('📤 Unpinned from RAG', 'success');
            }
        } else {
            // Pin to RAG
            const result = await ipcRenderer.invoke('rag-pin-message', {
                messageId,
                role,
                content,
                pinnedAt: Date.now(),
                tags: []
            });

            if (result.success) {
                ragPinBtn.classList.add('pinned');
                ragPinBtn.title = 'Unpin from RAG';
                messageRenderer.showToast('📥 Pinned to RAG', 'success');
            } else {
                messageRenderer.showToast(`❌ Failed to pin: ${result.error}`, 'error');
            }
        }
    });

    // Copy Message Button (event delegation)
    chatContainer.addEventListener('click', async (e) => {
        const copyBtn = e.target.closest('.copy-message-btn');
        if (!copyBtn) return;

        const messageDiv = copyBtn.closest('.message');
        const contentDiv = messageDiv?.querySelector('.message-content');

        if (!contentDiv) {
            console.error('📋 Could not find message content for copying');
            return;
        }

        // Get plain text content (without HTML)
        const textToCopy = contentDiv.textContent || contentDiv.innerText;

        try {
            await navigator.clipboard.writeText(textToCopy);

            // Visual feedback
            const originalHTML = copyBtn.innerHTML;
            copyBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                </svg>
                <span>Copied!</span>
            `;
            copyBtn.classList.add('copied');

            setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                copyBtn.classList.remove('copied');
            }, 2000);
        } catch (error) {
            console.error('❌ Failed to copy message:', error);
            messageRenderer.showToast('❌ Failed to copy message', 'error');
        }
    });

    // Model selection change
    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            const newModel = ollamaClient.getCurrentModel();
            ollamaClient.setCurrentModel(newModel);
            ollamaClient.initPermissionManager();

            // Save model selection to localStorage for persistence
            localStorage.setItem('ollmini-selected-model', newModel);
            console.log('💾 Model selection saved to localStorage:', newModel);

            // Update context slider maximum based on model
            updateContextSliderForModel(newModel);
        });
    }

    // Working Directory Button - Shortcut to open Settings at Working Directory tab
    const workingDirBtn = document.getElementById('workingDirBtn');
    if (workingDirBtn) {
        workingDirBtn.addEventListener('click', () => {
            // Open settings modal
            const settingsModal = document.getElementById('settings-modal');
            settingsModal.classList.add('show');

            // Switch to workspace tab
            const workspaceTab = document.querySelector('[data-tab="workspace"]');
            const workspaceContent = document.getElementById('workspace-tab');

            if (workspaceTab && workspaceContent) {
                // Deactivate all tabs
                document.querySelectorAll('.settings-nav-item').forEach(item => item.classList.remove('active'));
                document.querySelectorAll('.settings-tab').forEach(tab => tab.classList.remove('active'));

                // Activate workspace tab
                workspaceTab.classList.add('active');
                workspaceContent.classList.add('active');

                // Load working directory
                fileBrowser.loadWorkingDirectory();
                updateRagStatus();
            }
        });
    }

    // RAG Index Files Button - handled by setupRagEventListeners() (called on init + settings save)

    // RAG Clear Database Button
    if (clearDbBtn) {
        clearDbBtn.addEventListener('click', async () => {
            if (!confirm('Clear entire RAG database?\n\nThis will delete all indexed documents and cannot be undone.')) {
                return;
            }

            try {
                clearDbBtn.disabled = true;
                const originalText = clearDbBtn.textContent;
                clearDbBtn.textContent = 'Clearing...';

                const result = await ipcRenderer.invoke('rag-clear');

                if (result.success) {
                    ragStatus.textContent = result.message || 'Database cleared';
                    ragStatus.style.color = 'var(--text-secondary)';
                    await updateRagStatus(); // Refresh stats

                    // Clear active snapshots tracking
                    updateActiveSnapshotsStorage([]);
                    renderActiveSnapshotsList();
                } else {
                    ragStatus.textContent = 'Failed to clear database';
                    ragStatus.style.color = 'var(--error-color)';
                }

                clearDbBtn.textContent = originalText;
                clearDbBtn.disabled = false;
            } catch (error) {
                console.error('Failed to clear database:', error);
                ragStatus.textContent = 'Error clearing database';
                ragStatus.style.color = 'var(--error-color)';
                clearDbBtn.disabled = false;
            }
        });
    }

    // ============================================================================
    // RAG SNAPSHOT MANAGEMENT - Event Handlers
    // ============================================================================

    // Modal Elements
    const saveSnapshotModal = document.getElementById('save-snapshot-modal');
    const loadSnapshotModal = document.getElementById('load-snapshot-modal');
    const manageSnapshotsModal = document.getElementById('manage-snapshots-modal');

    // Button Elements
    const saveSnapshotBtn = document.getElementById('save-snapshot-btn');
    const loadSnapshotBtn = document.getElementById('load-snapshot-btn');
    const manageSnapshotsBtn = document.getElementById('manage-snapshots-btn');
    const clearActiveSnapshotBtn = document.getElementById('clear-active-snapshot-btn');

    // Active Snapshot Indicator
    const activeSnapshotIndicator = document.getElementById('active-snapshot-indicator');
    const activeSnapshotNameSpan = document.getElementById('active-snapshot-name');

    // Global state for active snapshot
    let activeSnapshotConfig = null;

    /**
     * Show active snapshot indicator
     */
    function showActiveSnapshotIndicator(snapshotName) {
        if (activeSnapshotIndicator && activeSnapshotNameSpan) {
            activeSnapshotNameSpan.textContent = snapshotName;
            activeSnapshotIndicator.style.display = 'block';
        }
    }

    /**
     * Hide active snapshot indicator
     */
    function hideActiveSnapshotIndicator() {
        if (activeSnapshotIndicator) {
            activeSnapshotIndicator.style.display = 'none';
        }
    }

    /**
     * Lock RAG settings when snapshot is active
     */
    function lockRagSettings(locked) {
        // Embedding model is now hardcoded for dual-embedding (no UI control to lock)
        const rerankerSelect = document.getElementById('reranker-model-select');

        if (rerankerSelect) {
            rerankerSelect.disabled = locked;
        }

        // Also disable chunking and search sliders
        const chunkSizeSlider = document.getElementById('chunk-size-slider');
        const chunkOverlapSlider = document.getElementById('chunk-overlap-slider');
        const retrieveTopKSlider = document.getElementById('retrieve-topk-slider');
        const rerankTopNSlider = document.getElementById('rerank-topn-slider');
        const semanticChunkingToggle = document.getElementById('semantic-chunking-toggle');
        const useRerankingToggle = document.getElementById('use-reranking-toggle');

        if (chunkSizeSlider) chunkSizeSlider.disabled = locked;
        if (chunkOverlapSlider) chunkOverlapSlider.disabled = locked;
        if (retrieveTopKSlider) retrieveTopKSlider.disabled = locked;
        if (rerankTopNSlider) rerankTopNSlider.disabled = locked;
        if (semanticChunkingToggle) semanticChunkingToggle.disabled = locked;
        if (useRerankingToggle) useRerankingToggle.disabled = locked;
    }

    /**
     * Check active snapshot on startup
     */
    async function checkActiveSnapshot() {
        try {
            const activeSnapshot = await ipcRenderer.invoke('rag-get-active-snapshot');
            if (activeSnapshot && activeSnapshot.activeSnapshot) {
                showActiveSnapshotIndicator(activeSnapshot.activeSnapshot);
                activeSnapshotConfig = activeSnapshot.config;
                lockRagSettings(true);
                console.log(`📦 Active snapshot detected: ${activeSnapshot.activeSnapshot}`);
            }
        } catch (error) {
            console.error('Failed to check active snapshot:', error);
        }
    }

    // Clear Active Snapshot Button
    if (clearActiveSnapshotBtn) {
        clearActiveSnapshotBtn.addEventListener('click', async () => {
            try {
                // Clear tracking by calling clearDatabase then reload
                hideActiveSnapshotIndicator();
                activeSnapshotConfig = null;
                lockRagSettings(false);
                console.log('✅ Active snapshot cleared (settings unlocked)');
            } catch (error) {
                console.error('Failed to clear active snapshot:', error);
                alert('Error clearing active snapshot: ' + error.message);
            }
        });
    }

    // Save Snapshot Button - Open Modal
    if (saveSnapshotBtn) {
        saveSnapshotBtn.addEventListener('click', async () => {
            // Load current stats
            try {
                const stats = await ipcRenderer.invoke('rag-stats');
                const currentChunksSpan = document.getElementById('current-chunks-count');
                const settings = settingsManager.getSettings();

                // Update chunks count
                if (currentChunksSpan) {
                    currentChunksSpan.textContent = stats.count || 0;
                }

                // Update embedding models display dynamically
                const codeModelSpan = document.getElementById('snapshot-code-model');
                const textModelSpan = document.getElementById('snapshot-text-model');
                const codeModelContainer = document.getElementById('snapshot-code-model-container');
                const textModelContainer = document.getElementById('snapshot-text-model-container');

                const embeddingMode = settings.ragConfig?.embeddingMode || 'auto';
                const codeModel = settings.ragConfig?.codeEmbeddingModel || '-';
                const textModel = settings.ragConfig?.textEmbeddingModel || '-';

                // Show/hide model displays based on embedding mode
                if (embeddingMode === 'manual-text') {
                    // Text-only mode
                    if (textModelSpan) textModelSpan.textContent = textModel;
                    if (textModelContainer) textModelContainer.style.display = 'block';
                    if (codeModelContainer) codeModelContainer.style.display = 'none';
                } else if (embeddingMode === 'manual-code') {
                    // Code-only mode
                    if (codeModelSpan) codeModelSpan.textContent = codeModel;
                    if (codeModelContainer) codeModelContainer.style.display = 'block';
                    if (textModelContainer) textModelContainer.style.display = 'none';
                } else {
                    // Auto mode - show both
                    if (codeModelSpan) codeModelSpan.textContent = codeModel;
                    if (textModelSpan) textModelSpan.textContent = textModel;
                    if (codeModelContainer) codeModelContainer.style.display = 'block';
                    if (textModelContainer) textModelContainer.style.display = 'block';
                }

                if (stats.count === 0) {
                    alert('Database is empty. Index some documents first.');
                    return;
                }

                // Show modal
                if (saveSnapshotModal) {
                    saveSnapshotModal.classList.add('show');
                }
            } catch (error) {
                console.error('Failed to load stats:', error);
                alert('Error loading database stats: ' + error.message);
            }
        });
    }

    // Save Snapshot Confirm Button
    const saveSnapshotConfirmBtn = document.getElementById('save-snapshot-confirm-btn');
    const saveSnapshotCancelBtn = document.getElementById('save-snapshot-cancel-btn');
    const snapshotNameInput = document.getElementById('snapshot-name-input');
    const autoTimestampCheckbox = document.getElementById('auto-timestamp-checkbox');

    // Enable Enter key to submit snapshot
    if (snapshotNameInput) {
        snapshotNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.keyCode === 13) {
                e.preventDefault();
                if (saveSnapshotConfirmBtn && !saveSnapshotConfirmBtn.disabled) {
                    saveSnapshotConfirmBtn.click();
                }
            }
        });
    }

    if (saveSnapshotConfirmBtn) {
        saveSnapshotConfirmBtn.addEventListener('click', async () => {
            const name = snapshotNameInput ? snapshotNameInput.value.trim() : '';
            if (!name) {
                alert('Please enter a snapshot name.');
                return;
            }

            const autoTimestamp = autoTimestampCheckbox ? autoTimestampCheckbox.checked : false;

            try {
                saveSnapshotConfirmBtn.disabled = true;
                saveSnapshotConfirmBtn.textContent = 'Saving...';

                const result = await ipcRenderer.invoke('rag-save-snapshot', { name, autoTimestamp });

                if (result.success) {
                    alert(`Snapshot saved: ${result.name}\n\n${result.message}`);
                    if (saveSnapshotModal) saveSnapshotModal.classList.remove('show');
                    if (snapshotNameInput) snapshotNameInput.value = '';
                } else {
                    alert(`Failed to save snapshot:\n\n${result.error}`);
                }
            } catch (error) {
                console.error('Failed to save snapshot:', error);
                alert('Error saving snapshot: ' + error.message);
            } finally {
                if (saveSnapshotConfirmBtn) {
                    saveSnapshotConfirmBtn.disabled = false;
                    saveSnapshotConfirmBtn.textContent = 'Save Snapshot';
                }
            }
        });
    }

    if (saveSnapshotCancelBtn) {
        saveSnapshotCancelBtn.addEventListener('click', () => {
            if (saveSnapshotModal) saveSnapshotModal.classList.remove('show');
            if (snapshotNameInput) snapshotNameInput.value = '';
        });
    }

    // Load Snapshot Button - Open Modal and populate list
    let selectedSnapshotName = null;

    if (loadSnapshotBtn) {
        loadSnapshotBtn.addEventListener('click', async () => {
            try {
                const snapshots = await ipcRenderer.invoke('rag-list-snapshots');
                const snapshotList = document.getElementById('snapshot-list');
                const noSnapshotsMessage = document.getElementById('no-snapshots-message');

                if (!snapshotList) return;

                snapshotList.innerHTML = '';
                selectedSnapshotName = null;

                // Reset button states
                const loadBtn = document.getElementById('load-snapshot-confirm-btn');
                const appendBtn = document.getElementById('append-snapshot-btn');
                if (loadBtn) loadBtn.disabled = true;
                if (appendBtn) appendBtn.disabled = true;

                // Filter out active snapshots to avoid duplicates in the main list
                const activeSnapshots = getActiveSnapshotsFromStorage();
                const activeSnapshotNames = activeSnapshots.map(s => s.name);
                const availableSnapshots = snapshots.filter(s => !activeSnapshotNames.includes(s.name));

                if (availableSnapshots.length === 0) {
                    if (noSnapshotsMessage) {
                        // Distinguish between "no snapshots exist" and "all snapshots already active"
                        if (snapshots.length === 0) {
                            noSnapshotsMessage.textContent = 'No snapshots available. Create one first.';
                        } else {
                            noSnapshotsMessage.textContent = 'All available snapshots are already loaded in the database.';
                        }
                        noSnapshotsMessage.style.display = 'block';
                    }
                } else {
                    if (noSnapshotsMessage) noSnapshotsMessage.style.display = 'none';

                    for (const snapshot of availableSnapshots) {
                        // Check compatibility
                        const compat = await ipcRenderer.invoke('rag-check-snapshot-compatibility', { name: snapshot.name });

                        const item = document.createElement('div');
                        item.className = 'snapshot-list-item';
                        item.dataset.snapshotName = snapshot.name;

                        const compatBadge = compat.compatible
                            ? '<span style="color: #98c379; font-size: 11px; margin-left: 8px;">✓ Compatible</span>'
                            : '<span style="color: #e06c75; font-size: 11px; margin-left: 8px;">⚠ Incompatible</span>';

                        const savedDate = new Date(snapshot.savedAt).toLocaleString();

                        item.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                <div>
                                    <div style="font-weight: 500; margin-bottom: 4px;">${snapshot.name}${compatBadge}</div>
                                    <div style="font-size: 12px; color: var(--text-secondary);">
                                        Saved: ${savedDate}<br>
                                        Chunks: ${snapshot.chunks} | Model: ${snapshot.embeddingModel} (${snapshot.vectorDimension}D)
                                    </div>
                                    ${!compat.compatible && compat.issues.length > 0 ? `
                                        <div style="font-size: 11px; color: #e06c75; margin-top: 4px;">
                                            ${compat.issues.join('<br>')}
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        `;

                        if (!compat.compatible) {
                            item.style.opacity = '0.6';
                            item.style.cursor = 'not-allowed';
                        } else {
                            item.addEventListener('click', () => {
                                // Deselect all
                                document.querySelectorAll('.snapshot-list-item').forEach(el => {
                                    el.classList.remove('selected');
                                });

                                // Select this one
                                item.classList.add('selected');
                                selectedSnapshotName = snapshot.name;

                                // Enable both load and append buttons when snapshot selected
                                const loadConfirmBtn = document.getElementById('load-snapshot-confirm-btn');
                                const appendBtn = document.getElementById('append-snapshot-btn');
                                if (loadConfirmBtn) loadConfirmBtn.disabled = false;
                                if (appendBtn) appendBtn.disabled = false;
                            });
                        }

                        snapshotList.appendChild(item);
                    }
                }

                // Aktualisiere Active Snapshots Liste
                renderActiveSnapshotsList();

                if (loadSnapshotModal) loadSnapshotModal.classList.add('show');
            } catch (error) {
                console.error('Failed to load snapshots:', error);
                alert('Error loading snapshots: ' + error.message);
            }
        });
    }

    // Load Snapshot Confirm Button
    const loadSnapshotConfirmBtn = document.getElementById('load-snapshot-confirm-btn');
    const loadSnapshotCancelBtn = document.getElementById('load-snapshot-cancel-btn');

    if (loadSnapshotConfirmBtn) {
        loadSnapshotConfirmBtn.addEventListener('click', async () => {
            if (!selectedSnapshotName) {
                alert('Please select a snapshot to load.');
                return;
            }

            try {
                loadSnapshotConfirmBtn.disabled = true;
                loadSnapshotConfirmBtn.textContent = 'Loading...';

                const result = await ipcRenderer.invoke('rag-load-snapshot', { name: selectedSnapshotName });

                if (result.success) {
                    alert(`Snapshot loaded: ${result.name}\n\n${result.message}`);
                    if (loadSnapshotModal) loadSnapshotModal.classList.remove('show');
                    selectedSnapshotName = null;

                    // Reset button states
                    const appendBtn = document.getElementById('append-snapshot-btn');
                    if (appendBtn) appendBtn.disabled = true;

                    // Refresh RAG status
                    await updateRagStatus();
                } else {
                    alert(`Failed to load snapshot:\n\n${result.error}`);
                }
            } catch (error) {
                console.error('Failed to load snapshot:', error);
                alert('Error loading snapshot: ' + error.message);
            } finally {
                if (loadSnapshotConfirmBtn) loadSnapshotConfirmBtn.disabled = true;
                const appendBtn = document.getElementById('append-snapshot-btn');
                if (appendBtn) appendBtn.disabled = true;
            }
        });
    }

    if (loadSnapshotCancelBtn) {
        loadSnapshotCancelBtn.addEventListener('click', () => {
            if (loadSnapshotModal) loadSnapshotModal.classList.remove('show');
            selectedSnapshotName = null;

            // Reset button states
            const loadBtn = document.getElementById('load-snapshot-confirm-btn');
            const appendBtn = document.getElementById('append-snapshot-btn');
            if (loadBtn) loadBtn.disabled = true;
            if (appendBtn) appendBtn.disabled = true;
        });
    }

    // Clear RAG Database Button (in RAG Configuration section)
    const clearRagBtn = document.getElementById('clear-rag-btn');
    if (clearRagBtn) {
        clearRagBtn.addEventListener('click', async () => {
            if (!confirm('Clear entire RAG database?\n\nThis will delete all indexed documents and cannot be undone.')) {
                return;
            }

            const originalText = clearRagBtn.textContent;

            try {
                clearRagBtn.disabled = true;
                clearRagBtn.textContent = 'Clearing...';

                const result = await ipcRenderer.invoke('rag-clear');

                if (result.success) {
                    // Clear active snapshots tracking
                    updateActiveSnapshotsStorage([]);
                    renderActiveSnapshotsList();

                    await updateRagStatus();
                    alert(`RAG database cleared successfully.\n\n${result.message}`);
                } else {
                    alert(`Failed to clear database:\n\n${result.error}`);
                }
            } catch (error) {
                console.error('Failed to clear database:', error);
                alert('Error clearing database: ' + error.message);
            } finally {
                clearRagBtn.textContent = originalText;
                clearRagBtn.disabled = false;
            }
        });
    }

    // Manage Snapshots Button - Open Modal
    if (manageSnapshotsBtn) {
        manageSnapshotsBtn.addEventListener('click', async () => {
            try {
                const snapshots = await ipcRenderer.invoke('rag-list-snapshots');
                const manageSnapshotList = document.getElementById('manage-snapshot-list');
                const noSnapshotsManageMessage = document.getElementById('no-snapshots-manage-message');

                if (!manageSnapshotList) return;

                manageSnapshotList.innerHTML = '';

                if (snapshots.length === 0) {
                    if (noSnapshotsManageMessage) noSnapshotsManageMessage.style.display = 'block';
                } else {
                    if (noSnapshotsManageMessage) noSnapshotsManageMessage.style.display = 'none';

                    for (const snapshot of snapshots) {
                        const item = document.createElement('div');
                        item.className = 'snapshot-list-item';
                        item.style.padding = '12px';

                        const savedDate = new Date(snapshot.savedAt).toLocaleString();

                        item.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                <div style="flex: 1;">
                                    <div style="font-weight: 500; margin-bottom: 6px;">${snapshot.name}</div>
                                    <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
                                        <strong>Saved:</strong> ${savedDate}<br>
                                        <strong>Chunks:</strong> ${snapshot.chunks}<br>
                                        <strong>Embedding Model:</strong> ${snapshot.embeddingModel}<br>
                                        <strong>Vector Dimension:</strong> ${snapshot.vectorDimension}D
                                    </div>
                                </div>
                                <button class="btn-secondary" data-snapshot-name="${snapshot.name}" style="background: #e06c75; border-color: #e06c75; color: white; padding: 6px 12px; font-size: 12px;">
                                    Delete
                                </button>
                            </div>
                        `;

                        // Delete button handler
                        const deleteBtn = item.querySelector('button');
                        if (deleteBtn) {
                            deleteBtn.addEventListener('click', async (e) => {
                                e.stopPropagation();
                                const snapshotName = deleteBtn.dataset.snapshotName;

                                if (!confirm(`Delete snapshot "${snapshotName}"?\n\nThis cannot be undone.`)) {
                                    return;
                                }

                                try {
                                    const result = await ipcRenderer.invoke('rag-delete-snapshot', { name: snapshotName });

                                    if (result.success) {
                                        item.remove();
                                        if (manageSnapshotList.children.length === 0) {
                                            if (noSnapshotsManageMessage) noSnapshotsManageMessage.style.display = 'block';
                                        }
                                    } else {
                                        alert(`Failed to delete snapshot:\n\n${result.error}`);
                                    }
                                } catch (error) {
                                    console.error('Failed to delete snapshot:', error);
                                    alert('Error deleting snapshot: ' + error.message);
                                }
                            });
                        }

                        manageSnapshotList.appendChild(item);
                    }
                }

                if (manageSnapshotsModal) manageSnapshotsModal.classList.add('show');
            } catch (error) {
                console.error('Failed to load snapshots:', error);
                alert('Error loading snapshots: ' + error.message);
            }
        });
    }

    // Manage Snapshots Close Button
    const manageSnapshotsCloseBtn = document.getElementById('manage-snapshots-close-btn');
    if (manageSnapshotsCloseBtn) {
        manageSnapshotsCloseBtn.addEventListener('click', () => {
            if (manageSnapshotsModal) manageSnapshotsModal.classList.remove('show');
        });
    }

    // Handle snapshot-loaded event from main process (after successful load)
    ipcRenderer.on('snapshot-loaded', async (event, { name, config }) => {
        console.log(`📦 Snapshot loaded event received: ${name}`);

        // Update active snapshot indicator
        showActiveSnapshotIndicator(name);
        activeSnapshotConfig = config;

        // FORCE-UPDATE settings in localStorage
        const currentSettings = settingsManager.getSettings();
        currentSettings.ragConfig = {
            ...currentSettings.ragConfig,
            embeddingModel: config.embeddingModel,
            rerankerModel: config.rerankerModel || '',
            chunkSize: config.chunkSize,
            chunkOverlap: config.chunkOverlap,
            semanticChunking: config.semanticChunking,
            retrieveTopK: config.retrieveTopK,
            rerankTopN: config.rerankTopN,
            useReranking: config.useReranking,
            toolIntegrationEnabled: config.toolIntegrationEnabled,
            toolDefaultLimit: config.toolDefaultLimit
        };
        settingsManager.saveSettings(currentSettings);

        // Close settings modal if open (prevent user from overwriting settings)
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal && settingsModal.classList.contains('show')) {
            settingsModal.classList.remove('show');
        }

        // Refresh UI to show updated settings
        settingsManager.applySettingsToUI();

        // Refresh RAG model dropdowns
        if (typeof populateRagModelDropdowns === 'function') {
            await populateRagModelDropdowns();
        }

        // Lock RAG settings
        lockRagSettings(true);

        console.log('✅ Settings synchronized and locked to match snapshot');
    });

    // Check active snapshot on startup
    checkActiveSnapshot();

    // === ACTIVE SNAPSHOTS MANAGEMENT ===
    // Note: Functions moved to global scope (lines 792-853)

    // Append Snapshot Button Event Listener
    const appendSnapshotBtn = document.getElementById('append-snapshot-btn');
    if (appendSnapshotBtn) {
        appendSnapshotBtn.addEventListener('click', async () => {
            if (!selectedSnapshotName) {
                alert('Please select a snapshot to append.');
                return;
            }

            try {
                appendSnapshotBtn.disabled = true;
                const originalText = appendSnapshotBtn.textContent;
                appendSnapshotBtn.textContent = 'Appending...';

                const result = await ipcRenderer.invoke('rag-append-snapshot', selectedSnapshotName);

                if (result.success) {
                    let message = result.message;
                    if (result.warning) {
                        message += '\n\n' + result.warning;
                    }

                    alert(message);

                    // Update active snapshots list
                    const activeSnapshots = getActiveSnapshotsFromStorage();
                    activeSnapshots.push({
                        name: selectedSnapshotName,
                        loadedAt: Date.now(),
                        fileCount: result.filesAdded,
                        model: 'N/A' // Will be updated by backend event
                    });
                    updateActiveSnapshotsStorage(activeSnapshots);
                    renderActiveSnapshotsList();

                    // Close modal
                    const modal = document.getElementById('load-snapshot-modal');
                    if (modal) modal.classList.remove('show');

                    // Reset selection and button states
                    selectedSnapshotName = null;
                    appendSnapshotBtn.disabled = true;

                } else {
                    alert('Failed to append snapshot:\n\n' + result.error);
                }

                appendSnapshotBtn.textContent = originalText;
                appendSnapshotBtn.disabled = false;

            } catch (error) {
                console.error('Failed to append snapshot:', error);
                alert('Error appending snapshot: ' + error.message);
                appendSnapshotBtn.disabled = false;
            }
        });
    }

    // Listen for snapshot-appended event from main process
    ipcRenderer.on('snapshot-appended', async (event, { name, filesAdded, duplicatesSkipped }) => {
        console.log(`📦 Snapshot appended event received: ${name}`);
        console.log(`   Files added: ${filesAdded}, Duplicates skipped: ${duplicatesSkipped}`);

        // Refresh active snapshots display
        renderActiveSnapshotsList();

        // Refresh RAG stats
        if (typeof updateRagStatus === 'function') {
            await updateRagStatus();
        }
    });

    // Initialize active snapshots display
    renderActiveSnapshotsList();

    // Clear active snapshots when database is cleared
    const originalClearHandler = window.clearDatabase;
    window.clearDatabase = async function() {
        if (originalClearHandler) {
            const result = await originalClearHandler();
            if (result && result.success) {
                updateActiveSnapshotsStorage([]);
                renderActiveSnapshotsList();
            }
            return result;
        }
    };
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Set Ollama endpoint from settings
    const settings = settingsManager.getSettings();
    if (settings.ollamaEndpoint) {
        ollamaClient.setOllamaEndpoint(settings.ollamaEndpoint);
    }

    // Always configure RAG Manager with saved settings (even if disabled)
    // This ensures settings are preserved when RAG is later enabled
    if (settings.ragConfig) {
        const ragEndpointToUse = settings.ragEndpoint || settings.ollamaEndpoint;

        // Send complete ragConfig to rag-manager (includes useReranking, rerankerModel, etc.)
        ipcRenderer.invoke('rag-set-config', settings.ragConfig);

        // Set endpoint separately (for legacy compatibility)
        ipcRenderer.invoke('rag-set-endpoint', ragEndpointToUse);

        console.log('🔧 RAG Manager configured:', {
            endpoint: ragEndpointToUse,
            enabled: settings.ragEnabled,
            embeddingSystem: 'Dual-Embedding (jina-embeddings-v2-base-code + nomic-embed-text)',
            rerankerModel: settings.ragConfig.rerankerModel,
            useReranking: settings.ragConfig.useReranking,
            retrieveTopK: settings.ragConfig.retrieveTopK,
            rerankTopN: settings.ragConfig.rerankTopN
        });
    }

    // Log RAG enabled status
    if (!settings.ragEnabled) {
        console.log('⚠️ RAG is disabled - skipping RAG Manager configuration');
    }

    // Dual-embedding is now hardcoded - no validation needed

    // Initialize pin-manager with token encoder
    const tokenEncoder = ollamaClient.getTokenEncoder();
    if (tokenEncoder) {
        pinManager.setTokenEncoder(tokenEncoder);
        console.log('📌 Pin Manager initialized with token encoder');
    }

    // Load pinned messages from localStorage and update panel
    updatePinnedPanel();

    // Update RAG button states based on settings
    updateRagButtonStates();

    // Setup RAG event listeners (with stop button support)
    setupRagEventListeners();

    // Initialize chat history manager
    chatHistoryManager.initialize();

    // Load models and check connection
    ollamaClient.loadModels().then(() => {
        // Update context slider for initial model selection
        const initialModel = ollamaClient.getCurrentModel();
        updateContextSliderForModel(initialModel);

        // Populate RAG model dropdowns after main models are loaded
        populateRagModelDropdowns();
    });
    ollamaClient.checkOllamaConnection();

    // Setup all event listeners
    setupEventListeners();
    settingsManager.setupSettingsListeners();

    // Inject loadModels callback for auto-reload on settings modal open
    settingsManager.setLoadModelsCallback(ollamaClient.loadModels);

    // Inject updateContextSlider callback for updating slider max on settings modal open
    settingsManager.setUpdateContextSliderCallback(() => {
        const currentModel = ollamaClient.getCurrentModel();
        updateContextSliderForModel(currentModel);
    });

    // Expose messageRenderer module for ollama-client agent loop
    window.messageRendererModule = messageRenderer;

    fileBrowser.setupFileBrowserListeners();

    // Apply UI settings on startup
    settingsManager.applyUISettings();

    // Populate UI controls with saved settings values
    settingsManager.applySettingsToUI();

    // Set code mode toggle as active (codeModeEnabled = true by default)
    codeModeToggle.classList.add('active');

    // Load saved Tool mode state
    const savedToolMode = localStorage.getItem('ollmini-tool-enabled');
    if (savedToolMode === 'false') {
        codeModeEnabled = false;
        codeModeToggle.classList.remove('active');
        console.log('🔧 Restored Tool mode: DISABLED');
    } else {
        // Default is true (already set)
        console.log('🔧 Restored Tool mode: ENABLED');
    }

    // Load saved WebSearch mode state
    const savedWebSearchMode = localStorage.getItem('ollmini-websearch-enabled');
    if (savedWebSearchMode === 'true') {
        webSearchModeEnabled = true;
        const webSearchToggle = document.getElementById('webSearchModeToggle');
        if (webSearchToggle) {
            webSearchToggle.classList.add('active');
        }
        console.log('🌐 Restored WebSearch mode: ENABLED');
    }

    // Load saved thinking level
    const thinkingSwitch = document.getElementById('thinkingSwitch');
    if (settings.thinkingLevel && thinkingSwitch) {
        currentThinkingLevel = settings.thinkingLevel;
        thinkingSwitch.setAttribute('data-level', currentThinkingLevel);
        thinkingSwitch.querySelector('.thinking-level').textContent = currentThinkingLevel;
    }

    // Load saved pinned sidebar collapsed state
    const savedCollapsedState = localStorage.getItem('pinned-sidebar-collapsed');
    if (savedCollapsedState === 'true') {
        pinnedSidebar.classList.add('collapsed');
        pinnedSidebarToggle.classList.add('collapsed');
        console.log('📌 Restored pinned sidebar state: collapsed');
    }
});

// Load working directory when workspace tab is opened
const workspaceTab = document.querySelector('[data-tab="workspace"]');
if (workspaceTab) {
    workspaceTab.addEventListener('click', () => {
        fileBrowser.loadWorkingDirectory();
        updateRagStatus(); // Update RAG stats when workspace tab is opened
    });
}

// Listen for dashboard state request from main process
ipcRenderer.on('request-dashboard-state', () => {
    // Send current token state
    const contextLimitValue = settingsManager.modelSettings.num_ctx || 30000;
    const actualHistoryLength = totalInputTokens + totalOutputTokens; // Simplified approximation

    ipcRenderer.send('broadcast-token-update', {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        contextLimit: contextLimitValue,
        contextUsage: actualHistoryLength,
        contextPercentage: Math.round((actualHistoryLength / contextLimitValue) * 100)
    });

    // Send current RAG analytics
    broadcastRagAnalytics();
});

// Listen for RAG indexing progress updates
ipcRenderer.on('rag-index-progress', (event, progressData) => {
    const { phase, fileIndex, totalFiles, fileName, fileSize, chunkIndex, totalChunks, chunks, error } = progressData;

    if (phase === 'chunking') {
        ragStatus.textContent = `Chunking file ${fileIndex}/${totalFiles}: ${fileName} (${fileSize})...`;
        ragStatus.style.color = 'var(--text-secondary)';
    } else if (phase === 'embedding') {
        ragStatus.textContent = `Embedding file ${fileIndex}/${totalFiles}, chunk ${chunkIndex}/${totalChunks}...`;
        ragStatus.style.color = 'var(--text-secondary)';

        // Update timer with ETA (based on completed files)
        updateIndexingTimer(fileIndex - 1, totalFiles);
    } else if (phase === 'completed') {
        ragStatus.textContent = `Completed file ${fileIndex}/${totalFiles}: ${fileName} (${chunks} chunks)`;
        ragStatus.style.color = '#98c379'; // Green

        // Update timer with ETA calculation
        updateIndexingTimer(fileIndex, totalFiles);
    } else if (phase === 'error') {
        ragStatus.textContent = `Error in file ${fileIndex}/${totalFiles}: ${fileName}`;
        ragStatus.style.color = 'var(--error-color)';
        console.error(`RAG indexing error for ${fileName}:`, error);
    }
});
