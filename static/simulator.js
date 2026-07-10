(function() {
// Global Error Diagnostics
window.onerror = function(message, source, lineno, colno, error) {
    const errorDiv = document.createElement("div");
    errorDiv.style.position = "fixed";
    errorDiv.style.top = "0";
    errorDiv.style.left = "0";
    errorDiv.style.width = "100%";
    errorDiv.style.backgroundColor = "#da3633";
    errorDiv.style.color = "white";
    errorDiv.style.padding = "20px";
    errorDiv.style.zIndex = "99999";
    errorDiv.style.fontFamily = "monospace";
    errorDiv.style.whiteSpace = "pre-wrap";
    errorDiv.innerText = `Error: ${message}\nSource: ${source}\nLine: ${lineno}:${colno}\nStack: ${error ? error.stack : 'N/A'}`;
    document.body.appendChild(errorDiv);
    return false;
};

window.addEventListener("unhandledrejection", function(event) {
    const errorDiv = document.createElement("div");
    errorDiv.style.position = "fixed";
    errorDiv.style.top = "0";
    errorDiv.style.left = "0";
    errorDiv.style.width = "100%";
    errorDiv.style.backgroundColor = "#da3633";
    errorDiv.style.color = "white";
    errorDiv.style.padding = "20px";
    errorDiv.style.zIndex = "99999";
    errorDiv.style.fontFamily = "monospace";
    errorDiv.style.whiteSpace = "pre-wrap";
    errorDiv.innerText = `Unhandled Rejection: ${event.reason}`;
    document.body.appendChild(errorDiv);
});

// Application State
let state = {
    folderPath: "",
    files: [],            // List of scanned files {name, relative_path, full_path, size, is_local}
    loadedFiles: {},      // Map of full_path -> parsed file data
    activeFileKey: null,  // Key (full_path) of the currently active file for simulation
    
    // Duplicated properties of the active file (for compatibility with simulation/stats logic)
    gcodeText: "",
    gcodeLines: [],
    segments: [],
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0, width: 0, height: 0 },
    totalDuration: 0,
    totalCutLength: 0,
    totalRapidLength: 0,
    toolDiameter: 0.2,
    
    // Simulation state
    isPlaying: false,
    currentTime: 0,       // Current simulation time in seconds
    playbackSpeed: 10,    // Speed multiplier (e.g. 10x)
    toolX: 0,
    toolY: 0,
    toolZ: 0,
    activeFeed: 0,
    activeSpindle: 0,
    activeLineIndex: -1,
    
    // Canvas View Parameters
    zoom: 1.0,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    dragButton: 0,
    startX: 0,
    startY: 0,
    animationFrameId: null,
    
    // 3D Parameters (radians)
    yaw: -Math.PI / 6,      // Rotation around Z axis (horizontal yaw)
    pitch: -Math.PI / 6,    // Rotation around X axis (vertical pitch)
    startYaw: 0,
    startPitch: 0,
    startOffsetX: 0,
    startOffsetY: 0
};

// UI Selectors
const canvas = document.getElementById("sim-preview-canvas");
const ctx = canvas.getContext("2d");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const fileListContainer = document.getElementById("file-list-container");
const folderPathInput = document.getElementById("sim-folder-path");
const btnScan = document.getElementById("sim-btn-scan");
const btnSelectFolder = document.getElementById("sim-btn-select-folder");
const btnPlay = document.getElementById("btn-play");
const btnReset = document.getElementById("btn-reset");
const speedSelect = document.getElementById("speed-select");
const progressSlider = document.getElementById("progress-slider");
const progressTimeLabel = document.getElementById("progress-time-label");
const gcodeLinesBox = document.getElementById("gcode-lines-box");
const gcodeLineCountSpan = document.getElementById("gcode-line-count");

// Coordinates elements
const valX = document.getElementById("val-x");
const valY = document.getElementById("val-y");
const valZ = document.getElementById("val-z");
const valFeed = document.getElementById("val-feed");
const valSpindle = document.getElementById("val-spindle");
const boxFeed = document.getElementById("box-feed");

// Stats elements
const statDimensions = document.getElementById("stat-dimensions");
const statEstTime = document.getElementById("stat-est-time");
const statCutLen = document.getElementById("stat-cut-len");
const statRapidLen = document.getElementById("stat-rapid-len");
const infoFilename = document.getElementById("info-filename");
const infoToolDia = document.getElementById("info-tool-dia");
const infoMaxZ = document.getElementById("info-max-z");
const infoMinZ = document.getElementById("info-min-z");
const statusText = document.getElementById("sim-status-text");

// Initialize application
document.addEventListener("DOMContentLoaded", () => {
    resizeCanvas();
    setupEventListeners();
    loadSettingsFromServer();
    
    // Heartbeat setup
    sendHeartbeat();
    setInterval(sendHeartbeat, 3000);
    
    // Instantly ping on visibility change
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            sendHeartbeat();
        }
    });

    // Shutdown server instantly when tab/window is closed
    window.addEventListener("beforeunload", () => {
        navigator.sendBeacon("/api/shutdown");
    });
});

// Resize canvas to container bounds
function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    draw();
}

window.addEventListener("resize", resizeCanvas);

// Heartbeat to keep backend alive
async function sendHeartbeat() {
    try {
        await fetch("/api/heartbeat", { method: "POST" });
        updateConnectionBadge(true);
    } catch (err) {
        console.error("Heartbeat failed", err);
        updateConnectionBadge(false);
    }
}

function updateConnectionBadge(connected) {
    if (connected) {
        statusText.innerText = "Connected";
        statusText.style.backgroundColor = "#238636";
    } else {
        statusText.innerText = "Connection Error";
        statusText.style.backgroundColor = "var(--danger)";
    }
}

// Update App Status bar
function updateStatus(text, type = "info") {
    statusText.innerText = text;
    if (type === "error") {
        statusText.style.backgroundColor = "var(--danger)";
    } else if (type === "loading") {
        statusText.style.backgroundColor = "#9a6700";
    } else {
        statusText.style.backgroundColor = "#238636";
    }
}

// Save/Load Settings (last folder path)
async function loadSettingsFromServer() {
    try {
        const res = await fetch("/api/simulator/settings");
        if (!res.ok) return;
        const data = await res.json();
        if (data.params && data.params.last_folder) {
            state.folderPath = data.params.last_folder;
            folderPathInput.value = state.folderPath;
            await scanFolder();
        }
    } catch (err) {
        console.error("Error loading settings:", err);
    }
}

async function saveSettingsToServer() {
    const payload = {
        params: {
            last_folder: state.folderPath
        }
    };
    try {
        await fetch("/api/simulator/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error("Error saving settings:", err);
    }
}

// Native Folder picker API
async function selectFolder() {
    updateStatus("Opening dialog...", "loading");
    try {
        const res = await fetch("/api/simulator/select_folder", { method: "POST" });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Failed to select folder");
        }
        const data = await res.json();
        if (data.folder_path) {
            state.folderPath = data.folder_path;
            folderPathInput.value = state.folderPath;
            await saveSettingsToServer();
            await scanFolder();
        } else {
            updateStatus("Selection cancelled");
        }
    } catch (err) {
        console.error(err);
        updateStatus(err.message, "error");
    }
}

// Scan folder for G-code files
async function scanFolder() {
    const path = folderPathInput.value.trim();
    if (!path) return;
    
    state.folderPath = path;
    updateStatus("Scanning...", "loading");
    
    try {
        const res = await fetch("/api/simulator/scan_folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder_path: state.folderPath })
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Scan error");
        }
        
        const data = await res.json();
        
        // Keep any already loaded local files that aren't part of server scan
        const localLoaded = state.files.filter(f => f.is_local);
        state.files = [...localLoaded, ...data.files];
        
        renderFileList();
        updateStatus("Folder scanned");
        await saveSettingsToServer();
    } catch (err) {
        console.error(err);
        updateStatus("Error: " + err.message, "error");
        fileListContainer.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--danger); font-size: 0.85rem;">${err.message}</div>`;
    }
}

