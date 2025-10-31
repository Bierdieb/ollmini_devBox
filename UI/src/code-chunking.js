// Code Chunking Module
// Handles intelligent code chunking with context preservation and metadata extraction

const embeddingStrategy = require('./embedding-strategy');

/**
 * Extract basic metadata from code content
 * Detects imports, function names, class names without full AST parsing
 * @param {string} code - Source code content
 * @param {string} language - Programming language
 * @returns {Object} - Extracted metadata
 */
function extractBasicMetadata(code, language) {
    const metadata = {
        imports: [],
        exports: [],
        functions: [],
        classes: [],
        language
    };

    const lines = code.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();

        // JavaScript/TypeScript imports
        if (language === 'javascript' || language === 'typescript') {
            // import ... from '...'
            const importMatch = trimmed.match(/^import\s+.*\s+from\s+['"]([^'"]+)['"]/);
            if (importMatch) {
                metadata.imports.push(importMatch[1]);
            }
            // const ... = require('...')
            const requireMatch = trimmed.match(/require\(['"]([^'"]+)['"]\)/);
            if (requireMatch) {
                metadata.imports.push(requireMatch[1]);
            }
            // export function/class/const
            if (trimmed.startsWith('export ')) {
                const exportMatch = trimmed.match(/export\s+(function|class|const|let|var)\s+(\w+)/);
                if (exportMatch) {
                    metadata.exports.push(exportMatch[2]);
                }
            }
            // function name(
            const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
            if (funcMatch) {
                metadata.functions.push(funcMatch[1]);
            }
            // class name {
            const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/);
            if (classMatch) {
                metadata.classes.push(classMatch[1]);
            }
        }

        // Python imports and definitions
        if (language === 'python') {
            // import module or from module import ...
            const importMatch = trimmed.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)/);
            if (importMatch) {
                const module = importMatch[1] || importMatch[2].split(',')[0].split(' as ')[0].trim();
                metadata.imports.push(module);
            }
            // def function_name(
            const funcMatch = trimmed.match(/^def\s+(\w+)\s*\(/);
            if (funcMatch) {
                metadata.functions.push(funcMatch[1]);
            }
            // class ClassName:
            const classMatch = trimmed.match(/^class\s+(\w+)/);
            if (classMatch) {
                metadata.classes.push(classMatch[1]);
            }
        }

        // Java/C++/C# classes and methods
        if (language === 'java' || language === 'c++' || language === 'csharp') {
            // class ClassName
            const classMatch = trimmed.match(/^(?:public\s+)?(?:class|interface)\s+(\w+)/);
            if (classMatch) {
                metadata.classes.push(classMatch[1]);
            }
            // method signature (simplified - doesn't handle all cases)
            const methodMatch = trimmed.match(/^\w+\s+(\w+)\s*\([^)]*\)\s*\{?/);
            if (methodMatch && !['if', 'for', 'while', 'switch'].includes(methodMatch[1])) {
                metadata.functions.push(methodMatch[1]);
            }
        }
    }

    return metadata;
}

/**
 * Smart code chunking with structure preservation
 * Phase 1: Function/Class boundary detection without full AST
 * @param {string} code - Source code content
 * @param {string} language - Programming language
 * @param {number} maxChunkSize - Maximum chunk size in characters
 * @param {number} overlapSize - Overlap size in characters
 * @returns {Array<Object>} - Array of {text, metadata} chunks
 */
function chunkCode(code, language, maxChunkSize = 2048, overlapSize = 200) {
    const chunks = [];
    const lines = code.split('\n');

    let currentChunk = [];
    let currentSize = 0;
    let chunkMetadata = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineSize = line.length + 1; // +1 for newline

        // Detect chunk boundaries (function/class start)
        const isChunkBoundary = detectChunkBoundary(line.trim(), language);

        // Start new chunk if:
        // 1. Hit chunk boundary AND current chunk has content
        // 2. Current chunk size exceeds max
        if ((isChunkBoundary && currentChunk.length > 0) ||
            (currentSize + lineSize > maxChunkSize && currentChunk.length > 0)) {

            // Save current chunk
            const chunkText = currentChunk.join('\n');
            const metadata = extractBasicMetadata(chunkText, language);
            chunks.push({
                text: chunkText,
                metadata
            });

            // Start new chunk with overlap
            const overlapLines = getOverlapLines(currentChunk, overlapSize);
            currentChunk = overlapLines.concat([line]);
            currentSize = overlapLines.reduce((sum, l) => sum + l.length + 1, 0) + lineSize;
        } else {
            // Add line to current chunk
            currentChunk.push(line);
            currentSize += lineSize;
        }
    }

    // Add final chunk
    if (currentChunk.length > 0) {
        const chunkText = currentChunk.join('\n');
        const metadata = extractBasicMetadata(chunkText, language);
        chunks.push({
            text: chunkText,
            metadata
        });
    }

    return chunks;
}

/**
 * Detect if line is a chunk boundary (function/class start)
 * @param {string} line - Trimmed line of code
 * @param {string} language - Programming language
 * @returns {boolean}
 */
function detectChunkBoundary(line, language) {
    if (!line) return false;

    // JavaScript/TypeScript: function or class declaration
    if (language === 'javascript' || language === 'typescript') {
        if (line.match(/^(?:export\s+)?(?:async\s+)?function\s+\w+/)) return true;
        if (line.match(/^(?:export\s+)?class\s+\w+/)) return true;
        if (line.match(/^const\s+\w+\s*=\s*(?:async\s+)?\(/)) return true; // Arrow functions
    }

    // Python: def or class
    if (language === 'python') {
        if (line.match(/^def\s+\w+\s*\(/)) return true;
        if (line.match(/^class\s+\w+/)) return true;
    }

    // Java/C++/C#: class or method
    if (language === 'java' || language === 'c++' || language === 'csharp') {
        if (line.match(/^(?:public\s+|private\s+|protected\s+)?(?:class|interface)\s+\w+/)) return true;
        if (line.match(/^(?:public\s+|private\s+|protected\s+)?\w+\s+\w+\s*\([^)]*\)/)) return true;
    }

    return false;
}

/**
 * Get overlap lines from end of chunk
 * @param {Array<string>} lines - Lines array
 * @param {number} overlapSize - Target overlap size in characters
 * @returns {Array<string>}
 */
function getOverlapLines(lines, overlapSize) {
    const overlap = [];
    let size = 0;

    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (size + line.length + 1 > overlapSize) break;
        overlap.unshift(line);
        size += line.length + 1;
    }

    return overlap;
}

/**
 * Chunk code with context preservation
 * Main entry point for code chunking
 * @param {string} code - Source code content
 * @param {string} filePath - File path (for language detection)
 * @param {number} maxChunkSize - Maximum chunk size in characters
 * @param {number} overlapSize - Overlap size in characters
 * @returns {Array<Object>} - Array of {text, metadata} chunks
 */
function chunkCodeFile(code, filePath, maxChunkSize = 2048, overlapSize = 200) {
    const language = embeddingStrategy.detectLanguage(filePath);

    if (!language) {
        // Fallback: treat as plain text
        return [{
            text: code,
            metadata: {
                language: 'unknown',
                imports: [],
                exports: [],
                functions: [],
                classes: []
            }
        }];
    }

    return chunkCode(code, language, maxChunkSize, overlapSize);
}

module.exports = {
    chunkCodeFile,
    extractBasicMetadata
};
