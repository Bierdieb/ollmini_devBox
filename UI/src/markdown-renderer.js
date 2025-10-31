// Markdown Renderer Module
// Handles markdown parsing and syntax highlighting

const { marked } = require('marked');
const hljs = require('highlight.js');

// SVG Icons
const COPY_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 2.5h-2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="6.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>`;
const CHECK_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Create custom renderer for syntax highlighting
const renderer = new marked.Renderer();

// Override code rendering to use highlight.js
renderer.code = function(code, language) {
    let highlighted;

    if (language && hljs.getLanguage(language)) {
        try {
            highlighted = hljs.highlight(code, { language: language }).value;
        } catch (err) {
            console.error('Highlight error:', err);
            highlighted = hljs.highlightAuto(code).value;
        }
    } else {
        // Auto-detect language
        try {
            highlighted = hljs.highlightAuto(code).value;
        } catch (err) {
            console.error('Auto-highlight error:', err);
            highlighted = code;
        }
    }

    const langClass = language ? `language-${language} ` : '';

    return `<div class="code-block-wrapper"><button class="copy-code-btn" aria-label="Copy code">${COPY_ICON}</button><pre><code class="${langClass}hljs">${highlighted}</code></pre></div>`;
};

// Override link rendering for security (all external links open in system browser)
renderer.link = function(href, title, text) {
    const titleAttr = title ? ` title="${title}"` : '';
    // Add class and attributes to indicate external link
    return `<a href="${href}" class="markdown-link" data-external="true" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
};

// Configure marked with custom renderer
marked.use({
    renderer: renderer,
    breaks: true,
    gfm: true
});

// Copy code to clipboard
async function copyCodeToClipboard(button, text) {
    try {
        await navigator.clipboard.writeText(text);
        const originalHTML = button.innerHTML;
        button.innerHTML = CHECK_ICON;
        button.classList.add('copied');

        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove('copied');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy:', err);
    }
}

module.exports = {
    marked,
    hljs,
    copyCodeToClipboard,
    COPY_ICON,
    CHECK_ICON
};
