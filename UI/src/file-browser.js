// File Browser Module
// Handles working directory file explorer with tree and grid views

const { ipcRenderer } = require('electron');
const path = require('path');
const settingsManager = require('./settings-manager');
const messageRenderer = require('./message-renderer');

// SVG Icons
const folderIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
const folderOpenIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>`;
const fileIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>`;
const arrowIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>`;

// State
let currentPath = '';
let selectedFolderInTree = null;
let selectedFolderPath = null;
let selectedFolderElement = null;
let isLoadingDirectory = false;

// File Selection State (for multi-select and RAG indexing)
let selectedFiles = new Set(); // Set of file paths
let lastClickedRow = null;     // For Shift+Click range selection
let allRows = [];              // Cache of all visible rows

// DOM References
let cwdDisplay, browseDirectoryBtn, copyCwdBtn, setWorkingDirBtn, setCurrentDirBtn;
let setWorkingDirText, setCurrentDirText, refreshExplorerBtn;
let folderContent, breadcrumb;

function setDOMReferences(refs) {
    cwdDisplay = refs.cwdDisplay;
    browseDirectoryBtn = refs.browseDirectoryBtn;
    copyCwdBtn = refs.copyCwdBtn;
    setWorkingDirBtn = refs.setWorkingDirBtn;
    setCurrentDirBtn = refs.setCurrentDirBtn;
    setWorkingDirText = refs.setWorkingDirText;
    setCurrentDirText = refs.setCurrentDirText;
    refreshExplorerBtn = refs.refreshExplorerBtn;
    folderContent = refs.folderContent;
    breadcrumb = refs.breadcrumb;
}

function getFileIconSVG(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['js', 'jsx', 'ts', 'tsx', 'json'].includes(ext)) {
        return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>`;
    }
    if (['html', 'htm', 'css', 'scss', 'sass'].includes(ext)) {
        return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 5-5v10zm2 0V7l5 5-5 5z"/></svg>`;
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp'].includes(ext)) {
        return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`;
    }
    if (['md', 'txt', 'pdf', 'doc', 'docx'].includes(ext)) {
        return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>`;
    }
    return fileIcon;
}

function updateDirectoryButtons() {
    if (selectedFolderPath) {
        setWorkingDirBtn.disabled = false;
        setCurrentDirBtn.disabled = false;
        const maxLength = 50;
        const displayPath = selectedFolderPath.length > maxLength ? '...' + selectedFolderPath.slice(-maxLength) : selectedFolderPath;
        setWorkingDirText.textContent = `Set as Working Directory: ${displayPath}`;
        setCurrentDirText.textContent = `Set Current Directory: ${displayPath}`;
    } else {
        setWorkingDirBtn.disabled = true;
        setCurrentDirBtn.disabled = true;
        setWorkingDirText.textContent = 'Set as Working Directory (no folder selected)';
        setCurrentDirText.textContent = 'Set Current Directory (no folder selected)';
    }
}

// File Selection Management
function clearFileSelection() {
    selectedFiles.clear();
    allRows.forEach(row => {
        if (!row.dataset.isDirectory) {
            row.classList.remove('file-selected');
        }
    });
}

function selectFile(row, filePath) {
    if (!row.dataset.isDirectory) {
        selectedFiles.add(filePath);
        row.classList.add('file-selected');
    }
}

function deselectFile(row, filePath) {
    selectedFiles.delete(filePath);
    row.classList.remove('file-selected');
}

function getSelectedFiles() {
    return Array.from(selectedFiles);
}

function selectFileRange(startRow, endRow) {
    const startIndex = allRows.indexOf(startRow);
    const endIndex = allRows.indexOf(endRow);

    const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];

    for (let i = from; i <= to; i++) {
        const row = allRows[i];
        if (row && !row.dataset.isDirectory) {
            selectFile(row, row.title);
        }
    }
}

function selectFolder(path, element) {
    if (selectedFolderElement) {
        selectedFolderElement.classList.remove('folder-selected');
    }
    selectedFolderPath = path;
    selectedFolderElement = element;
    if (element) {
        element.classList.add('folder-selected');
    }
    updateDirectoryButtons();
}

