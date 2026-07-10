(function() {
// App State
let appState = {
    folderPath: "",
    files: [],
    detected: {},
    previewData: null,
    presets: [],
    
    // Canvas View Parameters
    zoom: 10,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    startX: 0,
    startY: 0
};

const canvas = document.getElementById("preview-canvas");
const ctx = canvas.getContext("2d");

// Resize canvas to fill its container
function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    draw();
}

window.addEventListener("resize", resizeCanvas);
document.addEventListener("DOMContentLoaded", () => {
    resizeCanvas();
    setupEventListeners();
    loadPresetsFromServer(); // Initial presets loading (will call loadSettingsFromServer internally)
});

// Setup Event Listeners
function setupEventListeners() {
    // Scan Folder
    document.getElementById("btn-scan").addEventListener("click", scanFolder);
    
    // Select Folder via Explorer
    document.getElementById("btn-select-folder").addEventListener("click", selectFolder);
    
    // Preview Paths
    document.getElementById("btn-preview").addEventListener("click", getPreview);
    
    // Generate G-code
    document.getElementById("btn-gcode").addEventListener("click", generateGCode);
    
    // Toggles for parameters
    document.getElementById("param-out-tabs").addEventListener("change", toggleTabsSettings);
    document.getElementById("param-use-pins").addEventListener("change", togglePinsSettings);
    document.getElementById("param-rub-clear-all").addEventListener("change", toggleRuboutSettings);
    
    // Enable/disable stages toggles
    const stages = ["iso", "rub", "out", "drill"];
    stages.forEach(st => {
        const toggle = document.getElementById(`param-enable-${st}`);
        if (toggle) {
            toggle.addEventListener("change", () => {
                toggleStageBody(st);
                if (appState.previewData) {
                    getPreview();
                }
            });
            // Initial toggle state
            toggleStageBody(st);
        }
    });
    
    // Preset dropdown changes
    stages.forEach(st => {
        const select = document.getElementById(`select-preset-${st}`);
        if (select) {
            select.addEventListener("change", () => applyPresetToStage(st, select.value));
        }
    });
    
    // Manage presets
    document.getElementById("select-manage-preset").addEventListener("change", (e) => loadPresetToManageForm(e.target.value));
    document.getElementById("btn-save-preset").addEventListener("click", savePreset);
    document.getElementById("btn-delete-preset").addEventListener("click", deletePreset);
    
    // Side Change triggers recalculation of defaults
    document.getElementById("select-side").addEventListener("change", () => {
        if (appState.previewData) {
            getPreview();
        }
    });
    
    // Canvas Mouse / Touch Events for Pan & Zoom
    canvas.addEventListener("mousedown", (e) => {
        appState.isDragging = true;
        appState.startX = e.clientX - appState.offsetX;
        appState.startY = e.clientY - appState.offsetY;
    });
    
    canvas.addEventListener("mousemove", (e) => {
        if (appState.isDragging) {
            appState.offsetX = e.clientX - appState.startX;
            appState.offsetY = e.clientY - appState.startY;
            draw();
        }
    });
    
    window.addEventListener("mouseup", () => {
        appState.isDragging = false;
    });
    
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        
        // Zoom center around mouse pointer
        const mouseX = e.clientX - canvas.getBoundingClientRect().left;
        const mouseY = e.clientY - canvas.getBoundingClientRect().top;
        
        // Convert screen coordinates to world coordinates before zoom
        const mx = canvas.width / 2;
        const my = canvas.height / 2;
        const bx = appState.previewData ? appState.previewData.bounds.width / 2 : 0;
        const by = appState.previewData ? appState.previewData.bounds.height / 2 : 0;
        
        const worldX = (mouseX - appState.offsetX - mx) / appState.zoom + bx;
        const worldY = -(mouseY - appState.offsetY - my) / appState.zoom + by;
        
        // Calculate new zoom
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        const newZoom = Math.min(Math.max(appState.zoom * zoomFactor, 1), 500);
        
        // Adjust offsets to keep mouse pointer at the same world coordinates
        appState.zoom = newZoom;
        appState.offsetX = mouseX - mx - (worldX - bx) * appState.zoom;
        appState.offsetY = mouseY - my + (worldY - by) * appState.zoom;
        
        draw();
    }, { passive: false });
    
    // Canvas controls
    document.getElementById("btn-zoom-in").addEventListener("click", () => {
        appState.zoom = Math.min(appState.zoom * 1.2, 500);
        draw();
    });
    
    document.getElementById("btn-zoom-out").addEventListener("click", () => {
        appState.zoom = Math.max(appState.zoom / 1.2, 1);
        draw();
    });
    
    document.getElementById("btn-zoom-fit").addEventListener("click", fitToScreen);
    
    // Layer checkboxes
    const checkboxes = ["layer-copper", "layer-outline", "layer-iso", "layer-rub", "layer-cut", "layer-drills", "layer-pins"];
    checkboxes.forEach(id => {
        document.getElementById(id).addEventListener("change", draw);
    });
    
    // Auto-save settings on input/change in sidebar
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) {
        sidebar.addEventListener("input", saveSettingsToServer);
        sidebar.addEventListener("change", saveSettingsToServer);
    }
}

