// Token Counter Module
// Provides accurate token counting using tiktoken library

const { encoding_for_model } = require('tiktoken');

// Token encoder instance
let tokenEncoder = null;

// Cumulative token totals
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalThinkingTokens = 0;
let totalContentTokens = 0;
let previousHistoryTokens = 0; // Track previous history length for delta calculation

// DOM References
let tokenCounter = null;
let tokenInput = null;
let tokenOutput = null;
let tokenTotal = null;
let tokenThinking = null;
let tokenContent = null;
let tokenThinkingPercent = null;
let tokenContentPercent = null;
let tokenBreakdown = null;
let contextUsed = null;
let contextLimit = null;
let contextPercent = null;
let contextProgressFill = null;

// Model settings (injected from settings-manager)
let modelSettings = {
    num_ctx: 4096
};

/**
 * Initialize tiktoken encoder for GPT-4 tokenization
 */
function initializeEncoder() {
    try {
        tokenEncoder = encoding_for_model('gpt-4');
        console.log('✅ Tiktoken encoder initialized (GPT-4)');
    } catch (error) {
        console.error('❌ Failed to load tiktoken encoder:', error);
    }
}

/**
 * Set DOM element references for token counter UI
 */
function setDOMReferences(refs) {
    tokenCounter = refs.tokenCounter;
    tokenInput = refs.tokenInput;
    tokenOutput = refs.tokenOutput;
    tokenTotal = refs.tokenTotal;
    tokenThinking = refs.tokenThinking;
    tokenContent = refs.tokenContent;
    tokenThinkingPercent = refs.tokenThinkingPercent;
    tokenContentPercent = refs.tokenContentPercent;
    tokenBreakdown = refs.tokenBreakdown;
    contextUsed = refs.contextUsed;
    contextLimit = refs.contextLimit;
    contextPercent = refs.contextPercent;
    contextProgressFill = refs.contextProgressFill;
}

/**
 * Inject model settings from settings-manager
 */
function setModelSettings(settings) {
    modelSettings = settings;
}

/**
 * Count tokens in a string using tiktoken
 * @param {string} text - Text to tokenize
 * @returns {number} Token count
 */
function countTokens(text) {
    if (!tokenEncoder) {
        console.warn('Tiktoken encoder not initialized');
        return 0;
    }

    if (!text || typeof text !== 'string') {
        return 0;
    }

    try {
        return tokenEncoder.encode(text).length;
    } catch (error) {
        console.error('Token encoding error:', error);
        return 0;
    }
}

/**
 * Count tokens in conversation history
 * @param {Array} conversationHistory - Array of message objects
 * @returns {number} Token count
 */
function countConversationTokens(conversationHistory) {
    if (!conversationHistory || conversationHistory.length === 0) {
        return 0;
    }

    const messagesString = JSON.stringify(conversationHistory);
    return countTokens(messagesString);
}

/**
 * Calculate token delta and update UI
 * @param {Array} conversationHistory - Current conversation history
 * @param {string} thinkingContent - Thinking content (if any)
 * @param {string} contentText - Regular content text
 */
