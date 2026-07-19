import json
import os
import subprocess
import sys
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import SETTINGS_FILE

router = APIRouter(prefix="/api/simulator", tags=["simulator"])

# Request Models
class ScanFolderRequest(BaseModel):
    folder_path: str

class ReadFileRequest(BaseModel):
    file_path: str

class SettingsPayload(BaseModel):
    params: dict[str, Any]

_dialog_active_setter = None

def register_dialog_active_setter(setter_func):
    global _dialog_active_setter
    _dialog_active_setter = setter_func

def set_dialog_active(active: bool):
    if _dialog_active_setter:
        _dialog_active_setter(active)

@router.post("/select_folder")
def select_folder():
    set_dialog_active(True)
    try:
        if getattr(sys, 'frozen', False):
            cmd = [sys.executable, "--pick-folder-gcode"]
        else:
            cmd = [sys.executable, os.path.abspath(sys.argv[0]), "--pick-folder-gcode"]

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
        raise HTTPException(status_code=500, detail=f"Не удалось открыть диалог: {str(e)}") from e
    finally:
        set_dialog_active(False)

@router.get("/settings")
def get_settings():
    if not os.path.exists(SETTINGS_FILE):
        return {"params": {"last_folder": ""}}
    try:
        with open(SETTINGS_FILE, encoding='utf-8') as f:
            data = json.load(f)
        return data.get("simulator", {"params": {"last_folder": ""}})
    except Exception:
        return {"params": {"last_folder": ""}}

@router.post("/settings")
def save_settings(payload: SettingsPayload):
    try:
        data = {}
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, encoding='utf-8') as f:
                    data = json.load(f)
            except Exception:
                pass

        data["simulator"] = payload.model_dump()

        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Не удалось сохранить настройки: {str(e)}") from e

@router.post("/scan_folder")
def scan_folder(request: ScanFolderRequest):
    path = request.folder_path.strip()
    if not os.path.exists(path):
        raise HTTPException(status_code=400, detail="Указанная папка не существует.")
    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail="Указанный путь не является папкой.")

    gcode_files = []
    gcode_extensions = {'.gcode', '.nc', '.tap', '.cnc', '.txt'}

    try:
        for root, _dirs, files in os.walk(path):
            rel_path = os.path.relpath(root, path)
            depth = 0 if rel_path == "." else len(rel_path.split(os.sep))
            if depth > 2:
                continue

            for file in files:
                _, ext = os.path.splitext(file.lower())
                if ext in gcode_extensions:
                    full_path = os.path.join(root, file)
                    rel_to_search = os.path.relpath(full_path, path)
                    gcode_files.append({
                        "name": file,
                        "relative_path": rel_to_search,
                        "full_path": full_path,
                        "size": os.path.getsize(full_path)
                    })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка сканирования папки: {str(e)}") from e

    gcode_files.sort(key=lambda x: x["relative_path"])
    return {"files": gcode_files}

@router.post("/read_file")
def read_file(request: ReadFileRequest):
    file_path = request.file_path.strip()
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Файл не найден.")
    try:
        with open(file_path, encoding='utf-8', errors='ignore') as f:
            content = f.read()
        return {
            "name": os.path.basename(file_path),
            "content": content,
            "size": len(content)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка чтения файла: {str(e)}") from e
