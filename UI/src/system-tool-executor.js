// System Tool Executor - Backend for executing system tools safely
//
// ⚠️ TODO V0.2.0: CRITICAL SECURITY ISSUES IN THIS FILE
// =======================================================
// This file has 2 CRITICAL security vulnerabilities that MUST be fixed before production:
//
// 1. COMMAND INJECTION (Lines ~310-367) - PRIORITY: IMMEDIATE
//    - Issue: User-supplied bash commands executed without sanitization
//    - Risk: Arbitrary code execution, full system compromise
//    - Fix: Implement command whitelist + parameter validation + use spawn() instead of exec()
//    - Estimated Effort: 8 hours
//    - See: docs/code-review-2025-10-24/CODE-REVIEW-SUMMARY.md#1-command-injection
//
// 2. PATH TRAVERSAL (Lines 34-39) - PRIORITY: IMMEDIATE
//    - Issue: No validation against ../ sequences, allows access to any file
//    - Risk: Read/write system files (/etc/passwd, /root/.ssh/authorized_keys)
//    - Fix: Validate paths stay within working directory + blacklist system directories
//    - Estimated Effort: 4 hours
//    - See: docs/code-review-2025-10-24/CODE-REVIEW-SUMMARY.md#2-path-traversal
//
// Total Security Fix Effort: 12 hours (MANDATORY for production)
// =======================================================

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Global current working directory (persistent across tool calls)
let currentWorkingDirectory = process.cwd();

// Track active child processes for cleanup on shutdown
const activeProcesses = new Set();

// Initialize working directory from saved state (called on app startup)
function initializeWorkingDirectory() {
    const { app } = require('electron');
    const fsSync = require('fs');
    const savedPath = path.join(app.getPath('userData'), 'working-directory.txt');

    try {
        if (fsSync.existsSync(savedPath)) {
            const savedDir = fsSync.readFileSync(savedPath, 'utf8').trim();
            if (savedDir && fsSync.existsSync(savedDir)) {
                currentWorkingDirectory = savedDir;
                console.log('✅ Restored working directory:', savedDir);
                return;
            }
        }
    } catch (error) {
        console.warn('⚠️ Failed to load saved working directory:', error.message);
    }

    console.log('ℹ️ Using default working directory:', currentWorkingDirectory);
}

// Helper function to ensure absolute path
function resolveAbsolutePath(filePath) {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    return path.resolve(currentWorkingDirectory, filePath);
}

// =============================================================================
// SECURITY FUNCTIONS (Added 2025-10-24 - Phase 5B Security Hardening)
// =============================================================================

// Blacklist of credential and sensitive configuration files
const CREDENTIAL_FILES = [
    '.p4config', '.git-credentials', '.netrc',
    '.ssh/config', '.aws/credentials',
    'settings.local.json', '.env', '.env.local'
];

// Security Fix #2: Path Traversal Protection
// Validates that file paths stay within working directory and don't access credential files
function validatePathWithinWorkingDirectory(filePath) {
    const absolute = path.resolve(currentWorkingDirectory, filePath);
    const normalized = path.normalize(absolute);
    const workingDirNormalized = path.normalize(currentWorkingDirectory);

    // Check if path escapes working directory
    if (!normalized.startsWith(workingDirNormalized + path.sep) && normalized !== workingDirNormalized) {
        throw new Error(`Access denied: Path outside working directory`);
    }

    // Blacklist credential files
    const basename = path.basename(normalized);
    if (CREDENTIAL_FILES.includes(basename)) {
        throw new Error(`Access denied: Credential file blocked (${basename})`);
    }

    return normalized;
}

// Security Fix #1: Environment Variable Sanitization
// Removes P4 credentials from environment before passing to child processes
function sanitizeEnv(env) {
    const safe = { ...env };
    // Remove Perforce credentials
    delete safe.P4PASSWD;
    delete safe.P4USER;
    delete safe.P4PORT;
    delete safe.P4CLIENT;
    // Remove other common credential variables
    delete safe.AWS_SECRET_ACCESS_KEY;
    delete safe.GH_TOKEN;
    delete safe.GITHUB_TOKEN;
    return safe;
}