// Switch tabs in sidebar
function switchTab(tabName) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
    
    document.getElementById(`tab-${tabName}-hdr`).classList.add("active");
    document.getElementById(`tab-${tabName}`).classList.add("active");
}

// Toggle display of tab settings based on checkbox
function toggleTabsSettings() {
    const tabsCheckbox = document.getElementById("param-out-tabs");
    const settingsDiv = document.getElementById("tabs-settings");
    settingsDiv.style.display = tabsCheckbox.checked ? "grid" : "none";
}

// Toggle display of pin settings based on checkbox
function togglePinsSettings() {
    const pinsCheckbox = document.getElementById("param-use-pins");
    const settingsDiv = document.getElementById("pins-settings");
    settingsDiv.style.display = pinsCheckbox.checked ? "grid" : "none";
}

// Toggle display of rubout width setting based on clear all checkbox
function toggleRuboutSettings() {
    const clearAllCheckbox = document.getElementById("param-rub-clear-all");
    const widthDiv = document.getElementById("group-rub-width");
    widthDiv.style.visibility = clearAllCheckbox.checked ? "hidden" : "visible";
}

// Update App Status bar
function updateStatus(text, type = "info") {
    const badge = document.getElementById("status-text");
    badge.innerText = text;
    if (type === "error") {
        badge.style.backgroundColor = "#da3637";
        document.getElementById("info-status").innerText = "Ошибка: " + text;
        document.getElementById("info-status").style.color = "#ff7b72";
    } else if (type === "loading") {
        badge.style.backgroundColor = "#9a6700";
        badge.innerHTML = `<span class="loader"></span> ${text}`;
        document.getElementById("info-status").innerText = text;
        document.getElementById("info-status").style.color = "var(--text-muted)";
    } else {
        badge.style.backgroundColor = "#238636";
        document.getElementById("info-status").innerText = text;
        document.getElementById("info-status").style.color = "var(--text-color)";
    }
}

// Fetch files from folder
async function scanFolder() {
    const path = document.getElementById("folder-path").value.trim();
    if (!path) {
        alert("Пожалуйста, введите путь к папке.");
        return;
    }
    
    updateStatus("Сканирование папки...", "loading");
    
    try {
        const response = await fetch("/api/creator/scan_folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder_path: path })
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Не удалось отсканировать папку.");
        }
        
        const data = await response.json();
        appState.files = data.files;
        appState.detected = data.detected;
        appState.folderPath = path;
        
        populateDropdowns();
        updateStatus("Папка отсканирована");
        
        // Auto load preview
        getPreview();
        
    } catch (e) {
        updateStatus(e.message, "error");
    }
}

// Fill select elements with scanned files
// Fill select elements with scanned files (re-implemented as multiselect dropdowns)
function populateDropdowns() {
    const dropdowns = {
        "outline-dropdown": "outline",
        "top-copper-dropdown": "top_copper",
        "bottom-copper-dropdown": "bottom_copper",
        "drill-dropdown": "drill"
    };
    
    for (const [dropdownId, key] of Object.entries(dropdowns)) {
        const container = document.getElementById(dropdownId);
        if (!container) continue;
        
        container.innerHTML = '';
        
        if (!appState.files || appState.files.length === 0) {
            container.innerHTML = '<div style="padding: 8px 12px; color: var(--text-muted); font-size: 0.85rem;">Файлы не найдены</div>';
            updateTriggerText(key, []);
            continue;
        }
        
        const detectedList = appState.detected[key] || [];
        
        appState.files.forEach(f => {
            const label = document.createElement("label");
            label.className = "multiselect-option";
            
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = f;
            checkbox.className = `checkbox-${key}`;
            
            
            // Check if f should be checked based on saved selection or auto-detected list
            const savedList = appState.savedSelectedFiles ? appState.savedSelectedFiles[key] : null;
            if (savedList && savedList.length > 0) {
                if (savedList.includes(f)) {
                    checkbox.checked = true;
                }
            } else {
                if (detectedList.includes(f) || (typeof detectedList === 'string' && detectedList === f)) {
                    checkbox.checked = true;
                }
            }
            
            checkbox.addEventListener("change", () => {
                const selected = getSelectedFiles(key);
                updateTriggerText(key, selected);
                
                // Update savedSelectedFiles in memory to stay in sync
                if (!appState.savedSelectedFiles) {
                    appState.savedSelectedFiles = {};
                }
                appState.savedSelectedFiles[key] = selected;
                
                // Save settings to server (which includes selected files)
                saveSettingsToServer();
                
                // Trigger preview when files change, if we already have preview
                if (appState.previewData) {
                    getPreview();
                }
            });
            
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(f));
            container.appendChild(label);
        });
        
        // Update trigger text initially
        const selected = getSelectedFiles(key);
        updateTriggerText(key, selected);
    }
}