async function loadWorkingDirectory() {
    try {
        const cwd = await ipcRenderer.invoke('get-cwd');
        cwdDisplay.value = cwd;
        currentPath = cwd;
        await loadFolderContent(cwd);
        updateBreadcrumb(cwd);
    } catch (error) {
        console.error('Failed to load working directory:', error);
    }
}

// Folder Tree removed - using single list view with breadcrumb navigation instead

async function loadFolderContent(dirPath) {
    const tbody = document.getElementById('file-list-body');
    tbody.innerHTML = '<tr class="loading-row"><td colspan="4" class="file-explorer-loading"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" class="spin"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg></td></tr>';

    // Clear file selection when changing directories
    clearFileSelection();
    allRows = [];

    try {
        const entries = await ipcRenderer.invoke('list-directory', dirPath);
        entries.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        tbody.innerHTML = '';
        if (entries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="file-explorer-loading"><p style="opacity: 0.5;">Empty folder</p></td></tr>';
            return;
        }

        entries.forEach(entry => {
            const row = createListRow(entry);
            tbody.appendChild(row);
            allRows.push(row);
        });
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="4" class="file-explorer-loading"><p style="color: #e06c75;">Error: ${error.message}</p></td></tr>`;
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (dateOnly.getTime() === today.getTime()) {
        return 'Heute ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } else if (dateOnly.getTime() === yesterday.getTime()) {
        return 'Gestern ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } else {
        return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
               ' ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
}

function createListRow(entry) {
    const row = document.createElement('tr');
    row.title = entry.path;
    row.dataset.isDirectory = entry.isDirectory ? 'true' : 'false';

    // Name column with icon
    const nameCell = document.createElement('td');
    const nameContainer = document.createElement('div');
    nameContainer.className = 'file-name-cell';

    const iconDiv = document.createElement('div');
    iconDiv.className = `file-name-icon ${entry.isDirectory ? 'folder' : 'file'}`;
    iconDiv.innerHTML = entry.isDirectory ? folderIcon : getFileIconSVG(entry.name);

    const nameText = document.createElement('div');
    nameText.className = 'file-name-text';
    nameText.textContent = entry.name;

    nameContainer.appendChild(iconDiv);
    nameContainer.appendChild(nameText);
    nameCell.appendChild(nameContainer);

    // Type column
    const typeCell = document.createElement('td');
    typeCell.className = 'col-type';
    if (entry.isDirectory) {
        typeCell.textContent = 'Ordner';
    } else {
        const ext = entry.name.split('.').pop().toUpperCase();
        typeCell.textContent = ext === entry.name.toUpperCase() ? 'Datei' : ext;
    }

    // Size column
    const sizeCell = document.createElement('td');
    sizeCell.className = 'col-size';
    sizeCell.textContent = entry.isDirectory ? '-' : formatFileSize(entry.size);

    // Modified column
    const modifiedCell = document.createElement('td');
    modifiedCell.className = 'col-modified';
    modifiedCell.textContent = formatDate(entry.modified);

    row.appendChild(nameCell);
    row.appendChild(typeCell);
    row.appendChild(sizeCell);
    row.appendChild(modifiedCell);

    // Event handlers
    if (entry.isDirectory) {
        row.addEventListener('click', () => {
            selectFolder(entry.path, row);
        });
        row.addEventListener('dblclick', async () => {
            currentPath = entry.path;
            await loadFolderContent(entry.path);
            updateBreadcrumb(entry.path);
        });

        // Right-click menu for folders
        row.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Remove any existing menu
            const existingMenu = document.querySelector('.file-context-menu');
            if (existingMenu) existingMenu.remove();

            const menu = document.createElement('div');
            menu.className = 'file-context-menu';
            menu.style.position = 'fixed';
            menu.style.left = e.clientX + 'px';
            menu.style.top = e.clientY + 'px';

            const openOption = document.createElement('div');
            openOption.className = 'context-menu-item';
            openOption.textContent = 'Open Folder';
            openOption.addEventListener('click', async () => {
                currentPath = entry.path;
                await loadFolderContent(entry.path);
                updateBreadcrumb(entry.path);
                menu.remove();
            });

            const copyOption = document.createElement('div');
            copyOption.className = 'context-menu-item';
            copyOption.textContent = 'Copy Path';
            copyOption.addEventListener('click', async () => {
                await navigator.clipboard.writeText(entry.path);
                menu.remove();
            });

            menu.appendChild(openOption);
            menu.appendChild(copyOption);
            document.body.appendChild(menu);

            // Close menu when clicking elsewhere
            const closeMenu = (event) => {
                if (!menu.contains(event.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 0);
        });
    } else {
        // Multi-select click handler for files
        row.addEventListener('click', async (e) => {
            e.stopPropagation();

            // Multi-selection with Ctrl/Cmd + Click
            if (e.ctrlKey || e.metaKey) {
                console.log('📌 Ctrl+Click detected on file:', entry.name);
                if (selectedFiles.has(entry.path)) {
                    console.log('📌 Deselecting file:', entry.name);
                    deselectFile(row, entry.path);
                } else {
                    console.log('📌 Selecting file:', entry.name);
                    selectFile(row, entry.path);
                }
                console.log('📌 Selected files count:', selectedFiles.size);
                console.log('📌 Visual class applied:', row.classList.contains('file-selected'));
                lastClickedRow = row;
                return;
            }

            // Range selection with Shift + Click
            if (e.shiftKey && lastClickedRow) {
                clearFileSelection();
                selectFileRange(lastClickedRow, row);
                return;
            }

            // Normal click: deselect all, copy path to clipboard
            clearFileSelection();
            try {
                await navigator.clipboard.writeText(entry.path);
                // Visual feedback - flash icon
                const originalColor = iconDiv.style.color;
                iconDiv.style.color = '#98c379';
                setTimeout(() => {
                    iconDiv.style.color = originalColor;
                }, 500);
            } catch (error) {
                console.error('Failed to copy path:', error);
            }
            lastClickedRow = row;
        });

        // Right-click menu for files
        row.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Remove any existing menu
            const existingMenu = document.querySelector('.file-context-menu');
            if (existingMenu) existingMenu.remove();

            const menu = document.createElement('div');
            menu.className = 'file-context-menu';
            menu.style.position = 'fixed';
            menu.style.left = e.clientX + 'px';
            menu.style.top = e.clientY + 'px';

            const openOption = document.createElement('div');
            openOption.className = 'context-menu-item';
            openOption.textContent = 'Open in Editor';
            openOption.addEventListener('click', async () => {
                const result = await ipcRenderer.invoke('open-file-in-editor', entry.path);
                if (!result.success) {
                    console.error('Failed to open file:', result.error);
                }
                menu.remove();
            });

            const copyOption = document.createElement('div');
            copyOption.className = 'context-menu-item';
            copyOption.textContent = 'Copy Path';
            copyOption.addEventListener('click', async () => {
                await navigator.clipboard.writeText(entry.path);
                menu.remove();
            });

            // Index in RAG option
            const indexRagOption = document.createElement('div');
            indexRagOption.className = 'context-menu-item';
            const dbIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12,3C7.58,3 4,4.79 4,7C4,9.21 7.58,11 12,11C16.42,11 20,9.21 20,7C20,4.79 16.42,3 12,3M4,9V12C4,14.21 7.58,16 12,16C16.42,16 20,14.21 20,12V9C20,11.21 16.42,13 12,13C7.58,13 4,11.21 4,9M4,14V17C4,19.21 7.58,21 12,21C16.42,21 20,19.21 20,17V14C20,16.21 16.42,18 12,18C7.58,18 4,16.21 4,14Z"/></svg>`;
            indexRagOption.innerHTML = `${dbIcon} <span>Index in RAG</span>`;

            // Check if RAG is enabled
            const settings = settingsManager.getSettings();
            if (!settings.ragEnabled) {
                indexRagOption.classList.add('disabled');
                indexRagOption.title = 'RAG ist nicht aktiviert';
            } else {
                indexRagOption.addEventListener('click', async () => {
                    const currentSettings = settingsManager.getSettings();
                    if (!currentSettings.ragEnabled) return;

                    // Close menu immediately
                    menu.remove();

                    // Show indexing toast
                    messageRenderer.showToast(`📥 Indexing ${entry.name}...`, 'info');

                    // Index file (non-blocking)
                    ipcRenderer.invoke('rag-index-files', [entry.path])
                        .then((result) => {
                            if (result.success) {
                                messageRenderer.showToast(`✅ ${entry.name} indexed successfully`, 'success');
                                console.log('✅ File indexed in RAG:', entry.path);
                            } else {
                                messageRenderer.showToast(`❌ Failed to index: ${result.error || 'Unknown error'}`, 'error');
                                console.error('❌ RAG indexing failed:', result.error);
                            }
                        })
                        .catch((error) => {
                            messageRenderer.showToast(`❌ Indexing error: ${error.message}`, 'error');
                            console.error('❌ RAG indexing error:', error);
                        });
                });
            }

            menu.appendChild(openOption);
            menu.appendChild(copyOption);
            menu.appendChild(indexRagOption);
            document.body.appendChild(menu);

            // Close menu when clicking elsewhere
            const closeMenu = (event) => {
                if (!menu.contains(event.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 0);
        });
    }

    return row;
}

