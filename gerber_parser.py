import re
import math
from shapely.geometry import Point, LineString, Polygon, MultiPolygon, box
from shapely.ops import unary_union

class GerberParser:
    def __init__(self):
        self.apertures = {}
        self.macros = {}
        self.current_aperture = None
        self.unit_multiplier = 1.0  # Default to mm (1.0). Inches would be 25.4
        self.scale_x = 1e-5  # Default scale for coordinates
        self.scale_y = 1e-5
        self.current_x = 0.0
        self.current_y = 0.0
        self.last_x = 0.0
        self.last_y = 0.0
        self.region_mode = False
        self.region_paths = []
        self.current_path = []
        self.shapes = []
        self.raw_paths = []
        self.current_raw_path = []
        self.interpolation_mode = 1  # 1: G01, 2: G02 (CW), 3: G03 (CCW)

    def parse(self, filepath):
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

        # 1. Parse parameter blocks enclosed in %
        parameter_blocks = re.findall(r'%([^%]+)%', content)
        for block in parameter_blocks:
            # A parameter block might end with a '*' inside the '%'
            block = block.strip().rstrip('*')
            self._parse_parameter(block)

        # 2. Remove parameter blocks to get only standard commands
        standard_content = re.sub(r'%[^%]+%', '', content)

        # Split content by '*' which is the Gerber command terminator
        commands = standard_content.split('*')
        
        for cmd in commands:
            cmd = cmd.strip()
            if not cmd:
                continue
            # Handle standard commands
            self._parse_command(cmd)

        if len(self.current_raw_path) >= 2:
            self.raw_paths.append(self.current_raw_path)
            self.current_raw_path = []
            
        # Merge all copper shapes into a single MultiPolygon
        if self.shapes:
            merged = unary_union(self.shapes)
            # Ensure it is a MultiPolygon
            if isinstance(merged, Polygon):
                merged = MultiPolygon([merged])
            return merged
        return MultiPolygon()

    def parse_copper_multiple(self, filepaths):
        """Parses multiple copper files and merges them into a single MultiPolygon."""
        if isinstance(filepaths, str):
            filepaths = [filepaths]
            
        all_shapes = []
        for fp in filepaths:
            if not fp:
                continue
            parser = GerberParser()
            geom = parser.parse(fp)
            if geom and not geom.is_empty:
                if isinstance(geom, MultiPolygon):
                    all_shapes.extend(geom.geoms)
                elif isinstance(geom, Polygon):
                    all_shapes.append(geom)
            
        if all_shapes:
            merged = unary_union(all_shapes)
            if isinstance(merged, Polygon):
                merged = MultiPolygon([merged])
            return merged
        return MultiPolygon()

    def parse_outline(self, filepath):
        """Parses the outline layer and returns a solid Polygon of the board interior."""
        return self.parse_outline_multiple([filepath])

    def parse_outline_multiple(self, filepaths):
        """Parses multiple outline files, combines their paths, and returns a solid Polygon."""
        if isinstance(filepaths, str):
            filepaths = [filepaths]
            
        all_raw_paths = []
        all_shapes = []
        
        for fp in filepaths:
            if not fp:
                continue
            parser = GerberParser()
            parser.parse(fp)
            all_raw_paths.extend(parser.raw_paths)
            all_shapes.extend(parser.shapes)
            
        from shapely.ops import linemerge, polygonize
        
        # Round coordinates to 4 decimal places (0.1 microns) to fix micro-gaps from float arithmetic
        lines = []
        for p in all_raw_paths:
            if len(p) >= 2:
                rounded_p = [(round(pt[0], 4), round(pt[1], 4)) for pt in p]
                # Filter out consecutive duplicates
                dedup_p = []
                for pt in rounded_p:
                    if not dedup_p or dedup_p[-1] != pt:
                        dedup_p.append(pt)
                if len(dedup_p) >= 2:
                    lines.append(LineString(dedup_p))
                    
        polys = []
        if lines:
            try:
                merged = linemerge(lines)
                polys = list(polygonize(merged))
            except Exception:
                pass
                
        if polys:
            merged_poly = unary_union(polys)
            if isinstance(merged_poly, Polygon):
                return merged_poly
            elif isinstance(merged_poly, MultiPolygon):
                return max(merged_poly.geoms, key=lambda p: p.area)
                
        # If polygonize fails or we have no lines, try to reconstruct from all_shapes (drawn line shapes/solid regions)
        if all_shapes:
            merged = unary_union(all_shapes)
            
            # Helper to fill holes of a Polygon/MultiPolygon to get the solid interior
            def fill_polygon_holes(geom):
                if geom.is_empty:
                    return geom
                if isinstance(geom, Polygon):
                    return Polygon(geom.exterior)
                elif isinstance(geom, MultiPolygon):
                    filled_list = []
                    for g in geom.geoms:
                        if isinstance(g, Polygon):
                            filled_list.append(Polygon(g.exterior))
                    return unary_union(filled_list)
                return geom

            filled = fill_polygon_holes(merged)
            if isinstance(filled, Polygon):
                return filled
            elif isinstance(filled, MultiPolygon):
                return max(filled.geoms, key=lambda p: p.area)
                
        return Polygon()

    def _parse_parameter(self, param):
        # 1. Units Mode
        if param == 'MOMM':
            self.unit_multiplier = 1.0
        elif param == 'MOIN':
            self.unit_multiplier = 25.4
            
        # 2. Coordinate Format
        # Example: FSLAX45Y45
        elif param.startswith('FS'):
            match = re.search(r'X(\d)(\d)Y(\d)(\d)', param)
            if match:
                # We care about the decimal digits count (second digit)
                dec_x = int(match.group(2))
                dec_y = int(match.group(4))
                self.scale_x = 10 ** (-dec_x)
                self.scale_y = 10 ** (-dec_y)

        # 3. Aperture Definitions
        # Example: ADD10C,0.5 or ADD14R,1.41X1.35001 or ADD11MACRO1,2.0X2.5
        elif param.startswith('AD'):
            match = re.match(r'ADD(\d+)([A-Za-z0-9_]+),([^%]+)', param)
            if match:
                ap_id = int(match.group(1))
                ap_type = match.group(2)
                ap_params_str = match.group(3)
                
                # Split params by 'X' or 'x'
                ap_params = [float(p) for p in re.split(r'[Xx]', ap_params_str)]
                self.apertures[ap_id] = {
                    'type': ap_type,
                    'params': ap_params
                }

        # 4. Aperture Macros
        # Example: %AMMACRO1*21,1,$1,$2,0,0,$3*%
        elif param.startswith('AM'):
            parts = param.split('*')
            if len(parts) >= 2:
                macro_name = parts[0][2:].strip() # Strip "AM" prefix
                primitives = [p.strip() for p in parts[1:] if p.strip()]
                self.macros[macro_name] = primitives

    def _parse_coordinate(self, coord_str, current_val, scale):
        if not coord_str:
            return current_val
        # Gerber coords can have leading/trailing signs
        val = int(coord_str)
        return val * scale * self.unit_multiplier

    def _parse_command(self, cmd):
        # Check for region mode start/end
        if cmd == 'G36':
            self.region_mode = True
            self.region_paths = []
            self.current_path = []
            return
        elif cmd == 'G37':
            self.region_mode = False
            if self.current_path:
                self.region_paths.append(self.current_path)
                self.current_path = []
            
            # Combine paths in region mode using symmetric difference (even-odd rule)
            region_poly = Polygon()
            for path in self.region_paths:
                if len(path) >= 3:
                    try:
                        region_poly = region_poly.symmetric_difference(Polygon(path))
                    except Exception:
                        pass # Ignore geometry errors
            if not region_poly.is_empty:
                self.shapes.append(region_poly)
            return

        # Check for G01/G02/G03 interpolation mode changes
        if 'G01' in cmd:
            self.interpolation_mode = 1
        elif 'G02' in cmd:
            self.interpolation_mode = 2
        elif 'G03' in cmd:
            self.interpolation_mode = 3

        # Check for aperture selection: Dxx (where xx >= 10)
        # E.g. G54D10 or just D10
        ap_match = re.search(r'(?:G54)?D(\d+)', cmd)
        if ap_match:
            ap_id = int(ap_match.group(1))
            if ap_id >= 10:
                self.current_aperture = ap_id
                # If there are coords in the same command, process them next

        # Parse X, Y coordinates and D01/D02/D03 codes
        x_match = re.search(r'X([+-]?\d+)', cmd)
        y_match = re.search(r'Y([+-]?\d+)', cmd)
        d_match = re.search(r'D0(1|2|3)', cmd)

        # Parse I, J arc center offsets (relative to start point)
        i_match = re.search(r'I([+-]?\d+)', cmd)
        j_match = re.search(r'J([+-]?\d+)', cmd)
        i_val = self._parse_coordinate(i_match.group(1) if i_match else None, 0.0, self.scale_x)
        j_val = self._parse_coordinate(j_match.group(1) if j_match else None, 0.0, self.scale_y)

        if x_match or y_match:
            new_x = self._parse_coordinate(x_match.group(1) if x_match else None, self.current_x, self.scale_x)
            new_y = self._parse_coordinate(y_match.group(1) if y_match else None, self.current_y, self.scale_y)
            self.current_x = new_x
            self.current_y = new_y

        d_code = d_match.group(1) if d_match else None

        if d_code == '2':  # Move without exposure
            self.last_x = self.current_x
            self.last_y = self.current_y
            if self.region_mode:
                if self.current_path:
                    self.region_paths.append(self.current_path)
                self.current_path = [(self.current_x, self.current_y)]
            else:
                if len(self.current_raw_path) >= 2:
                    self.raw_paths.append(self.current_raw_path)
                self.current_raw_path = [(self.current_x, self.current_y)]

        elif d_code == '1':  # Draw line / interpolate
            if self.region_mode:
                if self.interpolation_mode in [2, 3]:
                    pts = self._interpolate_arc(self.last_x, self.last_y, self.current_x, self.current_y, i_val, j_val, self.interpolation_mode == 2)
                    if pts:
                        self.current_path.extend(pts[1:])
                else:
                    if not self.current_path:
                        self.current_path = [(self.last_x, self.last_y)]
                    self.current_path.append((self.current_x, self.current_y))
            else:
                if self.interpolation_mode in [2, 3]:
                    pts = self._interpolate_arc(self.last_x, self.last_y, self.current_x, self.current_y, i_val, j_val, self.interpolation_mode == 2)
                    if pts:
                        if not self.current_raw_path:
                            self.current_raw_path = [pts[0]]
                        self.current_raw_path.extend(pts[1:])
                        
                        # Create track geometry from arc points
                        if self.current_aperture in self.apertures:
                            ap = self.apertures[self.current_aperture]
                            geom = self._create_arc_track_geometry(pts, ap)
                            if geom:
                                self.shapes.append(geom)
                else:
                    if not self.current_raw_path:
                        self.current_raw_path = [(self.last_x, self.last_y)]
                    self.current_raw_path.append((self.current_x, self.current_y))

                    # Standard track draw
                    if self.current_aperture in self.apertures:
                        ap = self.apertures[self.current_aperture]
                        geom = self._create_track_geometry(self.last_x, self.last_y, self.current_x, self.current_y, ap)
                        if geom:
                            self.shapes.append(geom)
                self.last_x = self.current_x
                self.last_y = self.current_y

        elif d_code == '3':  # Flash aperture
            if self.current_aperture in self.apertures:
                ap = self.apertures[self.current_aperture]
                geom = self._create_flash_geometry(self.current_x, self.current_y, ap)
                if geom:
                    self.shapes.append(geom)
            self.last_x = self.current_x
            self.last_y = self.current_y

    def _interpolate_arc(self, x1, y1, x2, y2, i_offset, j_offset, is_cw):
        cx = x1 + i_offset
        cy = y1 + j_offset
        r = math.hypot(i_offset, j_offset)
        if r == 0:
            return [(x1, y1), (x2, y2)]
            
        start_angle = math.atan2(y1 - cy, x1 - cx)
        end_angle = math.atan2(y2 - cy, x2 - cx)
        
        if is_cw:
            if end_angle >= start_angle:
                end_angle -= 2 * math.pi
        else:
            if end_angle <= start_angle:
                end_angle += 2 * math.pi
                
        angle_diff = abs(end_angle - start_angle)
        # 1 segment per 0.1 radians (~5.7 degrees)
        num_segments = max(int(angle_diff / 0.1), 8)
        
        points = []
        for step in range(num_segments + 1):
            t = step / num_segments
            angle = start_angle + t * (end_angle - start_angle)
            px = cx + r * math.cos(angle)
            py = cy + r * math.sin(angle)
            points.append((px, py))
        return points

    def _create_arc_track_geometry(self, pts, aperture):
        params = aperture['params']
        width = params[0]
        return LineString(pts).buffer(width / 2.0)

    def _create_track_geometry(self, x1, y1, x2, y2, aperture):
        ap_type = aperture['type']
        params = aperture['params']
        
        # If coordinates are identical, it is a point flash
        if x1 == x2 and y1 == y2:
            return self._create_flash_geometry(x1, y1, aperture)

        if ap_type == 'C':  # Circular aperture
            diameter = params[0]
            # Draw line and buffer by radius
            return LineString([(x1, y1), (x2, y2)]).buffer(diameter / 2.0)
            
        elif ap_type == 'R':  # Rectangular aperture
            w, h = params[0], params[1]
            rect1 = box(x1 - w/2, y1 - h/2, x1 + w/2, y1 + h/2)
            rect2 = box(x2 - w/2, y2 - h/2, x2 + w/2, y2 + h/2)
            # Swept path of rectangle is the convex hull of start and end positions
            return MultiPolygon([rect1, rect2]).convex_hull
            
        elif ap_type == 'O':  # Obround aperture
            # Treat as rounded rectangle
            w, h = params[0], params[1]
            if w > h:
                line = LineString([(x1 - (w-h)/2, y1), (x1 + (w-h)/2, y1)])
                rect1 = line.buffer(h / 2.0)
                line2 = LineString([(x2 - (w-h)/2, y2), (x2 + (w-h)/2, y2)])
                rect2 = line2.buffer(h / 2.0)
            else:
                line = LineString([(x1, y1 - (h-w)/2), (x1, y1 + (h-w)/2)])
                rect1 = line.buffer(w / 2.0)
                line2 = LineString([(x2, y2 - (h-w)/2), (x2, y2 + (h-w)/2)])
                rect2 = line2.buffer(w / 2.0)
            return MultiPolygon([rect1, rect2]).convex_hull

        return None

    def _create_flash_geometry(self, x, y, aperture):
        ap_type = aperture['type']
        params = aperture['params']

        if ap_type == 'C':  # Circle
            diameter = params[0]
            return Point(x, y).buffer(diameter / 2.0)
            
        elif ap_type == 'R':  # Rectangle
            w, h = params[0], params[1]
            return box(x - w/2, y - h/2, x + w/2, y + h/2)
            
        elif ap_type == 'O':  # Obround
            w, h = params[0], params[1]
            if w > h:
                return LineString([(x - (w-h)/2, y), (x + (w-h)/2, y)]).buffer(h / 2.0)
            else:
                return LineString([(x, y - (h-w)/2), (x, y + (h-w)/2)]).buffer(w / 2.0)
                
        elif ap_type in ['P', 'Polygon']:  # Regular Polygon
            diameter = params[0]
            sides = int(params[1]) if len(params) > 1 else 6
            # Approximate as circle for milling purposes
            return Point(x, y).buffer(diameter / 2.0)
            
        # Check if type matches a defined aperture macro
        elif ap_type in self.macros:
            return self._evaluate_macro(ap_type, x, y, params)

        return None

    def _evaluate_macro(self, macro_name, x, y, params):
        from shapely.affinity import rotate, translate
        
        shapes = []
        for prim in self.macros[macro_name]:
            parts = prim.split(',')
            if not parts:
                continue
            prim_code = parts[0].strip()
            
            # Primitive 21: Center Line / Rectangle
            # format: 21, exposure, width, height, center_x, center_y, rotation
            if prim_code == '21':
                if len(parts) >= 7:
                    exposure = self._eval_val(parts[1], params)
                    w = self._eval_val(parts[2], params)
                    h = self._eval_val(parts[3], params)
                    cx = self._eval_val(parts[4], params)
                    cy = self._eval_val(parts[5], params)
                    rotation = self._eval_val(parts[6], params)
                    
                    # Create the box at the macro local coords
                    rect = box(cx - w/2, cy - h/2, cx + w/2, cy + h/2)
                    if rotation != 0.0:
                        rect = rotate(rect, rotation, origin=(cx, cy))
                    # Translate to the flash coordinates
                    rect = translate(rect, xoff=x, yoff=y)
                    
                    if exposure == 1:
                        shapes.append(rect)
                        
            # Primitive 1: Circle
            # format: 1, exposure, diameter, center_x, center_y[, rotation]
            elif prim_code == '1':
                if len(parts) >= 5:
                    exposure = self._eval_val(parts[1], params)
                    dia = self._eval_val(parts[2], params)
                    cx = self._eval_val(parts[3], params)
                    cy = self._eval_val(parts[4], params)
                    
                    circle = Point(cx, cy).buffer(dia / 2.0)
                    circle = translate(circle, xoff=x, yoff=y)
                    
                    if exposure == 1:
                        shapes.append(circle)
                        
        if shapes:
            return unary_union(shapes)
        return None

    def _eval_val(self, val_str, params):
        val_str = val_str.strip()
        if val_str.startswith('$'):
            try:
                idx = int(val_str[1:]) - 1
                if 0 <= idx < len(params):
                    return params[idx]
            except Exception:
                pass
            return 0.0
        try:
            return float(val_str)
        except ValueError:
            return 0.0


