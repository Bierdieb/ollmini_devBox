# Ollmini Devbox - Initial Model Setup Guide

## Overview

Ollmini Devbox includes custom-optimized Modelfiles that enhance model performance with:
- **Tool Execution Capabilities**: Fully functional system tools (bash, file operations, etc.)
- **Thinking Capabilities**: Support for `<think>` blocks and analytical reasoning
- **Context Management**: Optimized prompting for better multi-turn conversations
- **Custom Personalities**: Pre-configured system messages for consistent behavior

All custom models are installed with the `_ollmini` suffix to avoid conflicts with base models.

**Example:** `gpt-oss:20b` → `gpt-oss:20b_ollmini`

---

## 🚀 Auto-Setup (Localhost Ollama)

Use this method if Ollama is running on the **same machine** as Ollmini Devbox.

### Prerequisites
- Ollama installed and running on localhost
- Default port 11434 accessible
- Sufficient disk space (models are 5-50GB each)

### Steps

1. **Open Settings**
   - Click the ⚙️ (Settings) icon in the top-right corner

2. **Navigate to Ollama Settings Tab**
   - Click on "Ollama Settings" in the left sidebar

3. **Scroll to Custom Model Setup Section**
   - Locate the "Custom Model Setup" section
   - You'll see "⚙️ Auto-Setup (Localhost Ollama)"

4. **Select Models to Install**
   - Each modelfile shows:
     - **Name**: Original modelfile name (e.g., `gpt-oss_20b`)
     - **Target**: Installed model name (e.g., `gpt-oss:20b_ollmini`)
     - **Base**: Source model required (e.g., `gpt-oss:20b`)
   - Check the boxes for models you want to install

5. **Click "Apply Selected Models"**
   - The button will show "Installing..." during the process
   - Each model may take 1-5 minutes depending on size
   - You'll see progress in the status text

6. **Handle Existing Models**
   - If a model already exists, you'll see a confirmation dialog:
     ```
     Model gpt-oss:20b_ollmini already exists. Overwrite?
     ```
   - Click "OK" to overwrite (updates the model)
   - Click "Cancel" to skip this model

7. **Verify Installation**
   - After successful installation, you'll see:
     ```
     ✅ Success: X model(s) installed
     ```
   - The models will automatically appear in the model dropdown
   - Select your installed model (e.g., `gpt-oss:20b_ollmini`)

### Troubleshooting Auto-Setup

**Error: "Failed to load modelfiles"**
- **Cause**: Models/ directory not found or empty
- **Solution**: Ensure Modelfiles exist in `<project-root>/Models/` directory

**Error: "ollama command not found"**
- **Cause**: Ollama CLI not in system PATH
- **Solution**:
  ```bash
  # Linux/Mac
  which ollama
  # If not found, install from https://ollama.com

  # Windows
  where ollama
  ```

**Error: "Connection refused"**
- **Cause**: Ollama not running
- **Solution**:
  ```bash
  # Start Ollama service
  ollama serve
  ```

**Model installs but doesn't appear in dropdown**
- **Cause**: Model list not refreshed
- **Solution**: Close and reopen Settings, or restart Ollmini Devbox

---

## 📖 Manual Setup (Remote/Docker Ollama)

Use this method if Ollama is running on a **different machine**, **in Docker**, or **over the network**.

### Scenario 1: Remote Ollama (LAN/Network)

**Prerequisites:**
- SSH access to the remote Ollama host
- Ollama installed and running on remote machine

**Steps:**

1. **Transfer Modelfile**
   ```bash
   # From your Ollmini Devbox machine
   scp Models/gpt-oss_20b_Modelfile.txt user@remote-host:/tmp/modelfile.txt
   ```

2. **SSH to Remote Host**
   ```bash
   ssh user@remote-host
   ```

3. **Create Model on Remote**
   ```bash
   ollama create gpt-oss:20b_ollmini < /tmp/modelfile.txt
   ```

4. **Verify Installation**
   ```bash
   ollama list | grep _ollmini
   ```
   You should see:
   ```
   gpt-oss:20b_ollmini    <size>    <date>
   ```

5. **Update Ollmini Devbox Endpoint**
   - Open Settings → Ollama Settings
   - Set "Ollama API Endpoint" to: `http://remote-host:11434`
   - Save settings

---

### Scenario 2: Docker Ollama

**Prerequisites:**
- Docker installed and running
- Ollama Docker container running

**Steps:**

1. **Find Container Name**
   ```bash
   docker ps | grep ollama
   # Note the container name (e.g., "ollama-container")
   ```

2. **Copy Modelfile to Container**
   ```bash
   docker cp Models/gpt-oss_20b_Modelfile.txt ollama-container:/tmp/modelfile.txt
   ```

3. **Execute Create Command in Container**
   ```bash
   docker exec -i ollama-container ollama create gpt-oss:20b_ollmini < Models/gpt-oss_20b_Modelfile.txt
   ```

   **Alternative (if above fails):**
   ```bash
   docker exec ollama-container bash -c "cat /tmp/modelfile.txt | ollama create gpt-oss:20b_ollmini"
   ```

4. **Verify Installation**
   ```bash
   docker exec ollama-container ollama list | grep _ollmini
   ```

5. **Update Ollmini Devbox Endpoint**
   - If Docker on localhost:
     ```
     http://localhost:11434
     ```
   - If Docker on remote host:
     ```
     http://docker-host:11434
     ```

---

### Scenario 3: Docker Compose Setup

If you're using Docker Compose, add the Modelfiles to your volume mount:

**docker-compose.yml:**
```yaml
services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama
      - ./Models:/modelfiles:ro  # ← Add this line
```

