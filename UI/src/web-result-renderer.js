// Web Result Renderer Module
// Handles visualization of web_search and web_fetch tool results

/**
 * Renders web_search results with enhanced visual cards
 * @param {Object} toolCall - The tool call object
 * @param {Object} result - The search result data
 * @returns {string} HTML string for search results
 */
function renderWebSearchResult(toolCall, result) {
    if (!result.success || !result.results) {
        return renderWebError(result);
    }

    const toolArgs = typeof toolCall.function.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

    // Defense Layer 3: Hard limit on displayed results (max 10)
    const MAX_DISPLAY_RESULTS = 10;
    const totalResults = result.results.length;
    const limitedResults = result.results.slice(0, MAX_DISPLAY_RESULTS);
    const wasLimited = totalResults > MAX_DISPLAY_RESULTS;

    const queryDisplay = toolArgs.query ? ` for: <strong>"${toolArgs.query}"</strong>` : '';
    let html = `<div class="web-search-summary">✅ Found <strong>${totalResults} results</strong>${queryDisplay}</div>\n\n`;

    // Show warning if results were limited
    if (wasLimited) {
        html += `<div class="result-warning">⚠️ Showing first ${MAX_DISPLAY_RESULTS} of ${totalResults} results (limited for performance)</div>\n\n`;
    }

    limitedResults.forEach((item, index) => {
        // Show first 3 results expanded, rest collapsible
        const cardClass = index < 3 ? 'web-result-card' : 'web-result-card collapsed';

        html += `<div class="${cardClass}">`;
        html += `<div class="result-number">${index + 1}</div>`;
        html += `<div class="result-body">`;
        html += `<div class="result-title">${item.title}</div>`;
        html += `<div class="result-url">🔗 <a href="${item.url}" class="web-link">${item.url}</a><button class="copy-url-btn" data-url="${item.url}" title="Copy URL"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg></button></div>`;
        html += `<div class="result-snippet">📄 ${item.content.substring(0, 500)}${item.content.length > 500 ? '...' : ''}</div>`;
        html += `</div>`; // result-body
        html += `</div>`; // web-result-card
    });

    // Show "expand more" button if more than 3 results
    if (limitedResults.length > 3) {
        html += `<div class="show-more-results" onclick="this.parentElement.querySelectorAll('.web-result-card.collapsed').forEach(c => c.classList.remove('collapsed')); this.style.display='none';">`;
        html += `📋 Show ${limitedResults.length - 3} more result${limitedResults.length - 3 > 1 ? 's' : ''} ▼`;
        html += `</div>`;
    }

    return html;
}

/**
 * Renders web_fetch results with enhanced layout
 * @param {Object} toolCall - The tool call object
 * @param {Object} result - The fetch result data
 * @returns {string} HTML string for fetch results
 */
function renderWebFetchResult(toolCall, result) {
    if (!result.success) {
        return renderWebError(result);
    }

    // Extract URL from tool arguments
    const fetchedUrl = typeof toolCall.function.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments).url
        : toolCall.function.arguments.url;

    // Estimate token count (rough: 1 token ≈ 4 chars)
    const estimatedTokens = Math.round((result.content || '').length / 4);

    let html = `<div class="web-fetch-container">`;

    // Source URL section
    html += `<div class="fetch-source">`;
    html += `<strong>🌐 Source:</strong> <a href="${fetchedUrl}" class="web-link">${fetchedUrl}</a><button class="copy-url-btn" data-url="${fetchedUrl}" title="Copy URL"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg></button>`;
    html += `<span class="token-count">~${estimatedTokens.toLocaleString('de-DE')} tokens</span>`;
    html += `</div>`;

    // Title section
    html += `<div class="fetch-title">`;
    html += `<strong>📄 Title:</strong> ${result.title || 'N/A'}`;
    html += `</div>`;

    // Content preview section
    html += `<div class="fetch-content">`;
    html += `<strong>Content Preview:</strong>`;
    html += `<div class="content-preview">${(result.content || '').substring(0, 1000)}${result.content && result.content.length > 1000 ? '...' : ''}</div>`;
    html += `</div>`;

    // Links section
    if (result.links && result.links.length > 0) {
        html += `<div class="fetch-links">`;
        html += `<strong>🔗 Links found:</strong> ${result.links.length}`;
        html += `<div class="links-list">`;
        result.links.slice(0, 5).forEach(link => {
            html += `<div class="link-item">• <a href="${link}" class="web-link">${link}</a><button class="copy-url-btn" data-url="${link}" title="Copy URL"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg></button></div>`;
        });
        if (result.links.length > 5) {
            html += `<div class="link-item">... and ${result.links.length - 5} more</div>`;
        }
        html += `</div>`; // links-list
        html += `</div>`; // fetch-links
    }

    html += `</div>`; // web-fetch-container

    return html;
}

/**
 * Renders error messages for web tool failures
 * @param {Object} result - The result object containing error
 * @returns {string} HTML string for error display
 */
function renderWebError(result) {
    return `<div class="result-error"><strong>Error:</strong> ${result.error || 'Unknown error occurred'}</div>`;
}

/**
 * Main function to render any web tool result
 * Dispatches to appropriate renderer based on tool name
 * @param {Object} toolCall - The tool call object
 * @param {Object} result - The result data
 * @returns {string} HTML string for result display
 */
function renderWebToolResult(toolCall, result) {
    if (toolCall.function.name === 'web_search') {
        return renderWebSearchResult(toolCall, result);
    } else if (toolCall.function.name === 'web_fetch') {
        return renderWebFetchResult(toolCall, result);
    } else {
        return `<div class="result-error"><strong>Unknown web tool:</strong> ${toolCall.function.name}</div>`;
    }
}

module.exports = {
    renderWebSearchResult,
    renderWebFetchResult,
    renderWebError,
    renderWebToolResult
};
