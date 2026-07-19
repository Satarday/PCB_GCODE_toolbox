import os

from shapely.geometry import MultiPolygon, Polygon

from gerber_parser import ExcellonParser, GerberParser

# Resolve paths to test fixtures
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(TEST_DIR)
GERBER_DIR = os.path.join(PROJECT_DIR, "gerber_example", "Gerber_PCB1_2026-06-24")

OUTLINE_FILE = os.path.join(GERBER_DIR, "Gerber_BoardOutlineLayer.GKO")
COPPER_FILE = os.path.join(GERBER_DIR, "Gerber_TopLayer.GTL")
DRILL_FILE = os.path.join(GERBER_DIR, "Drill_PTH_Through.DRL")


def test_gerber_parser_init():
    parser = GerberParser()
    assert parser.unit_multiplier == 1.0
    assert parser.apertures == {}
    assert parser.macros == {}
    assert not parser.region_mode


def test_parse_outline():
    assert os.path.exists(OUTLINE_FILE), f"Outline file not found at {OUTLINE_FILE}"
    parser = GerberParser()
    geom = parser.parse_outline(OUTLINE_FILE)

    assert isinstance(geom, Polygon)
    assert not geom.is_empty

    minx, miny, maxx, maxy = geom.bounds
    width = maxx - minx
    height = maxy - miny

    # Check that dimensions are positive and realistic for a PCB
    assert width > 0
    assert height > 0
    assert width < 500  # realistic PCB width limit in mm
    assert height < 500


def test_parse_copper():
    assert os.path.exists(COPPER_FILE), f"Copper file not found at {COPPER_FILE}"
    parser = GerberParser()
    geom = parser.parse(COPPER_FILE)

    assert isinstance(geom, MultiPolygon)
    assert not geom.is_empty


def test_excellon_parser_init():
    parser = ExcellonParser()
    assert parser.tools == {}
    assert parser.unit_multiplier == 1.0


def test_parse_drill():
    assert os.path.exists(DRILL_FILE), f"Drill file not found at {DRILL_FILE}"
    parser = ExcellonParser()
    drills = parser.parse(DRILL_FILE)

    assert isinstance(drills, list)
    assert len(drills) > 0

    # Check structure of the first drill hit
    first_drill = drills[0]
    assert "x" in first_drill
    assert "y" in first_drill
    assert "tool_id" in first_drill
    assert "diameter" in first_drill
    assert isinstance(first_drill["x"], float)
    assert isinstance(first_drill["y"], float)
    assert isinstance(first_drill["diameter"], float)
