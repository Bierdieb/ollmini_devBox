// RAG Manager Module
// Handles vector database operations for Retrieval-Augmented Generation

const { connect } = require('@lancedb/lancedb');
const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const MarkdownIt = require('markdown-it');
const pdfParse = require('pdf-parse');
const consoleHelper = require('./console-helper');
const embeddingStrategy = require('./embedding-strategy');
const codeChunking = require('./code-chunking');

const DB_PATH = path.join(app.getPath('userData'), 'rag_db');
const TABLE_NAME = 'vectors';
let OLLAMA_API_URL = 'http://localhost:11434'; // Will be updated from settings

// RAG Configuration Settings (updated from settings-manager)
let ragConfig = {
    // Embedding Models (1024D)
    textEmbeddingModel: 'snowflake-arctic-embed2:568m',
    codeEmbeddingModel: 'qwen3-embedding:0.6b',
    embeddingMode: 'auto',   // 'auto' | 'manual-text' | 'manual-code'
    dimension: 1024,
    rerankerModel: '',
    // Chunking
    chunkSize: 512,
    chunkOverlap: 50,
    semanticChunking: true,
    // Search
    retrieveTopK: 20,
    rerankTopN: 3,
    useReranking: false,
    // Tool Integration
    toolIntegrationEnabled: true,
    toolDefaultLimit: 3
};

let db;
let table;
let isInitialized = false;

// Indexing abort control
let indexingAborted = false;

// Get embeddings from Ollama API
// Supports model selection and qwen3 token handling
async function getOllamaEmbeddings(text, embeddingModel) {
    try {
        // Prepare prompt for model-specific requirements (e.g., qwen3 needs <|endoftext|>)
        const preparedPrompt = embeddingStrategy.preparePromptForModel(text, embeddingModel);

        const body = {
            model: embeddingModel,
            prompt: preparedPrompt
        };

        const response = await fetch(`${OLLAMA_API_URL}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            throw new Error(`Failed to get embeddings: ${response.statusText}`);
        }
        const data = await response.json();
        return data.embedding;
    } catch (error) {
        consoleHelper.error('Error getting Ollama embeddings:', error);
        throw error;
    }
}

// Get reranking score using Ollama Cross-Encoder via /api/embeddings endpoint
async function getOllamaRerankingScore(query, document) {
    try {
        // Use Cross-Encoder trick: Concatenate query+document, get embedding, calculate magnitude
        const response = await fetch(`${OLLAMA_API_URL}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: ragConfig.rerankerModel,
                prompt: `Query: ${query}\nDocument: ${document}`
            })
        });

        if (!response.ok) {
            consoleHelper.error(`❌ Reranker API failed: ${response.statusText}`);
            return 0;
        }

        const data = await response.json();

        // Calculate L2-norm (magnitude) of embedding as relevance score
        // Higher magnitude = higher relevance
        const embedding = data.embedding;
        const score = Math.sqrt(
            embedding.reduce((sum, val) => sum + val * val, 0)
        );

        return score;
    } catch (error) {
        consoleHelper.error('❌ Reranker score failed:', error);
        return 0;
    }
}

// Initialize LanceDB database
async function initializeDatabase() {
    if (isInitialized) {
        consoleHelper.log('📊 RAG Database: Already initialized.');
        return;
    }

    try {
        consoleHelper.log('📊 RAG Database: Initializing...');
        await fs.mkdir(DB_PATH, { recursive: true });
        db = await connect(DB_PATH);
        const tableNames = await db.tableNames();

        if (!tableNames.includes(TABLE_NAME)) {
            const initialData = [{
                vector: await getOllamaEmbeddings('initial vector', ragConfig.textEmbeddingModel),
                text: 'initial text',
                filePath: 'none',
                metadata: {
                    type: 'system',
                    source: 'initialization',
                    priority: 'normal',
                    scoreBoost: 0,
                    indexedAt: Date.now(),
                    pinnedAt: 0,         // Use 0 instead of null for schema inference
                    messageId: '',       // Use empty string instead of null for schema inference
                    tags: ['init'],      // Use array with element instead of empty array for schema inference
                    // NEW: Dual-embedding system fields
                    embeddingModel: 'nomic-embed-text:v1.5',
                    fileType: 'text',
                    codeContext: { language: '', functions: [''], classes: [''], imports: [''] } // LanceDB needs non-empty arrays for schema inference
                }
            }];
            table = await db.createTable(TABLE_NAME, initialData);
            consoleHelper.log('📊 RAG Database: Table created with extended metadata schema (dual-embedding support).');

            // Delete initial schema row to leave table empty
            await table.delete(`text = 'initial text'`);
            consoleHelper.log('📊 RAG Database: Initial schema row deleted, table is now empty.');
        } else {
            table = await db.openTable(TABLE_NAME);
            consoleHelper.log('📊 RAG Database: Table opened.');
        }

        isInitialized = true;
        consoleHelper.log('✅ RAG Database: Initialization complete.');
    } catch (error) {
        consoleHelper.error('❌ Failed to initialize RAG database:', error);
        throw error;
    }
}

// Ensure database is initialized before operations
async function ensureInitialized() {
    if (!isInitialized) {
        await initializeDatabase();
    }
}

/**
 * Semantic Chunking for Markdown files - Heading-aware parsing
 * Splits at heading boundaries to preserve document structure
 */
function chunkMarkdown(content, filePath) {
    const md = new MarkdownIt();
    const tokens = md.parse(content, {});

    const chunks = [];
    let currentChunk = '';
    let currentHeading = '';
    let currentLevel = 0;
    const maxChunkSize = ragConfig.chunkSize * 4; // tokens → chars estimate

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.type === 'heading_open') {
            // Save previous chunk before starting new section
            if (currentChunk.trim().length > 20) {
                chunks.push({
                    text: currentChunk.trim(),
                    heading: currentHeading,
                    level: currentLevel,
                    filePath
                });
            }

            // Extract heading level (h1 → 1, h2 → 2, etc.)
            currentLevel = parseInt(token.tag.slice(1));
            currentChunk = '';
        } else if (token.type === 'inline' && tokens[i - 1]?.type === 'heading_open') {
            // This is the heading text content
            currentHeading = token.content;
            currentChunk = `${'#'.repeat(currentLevel)} ${token.content}\n\n`;
        } else if (token.type !== 'heading_close') {
            // Accumulate content
            if (token.content) {
                currentChunk += token.content;
            }

            // Split large chunks at max size
            if (currentChunk.length > maxChunkSize) {
                // Find good break point (paragraph, newline)
                const breakPoint = currentChunk.lastIndexOf('\n\n', maxChunkSize);
                if (breakPoint > maxChunkSize / 2) {
                    chunks.push({
                        text: currentChunk.substring(0, breakPoint).trim(),
                        heading: currentHeading,
                        level: currentLevel,
                        filePath
                    });
                    currentChunk = currentChunk.substring(breakPoint).trim();
                }
            }
        }
    }

    // Add final chunk
    if (currentChunk.trim().length > 20) {
        chunks.push({
            text: currentChunk.trim(),
            heading: currentHeading,
            level: currentLevel,
            filePath
        });
    }

    consoleHelper.log(`📊 Markdown Chunking: ${content.length} chars → ${chunks.length} semantic chunks`);
    chunks.forEach((chunk, i) => {
        consoleHelper.log(`   ${i + 1}. ${chunk.heading || '(no heading)'} [level ${chunk.level}, ${chunk.text.length} chars]`);
    });

    return chunks.map(c => c.text); // Return text array for embedding
}

/**
 * Plain Text Chunking - Fixed-size chunks with overlap (legacy)
 * Used for non-Markdown files or when semantic chunking is disabled
 */
function chunkPlainText(text, maxTokens, overlapTokens) {
    // Rough estimate: 1 token ≈ 4 characters
    const maxChars = maxTokens * 4;
    const overlapChars = overlapTokens * 4;

    const chunks = [];
    let start = 0;

    while (start < text.length) {
        let end = Math.min(start + maxChars, text.length);

        // Try to break at sentence boundary
        if (end < text.length) {
            const sentenceEnd = text.lastIndexOf('.', end);
            const newlineEnd = text.lastIndexOf('\n', end);
            const breakPoint = Math.max(sentenceEnd, newlineEnd);

            if (breakPoint > start + (maxChars / 2)) {
                end = breakPoint + 1;
            }
        }

        const chunk = text.substring(start, end).trim();
        if (chunk.length > 20) { // Minimum chunk size
            chunks.push(chunk);
        }

        // Move start with overlap, but ensure forward progress
        const newStart = end - overlapChars;
        if (newStart <= start) {
            // If overlap would cause us to go backwards or stay in place, move forward
            start = end;
        } else {
            start = newStart;
        }

        if (start >= text.length) break;
    }

    consoleHelper.log(`📊 Plain Text Chunking: ${text.length} chars → ${chunks.length} chunks (max ${maxTokens} tokens, overlap ${overlapTokens})`);
    return chunks;
}