// Security Fix #4: Command Validation Against Inline Credentials
// Blocks bash commands that contain inline credentials
function validateCommandSecurity(command) {
    const credentialPatterns = [
        /-P\s+\w+/,              // p4 -P password
        /--password[=\s]/i,      // --password=xxx
        /P4PASSWD=/i,            // P4PASSWD=xxx
        /passwd[=\s]/i,          // passwd=xxx
        /AWS_SECRET_ACCESS_KEY/i // AWS credentials
    ];

    for (const pattern of credentialPatterns) {
        if (pattern.test(command)) {
            throw new Error(
                'Security Error: Credentials detected in command. ' +
                'Please use .p4config file instead of inline credentials.'
            );
        }
    }
}

// =============================================================================

// Cross-platform command translation (Unix → Windows)
function translateCommand(command, targetPlatform) {
    if (targetPlatform !== 'win32') {
        return command; // Unix/Linux/macOS: no translation needed
    }

    // Windows: Comprehensive Unix-to-Windows command translation
    const translations = [
        // ==================== FILE OPERATIONS ====================
        { pattern: /^pwd\s*$/i, replacement: 'cd' },
        { pattern: /^ls\s*(-[a-zA-Z]*\s*)?(.*)$/i, replacement: 'dir $2' },
        { pattern: /^cat\s+(.+)$/i, replacement: 'type $1' },
        { pattern: /^rm\s+-rf\s+(.+)$/i, replacement: 'rmdir /s /q $1' },
        { pattern: /^rm\s+-r\s+(.+)$/i, replacement: 'rmdir /s /q $1' },
        { pattern: /^rm\s+(.+)$/i, replacement: 'del /f $1' },
        { pattern: /^cp\s+-r\s+(.+?)\s+(.+)$/i, replacement: 'xcopy $1 $2 /e /i' },
        { pattern: /^cp\s+(.+?)\s+(.+)$/i, replacement: 'copy $1 $2' },
        { pattern: /^mv\s+(.+?)\s+(.+)$/i, replacement: 'move $1 $2' },
        { pattern: /^touch\s+(.+)$/i, replacement: 'type nul > $1' },
        { pattern: /^mkdir\s+-p\s+(.+)$/i, replacement: 'mkdir $1' },
        { pattern: /^mkdir\s+(.+)$/i, replacement: 'mkdir $1' },
        { pattern: /^rmdir\s+(.+)$/i, replacement: 'rmdir $1' },
        { pattern: /^ln\s+-s\s+(.+?)\s+(.+)$/i, replacement: 'mklink $2 $1' },
        { pattern: /^find\s+\.\s+-name\s+(.+)$/i, replacement: 'dir /s /b $1' },
        { pattern: /^tree\s*(.*)$/i, replacement: 'tree $1' },
        { pattern: /^du\s+-sh\s+(.+)$/i, replacement: 'dir /s $1' },
        { pattern: /^du\s+(.+)$/i, replacement: 'dir /s $1' },
        { pattern: /^head\s+-n\s*(\d+)\s+(.+)$/i, replacement: 'more /e +1 $2 | findstr /n ".*" | findstr "^[1-$1]:"' },
        { pattern: /^head\s+(.+)$/i, replacement: 'more /e +1 $1 | findstr /n ".*" | findstr "^[1-9]:" & more /e +1 $1 | findstr /n ".*" | findstr "^10:"' },
        { pattern: /^tail\s+-n\s*(\d+)\s+(.+)$/i, replacement: 'echo Command "tail -n" not fully supported on Windows. Use: type $2' },
        { pattern: /^tail\s+-f\s+(.+)$/i, replacement: 'echo Command "tail -f" not supported on Windows CMD. Use PowerShell or Git Bash.' },
        { pattern: /^tail\s+(.+)$/i, replacement: 'echo Command "tail" not fully supported on Windows. Use: type $1' },
        { pattern: /^wc\s+-l\s+(.+)$/i, replacement: 'find /c /v "" $1' },
        { pattern: /^wc\s+(.+)$/i, replacement: 'find /c /v "" $1' },
        { pattern: /^diff\s+(.+?)\s+(.+)$/i, replacement: 'fc $1 $2' },
        { pattern: /^basename\s+(.+)$/i, replacement: 'for %A in ($1) do @echo %~nxA' },
        { pattern: /^dirname\s+(.+)$/i, replacement: 'for %A in ($1) do @echo %~dpA' },
        { pattern: /^realpath\s+(.+)$/i, replacement: 'for %A in ($1) do @echo %~fA' },

        // ==================== TEXT PROCESSING ====================
        { pattern: /^grep\s+-r\s+(.+?)\s+(.+)$/i, replacement: 'findstr /s $1 $2' },
        { pattern: /^grep\s+-i\s+(.+?)\s+(.+)$/i, replacement: 'findstr /i $1 $2' },
        { pattern: /^grep\s+(.+?)\s+(.+)$/i, replacement: 'findstr $1 $2' },
        { pattern: /^sort\s+(.+)$/i, replacement: 'sort $1' },
        { pattern: /^uniq\s+(.+)$/i, replacement: 'sort $1 | more' },
        { pattern: /^cut\s+-d\s*(.)\s+-f\s*(\d+)\s+(.+)$/i, replacement: 'echo Command "cut" not fully supported on Windows CMD.' },
        { pattern: /^tr\s+(.+?)\s+(.+)$/i, replacement: 'echo Command "tr" not supported on Windows CMD.' },

        // ==================== SYSTEM INFO ====================
        { pattern: /^whoami\s*$/i, replacement: 'whoami' },
        { pattern: /^hostname\s*$/i, replacement: 'hostname' },
        { pattern: /^uname\s+-a$/i, replacement: 'ver && echo. && systeminfo | findstr "OS"' },
        { pattern: /^uname\s+-s$/i, replacement: 'ver' },
        { pattern: /^uname\s+-r$/i, replacement: 'ver' },
        { pattern: /^uname\s+-m$/i, replacement: 'echo %PROCESSOR_ARCHITECTURE%' },
        { pattern: /^uname\s+-n$/i, replacement: 'hostname' },
        { pattern: /^uname\s*$/i, replacement: 'ver' },
        { pattern: /^uptime\s*$/i, replacement: 'systeminfo | findstr "Boot"' },
        { pattern: /^date\s*$/i, replacement: 'date /t' },
        { pattern: /^df\s+-h$/i, replacement: 'dir /-c c:\\' },
        { pattern: /^df\s*$/i, replacement: 'dir /-c c:\\' },
        { pattern: /^free\s*.*$/i, replacement: 'systeminfo | findstr "Memory"' },
        { pattern: /^env\s*$/i, replacement: 'set' },
        { pattern: /^printenv\s*$/i, replacement: 'set' },
        { pattern: /^export\s+(.+)=(.+)$/i, replacement: 'set $1=$2' },
        { pattern: /^echo\s+(.+)$/i, replacement: 'echo $1' },

        // ==================== PROCESS MANAGEMENT ====================
        { pattern: /^top\s*$/i, replacement: 'tasklist' },
        { pattern: /^htop\s*$/i, replacement: 'tasklist' },
        { pattern: /^ps\s+aux$/i, replacement: 'tasklist /v' },
        { pattern: /^ps\s+-ef$/i, replacement: 'tasklist /v' },
        { pattern: /^ps\s*$/i, replacement: 'tasklist' },
        { pattern: /^kill\s+-9\s+(.+)$/i, replacement: 'taskkill /f /pid $1' },
        { pattern: /^kill\s+(.+)$/i, replacement: 'taskkill /pid $1' },
        { pattern: /^killall\s+(.+)$/i, replacement: 'taskkill /im $1 /f' },
        { pattern: /^pkill\s+(.+)$/i, replacement: 'taskkill /im $1 /f' },
        { pattern: /^pgrep\s+(.+)$/i, replacement: 'tasklist | findstr $1' },
        { pattern: /^jobs\s*$/i, replacement: 'tasklist' },
        { pattern: /^sleep\s+(\d+)$/i, replacement: 'timeout /t $1 /nobreak' },
        { pattern: /^time\s+(.+)$/i, replacement: 'echo Executing: $1 && time < nul && $1 && time < nul' },

        // ==================== NETWORK ====================
        { pattern: /^ifconfig\s*$/i, replacement: 'ipconfig' },
        { pattern: /^ping\s+(.+)$/i, replacement: 'ping $1' },
        { pattern: /^traceroute\s+(.+)$/i, replacement: 'tracert $1' },
        { pattern: /^nslookup\s+(.+)$/i, replacement: 'nslookup $1' },
        { pattern: /^dig\s+(.+)$/i, replacement: 'nslookup $1' },
        { pattern: /^wget\s+(.+)$/i, replacement: 'curl -o output $1' },
        { pattern: /^curl\s+(.+)$/i, replacement: 'curl $1' },
        { pattern: /^netstat\s+(.*)$/i, replacement: 'netstat $1' },
        { pattern: /^lsof\s+-i:(\d+)$/i, replacement: 'netstat -ano | findstr :$1' },
        { pattern: /^lsof\s*$/i, replacement: 'netstat -ano' },

        // ==================== ARCHIVE/COMPRESSION ====================
        { pattern: /^tar\s+-xzvf\s+(.+)$/i, replacement: 'tar -xzvf $1' },
        { pattern: /^tar\s+-xzf\s+(.+)$/i, replacement: 'tar -xzf $1' },
        { pattern: /^tar\s+(.+)$/i, replacement: 'tar $1' },
        { pattern: /^zip\s+-r\s+(.+?)\s+(.+)$/i, replacement: 'echo Command "zip" requires PowerShell or 7-Zip. Use: tar -a -c -f $1.zip $2' },
        { pattern: /^unzip\s+(.+)$/i, replacement: 'tar -x -f $1' },

        // ==================== USER/PERMISSIONS ====================
        { pattern: /^sudo\s+(.+)$/i, replacement: 'runas /user:Administrator "$1"' },
        { pattern: /^su\s*$/i, replacement: 'runas /user:Administrator cmd' },
        { pattern: /^chmod\s+(.+?)\s+(.+)$/i, replacement: 'icacls $2 /grant Everyone:F' },
        { pattern: /^chown\s+(.+?)\s+(.+)$/i, replacement: 'takeown /f $2' },
        { pattern: /^id\s*$/i, replacement: 'whoami /all' },
        { pattern: /^groups\s*$/i, replacement: 'whoami /groups' },
        { pattern: /^users\s*$/i, replacement: 'net user' },

        // ==================== SHELL BUILT-INS ====================
        { pattern: /^which\s+(.+)$/i, replacement: 'where $1' },
        { pattern: /^whereis\s+(.+)$/i, replacement: 'where $1' },
        { pattern: /^alias\s+(.+)=(.+)$/i, replacement: 'doskey $1=$2' },
        { pattern: /^history\s*$/i, replacement: 'doskey /history' },
        { pattern: /^clear\s*$/i, replacement: 'cls' },
        { pattern: /^exit\s*$/i, replacement: 'exit' },
        { pattern: /^source\s+(.+)$/i, replacement: 'call $1' },
        { pattern: /^\.\s+(.+)$/i, replacement: 'call $1' },
        { pattern: /^read\s+(.+)$/i, replacement: 'set /p $1=' }
    ];

    // Try direct translation
    for (const { pattern, replacement } of translations) {
        if (pattern.test(command)) {
            return command.replace(pattern, replacement);
        }
    }

    // Check for unsupported commands
    const unsupportedCommands = ['awk', 'sed', 'vim', 'vi', 'nano', 'emacs', 'less', 'more', 'man', 'xargs', 'ssh', 'scp', 'rsync', 'make', 'gcc', 'g++', 'perl', 'python', 'ruby', 'node'];

    const cmdName = command.split(/\s+/)[0].toLowerCase();
    if (unsupportedCommands.includes(cmdName)) {
        return `echo "⚠️ Command '${cmdName}' not available on Windows. Install Git Bash or WSL for full Unix compatibility."`;
    }

    return command; // No match: return original
}