// Render scanned and uploaded files with checkboxes and active simulation selectors
function renderFileList() {
    if (state.files.length === 0) {
        fileListContainer.innerHTML = `
            <div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                No G-code files found
            </div>`;
        return;
    }
    
    fileListContainer.innerHTML = "";
    state.files.forEach(file => {
        const item = document.createElement("div");
        item.className = "file-item";
        
        const isLoaded = !!state.loadedFiles[file.full_path];
        const isVisible = isLoaded ? state.loadedFiles[file.full_path].visible : false;
        const isActive = state.activeFileKey === file.full_path;
        
        if (isActive) {
            item.classList.add("active");
        }
        
        // Checkbox for visibility toggle
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "file-item-checkbox";
        checkbox.checked = isActive ? true : isVisible; // Selected file is ALWAYS checked
        checkbox.title = isActive ? "Active simulation file is always visible" : "Show / Hide toolpath on canvas";
        
        checkbox.addEventListener("change", async (e) => {
            e.stopPropagation();
            
            if (isActive) {
                // Keep visually checked since selected file must remain checked
                checkbox.checked = true;
                if (isLoaded) {
                    // Toggle whether it's userChecked (pinned visible in background)
                    state.loadedFiles[file.full_path].userChecked = !state.loadedFiles[file.full_path].userChecked;
                }
                renderFileList();
                return;
            }
            
            const checked = checkbox.checked;
            if (checked) {
                if (!isLoaded) {
                    await loadFile(file, false);
                    if (state.loadedFiles[file.full_path]) {
                        state.loadedFiles[file.full_path].userChecked = true;
                    }
                } else {
                    state.loadedFiles[file.full_path].visible = true;
                    state.loadedFiles[file.full_path].userChecked = true;
                    draw();
                }
            } else {
                if (isLoaded) {
                    state.loadedFiles[file.full_path].visible = false;
                    state.loadedFiles[file.full_path].userChecked = false;
                    draw();
                }
            }
            renderFileList();
        });
        
        // Filename click makes it active simulation file
        const nameSpan = document.createElement("span");
        nameSpan.className = "file-item-name";
        nameSpan.innerText = file.relative_path;
        nameSpan.title = "Set as active for simulation";
        nameSpan.addEventListener("click", async () => {
            await loadFile(file, true);
        });
        
        item.appendChild(checkbox);
        item.appendChild(nameSpan);
        
        // Active simulation badge
        if (isActive) {
            const badge = document.createElement("span");
            badge.className = "active-sim-badge";
            badge.innerText = "Simulation";
            item.appendChild(badge);
        }
        
        const sizeKB = (file.size / 1024).toFixed(1);
        const sizeSpan = document.createElement("span");
        sizeSpan.className = "file-size";
        sizeSpan.innerText = `${sizeKB} KB`;
        item.appendChild(sizeSpan);
        
        fileListContainer.appendChild(item);
    });
}

// Load, parse, and register a file
async function loadFile(file, makeActive) {
    if (state.loadedFiles[file.full_path]) {
        if (makeActive) {
            setActiveFile(file.full_path);
        } else {
            state.loadedFiles[file.full_path].visible = true;
            draw();
        }
        return;
    }
    
    updateStatus("Loading file...", "loading");
    try {
        let name = file.name;
        let content = "";
        
        if (file.is_local) {
            content = file.content;
        } else {
            const res = await fetch("/api/simulator/read_file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file_path: file.full_path })
            });
            if (!res.ok) throw new Error("Failed to read G-code file from server");
            const data = await res.json();
            content = data.content;
        }
        
        // Parse G-code
        const parsed = parseGCode(content);
        
        // Register in state
        state.loadedFiles[file.full_path] = {
            name: name,
            full_path: file.full_path,
            content: content,
            visible: true,
            ...parsed
        };
        
        if (makeActive) {
            setActiveFile(file.full_path);
            fitToScreen();
        } else {
            draw();
            updateStatus("File added");
        }
        renderFileList();
    } catch (err) {
        console.error(err);
        updateStatus("Error: " + err.message, "error");
    }
}

// Set active G-code file for simulation controls
function setActiveFile(key) {
    const oldKey = state.activeFileKey;
    if (oldKey && oldKey !== key && state.loadedFiles[oldKey]) {
        // If the previous active file wasn't explicitly checked by the user, uncheck it
        if (!state.loadedFiles[oldKey].userChecked) {
            state.loadedFiles[oldKey].visible = false;
        }
    }
    
    state.activeFileKey = key;
    const fileData = state.loadedFiles[key];
    if (!fileData) return;
    
    // Set active file visible
    fileData.visible = true;
    
    // Copy active file properties to the root state for simulation/stats backwards compatibility
    state.gcodeText = fileData.content;
    state.gcodeLines = fileData.gcodeLines;
    state.segments = fileData.segments;
    state.bounds = fileData.bounds;
    state.totalDuration = fileData.totalDuration;
    state.totalCutLength = fileData.totalCutLength;
    state.totalRapidLength = fileData.totalRapidLength;
    state.toolDiameter = fileData.toolDiameter;
    
    // Update stats UI
    statDimensions.innerText = `${state.bounds.width.toFixed(1)} x ${state.bounds.height.toFixed(1)} mm`;
    statEstTime.innerText = formatTime(state.totalDuration);
    statCutLen.innerText = state.totalCutLength.toFixed(1) + " mm";
    statRapidLen.innerText = state.totalRapidLength.toFixed(1) + " mm";
    
    infoFilename.innerText = fileData.name;
    infoToolDia.innerText = state.toolDiameter.toFixed(2) + " mm";
    infoMaxZ.innerText = state.bounds.maxZ.toFixed(2);
    infoMinZ.innerText = state.bounds.minZ.toFixed(2);
    
    // Populate G-code viewer panel
    renderGCodeViewer();
    
    // Reset simulation values
    resetSimulation();
    
    updateStatus(`Active: ${fileData.name}`);
    
    // Enable playback controls
    btnPlay.disabled = state.segments.length === 0;
    btnReset.disabled = false;
    
    renderFileList();
}

