import os
import re
import sys
import webbrowser
import json
import subprocess
import time
import threading
from threading import Timer
from typing import Dict, Any, List

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from gerber_parser import GerberParser, ExcellonParser
from gcode_generator import GCodeGenerator
from simulator_router import router as simulator_router, register_dialog_active_setter

# Presets Management
if getattr(sys, 'frozen', False):
    PRESETS_FILE = os.path.join(os.path.dirname(sys.executable), "presets.json")
else:
    PRESETS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "presets.json")

if getattr(sys, 'frozen', False):
    SETTINGS_FILE = os.path.join(os.path.dirname(sys.executable), "settings.json")
else:
    SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "settings.json")

DEFAULT_PRESETS = [
    {"id": "grave_02", "name": "Гравёр V-образный 0.2мм (30°)", "diameter": 0.2, "feed_xy": 150.0, "feed_z": 50.0, "spindle": 12000.0},
    {"id": "mill_10", "name": "Концевая фреза 1.0мм", "diameter": 1.0, "feed_xy": 400.0, "feed_z": 100.0, "spindle": 10000.0},
    {"id": "mill_20", "name": "Концевая фреза 2.0мм", "diameter": 2.0, "feed_xy": 500.0, "feed_z": 150.0, "spindle": 10000.0},
    {"id": "drill_08", "name": "Сверло 0.8мм", "diameter": 0.8, "feed_xy": 0.0, "feed_z": 120.0, "spindle": 12000.0}
]

