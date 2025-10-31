# Ollmini-Devbox MCP Test Suite
## Comprehensive Testing Strategy Document

**Version:** 0.2.0b
**Created:** 2025-10-30
**Purpose:** Define comprehensive testing approach using Electron MCP tools for real-world usage validation
**Testing Method:** 100% via Electron MCP tools (`mcp__electron-mcp-server__*`)

---

## Table of Contents

1. [Test Strategy Overview](#test-strategy-overview)
2. [Testing Philosophy](#testing-philosophy)
3. [MCP Tool Reference](#mcp-tool-reference)
4. [Environment Setup](#environment-setup)
5. [Test Scenarios](#test-scenarios)
6. [Execution Phases](#execution-phases)
7. [Test Results Template](#test-results-template)
8. [Issue Classification](#issue-classification)

---

## Test Strategy Overview

### Objectives

1. **Validate Real-World Usage:** Test application under realistic development workflows
2. **Stress Test Critical Features:** RAG, WebSearch, Tool Calls, Context Management
3. **Identify Breaking Issues:** Bugs that prevent core functionality
4. **Performance Benchmarking:** Measure response times, indexing speed, context limits
5. **UX Validation:** Ensure UI behaves as expected under load

### Scope

**In-Scope:**
- Chat functionality (basic and streaming)
- RAG indexing and retrieval
- WebSearch integration (both providers)
- Tool execution (bash, read, write, etc.)
- Context management (pinning, history)
- Chat history persistence
- Settings management
- UI interactions (buttons, sidebars, modals)

**Out-of-Scope:**
- Network connectivity issues (Ollama server down)
- Ollama model quality (hallucinations, poor responses)
- OS-specific bugs beyond Linux
- Browser/Electron version compatibility

### Failure Handling Philosophy

**Adaptive Testing Approach:**

1. **Single failure ≠ test failure**
   - If model fails to call a tool correctly, retry with modified prompt
   - If web search returns no results, try different query
   - If RAG doesn't find context, verify indexing occurred

2. **Intelligent retry logic**
   - Retry up to 3 times with increasingly explicit prompts
   - Document what worked vs. what didn't
   - Adjust test expectations based on model capabilities

3. **Model-aware testing**
   - llama3.2, qwen2.5-coder, mistral-small3: Full functionality expected
   - gpt-oss: Limited tool calling, document limitations
   - Unknown models: Graceful degradation expected

4. **Success criteria**
   - Feature works at least 2/3 attempts with good prompts
   - Error messages are clear and actionable
   - No silent failures or data corruption

### Success Criteria

**Critical (Must Pass):**
- Basic chat sends and receives responses
- Settings persist across sessions
- Chat history saves and loads correctly
- RAG indexing completes without crashes
- Tool permissions are enforced

**Major (Should Pass):**
- RAG retrieval augments responses correctly
- WebSearch returns relevant results
- Tool calls execute and return outputs
- Context window tracking is accurate
- Pinned messages persist in conversation

**Minor (Nice to Have):**
- Think-block rendering works for supported models
- UI animations and transitions are smooth
- Dashboard analytics are accurate
- Snapshot management works correctly

---

## Testing Philosophy

### Real-World Focus

Tests simulate actual developer workflows:

- "Index this codebase and explain its architecture"
- "Search for latest Electron security best practices and implement them"
- "Create a multi-file Node.js project with tests"
- "Debug this error message by searching docs and modifying code"

### Resilience Over Brittleness

Tests should:
- Tolerate model variability (different response phrasings)
- Adapt to UI timing (wait for elements, animations)
- Verify intent over exact output (files created vs. exact content)
- Focus on outcomes (project works) over process (specific tool sequence)

### Documentation Over Automation

Since this is a desktop app with AI, we prioritize:
- Clear test procedure documentation
- Manual verification checkpoints
- Screenshot evidence of UI state
- Reproducible test steps for debugging

---

## MCP Tool Reference

### Available MCP Tools

#### 1. `mcp__electron-mcp-server__get_electron_window_info`

**Purpose:** Check application state and window information

**Usage:**
```javascript
{
  "includeChildren": true  // Optional: include child windows
}
```

**Returns:**
- Window title
- URL
- Process info
- Child window details

**When to use:**
- Verify app is running
- Check current view/modal state
- Debug window focus issues

---

#### 2. `mcp__electron-mcp-server__take_screenshot`

**Purpose:** Capture visual state of application

**Usage:**
```javascript
{
  "windowTitle": "Ollmini Devbox",  // Optional: specific window
  "outputPath": "/path/to/save.png"  // Optional: save to file
}
```

**Returns:** Base64 image data or file path

**When to use:**
- Document test results
- Verify UI rendering
- Capture errors/bugs visually
- Before/after comparisons

---

#### 3. `mcp__electron-mcp-server__send_command_to_electron`

**Purpose:** Execute JavaScript or interact with UI elements

**Command Types:**

**A. UI Interaction Commands:**

| Command | Args | Description |
|---------|------|-------------|
| `find_elements` | None | List all interactive elements (buttons, inputs) |
| `click_by_text` | `{text: "Submit"}` | Click element by visible text/aria-label |
| `click_by_selector` | `{selector: "#sendBtn"}` | Click element by CSS selector |
| `fill_input` | `{selector: "#messageInput", value: "hello"}` | Fill input field |
| `send_keyboard_shortcut` | `{text: "Enter"}` | Send keyboard shortcuts |
| `navigate_to_hash` | `{text: "#settings"}` | Navigate to hash routes |
| `get_page_structure` | None | Get organized overview of page elements |
| `debug_elements` | None | Debug info about buttons/forms |

**B. Information Commands:**

| Command | Description |
|---------|-------------|
| `get_title` | Get page title |
| `get_url` | Get current URL |
| `get_body_text` | Get all visible text |

**C. Custom JavaScript:**

```javascript
{
  "command": "eval",
  "args": {
    "code": "document.getElementById('statusText').textContent"
  }
}
```

**When to use:**
- Send prompts to chat
- Click buttons (Code Mode, WebSearch, Settings)
- Verify UI state (button classes, text content)
- Read localStorage/application state

---

#### 4. `mcp__electron-mcp-server__read_electron_logs`

**Purpose:** Read console and process logs

**Usage:**
```javascript
{
  "logType": "console",  // or "main", "renderer", "all"
  "lines": 100,          // Number of recent lines
  "follow": false        // Whether to tail logs
}
```

**When to use:**
- Check for JavaScript errors
- Verify API calls are made
- Debug tool execution
- Monitor RAG operations

---

### Key MCP Interaction Patterns

#### Pattern 1: Send Message and Wait for Response

```javascript
// 1. Click input field
send_command_to_electron({
  command: "click_by_selector",
  args: { selector: "#messageInput" }
})

// 2. Fill message
send_command_to_electron({
  command: "fill_input",
  args: { selector: "#messageInput", value: "Hello, model!" }
})

// 3. Send message
send_command_to_electron({
  command: "send_keyboard_shortcut",
  args: { text: "Enter" }
})

// 4. Wait 3-5 seconds (adjust for model speed)
// 5. Check for response in chat container
send_command_to_electron({
  command: "eval",
  args: { code: "document.getElementById('chatContainer').textContent" }
})
```

---

#### Pattern 2: Toggle Feature Button

```javascript
// Get current state
send_command_to_electron({
  command: "eval",
  args: { code: "document.getElementById('codeModeToggle').classList.contains('active')" }
})

// Click to toggle
send_command_to_electron({
  command: "click_by_selector",
  args: { selector: "#codeModeToggle" }
})

// Verify state changed
send_command_to_electron({
  command: "eval",
  args: { code: "document.getElementById('codeModeToggle').classList.contains('active')" }
})
```

---

#### Pattern 3: Open Settings Modal

```javascript
// Click settings button
send_command_to_electron({
  command: "click_by_selector",
  args: { selector: "#settingsBtn" }
})

// Wait for modal to appear
// Verify modal is visible
send_command_to_electron({
  command: "eval",
  args: { code: "document.getElementById('settingsModal').style.display === 'flex'" }
})

// Interact with settings
send_command_to_electron({
  command: "click_by_text",
  args: { text: "RAG Settings" }
})
```

---

#### Pattern 4: Index Files for RAG

```javascript
// 1. Open Working Directory sidebar
send_command_to_electron({
  command: "click_by_selector",
  args: { selector: "#workingDirBtn" }
})

// 2. Navigate to directory (if needed)
send_command_to_electron({
  command: "eval",
  args: { code: "document.getElementById('cwd-display').textContent" }
})

// 3. Click Index for RAG button
send_command_to_electron({
  command: "click_by_selector",
  args: { selector: "#index-files-btn" }
})

// 4. Select files in modal (checkboxes)
send_command_to_electron({
  command: "eval",
  args: { code: "document.querySelectorAll('#pre-index-file-list input[type=checkbox]')[0].click()" }
})

// 5. Confirm indexing
send_command_to_electron({
  command: "click_by_selector",
  args: { selector: "#pre-index-continue-btn" }
})

// 6. Monitor progress
send_command_to_electron({
  command: "eval",
  args: { code: "document.getElementById('rag-status').textContent" }
})
```

---

#### Pattern 5: Verify Tool Execution

```javascript
// 1. Send prompt requiring tool call
// (already sent via Pattern 1)

// 2. Check for permission dialog
send_command_to_electron({
  command: "eval",
  args: { code: "document.getElementById('permissionModal').style.display === 'flex'" }
})

// 3. Approve tool (if dialog appears)
send_command_to_electron({
  command: "click_by_selector",
  args: { selector: "#allow-once" }
})

// 4. Wait for tool execution
// 5. Verify tool output bubble exists
send_command_to_electron({
  command: "eval",
  args: { code: "document.querySelectorAll('.tool-result').length > 0" }
})

// 6. Read tool output
send_command_to_electron({
  command: "eval",
  args: { code: "document.querySelector('.tool-result').textContent" }
})
```

---

#### Pattern 6: Check Context Usage

```javascript
// Get context text display
send_command_to_electron({
  command: "eval",
  args: { code: "document.getElementById('contextText').textContent" }
})

// Should return something like: "Context: 1,234 / 128,000"

// Get context bar fill percentage
send_command_to_electron({
  command: "eval",
  args: { code: "document.getElementById('contextBarFill').style.width" }
})
```

---

#### Pattern 7: Read Console Logs

```javascript
read_electron_logs({
  logType: "console",
  lines: 50
})

// Look for patterns:
// - "✅" = success messages
// - "❌" = error messages
// - "RAG" = RAG operations
// - "Tool" = tool execution
// - "WebSearch" = web search calls
```

---

## Environment Setup

### Prerequisites Checklist

Before starting tests, verify:

1. **Ollama Service Running:**
   ```bash
   curl http://192.168.122.1:11434/api/tags
   ```
   Should return list of models (JSON)

2. **At Least One Compatible Model:**
   Recommended: `llama3.2:latest`, `qwen2.5-coder:14b`, or `mistral-small3:latest`
   ```bash
   ollama list
   ```

3. **Ollmini-Devbox Application Running:**
   Start via: `cd UI && npm run dev`

4. **Working Directory Set:**
   Use test directory: `/tmp/ollmini-test/` (create if needed)

5. **Clean State (Optional):**
   - Clear localStorage: Run in DevTools console: `localStorage.clear()`
   - Clear RAG database: Settings → Advanced → Reset All RAG Databases
   - Clear chat history: Settings → Advanced → Reset All Chats

### Test Environment Configuration

**Recommended Settings for Testing:**

```javascript
// Apply via Settings UI or DevTools console
const testConfig = {
  ollamaEndpoint: "http://192.168.122.1:11434",
  num_ctx: 40000,  // Good balance for gpt-oss:20atlas
  temperature: 0.7,
  typewriterEffect: false,  // Faster testing
  autoScroll: true,
  showThinkingBlocks: true,
  ragConfig: {
    textEmbeddingModel: "snowflake-arctic-embed2:568m",
    codeEmbeddingModel: "qwen3-embedding:0.6b",
    chunkSize: 512,
    chunkOverlap: 50,
    retrieveTopK: 20,
    rerankTopN: 3,
    useReranking: false  // For faster testing
  },
  webSearchProvider: "ollama",  // Or "searx" if available
  webSearchApiKey: "YOUR_API_KEY"  // If using ollama provider
};

localStorage.setItem('ollmini-devbox-settings', JSON.stringify(testConfig));
```

### Test Data Preparation

Create test directory structure:

```bash
mkdir -p /tmp/ollmini-test/
cd /tmp/ollmini-test/

# Create sample files for RAG testing
cat > README.md << 'EOF'
# Test Project
This is a test project for Ollmini-Devbox testing.
Version: 1.0.0
Author: Test Suite
EOF

cat > package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0",
  "description": "Test project for RAG indexing",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "echo 'No tests defined'"
  }
}
EOF

cat > index.js << 'EOF'
// Main entry point
console.log("Hello from test project!");

function greet(name) {
  return `Hello, ${name}!`;
}

module.exports = { greet };
EOF

cat > utils.js << 'EOF'
// Utility functions
function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

module.exports = { add, multiply };
EOF
```

---

## Test Scenarios

### Scenario 1: Basic Chat Functionality

**Objective:** Verify basic chat send/receive works without errors

**Prerequisites:**
- App running
- Model selected (any model)
- Clean chat (click New Chat)

**Test Steps:**

1. **Verify app state:**
   ```javascript
   get_electron_window_info()
   ```
   Expected: Window title contains "Ollmini Devbox"

2. **Check status indicator:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.getElementById('statusText').textContent" }
   })
   ```
   Expected: "Connected" or "Ready"

3. **Send simple message:**
   ```javascript
   // Click input
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#messageInput" }
   })

   // Fill message
   send_command_to_electron({
     command: "fill_input",
     args: { selector: "#messageInput", value: "Hello! Please respond with 'Test successful'" }
   })

   // Send
   send_command_to_electron({
     command: "send_keyboard_shortcut",
     args: { text: "Enter" }
   })
   ```

4. **Wait for response (5-10 seconds)**

5. **Verify response received:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.querySelectorAll('.message.assistant').length" }
   })
   ```
   Expected: At least 1 assistant message

6. **Take screenshot:**
   ```javascript
   take_screenshot({
     windowTitle: "Ollmini Devbox",
     outputPath: "/tmp/test-basic-chat.png"
   })
   ```

7. **Check console for errors:**
   ```javascript
   read_electron_logs({ logType: "console", lines: 30 })
   ```
   Expected: No error messages

**Expected Results:**
- ✅ Status shows "Connected"
- ✅ Message appears in chat (user bubble)
- ✅ Assistant response appears within 10s
- ✅ No JavaScript errors in console
- ✅ Send button returns to "Send" state (not stuck on "Stop")

**Failure Criteria:**
- ❌ No response after 30 seconds
- ❌ JavaScript errors in console
- ❌ UI freezes or becomes unresponsive
- ❌ Status shows "Disconnected"

**Retry Strategy:**
If failure occurs:
1. Check Ollama service is running
2. Verify model is loaded: `ollama list`
3. Try different model (llama3.2 instead of gpt-oss)
4. Check Ollama logs: `journalctl -u ollama -n 50`

---

### Scenario 2: Tool Call Execution (File Creation)

**Objective:** Verify Code Mode enables tool calls and files can be created

**Prerequisites:**
- App running
- Model: llama3.2, qwen2.5-coder, or mistral-small3 (NOT gpt-oss)
- Code Mode: Enabled (button active)
- Working directory: /tmp/ollmini-test/

**Test Steps:**

1. **Verify Code Mode is enabled:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.getElementById('codeModeToggle').classList.contains('active')" }
   })
   ```
   Expected: true

2. **If disabled, enable it:**
   ```javascript
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#codeModeToggle" }
   })
   ```

3. **Verify working directory:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.getElementById('cwd-display') ? document.getElementById('cwd-display').textContent : 'Sidebar closed'" }
   })
   ```
   If not /tmp/ollmini-test/, set it via Working Directory browser

