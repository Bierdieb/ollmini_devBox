// Pin Manager Module
// Handles pinned messages state management, context usage calculation, and archiving

const { ipcRenderer } = require('electron');

// Pin State
let pinnedMessages = [];
const MAX_PINNED = 5;
const MAX_CONTEXT_PERCENT = 80;
const AUTO_ARCHIVE_AFTER_MESSAGES = 50;

// Token Encoder (injected from ollama-client)
let tokenEncoder = null;

// Settings (injected)
let modelSettings = {
    num_ctx: 4096
};

// Set token encoder
function setTokenEncoder(encoder) {
    tokenEncoder = encoder;
}

// Set model settings
function setModelSettings(settings) {
    modelSettings = settings;
}

// Load pins from localStorage
function loadPins() {
    try {
        const saved = localStorage.getItem('ollmini-devbox-pins');
        if (saved) {
            pinnedMessages = JSON.parse(saved);
            console.log(`📌 Loaded ${pinnedMessages.length} pinned messages from storage`);
        }
    } catch (error) {
        console.error('Failed to load pins:', error);
        pinnedMessages = [];
    }
}

// Save pins to localStorage
function savePins() {
    try {
        localStorage.setItem('ollmini-devbox-pins', JSON.stringify(pinnedMessages));
        console.log(`💾 Saved ${pinnedMessages.length} pinned messages to storage`);
    } catch (error) {
        console.error('Failed to save pins:', error);
    }
}

// Estimate tokens in text
function estimateTokens(text) {
    if (!tokenEncoder) {
        // Fallback: ~4 characters per token
        return Math.ceil(text.length / 4);
    }

    try {
        return tokenEncoder.encode(text).length;
    } catch (error) {
        console.error('Token encoding error:', error);
        return Math.ceil(text.length / 4);
    }
}

// Calculate pinned tokens
function calculatePinnedTokens() {
    return pinnedMessages.reduce((sum, pin) => sum + (pin.tokens || 0), 0);
}

// Get context usage
function getContextUsage(historyTokens = 0) {
    const pinnedTokens = calculatePinnedTokens();
    const total = pinnedTokens + historyTokens;
    const limit = modelSettings.num_ctx || 4096;
    const percent = Math.round((total / limit) * 100);

    return {
        pinnedTokens,
        historyTokens,
        total,
        limit,
        percent,
        isWarning: percent > 60,
        isCritical: percent > 80
    };
}

// Pin message
function pinMessage(messageId, role, content, messageAge = 0) {
    // Check if already pinned
    if (pinnedMessages.some(p => p.id === messageId)) {
        console.log('📌 Message already pinned:', messageId);
        return { success: false, reason: 'already_pinned' };
    }

    // Check max pins
    if (pinnedMessages.length >= MAX_PINNED) {
        console.log(`📌 Max pins (${MAX_PINNED}) reached. Cannot pin more.`);
        return { success: false, reason: 'max_reached' };
    }

    const tokens = estimateTokens(content);

    const pin = {
        id: messageId,
        role: role,
        content: content,
        tokens: tokens,
        pinnedAt: Date.now(),
        messageAge: messageAge,
        tags: []
    };

    pinnedMessages.push(pin);
    savePins();

    console.log(`📌 Pinned message ${messageId} (${tokens} tokens, ${role})`);

    return { success: true, pin };
}

// Unpin message
function unpinMessage(messageId) {
    const index = pinnedMessages.findIndex(p => p.id === messageId);

    if (index === -1) {
        console.log('📌 Message not found in pins:', messageId);
        return { success: false, reason: 'not_found' };
    }

    const removed = pinnedMessages.splice(index, 1)[0];
    savePins();

    console.log(`🗑️ Unpinned message ${messageId}`);

    return { success: true, pin: removed };
}

