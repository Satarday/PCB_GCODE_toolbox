# Руководство пользователя PCB_GCODE_toolbox

Инструментарий PCB_GCODE_toolbox предназначен для автоматизированной подготовки управляющих программ (G-кода) для фрезерно-гравировальных станков с ЧПУ на основе Gerber-файлов слоев печатных плат и Excellon-файлов сверловки.

Программа предоставляет графический интерфейс для настройки параметров обработки и включает 3D-симулятор для верификации сгенерированных траекторий перед отправкой на станок.

## 1. Получение и запуск программы

### Способ 1: Запуск готового исполняемого файла (только для ОС Windows)
1. Перейдите в раздел Releases репозитория на GitHub.
2. Скачайте архив с последней версией программы.
3. Распакуйте архив и запустите исполняемый файл PCB_toolbox.exe.
4. Веб-интерфейс программы автоматически откроется в браузере по адресу: http://127.0.0.1:8000.

### Способ 2: Запуск из исходного кода с использованием пакетного файла (только для ОС Windows)
1. Клонируйте репозиторий проекта на локальный компьютер.
2. В корневой директории проекта запустите командный файл start.bat.
3. Скрипт автоматически настроит локальное виртуальное окружение, установит необходимые зависимости и запустит сервер.
4. Веб-интерфейс программы откроется по адресу: http://127.0.0.1:8000.

### Способ 3: Запуск из исходного кода через консоль Python (кроссплатформенный: Windows, macOS, Linux)
1. Убедитесь, что на компьютере установлен Python версии 3.10 или выше.
2. Откройте терминал в корневой папке проекта.
3. Создайте и активируйте виртуальное окружение:
   - Для Windows:
     ```bash
     python -m venv .venv
     .venv\Scripts\activate
     ```
   - Для macOS / Linux:
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```
4. Установите зависимости:
   ```bash
   pip install -r requirements.txt
   ```
5. Запустите сервер:
   ```bash
   python main.py
   ```
6. Откройте браузер и перейдите по адресу: http://127.0.0.1:8000.

## 2. Порядок подготовки управляющих программ

Процесс подготовки G-кода состоит из следующих этапов:

1. Подготовка файлов проекта: Экспортируйте из вашей CAD-системы файлы медных проводников (.GTL/.GBL), контура платы (.GKO/.GM1) и сверловки (.DRL/.TXT).
2. Выбор рабочей директории: В интерфейсе программы нажмите кнопку "Выберите папку с Gerber файлами" и укажите каталог, содержащий экспортированные файлы проекта.
3. Сопоставление слоев: Убедитесь, что программа корректно определила файлы для контура, меди и отверстий. При необходимости переназначьте их вручную с помощью выпадающих списков.
4. Выбор обрабатываемой стороны: Установите переключатель стороны платы в положение Top (верхняя) или Bottom (нижняя).
5. Настройка технологических параметров: Задайте диаметры фрез, рабочие подачи и глубину обработки для каждой технологической операции.
6. Визуальный контроль: Проверьте рассчитанные траектории на интерактивной 2D-карте предварительного просмотра.
7. Генерация G-кода: Нажмите кнопку "Генерировать G-код".
8. Проверка в симуляторе: Перейдите на вкладку "Симулятор" в верхней панели, выберите сгенерированные файлы и запустите 3D-визуализацию для контроля высоты переходов и глубин резания.

## 3. Выходные файлы и хранение конфигурации

### Результаты генерации G-кода
Сгенерированные файлы управляющих программ сохраняются в выбранной рабочей директории в автоматически создаваемой папке:
- Для верхней стороны: gcode_output_top/
- Для нижней стороны: gcode_output_bottom/

В папке создаются отдельные файлы для каждого технологического этапа:
- isolation.gcode — фрезеровка изоляционных дорожек.
- rubout.gcode — удаление избыточных областей меди (если включено).
- outline.gcode — обрезка платы по контуру.
- drills.gcode — сверление отверстий под компоненты.
- alignment_pins.gcode — сверление калибровочных отверстий для двустороннего совмещения.

### Настройки пользователя и пресеты
Пользовательские настройки интерфейса и таблицы параметров инструментов сохраняются в системном каталоге пользователя:
- Windows: %APPDATA%\PCB_GCODE_toolbox\
- Linux / macOS: ~/.config/pcb_gcode_toolbox/

Конфигурационные файлы:
- settings.json — сохраненные параметры последней сессии.
- presets.json — библиотека параметров используемых инструментов (фрез и граверов).

## 4. Описание технологических параметров

### Параметры инструмента и режимы резания
- Диаметр инструмента (Tool Diameter) — фактический диаметр режущей части фрезы или гравера (мм).
- Подача XY (Feedrate XY) — скорость перемещения инструмента по осям X и Y во время резания (мм/мин).
- Подача Z (Plunge Rate Z) — скорость врезания инструмента в материал по вертикальной оси Z (мм/мин).
- Глубина резания (Cut Z) — конечная координата обработки по оси Z. Отрицательные значения указывают на обработку ниже поверхности заготовки.
- Безопасная высота (Safe Z) — координата по оси Z, на которой производятся безопасные холостые перемещения инструмента над заготовкой.
- Обороты шпинделя (Spindle Speed) — частота вращения шпинделя станка (об/мин).

### Двусторонняя обработка и базирование
Для обработки двусторонних печатных плат используется система референсных штифтов (Alignment Pins):
1. В подложке станка по файлу alignment_pins.gcode сверлятся установочные отверстия, в которые монтируются штифты диаметром, указанным в параметре Alignment Pin Dia.
2. При переключении обработки на нижнюю сторону (Bottom) программа автоматически зеркально отображает всю геометрию платы относительно центральной оси.
3. Заготовка переворачивается вокруг оси симметрии и позиционируется на штифтах, что гарантирует точное совмещение координат сторон платы.

---

# User Manual PCB_GCODE_toolbox

The PCB_GCODE_toolbox software is designed for automated generation of control programs (G-code) for CNC milling and engraving machines based on Gerber files of printed circuit board layers and Excellon drill files.

The program provides a graphical user interface for configuring processing parameters and includes a 3D simulator to verify generated toolpaths before sending them to the CNC machine.

## 1. Getting and Running the Program

### Method 1: Running the Pre-compiled Executable (Windows OS Only)
1. Go to the Releases section of the repository on GitHub.
2. Download the archive with the latest version of the program.
3. Extract the archive and run the executable file PCB_toolbox.exe.
4. The web interface will automatically open in your browser at: http://127.0.0.1:8000.

### Method 2: Running from Source Code Using a Batch File (Windows OS Only)
1. Clone the project repository to your local computer.
2. Run the start.bat command file in the root directory of the project.
3. The script will automatically configure a local virtual environment, install the required dependencies, and start the server.
4. The web interface will open at: http://127.0.0.1:8000.

### Method 3: Running from Source Code via Python Console (Cross-platform: Windows, macOS, Linux)
1. Ensure Python version 3.10 or higher is installed on your computer.
2. Open a terminal in the root folder of the project.
3. Create and activate a virtual environment:
   - For Windows:
     ```bash
     python -m venv .venv
     .venv\Scripts\activate
     ```
   - For macOS / Linux:
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```
4. Install the dependencies:
   ```bash
   pip install -r requirements.txt
   ```