4. **Send file creation prompt:**
   ```javascript
   send_command_to_electron({
     command: "fill_input",
     args: {
       selector: "#messageInput",
       value: "Please create a file called test-output.txt with the content 'Tool execution successful at " + new Date().toISOString() + "'"
     }
   })

   send_command_to_electron({
     command: "send_keyboard_shortcut",
     args: { text: "Enter" }
   })
   ```

5. **Watch for permission dialog (5 seconds):**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.getElementById('permissionModal').style.display" }
   })
   ```

6. **If permission dialog appears, approve:**
   ```javascript
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#allow-once" }
   })
   ```

7. **Wait for tool execution (10 seconds)**

8. **Verify tool result appears:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const toolResults = document.querySelectorAll('.tool-result');
       if (toolResults.length === 0) return 'No tool results found';
       return Array.from(toolResults).map(el => el.textContent).join('\\n');
     `}
   })
   ```
   Expected: Should contain "test-output.txt" or "File created" or similar success message

9. **Verify file exists on disk:**
   ```bash
   # Run via separate bash command
   cat /tmp/ollmini-test/test-output.txt
   ```
   Expected: File exists with correct content

10. **Take screenshot:**
    ```javascript
    take_screenshot({
      outputPath: "/tmp/test-tool-execution.png"
    })
    ```

11. **Check logs for tool execution:**
    ```javascript
    read_electron_logs({ logType: "console", lines: 50 })
    ```
    Look for: "Tool:", "write", "success"

**Expected Results:**
- ✅ Code Mode button is active
- ✅ Permission dialog appears (first time) or tool executes immediately (if already allowed)
- ✅ Tool result bubble appears in chat
- ✅ File exists on disk with correct content
- ✅ Assistant confirms file creation in response
- ✅ No errors in console logs

**Failure Criteria:**
- ❌ Tool parameters appear as text instead of executing (indicates model doesn't support tool calling)
- ❌ Permission denied error
- ❌ File not created on disk
- ❌ Tool execution times out (>30s)

**Retry Strategy:**
If failure occurs:
1. **Model doesn't support tools:** Switch to llama3.2 or qwen2.5-coder
2. **Permission issues:** Check working directory is writable: `ls -ld /tmp/ollmini-test/`
3. **Unclear prompt:** Try more explicit: "Use the write tool to create a file named test-output.txt containing the text 'success'"
4. **Check tool availability:** Verify system-tools.js is loaded in console

---

### Scenario 3: RAG Indexing and Retrieval

**Objective:** Verify RAG can index documents and retrieve relevant context

**Prerequisites:**
- App running
- RAG enabled in settings
- Embedding model available (e.g., snowflake-arctic-embed2:568m)
- Test files in /tmp/ollmini-test/
- Working directory set to /tmp/ollmini-test/

**Test Steps:**

**Phase A: Indexing**

1. **Enable RAG in settings:**
   ```javascript
   // Open settings
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#settingsBtn" }
   })

   // Wait 1 second

   // Navigate to RAG Settings tab
   send_command_to_electron({
     command: "click_by_text",
     args: { text: "RAG Settings" }
   })

   // Check if RAG toggle is enabled
   send_command_to_electron({
     command: "eval",
     args: { code: "document.getElementById('rag-enabled-toggle').checked" }
   })

   // If not enabled, enable it
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#rag-enabled-toggle" }
   })

   // Save settings
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#settings-save" }
   })
   ```

2. **Open Working Directory sidebar:**
   ```javascript
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#workingDirBtn" }
   })
   ```

3. **Verify test directory is current:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.getElementById('cwd-display').textContent" }
   })
   ```
   Expected: Contains "/tmp/ollmini-test"

