// System Tools for File Operations and Command Execution
// These tools are exposed to the LLM when Code Mode is enabled

const SYSTEM_TOOLS = [
    {
        type: "function",
        function: {
            name: "read",
            description: "Reads files DIRECTLY from the real filesystem. Full access to any readable file on the system. This is NOT sandboxed - files are read from the actual host system.\n\nIMPORTANT: ALWAYS read files BEFORE editing them to understand structure and identify what needs to change. This is Step 1 of the file modification workflow.",
            parameters: {
                type: "object",
                properties: {
                    file_path: {
                        type: "string",
                        description: "Absolute or relative path to any file on the real filesystem"
                    },
                    offset: {
                        type: "number",
                        description: "Optional: The line number to start reading from (1-indexed)"
                    },
                    limit: {
                        type: "number",
                        description: "Optional: The number of lines to read"
                    }
                },
                required: ["file_path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write",
            description: "Writes files DIRECTLY to the real filesystem. Creates new files or overwrites existing ones on the actual host system. This is NOT sandboxed - files are written to the real filesystem.\n\n⚠️ CRITICAL - LAST RESORT TOOL:\n- Use 'write' ONLY for creating NEW files that don't exist\n- DO NOT use 'write' for existing files - use 'edit' instead (50x more context-efficient)\n- Context cost: Entire file content transmitted (~500-15000 tokens per file)\n- For existing files: Use 'edit' tool which only transmits changed sections (~100-300 tokens)\n\nWhen to use 'write':\n✅ Creating brand new file that doesn't exist\n✅ File needs 80%+ complete structural rewrite (extremely rare)\n\nWhen NOT to use 'write':\n❌ File exists and needs modifications → Use 'edit' instead\n❌ Adding/removing functions → Use 'edit' instead\n❌ Bug fixes or logic updates → Use 'edit' instead\n❌ Configuration changes → Use 'edit' instead",
            parameters: {
                type: "object",
                properties: {
                    file_path: {
                        type: "string",
                        description: "Absolute or relative path where the file will be written on the real filesystem"
                    },
                    content: {
                        type: "string",
                        description: "The content to write to the file"
                    }
                },
                required: ["file_path", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "edit",
            description: "✅ PREFERRED TOOL for modifying existing files. Edits files DIRECTLY on the real filesystem using exact string replacement. The old_string must match exactly (including whitespace and indentation). This is NOT sandboxed - files are modified on the actual host system.\n\nWHY USE 'edit' OVER 'write':\n- Context-efficient: Only transmits old_string + new_string (~100-300 tokens)\n- Surgical precision: Changes only what's necessary\n- 50x more efficient than rewriting entire files\n- Preserves file structure and unmodified code\n\nWORKFLOW:\n1. Read file to understand structure (use 'read' tool)\n2. Optionally grep to find exact location (use 'grep' tool for large files)\n3. Extract exact old_string from file\n4. Create minimal new_string with changes\n5. Use this 'edit' tool to replace\n\nFor multiple changes: Use multiple 'edit' calls (still more efficient than one 'write')\n\nExample:\nTask: Add error handling to function\n✅ Efficient: edit(file, old=\"function login() { api.call(); }\", new=\"function login() { try { api.call(); } catch(e) { handle(e); } }\")\n❌ Wasteful: write(file, <entire 500-line file with 1 function changed>)",
            parameters: {
                type: "object",
                properties: {
                    file_path: {
                        type: "string",
                        description: "Absolute or relative path to the file to edit on the real filesystem"
                    },
                    old_string: {
                        type: "string",
                        description: "The exact text to replace (must be unique in the file unless replace_all is true). Extract this from the file after reading it."
                    },
                    new_string: {
                        type: "string",
                        description: "The text to replace it with. Keep changes minimal and focused."
                    },
                    replace_all: {
                        type: "boolean",
                        description: "If true, replace all occurrences. If false (default), old_string must be unique"
                    }
                },
                required: ["file_path", "old_string", "new_string"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "bash",
            description: "CROSS-PLATFORM SHELL COMMAND EXECUTION\n\nPLATFORM DETECTION:\n- Windows: Uses cmd.exe (NOT PowerShell)\n- Linux/Mac: Uses /bin/sh\n- Tool response includes \"platform\" field showing current OS\n\nCRITICAL WINDOWS LIMITATIONS:\n❌ NEVER USE wmic - Command is REMOVED/DEPRECATED on modern Windows\n❌ NOT AVAILABLE: powershell (via cmd.exe), printf, lscpu, free, lspci, ip\n✅ USE INSTEAD: systeminfo, dxdiag, dir, tasklist, findstr, ipconfig, netstat\n\nCOMMAND FORMATTING:\n✅ Chain commands: command1 && command2 && command3\n✅ Sequential: command1 ; command2\n❌ NEVER use newlines (\\n) to separate commands\n\nCONTEXT-EFFICIENT EXECUTION PRINCIPLES:\n\n⚠️ CRITICAL: You are operating in a context-limited environment. Every token matters.\n\n1. MINIMIZE OUTPUT - Extract ONLY what the user requests:\n   - User asks \"What CPU?\" → Return ONLY CPU (1 line), NOT full hardware dump\n   - User asks \"What GPU?\" → Return ONLY GPU (1 line), NOT entire dxdiag output\n   - User asks \"How much RAM?\" → Return ONLY RAM (1 line)\n   - AVOID: Full diagnostic dumps that waste 5-10KB of context\n\n2. USE SMART FILTERING - Always pipe to findstr/grep:\n   Windows:\n   ✅ systeminfo | findstr \"Processor\" (returns ~1 line, ~80 tokens)\n   ❌ systeminfo (returns ~50 lines, ~2000 tokens)\n   ✅ dxdiag /t g.txt && findstr \"Card name\" g.txt && del g.txt (1 line)\n   ❌ dxdiag /t g.txt && type g.txt && del g.txt (~200 lines, ~8000 tokens)\n   \n   Linux:\n   ✅ lscpu | grep \"Model name\" (1 line)\n   ❌ lscpu (50+ lines)\n   ✅ free -h | grep \"Mem:\" (1 line)\n   ❌ free -h (multiple lines)\n\n3. THINK BEFORE EXECUTING:\n   Ask yourself:\n   - What does the user ACTUALLY need?\n   - What is the MINIMAL command to get that information?\n   - How can I FILTER the output to just the essential data?\n   \n   Example thought process:\n   User: \"What hardware do I have?\"\n   ❌ Bad: Run dxdiag full dump (wastes context)\n   ✅ Good: Run 3 targeted queries (CPU + GPU + RAM = ~3 lines total)\n\n4. ADAPTIVE QUERYING:\n   Match your query specificity to the user's question:\n   - Specific question → Specific filter\n   - General question → Multiple specific filters (NOT a dump)\n\nPLATFORM-SPECIFIC COMMANDS:\n\nWindows (cmd.exe):\n- System info: systeminfo\n- CPU: systeminfo | findstr \"Processor\" (FILTERED - context-efficient)\n- RAM: systeminfo | findstr \"Total Physical Memory\" (FILTERED)\n- GPU: dxdiag /t g.txt && findstr \"Card name\" g.txt && del g.txt (FILTERED)\n- Disk space: dir C:\\ (shows free bytes at bottom)\n- Processes: tasklist\n- Kill process: taskkill /PID <pid> /F\n- Search in files: findstr /s /i \"pattern\" *.txt\n- Network info: ipconfig /all\n- Network connections: netstat -ano\n- File operations: dir, type, copy, move, del, mkdir, rmdir\n\nIMPORTANT findstr SYNTAX:\n✅ CORRECT: findstr \"word1 word2\" file.txt  (space-separated, single /C:)\n✅ CORRECT: findstr \"Processor\" file.txt && findstr \"Memory\" file.txt  (chain filters)\n❌ WRONG: findstr /C:\"word1\" /C:\"word2\" file.txt  (only ONE /C: allowed)\n\nLinux/Mac (/bin/sh):\n- System info: uname -a\n- CPU: lscpu | grep \"Model name\" (FILTERED - context-efficient)\n- RAM: free -h | grep \"Mem:\" (FILTERED)\n- GPU: lspci | grep -i vga (FILTERED)\n- Disk space: df -h\n- Processes: ps aux\n- Kill process: kill -9 <pid>\n- Search in files: grep -r \"pattern\" .\n- Network info: ip addr show (Linux), ifconfig (Mac)\n- File operations: ls, cat, cp, mv, rm, mkdir, find\n\nAUTOMATIC COMMAND TRANSLATION (basic):\n- pwd → cd (Windows), pwd (Linux)\n- ls → dir (Windows), ls (Linux)\n- cat → type (Windows), cat (Linux)\nBUT: Use platform-native commands when possible for best results\n\nSTRATEGY:\n1. Detect platform from tool response (\"platform\": \"win32\" or \"linux\" or \"darwin\")\n2. Understand what the user ACTUALLY needs (not just what they asked)\n3. Build MINIMAL, FILTERED commands that extract only essential data\n4. ALWAYS use findstr/grep to minimize output when possible\n5. Adapt subsequent commands to the detected platform",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "Shell command with platform-specific syntax. IMPORTANT: Detect platform from previous tool responses (\"platform\" field) and use appropriate commands. Windows example: 'systeminfo | findstr Memory'. Linux example: 'free -h'. Chain commands with && or ; (NEVER use newlines). Examples: Windows: 'systeminfo && dir C:\\\\', Linux: 'lscpu && free -h && df -h'"
                    },
                    timeout: {
                        type: "number",
                        description: "Optional: Timeout in milliseconds (default: 120000 = 2 minutes)"
                    },
                    description: {
                        type: "string",
                        description: "Optional: A brief description of what this command does"
                    }
                },
                required: ["command"]
            }
        }
    }
];

module.exports = { SYSTEM_TOOLS };
