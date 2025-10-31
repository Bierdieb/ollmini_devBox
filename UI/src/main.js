const { app, BrowserWindow, ipcMain, dialog, Menu, shell, globalShortcut } = require('electron');

// Set app name for dedicated user data directory
// CRITICAL: Must be BEFORE any module imports that call app.getPath('userData')
app.setName('Ollmini-Devbox');

const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const windowStateKeeper = require('electron-window-state');
const ragManager = require('./rag-manager');
const { sanitizeForConsole } = require('./console-helper');

let mainWindow;
let dashboardWindow;

// Disable GPU acceleration to prevent crashes in WSL/virtualized environments
app.disableHardwareAcceleration();

// Security Fix #9: Enable Chrome DevTools Protocol ONLY in development mode
// SECURITY: DevTools expose console logs and localStorage which may contain credentials
// Production builds should NEVER enable this
if (process.argv.includes('--dev') || process.env.NODE_ENV === 'development') {
    app.commandLine.appendSwitch('remote-debugging-port', '9222');
    console.log('🔧 DevTools remote debugging enabled on port 9222 (development mode)');
} else {
    console.log('🔒 DevTools remote debugging DISABLED (production mode - security)');
}

function createWindow() {
  // Manage window state (position, size)
  let mainState = windowStateKeeper({
    defaultWidth: 1000,
    defaultHeight: 700,
    file: 'main-window-state.json'
  });

  mainWindow = new BrowserWindow({
    x: mainState.x,
    y: mainState.y,
    width: mainState.width,
    height: mainState.height,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/icon.png')
  });

  // Track window state
  mainState.manage(mainWindow);

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Redirect renderer console to main process stdout for debugging
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    try {
      const levelMap = { 0: 'LOG', 1: 'WARN', 2: 'ERROR' };
      const levelName = levelMap[level] || 'LOG';
      const source = sourceId ? `[${sourceId.split('/').pop()}:${line}]` : '';
      // Sanitize Unicode characters for Windows console compatibility
      const sanitizedMessage = sanitizeForConsole(message);
      console.log(`[RENDERER ${levelName}] ${source} ${sanitizedMessage}`);
    } catch (err) {
      // Ignore EPIPE errors during app shutdown (stdout already closed)
      if (err.code !== 'EPIPE') {
        console.error('Console message handler error:', err);
      }
    }
  });

  // Security: Block navigation to external URLs, open in system browser instead
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
      console.log('[L] Blocked navigation to external URL, opening in system browser:', url);
    }
  });

  // Security: Block new windows, open external URLs in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file://')) {
      return { action: 'allow' };
    } else {
      shell.openExternal(url);
      console.log('[L] Blocked new window, opening in system browser:', url);
      return { action: 'deny' };
    }
  });

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Enable right-click context menu
  mainWindow.webContents.on('context-menu', (event, params) => {
    const template = [
      {
        label: 'Cut',
        role: 'cut',
        enabled: params.editFlags.canCut,
        visible: params.isEditable
      },
      {
        label: 'Copy',
        role: 'copy',
        enabled: params.editFlags.canCopy
      },
      {
        label: 'Paste',
        role: 'paste',
        enabled: params.editFlags.canPaste,
        visible: params.isEditable
      },
      {
        type: 'separator'
      },
      {
        label: 'Select All',
        role: 'selectAll'
      }
    ];

    // Add Inspect Element in dev mode
    if (process.argv.includes('--dev')) {
      template.push(
        { type: 'separator' },
        {
          label: 'Inspect Element',
          click: () => {
            mainWindow.webContents.inspectElement(params.x, params.y);
          }
        }
      );
    }

    const menu = Menu.buildFromTemplate(template);
    menu.popup();
  });

  mainWindow.on('closed', function () {
    try {
      mainWindow = null;
      // Close dashboard when main window closes
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.close();
      }
    } catch (error) {
      console.error('[APP] Error in mainWindow closed handler:', error);
    }
  });
}