4. **Click Index for RAG button:**
   ```javascript
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#index-files-btn" }
   })
   ```

5. **Wait for file selection modal (1 second)**

6. **Select all files in modal:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const checkboxes = document.querySelectorAll('#pre-index-file-list input[type="checkbox"]');
       checkboxes.forEach(cb => cb.checked = true);
       return checkboxes.length + ' files selected';
     `}
   })
   ```

7. **Confirm indexing:**
   ```javascript
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#pre-index-continue-btn" }
   })
   ```

8. **Monitor indexing progress:**
   ```javascript
   // Check every 2 seconds for up to 30 seconds
   send_command_to_electron({
     command: "eval",
     args: { code: "document.getElementById('rag-status').textContent" }
   })
   ```
   Expected progression: "Indexing..." → "Indexed N chunks from M files"

9. **Take screenshot when complete:**
   ```javascript
   take_screenshot({ outputPath: "/tmp/test-rag-indexed.png" })
   ```

10. **Verify in logs:**
    ```javascript
    read_electron_logs({ logType: "console", lines: 100 })
    ```
    Look for: "RAG", "Indexed", "chunks"

**Phase B: Retrieval**

11. **Send query requiring RAG context:**
    ```javascript
    send_command_to_electron({
      command: "fill_input",
      args: {
        selector: "#messageInput",
        value: "Based on the indexed files, what is the name of the test project and what is the main function in index.js?"
      }
    })

    send_command_to_electron({
      command: "send_keyboard_shortcut",
      args: { text: "Enter" }
    })
    ```

12. **Wait for response (10-15 seconds)**

13. **Verify RAG context was used:**
    ```javascript
    send_command_to_electron({
      command: "eval",
      args: { code: `
        const ragIndicators = document.querySelectorAll('.rag-context-used');
        return ragIndicators.length > 0 ? 'RAG context found in response' : 'No RAG indicator found';
      `}
    })
    ```

14. **Read assistant response:**
    ```javascript
    send_command_to_electron({
      command: "eval",
      args: { code: `
        const messages = document.querySelectorAll('.message.assistant');
        const lastMessage = messages[messages.length - 1];
        return lastMessage ? lastMessage.textContent : 'No response';
      `}
    })
    ```
    Expected: Should mention "test-project" and "greet" function

15. **Check logs for RAG search:**
    ```javascript
    read_electron_logs({ logType: "console", lines: 50 })
    ```
    Look for: "RAG search:", "relevance score", "chunks retrieved"

16. **Take screenshot of response:**
    ```javascript
    take_screenshot({ outputPath: "/tmp/test-rag-retrieval.png" })
    ```

**Expected Results:**
- ✅ RAG toggle enabled successfully
- ✅ Indexing completes without errors
- ✅ Status shows "Indexed N chunks from M files" (N > 0)
- ✅ RAG search triggers on relevant query
- ✅ Response includes information from indexed files
- ✅ Console shows RAG search with relevance scores
- ✅ No database errors in logs

**Failure Criteria:**
- ❌ Indexing fails with "No vector column" error
- ❌ Indexing stalls at 0% for >60 seconds
- ❌ RAG search returns 0 results despite indexed files
- ❌ Dimension mismatch errors in console
- ❌ Response doesn't use RAG context (no file knowledge)

**Retry Strategy:**
If failure occurs:
1. **Indexing fails:**
   - Clear RAG database: Settings → Advanced → Reset All RAG Databases
   - Verify embedding model is downloaded: `ollama list | grep arctic`
   - Check working directory permissions: `ls -la /tmp/ollmini-test/`

2. **No retrieval:**
   - Try more specific query: "What does the greet function do according to the indexed code?"
   - Verify files were indexed: Check status shows > 0 chunks
   - Check RAG enabled: Settings → RAG Settings → toggle ON

3. **Dimension mismatch:**
   - Clear database and re-index
   - Don't change embedding models mid-test

---

### Scenario 4: WebSearch Integration

**Objective:** Verify WebSearch can fetch current information and augment responses

**Prerequisites:**
- App running
- WebSearch enabled (button active)
- WebSearch provider configured (Ollama API with key OR Searx URL)
- Model: Any model with tool calling support

**Test Steps:**