// Get selected files for an operation type
function getSelectedFiles(key) {
    const checkboxes = document.querySelectorAll(`.checkbox-${key}`);
    const selected = [];
    checkboxes.forEach(cb => {
        if (cb.checked) {
            selected.push(cb.value);
        }
    });
    return selected;
}

// Update trigger button label
function updateTriggerText(key, selected) {
    let triggerId = "";
    if (key === "outline") triggerId = "outline-trigger";
    else if (key === "top_copper") triggerId = "top-copper-trigger";
    else if (key === "bottom_copper") triggerId = "bottom-copper-trigger";
    else if (key === "drill") triggerId = "drill-trigger";
    
    const trigger = document.getElementById(triggerId);
    if (!trigger) return;
    
    if (selected.length === 0) {
        trigger.textContent = "Выберите файлы...";
    } else if (selected.length === 1) {
        trigger.textContent = selected[0];
    } else {
        trigger.textContent = `Выбрано: ${selected.length} ф.`;
    }
}

// Toggle dropdown visibility
function toggleDropdown(name) {
    // Standardize key names
    let normName = name;
    if (name === "top_copper") normName = "top-copper";
    if (name === "bottom_copper") normName = "bottom-copper";
    
    const dropdown = document.getElementById(`${normName}-dropdown`);
    if (!dropdown) return;
    
    const isVisible = dropdown.style.display === "block";
    
    // Hide all first
    document.querySelectorAll(".multiselect-dropdown").forEach(dd => {
        dd.style.display = "none";
        dd.closest(".multiselect-container").classList.remove("open");
    });
    
    if (!isVisible) {
        dropdown.style.display = "block";
        dropdown.closest(".multiselect-container").classList.add("open");
    }
}

// Global click handler to close dropdowns when clicking outside
document.addEventListener("click", (e) => {
    if (!e.target.closest(".multiselect-container")) {
        document.querySelectorAll(".multiselect-dropdown").forEach(dd => {
            dd.style.display = "none";
            dd.closest(".multiselect-container").classList.remove("open");
        });
    }
});

// Collect milling parameters from inputs
function getMillingParams() {
    return {
        // Enable toggles
        "enable_isolation": document.getElementById("param-enable-iso").checked,
        "enable_rubout": document.getElementById("param-enable-rub").checked,
        "enable_outline": document.getElementById("param-enable-out").checked,
        "enable_drill": document.getElementById("param-enable-drill").checked,

        // Isolation
        "isolation_dia": parseFloat(document.getElementById("param-iso-dia").value),
        "isolation_passes": parseInt(document.getElementById("param-iso-passes").value),
        "isolation_overlap": parseFloat(document.getElementById("param-iso-overlap").value),
        "iso_rest_clearing": document.getElementById("param-iso-rest-clearing").checked,
        "iso_cut_z": parseFloat(document.getElementById("param-iso-cut-z").value),
        "iso_feed_xy": parseFloat(document.getElementById("param-iso-feed-xy").value),
        "iso_feed_z": parseFloat(document.getElementById("param-iso-feed-z").value),
        "iso_spindle": parseFloat(document.getElementById("param-iso-spindle").value),
        
        // Rubout
        "rubout_dia": parseFloat(document.getElementById("param-rub-dia").value),
        "rubout_clear_all": document.getElementById("param-rub-clear-all").checked,
        "rubout_width": parseFloat(document.getElementById("param-rub-width").value),
        "rubout_overlap": parseFloat(document.getElementById("param-rub-overlap").value),
        "rub_cut_z": parseFloat(document.getElementById("param-rub-cut-z").value),
        "rub_feed_xy": parseFloat(document.getElementById("param-rub-feed-xy").value),
        "rub_feed_z": parseFloat(document.getElementById("param-rub-feed-z").value),
        "rub_spindle": parseFloat(document.getElementById("param-rub-spindle").value),
        
        // Outline Cut
        "outline_dia": parseFloat(document.getElementById("param-out-dia").value),
        "outline_depth": parseFloat(document.getElementById("param-out-depth").value),
        "out_depth": parseFloat(document.getElementById("param-out-depth").value),
        "out_feed_xy": parseFloat(document.getElementById("param-out-feed-xy").value),
        "out_feed_z": parseFloat(document.getElementById("param-out-feed-z").value),
        "out_spindle": parseFloat(document.getElementById("param-out-spindle").value),
        "outline_passes": parseInt(document.getElementById("param-out-passes").value || "1"),
        
        "outline_tabs": document.getElementById("param-out-tabs").checked,
        "tab_count": parseInt(document.getElementById("param-tab-count").value),
        "tab_width": parseFloat(document.getElementById("param-tab-width").value),
        "tab_thickness": parseFloat(document.getElementById("param-tab-thick").value),
        
        // Drilling
        "drill_depth": parseFloat(document.getElementById("param-drill-depth").value),
        "drill_feed_z": parseFloat(document.getElementById("param-drill-feed-z").value),
        "drill_spindle": parseFloat(document.getElementById("param-drill-spindle").value),
        
        // Global machine params
        "safe_z": parseFloat(document.getElementById("param-safe-z").value),
        "feed_xy": parseFloat(document.getElementById("param-iso-feed-xy").value), 
        "feed_z": parseFloat(document.getElementById("param-iso-feed-z").value),
        "spindle_speed": parseFloat(document.getElementById("param-iso-spindle").value),
        "cut_z": parseFloat(document.getElementById("param-iso-cut-z").value),
        
        // Origin and pins
        "origin": document.getElementById("select-origin").value,
        "use_alignment_pins": document.getElementById("param-use-pins").checked,
        "alignment_pin_dia": parseFloat(document.getElementById("param-pin-dia").value),
        "alignment_pin_depth": parseFloat(document.getElementById("param-pin-depth").value),
        "alignment_pin_offset": parseFloat(document.getElementById("param-pin-offset").value)
    };
}