// Event Listeners Setup
function setupEventListeners() {
    btnSelectFolder.addEventListener("click", selectFolder);
    btnScan.addEventListener("click", scanFolder);
    
    // Drag & Drop
    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => loadLocalFile(file));
    });
    
    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    });
    
    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("dragover");
    });
    
    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        const files = Array.from(e.dataTransfer.files);
        files.forEach(file => loadLocalFile(file));
    });
    
    // Simulation controls
    btnPlay.addEventListener("click", togglePlayback);
    btnReset.addEventListener("click", resetSimulation);
    speedSelect.addEventListener("change", (e) => {
        state.playbackSpeed = parseFloat(e.target.value);
    });
    
    progressSlider.addEventListener("input", (e) => {
        scrubSimulation(parseInt(e.target.value) / 1000);
    });
    
    // Disable context menu on canvas to allow right-click dragging
    canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
    });
    
    // Canvas Pan & Zoom
    canvas.addEventListener("mousedown", (e) => {
        state.isDragging = true;
        state.dragButton = e.button; // 0 = Left click, 2 = Right click
        state.startX = e.clientX;
        state.startY = e.clientY;
        state.startOffsetX = state.offsetX;
        state.startOffsetY = state.offsetY;
        state.startYaw = state.yaw;
        state.startPitch = state.pitch;
    });
    
    canvas.addEventListener("mousemove", (e) => {
        if (state.isDragging) {
            const dx = e.clientX - state.startX;
            const dy = e.clientY - state.startY;
            
            const viewSelect = document.getElementById("view-select");
            const viewMode = viewSelect ? viewSelect.value : "top";
            
            if (viewMode === "isometric" && state.dragButton === 0 && !e.shiftKey) {
                // Left click drag: Rotate view (left/right alters yaw, up/down alters pitch)
                state.yaw = state.startYaw + dx * 0.007;
                state.pitch = Math.min(Math.max(state.startPitch + dy * 0.007, -Math.PI / 2), 0);
            } else {
                // Right click drag, Shift+drag, or non-3D mode: Pan view
                state.offsetX = state.startOffsetX + dx;
                state.offsetY = state.startOffsetY + dy;
            }
            draw();
        }
    });
    
    window.addEventListener("mouseup", () => {
        state.isDragging = false;
    });
    
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        
        // Zoom center around mouse pointer
        const mouseX = e.clientX - canvas.getBoundingClientRect().left;
        const mouseY = e.clientY - canvas.getBoundingClientRect().top;
        
        const mx = canvas.width / 2;
        const my = canvas.height / 2;
        
        const viewSelect = document.getElementById("view-select");
        const viewMode = viewSelect ? viewSelect.value : "top";
        const zExaggeration = 10;
        
        const bx = (state.bounds.minX + state.bounds.maxX) / 2;
        let worldX = (mouseX - state.offsetX - mx) / state.zoom + bx;
        let worldY;
        
        if (viewMode === "side-xz") {
            const bz = (state.bounds.minZ + state.bounds.maxZ) / 2;
            worldY = -(mouseY - state.offsetY - my) / (state.zoom * zExaggeration) + bz;
        } else {
            const by = (state.bounds.minY + state.bounds.maxY) / 2;
            worldY = -(mouseY - state.offsetY - my) / state.zoom + by;
        }
        
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        const newZoom = Math.min(Math.max(state.zoom * zoomFactor, 0.1), 1000);
        
        state.zoom = newZoom;
        state.offsetX = mouseX - mx - (worldX - bx) * state.zoom;
        
        if (viewMode === "side-xz") {
            const bz = (state.bounds.minZ + state.bounds.maxZ) / 2;
            state.offsetY = mouseY - my + (worldY - bz) * state.zoom * zExaggeration;
        } else {
            const by = (state.bounds.minY + state.bounds.maxY) / 2;
            state.offsetY = mouseY - my + (worldY - by) * state.zoom;
        }
        
        draw();
    }, { passive: false });
    
    document.getElementById("sim-btn-zoom-in").addEventListener("click", () => {
        zoomCanvas(1.2);
    });
    
    document.getElementById("sim-btn-zoom-out").addEventListener("click", () => {
        zoomCanvas(1 / 1.2);
    });
    
    document.getElementById("sim-btn-zoom-fit").addEventListener("click", fitToScreen);
    
    // View projection and PCB thickness listeners
    document.getElementById("view-select").addEventListener("change", () => {
        fitToScreen();
    });
    
    document.getElementById("pcb-thickness").addEventListener("input", () => {
        draw();
    });
}

// Zoom canvas relative to center
function zoomCanvas(factor) {
    state.zoom = Math.min(Math.max(state.zoom * factor, 0.1), 1000);
    draw();
}

// Load a local G-code file from drag & drop or file selector
function loadLocalFile(file) {
    const reader = new FileReader();
    updateStatus("Reading local file...", "loading");
    reader.onload = async (e) => {
        const fileObj = {
            name: file.name,
            relative_path: "[Local] " + file.name,
            full_path: "local_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            size: file.size,
            is_local: true,
            content: e.target.result
        };
        
        // Register in list
        state.files.unshift(fileObj);
        
        // Load and parse
        await loadFile(fileObj, true);
    };
    reader.onerror = () => {
        updateStatus("Failed to read local file", "error");
    };
    reader.readAsText(file);
}

// G-code Parser implementation (returns structural object)
function parseGCode(text) {
    const lines = text.split('\n');
    const segments = [];
    
    let curX = 0.0;
    let curY = 0.0;
    let curZ = 0.0;
    let activeFeed = 100.0;
    let activeSpindle = 0.0;
    let absoluteMode = true;
    let unitsScale = 1.0;
    
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    let totalCut = 0.0;
    let totalRapid = 0.0;
    let timeAccumulated = 0.0;
    
    const defaultRapidSpeed = 1500.0;
    let detectedToolDiameter = 0.2;
    
    const reG = /G(\d+)/i;
    const reX = /X\s*(-?\d*\.?\d+)/i;
    const reY = /Y\s*(-?\d*\.?\d+)/i;
    const reZ = /Z\s*(-?\d*\.?\d+)/i;
    const reF = /F\s*(\d*\.?\d+)/i;
    const reS = /S\s*(\d*\.?\d+)/i;
    const reT = /T\s*(\d+)/i;
    
    const reToolComment = /(?:diameter|diameter\s*=\s*|drill\s*bit\s*diameter\s*)\s*([\d\.]+)/i;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith(';') || line.startsWith('(')) {
            const match = line.match(reToolComment);
            if (match) {
                detectedToolDiameter = parseFloat(match[1]);
            }
        }
    }
    
    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        let line = rawLine;
        const commentIdx = rawLine.indexOf(';');
        if (commentIdx !== -1) {
            line = rawLine.substring(0, commentIdx);
        }
        const parenIdx = rawLine.indexOf('(');
        if (parenIdx !== -1) {
            line = rawLine.substring(0, parenIdx);
        }
        line = line.trim();
        if (!line) continue;
        
        if (line.includes("G20")) unitsScale = 25.4;
        if (line.includes("G21")) unitsScale = 1.0;
        if (line.includes("G90")) absoluteMode = true;
        if (line.includes("G91")) absoluteMode = false;
        
        const matchS = line.match(reS);
        if (matchS) activeSpindle = parseFloat(matchS[1]);
        
        const matchF = line.match(reF);
        if (matchF) activeFeed = parseFloat(matchF[1]) * unitsScale;
        
        const matchG = line.match(reG);
        let gCmd = null;
        if (matchG) {
            gCmd = parseInt(matchG[1]);
        } else if (line.match(reX) || line.match(reY) || line.match(reZ)) {
            if (segments.length > 0) {
                const lastSeg = segments[segments.length - 1];
                gCmd = lastSeg.type === "rapid" ? 0 : 1;
            } else {
                gCmd = 1;
            }
        }
        
        if (gCmd === 0 || gCmd === 1 || gCmd === 2 || gCmd === 3) {
            const matchX = line.match(reX);
            const matchY = line.match(reY);
            const matchZ = line.match(reZ);
            
            if (!matchX && !matchY && !matchZ) continue;
            
            let nextX = curX;
            let nextY = curY;
            let nextZ = curZ;
            
            if (absoluteMode) {
                if (matchX) nextX = parseFloat(matchX[1]) * unitsScale;
                if (matchY) nextY = parseFloat(matchY[1]) * unitsScale;
                if (matchZ) nextZ = parseFloat(matchZ[1]) * unitsScale;
            } else {
                if (matchX) nextX = curX + parseFloat(matchX[1]) * unitsScale;
                if (matchY) nextY = curY + parseFloat(matchY[1]) * unitsScale;
                if (matchZ) nextZ = curZ + parseFloat(matchZ[1]) * unitsScale;
            }
            
            const dx = nextX - curX;
            const dy = nextY - curY;
            const dz = nextZ - curZ;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            if (dist > 0.0001) {
                let type = "cut";
                let speed = activeFeed;
                
                if (gCmd === 0) {
                    type = "rapid";
                    speed = defaultRapidSpeed;
                } else {
                    const isVertical = Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001;
                    if (isVertical) {
                        type = (dz < 0) ? "plunge" : "retract";
                    } else if (nextZ > 0.001) {
                        type = "rapid";
                        speed = defaultRapidSpeed;
                    }
                }
                
                const duration = dist / (speed / 60.0);
                
                segments.push({
                    type: type,
                    start: { x: curX, y: curY, z: curZ },
                    end: { x: nextX, y: nextY, z: nextZ },
                    f: gCmd === 0 ? defaultRapidSpeed : activeFeed,
                    s: activeSpindle,
                    lineIndex: i,
                    length: dist,
                    timeStart: timeAccumulated,
                    timeEnd: timeAccumulated + duration
                });
                timeAccumulated += duration;
                
                if (type === "rapid") {
                    totalRapid += dist;
                } else {
                    totalCut += dist;
                }
                
                minX = Math.min(minX, nextX, curX);
                maxX = Math.max(maxX, nextX, curX);
                minY = Math.min(minY, nextY, curY);
                maxY = Math.max(maxY, nextY, curY);
                minZ = Math.min(minZ, nextZ, curZ);
                maxZ = Math.max(maxZ, nextZ, curZ);
            }
            
            curX = nextX;
            curY = nextY;
            curZ = nextZ;
        }
    }
    
    let bounds;
    if (minX === Infinity) {
        bounds = { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: -1, maxZ: 2, width: 10, height: 10 };
    } else {
        bounds = {
            minX: minX,
            maxX: maxX,
            minY: minY,
            maxY: maxY,
            minZ: minZ,
            maxZ: maxZ,
            width: maxX - minX,
            height: maxY - minY
        };
    }
    
    return {
        gcodeLines: lines,
        segments: segments,
        bounds: bounds,
        totalDuration: timeAccumulated,
        totalCutLength: totalCut,
        totalRapidLength: totalRapid,
        toolDiameter: detectedToolDiameter
    };
}