// Archive pin to RAG
async function archivePinToRAG(messageId) {
    const pin = pinnedMessages.find(p => p.id === messageId);

    if (!pin) {
        console.log('📌 Pin not found for archiving:', messageId);
        return { success: false, reason: 'not_found' };
    }

    try {
        // Index in RAG with priority metadata
        const result = await ipcRenderer.invoke('rag-index-pin', {
            text: pin.content,
            metadata: {
                type: pin.role === 'user' ? 'pinned_user' : 'pinned_assistant',
                priority: 'high',
                scoreBoost: 0.5,
                pinnedAt: pin.pinnedAt,
                tags: pin.tags || [],
                originalMessageId: pin.id
            }
        });

        if (result.success) {
            // Remove from context window
            unpinMessage(messageId);

            console.log(`🗄️ Archived pin ${messageId} to RAG with high priority`);

            return { success: true, result };
        } else {
            console.error('Failed to archive pin to RAG:', result.error);
            return { success: false, reason: 'rag_error', error: result.error };
        }
    } catch (error) {
        console.error('Error archiving pin to RAG:', error);
        return { success: false, reason: 'exception', error: error.message };
    }
}

// Get pinned messages
function getPinnedMessages() {
    return pinnedMessages;
}

// Get pinned messages count
function getPinnedCount() {
    return pinnedMessages.length;
}

// Check if message is pinned
function isPinned(messageId) {
    return pinnedMessages.some(p => p.id === messageId);
}

// Check auto-archive conditions
function checkAutoArchive(currentMessageCount) {
    const oldPins = pinnedMessages.filter(pin => {
        const age = currentMessageCount - pin.messageAge;
        return age > AUTO_ARCHIVE_AFTER_MESSAGES;
    });

    if (oldPins.length > 0) {
        console.log(`🔍 Found ${oldPins.length} pins older than ${AUTO_ARCHIVE_AFTER_MESSAGES} messages`);
        return {
            shouldArchive: true,
            pins: oldPins,
            reason: 'age'
        };
    }

    const usage = getContextUsage();
    if (usage.isCritical) {
        // Archive oldest pin
        const oldestPin = pinnedMessages.reduce((oldest, pin) =>
            !oldest || pin.pinnedAt < oldest.pinnedAt ? pin : oldest
        , null);

        if (oldestPin) {
            console.log(`🔍 Context critical (${usage.percent}%), oldest pin should be archived`);
            return {
                shouldArchive: true,
                pins: [oldestPin],
                reason: 'context_critical'
            };
        }
    }

    return { shouldArchive: false };
}

// Build conversation with pins
function buildConversationWithPins(conversationHistory) {
    if (pinnedMessages.length === 0) {
        return conversationHistory;
    }

    // CRITICAL: Ollama API does NOT allow multiple consecutive system messages
    // Merge all pinned messages into a SINGLE system message
    const combinedContent = pinnedMessages
        .map(pin => `[PINNED ${pin.role.toUpperCase()}] ${pin.content}`)
        .join('\n\n');

    // PHASE 4: DOUBLE CLEANUP - Remove metadata before returning
    // Create system message WITHOUT internal metadata fields
    // These fields would cause HTTP 400 if sent to Ollama API
    const singleSystemMessage = {
        role: 'system',
        content: combinedContent
        // NOTE: Intentionally NOT adding _pinned or _pinnedIds metadata
        // These are internal tracking fields that MUST NOT be sent to API
        // ollama-client.js will handle cleanup as safety net
    };

    // Put the single system message at the BEGINNING of the conversation
    // Ollama API REQUIRES system messages to come before user/assistant/tool messages
    return [
        singleSystemMessage,
        ...conversationHistory
    ];
}

// Clear all pins
function clearAllPins() {
    const count = pinnedMessages.length;
    pinnedMessages = [];
    savePins();
    console.log(`🗑️ Cleared all ${count} pins`);
    return { success: true, count };
}

// Initialize
loadPins();

module.exports = {
    setTokenEncoder,
    setModelSettings,
    pinMessage,
    unpinMessage,
    archivePinToRAG,
    getPinnedMessages,
    getPinnedCount,
    isPinned,
    getContextUsage,
    checkAutoArchive,
    buildConversationWithPins,
    clearAllPins,
    calculatePinnedTokens,
    MAX_PINNED,
    MAX_CONTEXT_PERCENT
};