1. **Verify WebSearch is enabled:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.getElementById('webSearchModeToggle').classList.contains('active')" }
   })
   ```
   Expected: true

2. **If disabled, enable it:**
   ```javascript
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#webSearchModeToggle" }
   })
   ```

3. **Verify WebSearch provider configured:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const settings = JSON.parse(localStorage.getItem('ollmini-devbox-settings'));
       return settings.webSearchProvider + ' - ' + (settings.webSearchApiKey ? 'Key set' : settings.searxUrl ? 'Searx URL set' : 'Not configured');
     `}
   })
   ```
   If not configured, set in Settings → WebSearch Settings

4. **Send query requiring web search:**
   ```javascript
   send_command_to_electron({
     command: "fill_input",
     args: {
       selector: "#messageInput",
       value: "What is the current stable version of Electron as of October 2025? Search the web to find out."
     }
   })

   send_command_to_electron({
     command: "send_keyboard_shortcut",
     args: { text: "Enter" }
   })
   ```

5. **Watch for web search execution (10-20 seconds)**

6. **Verify web search results appear:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const webResults = document.querySelectorAll('.web-result-card');
       return webResults.length + ' web results found';
     `}
   })
   ```
   Expected: > 0 results

7. **Read search results:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const webResults = document.querySelectorAll('.web-result-card');
       return Array.from(webResults).slice(0, 3).map(card => ({
         title: card.querySelector('.result-title')?.textContent || 'No title',
         url: card.querySelector('.result-url')?.textContent || 'No URL',
         snippet: card.querySelector('.result-snippet')?.textContent || 'No snippet'
       }));
     `}
   })
   ```

8. **Verify assistant uses search results:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const messages = document.querySelectorAll('.message.assistant');
       const lastMessage = messages[messages.length - 1];
       return lastMessage ? lastMessage.textContent : 'No response';
     `}
   })
   ```
   Expected: Should mention specific Electron version number

9. **Take screenshot:**
   ```javascript
   take_screenshot({ outputPath: "/tmp/test-websearch.png" })
   ```

10. **Check logs:**
    ```javascript
    read_electron_logs({ logType: "console", lines: 50 })
    ```
    Look for: "WebSearch", "web_search", "results"

**Expected Results:**
- ✅ WebSearch toggle active
- ✅ Web search executes (tool call appears)
- ✅ Search results render in UI (cards with titles/URLs/snippets)
- ✅ Assistant response includes information from search results
- ✅ No API errors in console
- ✅ Search completes within 30 seconds

**Failure Criteria:**
- ❌ WebSearch not available (provider not configured)
- ❌ API key invalid (401/403 errors)
- ❌ Search returns 0 results for clear query
- ❌ Results fail to render (JavaScript errors)
- ❌ Assistant ignores search results in response

**Retry Strategy:**
If failure occurs:
1. **Provider not configured:**
   - Settings → WebSearch Settings
   - Choose "ollama" and enter API key, OR
   - Choose "searx" and enter self-hosted URL

2. **No results:**
   - Try simpler query: "Latest Electron release"
   - Check provider API is accessible: curl test
   - Try different provider (switch ollama ↔ searx)

3. **Results not rendering:**
   - Check console for errors
   - Verify web-result-renderer.js is loaded
   - Screenshot to see what's visible

---

### Scenario 5: Context Window Stress Test

**Objective:** Verify context tracking is accurate and model handles near-limit contexts

**Prerequisites:**
- App running
- Model: gpt-oss:20atlas (128K context) or llama3.2 (128K)
- Context set to 40,000 tokens (Settings → Model Settings → num_ctx)
- Clean chat

**Test Steps:**

1. **Verify context window setting:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const settings = JSON.parse(localStorage.getItem('ollmini-devbox-settings'));
       return 'Context window: ' + settings.num_ctx;
     `}
   })
   ```
   Expected: 40000 (or your desired value)

2. **Send initial message to establish baseline:**
   ```javascript
   send_command_to_electron({
     command: "fill_input",
     args: {
       selector: "#messageInput",
       value: "Please respond with exactly 100 words describing the concept of recursion in computer science."
     }
   })
   send_command_to_electron({
     command: "send_keyboard_shortcut",
     args: { text: "Enter" }
   })
   ```

3. **Wait for response (10s)**

4. **Check context usage:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.getElementById('contextText').textContent" }
   })
   ```
   Expected: "Context: ~500 / 40,000" (approximate)

5. **Send increasingly long messages (10 iterations):**
   ```javascript
   // Repeat 10 times with 200-word responses
   for (let i = 1; i <= 10; i++) {
     send_command_to_electron({
       command: "fill_input",
       args: {
         selector: "#messageInput",
         value: `Please respond with exactly 200 words about topic ${i}: [different topic each time: algorithms, data structures, networking, databases, etc.]`
       }
     })
     send_command_to_electron({
       command: "send_keyboard_shortcut",
       args: { text: "Enter" }
     })

     // Wait for response
     // Check context usage after each
     send_command_to_electron({
       command: "eval",
       args: { code: "document.getElementById('contextText').textContent" }
     })
   }
   ```

6. **Monitor context bar fill:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.getElementById('contextBarFill').style.width" }
   })
   ```
   Expected: Gradually increases (e.g., "0%" → "5%" → "15%" → ...)

7. **Verify context tracking accuracy:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const contextText = document.getElementById('contextText').textContent;
       const match = contextText.match(/Context: ([0-9,]+) \/ ([0-9,]+)/);
       if (!match) return 'Context text format unexpected';
       const current = parseInt(match[1].replace(/,/g, ''));
       const max = parseInt(match[2].replace(/,/g, ''));
       const percent = (current / max * 100).toFixed(1);
       return \`Current: \${current}, Max: \${max}, Percent: \${percent}%\`;
     `}
   })
   ```

8. **Test near-limit behavior (~80% context):**
   Continue sending messages until context reaches ~32,000 / 40,000

9. **Verify warning appears (if implemented):**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.querySelector('.context-warning') ? 'Warning visible' : 'No warning'" }
   })
   ```

10. **Test context overflow handling:**
    Send one more very long message to push over limit

11. **Take screenshots at key points:**
    ```javascript
    take_screenshot({ outputPath: "/tmp/test-context-25pct.png" })  // At 25%
    take_screenshot({ outputPath: "/tmp/test-context-50pct.png" })  // At 50%
    take_screenshot({ outputPath: "/tmp/test-context-80pct.png" })  // At 80%
    ```

12. **Check logs for context management:**
    ```javascript
    read_electron_logs({ logType: "console", lines: 100 })
    ```
    Look for: "Context usage:", "tokens", "pruning" (if implemented)

**Expected Results:**
- ✅ Context usage starts near 0 and increases linearly
- ✅ Context bar fill visually matches percentage
- ✅ Token counts are reasonable (not wildly inaccurate)
- ✅ App remains responsive at 80% context
- ✅ No crashes or freezes at high context usage
- ✅ Context tracking updates after each message

**Failure Criteria:**
- ❌ Context usage stays at 0 despite messages
- ❌ Context usage exceeds max (e.g., "45,000 / 40,000")
- ❌ Context bar fill doesn't match percentage
- ❌ App crashes or freezes at high context
- ❌ Token counts are clearly wrong (10x off)

**Retry Strategy:**
If failure occurs:
1. **Context not tracking:**
   - Check tiktoken is loaded: `console.log(window.tokenEncoder)`
   - Verify ollama-client.js is updating context
   - Look for errors in token counting code

2. **Context exceeds limit:**
   - Check if model has different limit (verify MODEL_CONTEXT_LIMITS)
   - Verify num_ctx setting matches model capability

3. **Performance issues:**
   - Reduce context window (try 20,000)
   - Check system resources (RAM, CPU)
   - Close other applications

---

### Scenario 6: Pinned Messages Context

**Objective:** Verify pinned messages persist in context and are properly managed

**Prerequisites:**
- App running
- Clean chat
- Model: llama3.2 or qwen2.5-coder (NOT gpt-oss - known issue with pins)

**Test Steps:**

1. **Verify pin sidebar is accessible:**
   ```javascript
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#pinIndicator" }
   })
   ```
   This should toggle the pin sidebar visibility

2. **Send a message with important context:**
   ```javascript
   send_command_to_electron({
     command: "fill_input",
     args: {
       selector: "#messageInput",
       value: "My name is TestUser and my favorite programming language is Rust."
     }
   })
   send_command_to_electron({
     command: "send_keyboard_shortcut",
     args: { text: "Enter" }
   })
   ```

3. **Wait for response (10s)**

4. **Pin the user message:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const userMessages = document.querySelectorAll('.message.user');
       const lastUserMessage = userMessages[userMessages.length - 1];
       const pinButton = lastUserMessage.querySelector('.pin-button');
       if (pinButton) {
         pinButton.click();
         return 'Pin button clicked';
       } else {
         return 'Pin button not found';
       }
     `}
   })
   ```