**Then:**
```bash
# Restart Docker Compose
docker-compose restart ollama

# Create model
docker-compose exec ollama ollama create gpt-oss:20b_ollmini < /modelfiles/gpt-oss_20b_Modelfile.txt
```

---

## 🔍 Verification & Testing

### Verify Model Installation

```bash
# List all models
ollama list

# Check for _ollmini models
ollama list | grep _ollmini
```

**Expected Output:**
```
gpt-oss:20b_ollmini        20GB      5 minutes ago
qwen3:14b_ollmini          14GB      3 minutes ago
```

### Test Model Functionality

1. **Select Model in Ollmini Devbox**
   - Open model dropdown
   - Select your `_ollmini` model
   - Model name should appear in dropdown

2. **Test Basic Chat**
   - Send: "Hello, can you introduce yourself?"
   - Expected: Model introduces itself with custom personality

3. **Test Tool Execution (Code Mode)**
   - Enable "Code Mode" button (if not already enabled)
   - Send: "create a file called test.txt with content 'Hello World'"
   - Expected: Model uses `write` tool to create file

4. **Test Thinking Blocks**
   - Send: "analyze the best approach to sort 1 million numbers"
   - Expected: Model shows `<think>` block with reasoning (if supported)

---

## 📋 Available Models

### Current Modelfiles

| Modelfile | Base Model | Target Name | Size | Features |
|-----------|------------|-------------|------|----------|
| `gpt-oss_20b_Modelfile.txt` | `gpt-oss:20b` | `gpt-oss:20b_ollmini` | ~20GB | Tool execution, thinking, custom personality |

**To add more models:**
1. Place `.txt` Modelfiles in `Models/` directory
2. **Do NOT** include "template" in the filename (reserved for reference)
3. Restart Ollmini Devbox
4. Models will appear in Auto-Setup section

---

## ⚠️ Important Notes

### Model Naming Convention

- **Base models**: Unchanged (e.g., `gpt-oss:20b`)
- **Custom models**: `_ollmini` suffix (e.g., `gpt-oss:20b_ollmini`)
- **Reason**: Prevents conflicts, allows side-by-side comparison

### Base Model Requirement

Custom models reference **base models** via the `FROM` directive in Modelfiles.

**Example:**
```dockerfile
FROM gpt-oss:20b
TEMPLATE """..."""
PARAMETER temperature 0.7
```

**You must download the base model first:**
```bash
ollama pull gpt-oss:20b
```

Otherwise, `ollama create` will automatically download it (may take 10-60 minutes).

### Disk Space Requirements

- **Base model**: 5-50GB (depending on model size)
- **Custom model**: Minimal additional space (~100MB metadata)
- **Total**: Approximately same as base model

**Example:**
- `gpt-oss:20b`: 20GB
- `gpt-oss:20b_ollmini`: 20GB + 100MB = ~20.1GB

**Important:** Models share layers, so actual disk usage is optimized by Ollama.

### Update Existing Models

To update a custom model with new Modelfile changes:

**Auto-Setup:**
- Select the model in Auto-Setup
- Click "Apply Selected Models"
- Confirm "Overwrite" when prompted

**Manual:**
```bash
ollama create gpt-oss:20b_ollmini < Models/gpt-oss_20b_Modelfile.txt
```

Models are **replaced**, not updated incrementally.

---

## 🆘 Troubleshooting

### Common Issues

**1. "Base model not found" error**
```bash
Error: model 'gpt-oss:20b' not found
```

**Solution:**
```bash
# Pull the base model first
ollama pull gpt-oss:20b

# Then retry creating custom model
ollama create gpt-oss:20b_ollmini < Models/gpt-oss_20b_Modelfile.txt
```

---

**2. "Invalid Modelfile syntax" error**

**Solution:**
- Verify Modelfile structure (FROM, TEMPLATE, PARAMETER)
- Check for special characters or encoding issues
- Use UTF-8 encoding for Modelfiles

---

**3. Model appears but doesn't respond**

**Possible causes:**
- Endpoint misconfigured (Settings → Ollama Settings)
- Ollama service not running
- Firewall blocking port 11434

**Debugging:**
```bash
# Test Ollama API
curl http://localhost:11434/api/tags

# Check Ollama logs
ollama logs
```

---

**4. Tools don't work with custom model**

**Check:**
1. "Code Mode" button is enabled (blue)
2. Model supports tool calling (check `TOOL_CAPABLE_MODEL_PREFIXES` in code)
3. Working directory is set (Working Directory sidebar)

**Note:** Some models (like `gpt-oss`) may require specific training for tool calling. See `CLAUDE.md` Change 59 for model compatibility notes.

---

**5. Thinking blocks don't appear**

**Check:**
1. Settings → UI Settings → "Show Thinking Blocks" is enabled
2. Model supports thinking blocks (e.g., qwen3, gpt-oss with custom template)
3. Thinking level is set (Settings → Model Settings → Thinking Level)

---

## 📚 Additional Resources

- **Ollama Documentation**: https://github.com/ollama/ollama
- **Modelfile Specification**: https://github.com/ollama/ollama/blob/main/docs/modelfile.md
- **Ollmini Devbox Issues**: https://github.com/your-repo/issues
- **Model Compatibility**: See `CLAUDE.md` in project root for detailed model notes

---

## 🔄 Updating This Guide

This guide is located at:
```
<project-root>/Initial_Model_Setup.md
```

To update:
1. Edit the Markdown file
2. Test all instructions with actual setup
3. Update version/date if significant changes
4. Document changes in `CLAUDE.md` (Change log)

---

**Last Updated:** 2025-10-31
**Version:** 1.0
**Ollmini Devbox Version:** v0.2.0b