function createDashboardWindow() {
  // Prevent opening multiple dashboard windows
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.focus();
    return;
  }

  // Manage window state (position, size)
  let dashboardState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
    file: 'dashboard-window-state.json'
  });

  dashboardWindow = new BrowserWindow({
    x: dashboardState.x,
    y: dashboardState.y,
    width: dashboardState.width,
    height: dashboardState.height,
    minWidth: 400,
    minHeight: 300,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/icon.png'),
    title: 'Dashboard - RAG & Context Monitor',
  });

  // Track window state
  dashboardState.manage(dashboardWindow);

  dashboardWindow.loadFile(path.join(__dirname, 'dashboard.html'));

  // Security: Block navigation to external URLs, open in system browser instead
  dashboardWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
      console.log('[L] Dashboard: Blocked navigation to external URL, opening in system browser:', url);
    }
  });

  // Security: Block new windows, open external URLs in system browser
  dashboardWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file://')) {
      return { action: 'allow' };
    } else {
      shell.openExternal(url);
      console.log('[L] Dashboard: Blocked new window, opening in system browser:', url);
      return { action: 'deny' };
    }
  });

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    dashboardWindow.webContents.openDevTools();
  }

  dashboardWindow.on('closed', function () {
    try {
      dashboardWindow = null;
    } catch (error) {
      console.error('[APP] Error in dashboardWindow closed handler:', error);
    }
  });
}

function toggleDashboard() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.close();
  } else {
    createDashboardWindow();
  }
}

app.whenReady().then(async () => {
  // Initialize working directory from saved state
  const systemToolExecutor = require('./system-tool-executor');
  systemToolExecutor.initializeWorkingDirectory();

  // RAG database will be initialized on-demand when first used
  // (removed auto-initialization to prevent loading embedding model into VRAM)

  createWindow();

  // Register global shortcut for dashboard toggle (Ctrl+Shift+D)
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    toggleDashboard();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    try {
      globalShortcut.unregisterAll();
      console.log('[APP] window-all-closed: Shortcuts unregistered');
    } catch (error) {
      console.error('[APP] Error unregistering shortcuts:', error);
    }
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

// Graceful shutdown handler - cleanup before app quits
app.on('before-quit', (event) => {
  try {
    console.log('[APP] before-quit: Starting graceful shutdown...');

    // Cleanup RAG manager (abort indexing, clear DB references)
    try {
      const ragManager = require('./rag-manager');
      ragManager.cleanup();
      console.log('[APP] RAG manager cleaned up');
    } catch (error) {
      console.error('[APP] Error cleaning up RAG manager:', error);
    }

    // Kill all active bash processes
    try {
      const systemToolExecutor = require('./system-tool-executor');
      systemToolExecutor.killAllProcesses();
      console.log('[APP] Active processes killed');
    } catch (error) {
      console.error('[APP] Error killing processes:', error);
    }

    // Unregister all global shortcuts
    globalShortcut.unregisterAll();
    console.log('[APP] Global shortcuts unregistered');

    // Close all windows gracefully
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.destroy();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }

    console.log('[APP] Graceful shutdown completed');
  } catch (error) {
    // Log error but don't prevent quit
    console.error('[APP] Error during graceful shutdown:', error);
  }
});

// Final cleanup handler - last chance to clean up
app.on('will-quit', (event) => {
  try {
    console.log('[APP] will-quit: Final cleanup...');

    // Ensure shortcuts are unregistered (redundant safety)
    if (globalShortcut) {
      globalShortcut.unregisterAll();
    }

    console.log('[APP] Final cleanup completed');
  } catch (error) {
    // Log error but don't prevent quit
    console.error('[APP] Error during final cleanup:', error);
  }
});

// IPC Handlers for Working Directory
ipcMain.handle('get-cwd', async () => {
  const systemToolExecutor = require('./system-tool-executor');
  return systemToolExecutor.getCurrentWorkingDirectory();
});

ipcMain.handle('set-cwd', async (event, newPath) => {
  const systemToolExecutor = require('./system-tool-executor');
  return systemToolExecutor.setCurrentWorkingDirectory(newPath);
});

ipcMain.handle('list-directory', async (event, dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      let size = 0;
      let modified = null;

      try {
        const stats = await fs.stat(fullPath);
        size = stats.size;
        modified = stats.mtime;
      } catch (statError) {
        // If stat fails, use defaults
        console.warn(`Could not stat ${fullPath}:`, statError.message);
      }

      results.push({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: fullPath,
        size: size,
        modified: modified
      });
    }

    return results;
  } catch (error) {
    throw new Error(`Failed to read directory: ${error.message}`);
  }
});