function updateTokenCounter(conversationHistory, thinkingContent = '', contentText = '') {
    if (!tokenEncoder) {
        console.warn('Cannot update token counter: encoder not initialized');
        return;
    }

    // Count current conversation history length (BEFORE adding new assistant message)
    const currentHistoryTokens = countConversationTokens(conversationHistory);

    // Count output tokens: thinking + content
    const thinkingTokensCount = countTokens(thinkingContent);
    const contentTokensCount = countTokens(contentText);
    const outputTokensCount = thinkingTokensCount + contentTokensCount;

    // Calculate delta: only NEW tokens since last message
    // This will include the new user message + assistant response
    const deltaTokens = (currentHistoryTokens + outputTokensCount) - previousHistoryTokens;

    // Update cumulative totals with DELTA only
    totalInputTokens += deltaTokens;
    totalOutputTokens += outputTokensCount;
    totalThinkingTokens += thinkingTokensCount;
    totalContentTokens += contentTokensCount;

    // Format numbers with commas (German locale)
    const formatNum = (num) => num.toLocaleString('de-DE');

    // Update DOM elements
    if (tokenInput) tokenInput.textContent = formatNum(totalInputTokens);
    if (tokenOutput) tokenOutput.textContent = formatNum(totalOutputTokens);
    if (tokenTotal) tokenTotal.textContent = formatNum(totalInputTokens + totalOutputTokens);

    // Show token counter
    if (tokenCounter) tokenCounter.style.display = 'flex';

    // Update breakdown if thinking exists
    if (totalThinkingTokens > 0 || totalContentTokens > 0) {
        const thinkingPercent = totalOutputTokens > 0
            ? Math.round((totalThinkingTokens / totalOutputTokens) * 100)
            : 0;
        const contentPercent = totalOutputTokens > 0
            ? Math.round((totalContentTokens / totalOutputTokens) * 100)
            : 0;

        if (tokenThinking) tokenThinking.textContent = formatNum(totalThinkingTokens);
        if (tokenContent) tokenContent.textContent = formatNum(totalContentTokens);
        if (tokenThinkingPercent) tokenThinkingPercent.textContent = `(${thinkingPercent}%)`;
        if (tokenContentPercent) tokenContentPercent.textContent = `(${contentPercent}%)`;

        if (tokenBreakdown) tokenBreakdown.style.display = 'flex';
    }

    // Context Progress Bar Update - use ACTUAL conversation history length
    const contextLimitValue = modelSettings.num_ctx;
    const actualHistoryLength = currentHistoryTokens + outputTokensCount; // Current history + new response
    const percentUsed = Math.round((actualHistoryLength / contextLimitValue) * 100);

    if (contextUsed) contextUsed.textContent = formatNum(actualHistoryLength);
    if (contextLimit) contextLimit.textContent = formatNum(contextLimitValue);
    if (contextPercent) contextPercent.textContent = `(${percentUsed}%)`;

    // Update progress bar width
    if (contextProgressFill) {
        contextProgressFill.style.width = `${Math.min(percentUsed, 100)}%`;

        // Update progress bar color based on usage
        contextProgressFill.classList.remove('warning', 'danger');
        if (percentUsed >= 90) {
            contextProgressFill.classList.add('danger');
        } else if (percentUsed >= 70) {
            contextProgressFill.classList.add('warning');
        }
    }

    // Update previousHistoryTokens for next delta calculation
    previousHistoryTokens = currentHistoryTokens + outputTokensCount;

    console.log('📊 Token Counts (tiktoken):', {
        delta: deltaTokens,
        currentHistory: currentHistoryTokens,
        output: outputTokensCount,
        thinking: thinkingTokensCount,
        content: contentTokensCount,
        breakdown: `${thinkingTokensCount} + ${contentTokensCount} = ${outputTokensCount}`
    });
}

/**
 * Reset token counters (e.g., when clearing chat)
 */
function resetTokenCounters() {
    totalInputTokens = 0;
    totalOutputTokens = 0;
    totalThinkingTokens = 0;
    totalContentTokens = 0;
    previousHistoryTokens = 0;

    // Hide token counter
    if (tokenCounter) tokenCounter.style.display = 'none';

    console.log('🔄 Token counters reset');
}

/**
 * Get current token statistics
 * @returns {Object} Token statistics
 */
function getTokenStats() {
    return {
        totalInput: totalInputTokens,
        totalOutput: totalOutputTokens,
        totalThinking: totalThinkingTokens,
        totalContent: totalContentTokens,
        grandTotal: totalInputTokens + totalOutputTokens
    };
}

module.exports = {
    initializeEncoder,
    setDOMReferences,
    setModelSettings,
    countTokens,
    countConversationTokens,
    updateTokenCounter,
    resetTokenCounters,
    getTokenStats
};