// Get path preview geometry from server
async function getPreview() {
    if (!appState.folderPath) {
        return;
    }
    
    const requestData = {
        folder_path: appState.folderPath,
        top_copper_files: getSelectedFiles("top_copper"),
        bottom_copper_files: getSelectedFiles("bottom_copper"),
        outline_files: getSelectedFiles("outline"),
        drill_files: getSelectedFiles("drill"),
        side: document.getElementById("select-side").value,
        params: getMillingParams()
    };
    
    const activeCopper = requestData.side === "top" ? requestData.top_copper_files : requestData.bottom_copper_files;
    if (requestData.outline_files.length === 0 || activeCopper.length === 0) {
        updateStatus("Выберите файлы меди и контура", "error");
        return;
    }
    
    updateStatus("Расчёт траекторий...", "loading");
    
    try {
        const response = await fetch("/api/creator/preview_paths", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Ошибка построения траекторий.");
        }
        
        appState.previewData = await response.json();
        
        // Show board dimensions
        const bounds = appState.previewData.bounds;
        document.getElementById("info-dimensions").innerText = `${bounds.width.toFixed(2)} x ${bounds.height.toFixed(2)} мм`;
        
        updateStatus("Траектории рассчитаны");
        
        // Fit view to screen on first load
        fitToScreen();
        
    } catch (e) {
        updateStatus(e.message, "error");
    }
}

// Fit Board view inside Canvas boundaries
function fitToScreen() {
    if (!appState.previewData) {
        return;
    }
    
    const bounds = appState.previewData.bounds;
    const padding = 40; // pixels
    
    const scaleX = (canvas.width - padding * 2) > 0 ? (canvas.width - padding * 2) / bounds.width : 1.0;
    const scaleY = (canvas.height - padding * 2) > 0 ? (canvas.height - padding * 2) / bounds.height : 1.0;
    
    appState.zoom = Math.min(scaleX, scaleY);
    if (appState.zoom <= 0) {
        appState.zoom = 1.0;
    }
    appState.offsetX = 0;
    appState.offsetY = 0;
    
    draw();
}

// Mapping coordinates to screen coordinates
function toScreen(x, y) {
    const mx = canvas.width / 2;
    const my = canvas.height / 2;
    
    const bx = appState.previewData ? appState.previewData.bounds.width / 2 : 0;
    const by = appState.previewData ? appState.previewData.bounds.height / 2 : 0;
    
    const screenX = mx + appState.offsetX + (x - bx) * appState.zoom;
    // Invert Y axis
    const screenY = my + appState.offsetY - (y - by) * appState.zoom;
    
    return { x: screenX, y: screenY };
}