/**
 * Detect file type from extension
 * Returns: 'pdf', 'markdown', 'text'
 */
function detectFileType(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'md') return 'markdown';
    return 'text';
}

/**
 * Extract text from PDF file
 * Handles errors gracefully with detailed logging
 */
async function extractPDFText(filePath) {
    try {
        const dataBuffer = await fs.readFile(filePath); // Binary read, NOT utf-8
        const data = await pdfParse(dataBuffer);

        // Cleanup PDF-specific artifacts
        let text = data.text;

        // Remove page numbers (common pattern: "Page 1 of 10")
        text = text.replace(/Page \d+ of \d+/gi, '');

        // Normalize whitespace (PDFs often have weird line breaks)
        text = text.replace(/\s+/g, ' ');
        text = text.replace(/\n{3,}/g, '\n\n'); // Max 2 newlines

        consoleHelper.log(`📄 PDF Parsed: ${data.numpages} pages, ${text.length} chars extracted`);

        return {
            text: text.trim(),
            metadata: {
                pages: data.numpages,
                info: data.info || {}
            }
        };
    } catch (error) {
        // Specific error handling
        if (error.message?.includes('password')) {
            consoleHelper.error(`🔒 PDF is password-protected: ${filePath}`);
            throw new Error('PDF_PASSWORD_PROTECTED');
        }
        if (error.message?.includes('Invalid PDF')) {
            consoleHelper.error(`❌ Invalid or corrupted PDF: ${filePath}`);
            throw new Error('PDF_CORRUPTED');
        }
        consoleHelper.error(`❌ PDF parsing failed: ${filePath}`, error);
        throw new Error(`PDF_PARSE_ERROR: ${error.message}`);
    }
}

// Add documents to the vector database
async function addDocuments(filePaths, progressCallback = null) {
    await ensureInitialized();

    // Reset abort flag at start of new indexing operation
    indexingAborted = false;

    let totalChunks = 0;

    // Multi-file batching: Accumulate documents from multiple files before inserting
    // This dramatically reduces LanceDB index rebuild overhead (from 2510 inserts to ~125)
    const FILE_BATCH_SIZE = 20;  // Insert every 20 files to avoid ~40s index rebuilds
    let batchedDocuments = [];
    let batchStartTime = Date.now();

    for (let fileIndex = 0; fileIndex < filePaths.length; fileIndex++) {
        const filePath = filePaths[fileIndex];
        const fileName = path.basename(filePath);

        // Check for abort request
        if (indexingAborted) {
            consoleHelper.log(`🛑 Indexing aborted by user after ${fileIndex} files`);
            return {
                success: false,
                aborted: true,
                message: `Indexing stopped by user (${fileIndex}/${filePaths.length} files processed, ${totalChunks} chunks indexed)`
            };
        }

        consoleHelper.log(`📄 Indexing file: ${filePath}`);

        try {
            // Detect file type FIRST (use embeddingStrategy for dual-embedding support)
            const fileType = embeddingStrategy.detectFileType(filePath);
            let content;
            let pdfMetadata = null;

            // Read file based on type
            if (fileType === 'pdf') {
                try {
                    const pdfData = await extractPDFText(filePath);
                    content = pdfData.text;
                    pdfMetadata = pdfData.metadata;

                    // Progress callback for PDF
                    if (progressCallback) {
                        progressCallback({
                            phase: 'parsing',
                            fileIndex: fileIndex + 1,
                            totalFiles: filePaths.length,
                            fileName: fileName,
                            fileType: 'PDF',
                            pages: pdfMetadata.pages
                        });
                    }
                } catch (error) {
                    consoleHelper.error(`⚠️ Skipping PDF (${error.message}): ${fileName}`);

                    // Progress callback for skipped file
                    if (progressCallback) {
                        progressCallback({
                            phase: 'error',
                            fileIndex: fileIndex + 1,
                            totalFiles: filePaths.length,
                            fileName: fileName,
                            error: error.message
                        });
                    }

                    continue; // SKIP this file, continue with next
                }
            } else {
                // EXISTING CODE - unchanged for .md/.txt
                content = await fs.readFile(filePath, 'utf-8');
            }

            const fileSizeKB = (content.length / 1024).toFixed(1);

            // Notify: Starting to chunk file
            if (progressCallback && fileType !== 'pdf') {
                progressCallback({
                    phase: 'chunking',
                    fileIndex: fileIndex + 1,
                    totalFiles: filePaths.length,
                    fileName: fileName,
                    fileSize: `${fileSizeKB}KB`
                });
            }

            // Choose chunking strategy based on file type and settings
            let chunks;
            let codeChunksWithMetadata = null; // For code files, we get {text, metadata} objects

            if (fileType === 'code') {
                // Use intelligent code chunking (function/class boundaries)
                codeChunksWithMetadata = codeChunking.chunkCodeFile(
                    content,
                    filePath,
                    ragConfig.chunkSize * 4, // chars
                    ragConfig.chunkOverlap * 4
                );
                chunks = codeChunksWithMetadata.map(c => c.text);
                const language = embeddingStrategy.detectLanguage(filePath);
                consoleHelper.log(`   💻 Created ${chunks.length} code chunks from ${fileSizeKB}KB ${language} file`);
            } else if (fileType === 'markdown' && ragConfig.semanticChunking) {
                // Use heading-aware semantic chunking for Markdown files
                chunks = chunkMarkdown(content, filePath);
                consoleHelper.log(`   📝 Created ${chunks.length} semantic chunks from ${fileSizeKB}KB Markdown file`);
            } else {
                // Use plain text chunking for non-Markdown or when semantic chunking is disabled
                chunks = chunkPlainText(content, ragConfig.chunkSize, ragConfig.chunkOverlap);
                consoleHelper.log(`   📝 Created ${chunks.length} plain text chunks from ${fileSizeKB}KB ${fileType === 'pdf' ? 'PDF' : 'file'}`);
            }

            // Performance tracking
            const perfStart = Date.now();
            let embeddingTime = 0;
            let metadataTime = 0;

            // Select embedding model based on file type and settings
            const selectedEmbeddingModel = embeddingStrategy.selectEmbeddingModel(fileType, { ragConfig });
            consoleHelper.log(`   🧠 Embedding model: ${selectedEmbeddingModel}`);

            // Option 2: Create metadata template ONCE per file (reuse for all chunks)
            const baseMetadata = {
                type: 'file',
                source: 'indexed_file',
                priority: 'normal',
                scoreBoost: 0,
                indexedAt: Date.now(),
                pinnedAt: 0,
                messageId: '',
                tags: ['file'],
                // NEW: Dual-embedding system fields
                embeddingModel: selectedEmbeddingModel,
                fileType: fileType,
                codeContext: { language: '', functions: [], classes: [], imports: [] }
            };

            // Option 3: Parallel embedding with batching (5 concurrent requests)
            const BATCH_SIZE = 5;
            const documents = [];

            for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
                // Check for abort request during embedding batches
                if (indexingAborted) {
                    consoleHelper.log(`🛑 Indexing aborted during embedding (file ${fileIndex + 1}/${filePaths.length}, batch ${Math.floor(batchStart / BATCH_SIZE) + 1})`);
                    return {
                        success: false,
                        aborted: true,
                        message: `Indexing stopped by user (${fileIndex}/${filePaths.length} files processed, ${totalChunks} chunks indexed)`
                    };
                }

                const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
                const batchChunks = chunks.slice(batchStart, batchEnd);

                consoleHelper.log(`   🔢 Embedding batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (chunks ${batchStart + 1}-${batchEnd})...`);

                // Parallel embedding requests for this batch
                const embeddingPromises = batchChunks.map(async (chunk, i) => {
                    // Notify progress for first chunk in batch
                    if (i === 0 && progressCallback) {
                        progressCallback({
                            phase: 'embedding',
                            fileIndex: fileIndex + 1,
                            totalFiles: filePaths.length,
                            fileName: fileName,
                            chunkIndex: batchStart + i + 1,
                            totalChunks: chunks.length
                        });
                    }

                    // Option 1: Measure embedding time
                    const embedStart = Date.now();
                    const vector = await getOllamaEmbeddings(chunk, selectedEmbeddingModel);
                    embeddingTime += (Date.now() - embedStart);

                    // Option 1: Measure metadata creation time
                    const metaStart = Date.now();

                    // For code files, enrich metadata with code context
                    const chunkMetadata = { ...baseMetadata };
                    if (fileType === 'code' && codeChunksWithMetadata) {
                        const chunkIndex = batchStart + i;
                        const codeMetadata = codeChunksWithMetadata[chunkIndex]?.metadata;
                        if (codeMetadata) {
                            chunkMetadata.codeContext = {
                                language: codeMetadata.language || '',
                                functions: codeMetadata.functions || [],
                                classes: codeMetadata.classes || [],
                                imports: codeMetadata.imports || []
                            };
                        }
                    }

                    const document = {
                        vector,
                        text: chunk,
                        filePath: filePath,
                        metadata: chunkMetadata
                    };
                    metadataTime += (Date.now() - metaStart);

                    return document;
                });

                // Wait for all embeddings in this batch to complete
                const batchResults = await Promise.all(embeddingPromises);
                documents.push(...batchResults);
            }

            if (documents.length > 0) {
                // Add to batch instead of immediate insert
                batchedDocuments.push(...documents);
                totalChunks += documents.length;

                // Performance summary (per file, without DB insert time)
                const totalTime = Date.now() - perfStart;
                consoleHelper.log(`   ✅ Prepared ${documents.length} chunks from ${filePath}`);
                consoleHelper.log(`   ⏱️  Performance breakdown:`);
                consoleHelper.log(`      - Embedding API: ${(embeddingTime / 1000).toFixed(2)}s (${((embeddingTime / totalTime) * 100).toFixed(1)}%)`);
                consoleHelper.log(`      - Metadata creation: ${metadataTime}ms (${((metadataTime / totalTime) * 100).toFixed(2)}%)`);
                consoleHelper.log(`      - TOTAL: ${(totalTime / 1000).toFixed(2)}s`);

                // Batch insert every FILE_BATCH_SIZE files OR on last file
                const isLastFile = (fileIndex === filePaths.length - 1);
                const shouldFlushBatch = (batchedDocuments.length >= FILE_BATCH_SIZE * 10) || isLastFile;

                if (shouldFlushBatch && batchedDocuments.length > 0) {
                    const batchInsertStart = Date.now();
                    await table.add(batchedDocuments);
                    const batchInsertTime = Date.now() - batchInsertStart;
                    const batchTotalTime = Date.now() - batchStartTime;

                    consoleHelper.log(`\n📦 BATCH INSERT: ${batchedDocuments.length} chunks from ${Math.min(FILE_BATCH_SIZE, fileIndex + 1)} files`);
                    consoleHelper.log(`   ⏱️  Batch performance:`);
                    consoleHelper.log(`      - Database insert: ${(batchInsertTime / 1000).toFixed(2)}s`);
                    consoleHelper.log(`      - Total batch time: ${(batchTotalTime / 1000).toFixed(2)}s`);
                    consoleHelper.log(`      - Progress: ${fileIndex + 1}/${filePaths.length} files (${Math.round(((fileIndex + 1) / filePaths.length) * 100)}%)\n`);

                    // Reset batch
                    batchedDocuments = [];
                    batchStartTime = Date.now();
                }

                // Notify: File completed
                if (progressCallback) {
                    progressCallback({
                        phase: 'completed',
                        fileIndex: fileIndex + 1,
                        totalFiles: filePaths.length,
                        fileName: fileName,
                        chunks: documents.length
                    });
                }
            }
        } catch (error) {
            consoleHelper.error(`   ❌ Failed to index file ${filePath}:`, error);

            // Notify: Error occurred
            if (progressCallback) {
                progressCallback({
                    phase: 'error',
                    fileIndex: fileIndex + 1,
                    totalFiles: filePaths.length,
                    fileName: fileName,
                    error: error.message
                });
            }
        }
    }

    consoleHelper.log(`\n🎉 Indexing complete: ${totalChunks} total chunks from ${filePaths.length} file(s)`);
    return { success: true, message: `Indexing complete: ${totalChunks} chunks from ${filePaths.length} file(s).` };
}

