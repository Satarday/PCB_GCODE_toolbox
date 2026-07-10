@echo off
chcp 65001 > nul
echo [PCB Creator] Starting...

:: Check python installation
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Python is not installed or not in PATH!
    pause
    exit /b 1
)

:: Create virtual environment if it doesn't exist
if not exist .venv (
    echo Creating virtual environment...
    python -m venv .venv
)

:: Activate virtual environment
call .venv\Scripts\activate

:: Install requirements
echo Installing dependencies from requirements.txt...
pip install -r requirements.txt

:: Start the app
echo Starting FastAPI server...
python main.py

pause