5. Run the server:
   ```bash
   python main.py
   ```
6. Open your browser and navigate to: http://127.0.0.1:8000.

## 2. Processing Workflow

The G-code generation process consists of the following steps:

1. Prepare project files: Export copper layer files (.GTL/.GBL), board outline files (.GKO/.GM1), and drill files (.DRL/.TXT) from your CAD system.
2. Select working directory: In the program interface, click the "Select folder with Gerber files" button and specify the directory containing the exported files.
3. Map layers: Verify that the program has correctly identified the files for the outline, copper, and drills. If necessary, reassign them manually using the dropdown lists.
4. Select side: Set the board side switch to Top or Bottom.
5. Set processing parameters: Define tool diameters, feed rates, and depth of cut for each operation.
6. Visual check: Verify the calculated toolpaths on the interactive 2D preview map.
7. Generate G-code: Click the "Generate G-code" button.
8. Verify in simulator: Click the "Simulator" tab in the top navigation bar, select the generated files, and run the 3D visualization to control retract heights and depth of cut.

## 3. Output Files and Configuration Storage

### G-code Generation Results
Generated control program files are saved in the selected working directory in an automatically created subfolder:
- For top side: gcode_output_top/
- For bottom side: gcode_output_bottom/

The folder contains separate files for each processing step:
- isolation.gcode — isolation track milling.
- rubout.gcode — clearing of excess copper areas (if enabled).
- outline.gcode — board outline cutting.
- drills.gcode — drilling of component holes.
- alignment_pins.gcode — drilling of alignment reference holes for double-sided registration.

### User Settings and Presets
User interface settings and tool parameter tables are saved in the user's system configuration directory:
- Windows: %APPDATA%\PCB_GCODE_toolbox\
- Linux / macOS: ~/.config/pcb_gcode_toolbox/

Configuration files:
- settings.json — saved parameters of the last session.
- presets.json — library of parameters for used tools (endmills and engraving bits).

## 4. Description of Technological Parameters

### Tool Parameters and Cut Modes
- Tool Diameter — actual diameter of the cutting part of the endmill or engraving bit (mm).
- Feedrate XY — tool movement speed along X and Y axes during cutting (mm/min).
- Plunge Rate Z — tool entry speed into the material along the vertical Z axis (mm/min).
- Cut Z — final processing coordinate along the Z axis. Negative values indicate processing below the workpiece surface.
- Safe Z — coordinate along the Z axis at which safe rapid transitions of the tool above the workpiece are performed.
- Spindle Speed — spindle rotation frequency of the machine (rpm).

### Double-sided Processing and Registration
For double-sided PCB milling, a registration system with alignment pins is used:
1. In the wasteboard, reference holes are drilled according to the alignment_pins.gcode file, and pins of the diameter specified in the Alignment Pin Dia parameter are mounted.
2. When switching processing to the Bottom side, the program automatically mirrors all board geometry along the central Y axis.
3. The workpiece is flipped around the axis of symmetry and positioned on the pins, ensuring precise alignment of coordinate systems between sides.