/**
 * Add a pinned message directly to RAG
 * Separate from context pins - this is permanent storage
 */
async function addPinnedMessage(messageData) {
    await ensureInitialized();

    const { messageId, role, content, pinnedAt, tags } = messageData;

    consoleHelper.log(`🗄️ Indexing pinned ${role} message to RAG: ${messageId}`);

    try {
        const vector = await getOllamaEmbeddings(content, ragConfig.textEmbeddingModel);

        const document = {
            vector,
            text: content,
            filePath: `pinned_message_${messageId}`,
            metadata: {
                type: role === 'user' ? 'pinned_user' : 'pinned_assistant',
                source: 'rag_pin',
                priority: 'high',
                scoreBoost: 0.3,  // Pinned messages get relevance boost
                pinnedAt: pinnedAt || Date.now(),
                messageId: messageId,
                tags: (tags && tags.length > 0) ? tags : ['pinned'],  // Ensure non-empty array for schema
                // NEW: Dual-embedding system fields (pinned messages use default text model)
                embeddingModel: ragConfig.textEmbeddingModel,
                fileType: 'text',
                codeContext: { language: '', functions: [], classes: [], imports: [] }
            }
        };

        await table.add([document]);
        consoleHelper.log(`✅ Pinned message ${messageId} indexed to RAG`);

        return { success: true, messageId };
    } catch (error) {
        consoleHelper.error(`❌ Failed to index pinned message:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Remove a pinned message from RAG by messageId
 */
async function removePinnedMessage(messageId) {
    await ensureInitialized();

    consoleHelper.log(`🗑️ Removing pinned message from RAG: ${messageId}`);

    try {
        // LanceDB delete by filter
        await table.delete(`metadata.messageId = '${messageId}'`);

        consoleHelper.log(`✅ Removed pinned message ${messageId} from RAG`);
        return { success: true };
    } catch (error) {
        consoleHelper.error(`❌ Failed to remove pinned message:`, error);
        return { success: false, error: error.message };
    }
}

// Search for similar vectors with Dual-Embedding + 2-Stage Retrieval Pipeline
async function search(query) {
    await ensureInitialized();
    const startTime = Date.now();

    consoleHelper.log(`\n🔍 RAG Search initiated (Dual-Embedding + 2-Stage Retrieval)`);
    consoleHelper.log(`   Query: "${query.substring(0, 100)}${query.length > 100 ? '...' : ''}"`);
    consoleHelper.log(`   Embedding Models: Code=${ragConfig.codeEmbeddingModel} + Text=${ragConfig.textEmbeddingModel}`);
    consoleHelper.log(`   Stage 1 (Retrieve): Top-K = ${ragConfig.retrieveTopK} per model`);
    consoleHelper.log(`   Stage 2 (Rerank): ${ragConfig.useReranking ? `Top-N = ${ragConfig.rerankTopN}` : 'Disabled (direct Top-K)'}`);

    try {
        // RUNTIME VALIDATION: Check dimension compatibility (snapshots AND main database)
        const activeSnapshot = await getActiveSnapshot();
        const dbMetadata = await getCurrentDbMetadata();

        // Check snapshot OR main database
        const targetConfig = activeSnapshot.activeSnapshot && activeSnapshot.config
            ? activeSnapshot.config
            : dbMetadata.config;

        if (targetConfig && targetConfig.vectorDimension) {
            consoleHelper.log(activeSnapshot.activeSnapshot
                ? `   🔒 Active snapshot: "${activeSnapshot.activeSnapshot}"`
                : `   🔒 Main database validation`);

            // Validate vector dimension (only check dimension, not model - we use both!)
            const dimensionTestVector = await getOllamaEmbeddings('runtime dimension validation', ragConfig.textEmbeddingModel);
            if (dimensionTestVector.length !== targetConfig.vectorDimension) {
                const errorMsg = `❌ Dimension mismatch!\n\nDatabase requires: ${targetConfig.vectorDimension}D vectors\nCurrent models produce: ${dimensionTestVector.length}D vectors\n\nFix: Clear database and re-index, OR revert to:\n  Code: ${targetConfig.codeEmbeddingModel}\n  Text: ${targetConfig.textEmbeddingModel}`;
                consoleHelper.error(errorMsg);
                throw new Error(errorMsg);
            }
            consoleHelper.log(`   ✅ Runtime validation passed (${targetConfig.vectorDimension}D vectors)`);
        }

        // DUAL-QUERY: Create embeddings with BOTH models in parallel
        const embeddingStart = Date.now();
        const [codeQueryVector, textQueryVector] = await Promise.all([
            getOllamaEmbeddings(query, ragConfig.codeEmbeddingModel),
            getOllamaEmbeddings(query, ragConfig.textEmbeddingModel)
        ]);
        const embeddingDuration = Date.now() - embeddingStart;
        consoleHelper.log(`   ✅ Dual query embeddings: ${embeddingDuration}ms (both ${codeQueryVector.length}D)`);

        // Check if database has any documents before querying
        const rowCount = await table.countRows();
        if (rowCount === 0) {
            consoleHelper.log(`   ⚠️  Database is empty - no documents indexed yet`);
            const duration = Date.now() - startTime;
            consoleHelper.log(`   🎯 Total Pipeline: ${duration}ms | Database is empty\n`);

            return {
                results: [],
                duration: duration,
                sourcesCount: 0,
                chunksCount: 0,
                error: false,  // Not an error, just empty state
                message: 'RAG database is empty. Please index documents from the working directory first.'
            };
        }

        // Stage 1: Retrieve Top-K candidates using BOTH embeddings in parallel
        const searchStart = Date.now();
        const [codeResults, textResults] = await Promise.all([
            table.vectorSearch(codeQueryVector).distanceType('cosine').limit(ragConfig.retrieveTopK).toArray(),
            table.vectorSearch(textQueryVector).distanceType('cosine').limit(ragConfig.retrieveTopK).toArray()
        ]);
        const searchDuration = Date.now() - searchStart;

        consoleHelper.log(`   📊 Raw results: ${codeResults.length} from code model + ${textResults.length} from text model`);

        // Merge and deduplicate results from both searches
        // Use Map with unique key (filePath + text) to deduplicate
        const resultMap = new Map();

        // Add code results
        for (const result of codeResults) {
            const uniqueKey = `${result.filePath}::${result.text.substring(0, 100)}`;
            resultMap.set(uniqueKey, {
                ...result,
                _searchSource: 'code-model',
                _codeDistance: result._distance
            });
        }

        // Add text results, merging if duplicate
        for (const result of textResults) {
            const uniqueKey = `${result.filePath}::${result.text.substring(0, 100)}`;
            if (resultMap.has(uniqueKey)) {
                // Duplicate found - keep best distance (lowest = most similar)
                const existing = resultMap.get(uniqueKey);
                if (result._distance < existing._distance) {
                    resultMap.set(uniqueKey, {
                        ...result,
                        _searchSource: 'text-model-better',
                        _textDistance: result._distance,
                        _codeDistance: existing._codeDistance
                    });
                } else {
                    // Keep existing but record both distances
                    existing._textDistance = result._distance;
                    existing._searchSource = 'code-model-better';
                }
            } else {
                resultMap.set(uniqueKey, {
                    ...result,
                    _searchSource: 'text-model',
                    _textDistance: result._distance
                });
            }
        }

        // Convert Map back to array
        let resultsArray = Array.from(resultMap.values());

        // Log deduplication statistics
        const totalRaw = codeResults.length + textResults.length;
        const duplicates = totalRaw - resultsArray.length;
        consoleHelper.log(`   🔗 Merged & deduplicated: ${totalRaw} → ${resultsArray.length} unique chunks (${duplicates} duplicates removed)`);

        // Apply score boosting based on metadata (always applied)
        const boostedResults = resultsArray.map(r => {
            const baseScore = r._distance !== undefined ? (1 - r._distance) : 0;
            const boost = r.metadata?.scoreBoost || 0;
            const finalScore = Math.min(1.0, baseScore + boost);

            return {
                ...r,
                _originalScore: baseScore,
                score: finalScore
            };
        });

        // Sort by boosted score (highest first)
        boostedResults.sort((a, b) => b.score - a.score);
        resultsArray = boostedResults;

        consoleHelper.log(`   ✅ Stage 1 complete: ${searchDuration}ms (${resultsArray.length} candidates retrieved)`);

        // Stage 2: ML-based Reranking with Cross-Encoder if enabled
        if (ragConfig.useReranking && resultsArray.length > 0) {
            const rerankStart = Date.now();
            consoleHelper.log(`   🔄 Reranking ${resultsArray.length} candidates with ${ragConfig.rerankerModel}...`);

            // Batch processing: 5 concurrent reranking requests
            const BATCH_SIZE = 5;
            const rerankScored = [];

            for (let batchStart = 0; batchStart < resultsArray.length; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, resultsArray.length);
                const batchResults = resultsArray.slice(batchStart, batchEnd);

                const rerankPromises = batchResults.map(async (result) => {
                    const rerankScore = await getOllamaRerankingScore(query, result.text);
                    return {
                        ...result,
                        rerankScore: rerankScore
                    };
                });

                const batchScored = await Promise.all(rerankPromises);
                rerankScored.push(...batchScored);
            }

            // Sort by rerank score (highest first)
            rerankScored.sort((a, b) => b.rerankScore - a.rerankScore);

            // Take Top-N after reranking
            const candidatesCount = resultsArray.length;
            resultsArray = rerankScored.slice(0, ragConfig.rerankTopN);

            const rerankDuration = Date.now() - rerankStart;
            consoleHelper.log(`   ✅ Stage 2 complete: ${rerankDuration}ms (reranked ${candidatesCount} → ${resultsArray.length} results)`);
        } else if (!ragConfig.useReranking) {
            // No reranking - just take Top-N directly
            if (resultsArray.length > ragConfig.rerankTopN) {
                resultsArray = resultsArray.slice(0, ragConfig.rerankTopN);
                consoleHelper.log(`   📊 Direct Top-N selection: ${resultsArray.length} results (reranking disabled)`);
            }
        }

        // Count unique source files
        const uniqueSources = new Set(resultsArray.map(r => r.filePath));

        const duration = Date.now() - startTime;

        if (resultsArray.length > 0) {
            consoleHelper.log(`   📊 Final Results:`);
            resultsArray.forEach((r, i) => {
                const preview = r.text.substring(0, 80).replace(/\n/g, ' ');
                const boost = r.metadata?.scoreBoost || 0;
                const boostInfo = boost > 0 ? `, boost: +${boost.toFixed(2)}` : '';
                const rerankInfo = r.rerankScore ? `, rerank: ${r.rerankScore.toFixed(4)}` : '';
                consoleHelper.log(`      ${i + 1}. [base: ${r._originalScore?.toFixed(4)}, final: ${r.score.toFixed(4)}${boostInfo}${rerankInfo}] ${preview}...`);
            });
        } else {
            consoleHelper.log(`   ⚠️  No results found`);
        }

        consoleHelper.log(`   🎯 Total Pipeline: ${duration}ms | ${resultsArray.length} chunks from ${uniqueSources.size} files\n`);

        return {
            results: resultsArray.map(r => ({
                text: String(r.text || ''),
                filePath: String(r.filePath || ''),
                score: Number(r.score) || 0,
                metadata: r.metadata ? {
                    type: String(r.metadata.type || ''),
                    source: String(r.metadata.source || ''),
                    priority: String(r.metadata.priority || ''),
                    scoreBoost: Number(r.metadata.scoreBoost) || 0,
                    indexedAt: Number(r.metadata.indexedAt) || 0,
                    messageId: String(r.metadata.messageId || ''),
                    tags: Array.isArray(r.metadata.tags) ? r.metadata.tags.map(t => String(t)) : []
                } : undefined
            })),
            duration: Number(duration) || 0,
            sourcesCount: Number(uniqueSources.size) || 0,
            chunksCount: Number(resultsArray.length) || 0
        };
    } catch (error) {
        consoleHelper.error('   ❌ RAG search error:', error);
        return {
            results: [],
            duration: 0,
            sourcesCount: 0,
            chunksCount: 0,
            error: true,              // Flag to distinguish real errors from "no results"
            errorMessage: error.message
        };
    }
}

// Clear the entire database
async function clearDatabase() {
    await ensureInitialized();  // Ensure db is initialized before dropping table

    try {
        await db.dropTable(TABLE_NAME);
        consoleHelper.log('🗑️ RAG table dropped.');

        // Clear active snapshot tracking (database is now empty)
        await clearActiveSnapshot();

        // Reset initialization flag to force re-creation with new schema
        isInitialized = false;

        await initializeDatabase(); // Recreate with NEW schema (metadata included)
        return { success: true, message: 'Database cleared.' };
    } catch (error) {
        consoleHelper.error('Failed to clear RAG database:', error);
        return { success: false, error: error.message };
    }
}

// Get database statistics
async function getStats() {
    if (!isInitialized) return { count: 0 };
    await ensureInitialized();
    const count = await table.countRows();
    return { count };
}

// Update Ollama endpoint
function setOllamaEndpoint(endpoint) {
    OLLAMA_API_URL = endpoint;
    consoleHelper.log('🔧 RAG Manager: Ollama endpoint updated:', OLLAMA_API_URL);
}

// Update embedding model (deprecated - use setRagConfig instead)
function setEmbeddingModel(modelName) {
    ragConfig.textEmbeddingModel = modelName;
    consoleHelper.log('🔧 RAG Manager: Text embedding model updated:', ragConfig.textEmbeddingModel);
}

// Update RAG configuration
function setRagConfig(newConfig) {
    ragConfig = { ...ragConfig, ...newConfig };
    consoleHelper.log('🔧 RAG Manager: Configuration updated:', ragConfig);
}

// ============================================================================
// SNAPSHOT MANAGEMENT - Phase 1: Helper Functions
// ============================================================================

/**
 * Get the snapshots directory path
 * Creates directory if it doesn't exist
 */
function getSnapshotsDir() {
    const snapshotsDir = path.join(app.getPath('userData'), 'rag_snapshots');
    return snapshotsDir;
}

/**
 * Get active snapshot information
 * Returns { activeSnapshot: string|null, loadedAt: number|null, config: object|null }
 */
async function getActiveSnapshot() {
    try {
        const trackingFile = path.join(getSnapshotsDir(), '_active_snapshot.json');
        const data = await fs.readFile(trackingFile, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        // File doesn't exist or is invalid - return default state
        return {
            activeSnapshot: null,
            loadedAt: null,
            config: null
        };
    }
}

/**
 * Set active snapshot tracking
 * Saves snapshot name, load timestamp, and configuration
 */
async function setActiveSnapshot(snapshotName, config) {
    try {
        await fs.mkdir(getSnapshotsDir(), { recursive: true });
        const trackingFile = path.join(getSnapshotsDir(), '_active_snapshot.json');
        const data = {
            activeSnapshot: snapshotName,
            loadedAt: Date.now(),
            config: config
        };
        await fs.writeFile(trackingFile, JSON.stringify(data, null, 2), 'utf-8');
        consoleHelper.log(`✅ Active snapshot set to: ${snapshotName}`);
    } catch (error) {
        consoleHelper.error('❌ Failed to set active snapshot:', error);
        throw error;
    }
}

/**
 * Clear active snapshot tracking
 * Called when database is cleared or snapshot is unloaded
 */
async function clearActiveSnapshot() {
    try {
        const trackingFile = path.join(getSnapshotsDir(), '_active_snapshot.json');
        await fs.unlink(trackingFile);
        consoleHelper.log('✅ Active snapshot tracking cleared');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            // Ignore file-not-found errors, but log others
            consoleHelper.error('⚠️ Failed to clear active snapshot tracking:', error);
        }
    }
}

/**
 * Get current database metadata for snapshot creation
 * Includes model config, chunk counts, and fingerprint data
 */
async function getCurrentDbMetadata() {
    await ensureInitialized();

    // Generate test embedding for fingerprinting
    const testVector = await getOllamaEmbeddings('test embedding fingerprint', ragConfig.textEmbeddingModel);

    // Get database statistics
    const stats = await getStats();

    return {
        config: {
            textEmbeddingModel: ragConfig.textEmbeddingModel,
            codeEmbeddingModel: ragConfig.codeEmbeddingModel,
            embeddingMode: ragConfig.embeddingMode,
            vectorDimension: testVector.length,
            rerankerModel: ragConfig.rerankerModel || '',
            chunkSize: ragConfig.chunkSize,
            chunkOverlap: ragConfig.chunkOverlap,
            semanticChunking: ragConfig.semanticChunking,
            retrieveTopK: ragConfig.retrieveTopK,
            rerankTopN: ragConfig.rerankTopN,
            useReranking: ragConfig.useReranking,
            toolIntegrationEnabled: ragConfig.toolIntegrationEnabled,
            toolDefaultLimit: ragConfig.toolDefaultLimit
        },
        stats: {
            totalChunks: stats.count,
            createdAt: Date.now()
        },
        modelFingerprint: {
            testEmbeddingDim: testVector.length,
            sampleVector: testVector.slice(0, 3) // First 3 dimensions for validation
        }
    };
}

/**
 * List all available snapshots with metadata
 * @returns {Promise<Array>} - Array of snapshot objects with name, metadata, and stats
 */
async function listSnapshots() {
    try {
        const snapshotsDir = getSnapshotsDir();

        // Check if snapshots directory exists
        try {
            await fs.access(snapshotsDir);
        } catch {
            // Directory doesn't exist yet - return empty array
            return [];
        }

        const entries = await fs.readdir(snapshotsDir, { withFileTypes: true });
        const snapshots = [];

        for (const entry of entries) {
            // Skip tracking file and temp directories
            if (entry.name.startsWith('_')) {
                continue;
            }

            if (entry.isDirectory()) {
                const snapshotPath = path.join(snapshotsDir, entry.name);
                const metadataPath = path.join(snapshotPath, '_metadata.json');

                try {
                    const metadataContent = await fs.readFile(metadataPath, 'utf-8');
                    const metadata = JSON.parse(metadataContent);

                    // Get directory stats for size calculation
                    const stats = await fs.stat(snapshotPath);

                    snapshots.push({
                        name: entry.name,
                        metadata: metadata,
                        savedAt: metadata.savedAt,
                        chunks: metadata.stats.totalChunks,
                        textEmbeddingModel: metadata.config.textEmbeddingModel || 'outdated',
                        codeEmbeddingModel: metadata.config.codeEmbeddingModel || 'outdated',
                        embeddingMode: metadata.config.embeddingMode || 'unknown',
                        vectorDimension: metadata.config.vectorDimension
                    });
                } catch (error) {
                    consoleHelper.warn(`⚠️ Failed to read snapshot metadata for "${entry.name}":`, error.message);
                    // Skip this snapshot
                }
            }
        }

        // Sort by savedAt (newest first)
        snapshots.sort((a, b) => b.savedAt - a.savedAt);

        return snapshots;

    } catch (error) {
        consoleHelper.error('❌ Failed to list snapshots:', error);
        return [];
    }
}

/**
 * Get detailed information about a specific snapshot
 * @param {string} name - Name of the snapshot
 * @returns {Promise<object>} - { success: boolean, snapshot: object, error?: string }
 */
async function getSnapshotInfo(name) {
    try {
        const snapshotsDir = getSnapshotsDir();
        const snapshotPath = path.join(snapshotsDir, name);

        // Check if snapshot exists
        try {
            await fs.access(snapshotPath);
        } catch {
            return {
                success: false,
                error: `Snapshot "${name}" not found`
            };
        }

        // Load metadata
        const metadataPath = path.join(snapshotPath, '_metadata.json');
        const metadataContent = await fs.readFile(metadataPath, 'utf-8');
        const metadata = JSON.parse(metadataContent);

        return {
            success: true,
            snapshot: {
                name: name,
                path: snapshotPath,
                metadata: metadata
            }
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Check if a snapshot is compatible with current setup
 * @param {string} name - Name of the snapshot
 * @returns {Promise<object>} - { compatible: boolean, issues: Array<string>, metadata: object }
 */
async function checkSnapshotCompatibility(name) {
    try {
        const infoResult = await getSnapshotInfo(name);
        if (!infoResult.success) {
            return {
                compatible: false,
                issues: [infoResult.error],
                metadata: null
            };
        }

        const metadata = infoResult.snapshot.metadata;
        const issues = [];

        // Check if required models are installed (based on embedding mode)
        try {
            const response = await fetch(`${OLLAMA_API_URL}/api/tags`);
            if (response.ok) {
                const data = await response.json();
                const availableModels = data.models.map(m => m.name);

                const embeddingMode = metadata.config.embeddingMode || 'auto';
                const textModel = metadata.config.textEmbeddingModel;
                const codeModel = metadata.config.codeEmbeddingModel;

                // Determine which models are actually needed based on mode
                if (embeddingMode === 'auto') {
                    // Dual-embedding mode: Both models required
                    if (textModel && !availableModels.includes(textModel)) {
                        issues.push(`Required text embedding model not installed: ${textModel}`);
                    }
                    if (codeModel && !availableModels.includes(codeModel)) {
                        issues.push(`Required code embedding model not installed: ${codeModel}`);
                    }
                } else if (embeddingMode === 'manual-text') {
                    // Manual text mode: Only text model required
                    if (textModel && !availableModels.includes(textModel)) {
                        issues.push(`Required text embedding model not installed: ${textModel}`);
                    }
                } else if (embeddingMode === 'manual-code') {
                    // Manual code mode: Only code model required
                    if (codeModel && !availableModels.includes(codeModel)) {
                        issues.push(`Required code embedding model not installed: ${codeModel}`);
                    }
                }
            } else {
                issues.push('Failed to check model availability (Ollama API error)');
            }
        } catch (error) {
            issues.push(`Failed to check model availability: ${error.message}`);
        }

        // Try to test dimension compatibility (if model is available)
        if (issues.length === 0) {
            try {
                const testModel = metadata.config.textEmbeddingModel;
                const testVector = await getOllamaEmbeddings('compatibility test', testModel);

                if (testVector.length !== metadata.config.vectorDimension) {
                    issues.push(`Model version mismatch: expected ${metadata.config.vectorDimension}D, got ${testVector.length}D`);
                }
            } catch (error) {
                issues.push(`Failed to test embedding dimension: ${error.message}`);
            }
        }

        return {
            compatible: issues.length === 0,
            issues: issues,
            metadata: metadata
        };

    } catch (error) {
        return {
            compatible: false,
            issues: [error.message],
            metadata: null
        };
    }
}

/**
 * Delete a snapshot
 * @param {string} name - Name of the snapshot to delete
 * @returns {Promise<object>} - { success: boolean, message?: string, error?: string }
 */
async function deleteSnapshot(name) {
    consoleHelper.log(`🗑️ Deleting snapshot: "${name}"...`);

    try {
        const snapshotsDir = getSnapshotsDir();
        const snapshotPath = path.join(snapshotsDir, name);

        // Check if snapshot exists
        try {
            await fs.access(snapshotPath);
        } catch {
            return {
                success: false,
                error: `Snapshot "${name}" not found`
            };
        }

        // Check if this is the active snapshot
        const activeSnapshot = await getActiveSnapshot();
        if (activeSnapshot.activeSnapshot === name) {
            return {
                success: false,
                error: `Cannot delete active snapshot "${name}". Please load a different snapshot or clear the database first.`
            };
        }

        // Delete snapshot directory
        await fs.rm(snapshotPath, { recursive: true, force: true });
        consoleHelper.log(`✅ Snapshot "${name}" deleted`);

        return {
            success: true,
            message: `Snapshot "${name}" deleted successfully`
        };

    } catch (error) {
        consoleHelper.error(`❌ Failed to delete snapshot "${name}":`, error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Load a saved RAG snapshot
 * @param {string} name - Name of the snapshot to load
 * @param {object} options - Options: { skipBackup: boolean }
 * @returns {Promise<object>} - { success: boolean, name: string, config: object, message?: string, error?: string }
 */
async function loadSnapshot(name, options = {}) {
    consoleHelper.log(`📦 Loading RAG snapshot: "${name}"...`);

    try {
        const snapshotsDir = getSnapshotsDir();
        const snapshotPath = path.join(snapshotsDir, name);

        // Check if snapshot exists
        try {
            await fs.access(snapshotPath);
        } catch {
            return {
                success: false,
                error: `Snapshot "${name}" not found`
            };
        }

        // Load and validate metadata
        const metadataPath = path.join(snapshotPath, '_metadata.json');
        let metadata;
        try {
            const metadataContent = await fs.readFile(metadataPath, 'utf-8');
            metadata = JSON.parse(metadataContent);
        } catch (error) {
            return {
                success: false,
                error: `Failed to read snapshot metadata: ${error.message}`
            };
        }

        consoleHelper.log(`📋 Snapshot metadata loaded:`, metadata.config);

        // PRE-LOAD VALIDATION: Check snapshot format and required models
        const textModel = metadata.config.textEmbeddingModel;
        const codeModel = metadata.config.codeEmbeddingModel;
        const embeddingMode = metadata.config.embeddingMode || 'auto';
        const requiredDimension = metadata.config.vectorDimension;

        // Reject outdated snapshots without dual-model configuration
        if (!textModel || !codeModel) {
            return {
                success: false,
                error: `Snapshot format is outdated.\n\nThis snapshot was created with an older version.\nPlease re-index your documents.`
            };
        }

        consoleHelper.log(`🔍 Validating model compatibility...`);
        consoleHelper.log(`   Text model: ${textModel}`);
        consoleHelper.log(`   Code model: ${codeModel}`);
        consoleHelper.log(`   Mode: ${embeddingMode}`);
        consoleHelper.log(`   Required dimension: ${requiredDimension}D`);

        // Check if required models are installed
        try {
            const response = await fetch(`${OLLAMA_API_URL}/api/tags`);
            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.statusText}`);
            }
            const data = await response.json();
            const availableModels = data.models.map(m => m.name);

            if (!availableModels.includes(textModel)) {
                return {
                    success: false,
                    error: `Required text embedding model not installed: ${textModel}\n\nPlease install it first:\n  ollama pull ${textModel}`
                };
            }

            if (!availableModels.includes(codeModel)) {
                return {
                    success: false,
                    error: `Required code embedding model not installed: ${codeModel}\n\nPlease install it first:\n  ollama pull ${codeModel}`
                };
            }

            consoleHelper.log(`   ✅ Both models are installed`);
        } catch (error) {
            return {
                success: false,
                error: `Failed to check model availability: ${error.message}`
            };
        }

        // Test embedding dimension compatibility with text model
        consoleHelper.log(`🧪 Testing embedding dimension compatibility...`);
        try {
            const testVector = await getOllamaEmbeddings('dimension compatibility test', textModel);

            if (testVector.length !== requiredDimension) {
                return {
                    success: false,
                    error: `Model version mismatch!\n\nExpected: ${requiredDimension}D vectors\nGot: ${testVector.length}D vectors\n\nThe model "${textModel}" has a different version than the snapshot.\nPlease install the exact model version used to create this snapshot.`
                };
            }

            consoleHelper.log(`   ✅ Dimension matches: ${testVector.length}D`);
        } catch (error) {
            return {
                success: false,
                error: `Failed to test embedding dimension: ${error.message}`
            };
        }

        // Create auto-backup before loading (unless skipBackup is true)
        if (!options.skipBackup) {
            consoleHelper.log(`💾 Creating auto-backup before load...`);
            try {
                const currentStats = await getStats();
                if (currentStats.count > 0) {
                    const backupName = `_autosave_before_load_${Date.now()}`;
                    const backupResult = await saveSnapshot(backupName, { autoTimestamp: false });

                    if (!backupResult.success) {
                        consoleHelper.warn(`⚠️ Auto-backup failed: ${backupResult.error}`);
                        // Continue anyway, but log warning
                    } else {
                        consoleHelper.log(`   ✅ Auto-backup created: ${backupResult.name}`);
                    }
                }
            } catch (backupError) {
                consoleHelper.warn(`⚠️ Auto-backup error: ${backupError.message}`);
                // Continue anyway
            }
        }

        // Close current database
        consoleHelper.log(`🔒 Closing current database...`);
        if (table) {
            table = null;
        }
        if (db) {
            db = null;
        }
        isInitialized = false;

        // Delete current database
        consoleHelper.log(`🗑️ Removing current database...`);
        try {
            await fs.rm(DB_PATH, { recursive: true, force: true });
        } catch (error) {
            consoleHelper.warn(`⚠️ Failed to remove current database: ${error.message}`);
            // Continue anyway
        }

        // Load snapshot (copy snapshot to DB_PATH)
        consoleHelper.log(`📋 Copying snapshot to database location...`);
        try {
            await fs.cp(snapshotPath, DB_PATH, { recursive: true });
            consoleHelper.log(`   ✅ Snapshot loaded to database`);
        } catch (error) {
            return {
                success: false,
                error: `Failed to copy snapshot: ${error.message}`
            };
        }

        // Set active snapshot tracking
        await setActiveSnapshot(name, metadata.config);

        // Update current embedding models to match snapshot
        ragConfig.textEmbeddingModel = metadata.config.textEmbeddingModel;
        ragConfig.codeEmbeddingModel = metadata.config.codeEmbeddingModel;
        ragConfig.embeddingMode = metadata.config.embeddingMode || 'auto';
        consoleHelper.log(`🔧 Models set to: Text=${ragConfig.textEmbeddingModel}, Code=${ragConfig.codeEmbeddingModel}, Mode=${ragConfig.embeddingMode}`);

        // Re-initialize database
        consoleHelper.log(`🔓 Re-initializing database...`);
        await initializeDatabase();

        const finalStats = await getStats();
        consoleHelper.log(`🎉 Snapshot loaded successfully: "${name}" (${finalStats.count} chunks)`);

        return {
            success: true,
            name: name,
            config: metadata.config,
            message: `Snapshot "${name}" loaded with ${finalStats.count} chunks.\n\nSettings have been updated to match the snapshot configuration.`
        };

    } catch (error) {
        consoleHelper.error('❌ Failed to load snapshot:', error);

        // Try to re-initialize database even if load failed
        try {
            await initializeDatabase();
        } catch (initError) {
            consoleHelper.error('❌ CRITICAL: Failed to re-initialize database after error:', initError);
        }

        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Append/merge a snapshot into the current database
 * Adds all documents from snapshot that don't already exist (based on filePath)
 * @param {string} name - Snapshot name to append
 * @param {function} progressCallback - Optional callback for progress updates
 * @returns {Promise<object>} - { success: boolean, filesAdded: number, duplicatesSkipped: number, message?: string, error?: string }
 */
async function appendSnapshot(name, progressCallback = null) {
    consoleHelper.log(`📦 Appending snapshot: "${name}"...`);

    try {
        const snapshotsDir = getSnapshotsDir();
        const snapshotPath = path.join(snapshotsDir, name);

        // Check if snapshot exists
        try {
            await fs.access(snapshotPath);
        } catch {
            return {
                success: false,
                error: `Snapshot "${name}" not found`
            };
        }

        // Load and validate metadata
        const metadataPath = path.join(snapshotPath, '_metadata.json');
        let metadata;
        try {
            const metadataContent = await fs.readFile(metadataPath, 'utf-8');
            metadata = JSON.parse(metadataContent);
        } catch (error) {
            return {
                success: false,
                error: `Failed to read snapshot metadata: ${error.message}`
            };
        }

        consoleHelper.log(`📋 Snapshot metadata loaded:`, metadata.config);

        // VALIDATION: Check dimension compatibility (REQUIRED)
        const snapshotDimension = metadata.config.vectorDimension;
        const currentDimension = ragConfig.dimension || 1024;

        if (snapshotDimension !== currentDimension) {
            return {
                success: false,
                error: `Dimension mismatch!\n\nCurrent database: ${currentDimension}D\nSnapshot: ${snapshotDimension}D\n\nCannot merge snapshots with different dimensions.`
            };
        }

        consoleHelper.log(`✅ Dimension compatible: ${snapshotDimension}D`);

        // Validate snapshot has dual-model configuration
        const snapshotTextModel = metadata.config.textEmbeddingModel;
        const snapshotCodeModel = metadata.config.codeEmbeddingModel;

        if (!snapshotTextModel || !snapshotCodeModel) {
            return {
                success: false,
                error: `Snapshot format is outdated.\n\nThis snapshot was created with an older version.\nPlease re-index your documents.`
            };
        }

        // WARNING: Check model compatibility (warn but don't block)
        const currentModel = ragConfig.textEmbeddingModel;
        let modelWarning = null;

        if (snapshotTextModel !== currentModel) {
            modelWarning = `⚠️ Embedding model mismatch:\n\nCurrent: ${currentModel}\nSnapshot: ${snapshotTextModel}\n\nBoth are ${snapshotDimension}D but use different embedding spaces.\nSearch results may be inconsistent.`;
            consoleHelper.warn(modelWarning);
        }

        // Initialize current database if needed
        await ensureInitialized();

        // Extract all vectors from snapshot
        consoleHelper.log(`📖 Extracting vectors from snapshot...`);
        const snapshotVectors = await extractSnapshotVectors(snapshotPath, progressCallback);
        consoleHelper.log(`   Found ${snapshotVectors.length} documents in snapshot`);

        // Get existing file paths from current database
        consoleHelper.log(`🔍 Checking for duplicates...`);
        const existingPaths = await getExistingFilePaths();
        consoleHelper.log(`   Current database has ${existingPaths.size} unique file paths`);

        // Filter out duplicates
        const newDocuments = filterDuplicates(snapshotVectors, existingPaths);
        const duplicatesCount = snapshotVectors.length - newDocuments.length;

        consoleHelper.log(`   📊 Filtered: ${newDocuments.length} new, ${duplicatesCount} duplicates`);

        if (newDocuments.length === 0) {
            return {
                success: true,
                filesAdded: 0,
                duplicatesSkipped: duplicatesCount,
                message: `All ${snapshotVectors.length} documents from "${name}" are already indexed.\nNo new documents added.`,
                warning: modelWarning
            };
        }

        // Add new documents in batches
        consoleHelper.log(`➕ Adding ${newDocuments.length} new documents...`);
        const BATCH_SIZE = 500;
        let addedCount = 0;

        for (let i = 0; i < newDocuments.length; i += BATCH_SIZE) {
            const batch = newDocuments.slice(i, Math.min(i + BATCH_SIZE, newDocuments.length));
            await table.add(batch);
            addedCount += batch.length;

            if (progressCallback) {
                progressCallback({
                    phase: 'adding',
                    current: addedCount,
                    total: newDocuments.length,
                    snapshotName: name
                });
            }

            consoleHelper.log(`   Added batch: ${addedCount}/${newDocuments.length}`);
        }

        // Update active snapshots list
        await updateActiveSnapshotsList(name, 'add', {
            fileCount: newDocuments.length,
            model: snapshotModel,
            loadedAt: Date.now()
        });

        const finalStats = await getStats();
        consoleHelper.log(`✅ Snapshot appended: "${name}"`);
        consoleHelper.log(`   Files added: ${newDocuments.length}`);
        consoleHelper.log(`   Duplicates skipped: ${duplicatesCount}`);
        consoleHelper.log(`   Total database size: ${finalStats.count} chunks`);

        return {
            success: true,
            filesAdded: newDocuments.length,
            duplicatesSkipped: duplicatesCount,
            totalChunks: finalStats.count,
            message: `Snapshot "${name}" appended successfully!\n\n${newDocuments.length} new documents added\n${duplicatesCount} duplicates skipped\n\nTotal database size: ${finalStats.count} chunks`,
            warning: modelWarning
        };

    } catch (error) {
        consoleHelper.error('❌ Failed to append snapshot:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Extract all vectors from a snapshot database
 * @param {string} snapshotPath - Path to snapshot directory
 * @param {function} progressCallback - Optional progress callback
 * @returns {Promise<Array>} - Array of document objects
 */
async function extractSnapshotVectors(snapshotPath, progressCallback = null) {
    try {
        // Open snapshot database (read-only)
        const snapshotDb = await connect(snapshotPath);
        const tableNames = await snapshotDb.tableNames();

        if (!tableNames.includes(TABLE_NAME)) {
            throw new Error('Snapshot database has no vectors table');
        }

        const snapshotTable = await snapshotDb.openTable(TABLE_NAME);

        // Extract all documents
        if (progressCallback) {
            progressCallback({
                phase: 'extracting',
                message: 'Reading snapshot database...'
            });
        }

        const allVectors = await snapshotTable.query().toArray();

        consoleHelper.log(`   ✅ Extracted ${allVectors.length} vectors from snapshot`);
        return allVectors;

    } catch (error) {
        consoleHelper.error('❌ Failed to extract snapshot vectors:', error);
        throw error;
    }
}

/**
 * Get all existing file paths from current database
 * @returns {Promise<Set<string>>} - Set of file paths
 */
async function getExistingFilePaths() {
    try {
        const existingDocs = await table.query()
            .select(['filePath'])
            .toArray();

        const pathSet = new Set(existingDocs.map(doc => doc.filePath));
        return pathSet;

    } catch (error) {
        consoleHelper.error('❌ Failed to get existing file paths:', error);
        throw error;
    }
}

/**
 * Filter out documents that already exist in database
 * @param {Array} documents - Documents to filter
 * @param {Set<string>} existingPaths - Set of existing file paths
 * @returns {Array} - Filtered documents (only new ones)
 */
function filterDuplicates(documents, existingPaths) {
    return documents.filter(doc => !existingPaths.has(doc.filePath));
}

/**
 * Get list of active snapshots from localStorage
 * @returns {Promise<Array>} - Array of active snapshot objects
 */
async function getActiveSnapshots() {
    try {
        // Note: This will be called from renderer process via IPC
        // For now, return empty array (will be handled by renderer)
        return [];
    } catch (error) {
        consoleHelper.error('❌ Failed to get active snapshots:', error);
        return [];
    }
}

/**
 * Update active snapshots list
 * @param {string} snapshotName - Name of snapshot
 * @param {string} operation - 'add' or 'remove'
 * @param {object} snapshotInfo - Info about snapshot (fileCount, model, loadedAt)
 * @returns {Promise<void>}
 */
async function updateActiveSnapshotsList(snapshotName, operation, snapshotInfo = {}) {
    // This will be handled primarily in renderer process (localStorage)
    // Backend just logs for now
    consoleHelper.log(`📝 Active snapshots list updated: ${operation} "${snapshotName}"`);
}

/**
 * Save current RAG database as a snapshot
 * @param {string} name - User-provided name for the snapshot
 * @param {object} options - Options: { autoTimestamp: boolean }
 * @returns {Promise<object>} - { success: boolean, name: string, path: string, message?: string, error?: string }
 */
async function saveSnapshot(name, options = {}) {
    consoleHelper.log(`💾 Saving RAG snapshot: "${name}"...`);

    try {
        // Validate database is initialized and has content
        await ensureInitialized();
        const stats = await getStats();

        if (stats.count === 0) {
            consoleHelper.warn('⚠️ Database is empty, cannot create snapshot');
            return {
                success: false,
                error: 'Database is empty. Index some documents first.'
            };
        }

        // Generate metadata with model fingerprinting
        const metadata = await getCurrentDbMetadata();

        // Add snapshot-specific metadata
        metadata.snapshotName = name;
        metadata.savedAt = Date.now();

        // Auto-timestamp if requested
        let finalName = name;
        if (options.autoTimestamp) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            finalName = `${name}_${timestamp}`;
        }

        // Ensure snapshots directory exists
        const snapshotsDir = getSnapshotsDir();
        await fs.mkdir(snapshotsDir, { recursive: true });

        // Handle naming conflicts
        let snapshotPath = path.join(snapshotsDir, finalName);
        let counter = 1;
        while (true) {
            try {
                await fs.access(snapshotPath);
                // Path exists, try with counter
                finalName = `${name}_${counter}`;
                snapshotPath = path.join(snapshotsDir, finalName);
                counter++;
            } catch {
                // Path doesn't exist, we can use it
                break;
            }
        }

        consoleHelper.log(`📂 Snapshot path: ${snapshotPath}`);

        // CRITICAL: Close database before copying
        consoleHelper.log('🔒 Closing database for safe copy...');
        if (table) {
            // LanceDB doesn't have explicit close, but we can clean up references
            table = null;
        }
        if (db) {
            db = null;
        }
        isInitialized = false;

        // Transactional copy: temp directory -> atomic rename
        const tempPath = path.join(snapshotsDir, `_temp_${Date.now()}`);
        consoleHelper.log(`🔄 Copying database to temp location...`);

        try {
            await fs.cp(DB_PATH, tempPath, { recursive: true });
            consoleHelper.log(`✅ Copy complete, renaming to final location...`);

            // Atomic rename
            await fs.rename(tempPath, snapshotPath);
            consoleHelper.log(`✅ Snapshot directory created: ${finalName}`);
        } catch (copyError) {
            // Cleanup temp directory on failure
            try {
                await fs.rm(tempPath, { recursive: true, force: true });
            } catch {}
            throw copyError;
        }

        // Save metadata file
        const metadataPath = path.join(snapshotPath, '_metadata.json');
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
        consoleHelper.log(`📝 Metadata saved`);

        // Re-initialize database after copy
        consoleHelper.log('🔓 Re-initializing database...');
        await initializeDatabase();

        consoleHelper.log(`🎉 Snapshot saved successfully: "${finalName}"`);

        return {
            success: true,
            name: finalName,
            path: snapshotPath,
            message: `Snapshot "${finalName}" created with ${stats.count} chunks`
        };

    } catch (error) {
        consoleHelper.error('❌ Failed to save snapshot:', error);

        // Try to re-initialize database even if save failed
        try {
            await initializeDatabase();
        } catch (initError) {
            consoleHelper.error('❌ CRITICAL: Failed to re-initialize database after error:', initError);
        }

        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Abort ongoing indexing operation
 * Sets flag that will be checked during file and batch processing
 */
function abortIndexing() {
    consoleHelper.log('🛑 Indexing abort requested');
    indexingAborted = true;
    return { success: true };
}

// Cleanup function for graceful shutdown
function cleanup() {
    try {
        consoleHelper.log('[RAG] Cleanup: Starting graceful shutdown...');

        // Abort any ongoing indexing operations
        if (indexingAborted === false) {
            abortIndexing();
        }

        // Clear database references (LanceDB doesn't have explicit close)
        db = null;
        table = null;
        isInitialized = false;

        consoleHelper.log('[RAG] Cleanup completed');
        return { success: true };
    } catch (error) {
        consoleHelper.error('[RAG] Cleanup error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Validate if new embedding models are compatible with existing database
 * Prevents users from setting incompatible model combinations that would break RAG
 *
 * @param {string} newTextModel - New text embedding model to validate
 * @param {string} newCodeModel - New code embedding model to validate
 * @returns {Promise<Object>} Validation result with compatibility status
 */
async function validateEmbeddingModelCompatibility(newTextModel, newCodeModel) {
    try {
        consoleHelper.log(`[RAG Validation] Checking compatibility: Text=${newTextModel}, Code=${newCodeModel}`);

        // 1. Check if database exists and has content
        const dbMetadata = await getCurrentDbMetadata();

        // No database or empty database - always compatible (first time setup)
        if (!dbMetadata.config || dbMetadata.stats.totalChunks === 0) {
            consoleHelper.log(`[RAG Validation] ✅ No database content - compatible (first time setup)`);
            return {
                compatible: true,
                hasDatabaseContent: false
            };
        }

        consoleHelper.log(`[RAG Validation] Database has ${dbMetadata.stats.totalChunks} chunks`);
        consoleHelper.log(`[RAG Validation] Current DB dimension: ${dbMetadata.config.vectorDimension}D`);

        // 2. Get dimensions of new models by creating test embeddings
        const newTextVector = await getOllamaEmbeddings('dimension test', newTextModel);
        const newCodeVector = await getOllamaEmbeddings('dimension test', newCodeModel);

        consoleHelper.log(`[RAG Validation] New text model dimension: ${newTextVector.length}D`);
        consoleHelper.log(`[RAG Validation] New code model dimension: ${newCodeVector.length}D`);

        // 3. Get current database dimensions
        const currentTextDim = dbMetadata.config.vectorDimension;

        // 4. Compare dimensions
        const textModelCompatible = newTextVector.length === currentTextDim;
        const codeModelCompatible = newCodeVector.length === currentTextDim;

        const overallCompatible = textModelCompatible && codeModelCompatible;

        consoleHelper.log(`[RAG Validation] Text model compatible: ${textModelCompatible}`);
        consoleHelper.log(`[RAG Validation] Code model compatible: ${codeModelCompatible}`);
        consoleHelper.log(`[RAG Validation] Overall result: ${overallCompatible ? '✅ COMPATIBLE' : '❌ INCOMPATIBLE'}`);

        return {
            compatible: overallCompatible,
            hasDatabaseContent: true,
            currentDimension: currentTextDim,
            newTextModelDimension: newTextVector.length,
            newCodeModelDimension: newCodeVector.length,
            currentTextModel: dbMetadata.config.textEmbeddingModel,
            currentCodeModel: dbMetadata.config.codeEmbeddingModel,
            newTextModel: newTextModel,
            newCodeModel: newCodeModel,
            databaseChunks: dbMetadata.stats.totalChunks
        };
    } catch (error) {
        consoleHelper.error('[RAG Validation] ❌ Validation failed:', error);
        return {
            compatible: false,
            error: error.message,
            hasDatabaseContent: true
        };
    }
}

module.exports = {
    initializeDatabase,
    addDocuments,
    abortIndexing,         // NEW: Abort ongoing indexing
    cleanup,               // NEW: Graceful shutdown cleanup
    addPinnedMessage,      // NEW: Pin messages to RAG
    removePinnedMessage,   // NEW: Remove pinned messages from RAG
    search,
    clearDatabase,
    getStats,
    setOllamaEndpoint,
    setEmbeddingModel,
    setRagConfig,          // NEW: Update RAG chunking configuration
    // Snapshot Management Functions
    getSnapshotsDir,
    getActiveSnapshot,
    setActiveSnapshot,
    clearActiveSnapshot,
    getCurrentDbMetadata,
    saveSnapshot,
    loadSnapshot,
    appendSnapshot,        // NEW: Append/merge snapshot into current database
    getActiveSnapshots,    // NEW: Get list of active snapshots
    listSnapshots,
    getSnapshotInfo,
    checkSnapshotCompatibility,
    deleteSnapshot,
    validateEmbeddingModelCompatibility  // NEW: Validate model compatibility before changes
};