5. **Verify pin appears in sidebar:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const pinnedMessages = document.querySelectorAll('#pinnedContent .pinned-message');
       return pinnedMessages.length + ' pinned message(s)';
     `}
   })
   ```
   Expected: 1

6. **Check pin indicator in header:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.getElementById('headerPinnedCount').textContent" }
   })
   ```
   Expected: "1/5"

7. **Send follow-up message referencing pinned context:**
   ```javascript
   send_command_to_electron({
     command: "fill_input",
     args: {
       selector: "#messageInput",
       value: "What is my name and favorite language?"
     }
   })
   send_command_to_electron({
     command: "send_keyboard_shortcut",
     args: { text: "Enter" }
   })
   ```

8. **Wait for response (10s)**

9. **Verify model used pinned context:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const messages = document.querySelectorAll('.message.assistant');
       const lastMessage = messages[messages.length - 1];
       const text = lastMessage ? lastMessage.textContent : 'No response';
       const hasName = text.toLowerCase().includes('testuser');
       const hasLanguage = text.toLowerCase().includes('rust');
       return { text, hasName, hasLanguage };
     `}
   })
   ```
   Expected: hasName = true, hasLanguage = true

10. **Clear conversation (New Chat):**
    ```javascript
    send_command_to_electron({
      command: "click_by_selector",
      args: { selector: "#newChatBtn" }
    })
    ```

11. **Verify pinned context still accessible:**
    ```javascript
    send_command_to_electron({
      command: "eval",
      args: { code: `
        const pinnedMessages = document.querySelectorAll('#pinnedContent .pinned-message');
        return pinnedMessages.length + ' pinned message(s) after new chat';
      `}
    })
    ```
    Expected: Still 1 (pins persist across chats)

12. **Send new message using old pin:**
    ```javascript
    send_command_to_electron({
      command: "fill_input",
      args: {
        selector: "#messageInput",
        value: "What programming language did I say I liked? (Use pinned context)"
      }
    })
    send_command_to_electron({
      command: "send_keyboard_shortcut",
      args: { text: "Enter" }
    })
    ```

13. **Verify model still uses pin:**
    Should mention "Rust"

14. **Unpin the message:**
    ```javascript
    send_command_to_electron({
      command: "eval",
      args: { code: `
        const pinnedMessages = document.querySelectorAll('#pinnedContent .pinned-message');
        const firstPin = pinnedMessages[0];
        const unpinButton = firstPin.querySelector('.unpin-button');
        if (unpinButton) {
          unpinButton.click();
          return 'Unpinned';
        } else {
          return 'Unpin button not found';
        }
      `}
    })
    ```

15. **Verify pin removed:**
    ```javascript
    send_command_to_electron({
      command: "eval",
      args: { code: "document.getElementById('headerPinnedCount').textContent" }
    })
    ```
    Expected: "0/5"

16. **Take screenshots:**
    ```javascript
    take_screenshot({ outputPath: "/tmp/test-pins-added.png" })  // After pinning
    take_screenshot({ outputPath: "/tmp/test-pins-used.png" })   // After model response
    ```

**Expected Results:**
- ✅ Pin button appears on messages
- ✅ Pinned message appears in sidebar
- ✅ Pin count updates in header (0/5 → 1/5)
- ✅ Model uses pinned context in responses
- ✅ Pins persist across new chats
- ✅ Unpin removes message from sidebar
- ✅ Pin tokens count displayed

**Failure Criteria:**
- ❌ Pin button doesn't appear (check message-renderer.js)
- ❌ Pinned message not in sidebar (check pin-manager.js)
- ❌ Model doesn't use pinned context (gpt-oss issue or pin injection failing)
- ❌ Pins disappear after new chat
- ❌ Unpin doesn't work

**Retry Strategy:**
If failure occurs:
1. **Model not using pins:**
   - Verify model is NOT gpt-oss (known issue)
   - Check console for pin injection errors
   - Try more explicit prompt: "According to my pinned messages, what is my name?"

2. **Pins not appearing:**
   - Check pin-manager.js is loaded
   - Verify localStorage has pins: `localStorage.getItem('ollmini-devbox-pins')`
   - Refresh app and try again

---

### Scenario 7: Chat History Management

**Objective:** Verify chat history can be saved, loaded, renamed, and deleted

**Prerequisites:**
- App running
- At least one chat with 3+ messages

**Test Steps:**

1. **Create a test conversation:**
   Send 3 messages and get 3 responses:
   ```javascript
   ["Hello, I'm testing chat history",
    "What is 2+2?",
    "Thanks for your help!"].forEach((msg, i) => {
      setTimeout(() => {
        send_command_to_electron({
          command: "fill_input",
          args: { selector: "#messageInput", value: msg }
        })
        send_command_to_electron({
          command: "send_keyboard_shortcut",
          args: { text: "Enter" }
        })
      }, i * 15000)  // Wait 15s between messages
   })
   ```

2. **Save the chat via Ctrl+S:**
   ```javascript
   send_command_to_electron({
     command: "send_keyboard_shortcut",
     args: { text: "Control+s" }
   })
   ```

3. **Verify save is successful:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const chatList = document.getElementById('chatHistoryList');
       const chats = chatList.querySelectorAll('.chat-item');
       return chats.length + ' chat(s) in history';
     `}
   })
   ```
   Expected: ≥ 1

4. **Get saved chat name:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const chats = document.querySelectorAll('.chat-item .chat-name');
       return chats.length > 0 ? chats[0].textContent : 'No chats';
     `}
   })
   ```

5. **Start a new chat:**
   ```javascript
   send_command_to_electron({
     command: "click_by_selector",
     args: { selector: "#newChatBtn" }
   })
   ```

6. **Verify chat is empty:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: "document.querySelectorAll('.message').length" }
   })
   ```
   Expected: 0

7. **Load saved chat:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const chats = document.querySelectorAll('.chat-item');
       if (chats.length > 0) {
         chats[0].click();
         return 'Clicked first chat';
       } else {
         return 'No chats to click';
       }
     `}
   })
   ```

8. **Wait for chat to load (2 seconds)**

9. **Verify messages restored:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const messages = document.querySelectorAll('.message');
       return messages.length + ' messages restored';
     `}
   })
   ```
   Expected: 6 (3 user + 3 assistant)

10. **Verify message content:**
    ```javascript
    send_command_to_electron({
      command: "eval",
      args: { code: `
        const userMessages = document.querySelectorAll('.message.user');
        return Array.from(userMessages).map(m => m.textContent).join(' | ');
      `}
    })
    ```
    Expected: Should contain "testing chat history", "2+2", "Thanks"

11. **Rename the chat:**
    ```javascript
    // Right-click on chat item
    send_command_to_electron({
      command: "eval",
      args: { code: `
        const chat = document.querySelector('.chat-item');
        const event = new MouseEvent('contextmenu', { bubbles: true });
        chat.dispatchEvent(event);
        return 'Context menu triggered';
      `}
    })

    // Wait 1 second

    // Click Rename
    send_command_to_electron({
      command: "click_by_selector",
      args: { selector: "#renameChatBtn" }
    })

    // Wait for rename modal (1 second)

    // Fill new name
    send_command_to_electron({
      command: "fill_input",
      args: { selector: "#rename-chat-input", value: "Test Chat Renamed" }
    })

    // Confirm
    send_command_to_electron({
      command: "click_by_selector",
      args: { selector: "#rename-confirm-btn" }
    })
    ```

12. **Verify rename:**
    ```javascript
    send_command_to_electron({
      command: "eval",
      args: { code: `
        const chat = document.querySelector('.chat-item .chat-name');
        return chat ? chat.textContent : 'Chat not found';
      `}
    })
    ```
    Expected: "Test Chat Renamed"

13. **Delete the chat:**
    ```javascript
    // Right-click again
    send_command_to_electron({
      command: "eval",
      args: { code: `
        const chat = document.querySelector('.chat-item');
        const event = new MouseEvent('contextmenu', { bubbles: true });
        chat.dispatchEvent(event);
        return 'Context menu triggered';
      `}
    })

    // Click Delete
    send_command_to_electron({
      command: "click_by_selector",
      args: { selector: "#deleteChatBtn" }
    })

    // Confirm deletion
    send_command_to_electron({
      command: "click_by_selector",
      args: { selector: "#delete-confirm-btn" }
    })
    ```