// Draw geometries on Canvas
function draw() {
    // Clear canvas
    ctx.fillStyle = document.body.classList.contains("light-theme") ? "#ffffff" : "#0b0c10";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (!appState.previewData) {
        // Draw grid placeholder
        drawGrid();
        return;
    }
    
    // Draw Grid
    drawGrid();
    
    const isLight = document.body.classList.contains("light-theme");
    const colors = {
        copperFill: isLight ? "rgba(9, 105, 218, 0.22)" : "rgba(31, 111, 235, 0.35)",
        copperStroke: isLight ? "rgba(9, 105, 218, 0.65)" : "rgba(31, 111, 235, 0.8)",
        outlineFill: isLight ? "rgba(177, 122, 2, 0.05)" : "rgba(210, 153, 34, 0.08)",
        outlineStroke: isLight ? "rgba(177, 122, 2, 0.6)" : "rgba(210, 153, 34, 0.7)",
        rubout: isLight ? "rgba(130, 80, 220, 0.8)" : "rgba(171, 125, 246, 0.65)",
        isolation: isLight ? "rgba(26, 140, 46, 0.9)" : "rgba(57, 211, 83, 0.9)",
        outlineCut: isLight ? "rgba(177, 122, 2, 0.9)" : "rgba(210, 153, 34, 0.9)",
        drills: isLight ? "rgba(207, 34, 46, 0.8)" : "rgba(255, 123, 114, 0.8)",
        pins: isLight ? "rgba(87, 96, 106, 0.85)" : "rgba(240, 246, 252, 0.85)"
    };
    
    // Get checkbox layers
    const showCopper = document.getElementById("layer-copper").checked;
    const showOutline = document.getElementById("layer-outline").checked;
    const showIso = document.getElementById("layer-iso").checked;
    const showRub = document.getElementById("layer-rub").checked;
    const showCut = document.getElementById("layer-cut").checked;
    const showDrills = document.getElementById("layer-drills").checked;
    const showPins = document.getElementById("layer-pins").checked;
    
    // 1. Draw Copper Layer (solid shapes)
    if (showCopper && appState.previewData.copper) {
        ctx.fillStyle = colors.copperFill;
        ctx.strokeStyle = colors.copperStroke;
        ctx.lineWidth = 1.0;
        
        appState.previewData.copper.forEach(path => {
            if (path.length < 2) return;
            ctx.beginPath();
            const start = toScreen(path[0][0], path[0][1]);
            ctx.moveTo(start.x, start.y);
            for (let i = 1; i < path.length; i++) {
                const pt = toScreen(path[i][0], path[i][1]);
                ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        });
    }
    
    // 2. Draw board outline
    if (showOutline && appState.previewData.outline) {
        ctx.fillStyle = colors.outlineFill;
        ctx.strokeStyle = colors.outlineStroke;
        ctx.lineWidth = 2.0;
        
        appState.previewData.outline.forEach(path => {
            if (path.length < 2) return;
            ctx.beginPath();
            const start = toScreen(path[0][0], path[0][1]);
            ctx.moveTo(start.x, start.y);
            for (let i = 1; i < path.length; i++) {
                const pt = toScreen(path[i][0], path[i][1]);
                ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        });
    }
    
    // 3. Draw Rubout paths (clearing)
    if (showRub && appState.previewData.toolpaths.rubout) {
        ctx.strokeStyle = colors.rubout;
        ctx.lineWidth = 1.2;
        appState.previewData.toolpaths.rubout.forEach(path => {
            drawPath(path);
        });
    }
    
    // 4. Draw Isolation paths
    if (showIso && appState.previewData.toolpaths.isolation) {
        ctx.strokeStyle = colors.isolation;
        ctx.lineWidth = 1.5;
        appState.previewData.toolpaths.isolation.forEach(path => {
            drawPath(path);
        });
    }
    
    // 5. Draw Outline Cut toolpath
    if (showCut && appState.previewData.toolpaths.outline) {
        ctx.strokeStyle = colors.outlineCut;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([5, 5]); // dashed to distinguish
        appState.previewData.toolpaths.outline.forEach(path => {
            drawPath(path);
        });
        ctx.setLineDash([]); // reset dash
    }
    
    // 6. Draw Drills (circles + crosshairs)
    if (showDrills && appState.previewData.drills) {
        appState.previewData.drills.forEach(drill => {
            const pos = toScreen(drill.x, drill.y);
            const radius = (drill.diameter / 2.0) * appState.zoom;
            
            // Draw circle outline
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = colors.drills;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            // Draw crosshair
            ctx.beginPath();
            ctx.moveTo(pos.x - radius - 2, pos.y);
            ctx.lineTo(pos.x + radius + 2, pos.y);
            ctx.moveTo(pos.x, pos.y - radius - 2);
            ctx.lineTo(pos.x, pos.y + radius + 2);
            ctx.lineWidth = 1.0;
            ctx.stroke();
        });
    }
    
    // 7. Draw Alignment Pins
    if (showPins && appState.previewData.toolpaths.alignment_pins) {
        ctx.strokeStyle = colors.pins;
        ctx.lineWidth = 1.5;
        appState.previewData.toolpaths.alignment_pins.forEach(path => {
            drawPath(path);
        });
    }
}

// Draw a single open path
function drawPath(path) {
    if (path.length < 2) return;
    ctx.beginPath();
    const start = toScreen(path[0][0], path[0][1]);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < path.length; i++) {
        const pt = toScreen(path[i][0], path[i][1]);
        ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
}

// Draw coordinates grid
function drawGrid() {
    const gridSize = 10; // mm
    const pxSize = gridSize * appState.zoom;
    
    if (pxSize < 5) return; // avoid drawing infinite grid lines
    
    ctx.strokeStyle = document.body.classList.contains("light-theme") ? "rgba(0, 0, 0, 0.15)" : "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = document.body.classList.contains("light-theme") ? 0.8 : 0.5;
    
    // Calculate grid range based on board bounds or canvas size
    const bounds = appState.previewData ? appState.previewData.bounds : { width: 100, height: 100 };
    
    const minX = -100;
    const maxX = bounds.width + 100;
    const minY = -100;
    const maxY = bounds.height + 100;
    
    // Vertical grid lines
    for (let x = Math.ceil(minX / gridSize) * gridSize; x <= maxX; x += gridSize) {
        const p1 = toScreen(x, minY);
        const p2 = toScreen(x, maxY);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    }
    
    // Horizontal grid lines
    for (let y = Math.ceil(minY / gridSize) * gridSize; y <= maxY; y += gridSize) {
        const p1 = toScreen(minX, y);
        const p2 = toScreen(maxX, y);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    }
}

// Generate G-code files on server
async function generateGCode() {
    if (!appState.folderPath) {
        alert("Сначала отсканируйте папку и выберите слои.");
        return;
    }
    
    const requestData = {
        folder_path: appState.folderPath,
        top_copper_files: getSelectedFiles("top_copper"),
        bottom_copper_files: getSelectedFiles("bottom_copper"),
        outline_files: getSelectedFiles("outline"),
        drill_files: getSelectedFiles("drill"),
        side: document.getElementById("select-side").value,
        params: getMillingParams()
    };
    
    const activeCopper = requestData.side === "top" ? requestData.top_copper_files : requestData.bottom_copper_files;
    if (requestData.outline_files.length === 0 || activeCopper.length === 0) {
        alert("Пожалуйста, убедитесь, что файлы меди и контура выбраны.");
        return;
    }
    
    updateStatus("Генерация G-кода...", "loading");
    
    try {
        const response = await fetch("/api/creator/generate_gcode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Ошибка генерации файлов G-кода.");
        }
        
        const data = await response.json();
        
        // Render generated files
        renderOutputList(data.files, data.output_dir);
        
        // Automatically transfer all generated files to simulator
        if (typeof window.loadGCodeDirectly === "function") {
            for (let i = 0; i < data.files.length; i++) {
                const file = data.files[i];
                // Make the first generated file (e.g. isolation.gcode) active, others visible but inactive
                const makeActive = (i === 0);
                await window.loadGCodeDirectly(file.name, file.content, false, makeActive);
            }
        }
        
        updateStatus("G-код успешно сгенерирован");
        
        // Show where the files are saved
        document.getElementById("info-file-location").innerHTML = `Сохранено в: <span style="color:var(--text-color)">${data.output_dir}</span>`;
        
    } catch (e) {
        updateStatus(e.message, "error");
    }
}

// Render files list in UI with click to download capability
function renderOutputList(files, outputDir) {
    const list = document.getElementById("output-files");
    list.innerHTML = `<div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">Сгенерированные файлы G-кода:</div>`;
    
    files.forEach(file => {
        const item = document.createElement("div");
        item.className = "output-item";
        
        const kbSize = (file.size / 1024).toFixed(1);
        
        item.innerHTML = `
            <div class="output-item-info">
                <span class="output-item-name">${file.name}</span>
                <span class="output-item-size">${kbSize} KB</span>
            </div>
            <div class="output-item-action">
                <span class="download-link" onclick="downloadFile('${file.name}', \`${escapeJS(file.content)}\`)">Скачать</span>
                <span class="download-link simulate-link" style="margin-left: 12px; color: var(--accent-hover);" onclick="window.loadGCodeDirectly('${file.name}', \`${escapeJS(file.content)}\`)">Симулировать</span>
            </div>
        `;
        list.appendChild(item);
    });
}

// Utility to escape quotes for inline templates
function escapeJS(str) {
    return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

// Trigger client side download of text G-code
function downloadFile(filename, content) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Toggle stage body styling based on checkbox
function toggleStageBody(stage) {
    const toggle = document.getElementById(`param-enable-${stage}`);
    const body = document.getElementById(`stage-${stage}-body`);
    if (toggle && body) {
        if (toggle.checked) {
            body.classList.remove("disabled");
        } else {
            body.classList.add("disabled");
        }
    }
    
    // Disable/fade out Rest Milling checkbox if Rubout is disabled
    if (stage === "rub") {
        const restCheckbox = document.getElementById("param-iso-rest-clearing");
        if (restCheckbox) {
            const rubActive = toggle ? toggle.checked : false;
            restCheckbox.disabled = !rubActive;
            
            const label = restCheckbox.nextElementSibling;
            if (label) {
                if (!rubActive) {
                    label.style.opacity = "0.5";
                    label.style.cursor = "not-allowed";
                } else {
                    label.style.opacity = "1.0";
                    label.style.cursor = "pointer";
                }
            }
        }
    }
}

// Select folder via native Windows Explorer
async function selectFolder() {
    updateStatus("Открытие диалога...", "loading");
    try {
        const response = await fetch("/api/creator/select_folder", { method: "POST" });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Не удалось выбрать папку.");
        }
        const data = await response.json();
        if (data.folder_path) {
            document.getElementById("folder-path").value = data.folder_path;
            saveSettingsToServer();
            scanFolder(); // Auto-scan folder
        } else {
            updateStatus("Выбор отменен");
        }
    } catch (e) {
        updateStatus(e.message, "error");
    }
}

// Fetch all presets from API
async function loadPresetsFromServer() {
    try {
        const response = await fetch("/api/creator/presets");
        if (response.ok) {
            appState.presets = await response.json();
            populatePresetsDropdowns();
        }
    } catch (e) {
        console.error("Error loading presets:", e);
    }
    
    // Always attempt to load user settings after presets
    await loadSettingsFromServer();
}

// Populate preset dropdowns in params and presets tabs
function populatePresetsDropdowns() {
    // 1. Stage dropdowns
    const stages = ["iso", "rub", "out", "drill"];
    stages.forEach(st => {
        const select = document.getElementById(`select-preset-${st}`);
        if (select) {
            select.innerHTML = '<option value="">-- Выберите пресет --</option>';
            appState.presets.forEach(p => {
                const opt = document.createElement("option");
                opt.value = p.id;
                opt.textContent = p.name;
                select.appendChild(opt);
            });
        }
    });
    
    // 2. Management dropdown
    const manageSelect = document.getElementById("select-manage-preset");
    if (manageSelect) {
        manageSelect.innerHTML = '<option value="new">-- Создать новый пресет --</option>';
        appState.presets.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            manageSelect.appendChild(opt);
        });
    }
}