class ExcellonParser:
    def __init__(self):
        self.tools = {}
        self.current_tool = None
        self.unit_multiplier = 1.0  # Default to mm (1.0)
        self.scale = 1.0

    def parse(self, filepath):
        drills = []
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        in_header = False
        for line in lines:
            line = line.strip()
            if not line:
                continue

            if line == 'M48':
                in_header = True
                continue
            elif line == '%':
                in_header = False
                continue

            # Units in header
            if in_header:
                if 'METRIC' in line:
                    self.unit_multiplier = 1.0
                elif 'INCH' in line:
                    self.unit_multiplier = 25.4
                
                # Tool definition: T01C1.0 or T1C1.00
                t_match = re.match(r'T(\d+)C([\d.]+)', line)
                if t_match:
                    t_id = int(t_match.group(1))
                    t_dia = float(t_match.group(2)) * self.unit_multiplier
                    self.tools[t_id] = t_dia
                continue

            # Tool selection: T01 or T1
            t_sel = re.match(r'^T(\d+)$', line)
            if t_sel:
                self.current_tool = int(t_sel.group(1))
                continue

            # Coordinate parse
            if line.startswith('X') or line.startswith('Y'):
                x_match = re.search(r'X([+-]?[\d.]+)', line)
                y_match = re.search(r'Y([+-]?[\d.]+)', line)
                
                if x_match or y_match:
                    x_str = x_match.group(1) if x_match else None
                    y_str = y_match.group(1) if y_match else None
                    
                    x = self._parse_coord(x_str)
                    y = self._parse_coord(y_str)
                    
                    if x is not None or y is not None:
                        drills.append({
                            'x': x or 0.0,
                            'y': y or 0.0,
                            'tool_id': self.current_tool,
                            'diameter': self.tools.get(self.current_tool, 1.0)
                        })

        return drills

    def parse_multiple(self, filepaths):
        """Parses multiple Excellon files and returns a combined list of drill hits."""
        if isinstance(filepaths, str):
            filepaths = [filepaths]
            
        all_drills = []
        for fp in filepaths:
            if not fp:
                continue
            parser = ExcellonParser()
            drills = parser.parse(fp)
            all_drills.extend(drills)
        return all_drills

    def _parse_coord(self, coord_str):
        if not coord_str:
            return None
        # If explicit decimal point is in string, parse as float directly
        if '.' in coord_str:
            return float(coord_str) * self.unit_multiplier
        else:
            # If no decimal point, assume leading zero omitted format
            # EasyEDA DRL default is often LZ 3 integers, 3 decimals or similar.
            # Let's assume divider 1000.0 (3 decimal places)
            return float(coord_str) / 1000.0 * self.unit_multiplier
