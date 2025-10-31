const { ipcRenderer } = require('electron');
const Chart = require('chart.js/auto');

// ============================================
// State Management
// ============================================

let tokenChartInstance = null;
let queryChartInstance = null;
let scoreChartInstance = null;

const state = {
    // Token tracking
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    contextLimit: 0,
    contextUsage: 0,
    contextPercentage: 0,

    // RAG stats
    indexedChunks: 0,
    totalQueries: 0,
    avgQueryTime: 0,
    avgRelevance: 0,

    // History
    queryHistory: [],
    tokenHistory: [],
    scoreDistribution: {},
};

// ============================================
// Zoom Management
// ============================================

const ZOOM_LEVELS = [50, 75, 90, 100, 125, 150, 175, 200];
const DEFAULT_ZOOM = 100;
let currentZoomLevel = DEFAULT_ZOOM;

function loadZoomLevel() {
    try {
        const saved = localStorage.getItem('dashboard-zoom-level');
        if (saved) {
            const parsed = parseInt(saved);
            if (ZOOM_LEVELS.includes(parsed)) {
                currentZoomLevel = parsed;
            }
        }
    } catch (e) {
        console.error('Failed to load zoom level:', e);
    }
}

function saveZoomLevel() {
    try {
        localStorage.setItem('dashboard-zoom-level', currentZoomLevel);
    } catch (e) {
        console.error('Failed to save zoom level:', e);
    }
}

function applyZoom(level) {
    const dashboardMain = document.querySelector('.dashboard-main');
    const zoomLevelDisplay = document.getElementById('zoomLevel');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const zoomInBtn = document.getElementById('zoomInBtn');

    if (!dashboardMain) return;

    currentZoomLevel = level;
    const scale = level / 100;

    // Apply CSS zoom (native Chromium/Electron support)
    dashboardMain.style.zoom = scale;

    // Update zoom level display
    if (zoomLevelDisplay) {
        zoomLevelDisplay.textContent = `${level}%`;
    }

    // Update button states
    const currentIndex = ZOOM_LEVELS.indexOf(level);
    if (zoomOutBtn) {
        zoomOutBtn.disabled = currentIndex === 0;
    }
    if (zoomInBtn) {
        zoomInBtn.disabled = currentIndex === ZOOM_LEVELS.length - 1;
    }

    // Save to localStorage
    saveZoomLevel();

    // Resize charts after zoom change
    setTimeout(() => resizeAllCharts(), 250);
}

function zoomIn() {
    const currentIndex = ZOOM_LEVELS.indexOf(currentZoomLevel);
    if (currentIndex < ZOOM_LEVELS.length - 1) {
        applyZoom(ZOOM_LEVELS[currentIndex + 1]);
    }
}

function zoomOut() {
    const currentIndex = ZOOM_LEVELS.indexOf(currentZoomLevel);
    if (currentIndex > 0) {
        applyZoom(ZOOM_LEVELS[currentIndex - 1]);
    }
}

function resetZoom() {
    applyZoom(DEFAULT_ZOOM);
}

function resizeAllCharts() {
    if (tokenChartInstance) tokenChartInstance.resize();
    if (queryChartInstance) queryChartInstance.resize();
    if (scoreChartInstance) scoreChartInstance.resize();
}

// ============================================
// Chart Configuration
// ============================================

Chart.defaults.color = '#b0b0b0';
Chart.defaults.borderColor = '#4a4a4a';
Chart.defaults.font.family = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            display: true,
            position: 'top',
        },
    },
    scales: {
        y: {
            beginAtZero: true,
            grid: {
                color: '#4a4a4a',
            },
        },
        x: {
            grid: {
                color: '#4a4a4a',
            },
        },
    },
};

// ============================================
// Chart Initialization
// ============================================