// Apply selected preset values to specific stage input fields
function applyPresetToStage(stage, presetId) {
    if (!presetId) return;
    const preset = appState.presets.find(p => p.id === presetId);
    if (!preset) return;
    
    if (stage === "iso") {
        document.getElementById("param-iso-dia").value = preset.diameter;
        document.getElementById("param-iso-feed-xy").value = preset.feed_xy;
        document.getElementById("param-iso-feed-z").value = preset.feed_z;
        document.getElementById("param-iso-spindle").value = preset.spindle;
    } else if (stage === "rub") {
        document.getElementById("param-rub-dia").value = preset.diameter;
        document.getElementById("param-rub-feed-xy").value = preset.feed_xy;
        document.getElementById("param-rub-feed-z").value = preset.feed_z;
        document.getElementById("param-rub-spindle").value = preset.spindle;
    } else if (stage === "out") {
        document.getElementById("param-out-dia").value = preset.diameter;
        document.getElementById("param-out-feed-xy").value = preset.feed_xy;
        document.getElementById("param-out-feed-z").value = preset.feed_z;
        document.getElementById("param-out-spindle").value = preset.spindle;
    } else if (stage === "drill") {
        document.getElementById("param-drill-feed-z").value = preset.feed_z;
        document.getElementById("param-drill-spindle").value = preset.spindle;
    }
    
    // Update preview if active
    saveSettingsToServer();
    if (appState.previewData) {
        getPreview();
    }
}