// Render G-code sidebar container
function renderGCodeViewer() {
    gcodeLinesBox.innerHTML = "";
    
    const maxLinesToShow = 5000;
    const count = state.gcodeLines.length;
    const truncated = count > maxLinesToShow;
    const renderLimit = truncated ? maxLinesToShow - 100 : count;
    
    const fragment = document.createDocumentFragment();
    
    for (let i = 0; i < renderLimit; i++) {
        const lineEl = createGCodeLineDOM(i, state.gcodeLines[i]);
        fragment.appendChild(lineEl);
    }
    
    if (truncated) {
        const separator = document.createElement("div");
        separator.style.padding = "6px 20px";
        separator.style.color = "var(--text-muted)";
        separator.style.fontSize = "0.75rem";
        separator.style.textAlign = "center";
        separator.style.backgroundColor = "var(--bg-input)";
        separator.innerText = `... [Omitted ${count - maxLinesToShow} lines for performance] ...`;
        fragment.appendChild(separator);
        
        for (let i = count - 100; i < count; i++) {
            const lineEl = createGCodeLineDOM(i, state.gcodeLines[i]);
            fragment.appendChild(lineEl);
        }
    }
    
    gcodeLinesBox.appendChild(fragment);
}

function createGCodeLineDOM(index, text) {
    const row = document.createElement("div");
    row.className = "gcode-line";
    row.id = `gcode-line-${index}`;
    row.innerHTML = `
        <span class="gcode-line-number">${index + 1}</span>
        <span class="gcode-line-text">${escapeHtml(text)}</span>
    `;
    row.addEventListener("click", () => {
        if (state.segments.length > 0) {
            const seg = state.segments.find(s => s.lineIndex === index);
            if (seg) {
                scrubSimulation(seg.timeStart / state.totalDuration);
            }
        }
    });
    return row;
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Find loaded file key that contains board outline path
function findOutlineKey() {
    return Object.keys(state.loadedFiles).find(key => {
        const name = state.loadedFiles[key].name.toLowerCase();
        return name.includes("outline") || name.includes("border") || name.includes("contour") || name.includes("edge") || name.includes("cutout");
    });
}

// Extract continuous contours (polylines/polygons) from G-code cut segments
function extractContours(segments) {
    const cutSegments = segments.filter(seg => seg.type === "cut");
    if (cutSegments.length === 0) return [];
    
    const paths = [];
    const used = new Set();
    
    while (used.size < cutSegments.length) {
        let startSeg = null;
        for (let i = 0; i < cutSegments.length; i++) {
            if (!used.has(i)) {
                startSeg = cutSegments[i];
                used.add(i);
                break;
            }
        }
        if (!startSeg) break;
        
        const currentPath = [
            { x: startSeg.start.x, y: startSeg.start.y },
            { x: startSeg.end.x, y: startSeg.end.y }
        ];
        
        let added = true;
        while (added) {
            added = false;
            const lastPt = currentPath[currentPath.length - 1];
            for (let i = 0; i < cutSegments.length; i++) {
                if (used.has(i)) continue;
                const seg = cutSegments[i];
                
                const dStart = Math.hypot(seg.start.x - lastPt.x, seg.start.y - lastPt.y);
                if (dStart < 0.1) {
                    currentPath.push({ x: seg.end.x, y: seg.end.y });
                    used.add(i);
                    added = true;
                    break;
                }
                
                const dEnd = Math.hypot(seg.end.x - lastPt.x, seg.end.y - lastPt.y);
                if (dEnd < 0.1) {
                    currentPath.push({ x: seg.start.x, y: seg.start.y });
                    used.add(i);
                    added = true;
                    break;
                }
            }
        }
        paths.push(currentPath);
    }
    return paths;
}

// Shrink a contour inwards towards its centroid by a specified amount (tool radius)
function shrinkContour(contour, amount) {
    if (!amount || amount <= 0 || contour.length < 3) return contour;
    
    // 1. Calculate centroid
    let cx = 0, cy = 0;
    contour.forEach(pt => {
        cx += pt.x;
        cy += pt.y;
    });
    cx /= contour.length;
    cy /= contour.length;
    
    // 2. Shift each point towards the centroid by amount
    return contour.map(pt => {
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist <= amount) {
            return { x: cx, y: cy };
        }
        const factor = (dist - amount) / dist;
        return {
            x: cx + dx * factor,
            y: cy + dy * factor
        };
    });
}

// Calculate board boundaries globally (from outline file, or union with +5mm offset)
function calculateBoardBounds() {
    const outlineKey = findOutlineKey();
    if (outlineKey && state.loadedFiles[outlineKey]) {
        return { 
            ...state.loadedFiles[outlineKey].bounds, 
            hasOutline: true, 
            outlineKey: outlineKey 
        };
    }
    
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    const loadedKeys = Object.keys(state.loadedFiles);
    if (loadedKeys.length === 0) {
        return { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: -1, maxZ: 2, width: 10, height: 10, hasOutline: false };
    }
    
    loadedKeys.forEach(key => {
        const b = state.loadedFiles[key].bounds;
        if (b.minX < minX) minX = b.minX;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxY > maxY) maxY = b.maxY;
        if (b.minZ < minZ) minZ = b.minZ;
        if (b.maxZ > maxZ) maxZ = b.maxZ;
    });
    
    if (minX === Infinity) {
        return { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: -1, maxZ: 2, width: 10, height: 10, hasOutline: false };
    }
    
    // Apply +5mm offset
    minX -= 5;
    maxX += 5;
    minY -= 5;
    maxY += 5;
    
    return {
        minX: minX,
        maxX: maxX,
        minY: minY,
        maxY: maxY,
        minZ: minZ,
        maxZ: maxZ,
        width: maxX - minX,
        height: maxY - minY,
        hasOutline: false
    };
}

