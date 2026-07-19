import os
import shutil
import sys


def get_user_config_dir() -> str:
    """Returns the platform-specific directory for user configuration files."""
    if sys.platform == 'win32':
        appdata = os.environ.get('APPDATA') or os.path.expanduser('~\\AppData\\Roaming')
        config_dir = os.path.join(appdata, "PCB_GCODE_toolbox")
    else:
        config_dir = os.path.expanduser("~/.config/pcb_gcode_toolbox")
    os.makedirs(config_dir, exist_ok=True)
    return config_dir

# Resolve old application-relative paths (for migration)
if getattr(sys, 'frozen', False):
    OLD_BASE = os.path.dirname(sys.executable)
else:
    OLD_BASE = os.path.dirname(os.path.abspath(__file__))

OLD_PRESETS = os.path.join(OLD_BASE, "presets.json")
OLD_SETTINGS = os.path.join(OLD_BASE, "settings.json")

# New standard paths
CONFIG_DIR = get_user_config_dir()
PRESETS_FILE = os.path.join(CONFIG_DIR, "presets.json")
SETTINGS_FILE = os.path.join(CONFIG_DIR, "settings.json")

# Perform seamless migration of existing presets/settings if they exist in the old path
if os.path.exists(OLD_PRESETS) and not os.path.exists(PRESETS_FILE):
    try:
        shutil.copy2(OLD_PRESETS, PRESETS_FILE)
        print(f"Migrated presets.json from {OLD_PRESETS} to {PRESETS_FILE}")
    except Exception as e:
        print(f"Failed to migrate presets.json: {e}", file=sys.stderr)

if os.path.exists(OLD_SETTINGS) and not os.path.exists(SETTINGS_FILE):
    try:
        shutil.copy2(OLD_SETTINGS, SETTINGS_FILE)
        print(f"Migrated settings.json from {OLD_SETTINGS} to {SETTINGS_FILE}")
    except Exception as e:
        print(f"Failed to migrate settings.json: {e}", file=sys.stderr)