function initializeCharts() {
    // Token Timeline Chart
    const tokenCtx = document.getElementById('tokenChart').getContext('2d');
    tokenChartInstance = new Chart(tokenCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Input Tokens',
                    data: [],
                    borderColor: '#61afef',
                    backgroundColor: 'rgba(97, 175, 239, 0.1)',
                    tension: 0.3,
                },
                {
                    label: 'Output Tokens',
                    data: [],
                    borderColor: '#98c379',
                    backgroundColor: 'rgba(152, 195, 121, 0.1)',
                    tension: 0.3,
                },
            ],
        },
        options: {
            ...chartOptions,
            scales: {
                ...chartOptions.scales,
                x: {
                    ...chartOptions.scales.x,
                    title: {
                        display: true,
                        text: 'Message Number',
                    },
                },
                y: {
                    ...chartOptions.scales.y,
                    title: {
                        display: true,
                        text: 'Tokens',
                    },
                },
            },
        },
    });

    // Query Performance Chart
    const queryCtx = document.getElementById('queryChart').getContext('2d');
    queryChartInstance = new Chart(queryCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Query Time (ms)',
                    data: [],
                    backgroundColor: '#e5c07b',
                    borderColor: '#e5c07b',
                    borderWidth: 1,
                },
            ],
        },
        options: {
            ...chartOptions,
            scales: {
                ...chartOptions.scales,
                x: {
                    ...chartOptions.scales.x,
                    title: {
                        display: true,
                        text: 'Query #',
                    },
                },
                y: {
                    ...chartOptions.scales.y,
                    title: {
                        display: true,
                        text: 'Time (ms)',
                    },
                },
            },
        },
    });

    // Score Distribution Chart
    const scoreCtx = document.getElementById('scoreChart').getContext('2d');
    scoreChartInstance = new Chart(scoreCtx, {
        type: 'doughnut',
        data: {
            labels: ['0.8-1.0', '0.6-0.8', '0.4-0.6', '0.2-0.4', '0.0-0.2'],
            datasets: [
                {
                    label: 'Relevance Score Distribution',
                    data: [0, 0, 0, 0, 0],
                    backgroundColor: [
                        '#98c379',
                        '#61afef',
                        '#e5c07b',
                        '#d19a66',
                        '#e06c75',
                    ],
                    borderColor: '#2d2d2d',
                    borderWidth: 2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'right',
                },
            },
        },
    });
}

// ============================================
// UI Update Functions
// ============================================

function updateContextMonitor(data) {
    state.totalInputTokens = data.inputTokens || 0;
    state.totalOutputTokens = data.outputTokens || 0;
    state.totalTokens = data.totalTokens || 0;
    state.contextLimit = data.contextLimit || 0;
    state.contextUsage = data.contextUsage || 0;
    state.contextPercentage = data.contextPercentage || 0;

    document.getElementById('inputTokens').textContent = state.totalInputTokens.toLocaleString('de-DE');
    document.getElementById('outputTokens').textContent = state.totalOutputTokens.toLocaleString('de-DE');
    document.getElementById('totalTokens').textContent = state.totalTokens.toLocaleString('de-DE');
    document.getElementById('contextLimit').textContent = state.contextLimit.toLocaleString('de-DE');

    const contextFill = document.getElementById('contextFill');
    const contextPercentageEl = document.getElementById('contextPercentage');
    const contextUsageEl = document.getElementById('contextUsage');

    contextPercentageEl.textContent = `${state.contextPercentage}%`;
    contextUsageEl.textContent = `${state.contextUsage.toLocaleString('de-DE')} / ${state.contextLimit.toLocaleString('de-DE')}`;

    contextFill.style.width = `${Math.min(state.contextPercentage, 100)}%`;

    // Color coding based on percentage
    contextFill.classList.remove('warning', 'danger');
    if (state.contextPercentage >= 90) {
        contextFill.classList.add('danger');
    } else if (state.contextPercentage >= 70) {
        contextFill.classList.add('warning');
    }

    // Update token chart
    updateTokenChart();
}