// Fit visual paths of the active file to canvas boundary
function fitToScreen() {
    const boardBounds = calculateBoardBounds();
    if (boardBounds.width === 0 || boardBounds.height === 0) return;
    
    const margin = 40;
    const cWidth = canvas.width;
    const cHeight = canvas.height;
    
    const viewSelect = document.getElementById("view-select");
    const viewMode = viewSelect ? viewSelect.value : "top";
    
    let boundsWidth = boardBounds.width;
    let boundsHeight = boardBounds.height;
    
    if (viewMode === "side-xz") {
        const zSpan = Math.max(boardBounds.maxZ - boardBounds.minZ, 1.0);
        boundsHeight = zSpan * 10;
    } else if (viewMode === "isometric") {
        // Encompass the diagonal bounding sphere of the board for safe 3D fitting
        const boardDiag = Math.sqrt(boardBounds.width * boardBounds.width + boardBounds.height * boardBounds.height);
        boundsWidth = boardDiag;
        boundsHeight = boardDiag;
    }
    
    const scaleX = (cWidth - margin * 2) > 0 ? (cWidth - margin * 2) / boundsWidth : 1.0;
    const scaleY = (cHeight - margin * 2) > 0 ? (cHeight - margin * 2) / boundsHeight : 1.0;
    
    state.zoom = Math.min(scaleX, scaleY);
    if (state.zoom <= 0) {
        state.zoom = 1.0;
    }
    
    state.offsetX = 0;
    state.offsetY = 0;
    
    draw();
}