ipcMain.handle('open-directory-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('execute-system-tool', async (event, toolName, args) => {
  const systemToolExecutor = require('./system-tool-executor');
  return await systemToolExecutor.executeSystemTool(toolName, args);
});

// IPC Handler for opening files in system editor
ipcMain.handle('open-file-in-editor', async (event, filePath) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC Handlers for Persistent Working Directory Storage
ipcMain.handle('save-working-directory', async (event, dirPath) => {
  // localStorage is managed in renderer, this just validates
  return { success: true };
});

ipcMain.handle('load-working-directory', async () => {
  // Returns nothing, renderer uses localStorage directly
  return null;
});

// IPC Handler for User Data Path
ipcMain.handle('get-user-data-path', async () => {
  return app.getPath('userData');
});

// IPC Handlers for RAG
ipcMain.handle('rag-init', async () => {
  return await ragManager.initializeDatabase();
});

ipcMain.handle('rag-index-files', async (event, filePaths) => {
  // Progress callback that forwards progress events to renderer
  const progressCallback = (progressData) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rag-index-progress', progressData);
    }
  };

  return await ragManager.addDocuments(filePaths, progressCallback);
});

ipcMain.handle('rag-abort-indexing', async () => {
  return await ragManager.abortIndexing();
});

ipcMain.handle('rag-search', async (event, query) => {
  return await ragManager.search(query);
});

ipcMain.handle('rag-clear', async () => {
  return await ragManager.clearDatabase();
});

ipcMain.handle('rag-stats', async () => {
  return await ragManager.getStats();
});

ipcMain.handle('rag-set-endpoint', async (event, endpoint) => {
  ragManager.setOllamaEndpoint(endpoint);
  return { success: true };
});

ipcMain.handle('rag-set-embedding-model', async (event, modelName) => {
  ragManager.setEmbeddingModel(modelName);
  return { success: true };
});

ipcMain.handle('rag-set-config', async (event, ragConfig) => {
  ragManager.setRagConfig(ragConfig);
  return { success: true };
});

// IPC Handlers for RAG Pins (separate from context pins)
ipcMain.handle('rag-pin-message', async (event, messageData) => {
  return await ragManager.addPinnedMessage(messageData);
});

ipcMain.handle('rag-unpin-message', async (event, messageId) => {
  return await ragManager.removePinnedMessage(messageId);
});

// IPC Handlers for RAG Snapshot Management
ipcMain.handle('rag-save-snapshot', async (event, { name, autoTimestamp }) => {
  console.log(`[IPC] rag-save-snapshot: name="${name}", autoTimestamp=${autoTimestamp}`);
  return await ragManager.saveSnapshot(name, { autoTimestamp });
});

ipcMain.handle('rag-load-snapshot', async (event, { name, skipBackup }) => {
  console.log(`[IPC] rag-load-snapshot: name="${name}", skipBackup=${skipBackup}`);
  const result = await ragManager.loadSnapshot(name, { skipBackup });

  // Broadcast to main window for settings synchronization
  if (result.success && mainWindow && !mainWindow.isDestroyed()) {
    console.log(`[IPC] Broadcasting snapshot-loaded event to main window`);
    mainWindow.webContents.send('snapshot-loaded', {
      name: result.name,
      config: result.config
    });
  }

  return result;
});