def load_presets():
    if not os.path.exists(PRESETS_FILE):
        try:
            with open(PRESETS_FILE, 'w', encoding='utf-8') as f:
                json.dump(DEFAULT_PRESETS, f, indent=2, ensure_ascii=False)
            return DEFAULT_PRESETS
        except Exception:
            return DEFAULT_PRESETS
    try:
        with open(PRESETS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return DEFAULT_PRESETS

def save_presets(presets):
    try:
        with open(PRESETS_FILE, 'w', encoding='utf-8') as f:
            json.dump(presets, f, indent=2, ensure_ascii=False)
        return True
    except Exception:
        return False

# Pydantic Model for Presets
class Preset(BaseModel):
    id: str
    name: str
    diameter: float
    feed_xy: float
    feed_z: float
    spindle: float

app = FastAPI(title="PCB Toolbox")

last_heartbeat_time = time.time()
dialog_active = False

def set_dialog_active_state(active: bool):
    global dialog_active
    dialog_active = active

register_dialog_active_setter(set_dialog_active_state)

def monitor_heartbeat():
    global last_heartbeat_time, dialog_active
    # Wait 10 seconds on startup for the browser tab to open and send its first heartbeat
    time.sleep(10)
    while True:
        time.sleep(5)
        elapsed = time.time() - last_heartbeat_time
        if elapsed > 300.0 and not dialog_active:
            print("No heartbeat received for 5 minutes. Shutting down server...")
            os._exit(0)

@app.on_event("startup")
def startup_event():
    # Start daemon thread to monitor heartbeats
    threading.Thread(target=monitor_heartbeat, daemon=True).start()

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request Models
class ScanFolderRequest(BaseModel):
    folder_path: str

class PreviewPathsRequest(BaseModel):
    folder_path: str
    top_copper_files: List[str] = []
    bottom_copper_files: List[str] = []
    outline_files: List[str] = []
    drill_files: List[str] = []
    side: str = "top"  # "top" or "bottom"
    params: Dict[str, Any]

class GenerateGCodeRequest(BaseModel):
    folder_path: str
    top_copper_files: List[str] = []
    bottom_copper_files: List[str] = []
    outline_files: List[str] = []
    drill_files: List[str] = []
    side: str = "top"
    params: Dict[str, Any]

# Helper to extract paths for response JSON
def geom_to_paths(geom) -> List[List[List[float]]]:
    paths = []
    if geom.is_empty:
        return paths
    if geom.geom_type == 'Polygon':
        paths.append([list(pt) for pt in geom.exterior.coords])
        for interior in geom.interiors:
            paths.append([list(pt) for pt in interior.coords])
    elif geom.geom_type == 'MultiPolygon':
        for poly in geom.geoms:
            paths.extend(geom_to_paths(poly))
    return paths

@app.post("/api/creator/select_folder")
def select_folder():
    global dialog_active
    dialog_active = True
    try:
        # Determine the executable to run
        if getattr(sys, 'frozen', False):
            # In compiled EXE mode, run the EXE itself
            cmd = [sys.executable, "--pick-folder-gerber"]
        else:
            # In dev mode, run python with main.py
            cmd = [sys.executable, os.path.abspath(__file__), "--pick-folder-gerber"]
            
        # Run subprocess silently without flashing cmd console
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            startupinfo=startupinfo
        )
        stdout, stderr = proc.communicate()
        
        folder_path = stdout.strip()
        if folder_path:
            folder_path = os.path.normpath(folder_path)
            
        return {"folder_path": folder_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Не удалось открыть диалог: {str(e)}")
    finally:
        dialog_active = False

@app.post("/api/heartbeat")
def heartbeat():
    global last_heartbeat_time
    last_heartbeat_time = time.time()
    return {"status": "ok"}

@app.post("/api/shutdown")
def shutdown():
    print("Shutdown request received from browser. Exiting...")
    def target():
        time.sleep(0.2)
        os._exit(0)
    threading.Thread(target=target, daemon=True).start()
    return {"status": "ok"}

class SettingsPayload(BaseModel):
    params: Dict[str, Any]
    selected_files: Dict[str, List[str]]

@app.get("/api/creator/settings")
def get_settings():
    if not os.path.exists(SETTINGS_FILE):
        return {}
    try:
        with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Migrate old settings structure if present at root level
        if "creator" not in data and ("params" in data or "selected_files" in data):
            creator_data = {
                "params": data.pop("params", {}),
                "selected_files": data.pop("selected_files", {})
            }
            data["creator"] = creator_data
            try:
                with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
            except Exception:
                pass
                
        return data.get("creator", {})
    except Exception:
        return {}

@app.post("/api/creator/settings")
def save_settings(payload: SettingsPayload):
    try:
        data = {}
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except Exception:
                pass
        
        data["creator"] = payload.model_dump()
        
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Не удалось сохранить настройки: {str(e)}")

@app.get("/api/creator/presets")
def get_presets():
    return load_presets()

@app.post("/api/creator/presets")
def save_preset(preset: Preset):
    presets = load_presets()
    updated = False
    for i, p in enumerate(presets):
        if p["id"] == preset.id:
            presets[i] = preset.model_dump()
            updated = True
            break
    if not updated:
        presets.append(preset.model_dump())
    
    if save_presets(presets):
        return {"status": "ok", "presets": presets}
    else:
        raise HTTPException(status_code=500, detail="Не удалось сохранить пресет.")

@app.delete("/api/creator/presets/{preset_id}")
def delete_preset(preset_id: str):
    presets = load_presets()
    new_presets = [p for p in presets if p["id"] != preset_id]
    if len(new_presets) == len(presets):
        raise HTTPException(status_code=404, detail="Пресет не найден.")
    if save_presets(new_presets):
        return {"status": "ok", "presets": new_presets}
    else:
        raise HTTPException(status_code=500, detail="Не удалось удалить пресет.")

@app.post("/api/creator/scan_folder")
def scan_folder(request: ScanFolderRequest):
    path = request.folder_path.strip()
    if not os.path.exists(path):
        raise HTTPException(status_code=400, detail="Указанная папка не существует.")
    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail="Указанный путь не является папкой.")

    files = []
    try:
        for f in os.listdir(path):
            if os.path.isfile(os.path.join(path, f)):
                files.append(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка чтения папки: {str(e)}")

    # Detect default files
    detected = {
        "top_copper": [],
        "bottom_copper": [],
        "outline": [],
        "drill": []
    }

    for f in files:
        f_lower = f.lower()
        if f_lower.endswith('.gtl') or ('top' in f_lower and 'copper' in f_lower):
            detected["top_copper"].append(f)
        elif f_lower.endswith('.gbl') or ('bottom' in f_lower and 'copper' in f_lower):
            detected["bottom_copper"].append(f)
        elif f_lower.endswith('.gko') or f_lower.endswith('.gm1') or 'outline' in f_lower or 'board' in f_lower:
            detected["outline"].append(f)

    # Drill files detection (prioritizing DRL over TXT)
    drl_files = [f for f in files if f.lower().endswith('.drl')]
    txt_drill_files = [f for f in files if f.lower().endswith('.txt') and 'drill' in f.lower()]
    other_drill_files = [f for f in files if 'drill' in f.lower() and f not in drl_files and f not in txt_drill_files]
    
    if drl_files:
        detected["drill"] = drl_files
    elif txt_drill_files:
        detected["drill"] = txt_drill_files
    elif other_drill_files:
        detected["drill"] = [other_drill_files[0]]

    return {
        "files": files,
        "detected": detected
    }

@app.post("/api/creator/preview_paths")
def preview_paths(request: PreviewPathsRequest):
    folder = request.folder_path
    
    # 1. Resolve file paths
    outline_paths = [os.path.join(folder, f) for f in request.outline_files if f]
    copper_files = request.top_copper_files if request.side == "top" else request.bottom_copper_files
    copper_paths = [os.path.join(folder, f) for f in copper_files if f]
    drill_paths = [os.path.join(folder, f) for f in request.drill_files if f]

    if not outline_paths or not all(os.path.exists(p) for p in outline_paths):
        raise HTTPException(status_code=400, detail="Необходимо выбрать корректный файл(ы) контура платы (.GKO).")
    if not copper_paths or not all(os.path.exists(p) for p in copper_paths):
        raise HTTPException(status_code=400, detail="Необходимо выбрать корректный файл(ы) медного слоя (.GTL/.GBL).")

    try:
        # 2. Parse geometries
        outline_geom = GerberParser().parse_outline_multiple(outline_paths)
        copper_geom = GerberParser().parse_copper_multiple(copper_paths)
        
        drills = []
        if drill_paths:
            drills = ExcellonParser().parse_multiple(drill_paths)

        # 3. Calculate board size and centering parameters
        minx, miny, maxx, maxy = outline_geom.bounds
        width = maxx - minx
        height = maxy - miny
        cx = (minx + maxx) / 2.0
        cy = (miny + maxy) / 2.0

        # Calculate Shift parameters for preview mirroring & origin shifting
        # Center everything at 0,0, apply mirror, then shift to final origin
        generator = GCodeGenerator(request.params)
        
        # Center and translate geometries
        centered_copper = generator._shift_geometry(copper_geom, -cx, -cy)
        centered_outline = generator._shift_geometry(outline_geom, -cx, -cy)
        centered_drills = []
        for d in drills:
            centered_drills.append({
                'x': d['x'] - cx,
                'y': d['y'] - cy,
                'diameter': d['diameter']
            })

        # Apply mirroring
        if request.side == "bottom":
            centered_copper = generator._mirror_geometry(centered_copper)
            centered_outline = generator._mirror_geometry(centered_outline)
            for d in centered_drills:
                d['x'] = -d['x']

        # Apply final origin
        dx, dy = 0.0, 0.0
        if request.params.get("origin", "bottom_left") == "bottom_left":
            dx, dy = width / 2.0, height / 2.0

        final_copper = generator._shift_geometry(centered_copper, dx, dy)
        final_outline = generator._shift_geometry(centered_outline, dx, dy)
        final_drills = []
        for d in centered_drills:
            final_drills.append({
                'x': d['x'] + dx,
                'y': d['y'] + dy,
                'diameter': d['diameter']
            })

        # Resolve board polygon for intersection operations
        from shapely.geometry import MultiPolygon, Polygon
        if isinstance(final_outline, MultiPolygon):
            board_poly = max(final_outline.geoms, key=lambda p: p.area)
        else:
            board_poly = final_outline

        # 4. Generate toolpaths
        iso_paths = []
        if request.params.get("enable_isolation", True):
            iso_paths = generator._generate_isolation_paths(final_copper, board_poly)
            if request.params.get("iso_rest_clearing", False):
                rest_paths = generator._generate_rest_clearing_paths(final_copper, board_poly)
                if rest_paths:
                    iso_paths.extend(rest_paths)
            
        rub_paths = []
        if request.params.get("enable_rubout", True) and request.params.get("rubout_width", 0.0) > 0:
            rub_paths = generator._generate_rubout_paths(final_copper, board_poly)
        
        # Outline cut path
        out_paths = []
        if request.params.get("enable_outline", True):
            cut_dia = request.params["outline_dia"]
            outline_toolpath_geom = board_poly.buffer(cut_dia / 2.0)
            out_paths = generator._extract_paths(outline_toolpath_geom)

        # Drilling points
        drill_paths = []
        if request.params.get("enable_drill", True):
            for drill in final_drills:
                # We can represent drills as small crosshairs or circles for toolpath preview
                r = drill['diameter'] / 2.0
                x, y = drill['x'], drill['y']
                drill_paths.append([[x - r, y], [x + r, y]])
                drill_paths.append([[x, y - r], [x, y + r]])

        # Reference pins paths (if enabled)
        pin_paths = []
        if request.params.get("use_alignment_pins", True):
            pin_dia = request.params.get("alignment_pin_dia", 3.0)
            pin_offset = request.params.get("alignment_pin_offset", 5.0)
            r = pin_dia / 2.0
            
            px1 = -width / 2.0 - pin_offset
            px2 = width / 2.0 + pin_offset
            py = 0.0
            
            px1 += dx
            px2 += dx
            py += dy
            
            # Crosses for pin drilling preview
            pin_paths.append([[px1 - r, py], [px1 + r, py]])
            pin_paths.append([[px1, py - r], [px1, py + r]])
            pin_paths.append([[px2 - r, py], [px2 + r, py]])
            pin_paths.append([[px2, py - r], [px2, py + r]])

        # 5. Format response geometries
        return {
            "copper": geom_to_paths(final_copper),
            "outline": geom_to_paths(final_outline),
            "drills": final_drills,
            "toolpaths": {
                "isolation": iso_paths,
                "rubout": rub_paths,
                "outline": out_paths,
                "drills": drill_paths,
                "alignment_pins": pin_paths
            },
            "bounds": {
                "width": width,
                "height": height
            }
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Ошибка генерации превью: {str(e)}")

@app.post("/api/creator/generate_gcode")
def generate_gcode(request: GenerateGCodeRequest):
    folder = request.folder_path
    outline_paths = [os.path.join(folder, f) for f in request.outline_files if f]
    copper_files = request.top_copper_files if request.side == "top" else request.bottom_copper_files
    copper_paths = [os.path.join(folder, f) for f in copper_files if f]
    drill_paths = [os.path.join(folder, f) for f in request.drill_files if f]

    if not outline_paths or not all(os.path.exists(p) for p in outline_paths):
        raise HTTPException(status_code=400, detail="Необходимо выбрать корректный файл(ы) контура платы (.GKO).")
    if not copper_paths or not all(os.path.exists(p) for p in copper_paths):
        raise HTTPException(status_code=400, detail="Необходимо выбрать корректный файл(ы) медного слоя (.GTL/.GBL).")

    try:
        # Parse
        outline_geom = GerberParser().parse_outline_multiple(outline_paths)
        copper_geom = GerberParser().parse_copper_multiple(copper_paths)
        
        drills = []
        if drill_paths:
            drills = ExcellonParser().parse_multiple(drill_paths)

        # Generate G-code
        generator = GCodeGenerator(request.params)
        gcode_files = generator.generate_all(copper_geom, outline_geom, drills, side=request.side)

        # Create output directory
        output_dir = os.path.join(folder, f"gcode_output_{request.side}")
        os.makedirs(output_dir, exist_ok=True)

        saved_files = []
        for filename, content in gcode_files.items():
            filepath = os.path.join(output_dir, filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            saved_files.append({
                "name": filename,
                "path": filepath,
                "size": len(content),
                "content": content
            })

        return {
            "output_dir": output_dir,
            "files": saved_files
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации G-кода: {str(e)}")

app.include_router(simulator_router)

# Mount static folder
if getattr(sys, 'frozen', False):
    static_path = os.path.join(sys._MEIPASS, "static")
else:
    static_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

if os.path.exists(static_path):
    app.mount("/", StaticFiles(directory=static_path, html=True), name="static")

def open_browser():
    webbrowser.open("http://127.0.0.1:8000")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ("--pick-folder", "--pick-folder-gerber", "--pick-folder-gcode"):
        import tkinter as tk
        from tkinter import filedialog
        import ctypes
        
        mode = sys.argv[1]
        
        root = tk.Tk()
        root.withdraw()
        
        # Make the dialog topmost and bring it to front
        root.attributes('-topmost', True)
        root.lift()
        root.focus_force()
        try:
            hwnd = root.winfo_id()
            ctypes.windll.user32.SetForegroundWindow(hwnd)
        except Exception:
            pass
            
        if mode == "--pick-folder-gcode":
            title = "Select Folder with G-code Files"
        else:
            title = "Выберите папку с Gerber файлами"
            
        folder = filedialog.askdirectory(
            parent=root,
            title=title
        )
        root.destroy()
        if folder:
            print(folder)
        sys.exit(0)

    if not getattr(sys, 'frozen', False):
        os.makedirs(static_path, exist_ok=True)
    
    # Start browser with a slight delay
    Timer(1.5, open_browser).start()
    
    # Run Uvicorn
    if getattr(sys, 'frozen', False):
        uvicorn.run(app, host="127.0.0.1", port=8000)
    else:
        uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
