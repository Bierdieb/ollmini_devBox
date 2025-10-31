// Message Renderer Module
// Handles message parsing, think-block rendering, and typewriter effects

// Import central version configuration
const { APP_VERSION } = require('./config');
const { marked } = require('./markdown-renderer');

// Track text length per content div for typewriter effect
const contentLengthMap = new WeakMap();

// Model settings (will be injected)
let modelSettings = {
    typewriterEffect: true
};

// DOM References
let chatContainer = null;
let inputContainer = null;

function setDOMReferences(refs) {
    chatContainer = refs.chatContainer;
    inputContainer = refs.inputContainer;
}

function setModelSettings(settings) {
    modelSettings = settings;
}

// Scroll callback (will be injected from ollama-client)
let scrollCallback = null;

function setScrollCallback(callback) {
    scrollCallback = callback;
}

// Parse and separate think blocks and channels from content
function parseThinkBlocks(text) {
    const parts = [];
    let lastIndex = 0;

    // Pattern for all gpt-oss channels and qwen3 think blocks
    // 1. qwen3: <think>...</think>
    // 2. gpt-oss analysis: (<|start|>assistant)?<|channel|>analysis<|message|>...<|end|>
    // 3. gpt-oss commentary: (<|start|>assistant)?<|channel|>commentary to=functions.*...<|call|>
    // 4. gpt-oss final: (<|start|>assistant)?<|channel|>final<|message|>...<|end|>
    // Note: <|start|>assistant prefix is optional
    const channelRegex = /(<think>([\s\S]*?)<\/think>)|(<\|start\|>assistant\s*)?<\|channel\|>analysis<\|message\>([\s\S]*?)<\|end\|>|(<\|start\|>assistant\s*)?<\|channel\|>commentary[^<]*<\|constrain\|>json<\|message\>([\s\S]*?)<\|call\|>|(<\|start\|>assistant\s*)?<\|channel\|>final<\|message\>([\s\S]*?)<\|end\|>/g;

    let match;
    while ((match = channelRegex.exec(text)) !== null) {
        const fullMatch = match[0];

        // Add content before this block
        if (match.index > lastIndex) {
            const content = text.substring(lastIndex, match.index);
            if (content.trim()) {
                parts.push({ type: 'content', text: content });
            }
        }

        // Determine which pattern matched
        if (match[1]) {
            // qwen3 think block: <think>content</think>
            const thinkContent = match[2];
            if (thinkContent) {
                parts.push({ type: 'think', text: thinkContent.trim() });
            }
        } else if (fullMatch.includes('<|channel|>analysis')) {
            // gpt-oss analysis (thinking)
            const analysisMatch = fullMatch.match(/<\|channel\|>analysis<\|message\>([\s\S]*?)<\|end\|>/);
            if (analysisMatch && analysisMatch[1]) {
                parts.push({ type: 'think', text: analysisMatch[1].trim() });
            }
        } else if (fullMatch.includes('<|channel|>commentary')) {
            // gpt-oss commentary (tool call) - NOW VISIBLE!
            const targetMatch = fullMatch.match(/to=([\w.]+)/);
            const messageMatch = fullMatch.match(/<\|message\|>(.*?)<\|(?:call|end)\|>/s);

            if (targetMatch && messageMatch) {
                parts.push({
                    type: 'tool_call',
                    target: targetMatch[1],
                    arguments: messageMatch[1].trim()
                });
            }
        } else if (fullMatch.includes('<|channel|>final')) {
            // gpt-oss final (actual content/explanation)
            const finalMatch = fullMatch.match(/<\|channel\|>final<\|message\|>([\s\S]*?)<\|end\|>/);
            if (finalMatch && finalMatch[1] && finalMatch[1].trim()) {
                parts.push({ type: 'content', text: finalMatch[1].trim() });
            }
        }

        lastIndex = match.index + match[0].length;
    }

    // Add remaining content
    if (lastIndex < text.length) {
        const content = text.substring(lastIndex);
        if (content.trim()) {
            parts.push({ type: 'content', text: content });
        }
    }

    const result = parts.length > 0 ? parts : [{ type: 'content', text: text }];
    return result;
}