ipcMain.handle('rag-append-snapshot', async (event, name) => {
  console.log(`[IPC] rag-append-snapshot: name="${name}"`);

  // Progress callback that forwards progress events to renderer
  const progressCallback = (progressData) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rag-append-progress', progressData);
    }
  };

  const result = await ragManager.appendSnapshot(name, progressCallback);

  // Broadcast to main window if successful
  if (result.success && mainWindow && !mainWindow.isDestroyed()) {
    console.log(`[IPC] Broadcasting snapshot-appended event to main window`);
    mainWindow.webContents.send('snapshot-appended', {
      name,
      filesAdded: result.filesAdded,
      duplicatesSkipped: result.duplicatesSkipped
    });
  }

  return result;
});

ipcMain.handle('rag-list-snapshots', async () => {
  console.log(`[IPC] rag-list-snapshots`);
  return await ragManager.listSnapshots();
});

ipcMain.handle('rag-get-snapshot-info', async (event, { name }) => {
  console.log(`[IPC] rag-get-snapshot-info: name="${name}"`);
  return await ragManager.getSnapshotInfo(name);
});

ipcMain.handle('rag-check-snapshot-compatibility', async (event, { name }) => {
  console.log(`[IPC] rag-check-snapshot-compatibility: name="${name}"`);
  return await ragManager.checkSnapshotCompatibility(name);
});

ipcMain.handle('rag-delete-snapshot', async (event, { name }) => {
  console.log(`[IPC] rag-delete-snapshot: name="${name}"`);
  return await ragManager.deleteSnapshot(name);
});

ipcMain.handle('rag-get-active-snapshot', async () => {
  console.log(`[IPC] rag-get-active-snapshot`);
  return await ragManager.getActiveSnapshot();
});

ipcMain.handle('rag-validate-models', async (event, textModel, codeModel) => {
  console.log(`[IPC] rag-validate-models - Text: ${textModel}, Code: ${codeModel}`);
  return await ragManager.validateEmbeddingModelCompatibility(textModel, codeModel);
});

