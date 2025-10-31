// Permission Manager for Tool Execution
// Creates and manages .model-name/permissions.json in working directory

const fs = require('fs');
const path = require('path');

class PermissionManager {
    constructor(modelName, workingDir) {
        this.modelName = modelName;

        // "gpt-oss:20b" → ".gpt-oss"
        // "qwen3:14b" → ".qwen3"
        const modelBaseName = modelName.split(':')[0];
        this.modelFolder = `.${modelBaseName}`;

        this.workingDir = workingDir || process.cwd();
        this.configDir = path.join(this.workingDir, this.modelFolder);
        this.permissionsFile = path.join(this.configDir, 'permissions.json');

        this.permissions = this.loadPermissions();
    }

    // Load permissions from file or create initial config
    loadPermissions() {
        try {
            if (fs.existsSync(this.permissionsFile)) {
                const data = fs.readFileSync(this.permissionsFile, 'utf-8');
                const parsed = JSON.parse(data);

                // Validate structure - ensure allowed_tools array exists
                if (!parsed || typeof parsed !== 'object') {
                    console.warn('⚠️ Invalid permission file structure, creating new one');
                    return this.createDefaultPermissions();
                }

                if (!Array.isArray(parsed.allowed_tools)) {
                    console.warn('⚠️ Missing or invalid allowed_tools array, fixing...');
                    parsed.allowed_tools = [];
                }

                return parsed;
            }
        } catch (error) {
            console.error('❌ Error loading permissions (will create new file):', error.message);
            // If JSON is corrupted, create new default permissions
        }

        return this.createDefaultPermissions();
    }

    // Create default permissions structure
    createDefaultPermissions() {
        const initial = {
            model: this.modelName,
            created_at: new Date().toISOString(),
            working_directory: this.workingDir,
            allowed_tools: []
        };

        // Create directory if it doesn't exist
        try {
            if (!fs.existsSync(this.configDir)) {
                fs.mkdirSync(this.configDir, { recursive: true });
                console.log(`📁 Created permission directory: ${this.configDir}`);
            }

            // Write initial permissions file
            fs.writeFileSync(this.permissionsFile, JSON.stringify(initial, null, 2), 'utf-8');
            console.log(`📄 Created permissions file: ${this.permissionsFile}`);
        } catch (error) {
            console.error('❌ Error creating permissions file:', error.message);
            console.warn('⚠️ Permissions will work in-memory but won\'t be saved to disk');
        }

        return initial;
    }

    // Check if a tool is allowed
    isAllowed(toolName, args) {
        // Defensive check: ensure permissions structure is valid
        if (!this.permissions || !Array.isArray(this.permissions.allowed_tools)) {
            console.error('❌ Permission structure corrupted, denying access');
            return false;
        }

        const toolKey = this.getToolKey(toolName, args);
        const allowed = this.permissions.allowed_tools.includes(toolKey);

        console.log(`🔍 Permission check: ${toolKey} → ${allowed ? '✅ Allowed' : '❌ Not allowed'}`);

        return allowed;
    }

    // Add tool to allowed list
    addAllowed(toolName, args) {
        // Defensive check: ensure permissions structure is valid
        if (!this.permissions || !Array.isArray(this.permissions.allowed_tools)) {
            console.error('❌ Permission structure corrupted, cannot add tool');
            console.warn('⚠️ Reinitializing permission structure...');
            this.permissions = this.createDefaultPermissions();
        }

        const toolKey = this.getToolKey(toolName, args);

        if (!this.permissions.allowed_tools.includes(toolKey)) {
            this.permissions.allowed_tools.push(toolKey);
            this.save();
            console.log(`✅ Added to allowed tools: ${toolKey}`);
        }
    }

    // Generate tool key for permission tracking
    getToolKey(toolName, args) {
        // For bash commands: "bash:ls", "bash:systeminfo", "bash:rm"
        if (toolName === 'bash' && args && args.command) {
            const cmd = args.command;

            // Security Fix #5: Force re-approval for credential-exposing commands
            // These commands can expose credentials and should NEVER be "Always Allowed"
            const dangerousPatterns = [
                /\benv\b/i,                  // env - shows all environment variables
                /\bprintenv\b/i,             // printenv - shows environment
                /\bexport\s+P4/i,            // export P4* - sets credentials
                /\bps\s+.*e/i,               // ps -e/auxe - shows env vars in process list
                /\.p4config/,                // accessing credential files
                /P4PASSWD/i,                 // credential variable
                /settings\.local\.json/      // settings file with credentials
            ];

            // If command matches dangerous pattern, use unique key to force re-approval
            if (dangerousPatterns.some(p => p.test(cmd))) {
                return `bash:CREDENTIAL_SENSITIVE:${cmd.substring(0, 20)}`;
            }

            // Extract base command (first word)
            const cmdFirst = cmd.trim().split(/\s+/)[0];
            return `bash:${cmdFirst}`;
        }

        // For other tools: "read", "write", "edit", "glob"
        return toolName;
    }

    // Save permissions to file
    save() {
        // Defensive check: ensure permissions structure is valid before saving
        if (!this.permissions || !Array.isArray(this.permissions.allowed_tools)) {
            console.error('❌ Cannot save: Invalid permission structure');
            return;
        }

        try {
            // Ensure directory exists before writing
            if (!fs.existsSync(this.configDir)) {
                fs.mkdirSync(this.configDir, { recursive: true });
                console.log(`📁 Created permission directory: ${this.configDir}`);
            }

            fs.writeFileSync(
                this.permissionsFile,
                JSON.stringify(this.permissions, null, 2),
                'utf-8'
            );
            console.log(`💾 Saved permissions to ${this.permissionsFile}`);
        } catch (error) {
            console.error('❌ Error saving permissions:', error.message);
            console.warn(`⚠️ File: ${this.permissionsFile}`);
            console.warn('⚠️ Changes will be lost on restart');
        }
    }

    // Get human-readable description of tool
    getToolDescription(toolName, args) {
        if (toolName === 'bash' && args && args.command) {
            return `bash: ${args.command}`;
        } else if (args && args.file_path) {
            return `${toolName}: ${args.file_path}`;
        } else if (args && args.pattern) {
            return `${toolName}: ${args.pattern}`;
        }
        return toolName;
    }
}

module.exports = { PermissionManager };