14. **Verify deletion:**
    ```javascript
    send_command_to_electron({
      command: "eval",
      args: { code: `
        const chats = document.querySelectorAll('.chat-item');
        return chats.length + ' chat(s) remaining';
      `}
    })
    ```
    Expected: 0 (if only one chat existed)

15. **Take screenshots:**
    ```javascript
    take_screenshot({ outputPath: "/tmp/test-chat-saved.png" })
    take_screenshot({ outputPath: "/tmp/test-chat-loaded.png" })
    take_screenshot({ outputPath: "/tmp/test-chat-renamed.png" })
    ```

**Expected Results:**
- ✅ Ctrl+S saves chat with auto-generated name
- ✅ Chat appears in left sidebar list
- ✅ New chat clears conversation
- ✅ Loading chat restores all messages
- ✅ Rename updates chat name in sidebar
- ✅ Delete removes chat from list
- ✅ All changes persist in localStorage

**Failure Criteria:**
- ❌ Save doesn't create chat entry
- ❌ Chat list doesn't populate
- ❌ Loading chat fails (errors in console)
- ❌ Messages don't restore correctly
- ❌ Rename/delete doesn't work
- ❌ Changes lost after page refresh

**Retry Strategy:**
If failure occurs:
1. **Save not working:**
   - Check localStorage quota: `navigator.storage.estimate()`
   - Verify chat-history-manager.js is loaded
   - Try manual save: Open settings, go to Chat History, click Save

2. **Load not working:**
   - Check localStorage contents: `localStorage.getItem('ollmini-chat-history')`
   - Verify JSON is valid (not corrupted)
   - Clear and re-save chat

---

### Scenario 8: Combined Workflow - RAG + Tools + WebSearch

**Objective:** Test all major features working together in realistic workflow

**Scenario:** "Research Electron security, create implementation plan using RAG context, and generate code"

**Prerequisites:**
- App running
- Model: llama3.2 or qwen2.5-coder (full feature support)
- RAG enabled and indexed (test project files)
- Code Mode enabled
- WebSearch enabled and configured
- Working directory: /tmp/ollmini-test/

**Test Steps:**

**Phase A: Research (WebSearch)**

1. **Send research query:**
   ```javascript
   send_command_to_electron({
     command: "fill_input",
     args: {
       selector: "#messageInput",
       value: "Search the web for the latest Electron security best practices as of 2025. Focus on Content Security Policy and Context Isolation."
     }
   })
   send_command_to_electron({
     command: "send_keyboard_shortcut",
     args: { text: "Enter" }
   })
   ```

2. **Wait for web search (20 seconds)**

3. **Verify search results appear:**
   ```javascript
   send_command_to_electron({
     command: "eval",
     args: { code: `
       const results = document.querySelectorAll('.web-result-card');
       return results.length + ' search results';
     `}
   })
   ```
   Expected: > 0

4. **Take screenshot of research results:**
   ```javascript
   take_screenshot({ outputPath: "/tmp/test-combined-research.png" })
   ```

**Phase B: Context Augmentation (RAG)**

5. **Ask question using RAG context:**
   ```javascript
   send_command_to_electron({
     command: "fill_input",
     args: {
       selector: "#messageInput",
       value: "Based on the indexed project files and the web search results, create a security improvement plan for the test project. List 3 specific improvements with code examples."
     }
   })
   send_command_to_electron({
     command: "send_keyboard_shortcut",
     args: { text: "Enter" }
   })
   ```

6. **Wait for RAG search + response (20 seconds)**

7. **Verify RAG was used:**
   ```javascript
   read_electron_logs({ logType: "console", lines: 50 })
   ```
   Look for: "RAG search:", "chunks retrieved"

**Phase C: Implementation (Tool Calls)**

8. **Request file creation:**
   ```javascript
   send_command_to_electron({
     command: "fill_input",
     args: {
       selector: "#messageInput",
       value: "Implement the first security improvement by creating a new file called 'security-config.js' with the Content Security Policy settings you suggested."
     }
   })
   send_command_to_electron({
     command: "send_keyboard_shortcut",
     args: { text: "Enter" }
   })
   ```

9. **Approve tool execution (if needed):**
   Watch for permission dialog, click "Allow Once"

10. **Wait for file creation (15 seconds)**

11. **Verify file exists:**
    ```bash
    ls -la /tmp/ollmini-test/security-config.js
    cat /tmp/ollmini-test/security-config.js
    ```

12. **Request file modification:**
    ```javascript
    send_command_to_electron({
      command: "fill_input",
      args: {
        selector: "#messageInput",
        value: "Read the existing package.json file and add a 'security' script to the scripts section that references security-config.js"
      }
    })
    send_command_to_electron({
      command: "send_keyboard_shortcut",
      args: { text: "Enter" }
    })
    ```

13. **Verify modification:**
    ```bash
    cat /tmp/ollmini-test/package.json | grep security
    ```
    Expected: Should contain "security" script

**Phase D: Verification**

14. **Request project summary:**
    ```javascript
    send_command_to_electron({
      command: "fill_input",
      args: {
        selector: "#messageInput",
        value: "List all files in the working directory and summarize what we've accomplished in this session."
      }
    })
    send_command_to_electron({
      command: "send_keyboard_shortcut",
      args: { text: "Enter" }
    })
    ```

15. **Take final screenshot:**
    ```javascript
    take_screenshot({ outputPath: "/tmp/test-combined-complete.png" })
    ```

16. **Verify context usage:**
    ```javascript
    send_command_to_electron({
      command: "eval",
      args: { code: "document.getElementById('contextText').textContent" }
    })
    ```

17. **Check all logs:**
    ```javascript
    read_electron_logs({ logType: "console", lines: 200 })
    ```

**Expected Results:**
- ✅ WebSearch returns relevant Electron security results
- ✅ RAG retrieves indexed project files
- ✅ Model synthesizes web search + RAG context
- ✅ Tool calls create and modify files correctly
- ✅ All files exist with expected content
- ✅ Context usage tracked accurately throughout
- ✅ No errors in console
- ✅ Conversation flows naturally across 15+ messages

**Failure Criteria:**
- ❌ Any feature fails completely (WebSearch, RAG, or Tools)
- ❌ Model loses context between phases
- ❌ Tool calls timeout or fail repeatedly
- ❌ Files corrupted or missing
- ❌ App crashes or freezes

**Retry Strategy:**
If failure occurs:
1. **Identify failing phase:**
   - Phase A (WebSearch): Check provider config, try simpler query
   - Phase B (RAG): Verify indexing completed, check logs
   - Phase C (Tools): Check permissions, verify Code Mode enabled

2. **Break down workflow:**
   - Test each phase separately to isolate issue
   - Skip failing phase and continue with others

