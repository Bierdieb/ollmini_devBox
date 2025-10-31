// Unicode Filter for Prompt Injection Prevention
// Implements OWASP, AWS, and Microsoft best practices for LLM security
// Defends against: Unicode Tags, Zero-Width Characters, Bidirectional Overrides, Control Characters

/**
 * Main sanitization function - applies 6-layer filtering to prevent prompt injection
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text safe for LLM processing
 */
function sanitizeForLLM(text) {
    // Handle null/undefined/non-string inputs
    if (!text || typeof text !== 'string') {
        return text;
    }

    // Store original for comparison
    const original = text;
    let sanitized = text;

    // Layer 1: Unicode Normalization (NFKC)
    // Converts compatibility characters to standard form
    // Prevents homoglyph-based attacks
    sanitized = normalizeUnicode(sanitized);

    // Layer 2: Remove Unicode Tags (U+E0000-E007F)
    // Invisible tag characters used in "ASCII Smuggler" attacks
    sanitized = removeUnicodeTags(sanitized);

    // Layer 3: Remove Zero-Width Characters
    // Invisible joiners/spaces used to hide malicious content
    sanitized = removeZeroWidthChars(sanitized);

    // Layer 4: Remove Bidirectional Override Characters
    // RTL/LTR overrides that create visually deceptive text
    sanitized = removeBidiOverrides(sanitized);

    // Layer 5: Remove Dangerous Control Characters
    // Non-printable characters except legitimate whitespace
    sanitized = removeControlCharacters(sanitized);

    // Layer 6: Logging and Transparency
    if (sanitized !== original) {
        const removed = original.length - sanitized.length;
        console.warn('⚠️ Unicode Filter: Potential prompt injection detected and sanitized');
        console.log(`📊 Original length: ${original.length}, Sanitized length: ${sanitized.length}, Removed: ${removed} characters`);

        // Log first 100 chars for debugging (if significantly different)
        if (removed > 10) {
            console.log(`🔍 Original preview: "${original.substring(0, 100)}..."`);
            console.log(`✅ Sanitized preview: "${sanitized.substring(0, 100)}..."`);
        }
    }

    return sanitized;
}

/**
 * Layer 1: Unicode Normalization (NFKC)
 * Normalizes Unicode to Compatibility Composition form
 * Example: Full-width 'Ａ' (U+FF21) → Standard 'A' (U+0041)
 */
function normalizeUnicode(text) {
    try {
        return text.normalize('NFKC');
    } catch (error) {
        console.error('❌ Unicode normalization failed:', error);
        return text;
    }
}

/**
 * Layer 2: Remove Unicode Tags (U+E0000 - U+E007F)
 * These are invisible "tag" characters that don't display but can contain hidden instructions
 * Used in "Invisible Prompt Injection" and "ASCII Smuggler" attacks
 *
 * Unicode Range: TAG SPACE (U+E0020) to CANCEL TAG (U+E007F)
 * Surrogate Pair Representation: \uDB40\uDC00 to \uDB40\uDC7F
 */
function removeUnicodeTags(text) {
    // Match surrogate pairs for Tag Block characters
    // High surrogate: \uDB40, Low surrogate range: \uDC00-\uDC7F
    return text.replace(/[\uDB40][\uDC00-\uDC7F]/gu, '');
}

/**
 * Layer 3: Remove Zero-Width Characters
 * Invisible characters used to hide content or bypass filters
 *
 * Removed characters:
 * - U+200B: Zero Width Space (ZWSP)
 * - U+200C: Zero Width Non-Joiner (ZWNJ)
 * - U+200D: Zero Width Joiner (ZWJ)
 * - U+FEFF: Zero Width No-Break Space / Byte Order Mark (BOM)
 */
function removeZeroWidthChars(text) {
    return text.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/**
 * Layer 4: Remove Bidirectional Override Characters
 * These characters manipulate text rendering direction (RTL/LTR)
 * Can create visually deceptive text that appears different to humans vs. LLMs
 *
 * Removed characters:
 * - U+202A: Left-to-Right Embedding (LRE)
 * - U+202B: Right-to-Left Embedding (RLE)
 * - U+202C: Pop Directional Formatting (PDF)
 * - U+202D: Left-to-Right Override (LRO)
 * - U+202E: Right-to-Left Override (RLO) - commonly used in attacks
 * - U+2066: Left-to-Right Isolate (LRI)
 * - U+2067: Right-to-Left Isolate (RLI)
 * - U+2068: First Strong Isolate (FSI)
 * - U+2069: Pop Directional Isolate (PDI)
 */
function removeBidiOverrides(text) {
    return text.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
}

/**
 * Layer 5: Remove Dangerous Control Characters
 * Removes non-printable control characters that could be used for injection
 *
 * PRESERVES legitimate whitespace:
 * - \n (U+000A): Line Feed (newline)
 * - \r (U+000D): Carriage Return
 * - \t (U+0009): Horizontal Tab
 *
 * REMOVES all other control characters:
 * - U+0000-U+0008: NULL, SOH, STX, ETX, EOT, ENQ, ACK, BEL
 * - U+000B: Vertical Tab
 * - U+000C: Form Feed
 * - U+000E-U+001F: Other control characters
 * - U+007F: Delete (DEL)
 * - U+0080-U+009F: C1 control characters
 */
function removeControlCharacters(text) {
    // Keep \n (0A), \r (0D), \t (09) - legitimate whitespace
    // Remove all other control chars: 00-08, 0B, 0C, 0E-1F, 7F-9F
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
}

/**
 * Apply Unicode filter to WebSearch results
 * Sanitizes all text fields in web_search and web_fetch results
 *
 * @param {Object} result - WebSearch API result object
 * @returns {Object} - Sanitized result object
 */
function applyFilterToWebResults(result) {
    if (!result || typeof result !== 'object') {
        return result;
    }

    // Deep copy to avoid mutating original
    const sanitized = JSON.parse(JSON.stringify(result));

    // Filter web_search results (array of results)
    if (sanitized.results && Array.isArray(sanitized.results)) {
        sanitized.results = sanitized.results.map(item => ({
            ...item,
            title: sanitizeForLLM(item.title),
            content: sanitizeForLLM(item.content),
            url: item.url // URLs are not sanitized, only validated by fetch()
        }));
    }

    // Filter web_fetch result (single page content)
    if (sanitized.content) {
        sanitized.content = sanitizeForLLM(sanitized.content);
    }
    if (sanitized.title) {
        sanitized.title = sanitizeForLLM(sanitized.title);
    }

    // Filter links array in web_fetch results
    if (sanitized.links && Array.isArray(sanitized.links)) {
        sanitized.links = sanitized.links.map(link => ({
            ...link,
            text: sanitizeForLLM(link.text)
            // URL not sanitized
        }));
    }

    return sanitized;
}

// Export functions
module.exports = {
    sanitizeForLLM,
    applyFilterToWebResults,
    // Export individual filters for testing/debugging
    normalizeUnicode,
    removeUnicodeTags,
    removeZeroWidthChars,
    removeBidiOverrides,
    removeControlCharacters
};