// Read file
function executeRead(args) {
    const { file_path, offset, limit } = args;
    const absolutePath = validatePathWithinWorkingDirectory(file_path); // Security Fix #2: Path validation

    try {
        if (!fs.existsSync(absolutePath)) {
            return {
                success: false,
                error: `File not found: ${absolutePath}`
            };
        }

        const content = fs.readFileSync(absolutePath, 'utf-8');

        // If offset/limit specified, slice lines
        if (offset !== undefined || limit !== undefined) {
            const lines = content.split('\n');
            const startLine = (offset || 1) - 1; // Convert to 0-indexed
            const endLine = limit ? startLine + limit : lines.length;
            const slicedLines = lines.slice(startLine, endLine);

            return {
                success: true,
                content: slicedLines.join('\n'),
                lines_read: slicedLines.length,
                total_lines: lines.length,
                offset: offset || 1
            };
        }

        return {
            success: true,
            content: content,
            size: content.length,
            lines: content.split('\n').length
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Write file
function executeWrite(args) {
    const { file_path, content } = args;
    const absolutePath = validatePathWithinWorkingDirectory(file_path); // Security Fix #2: Path validation

    try {
        // Ensure directory exists
        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(absolutePath, content, 'utf-8');

        return {
            success: true,
            message: `File written successfully: ${absolutePath}`,
            bytes_written: content.length
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Edit file (string replacement)
function executeEdit(args) {
    const { file_path, old_string, new_string, replace_all } = args;
    const absolutePath = validatePathWithinWorkingDirectory(file_path); // Security Fix #2: Path validation

    try {
        if (!fs.existsSync(absolutePath)) {
            return {
                success: false,
                error: `File not found: ${absolutePath}`
            };
        }

        let content = fs.readFileSync(absolutePath, 'utf-8');

        // Check if old_string exists
        if (!content.includes(old_string)) {
            return {
                success: false,
                error: `String not found in file: "${old_string.substring(0, 50)}${old_string.length > 50 ? '...' : ''}"`
            };
        }

        // If not replace_all, check if old_string is unique
        if (!replace_all) {
            const occurrences = content.split(old_string).length - 1;
            if (occurrences > 1) {
                return {
                    success: false,
                    error: `String appears ${occurrences} times in file. Use replace_all: true or provide a more unique string.`
                };
            }
        }

        // Perform replacement
        const newContent = replace_all
            ? content.split(old_string).join(new_string)
            : content.replace(old_string, new_string);

        fs.writeFileSync(absolutePath, newContent, 'utf-8');

        const replacements = content.split(old_string).length - 1;

        return {
            success: true,
            message: `File edited successfully: ${absolutePath}`,
            replacements_made: replacements
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Bash command execution (cross-platform with auto-translation)
async function executeBash(args) {
    const { command, timeout = 120000, description } = args;

    try {
        // Security Fix #4: Validate command doesn't contain inline credentials
        validateCommandSecurity(command);

        const platform = process.platform;

        // Translate Unix commands to platform equivalents
        const translatedCommand = translateCommand(command, platform);

        // Log translation if different
        if (translatedCommand !== command) {
            console.log(`🔄 Command translated: "${command}" → "${translatedCommand}"`);
        }

        // Check if this is a 'cd' command to update working directory
        const isCdCommand = /^cd\s+/.test(command.trim());

        // Execute command and track child process for cleanup
        const result = await new Promise((resolve, reject) => {
            const childProcess = exec(translatedCommand, {
                timeout: timeout,
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                cwd: currentWorkingDirectory,
                env: sanitizeEnv(process.env) // Remove credentials from environment
            }, (error, stdout, stderr) => {
                // Remove from tracking when complete
                activeProcesses.delete(childProcess);

                if (error) {
                    error.stdout = stdout;
                    error.stderr = stderr;
                    reject(error);
                } else {
                    resolve({ stdout, stderr });
                }
            });

            // Track active process for cleanup
            activeProcesses.add(childProcess);
        });

        // Update global CWD if 'cd' command was successful
        if (isCdCommand && result.stdout !== undefined) {
            const cdPath = command.trim().substring(3).trim().replace(/['"]/g, ''); // Extract path from "cd <path>"
            const newCwd = path.isAbsolute(cdPath)
                ? cdPath
                : path.resolve(currentWorkingDirectory, cdPath);

            // Verify directory exists before updating
            if (fs.existsSync(newCwd) && fs.statSync(newCwd).isDirectory()) {
                currentWorkingDirectory = newCwd;
                console.log(`📁 Working directory changed to: ${currentWorkingDirectory}`);
            }
        }

        return {
            success: true,
            stdout: result.stdout,
            stderr: result.stderr,
            command: command,
            translated_command: translatedCommand !== command ? translatedCommand : undefined,
            platform: platform,
            description: description
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            stdout: error.stdout || '',
            stderr: error.stderr || '',
            command: command,
            exit_code: error.code
        };
    }
}

// Main executor function
async function executeSystemTool(toolName, args) {
    console.log(`🔧 Executing system tool: ${toolName}`, args);

    try {
        let result;

        switch (toolName) {
            case 'read':
                result = executeRead(args);
                break;
            case 'write':
                result = executeWrite(args);
                break;
            case 'edit':
                result = executeEdit(args);
                break;
            case 'bash':
                result = await executeBash(args);
                break;
            default:
                result = {
                    success: false,
                    error: `Unknown tool: ${toolName}`
                };
        }

        console.log(`✅ Tool execution result:`, result);
        return result;
    } catch (error) {
        console.error(`❌ Tool execution error:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Export working directory functions
function getCurrentWorkingDirectory() {
    return currentWorkingDirectory;
}

function setCurrentWorkingDirectory(newPath) {
    const fsSync = require('fs');
    const { app } = require('electron');

    if (fsSync.existsSync(newPath)) {
        currentWorkingDirectory = newPath;

        // Save to persistent storage
        try {
            const savedPath = path.join(app.getPath('userData'), 'working-directory.txt');
            fsSync.writeFileSync(savedPath, newPath, 'utf8');
            console.log('💾 Saved working directory:', newPath);
        } catch (error) {
            console.warn('⚠️ Failed to save working directory:', error.message);
        }

        return { success: true, path: currentWorkingDirectory };
    } else {
        throw new Error(`Directory does not exist: ${newPath}`);
    }
}

// Kill all active child processes (for graceful shutdown)
function killAllProcesses() {
    try {
        console.log(`[TOOL-EXECUTOR] Cleanup: Killing ${activeProcesses.size} active processes...`);

        let killed = 0;
        for (const childProcess of activeProcesses) {
            try {
                if (!childProcess.killed) {
                    childProcess.kill('SIGTERM'); // Graceful termination
                    killed++;
                }
            } catch (error) {
                console.error('[TOOL-EXECUTOR] Error killing process:', error);
            }
        }

        activeProcesses.clear();
        console.log(`[TOOL-EXECUTOR] Cleanup completed: ${killed} processes killed`);

        return { success: true, killed };
    } catch (error) {
        console.error('[TOOL-EXECUTOR] Cleanup error:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    executeSystemTool,
    getCurrentWorkingDirectory,
    setCurrentWorkingDirectory,
    initializeWorkingDirectory,
    killAllProcesses  // NEW: Kill active processes for graceful shutdown
};