3. **Adjust expectations:**
   - Model may synthesize differently (that's OK)
   - Files may have different format (verify intent, not format)

---

## Execution Phases

### Phase 1: Environment Setup & Validation (30 minutes)

**Goals:**
- Verify all prerequisites are met
- Configure test environment
- Create test data
- Baseline performance check

**Tasks:**

1. **Check Ollama Service:**
   ```bash
   curl http://192.168.122.1:11434/api/tags
   systemctl status ollama  # If using systemd
   ollama list
   ```

2. **Verify Models:**
   ```bash
   ollama list | grep -E '(llama3.2|qwen2.5-coder|mistral-small3)'
   ```
   If missing, pull at least one:
   ```bash
   ollama pull llama3.2:latest
   ```

3. **Start Application:**
   ```bash
   cd /home/someone1/development/Ollmini-Devbox-rc0.2.0b/UI
   npm run dev
   ```

4. **Verify MCP Connection:**
   ```javascript
   mcp__electron-mcp-server__get_electron_window_info()
   ```
   Expected: Window info returned without errors

5. **Take baseline screenshot:**
   ```javascript
   mcp__electron-mcp-server__take_screenshot({
     windowTitle: "Ollmini Devbox",
     outputPath: "/tmp/test-baseline.png"
   })
   ```

6. **Create test directory:**
   ```bash
   mkdir -p /tmp/ollmini-test/
   # Create test files (see "Test Data Preparation" section)
   ```

7. **Configure settings (via UI or localStorage):**
   - Set working directory to /tmp/ollmini-test/
   - Set context window to 40,000
   - Enable RAG, select embedding model
   - Enable WebSearch (if configured)
   - Disable typewriter effect (faster testing)

8. **Document environment:**
   ```javascript
   mcp__electron-mcp-server__send_command_to_electron({
     command: "eval",
     args: { code: `
       const settings = JSON.parse(localStorage.getItem('ollmini-devbox-settings'));
       return {
         model: document.getElementById('modelSelect').value,
         ollamaEndpoint: settings.ollamaEndpoint,
         num_ctx: settings.num_ctx,
         ragEnabled: settings.ragConfig?.enabled,
         textEmbedding: settings.ragConfig?.textEmbeddingModel,
         codeEmbedding: settings.ragConfig?.codeEmbeddingModel,
         webSearchProvider: settings.webSearchProvider
       };
     `}
   })
   ```

**Completion Criteria:**
- ✅ Ollama running and responsive
- ✅ At least one compatible model available
- ✅ App launches without errors
- ✅ MCP tools can interact with app
- ✅ Test directory created with sample files
- ✅ Settings configured for testing

---

### Phase 2: Basic Functionality Tests (1 hour)

**Goals:**
- Validate core features work in isolation
- Establish baseline performance
- Identify any obvious bugs

**Test Sequence:**

1. **Scenario 1: Basic Chat Functionality** (10 min)
   - Send 3-5 simple messages
   - Verify responses
   - Check console for errors
   - Document response times

2. **Scenario 7: Chat History Management** (15 min)
   - Create and save chat
   - Load saved chat
   - Rename chat
   - Delete chat
   - Verify persistence

3. **UI Element Validation** (15 min)
   - Test all buttons (Code Mode, WebSearch, Settings, etc.)
   - Open all modals (Settings, Working Directory, etc.)
   - Verify sidebars toggle correctly
   - Check for broken UI elements

4. **Settings Management** (10 min)
   - Change model
   - Adjust context window slider
   - Toggle features
   - Save and reload settings
   - Verify persistence

5. **Console Health Check** (10 min)
   ```javascript
   mcp__electron-mcp-server__read_electron_logs({
     logType: "console",
     lines: 100
   })
   ```
   - Document any errors
   - Note warnings
   - Check for deprecations

**Completion Criteria:**
- ✅ Basic chat works consistently
- ✅ UI is responsive and buttons functional
- ✅ Settings save and load correctly
- ✅ No critical JavaScript errors
- ✅ Chat history persists across sessions

---

### Phase 3: Advanced Feature Tests (2 hours)

**Goals:**
- Test RAG, WebSearch, and Tool execution
- Validate complex interactions
- Measure performance under load

**Test Sequence:**

1. **Scenario 3: RAG Indexing and Retrieval** (45 min)
   - Index test directory
   - Verify chunk counts
   - Test retrieval with various queries
   - Measure search times
   - Test snapshot management

2. **Scenario 2: Tool Call Execution** (30 min)
   - Test file creation
   - Test file reading
   - Test file modification
   - Test bash commands
   - Test permission system

3. **Scenario 4: WebSearch Integration** (30 min)
   - Test simple search queries
   - Test complex multi-search workflows
   - Test web_fetch functionality
   - Measure search latency
   - Verify result rendering

4. **Scenario 6: Pinned Messages Context** (15 min)
   - Pin user and assistant messages
   - Verify context persistence
   - Test pin limit (5 max)
   - Test archive to RAG
   - Test unpin

**Completion Criteria:**
- ✅ RAG indexes successfully (> 0 chunks)
- ✅ RAG retrieval works (relevant chunks returned)
- ✅ Tool calls execute and return results
- ✅ WebSearch returns relevant results
- ✅ Pins persist across conversations
- ✅ No feature completely broken

---

### Phase 4: Stress Tests (1.5 hours)

**Goals:**
- Test application limits
- Identify performance bottlenecks
- Verify error handling

**Test Sequence:**

1. **Scenario 5: Context Window Stress Test** (45 min)
   - Send 10-15 long messages
   - Fill context to 80%
   - Verify tracking accuracy
   - Test near-limit behavior

2. **RAG Performance Test** (30 min)
   - Index large directory (100+ files)
   - Measure indexing time
   - Test search with 1000+ chunks
   - Verify performance degradation

3. **Rapid Fire Message Test** (15 min)
   - Send 10 messages back-to-back
   - Monitor queue handling
   - Check for race conditions
   - Verify all responses complete

**Completion Criteria:**
- ✅ Context tracking accurate to ±5%
- ✅ RAG handles large corpora (1000+ chunks)
- ✅ No crashes under load
- ✅ Error messages are clear and actionable
- ✅ Performance acceptable (< 30s per operation)

---

### Phase 5: Integration & Real-World Tests (2 hours)

**Goals:**
- Test realistic workflows
- Validate feature combinations
- End-to-end scenarios

**Test Sequence:**

1. **Scenario 8: Combined Workflow** (60 min)
   - Execute full RAG + Tools + WebSearch workflow
   - Verify seamless integration
   - Document user experience

2. **Edge Case Testing** (30 min)
   - Empty database queries
   - Missing permissions
   - Invalid API keys
   - Network interruptions (disconnect Ollama mid-stream)
   - Corrupted localStorage

3. **Model Compatibility Testing** (30 min)
   - Test with llama3.2
   - Test with qwen2.5-coder
   - Test with mistral-small3
   - Document differences
   - Note any model-specific issues

**Completion Criteria:**
- ✅ At least one full workflow completes successfully
- ✅ Edge cases handled gracefully (no crashes)
- ✅ At least 2 models tested successfully
- ✅ Documentation of model differences
- ✅ End-to-end user experience validated

---

## Test Results Template

Use this template to document test results:

```markdown
# Test Execution Report
**Date:** YYYY-MM-DD
**Tester:** [Name]
**Environment:** [OS, Electron version, Node version]
**Ollama Version:** [Version]
**Model:** [Model name and version]

---

## Environment Configuration

**Ollama Endpoint:** http://192.168.122.1:11434
**Context Window:** 40,000 tokens
**RAG Embedding Model:** snowflake-arctic-embed2:568m
**WebSearch Provider:** ollama / searx
**Working Directory:** /tmp/ollmini-test/

---

## Test Results Summary

**Total Tests:** 8 scenarios
**Passed:** X
**Failed:** Y
**Skipped:** Z

**Overall Status:** PASS / FAIL / PARTIAL

---

## Detailed Test Results

### Scenario 1: Basic Chat Functionality
**Status:** PASS / FAIL / SKIP
**Duration:** X minutes
**Attempts:** 1 / 2 / 3

**Steps Executed:**
- [x] Step 1: Verified app state
- [x] Step 2: Checked status indicator
- [x] Step 3: Sent simple message
- [x] Step 4: Waited for response
- [x] Step 5: Verified response received
- [x] Step 6: Took screenshot
- [x] Step 7: Checked console

**Results:**
- Status indicator: "Connected" ✅
- Response time: 4.2 seconds
- Response quality: Good, relevant answer
- Console errors: None

**Issues Found:**
- None

**Screenshots:**
- `/tmp/test-basic-chat.png`

**Notes:**
[Any observations or comments]

---

### Scenario 2: Tool Call Execution
**Status:** PASS / FAIL / SKIP
**Duration:** X minutes
**Attempts:** 1 / 2 / 3

**Steps Executed:**
- [x] Step 1: Verified Code Mode enabled
- [ ] Step 2: ...

**Results:**
- Tool call executed: YES / NO
- File created: YES / NO (`ls -la` output)
- Permission dialog: Appeared / Not needed
- Tool execution time: X seconds

**Issues Found:**
- [List any issues]

**Screenshots:**
- `/tmp/test-tool-execution.png`

**Logs:**
```
[Relevant console logs]
```

**Notes:**
[Any observations]

---

[... Repeat for all 8 scenarios ...]

---

## Performance Metrics

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Average response time | 5.2s | < 10s | ✅ PASS |
| RAG indexing speed | 12 files/min | > 5 files/min | ✅ PASS |
| RAG search time | 0.8s | < 2s | ✅ PASS |
| WebSearch time | 8.3s | < 15s | ✅ PASS |
| Context tracking accuracy | 98% | > 95% | ✅ PASS |
| Tool execution time | 2.1s | < 5s | ✅ PASS |

---

## Issues Discovered

### Critical Issues (Block core functionality)

**Issue #1: [Title]**
- **Severity:** Critical / Major / Minor
- **Component:** [e.g., RAG Manager, Tool Executor, etc.]
- **Description:** [Detailed description]
- **Steps to Reproduce:**
  1. Step 1
  2. Step 2
  3. Step 3
- **Expected:** [What should happen]
- **Actual:** [What actually happened]
- **Logs:**
  ```
  [Error logs]
  ```
- **Screenshots:** [Filenames]
- **Workaround:** [If any]

---

### Major Issues (Degrade functionality)

[Same format as above]

---

### Minor Issues (UX/Polish)

[Same format as above]

---

## Performance Observations

**RAG Performance:**
- Indexing 47 files (523 KB): 4.2 minutes
- Average search time: 0.8 seconds
- Relevance quality: Good (subjective)

**Context Management:**
- Tracking accuracy: 98% (compared to manual count)
- No degradation up to 35,000 tokens
- Context bar visualization accurate

**Tool Execution:**
- Average tool call latency: 2.1 seconds
- Permission dialog responsive
- No failures across 15 tool calls

---

## Model Comparison

| Feature | llama3.2 | qwen2.5-coder | mistral-small3 | gpt-oss |
|---------|----------|---------------|----------------|---------|
| Tool calling | ✅ Works | ✅ Works | ✅ Works | ❌ Broken |
| RAG integration | ✅ Good | ✅ Excellent | ✅ Good | ⚠️ Limited |
| WebSearch | ✅ Works | ✅ Works | ✅ Works | ⚠️ Limited |
| Think-blocks | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Context pins | ✅ Works | ✅ Works | ✅ Works | ❌ Broken |

**Recommendation:** Use llama3.2 or qwen2.5-coder for full functionality. Avoid gpt-oss for tool-heavy workflows.

---

## Recommendations

### High Priority
1. [Fix critical issue #1]
2. [Improve RAG search relevance]
3. [Add better error messages for tool failures]

### Medium Priority
1. [Optimize RAG indexing speed]
2. [Add progress indicators for long operations]
3. [Improve context overflow warning]

### Low Priority
1. [Polish UI animations]
2. [Add keyboard shortcuts for common actions]
3. [Improve think-block rendering]

---

## Conclusion

**Overall Assessment:** The application demonstrates solid core functionality with RAG, WebSearch, and Tool execution working as expected. Performance is acceptable for typical use cases. Some model-specific limitations exist (gpt-oss) but are documented. Recommended for production use with llama3.2 or qwen2.5-coder models.

**Test Coverage:** Comprehensive coverage of major features. Real-world workflows validated successfully.

**Next Steps:**
1. Address critical issues (if any)
2. Conduct user acceptance testing
3. Performance optimization (if needed)

---

## Appendix: Test Evidence

**Screenshots:** [List all screenshot files]
- /tmp/test-baseline.png
- /tmp/test-basic-chat.png
- [etc...]

**Logs:** [Saved log files]
- /tmp/test-console-logs.txt
- /tmp/test-rag-logs.txt

**Test Data:** /tmp/ollmini-test/

**Report Generated:** [Date/Time]
```

---

## Issue Classification

### Severity Levels

**Critical (P0):**
- Application crashes or freezes
- Data loss or corruption
- Core feature completely broken (chat, RAG, tools)
- Security vulnerabilities exposed

**Major (P1):**
- Feature significantly degraded
- Performance severely impacted (>30s operations)
- Workaround exists but difficult
- Affects multiple users/scenarios

**Minor (P2):**
- UI/UX issues
- Non-blocking errors
- Minor performance issues
- Edge cases only

**Enhancement (P3):**
- Feature requests
- Nice-to-have improvements
- Cosmetic changes

---

### Issue Categories

**Functional:**
- Feature doesn't work as designed
- Incorrect behavior

**Performance:**
- Slow response times
- High resource usage
- Scalability issues

**UI/UX:**
- Visual bugs
- Confusing interactions
- Accessibility issues

**Integration:**
- Model-specific issues
- API compatibility
- External service failures

**Data:**
- Persistence issues
- Corrupted data
- Data loss

---

## Testing Best Practices

### Before Testing

1. **Clean slate:**
   - Clear localStorage
   - Clear RAG database
   - Delete test files
   - Restart application

2. **Document everything:**
   - Screenshots at each step
   - Save console logs
   - Record timings
   - Note unexpected behavior

3. **Plan for failures:**
   - Have retry strategies ready
   - Know when to skip vs. retry
   - Document workarounds

### During Testing

1. **Follow procedures:**
   - Execute steps in order
   - Don't skip steps
   - Wait for operations to complete
   - Verify each step before proceeding

2. **Observe carefully:**
   - Watch console for errors
   - Monitor network tab (if needed)
   - Check UI state changes
   - Note performance issues

3. **Adapt intelligently:**
   - If prompt doesn't work, rephrase
   - If feature fails, try alternative approach
   - If model struggles, adjust expectations

### After Testing

1. **Document thoroughly:**
   - Complete test results template
   - Attach all evidence (screenshots, logs)
   - Write clear issue descriptions
   - Provide reproduction steps

2. **Analyze results:**
   - Identify patterns in failures
   - Note model differences
   - Measure performance trends
   - Assess overall quality

3. **Provide recommendations:**
   - Prioritize issues
   - Suggest fixes
   - Propose improvements
   - Document workarounds

---

## Appendix A: MCP Command Cheat Sheet

### Quick Reference

```javascript
// Get window info
mcp__electron-mcp-server__get_electron_window_info()

// Screenshot
mcp__electron-mcp-server__take_screenshot({
  outputPath: "/tmp/screenshot.png"
})

// Click button by ID
mcp__electron-mcp-server__send_command_to_electron({
  command: "click_by_selector",
  args: { selector: "#buttonId" }
})

// Fill input
mcp__electron-mcp-server__send_command_to_electron({
  command: "fill_input",
  args: { selector: "#inputId", value: "text" }
})

// Press Enter
mcp__electron-mcp-server__send_command_to_electron({
  command: "send_keyboard_shortcut",
  args: { text: "Enter" }
})

// Evaluate JavaScript
mcp__electron-mcp-server__send_command_to_electron({
  command: "eval",
  args: { code: "document.getElementById('status').textContent" }
})

// Read logs
mcp__electron-mcp-server__read_electron_logs({
  logType: "console",
  lines: 50
})
```

---

## Appendix B: Key UI Selectors

| Element | Selector | Description |
|---------|----------|-------------|
| Message input | `#messageInput` | Main chat input field |
| Send button | `#sendBtn` | Send message button |
| Code Mode toggle | `#codeModeToggle` | Enable/disable tool calls |
| WebSearch toggle | `#webSearchModeToggle` | Enable/disable web search |
| Settings button | `#settingsBtn` | Open settings modal |
| Model select | `#modelSelect` | Model dropdown |
| Status text | `#statusText` | Connection status |
| Context text | `#contextText` | Context usage display |
| Chat container | `#chatContainer` | Main message area |
| RAG status | `#rag-status` | RAG operation status |
| Pin indicator | `#pinIndicator` | Pinned message count |
| Working dir button | `#workingDirBtn` | Open file browser |
| New chat button | `#newChatBtn` | Start new conversation |

---

## Appendix C: Expected Timings

| Operation | Expected Time | Max Acceptable |
|-----------|---------------|----------------|
| Simple chat response | 3-8 seconds | 15 seconds |
| Tool execution | 1-3 seconds | 10 seconds |
| RAG search | 0.5-2 seconds | 5 seconds |
| WebSearch | 5-15 seconds | 30 seconds |
| RAG indexing (10 files) | 1-3 minutes | 5 minutes |
| Settings save | < 1 second | 2 seconds |
| Chat history load | < 1 second | 3 seconds |

---

**Document Version:** 1.0
**Last Updated:** 2025-10-30
**Status:** Ready for Execution