function updateBreadcrumb(dirPath) {
    const pathParts = dirPath.split(path.sep).filter(p => p);
    breadcrumb.innerHTML = '';

    pathParts.forEach((part, index) => {
        const item = document.createElement('div');
        item.className = 'breadcrumb-item';
        item.textContent = part;

        const partialPath = path.sep + pathParts.slice(0, index + 1).join(path.sep);
        item.addEventListener('click', async () => {
            currentPath = partialPath;
            await loadFolderContent(partialPath);
            updateBreadcrumb(partialPath);
        });

        breadcrumb.appendChild(item);

        if (index < pathParts.length - 1) {
            const separator = document.createElement('span');
            separator.className = 'breadcrumb-separator';
            separator.textContent = '/';
            breadcrumb.appendChild(separator);
        }
    });
}

function setupFileBrowserListeners() {
    browseDirectoryBtn.addEventListener('click', async () => {
        if (isLoadingDirectory) {
            console.log('⏳ Already loading directory, please wait...');
            return;
        }
        isLoadingDirectory = true;
        browseDirectoryBtn.disabled = true;

        try {
            const selectedPath = await ipcRenderer.invoke('open-directory-dialog');
            if (selectedPath) {
                await ipcRenderer.invoke('set-cwd', selectedPath);
                cwdDisplay.value = selectedPath;
                currentPath = selectedPath;
                await loadFolderContent(selectedPath);
                updateBreadcrumb(selectedPath);
                console.log('✅ Working directory set to:', selectedPath);
            }
        } catch (error) {
            alert(`Failed to set working directory: ${error.message}`);
        } finally {
            isLoadingDirectory = false;
            browseDirectoryBtn.disabled = false;
        }
    });

    copyCwdBtn.addEventListener('click', async () => {
        const cwd = await ipcRenderer.invoke('get-cwd');
        navigator.clipboard.writeText(cwd);
        console.log('📋 Copied to clipboard:', cwd);
    });

    setWorkingDirBtn.addEventListener('click', async () => {
        if (selectedFolderPath) {
            await ipcRenderer.invoke('set-cwd', selectedFolderPath);
            cwdDisplay.value = selectedFolderPath;
            console.log('✅ Working directory set to:', selectedFolderPath);
        }
    });

    setCurrentDirBtn.addEventListener('click', async () => {
        if (selectedFolderPath) {
            currentPath = selectedFolderPath;
            await loadFolderContent(selectedFolderPath);
            updateBreadcrumb(selectedFolderPath);
            console.log('✅ Current directory set to:', selectedFolderPath);
        }
    });

    refreshExplorerBtn.addEventListener('click', async () => {
        const cwd = await ipcRenderer.invoke('get-cwd');
        currentPath = cwd;
        await loadFolderContent(cwd);
        updateBreadcrumb(cwd);
    });
}

module.exports = {
    setDOMReferences,
    loadWorkingDirectory,
    loadFolderContent,
    updateBreadcrumb,
    setupFileBrowserListeners,
    getCurrentPath: () => currentPath,
    getSelectedFiles
};