// Apply typewriter effect to new content only
function applyTypewriterToNewChars(element, oldLength, newHTML) {
    if (!modelSettings.typewriterEffect) {
        element.innerHTML = newHTML;
        // Get text length for next update
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newHTML;
        return tempDiv.textContent.length;
    }

    // Parse the new HTML to get text content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newHTML;
    const newTextLength = tempDiv.textContent.length;

    // If no new characters, just update
    if (newTextLength <= oldLength) {
        element.innerHTML = newHTML;
        return newTextLength;
    }

    // Set the new HTML first
    element.innerHTML = newHTML;

    // Now walk through the DOM and wrap new characters
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    let textNodesSeen = 0;
    const textNodes = [];

    // Collect all text nodes
    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }

    // Calculate which characters are new
    let charCount = 0;
    for (let i = 0; i < textNodes.length; i++) {
        const textNode = textNodes[i];
        const text = textNode.textContent;

        for (let j = 0; j < text.length; j++) {
            charCount++;

            // If this character is new (beyond oldLength)
            if (charCount > oldLength) {
                const char = text[j];

                // Skip whitespace
                if (char === ' ' || char === '\n' || char === '\t') {
                    continue;
                }

                // Create wrapper span for this character
                const span = document.createElement('span');
                span.className = 'typewriter-char';
                span.textContent = char;
                // Force animation restart with unique key
                span.style.animationName = 'typewriter-glow';
                span.style.animationDuration = '1.5s';
                span.style.animationTimingFunction = 'ease-out';
                span.style.animationFillMode = 'forwards';
                // Unique key to force new animation instance
                span.setAttribute('data-glow-key', Date.now() + Math.random());

                // Split text node and insert span
                const beforeText = text.substring(0, j);
                const afterText = text.substring(j + 1);

                if (beforeText) {
                    const beforeNode = document.createTextNode(beforeText);
                    textNode.parentNode.insertBefore(beforeNode, textNode);
                }

                textNode.parentNode.insertBefore(span, textNode);

                if (afterText) {
                    textNode.textContent = afterText;
                    // Continue with the rest of this text node
                    charCount--; // Recount the rest
                    break;
                } else {
                    textNode.parentNode.removeChild(textNode);
                    break;
                }
            }
        }
    }

    return newTextLength;
}

// Render message parts (content and think blocks)
function renderMessageParts(messageElement, parts, isStreaming) {
    // Check if we already have elements to update
    const existingThinkBlock = messageElement.querySelector('.thinking-block');
    const existingContentDiv = messageElement.querySelector('.content-section');

    if (!existingThinkBlock && !existingContentDiv) {
        // First render - create all elements
        messageElement.innerHTML = '';
        parts.forEach((part, index) => {
            if (part.type === 'think') {
                const thinkBlock = createThinkBlock(part.text, isStreaming && index === parts.length - 1, scrollCallback);
                messageElement.appendChild(thinkBlock);
            } else if (part.type === 'content') {
                const contentDiv = document.createElement('div');
                contentDiv.className = 'content-section';
                const newHTML = marked.parse(part.text);
                const newLength = applyTypewriterToNewChars(contentDiv, 0, newHTML);
                contentLengthMap.set(contentDiv, newLength);
                messageElement.appendChild(contentDiv);
            } else if (part.type === 'tool_call') {
                const toolCallDiv = document.createElement('div');
                toolCallDiv.className = 'tool-call-section';

                // Parse JSON for pretty display
                let formattedArgs = part.arguments;
                try {
                    const parsed = JSON.parse(part.arguments);
                    formattedArgs = JSON.stringify(parsed, null, 2);
                } catch (e) {
                    // Keep as-is if not valid JSON
                }

                toolCallDiv.innerHTML = `
                    <div class="tool-call-header">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm1 12H7V7h2v5zm0-6H7V4h2v2z"/>
                        </svg>
                        <span class="tool-name">🔧 Tool Call: <code>${part.target}</code></span>
                    </div>
                    <pre class="tool-call-args"><code class="language-json">${formattedArgs}</code></pre>
                `;
                messageElement.appendChild(toolCallDiv);
            }
        });
    } else {
        // Update existing elements
        parts.forEach((part, index) => {
            if (part.type === 'think' && existingThinkBlock) {
                const content = existingThinkBlock.querySelector('.thinking-content');
                const label = existingThinkBlock.querySelector('.thinking-label');

                if (isStreaming && index === parts.length - 1) {
                    // During streaming: keep content hidden, show shimmer
                    label.classList.add('streaming');
                    content.textContent = part.text; // Store text but keep collapsed
                } else {
                    // Streaming finished: remove shimmer, content available
                    label.classList.remove('streaming');
                    content.textContent = part.text;
                }
            } else if (part.type === 'content' && existingContentDiv) {
                const oldLength = contentLengthMap.get(existingContentDiv) || 0;
                const newHTML = marked.parse(part.text);
                const newLength = applyTypewriterToNewChars(existingContentDiv, oldLength, newHTML);
                contentLengthMap.set(existingContentDiv, newLength);
            }
        });
    }
}

