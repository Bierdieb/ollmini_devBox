// Chat History Manager Module
// Handles chat persistence, loading, and sidebar management

// Import central version configuration
const { APP_VERSION } = require('./config');

// =============================================================================
// SECURITY FUNCTIONS (Added 2025-10-24 - Phase 5B Security Hardening)
// =============================================================================

// Security Fix #6: Credential Sanitization for Chat History
// Removes credentials from messages before saving to localStorage
function sanitizeCredentials(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/P4PASSWD=[^\s]+/g, 'P4PASSWD=***')
        .replace(/-P\s+\w+/g, '-P ***')
        .replace(/password[=:]\s*\w+/gi, 'password=***')
        .replace(/passwd[=:]\s*\w+/gi, 'passwd=***')
        .replace(/AWS_SECRET_ACCESS_KEY=[^\s]+/gi, 'AWS_SECRET_ACCESS_KEY=***')
        .replace(/GH_TOKEN=[^\s]+/gi, 'GH_TOKEN=***');
}

function sanitizeMessageForStorage(message) {
    const sanitized = { ...message };

    // Sanitize content
    if (sanitized.content) {
        sanitized.content = sanitizeCredentials(sanitized.content);
    }

    // Sanitize tool calls (bash commands, etc.)
    if (sanitized.tool_calls) {
        sanitized.tool_calls = sanitized.tool_calls.map(tc => {
            const sanitizedTC = { ...tc };
            if (sanitizedTC.function && sanitizedTC.function.arguments) {
                const args = typeof sanitizedTC.function.arguments === 'string'
                    ? JSON.parse(sanitizedTC.function.arguments)
                    : sanitizedTC.function.arguments;

                if (args.command) {
                    args.command = sanitizeCredentials(args.command);
                }

                sanitizedTC.function.arguments = JSON.stringify(args);
            }
            return sanitizedTC;
        });
    }

    return sanitized;
}

// =============================================================================

// State Management
let sidebarOpen = true; // Default: sidebar open
let currentChatId = null;
let savedChats = [];

// DOM References (injected from renderer.js)
let sidebarToggle = null;
let newChatBtn = null;
let chatHistoryList = null;
let chatContainer = null;
let inputContainer = null;

// Settings Reference (injected from renderer.js)
let modelSettings = null;

// External Dependencies (injected from renderer.js)
let ollamaClient = null;
let messageRenderer = null;
let pinManager = null;

// Inject DOM References
function setDOMReferences(refs) {
    sidebarToggle = refs.sidebarToggle;
    newChatBtn = refs.newChatBtn;
    chatHistoryList = refs.chatHistoryList;
    chatContainer = refs.chatContainer;
    inputContainer = refs.inputContainer;
}

// Inject Settings
function setModelSettings(settings) {
    modelSettings = settings;
}

// Inject Module Dependencies
function setModuleDependencies(deps) {
    ollamaClient = deps.ollamaClient;
    messageRenderer = deps.messageRenderer;
    pinManager = deps.pinManager;
}

// Load sidebar state from localStorage
function loadSidebarState() {
    const saved = localStorage.getItem('sidebar-open');
    if (saved !== null) {
        sidebarOpen = JSON.parse(saved);
        const sidebar = document.querySelector('.left-sidebar');
        if (sidebar && !sidebarOpen) {
            sidebar.classList.add('closed');
        }
    }
}

// Toggle sidebar open/closed
function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    const sidebar = document.querySelector('.left-sidebar');

    if (sidebarOpen) {
        sidebar.classList.remove('closed');
        console.log('📂 Sidebar opened');
    } else {
        sidebar.classList.add('closed');
        console.log('📁 Sidebar closed');
    }

    // Save state to localStorage
    localStorage.setItem('sidebar-open', sidebarOpen);
}

