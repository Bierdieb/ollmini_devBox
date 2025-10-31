// Console Helper for Windows Unicode Support
// Replaces Unicode characters with ASCII alternatives for Windows console

/**
 * Replaces Unicode characters with ASCII alternatives for better Windows console compatibility
 * @param {string} text - Text that may contain Unicode characters
 * @returns {string} - Text with ASCII alternatives
 */
function sanitizeForConsole(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    return text
        // Box drawing characters
        .replace(/═/g, '=')
        .replace(/║/g, '|')
        .replace(/╔/g, '+')
        .replace(/╗/g, '+')
        .replace(/╚/g, '+')
        .replace(/╝/g, '+')
        .replace(/╠/g, '+')
        .replace(/╣/g, '+')
        .replace(/╦/g, '+')
        .replace(/╩/g, '+')
        .replace(/╬/g, '+')
        .replace(/─/g, '-')
        .replace(/│/g, '|')

        // Common emojis
        .replace(/✅/g, '[OK]')
        .replace(/❌/g, '[X]')
        .replace(/⚠️/g, '[!]')
        .replace(/🔍/g, '[?]')
        .replace(/🧠/g, '[*]')
        .replace(/📊/g, '[#]')
        .replace(/🚀/g, '[>]')
        .replace(/💡/g, '[i]')
        .replace(/🔧/g, '[T]')
        .replace(/📁/g, '[F]')
        .replace(/📄/g, '[D]')
        .replace(/📂/g, '[F]')
        .replace(/📏/g, '[R]')
        .replace(/📌/g, '[P]')
        .replace(/🔐/g, '[L]')
        .replace(/💬/g, '[C]')
        .replace(/🔌/g, '[P]')
        .replace(/⏱️/g, '[T]')
        .replace(/🎯/g, '[+]')
        .replace(/✨/g, '[*]')
        .replace(/🔒/g, '[L]')
        .replace(/🔓/g, '[U]')
        .replace(/🗑️/g, '[D]')
        .replace(/🗄️/g, '[S]')

        // Security Fix #3: Credential Sanitization (Added 2025-10-24)
        // Remove credentials from console output
        .replace(/P4PASSWD=[^\s]+/g, 'P4PASSWD=***')
        .replace(/-P\s+\w+/g, '-P ***')
        .replace(/password[=:]\s*\w+/gi, 'password=***')
        .replace(/passwd[=:]\s*\w+/gi, 'passwd=***')
        .replace(/AWS_SECRET_ACCESS_KEY=[^\s]+/gi, 'AWS_SECRET_ACCESS_KEY=***')
        .replace(/GH_TOKEN=[^\s]+/gi, 'GH_TOKEN=***');
}

/**
 * Console.log wrapper that sanitizes output for Windows
 */
function log(...args) {
    const sanitized = args.map(arg =>
        typeof arg === 'string' ? sanitizeForConsole(arg) : arg
    );
    console.log(...sanitized);
}

/**
 * Console.warn wrapper that sanitizes output for Windows
 */
function warn(...args) {
    const sanitized = args.map(arg =>
        typeof arg === 'string' ? sanitizeForConsole(arg) : arg
    );
    console.warn(...sanitized);
}

/**
 * Console.error wrapper that sanitizes output for Windows
 */
function error(...args) {
    const sanitized = args.map(arg =>
        typeof arg === 'string' ? sanitizeForConsole(arg) : arg
    );
    console.error(...sanitized);
}

module.exports = {
    sanitizeForConsole,
    log,
    warn,
    error
};