function updateTokenChart() {
    if (!tokenChartInstance) return;

    const messageCount = state.tokenHistory.length + 1;

    if (tokenChartInstance.data.labels.length >= 20) {
        tokenChartInstance.data.labels.shift();
        tokenChartInstance.data.datasets[0].data.shift();
        tokenChartInstance.data.datasets[1].data.shift();
    }

    tokenChartInstance.data.labels.push(`#${messageCount}`);
    tokenChartInstance.data.datasets[0].data.push(state.totalInputTokens);
    tokenChartInstance.data.datasets[1].data.push(state.totalOutputTokens);
    tokenChartInstance.update('none');

    state.tokenHistory.push({
        input: state.totalInputTokens,
        output: state.totalOutputTokens,
        timestamp: Date.now(),
    });
}

function updateRAGAnalytics(data) {
    state.indexedChunks = data.indexedChunks || 0;
    state.totalQueries = data.totalQueries || 0;
    state.avgQueryTime = data.avgQueryTime || 0;
    state.avgRelevance = data.avgRelevance || 0;

    console.log('📊 Dashboard received RAG Analytics:', data);

    document.getElementById('indexedChunks').textContent = state.indexedChunks.toLocaleString('de-DE');
    document.getElementById('totalQueries').textContent = state.totalQueries.toLocaleString('de-DE');

    // Show "N/A" for averages when no queries exist yet
    if (state.totalQueries === 0) {
        document.getElementById('avgQueryTime').textContent = 'N/A';
        document.getElementById('avgRelevance').textContent = 'N/A';
        document.getElementById('avgRelevance').title = 'No queries recorded yet';
        document.getElementById('avgQueryTime').title = 'No queries recorded yet';
    } else {
        document.getElementById('avgQueryTime').textContent = `${state.avgQueryTime.toFixed(2)}ms`;
        document.getElementById('avgQueryTime').title = `Average query time across ${state.totalQueries} queries`;
        document.getElementById('avgRelevance').textContent = state.avgRelevance.toFixed(2);
        document.getElementById('avgRelevance').title = `Average relevance score across ${state.totalQueries} queries`;
    }
}

function updateQueryHistory(query) {
    state.queryHistory.unshift(query);
    if (state.queryHistory.length > 20) {
        state.queryHistory.pop();
    }

    const tableBody = document.getElementById('queryTableBody');
    tableBody.innerHTML = '';

    if (state.queryHistory.length === 0) {
        tableBody.innerHTML = '<tr class="empty-row"><td colspan="5">No queries yet</td></tr>';
        return;
    }

    state.queryHistory.forEach((q) => {
        const row = document.createElement('tr');
        const time = new Date(q.timestamp).toLocaleTimeString('de-DE');
        row.innerHTML = `
            <td>${time}</td>
            <td title="${q.query}">${truncateText(q.query, 40)}</td>
            <td>${q.resultsCount}</td>
            <td>${q.avgScore.toFixed(3)}</td>
            <td>${q.duration.toFixed(2)}ms</td>
        `;
        tableBody.appendChild(row);
    });

    // Update query performance chart
    updateQueryChart(query);

    // Update score distribution
    updateScoreDistribution(query.scores || []);
}

function updateQueryChart(query) {
    if (!queryChartInstance) return;

    const queryNumber = state.totalQueries;

    if (queryChartInstance.data.labels.length >= 20) {
        queryChartInstance.data.labels.shift();
        queryChartInstance.data.datasets[0].data.shift();
    }

    queryChartInstance.data.labels.push(`Q${queryNumber}`);
    queryChartInstance.data.datasets[0].data.push(query.duration);
    queryChartInstance.update('none');
}

function updateScoreDistribution(scores) {
    if (!scoreChartInstance || scores.length === 0) return;

    const distribution = [0, 0, 0, 0, 0];
    scores.forEach((score) => {
        if (score >= 0.8) distribution[0]++;
        else if (score >= 0.6) distribution[1]++;
        else if (score >= 0.4) distribution[2]++;
        else if (score >= 0.2) distribution[3]++;
        else distribution[4]++;
    });

    scoreChartInstance.data.datasets[0].data = distribution;
    scoreChartInstance.update('none');
}

