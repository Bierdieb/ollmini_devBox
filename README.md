# Ollmini Devbox V0.2.0b

Modern desktop chat interface for Ollama with advanced AI features.

## Project Status

**Early Beta** - Developed with Claude Code, directed by [Bierdieb](https://github.com/Bierdieb)

This project is functional and well-suited for real-world use, though not entirely bug-free. Primary testing has been conducted with **gpt-oss:20b** and the recommended embedding models listed below.

**Key Strengths:**
- 📚 **Large-scale RAG:** Index and query massive amounts of text and code
- 🔍 **Intelligent Context:** AI-assisted utilization of extensive codebases and documentation
- 🛠️ **Code Generation:** Create and modify files through tool-based interactions
- 📄 **PDF Support:** Document indexing without image recognition (experimental)

**Use Cases:**
- Software development with large codebases
- Technical documentation analysis
- Research paper review and synthesis
- Multi-file code refactoring assistance

## Features

### Core Functionality
- **Advanced Markdown Rendering:** Syntax highlighting, think-block support, code copy buttons
- **System Tools:** Execute bash commands, read/write files with granular permission management
- **Chat History:** Save, load, and manage multiple conversations with timestamps
- **Token Analytics:** Real-time token usage tracking and context monitoring

### RAG (Retrieval-Augmented Generation)
- **Dual Embedding Models:** Separate optimized models for text and code
- **Code-Aware Chunking:** Smart chunking that respects code structure and syntax
- **Reranker Integration:** Advanced relevance scoring with BGE-reranker-v2-m3
- **Snapshot System:** Save, load, and append RAG databases for different projects
- **Multi-File Batch Indexing:** Efficient indexing of large document sets
- **PDF Support:** Document indexing without image recognition (experimental)

### Context Management
- **Pinned Messages:** Keep up to 5 important messages in active context
- **Pin Archiving:** Archive context pins to RAG for permanent storage
- **Dynamic Context Window:** Automatic context size adjustment per model

### AI Integration
- **WebSearch:** Built-in web search capabilities (Ollama API / Searx)
- **Think-Block Rendering:** Visualize model reasoning process (gpt-oss, qwen3)
- **Custom Modelfiles:** Optimized model templates with enhanced tool calling

## Tech Stack

- **Electron:** Desktop application framework
- **marked.js:** Markdown parsing
- **highlight.js:** Syntax highlighting
- **LanceDB:** Vector database for RAG
- **Ollama API:** LLM inference

---

## System Requirements

### Prerequisites
1. **Ollama:** Must be installed and running
   - Install from: https://ollama.ai/
   - Start service: `ollama serve`

2. **Node.js:** Version 16+ with npm
   - Install from: https://nodejs.org/

3. **At least one Ollama model:** Download before first use
   ```bash
   ollama pull gpt-oss:20b
   # OR
   ollama pull qwen3:14b
   ```

### Recommended Chat Models
- ✅ **gpt-oss:20b** - Primary recommendation (use custom modelfiles from `Models/` directory)
- ✅ **qwen3:14b** - Full functionality with think-block support

### Recommended Embedding Models (for RAG)

**Text Embedding (1024D):**
```bash
ollama pull snowflake-arctic-embed2:568m
```

**Code Embedding (1024D):**
```bash
ollama pull qwen3-embedding:0.6b
```

**Reranker (improves search relevance):**
```bash
ollama pull xitao/bge-reranker-v2-m3
```

**Default RAG Configuration:**
- Text Embedding: `snowflake-arctic-embed2:568m`
- Code Embedding: `qwen3-embedding:0.6b`
- Reranker: `xitao/bge-reranker-v2-m3`

---

## Installation

### 1. Navigate to UI Directory
```bash
cd UI
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Link CLI Command (Optional)
```bash
npm link
```

This creates the global `ollmini-devbox` command.

---

## Running the Application

### Production Mode
```bash
ollmini-devbox
```
*Requires `npm link` to be run first*

### Development Mode (with DevTools)
```bash
cd UI
npm run dev
```

---

## First-Time Setup

### 1. Configure Ollama Endpoint
- Click **Settings** (gear icon in header)
- Navigate to **Ollama Settings** tab
- Default endpoint: `http://localhost:11434`
- Update if your Ollama runs on a different host/port

### 2. Select a Model
- Models dropdown in header shows all available Ollama models
- Select your preferred model
- Model must support tool calling for full functionality

### 3. Configure RAG (Optional)
- Go to **Settings → RAG Settings**
- Text Embedding: `snowflake-arctic-embed2:568m` (default)
- Code Embedding: `qwen3-embedding:0.6b` (default)
- Reranker: `xitao/bge-reranker-v2-m3` (improves relevance)
- Configure chunk size (default: 512)
- Configure chunk overlap (default: 50)

### 4. Enable Code Mode (Default: ON)
- **Code Mode** button in header enables system tools
- Required for bash commands, file operations
- Permission dialogs will appear on first use

---

## Usage

### Basic Chat
1. Type your message in the input box
2. Press Enter or click Send
3. Model response appears in chat area

### System Tools
- **Code Mode must be enabled** (button in header)
- Tools require permission on first use:
  - **Allow Once:** Use tool this time only
  - **Always Allow:** Save permission for this project/model
  - **Deny:** Block tool execution

### RAG (Document Indexing)
1. Click **File Browser** icon in header
2. Navigate to desired directory
3. Click **Index for RAG**
4. Select files to index
5. Files are chunked and embedded into vector database
6. Relevant chunks are automatically retrieved for context

### Pinned Messages
- Click **Pin** button on any message bubble
- Pinned messages stay in context (max 5)
- View pins in **Pin Sidebar** (right side)
- Unpin or archive to RAG when needed

### Chat History
- **Save:** Name and save current conversation
- **Load:** Restore previous conversation
- **Delete:** Remove saved conversation
- History stored in localStorage

---

## Custom Model Setup

### 📦 Using Custom Modelfiles

Ollmini Devbox includes optimized **custom modelfiles** in the `Models/` directory for enhanced functionality:

**Available Custom Models:**
- `gpt-oss:20b_ollmini` - Optimized GPT-OSS with tool calling support
- `qwen3:14b_ollmini` - Optimized Qwen3 with think-block support

**Installation Methods:**

**Option 1: Auto-Setup (Localhost Ollama)**
1. Open **Settings → Ollama Settings**
2. Scroll to "Custom Model Setup" section
3. Select desired models from the list
4. Click "Apply Selected Models"
5. Wait for installation to complete

**Option 2: Manual Setup (Docker/Remote)**
```bash
# Example: Install gpt-oss custom model
ollama create gpt-oss:20b_ollmini < Models/gpt-oss_20b_Modelfile.txt
```

**For detailed setup instructions, see:** `Initial_Model_Setup.md`

**Note:** Custom modelfiles provide enhanced functionality including proper tool calling, think-block support, and optimized system prompts.

---

## Configuration

### Settings Location
All settings stored in browser localStorage:
- Key: `ollmini-devbox-settings`
- Persists between sessions

### Key Settings

**Model Settings:**
- `num_ctx`: Context window size (default: 30000)
- `thinkingLevel`: low/medium/high (for gpt-oss/qwen models)
- `showThinkingBlocks`: Display think-blocks (default: true)

**Ollama Settings:**
- `ollamaEndpoint`: API endpoint (default: `http://localhost:11434`)

**RAG Settings:**
- Text Embedding: `snowflake-arctic-embed2:568m` (default)
- Code Embedding: `qwen3-embedding:0.6b` (default)
- Reranker Model: `xitao/bge-reranker-v2-m3` (default, improves search relevance)
- Chunk Size: 256-2048 (default: 512)
- Chunk Overlap: 0-200 (default: 50)
- Semantic Chunking: Enabled/Disabled
- Retrieve Top K: 5-50 (default: 20)
- Rerank Top N: 1-10 (default: 3)

**WebSearch Settings:**
- Provider: 'ollama' or 'searx'
- API Key: Required for Ollama provider
- Searx URL: Required for self-hosted Searx

---

## Troubleshooting

**Model Not Found:**
- Check `Settings → Ollama Settings → Endpoint` is correct
- Verify Ollama is running: `ollama list`
- Ensure model is downloaded: `ollama pull <model>`

**Tools Not Working:**
- Ensure **Code Mode** button is active (enabled by default)
- Check permission dialogs aren't blocked
- Verify `.{modelname}/permissions.json` exists in working directory

**RAG Slow:**
- Check `FILE_BATCH_SIZE` in `rag-manager.js` (default: 20)
- Reduce chunk size in RAG settings
- Use faster embedding model

**Chat History Not Loading:**
- Check browser localStorage isn't full
- Key should be `ollmini-chat-history`
- Clear old chats to free space

**WebSearch Failing:**
- Verify API key (Ollama provider)
- Verify Searx URL (self-hosted)
- Check network connectivity

**App Won't Start:**
- Ensure Node.js 16+ installed: `node --version`
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check for port conflicts (Electron uses random ports)

---

## File Structure

```
Ollmini-Devbox-rc0.2.0b/
├── UI/
│   ├── src/              # Source files (36 modules)
│   ├── package.json      # Dependencies
│   └── package-lock.json # Dependency lock
├── Models/
│   └── gpt-oss_20b_Modelfile.txt  # Example model template
├── CHANGELOG.md          # Detailed change history
├── CLAUDE.md             # AI assistant guidance
├── LICENSE               # GPL v3 License
└── README.md             # This file
```

---

## Development

### Module Architecture
- **renderer.js:** Entry point, orchestrator
- **ollama-client.js:** API communication, streaming
- **message-renderer.js:** Message rendering, think-blocks
- **settings-manager.js:** Settings management
- **rag-manager.js:** Vector database integration
- **file-browser.js:** Directory browser, RAG snapshots
- **chat-history-manager.js:** Chat persistence
- **permission-manager.js:** Tool permission system
- **system-tool-executor.js:** Tool execution engine

**Pattern:** DOM Reference Injection + Settings Injection for clean separation

### CSS Structure
Modular CSS split into 8 ordered files:
1. `01-base.css` - Variables, resets
2. `02-layout.css` - Grid layout
3. `03-header.css` - Header styling
4. `04-sidebars.css` - Sidebar panels
5. `05-chat.css` - Chat messages
6. `06-markdown.css` - Markdown rendering
7. `07-modals.css` - Modal dialogs
8. `08-responsive.css` - Responsive design

**Load order is critical for proper CSS specificity**

---

## License

This project is licensed under the **GNU General Public License v3.0**.

See [LICENSE](LICENSE) file for full text.

---

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues on GitHub.

**Repository:** [github.com/Bierdieb/ollmini_devbox](https://github.com/Bierdieb/ollmini_devbox)

---

## Support

**Issues and Bug Reports:**
- GitHub Issues: [github.com/Bierdieb/ollmini_devbox/issues](https://github.com/Bierdieb/ollmini_devbox/issues)

**Development Documentation:**
- See [CLAUDE.md](CLAUDE.md) for technical implementation details
- See [CHANGELOG.md](CHANGELOG.md) for detailed change history