// Create thinking block (always expanded)
function createThinkBlock(thinkText, isStreaming, scrollCallback) {
    const thinkBlock = document.createElement('div');
    thinkBlock.className = 'thinking-block'; // Start collapsed

    const header = document.createElement('div');
    header.className = 'thinking-header';
    header.style.cursor = 'pointer';

    const icon = document.createElement('span');
    icon.className = 'thinking-icon';
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
    </svg>`;

    const label = document.createElement('span');
    label.className = 'thinking-label';
    label.textContent = 'Thinking';

    const toggle = document.createElement('span');
    toggle.className = 'toggle-icon';
    toggle.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M7 10l5 5 5-5z"/>
    </svg>`;

    // Add streaming animation
    if (isStreaming) {
        label.classList.add('streaming');
    }

    header.appendChild(icon);
    header.appendChild(label);
    header.appendChild(toggle);

    const content = document.createElement('div');
    content.className = 'thinking-content';
    content.textContent = thinkText;

    // Click to toggle
    header.addEventListener('click', () => {
        thinkBlock.classList.toggle('expanded');
        if (scrollCallback) scrollCallback();
    });

    thinkBlock.appendChild(header);
    thinkBlock.appendChild(content);

    return thinkBlock;
}

// Create tool execution box
function createToolExecutionBox(toolCall, status = 'executing', scrollCallback) {
    const args = typeof toolCall.function.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

    const box = document.createElement('div');
    box.className = `tool-execution-box ${status}`;
    box.dataset.toolName = toolCall.function.name;

    // SVG Icons based on tool type
    const icons = {
        'bash': `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>`,
        'read': `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
        </svg>`,
        'write': `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
        </svg>`,
        'edit': `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
        </svg>`,
        'glob': `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>`
    };
    const icon = icons[toolCall.function.name] || icons['bash'];

    const statusIcon = status === 'executing'
        ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" class="spin">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
        </svg>`
        : `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
        </svg>`;

    // Command/Args preview
    let commandPreview = '';
    if (args.command) {
        commandPreview = args.command;
    } else if (args.file_path) {
        commandPreview = args.file_path;
    } else if (args.pattern) {
        commandPreview = args.pattern;
    }

    const header = document.createElement('div');
    header.className = 'exec-header';
    header.style.cursor = 'pointer';
    header.innerHTML = `
        <span class="exec-icon">${icon}</span>
        <span class="exec-label"><strong>${toolCall.function.name}</strong>${commandPreview ? `: <code>${commandPreview}</code>` : ''}</span>
        <span class="exec-status">${statusIcon}</span>
    `;

    const details = document.createElement('div');
    details.className = 'exec-details';
    if (args.command) {
        details.innerHTML = `<div class="exec-args"><strong>Command:</strong> <code>${args.command}</code></div>`;
    }
    if (args.description) {
        details.innerHTML += `<div class="exec-args"><strong>Description:</strong> ${args.description}</div>`;
    }

    header.addEventListener('click', () => {
        box.classList.toggle('expanded');
        if (scrollCallback) scrollCallback();
    });

    box.appendChild(header);
    box.appendChild(details);

    return box;
}

// Generate unique message ID
let messageIdCounter = 0;
function generateMessageId() {
    return `msg_${Date.now()}_${messageIdCounter++}`;
}

// Add Message to Chat
function addMessage(role, content, streaming = false) {
    const messageId = generateMessageId();

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    messageDiv.dataset.messageId = messageId;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    if (streaming) {
        contentDiv.classList.add('streaming');
    }

    // Render user messages as plain text, assistant messages will be rendered during streaming
    if (role === 'user') {
        contentDiv.textContent = content;
    } else if (role === 'assistant' && !streaming) {
        // For non-streaming assistant messages (e.g., loading from history), render immediately
        const parts = parseThinkBlocks(content);
        renderMessageParts(contentDiv, parts, false);
    }
    // For assistant streaming: Leave contentDiv empty - renderMessageParts() will be called from streamResponse()

    messageDiv.appendChild(contentDiv);
    chatContainer.appendChild(messageDiv);

    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Return both contentDiv and messageId for external use
    contentDiv._messageId = messageId;
    contentDiv._messageRole = role;
    contentDiv._messageDiv = messageDiv;  // Store reference to outer message div
    return contentDiv;
}

// Clear Chat
function clearChat() {
    chatContainer.innerHTML = `
        <div class="welcome-message">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" opacity="0.3">
                <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
            </svg>
            <h2>Devbox V${APP_VERSION}</h2>
            <p>Ollmini LLM Client</p>
        </div>
    `;

    // Reset input container to centered position
    inputContainer.classList.remove('bottom');
    inputContainer.classList.add('centered');
    chatContainer.classList.remove('has-input-bottom');
}

// Show Error Message
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';

    // Create SVG icon
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '20');
    icon.setAttribute('height', '20');
    icon.setAttribute('fill', 'currentColor');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z');
    icon.appendChild(path);

    // Create text span with textContent (XSS-safe)
    const span = document.createElement('span');
    span.textContent = message;

    errorDiv.appendChild(icon);
    errorDiv.appendChild(span);

    chatContainer.insertBefore(errorDiv, chatContainer.firstChild);

    setTimeout(() => {
        errorDiv.remove();
    }, 5000);
}

// Update pin button state
function updatePinButtonState(messageId, isPinned) {
    const messageDiv = chatContainer.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageDiv) return;

    const pinButton = messageDiv.querySelector('.pin-message-btn');
    if (!pinButton) return;

    if (isPinned) {
        pinButton.classList.add('pinned');
        pinButton.title = 'Unpin this message';
        pinButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12M2,5.27L3.28,4L20,20.72L18.73,22L12.8,16.07V22H11.2V16.05L2,6.05V5.27Z"/>
            </svg>
            <span>Unpin</span>
        `;
    } else {
        pinButton.classList.remove('pinned');
        pinButton.title = 'Pin this message';
        pinButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/>
            </svg>
            <span>Pin</span>
        `;
    }
}

// Show toast notification
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Add pin buttons to a message (called AFTER rendering is complete)
function addPinButtons(messageDiv, messageId, role, ragEnabled = false) {
    console.log('📌 addPinButtons called:', { messageId, role, messageDiv, hasActions: !!messageDiv.querySelector('.message-actions') });

    // Check if buttons already exist
    if (messageDiv.querySelector('.message-actions')) {
        console.warn('📌 Buttons already exist for message:', messageId);
        return;
    }

    // Create pin button container
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'message-actions';

    // Context Pin Button (always visible)
    const pinButton = document.createElement('button');
    pinButton.className = 'pin-message-btn';
    pinButton.dataset.messageId = messageId;
    pinButton.title = 'Pin to context window';
    pinButton.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/>
        </svg>
        <span>Pin</span>
    `;

    actionsContainer.appendChild(pinButton);

    // RAG Pin Button (only if RAG is enabled)
    if (ragEnabled) {
        const ragPinButton = document.createElement('button');
        ragPinButton.className = 'rag-pin-message-btn';
        ragPinButton.dataset.messageId = messageId;
        ragPinButton.dataset.role = role;
        ragPinButton.title = 'Pin to RAG (long-term storage)';
        ragPinButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
            </svg>
            <span>RAG</span>
        `;
        actionsContainer.appendChild(ragPinButton);
    }

    // Copy Button (always visible)
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-message-btn';
    copyButton.title = 'Copy message content to clipboard';
    copyButton.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
        </svg>
        <span>Copy</span>
    `;
    actionsContainer.appendChild(copyButton);

    messageDiv.appendChild(actionsContainer);
}

module.exports = {
    setDOMReferences,
    setModelSettings,
    setScrollCallback,
    parseThinkBlocks,
    applyTypewriterToNewChars,
    renderMessageParts,
    createThinkBlock,
    createToolExecutionBox,
    addMessage,
    clearChat,
    showError,
    updatePinButtonState,
    showToast,
    addPinButtons
};

// Export globally for access from ollama-client.js (tool explanation messages)
window.addPinButtonsToMessage = addPinButtons;