// Fill management form with selected preset details
function loadPresetToManageForm(presetId) {
    const btnDelete = document.getElementById("btn-delete-preset");
    if (presetId === "new") {
        document.getElementById("preset-name").value = "";
        document.getElementById("preset-dia").value = 1.0;
        document.getElementById("preset-feed-xy").value = 400;
        document.getElementById("preset-feed-z").value = 100;
        document.getElementById("preset-spindle").value = 10000;
        btnDelete.style.display = "none";
    } else {
        const preset = appState.presets.find(p => p.id === presetId);
        if (!preset) return;
        document.getElementById("preset-name").value = preset.name;
        document.getElementById("preset-dia").value = preset.diameter;
        document.getElementById("preset-feed-xy").value = preset.feed_xy;
        document.getElementById("preset-feed-z").value = preset.feed_z;
        document.getElementById("preset-spindle").value = preset.spindle;
        btnDelete.style.display = "block";
    }
}

// Save/Update preset via API
async function savePreset() {
    const manageSelect = document.getElementById("select-manage-preset");
    const name = document.getElementById("preset-name").value.trim();
    if (!name) {
        alert("Пожалуйста, введите название пресета.");
        return;
    }
    
    let id = manageSelect.value;
    if (id === "new") {
        id = "preset_" + Math.random().toString(36).substr(2, 9);
    }
    
    const presetData = {
        id: id,
        name: name,
        diameter: parseFloat(document.getElementById("preset-dia").value),
        feed_xy: parseFloat(document.getElementById("preset-feed-xy").value),
        feed_z: parseFloat(document.getElementById("preset-feed-z").value),
        spindle: parseFloat(document.getElementById("preset-spindle").value)
    };
    
    try {
        const response = await fetch("/api/creator/presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(presetData)
        });
        
        if (response.ok) {
            const data = await response.json();
            appState.presets = data.presets;
            populatePresetsDropdowns();
            document.getElementById("select-manage-preset").value = id;
            loadPresetToManageForm(id);
            alert("Пресет успешно сохранен!");
        } else {
            alert("Ошибка сохранения пресета.");
        }
    } catch (e) {
        alert("Ошибка сети при сохранении пресета: " + e.message);
    }
}