// Draw canvas framework (supports XY top view, XZ side view, and 3D isometric view)
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Collect visible loaded files
    const visibleKeys = Object.keys(state.loadedFiles).filter(k => state.loadedFiles[k].visible);
    
    if (visibleKeys.length === 0) {
        ctx.fillStyle = document.body.classList.contains("light-theme") ? "rgba(0, 0, 0, 0.45)" : "rgba(255, 255, 255, 0.3)";
        ctx.font = "14px -apple-system, BlinkMacSystemFont, 'Segoe UI'";
        ctx.textAlign = "center";
        ctx.fillText("Drag and drop G-code files or select a folder to start simulation", canvas.width / 2, canvas.height / 2);
        return;
    }
    
    const activeKey = state.activeFileKey || visibleKeys[0];
    const boardBounds = calculateBoardBounds();
    
    const mx = canvas.width / 2;
    const my = canvas.height / 2;
    
    const viewSelect = document.getElementById("view-select");
    const viewMode = viewSelect ? viewSelect.value : "top";
    
    const thicknessInput = document.getElementById("pcb-thickness");
    const pcbThickness = thicknessInput ? (parseFloat(thicknessInput.value) || 1.5) : 1.5;
    
    let currentYaw = 0;
    let currentPitch = 0;
    let zExaggeration = 1.0;
    
    if (viewMode === "top") {
        currentYaw = 0;
        currentPitch = 0;
        zExaggeration = 1.0;
    } else if (viewMode === "side-xz") {
        currentYaw = 0;
        currentPitch = -Math.PI / 2;
        zExaggeration = 10.0; // 10x vertical exaggeration
    } else if (viewMode === "isometric") {
        currentYaw = state.yaw;
        currentPitch = state.pitch;
        zExaggeration = 1.0; // Physically accurate scale for 3D view
    }
    
    const bx = (boardBounds.minX + boardBounds.maxX) / 2;
    const by = (boardBounds.minY + boardBounds.maxY) / 2;
    const bz = (boardBounds.minZ + boardBounds.maxZ) / 2;
    
    // Unified 3D-to-2D projection mapping function
    const toScreen = (wx, wy, wz) => {
        const dx = wx - bx;
        const dy = wy - by;
        const dz = (wz - bz) * zExaggeration;
        
        // Z-rotation (yaw)
        const cosY = Math.cos(currentYaw);
        const sinY = Math.sin(currentYaw);
        const x1 = dx * cosY - dy * sinY;
        const y1 = dx * sinY + dy * cosY;
        
        // X-rotation (pitch)
        const cosP = Math.cos(currentPitch);
        const sinP = Math.sin(currentPitch);
        const x2 = x1;
        const y2 = y1 * cosP - dz * sinP;
        
        return {
            x: mx + state.offsetX + x2 * state.zoom,
            y: my + state.offsetY - y2 * state.zoom
        };
    };
    
    // 1. Draw background coordinate grid on active plane
    drawGrid(toScreen, viewMode, boardBounds);
    
    // 2. Draw PCB 3D workpiece box or boundary lines
    if (viewMode === "side-xz") {
        // Flat XZ board rectangle
        const pcbLeft = toScreen(boardBounds.minX, boardBounds.minY, 0.0).x;
        const pcbRight = toScreen(boardBounds.maxX, boardBounds.minY, 0.0).x;
        const pcbTop = toScreen(boardBounds.minX, boardBounds.minY, 0.0).y;
        const pcbBottom = toScreen(boardBounds.minX, boardBounds.minY, -pcbThickness).y;
        
        // Board body
        ctx.fillStyle = "rgba(35, 134, 54, 0.22)";
        ctx.strokeStyle = "#238636";
        ctx.lineWidth = 1.0;
        ctx.fillRect(pcbLeft, pcbTop, pcbRight - pcbLeft, pcbBottom - pcbTop);
        ctx.strokeRect(pcbLeft, pcbTop, pcbRight - pcbLeft, pcbBottom - pcbTop);
        
        // Copper top line
        ctx.beginPath();
        ctx.strokeStyle = "#ff7b72";
        ctx.lineWidth = 2.0;
        ctx.moveTo(pcbLeft, pcbTop);
        ctx.lineTo(pcbRight, pcbTop);
        ctx.stroke();
        
        // Wasteboard base
        ctx.fillStyle = "rgba(48, 54, 61, 0.25)";
        ctx.fillRect(pcbLeft, pcbBottom, pcbRight - pcbLeft, canvas.height - pcbBottom);
        
        ctx.fillStyle = "var(--text-muted)";
        ctx.font = "10px monospace";
        ctx.textAlign = "left";
        ctx.fillText(`FR-4 Board (${pcbThickness.toFixed(1)} mm)`, pcbLeft + 10, pcbTop + 14);
        ctx.fillText("Sacrificial wasteboard", pcbLeft + 10, pcbBottom + 14);
        
    } else if (viewMode === "isometric") {
        if (boardBounds.hasOutline) {
            // Draw custom-shaped board from G-code outline file contours
            const rawContours = extractContours(state.loadedFiles[boardBounds.outlineKey].segments);
            const outlineFile = state.loadedFiles[boardBounds.outlineKey];
            const toolRadius = outlineFile ? (outlineFile.toolDiameter / 2.0) : 1.0;
            const contours = rawContours.map(c => shrinkContour(c, toolRadius));
            
            // 1. Draw sacrificial wasteboard shadow (below Z = -pcbThickness)
            ctx.fillStyle = "rgba(48, 54, 61, 0.12)";
            const wbH = 3.0; // wasteboard shadow height
            contours.forEach(contour => {
                for (let i = 0; i < contour.length - 1; i++) {
                    const pt1 = contour[i];
                    const pt2 = contour[i+1];
                    const p1 = toScreen(pt1.x, pt1.y, -pcbThickness);
                    const p2 = toScreen(pt2.x, pt2.y, -pcbThickness);
                    const p1B = toScreen(pt1.x, pt1.y, -pcbThickness - wbH);
                    const p2B = toScreen(pt2.x, pt2.y, -pcbThickness - wbH);
                    
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.lineTo(p2B.x, p2B.y);
                    ctx.lineTo(p1B.x, p1B.y);
                    ctx.closePath();
                    ctx.fill();
                }
            });
            
            // 2. Fill FR-4 body (base face at Z = -pcbThickness)
            ctx.fillStyle = "rgba(35, 134, 54, 0.15)";
            contours.forEach(contour => {
                ctx.beginPath();
                contour.forEach((pt, idx) => {
                    const scr = toScreen(pt.x, pt.y, -pcbThickness);
                    if (idx === 0) ctx.moveTo(scr.x, scr.y);
                    else ctx.lineTo(scr.x, scr.y);
                });
                ctx.closePath();
                ctx.fill();
            });
            
            // 3. Draw vertical side walls of the board
            ctx.fillStyle = "rgba(35, 134, 54, 0.25)";
            ctx.strokeStyle = "rgba(57, 211, 83, 0.25)";
            ctx.lineWidth = 1.0;
            contours.forEach(contour => {
                for (let i = 0; i < contour.length - 1; i++) {
                    const pt1 = contour[i];
                    const pt2 = contour[i+1];
                    
                    const p1T = toScreen(pt1.x, pt1.y, 0);
                    const p2T = toScreen(pt2.x, pt2.y, 0);
                    const p2B = toScreen(pt2.x, pt2.y, -pcbThickness);
                    const p1B = toScreen(pt1.x, pt1.y, -pcbThickness);
                    
                    ctx.beginPath();
                    ctx.moveTo(p1T.x, p1T.y);
                    ctx.lineTo(p2T.x, p2T.y);
                    ctx.lineTo(p2B.x, p2B.y);
                    ctx.lineTo(p1B.x, p1B.y);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }
            });
            
            // 4. Fill top face (Z = 0)
            ctx.fillStyle = "rgba(35, 134, 54, 0.08)";
            contours.forEach(contour => {
                ctx.beginPath();
                contour.forEach((pt, idx) => {
                    const scr = toScreen(pt.x, pt.y, 0);
                    if (idx === 0) ctx.moveTo(scr.x, scr.y);
                    else ctx.lineTo(scr.x, scr.y);
                });
                ctx.closePath();
                ctx.fill();
            });
            
            // 5. Stroke top copper outline border
            ctx.strokeStyle = "#ff7b72";
            ctx.lineWidth = 1.5;
            contours.forEach(contour => {
                ctx.beginPath();
                contour.forEach((pt, idx) => {
                    const scr = toScreen(pt.x, pt.y, 0);
                    if (idx === 0) ctx.moveTo(scr.x, scr.y);
                    else ctx.lineTo(scr.x, scr.y);
                });
                ctx.closePath();
                ctx.stroke();
            });
            
        } else {
            // Translucent 3D PCB Solid box with side faces and top copper surface
            const minX = boardBounds.minX;
            const maxX = boardBounds.maxX;
            const minY = boardBounds.minY;
            const maxY = boardBounds.maxY;
            
            // 8 Corners of the board box
            const pts = [
                toScreen(minX, minY, 0),          // 0: bottom-left top
                toScreen(maxX, minY, 0),          // 1: bottom-right top
                toScreen(maxX, maxY, 0),          // 2: top-right top
                toScreen(minX, maxY, 0),          // 3: top-left top
                toScreen(minX, minY, -pcbThickness), // 4: bottom-left base
                toScreen(maxX, minY, -pcbThickness), // 5: bottom-right base
                toScreen(maxX, maxY, -pcbThickness), // 6: top-right base
                toScreen(minX, maxY, -pcbThickness)  // 7: top-left base
            ];
            
            ctx.strokeStyle = "rgba(57, 211, 83, 0.25)";
            ctx.lineWidth = 1.0;
            
            // Draw bottom wasteboard base shadow
            const wbH = 3.0; // 3mm thick
            const wbPts = [
                toScreen(minX, minY, -pcbThickness - wbH),
                toScreen(maxX, minY, -pcbThickness - wbH),
                toScreen(maxX, maxY, -pcbThickness - wbH),
                toScreen(minX, maxY, -pcbThickness - wbH)
            ];
            ctx.fillStyle = "rgba(48, 54, 61, 0.12)";
            ctx.beginPath();
            ctx.moveTo(pts[4].x, pts[4].y);
            ctx.lineTo(pts[5].x, pts[5].y);
            ctx.lineTo(wbPts[1].x, wbPts[1].y);
            ctx.lineTo(wbPts[0].x, wbPts[0].y);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(pts[5].x, pts[5].y);
            ctx.lineTo(pts[6].x, pts[6].y);
            ctx.lineTo(wbPts[2].x, wbPts[2].y);
            ctx.lineTo(wbPts[1].x, wbPts[1].y);
            ctx.closePath();
            ctx.fill();
            
            // Fill FR-4 body
            ctx.fillStyle = "rgba(35, 134, 54, 0.15)";
            ctx.beginPath();
            ctx.moveTo(pts[4].x, pts[4].y);
            ctx.lineTo(pts[5].x, pts[5].y);
            ctx.lineTo(pts[6].x, pts[6].y);
            ctx.lineTo(pts[7].x, pts[7].y);
            ctx.closePath();
            ctx.fill();
            
            // Draw vertical side edges (0-4, 1-5, 2-6, 3-7)
            for (let i = 0; i < 4; i++) {
                ctx.beginPath();
                ctx.moveTo(pts[i].x, pts[i].y);
                ctx.lineTo(pts[i+4].x, pts[i+4].y);
                ctx.stroke();
            }
            
            // Draw sides filled
            ctx.fillStyle = "rgba(35, 134, 54, 0.2)";
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            ctx.lineTo(pts[1].x, pts[1].y);
            ctx.lineTo(pts[5].x, pts[5].y);
            ctx.lineTo(pts[4].x, pts[4].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(pts[1].x, pts[1].y);
            ctx.lineTo(pts[2].x, pts[2].y);
            ctx.lineTo(pts[6].x, pts[6].y);
            ctx.lineTo(pts[5].x, pts[5].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Top Face (Copper/Green board surface)
            ctx.fillStyle = "rgba(35, 134, 54, 0.08)";
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            ctx.lineTo(pts[1].x, pts[1].y);
            ctx.lineTo(pts[2].x, pts[2].y);
            ctx.lineTo(pts[3].x, pts[3].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Top Face copper border highlight
            ctx.strokeStyle = "#ff7b72";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            ctx.lineTo(pts[1].x, pts[1].y);
            ctx.lineTo(pts[2].x, pts[2].y);
            ctx.lineTo(pts[3].x, pts[3].y);
            ctx.closePath();
            ctx.stroke();
        }
        
    } else {
        if (boardBounds.hasOutline) {
            // Draw custom outline paths
            const rawContours = extractContours(state.loadedFiles[boardBounds.outlineKey].segments);
            const outlineFile = state.loadedFiles[boardBounds.outlineKey];
            const toolRadius = outlineFile ? (outlineFile.toolDiameter / 2.0) : 1.0;
            const contours = rawContours.map(c => shrinkContour(c, toolRadius));
            
            ctx.fillStyle = "rgba(35, 134, 54, 0.15)";
            ctx.strokeStyle = "#238636";
            ctx.lineWidth = 1.0;
            
            contours.forEach(contour => {
                ctx.beginPath();
                contour.forEach((pt, idx) => {
                    const scr = toScreen(pt.x, pt.y, 0);
                    if (idx === 0) ctx.moveTo(scr.x, scr.y);
                    else ctx.lineTo(scr.x, scr.y);
                });
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            });
            
            // Draw highlight border
            ctx.strokeStyle = "#ff7b72";
            ctx.lineWidth = 1.5;
            contours.forEach(contour => {
                ctx.beginPath();
                contour.forEach((pt, idx) => {
                    const scr = toScreen(pt.x, pt.y, 0);
                    if (idx === 0) ctx.moveTo(scr.x, scr.y);
                    else ctx.lineTo(scr.x, scr.y);
                });
                ctx.closePath();
                ctx.stroke();
            });
        } else {
            // XY flat outline boundary box (Estimated Board with +5mm offset)
            const p1 = toScreen(boardBounds.minX, boardBounds.minY, 0);
            const p2 = toScreen(boardBounds.maxX, boardBounds.maxY, 0);
            
            ctx.fillStyle = "rgba(35, 134, 54, 0.12)";
            ctx.strokeStyle = "#238636";
            ctx.lineWidth = 1.0;
            ctx.fillRect(p1.x, p2.y, p2.x - p1.x, p1.y - p2.y);
            ctx.strokeRect(p1.x, p2.y, p2.x - p1.x, p1.y - p2.y);
            
            ctx.strokeStyle = "#ffe082";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(p1.x, p2.y, p2.x - p1.x, p1.y - p2.y);
            ctx.setLineDash([]);
            
            ctx.fillStyle = "#ffe082";
            ctx.font = "10px monospace";
            ctx.textAlign = "left";
            ctx.fillText(
                `${boardBounds.width.toFixed(1)}x${boardBounds.height.toFixed(1)} mm (Estimated Board)`,
                p1.x + 5,
                p2.y - 5
            );
        }
    }
    
    // 3. Draw G-code path segments for all visible files
    visibleKeys.forEach(key => {
        const fileData = state.loadedFiles[key];
        const isActive = key === state.activeFileKey;
        
        ctx.globalAlpha = isActive ? 1.0 : 0.25;
        
        drawFilePaths(fileData, toScreen);
    });
    
    ctx.globalAlpha = 1.0; // Reset global alpha
    
    // 4. Draw origin (0, 0, 0) target crosshair
    const orig = toScreen(0, 0, 0);
    ctx.beginPath();
    ctx.strokeStyle = "#2f81f7";
    ctx.lineWidth = 1.5;
    ctx.arc(orig.x, orig.y, 6, 0, Math.PI * 2);
    ctx.moveTo(orig.x - 10, orig.y);
    ctx.lineTo(orig.x + 10, orig.y);
    ctx.moveTo(orig.x, orig.y - 10);
    ctx.lineTo(orig.x, orig.y + 10);
    ctx.stroke();
    
    ctx.fillStyle = "#58a6ff";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("X0 Y0 Z0", orig.x, orig.y + 20);
    
    // 5. Draw active simulated toolhead position
    if (state.activeFileKey) {
        const toolPt = toScreen(state.toolX, state.toolY, state.toolZ);
        
        if (viewMode === "top") {
            const toolR = (state.toolDiameter / 2) * state.zoom;
            ctx.beginPath();
            ctx.fillStyle = "rgba(47, 129, 247, 0.25)";
            ctx.strokeStyle = "#2f81f7";
            ctx.lineWidth = 1.0;
            ctx.arc(toolPt.x, toolPt.y, Math.max(toolR, 1.5), 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            ctx.beginPath();
            ctx.fillStyle = "#ffe082";
            ctx.arc(toolPt.x, toolPt.y, 3, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Draw vertical 3D silver milling bit in profile or isometric views
            const bitW = Math.max(state.toolDiameter * state.zoom, 2.5);
            const shaftH = 50; // pixels
            
            ctx.fillStyle = "rgba(141, 150, 160, 0.85)"; // silver metal
            ctx.strokeStyle = "#c9d1d9";
            ctx.lineWidth = 1.0;
            
            ctx.beginPath();
            ctx.moveTo(toolPt.x - bitW / 2, toolPt.y - shaftH);
            ctx.lineTo(toolPt.x + bitW / 2, toolPt.y - shaftH);
            ctx.lineTo(toolPt.x + bitW / 2, toolPt.y - 5);
            ctx.lineTo(toolPt.x, toolPt.y); // tip point
            ctx.lineTo(toolPt.x - bitW / 2, toolPt.y - 5);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Red tip highlight if cutting/plunged (Z <= 0.001)
            if (state.toolZ <= 0.001) {
                ctx.fillStyle = "#ff7b72";
                ctx.beginPath();
                ctx.moveTo(toolPt.x - bitW / 2, toolPt.y - 5);
                ctx.lineTo(toolPt.x + bitW / 2, toolPt.y - 5);
                ctx.lineTo(toolPt.x, toolPt.y);
                ctx.closePath();
                ctx.fill();
            }
        }
    }
}

// Draw toolpaths for a specific file datasets (supports 3D projection)
function drawFilePaths(fileData, toScreen) {
    const isLight = document.body.classList.contains("light-theme");
    const colors = {
        rapid: isLight ? "rgba(87, 96, 106, 0.6)" : "rgba(141, 150, 160, 0.5)",
        retract: isLight ? "#8250df" : "#ab7df6",
        plunge: isLight ? "#cf222e" : "#ff7b72",
        cut: isLight ? "#1a8c2e" : "#39d353"
    };

    const segGroups = {
        rapid: [],
        cut: [],
        plunge: [],
        retract: []
    };
    
    fileData.segments.forEach(seg => {
        segGroups[seg.type].push(seg);
    });
    
    const drawSeg = (seg) => {
        const p1 = toScreen(seg.start.x, seg.start.y, seg.start.z);
        const p2 = toScreen(seg.end.x, seg.end.y, seg.end.z);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
    };
    
    // Rapid Moves (Dashed gray)
    ctx.beginPath();
    ctx.strokeStyle = colors.rapid;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    segGroups.rapid.forEach(seg => {
        drawSeg(seg);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Retract Moves (Vertical upwards, purple)
    ctx.beginPath();
    ctx.strokeStyle = colors.retract;
    ctx.lineWidth = 1.5;
    segGroups.retract.forEach(seg => {
        drawSeg(seg);
    });
    ctx.stroke();
    
    // Plunge Moves (Vertical downwards, red)
    ctx.beginPath();
    ctx.strokeStyle = colors.plunge;
    ctx.lineWidth = 2.0;
    segGroups.plunge.forEach(seg => {
        drawSeg(seg);
    });
    ctx.stroke();
    
    // Cut Moves (Horizontal G1, solid green)
    ctx.beginPath();
    ctx.strokeStyle = colors.cut;
    ctx.lineWidth = 1.5;
    segGroups.cut.forEach(seg => {
        drawSeg(seg);
    });
    ctx.stroke();
}

// Draw backdrop grid lines (supports 3D coordinates planes)
function drawGrid(toScreen, viewMode, refBounds) {
    ctx.beginPath();
    ctx.strokeStyle = document.body.classList.contains("light-theme") ? "rgba(0, 0, 0, 0.22)" : "rgba(48, 54, 61, 0.35)";
    ctx.lineWidth = document.body.classList.contains("light-theme") ? 0.8 : 0.5;
    
    if (viewMode === "side-xz") {
        // Draw grid lines at constant X and Z
        const stepX = 10;
        const minX = Math.floor(refBounds.minX / stepX - 1) * stepX;
        const maxX = Math.ceil(refBounds.maxX / stepX + 1) * stepX;
        
        for (let x = minX; x <= maxX; x += stepX) {
            const p1 = toScreen(x, refBounds.minY, refBounds.minZ - 2);
            const p2 = toScreen(x, refBounds.minY, refBounds.maxZ + 2);
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
        }
        
        const stepZ = 1.0;
        const minZ = Math.floor(refBounds.minZ - 2);
        const maxZ = Math.ceil(refBounds.maxZ + 2);
        
        for (let z = minZ; z <= maxZ; z += stepZ) {
            const p1 = toScreen(refBounds.minX - 5, refBounds.minY, z);
            const p2 = toScreen(refBounds.maxX + 5, refBounds.minY, z);
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            
            ctx.fillStyle = document.body.classList.contains("light-theme") ? "rgba(0, 0, 0, 0.45)" : "rgba(255, 255, 255, 0.15)";
            ctx.font = "8px monospace";
            ctx.fillText(`Z=${z > 0 ? '+' : ''}${z.toFixed(1)}`, p1.x - 38, p1.y - 2);
        }
    } else {
        // Draw 10mm grid on XY plane at Z = 0
        const step = 10;
        
        const minX = Math.floor((refBounds.minX - 20) / step) * step;
        const maxX = Math.ceil((refBounds.maxX + 20) / step) * step;
        const minY = Math.floor((refBounds.minY - 20) / step) * step;
        const maxY = Math.ceil((refBounds.maxY + 20) / step) * step;
        
        // X grid lines
        for (let x = minX; x <= maxX; x += step) {
            const p1 = toScreen(x, minY, 0);
            const p2 = toScreen(x, maxY, 0);
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
        }
        
        // Y grid lines
        for (let y = minY; y <= maxY; y += step) {
            const p1 = toScreen(minX, y, 0);
            const p2 = toScreen(maxX, y, 0);
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
        }
    }
    ctx.stroke();
}

// Playback Logic
function togglePlayback() {
    if (state.isPlaying) {
        stopSimulation();
    } else {
        startSimulation();
    }
}

function startSimulation() {
    if (!state.activeFileKey || state.segments.length === 0) return;
    
    state.isPlaying = true;
    btnPlay.innerText = "Pause";
    btnPlay.classList.remove("btn-primary");
    btnPlay.classList.add("btn-secondary");
    
    if (state.currentTime >= state.totalDuration) {
        state.currentTime = 0;
        state.currentSegmentIndex = 0;
    }
    
    lastFrameTime = performance.now();
    simulationLoop();
}

function stopSimulation() {
    state.isPlaying = false;
    btnPlay.innerText = "Play";
    btnPlay.classList.add("btn-primary");
    btnPlay.classList.remove("btn-secondary");
    
    if (state.animationFrameId) {
        cancelAnimationFrame(state.animationFrameId);
        state.animationFrameId = null;
    }
}

let lastFrameTime = 0;

function simulationLoop() {
    if (!state.isPlaying) return;
    
    const now = performance.now();
    const dt = (now - lastFrameTime) / 1000.0;
    lastFrameTime = now;
    
    state.currentTime += dt * state.playbackSpeed;
    
    if (state.currentTime >= state.totalDuration) {
        state.currentTime = state.totalDuration;
        stopSimulation();
    }
    
    updateSimulationStateAtTime();
    draw();
    
    state.animationFrameId = requestAnimationFrame(simulationLoop);
}

// Find segment and interpolate coordinates
function updateSimulationStateAtTime() {
    if (state.segments.length === 0) return;
    
    const t = state.currentTime;
    
    let seg = null;
    let segIdx = 0;
    
    if (t >= state.segments[state.currentSegmentIndex].timeStart) {
        for (let i = state.currentSegmentIndex; i < state.segments.length; i++) {
            if (t >= state.segments[i].timeStart && t <= state.segments[i].timeEnd) {
                seg = state.segments[i];
                segIdx = i;
                break;
            }
        }
    }
    
    if (!seg) {
        for (let i = 0; i < state.segments.length; i++) {
            if (t >= state.segments[i].timeStart && t <= state.segments[i].timeEnd) {
                seg = state.segments[i];
                segIdx = i;
                break;
            }
        }
    }
    
    if (seg) {
        state.currentSegmentIndex = segIdx;
        
        const segDuration = seg.timeEnd - seg.timeStart;
        let ratio = 0;
        if (segDuration > 0.0001) {
            ratio = (t - seg.timeStart) / segDuration;
        }
        
        state.toolX = seg.start.x + ratio * (seg.end.x - seg.start.x);
        state.toolY = seg.start.y + ratio * (seg.end.y - seg.start.y);
        state.toolZ = seg.start.z + ratio * (seg.end.z - seg.start.z);
        
        state.activeFeed = seg.f;
        state.activeSpindle = seg.s;
        
        setActiveGCodeLine(seg.lineIndex);
    } else {
        if (t <= 0) {
            const first = state.segments[0];
            state.toolX = first.start.x;
            state.toolY = first.start.y;
            state.toolZ = first.start.z;
            state.currentSegmentIndex = 0;
            state.activeFeed = 0;
            state.activeSpindle = 0;
            setActiveGCodeLine(-1);
        } else if (t >= state.totalDuration) {
            const last = state.segments[state.segments.length - 1];
            state.toolX = last.end.x;
            state.toolY = last.end.y;
            state.toolZ = last.end.z;
            state.currentSegmentIndex = state.segments.length - 1;
            state.activeFeed = 0;
            state.activeSpindle = 0;
            setActiveGCodeLine(last.lineIndex);
        }
    }
    
    updatePlaybackUI();
    updateCoordinatesUI();
}

// Highlight G-code text editor line and scroll it into view
function setActiveGCodeLine(lineIndex) {
    if (state.activeLineIndex === lineIndex) return;
    
    if (state.activeLineIndex !== -1) {
        const oldRow = document.getElementById(`gcode-line-${state.activeLineIndex}`);
        if (oldRow) oldRow.classList.remove("active");
    }
    
    state.activeLineIndex = lineIndex;
    
    if (lineIndex !== -1) {
        const newRow = document.getElementById(`gcode-line-${lineIndex}`);
        if (newRow) {
            newRow.classList.add("active");
            
            const containerHeight = gcodeLinesBox.clientHeight;
            const rowTop = newRow.offsetTop;
            const rowHeight = newRow.clientHeight;
            
            gcodeLinesBox.scrollTop = rowTop - containerHeight / 2 + rowHeight / 2;
        }
    }
}

// Scrub simulation to specific progress ratio (0 to 1)
function scrubSimulation(ratio) {
    if (state.segments.length === 0) return;
    
    state.currentTime = ratio * state.totalDuration;
    
    updateSimulationStateAtTime();
    draw();
}

// Reset simulation timeline
function resetSimulation() {
    stopSimulation();
    state.currentTime = 0;
    state.currentSegmentIndex = 0;
    if (state.segments.length > 0) {
        const first = state.segments[0];
        state.toolX = first.start.x;
        state.toolY = first.start.y;
        state.toolZ = first.start.z;
    } else {
        state.toolX = 0;
        state.toolY = 0;
        state.toolZ = 0;
    }
    state.activeFeed = 0;
    state.activeSpindle = 0;
    setActiveGCodeLine(-1);
    
    updatePlaybackUI();
    updateCoordinatesUI();
    draw();
}

// Update coordinates boxes
function updateCoordinatesUI() {
    valX.innerText = state.toolX.toFixed(3);
    valY.innerText = state.toolY.toFixed(3);
    valZ.innerText = state.toolZ.toFixed(3);
    
    valFeed.innerText = state.activeFeed.toFixed(0);
    valSpindle.innerText = state.activeSpindle.toFixed(0);
    
    if (state.isPlaying) {
        if (state.segments[state.currentSegmentIndex]) {
            const segType = state.segments[state.currentSegmentIndex].type;
            boxFeed.className = "coordinate-box";
            if (segType === "cut" || segType === "plunge") {
                boxFeed.classList.add("active-feed");
            } else {
                boxFeed.classList.add("active-rapid");
            }
        }
    } else {
        boxFeed.className = "coordinate-box";
    }
}

// Update playback timeline components
function updatePlaybackUI() {
    const ratio = state.totalDuration > 0 ? (state.currentTime / state.totalDuration) : 0;
    progressSlider.value = Math.round(ratio * 1000);
    progressTimeLabel.innerText = `${formatTime(state.currentTime)} / ${formatTime(state.totalDuration)}`;
}

// Helper: Format seconds to MM:SS
function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const mStr = minutes.toString();
    const sStr = seconds.toString().padStart(2, '0');
    return `${mStr}:${sStr}`;
}

// Expose global method to load G-code directly from creator
window.loadGCodeDirectly = async function(name, content, switchTab = true, makeActive = true) {
    const fullPath = "generated_" + name;
    
    // Check if file already exists in state.files
    let fileObj = state.files.find(f => f.full_path === fullPath);
    
    if (fileObj) {
        // Update existing file content and size
        fileObj.content = content;
        fileObj.size = new Blob([content]).size;
        
        // Remove from loadedFiles to force re-parsing of the new content
        if (state.loadedFiles[fullPath]) {
            delete state.loadedFiles[fullPath];
        }
    } else {
        // Create new file object
        fileObj = {
            name: name,
            relative_path: "[Generated] " + name,
            full_path: fullPath,
            size: new Blob([content]).size,
            is_local: true,
            content: content
        };
        state.files.unshift(fileObj);
    }
    
    renderFileList();
    
    // Switch to simulator tab if requested
    if (switchTab && typeof switchAppTab === "function") {
        switchAppTab("simulator");
    }
    
    // Load and render
    await loadFile(fileObj, makeActive);
};

// Expose global methods to window
window.simResizeCanvas = resizeCanvas;
})();
