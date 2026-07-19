import os

from gcode_generator import GCodeGenerator
from gerber_parser import ExcellonParser, GerberParser

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(TEST_DIR)
GERBER_DIR = os.path.join(PROJECT_DIR, "gerber_example", "Gerber_PCB1_2026-06-24")

OUTLINE_FILE = os.path.join(GERBER_DIR, "Gerber_BoardOutlineLayer.GKO")
COPPER_FILE = os.path.join(GERBER_DIR, "Gerber_TopLayer.GTL")
DRILL_FILE = os.path.join(GERBER_DIR, "Drill_PTH_Through.DRL")

DEFAULT_PARAMS = {
    "enable_isolation": True,
    "isolation_dia": 0.2,
    "isolation_passes": 1,
    "isolation_overlap": 0.5,
    "iso_feed_xy": 150.0,
    "iso_feed_z": 50.0,
    "iso_cut_z": -0.1,
    "iso_spindle": 12000.0,
    "enable_rubout": False,
    "rubout_dia": 1.0,
    "rubout_width": 0.0,
    "rubout_overlap": 0.4,
    "enable_outline": True,
    "outline_dia": 1.0,
    "outline_feed_xy": 200.0,
    "outline_feed_z": 50.0,
    "outline_cut_z": -1.6,
    "outline_spindle": 10000.0,
    "outline_depth_per_pass": 0.5,
    "enable_drill": True,
    "drill_feed_z": 100.0,
    "drill_cut_z": -1.8,
    "drill_spindle": 12000.0,
    "use_alignment_pins": True,
    "alignment_pin_dia": 3.0,
    "alignment_pin_offset": 5.0,
    "safe_z": 2.0,
    "origin": "bottom_left",
    "spindle_speed": 12000.0,
    "feed_z": 50.0,
}


def test_gcode_generator_init():
    generator = GCodeGenerator(DEFAULT_PARAMS)
    assert generator.params == DEFAULT_PARAMS


def test_generate_all():
    # 1. Parse real geometries from example files
    outline_geom = GerberParser().parse_outline(OUTLINE_FILE)
    copper_geom = GerberParser().parse(COPPER_FILE)
    drills = ExcellonParser().parse(DRILL_FILE)

    # 2. Run GCode Generator
    generator = GCodeGenerator(DEFAULT_PARAMS)
    gcode_files = generator.generate_all(copper_geom, outline_geom, drills, side="top")

    # 3. Assert outputs
    assert isinstance(gcode_files, dict)

    # We expected isolation, outline, drill and alignment pin gcode files
    expected_files = ["isolation.gcode", "outline.gcode", "drills.gcode", "alignment_pins.gcode"]
    for filename in expected_files:
        assert filename in gcode_files
        content = gcode_files[filename]
        assert isinstance(content, str)
        assert len(content) > 0

        # Verify standard G-code markers
        assert "G21" in content  # Metric units
        assert "G90" in content  # Absolute positioning
        assert "M3" in content or "M03" in content  # Spindle start
        assert "M5" in content or "M05" in content  # Spindle stop