// Delete preset via API
async function deletePreset() {
    const id = document.getElementById("select-manage-preset").value;
    if (id === "new") return;
    
    if (!confirm("Вы уверены, что хотите удалить этот пресет?")) {
        return;
    }
    
    try {
        const response = await fetch(`/api/creator/presets/${id}`, {
            method: "DELETE"
        });
        
        if (response.ok) {
            const data = await response.json();
            appState.presets = data.presets;
            populatePresetsDropdowns();
            document.getElementById("select-manage-preset").value = "new";
            loadPresetToManageForm("new");
            alert("Пресет удален!");
        } else {
            alert("Ошибка удаления пресета.");
        }
    } catch (e) {
        alert("Ошибка сети при удалении пресета: " + e.message);
    }
}

// Settings persistence helpers (saved on server settings.json)
const SETTINGS_KEYS = [
    "folder-path", "select-side", "select-origin",
    "param-enable-iso", "param-enable-rub", "param-enable-out", "param-enable-drill",
    "select-preset-iso", "param-iso-dia", "param-iso-cut-z", "param-iso-feed-xy", "param-iso-feed-z", "param-iso-spindle", "param-iso-passes", "param-iso-overlap", "param-iso-rest-clearing",
    "select-preset-rub", "param-rub-clear-all", "param-rub-dia", "param-rub-cut-z", "param-rub-feed-xy", "param-rub-feed-z", "param-rub-spindle", "param-rub-width", "param-rub-overlap",
    "select-preset-out", "param-out-dia", "param-out-depth", "param-out-feed-xy", "param-out-feed-z", "param-out-spindle", "param-out-passes", "param-out-tabs", "param-tab-count", "param-tab-width", "param-tab-thick",
    "select-preset-drill", "param-drill-depth", "param-drill-feed-z", "param-drill-spindle",
    "param-safe-z",
    "param-use-pins", "param-pin-dia", "param-pin-depth", "param-pin-offset"
];

async function saveSettingsToServer() {
    const params = {};
    SETTINGS_KEYS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === "checkbox") {
            params[id] = el.checked;
        } else {
            params[id] = el.value;
        }
    });
    
    const selectedFiles = {
        outline: getSelectedFiles("outline"),
        top_copper: getSelectedFiles("top_copper"),
        bottom_copper: getSelectedFiles("bottom_copper"),
        drill: getSelectedFiles("drill")
    };
    
    const payload = {
        params: params,
        selected_files: selectedFiles
    };
    
    try {
        await fetch("/api/creator/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.error("Error saving settings to server:", e);
    }
}

async function loadSettingsFromServer() {
    try {
        const response = await fetch("/api/creator/settings");
        if (!response.ok) return;
        const payload = await response.json();
        if (!payload || !payload.params) return;
        
        const settings = payload.params;
        appState.savedSelectedFiles = payload.selected_files || {};
        
        SETTINGS_KEYS.forEach(id => {
            if (settings[id] !== undefined) {
                const el = document.getElementById(id);
                if (!el) return;
                if (el.type === "checkbox") {
                    el.checked = settings[id];
                } else {
                    el.value = settings[id];
                }
            }
        });
        
        // Trigger visibility and enable/disable states updates
        const stages = ["iso", "rub", "out", "drill"];
        stages.forEach(st => toggleStageBody(st));
        toggleTabsSettings();
        togglePinsSettings();
        toggleRuboutSettings();
        
        // Auto-scan folder if path was loaded
        const path = document.getElementById("folder-path").value.trim();
        if (path) {
            await scanFolder();
        }
    } catch (e) {
        console.error("Error loading settings from server:", e);
    }
}

// Start heartbeat loop to keep backend alive (every 3 seconds)
setInterval(async () => {
    try {
        await fetch("/api/heartbeat", { method: "POST" });
    } catch (e) {
        // Server might be shutting down
    }
}, 3000);

// Instantly ping on visibility change to keep backend updated
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
    }
});

// Shutdown server instantly when tab/window is closed
window.addEventListener("beforeunload", () => {
    navigator.sendBeacon("/api/shutdown");
});

// Expose global methods to window
window.creatorResizeCanvas = resizeCanvas;
window.switchTab = switchTab;
window.toggleDropdown = toggleDropdown;
window.downloadFile = downloadFile;
})();