function updateIndexedFiles(files) {
    const container = document.getElementById('filesContainer');
    container.innerHTML = '';

    if (!files || files.length === 0) {
        container.innerHTML = '<div class="empty-state">No files indexed yet</div>';
        return;
    }

    files.forEach((file) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-meta">${file.chunks} chunks | ${file.size}</div>
            </div>
            <div class="file-actions">
                <button class="file-btn" onclick="reindexFile('${file.path}')">Re-index</button>
                <button class="file-btn" onclick="removeFile('${file.path}')">Remove</button>
            </div>
        `;
        container.appendChild(fileItem);
    });
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// ============================================
// Export Functions
// ============================================

function exportToCSV() {
    const csvData = [];
    csvData.push(['Time', 'Query', 'Results', 'Avg Score', 'Duration (ms)']);

    state.queryHistory.forEach((q) => {
        csvData.push([
            new Date(q.timestamp).toISOString(),
            q.query,
            q.resultsCount,
            q.avgScore.toFixed(3),
            q.duration.toFixed(2),
        ]);
    });

    const csvContent = csvData.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportToJSON() {
    const jsonData = {
        timestamp: new Date().toISOString(),
        context: {
            totalInputTokens: state.totalInputTokens,
            totalOutputTokens: state.totalOutputTokens,
            totalTokens: state.totalTokens,
            contextLimit: state.contextLimit,
            contextUsage: state.contextUsage,
            contextPercentage: state.contextPercentage,
        },
        rag: {
            indexedChunks: state.indexedChunks,
            totalQueries: state.totalQueries,
            avgQueryTime: state.avgQueryTime,
            avgRelevance: state.avgRelevance,
        },
        queryHistory: state.queryHistory,
        tokenHistory: state.tokenHistory,
    };

    const jsonContent = JSON.stringify(jsonData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================
// File Actions (IPC)
// ============================================

function reindexFile(filePath) {
    ipcRenderer.send('reindex-file', filePath);
}

function removeFile(filePath) {
    ipcRenderer.send('remove-file', filePath);
}

// ============================================
// IPC Event Handlers
// ============================================

ipcRenderer.on('token-update', (event, data) => {
    updateContextMonitor(data);
});

ipcRenderer.on('rag-update', (event, data) => {
    updateRAGAnalytics(data);
});

ipcRenderer.on('query-update', (event, query) => {
    updateQueryHistory(query);
});

ipcRenderer.on('files-update', (event, files) => {
    updateIndexedFiles(files);
});

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Initialize zoom from localStorage
    loadZoomLevel();
    applyZoom(currentZoomLevel);

    // Initialize charts
    initializeCharts();

    // Export buttons
    document.getElementById('exportCsv').addEventListener('click', exportToCSV);
    document.getElementById('exportJson').addEventListener('click', exportToJSON);

    // Zoom buttons
    document.getElementById('zoomInBtn').addEventListener('click', zoomIn);
    document.getElementById('zoomOutBtn').addEventListener('click', zoomOut);
    document.getElementById('zoomResetBtn').addEventListener('click', resetZoom);

    // Keyboard shortcuts for zoom
    document.addEventListener('keydown', (e) => {
        // Ctrl+Plus or Ctrl+= for zoom in
        if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
            e.preventDefault();
            zoomIn();
        }
        // Ctrl+Minus for zoom out
        else if (e.ctrlKey && e.key === '-') {
            e.preventDefault();
            zoomOut();
        }
        // Ctrl+0 for reset zoom
        else if (e.ctrlKey && e.key === '0') {
            e.preventDefault();
            resetZoom();
        }
    });

    // Request initial data
    ipcRenderer.send('dashboard-ready');
});