// IPC Handlers for Model Setup
ipcMain.handle('model-scan-modelfiles', async () => {
  const modelsDir = path.join(__dirname, '..', 'Models');

  try {
    const files = await fs.readdir(modelsDir);
    const modelfiles = [];

    for (const file of files) {
      // Filter: *.txt files WITHOUT 'template' in name
      if (file.endsWith('.txt') && !file.toLowerCase().includes('template')) {
        const filePath = path.join(modelsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');

        // Parse FROM line
        const fromMatch = content.match(/^FROM\s+(.+)$/m);
        if (fromMatch) {
          const baseName = fromMatch[1].trim();
          const name = file.replace('.txt', '').replace('_Modelfile', '');

          // Target name: base + _ollmini suffix
          // Example: gpt-oss:20b → gpt-oss:20b_ollmini
          const targetName = `${baseName}_ollmini`;

          modelfiles.push({
            name: name,
            fileName: file,
            baseName: baseName,
            targetName: targetName,
            filePath: filePath
          });
        }
      }
    }

    console.log(`[IPC] model-scan-modelfiles: Found ${modelfiles.length} modelfile(s)`);
    return modelfiles;
  } catch (error) {
    console.error('[IPC] model-scan-modelfiles error:', error);
    throw error;
  }
});

ipcMain.handle('model-check-exists', async (event, modelName) => {
  try {
    // Get modelfile info to extract target name
    const modelsDir = path.join(__dirname, '..', 'Models');
    const files = await fs.readdir(modelsDir);

    let targetName = null;

    for (const file of files) {
      if (file.endsWith('.txt') && !file.toLowerCase().includes('template')) {
        const name = file.replace('.txt', '').replace('_Modelfile', '');
        if (name === modelName) {
          const filePath = path.join(modelsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const fromMatch = content.match(/^FROM\s+(.+)$/m);
          if (fromMatch) {
            const baseName = fromMatch[1].trim();
            targetName = `${baseName}_ollmini`;
          }
          break;
        }
      }
    }

    if (!targetName) {
      console.log(`[IPC] model-check-exists: Modelfile ${modelName} not found`);
      return false;
    }

    // Check via ollama list
    const { stdout } = await execPromise('ollama list');
    const exists = stdout.includes(targetName);
    console.log(`[IPC] model-check-exists: ${targetName} exists = ${exists}`);
    return exists;
  } catch (error) {
    console.error('[IPC] model-check-exists error:', error);
    return false;
  }
});

ipcMain.handle('model-apply-modelfile', async (event, modelName) => {
  try {
    // Get modelfile info
    const modelsDir = path.join(__dirname, '..', 'Models');
    const files = await fs.readdir(modelsDir);

    let modelfileInfo = null;

    for (const file of files) {
      if (file.endsWith('.txt') && !file.toLowerCase().includes('template')) {
        const name = file.replace('.txt', '').replace('_Modelfile', '');
        if (name === modelName) {
          const filePath = path.join(modelsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const fromMatch = content.match(/^FROM\s+(.+)$/m);
          if (fromMatch) {
            const baseName = fromMatch[1].trim();
            const targetName = `${baseName}_ollmini`;

            modelfileInfo = {
              name,
              filePath,
              baseName,
              targetName,
              content
            };
          }
          break;
        }
      }
    }

    if (!modelfileInfo) {
      throw new Error(`Modelfile ${modelName} not found in Models/ directory`);
    }

    console.log(`[IPC] model-apply-modelfile: Creating ${modelfileInfo.targetName} from ${modelfileInfo.baseName}`);

    // Execute ollama create with stdin
    const command = `echo "${modelfileInfo.content.replace(/"/g, '\\"')}" | ollama create ${modelfileInfo.targetName}`;
    const { stdout, stderr } = await execPromise(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      shell: '/bin/bash'
    });

    if (stderr && !stderr.includes('success')) {
      console.warn(`[IPC] model-apply-modelfile stderr: ${stderr}`);
    }

    console.log(`[IPC] model-apply-modelfile: Success - ${modelfileInfo.targetName}`);
    console.log(`[IPC] model-apply-modelfile stdout: ${stdout}`);

    return {
      success: true,
      targetName: modelfileInfo.targetName,
      output: stdout
    };

  } catch (error) {
    console.error(`[IPC] model-apply-modelfile error:`, error);
    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
});

// IPC Handlers for Dashboard
ipcMain.on('open-dashboard', () => {
  toggleDashboard();
});

ipcMain.on('dashboard-ready', () => {
  // Request initial state from main window when dashboard opens
  if (mainWindow && !mainWindow.isDestroyed() && dashboardWindow && !dashboardWindow.isDestroyed()) {
    mainWindow.webContents.send('request-dashboard-state');
  }
});

// Broadcast events from main window to dashboard
ipcMain.on('broadcast-token-update', (event, data) => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('token-update', data);
  }
});

ipcMain.on('broadcast-rag-update', (event, data) => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('rag-update', data);
  }
});

ipcMain.on('broadcast-query-update', (event, query) => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('query-update', query);
  }
});

ipcMain.on('broadcast-files-update', (event, files) => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('files-update', files);
  }
});

// File actions from dashboard
ipcMain.on('reindex-file', async (event, filePath) => {
  try {
    await ragManager.addDocuments([filePath]);
    // Broadcast updated files list
    const stats = await ragManager.getStats();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rag-files-changed');
    }
  } catch (error) {
    console.error('Failed to reindex file:', error);
  }
});

ipcMain.on('remove-file', async (event, filePath) => {
  try {
    // File removal functionality - currently not implemented
    console.log('Remove file requested:', filePath);
  } catch (error) {
    console.error('Failed to remove file:', error);
  }
});