// Generate unique chat ID
function generateChatId() {
    return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Generate chat title from first user message
function generateChatTitle(firstMessage) {
    if (!firstMessage) return 'New Chat';
    const maxLength = 40;
    const title = firstMessage.trim();
    return title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
}

// Start new chat
function startNewChat() {
    // Abort any ongoing stream before starting new chat (prevents race conditions)
    if (ollamaClient.getStreamingStatus()) {
        console.log('🛑 Aborting ongoing stream - New Chat clicked');
        ollamaClient.abortGeneration();
    }

    // Save current chat if it has content
    if (currentChatId && ollamaClient.conversationHistory.length >= 2) {
        saveCurrentChat();
    }

    // Generate new chat ID
    currentChatId = generateChatId();

    // Clear conversation history
    ollamaClient.clearConversationHistory();

    // Clear chat container and show welcome message
    chatContainer.innerHTML = `
        <div class="welcome-message">
            <h2>Devbox V${APP_VERSION}</h2>
            <p>Ollmini LLM Client</p>
        </div>
    `;

    // Reset input container to centered position
    inputContainer.classList.remove('bottom');
    inputContainer.classList.add('centered');
    chatContainer.classList.remove('has-input-bottom');

    // Re-render chat history to remove active state
    renderChatHistory();

    console.log('🆕 Started new chat:', currentChatId);
}

// Save current chat to localStorage
function saveCurrentChat(updateTimestamp = true) {
    const conversationHistory = ollamaClient.conversationHistory;

    if (!currentChatId || conversationHistory.length < 2) {
        return; // Don't save empty chats
    }

    // Check if chat already exists
    const existingIndex = savedChats.findIndex(chat => chat.id === currentChatId);

    // Generate title only for new chats, preserve existing title for saved chats
    let title;
    if (existingIndex >= 0 && savedChats[existingIndex].title) {
        // Preserve existing title (may be custom renamed)
        title = savedChats[existingIndex].title;
    } else {
        // Generate title from first user message for new chats
        const firstUserMsg = conversationHistory.find(msg => msg.role === 'user');
        title = firstUserMsg ? generateChatTitle(firstUserMsg.content) : 'New Chat';
    }

    // Security Fix #6: Sanitize messages before saving
    const sanitizedHistory = conversationHistory.map(sanitizeMessageForStorage);

    const chatData = {
        id: currentChatId,
        title: title,
        history: sanitizedHistory,
        timestamp: updateTimestamp ? Date.now() : (existingIndex >= 0 ? savedChats[existingIndex].timestamp : Date.now())
    };

    if (existingIndex >= 0) {
        // Update existing chat (preserve existing properties like favorite)
        savedChats[existingIndex] = {
            ...savedChats[existingIndex],
            ...chatData
        };
    } else {
        // Add new chat (default favorite to false)
        savedChats.push({ ...chatData, favorite: false });
    }

    // Save to localStorage
    localStorage.setItem('saved-chats', JSON.stringify(savedChats));

    // Re-render chat history
    renderChatHistory();

    console.log('💾 Saved chat:', currentChatId, 'Title:', title, 'Timestamp updated:', updateTimestamp);
}

// Load chat from localStorage
function loadChat(chatId) {
    // Abort any ongoing stream before switching chats (prevents race conditions)
    if (ollamaClient.getStreamingStatus()) {
        console.log('🛑 Aborting ongoing stream - Loading different chat');
        ollamaClient.abortGeneration();
    }

    // Save current chat before switching (without updating timestamp)
    if (currentChatId && ollamaClient.conversationHistory.length >= 2) {
        saveCurrentChat(false);
    }

    const chat = savedChats.find(c => c.id === chatId);
    if (!chat) {
        console.error('❌ Chat not found:', chatId);
        return;
    }

    currentChatId = chatId;

    // Load conversation history into ollama-client
    ollamaClient.conversationHistory = chat.history;

    // Clear and re-render chat
    chatContainer.innerHTML = '';

    // Re-render all messages using message-renderer
    chat.history.forEach(msg => {
        if (msg.role === 'user' || msg.role === 'assistant') {
            const contentDiv = messageRenderer.addMessage(msg.role, msg.content, false);

            // Add pin buttons to message (after rendering is complete)
            const messageDiv = contentDiv.closest('.message');
            const messageId = contentDiv._messageId;
            const messageRole = contentDiv._messageRole;
            if (messageDiv && messageId && messageRole) {
                messageRenderer.addPinButtons(messageDiv, messageId, messageRole, modelSettings.ragEnabled);
            }
        }
    });

    // Update chat history to show active state
    renderChatHistory();

    // Move input to bottom if chat has messages
    if (chat.history.length > 0) {
        inputContainer.classList.remove('centered');
        inputContainer.classList.add('bottom');
        chatContainer.classList.add('has-input-bottom');
    }

    console.log('📂 Loaded chat:', chatId);
}

// Delete chat
function deleteChat(chatId) {
    const index = savedChats.findIndex(c => c.id === chatId);
    if (index < 0) return;

    savedChats.splice(index, 1);
    localStorage.setItem('saved-chats', JSON.stringify(savedChats));

    // If deleted chat was current chat, start new chat
    if (currentChatId === chatId) {
        // Clear currentChatId BEFORE startNewChat() to prevent re-saving the deleted chat
        currentChatId = null;
        ollamaClient.clearConversationHistory();
        startNewChat();
    } else {
        renderChatHistory();
    }

    console.log('🗑️ Deleted chat:', chatId);
}

// Clear all chats
function clearAllChats() {
    savedChats = [];
    localStorage.setItem('saved-chats', JSON.stringify(savedChats));

    // Clear current chat and start new one
    currentChatId = null;
    ollamaClient.clearConversationHistory();
    startNewChat();

    console.log('🗑️ All chats cleared');
}

// Rename chat
function renameChat(chatId, newTitle) {
    const chat = savedChats.find(c => c.id === chatId);
    if (!chat) return;

    chat.title = newTitle;
    localStorage.setItem('saved-chats', JSON.stringify(savedChats));
    renderChatHistory();

    console.log('✏️ Renamed chat:', chatId, 'to:', newTitle);
}

// Toggle favorite status
function toggleFavorite(chatId) {
    const chat = savedChats.find(c => c.id === chatId);
    if (!chat) return;

    // Toggle favorite status
    chat.favorite = !chat.favorite;

    // Enforce max 6 favorites
    const favorites = savedChats.filter(c => c.favorite).sort((a, b) => b.timestamp - a.timestamp);
    if (favorites.length > 6) {
        // Remove oldest favorite (last in sorted array)
        const oldestFavorite = favorites[favorites.length - 1];
        oldestFavorite.favorite = false;
        console.log('⭐ Removed oldest favorite to maintain 6-favorite limit:', oldestFavorite.title);
    }

    localStorage.setItem('saved-chats', JSON.stringify(savedChats));
    renderChatHistory();

    console.log(`⭐ ${chat.favorite ? 'Added' : 'Removed'} favorite:`, chat.title);
}

// Render chat history list
function renderChatHistory() {
    if (!chatHistoryList) return;

    if (savedChats.length === 0) {
        chatHistoryList.innerHTML = '';
        return;
    }

    // Separate favorites and regular chats
    const favorites = savedChats.filter(chat => chat.favorite).sort((a, b) => b.timestamp - a.timestamp);
    const regular = savedChats.filter(chat => !chat.favorite).sort((a, b) => b.timestamp - a.timestamp);

    const renderChat = (chat) => {
        const isActive = chat.id === currentChatId ? 'active' : '';
        const isFavorite = chat.favorite ? 'favorite' : '';
        const starIcon = chat.favorite ? `<svg class="favorite-star-icon" viewBox="0 0 24 24" fill="white">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
        </svg>` : '';
        return `
            <div class="chat-history-item ${isActive} ${isFavorite}" data-chat-id="${chat.id}">
                ${starIcon}
                <span class="chat-title" title="${chat.title}">${chat.title}</span>
                <div class="chat-history-actions">
                    <button class="chat-action-btn rename" data-chat-id="${chat.id}" data-action="rename" title="Rename chat">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                    </button>
                    <button class="chat-action-btn delete" data-chat-id="${chat.id}" data-action="delete" title="Delete chat">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    };

    chatHistoryList.innerHTML = favorites.map(renderChat).join('') + regular.map(renderChat).join('');

    // Add click event listeners
    chatHistoryList.querySelectorAll('.chat-history-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't load chat if clicking on action buttons
            if (e.target.closest('.chat-action-btn')) {
                return;
            }
            const chatId = e.currentTarget.dataset.chatId;
            loadChat(chatId);
        });

        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const chatId = e.currentTarget.dataset.chatId;
            showChatContextMenu(e.clientX, e.clientY, chatId);
        });
    });

    // Add action button event listeners
    chatHistoryList.querySelectorAll('.chat-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent chat selection
            const chatId = e.currentTarget.dataset.chatId;
            const action = e.currentTarget.dataset.action;
            const chat = savedChats.find(c => c.id === chatId);

            if (!chat) return;

            if (action === 'rename') {
                showRenameModal(chatId, chat.title);
            } else if (action === 'delete') {
                showDeleteModal(chatId, chat.title);
            }
        });
    });
}

// Show chat context menu
function showChatContextMenu(x, y, chatId) {
    const menu = document.getElementById('chatContextMenu');
    if (!menu) return;

    // Update favorite button text based on current state
    const chat = savedChats.find(c => c.id === chatId);
    const favoriteText = document.getElementById('toggleFavoriteText');
    if (chat && favoriteText) {
        favoriteText.textContent = chat.favorite ? 'Unfavorite' : 'Favorite';
    }

    // Position menu at cursor
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('show');

    // Store chatId for menu actions
    menu.dataset.targetChatId = chatId;

    // Close menu when clicking outside
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.classList.remove('show');
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// Show rename modal
function showRenameModal(chatId, currentTitle) {
    const modal = document.getElementById('rename-chat-modal');
    const input = document.getElementById('rename-chat-input');

    // Set current title as value
    input.value = currentTitle;

    // Show modal
    modal.classList.add('show');

    // Focus input and select text
    setTimeout(() => {
        input.focus();
        input.select();
    }, 100);

    // Handle confirm
    const confirmHandler = () => {
        const newTitle = input.value.trim();
        if (newTitle) {
            renameChat(chatId, newTitle);
        }
        modal.classList.remove('show');
        cleanup();
    };

    // Handle cancel
    const cancelHandler = () => {
        modal.classList.remove('show');
        cleanup();
    };

    // Handle Enter key
    const keyHandler = (e) => {
        if (e.key === 'Enter') {
            confirmHandler();
        } else if (e.key === 'Escape') {
            cancelHandler();
        }
    };

    // Cleanup function to remove listeners
    const cleanup = () => {
        document.getElementById('rename-confirm-btn').removeEventListener('click', confirmHandler);
        document.getElementById('rename-cancel-btn').removeEventListener('click', cancelHandler);
        input.removeEventListener('keydown', keyHandler);
    };

    // Add event listeners
    document.getElementById('rename-confirm-btn').addEventListener('click', confirmHandler);
    document.getElementById('rename-cancel-btn').addEventListener('click', cancelHandler);
    input.addEventListener('keydown', keyHandler);
}

// Show delete modal
function showDeleteModal(chatId, chatTitle) {
    const modal = document.getElementById('delete-chat-modal');
    const titleSpan = document.getElementById('delete-chat-title');

    // Set chat title
    titleSpan.textContent = chatTitle;

    // Show modal
    modal.classList.add('show');

    // Handle confirm
    const confirmHandler = () => {
        deleteChat(chatId);
        modal.classList.remove('show');
        cleanup();
    };

    // Handle cancel
    const cancelHandler = () => {
        modal.classList.remove('show');
        cleanup();
    };

    // Cleanup function to remove listeners
    const cleanup = () => {
        document.getElementById('delete-confirm-btn').removeEventListener('click', confirmHandler);
        document.getElementById('delete-cancel-btn').removeEventListener('click', cancelHandler);
    };

    // Add event listeners
    document.getElementById('delete-confirm-btn').addEventListener('click', confirmHandler);
    document.getElementById('delete-cancel-btn').addEventListener('click', cancelHandler);
}

// Show clear all chats modal
function showClearAllModal() {
    const modal = document.getElementById('clear-all-chats-modal');
    const countDisplay = document.getElementById('chat-count-display');

    // Set chat count
    countDisplay.textContent = savedChats.length;

    // Show modal
    modal.classList.add('show');

    // Handle confirm
    const confirmHandler = () => {
        clearAllChats();
        modal.classList.remove('show');
        cleanup();
    };

    // Handle cancel
    const cancelHandler = () => {
        modal.classList.remove('show');
        cleanup();
    };

    // Cleanup function to remove listeners
    const cleanup = () => {
        document.getElementById('clear-all-confirm-btn').removeEventListener('click', confirmHandler);
        document.getElementById('clear-all-cancel-btn').removeEventListener('click', cancelHandler);
    };

    // Add event listeners
    document.getElementById('clear-all-confirm-btn').addEventListener('click', confirmHandler);
    document.getElementById('clear-all-cancel-btn').addEventListener('click', cancelHandler);
}

// Setup event listeners
function setupEventListeners() {
    // New Chat button
    if (newChatBtn) {
        newChatBtn.addEventListener('click', startNewChat);
    }

    // Clear All Chats button with double-click confirmation
    const clearAllChatsBtn = document.getElementById('clearAllChatsBtn');
    let clearAllPendingConfirm = false;
    let clearAllTimeout = null;

    if (clearAllChatsBtn) {
        clearAllChatsBtn.addEventListener('click', () => {
            if (!clearAllPendingConfirm) {
                // First click - enter pending state
                clearAllPendingConfirm = true;
                clearAllChatsBtn.classList.add('confirm-pending');
                clearAllChatsBtn.title = 'Click again to confirm';

                // Reset after 3 seconds
                clearAllTimeout = setTimeout(() => {
                    clearAllPendingConfirm = false;
                    clearAllChatsBtn.classList.remove('confirm-pending');
                    clearAllChatsBtn.title = 'Delete all chats';
                }, 3000);
            } else {
                // Second click within 3 seconds - show modal
                clearTimeout(clearAllTimeout);
                clearAllPendingConfirm = false;
                clearAllChatsBtn.classList.remove('confirm-pending');
                clearAllChatsBtn.title = 'Delete all chats';
                showClearAllModal();
            }
        });
    }

    // Sidebar Toggle button
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', toggleSidebar);
    }

    // Context Menu actions
    const renameChatBtn = document.getElementById('renameChatBtn');
    const deleteChatBtn = document.getElementById('deleteChatBtn');
    const toggleFavoriteBtn = document.getElementById('toggleFavoriteBtn');

    if (renameChatBtn) {
        renameChatBtn.addEventListener('click', () => {
            const menu = document.getElementById('chatContextMenu');
            const chatId = menu.dataset.targetChatId;
            const chat = savedChats.find(c => c.id === chatId);
            if (chat) {
                showRenameModal(chatId, chat.title);
            }
            menu.classList.remove('show');
        });
    }

    if (deleteChatBtn) {
        deleteChatBtn.addEventListener('click', () => {
            const menu = document.getElementById('chatContextMenu');
            const chatId = menu.dataset.targetChatId;
            const chat = savedChats.find(c => c.id === chatId);
            if (chat) {
                showDeleteModal(chatId, chat.title);
            }
            menu.classList.remove('show');
        });
    }

    if (toggleFavoriteBtn) {
        toggleFavoriteBtn.addEventListener('click', () => {
            const menu = document.getElementById('chatContextMenu');
            const chatId = menu.dataset.targetChatId;
            toggleFavorite(chatId);
            menu.classList.remove('show');
        });
    }
}

// Initialize module (called from renderer.js)
function initialize() {
    // Load saved chats from localStorage
    const saved = localStorage.getItem('saved-chats');
    if (saved) {
        try {
            savedChats = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse saved chats:', e);
            savedChats = [];
        }
    }

    // Load sidebar state
    loadSidebarState();

    // Render chat history
    renderChatHistory();

    // Setup event listeners
    setupEventListeners();

    // Start with a new chat if no current chat
    if (!currentChatId) {
        currentChatId = generateChatId();
    }

    console.log('💬 Chat History Manager initialized');
}

// Export public API
module.exports = {
    // Initialization
    initialize,
    setDOMReferences,
    setModelSettings,
    setModuleDependencies,
    setupEventListeners,

    // State Access
    getCurrentChatId: () => currentChatId,
    getSavedChats: () => savedChats,

    // Core Functions
    startNewChat,
    saveCurrentChat,
    loadChat,
    deleteChat,
    clearAllChats,
    renameChat,
    toggleFavorite,

    // UI Functions
    renderChatHistory,
    toggleSidebar,
    loadSidebarState
};
