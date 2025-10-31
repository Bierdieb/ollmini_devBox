// Embedding Strategy Module
// Handles file-type detection and embedding model selection for dual-embedding RAG system

const path = require('path');

/**
 * Available 1024D embedding models for code
 */
const CODE_MODELS_1024D = [
    { name: 'qwen3-embedding:0.6b', size: '639MB', context: '32K', description: 'Code-optimized, multilingual' },
    { name: 'qwen3-embedding:4b', size: '2.5GB', context: '40K', description: 'Higher quality code embeddings' },
    { name: 'snowflake-arctic-embed:335m', size: '620MB', context: '512', description: 'Generic, faster' },
    { name: 'snowflake-arctic-embed2:568m', size: '1.08GB', context: '512', description: 'Generic, best quality' }
];

/**
 * Available 1024D embedding models for text
 */
const TEXT_MODELS_1024D = [
    { name: 'snowflake-arctic-embed2:568m', size: '1.08GB', context: '512', description: 'Best quality' },
    { name: 'snowflake-arctic-embed:335m', size: '620MB', context: '512', description: 'Faster' },
    { name: 'qwen3-embedding:0.6b', size: '639MB', context: '32K', description: 'Multilingual' },
    { name: 'qwen3-embedding:4b', size: '2.5GB', context: '40K', description: 'Higher quality' }
];

/**
 * Default models
 */
const DEFAULT_CODE_MODEL = 'qwen3-embedding:0.6b';
const DEFAULT_TEXT_MODEL = 'snowflake-arctic-embed2:568m';

/**
 * File extensions mapped to file types
 */
const FILE_TYPE_MAP = {
    // Code files (use jina-embeddings-v2-base-code)
    '.js': 'code',
    '.jsx': 'code',
    '.ts': 'code',
    '.tsx': 'code',
    '.py': 'code',
    '.java': 'code',
    '.cpp': 'code',
    '.c': 'code',
    '.h': 'code',
    '.hpp': 'code',
    '.cs': 'code',
    '.rb': 'code',
    '.go': 'code',
    '.rs': 'code',
    '.php': 'code',
    '.swift': 'code',
    '.kt': 'code',
    '.scala': 'code',
    '.r': 'code',
    '.m': 'code',
    '.sh': 'code',
    '.bash': 'code',
    '.zsh': 'code',
    '.html': 'code',
    '.css': 'code',
    '.scss': 'code',
    '.sass': 'code',
    '.less': 'code',
    '.vue': 'code',
    '.svelte': 'code',
    '.sql': 'code',
    '.json': 'code',
    '.xml': 'code',
    '.yaml': 'code',
    '.yml': 'code',
    '.toml': 'code',

    // Documentation files (use nomic-embed-text)
    '.md': 'markdown',
    '.txt': 'text',
    '.pdf': 'pdf',
    '.rst': 'text',
    '.adoc': 'text',
    '.tex': 'text'
};

/**
 * Language detection from file extension
 */
const LANGUAGE_MAP = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.cpp': 'c++',
    '.c': 'c',
    '.h': 'c',
    '.hpp': 'c++',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.r': 'r',
    '.m': 'objective-c',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.sql': 'sql',
    '.json': 'json',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml'
};

/**
 * Detect file type from file path
 * @param {string} filePath - Path to the file
 * @returns {'code' | 'markdown' | 'text' | 'pdf'} - Detected file type
 */
function detectFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return FILE_TYPE_MAP[ext] || 'text'; // Default to text for unknown extensions
}

/**
 * Detect programming language from file path
 * @param {string} filePath - Path to the file
 * @returns {string | null} - Detected language or null if not a code file
 */
function detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return LANGUAGE_MAP[ext] || null;
}

/**
 * Select appropriate embedding model based on file type and settings
 * @param {string} fileType - File type ('code', 'markdown', 'text', 'pdf')
 * @param {Object} settings - Settings object with ragConfig
 * @param {string} settings.ragConfig.codeEmbeddingModel - Code model name
 * @param {string} settings.ragConfig.textEmbeddingModel - Text model name
 * @param {string} settings.ragConfig.embeddingMode - 'auto' | 'manual-text' | 'manual-code'
 * @returns {string} - Ollama model name
 */
function selectEmbeddingModel(fileType, settings) {
    // Manual mode overrides
    if (settings?.ragConfig?.embeddingMode === 'manual-text') {
        return settings.ragConfig.textEmbeddingModel || DEFAULT_TEXT_MODEL;
    }
    if (settings?.ragConfig?.embeddingMode === 'manual-code') {
        return settings.ragConfig.codeEmbeddingModel || DEFAULT_CODE_MODEL;
    }

    // Auto mode: file-type based selection
    if (fileType === 'code') {
        return settings?.ragConfig?.codeEmbeddingModel || DEFAULT_CODE_MODEL;
    }
    return settings?.ragConfig?.textEmbeddingModel || DEFAULT_TEXT_MODEL;
}

/**
 * Check if file type is code
 * @param {string} fileType - File type to check
 * @returns {boolean}
 */
function isCodeFile(fileType) {
    return fileType === 'code';
}

/**
 * Get embedding dimension for model
 * All supported models use 1024 dimensions
 * @param {string} modelName - Ollama model name
 * @returns {number} - Embedding dimension
 */
function getEmbeddingDimension(modelName) {
    // All 1024D models (qwen3, arctic)
    return 1024;
}

/**
 * Prepare prompt for specific embedding model
 * Qwen3 models require <|endoftext|> token appended
 * @param {string} prompt - Original text prompt
 * @param {string} modelName - Ollama model name
 * @returns {string} - Prepared prompt
 */
function preparePromptForModel(prompt, modelName) {
    // Qwen3 models need special token
    if (modelName.includes('qwen3-embedding')) {
        return prompt + '<|endoftext|>';
    }
    // Other models use prompt as-is
    return prompt;
}

/**
 * Get list of available 1024D code embedding models
 * @returns {Array<Object>} - Array of model objects
 */
function getAvailableCodeModels() {
    return CODE_MODELS_1024D;
}

/**
 * Get list of available 1024D text embedding models
 * @returns {Array<Object>} - Array of model objects
 */
function getAvailableTextModels() {
    return TEXT_MODELS_1024D;
}

module.exports = {
    detectFileType,
    detectLanguage,
    selectEmbeddingModel,
    isCodeFile,
    getEmbeddingDimension,
    preparePromptForModel,        // NEW
    getAvailableCodeModels,       // NEW
    getAvailableTextModels,       // NEW
    DEFAULT_CODE_MODEL,           // NEW
    DEFAULT_TEXT_MODEL            // NEW
};
