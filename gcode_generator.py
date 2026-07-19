import math

from shapely.geometry import LineString, MultiPolygon, Polygon


class GCodeGenerator:
    def __init__(self, params):
        self.params = params

    def generate_all(self, copper_geom, outline_geom, drills, side="top"):
        """
        Generates G-code files for all operations.
        Returns a dictionary of filename -> gcode_string.
        """
        # Determine board bounds from outline
        if outline_geom.is_empty:
            raise ValueError("Board outline is empty! Cannot generate toolpaths.")

        minx, miny, maxx, maxy = outline_geom.bounds
        width = maxx - minx
        height = maxy - miny

        # Center of the board (used as reference for centering and mirroring)
        cx = (minx + maxx) / 2.0
        cy = (miny + maxy) / 2.0

        # Calculate shifts to center the geometries
        # We will center everything at (0,0) first, perform mirroring, then apply final origin shift

        # 1. Transform geometries to centered coordinates
        centered_copper = self._shift_geometry(copper_geom, -cx, -cy)
        centered_outline = self._shift_geometry(outline_geom, -cx, -cy)

        centered_drills = []
        for d in drills:
            centered_drills.append({"x": d["x"] - cx, "y": d["y"] - cy, "diameter": d["diameter"]})

        # 2. Mirror bottom side if processing bottom
        if side == "bottom":
            centered_copper = self._mirror_geometry(centered_copper)
            centered_outline = self._mirror_geometry(centered_outline)
            for d in centered_drills:
                d["x"] = -d["x"]  # Mirror X coordinate

        # 3. Shift to final origin
        # If origin is bottom_left, we shift everything by (width/2, height/2) so min_x = 0, min_y = 0
        dx, dy = 0.0, 0.0
        if self.params.get("origin", "bottom_left") == "bottom_left":
            dx, dy = width / 2.0, height / 2.0

        final_copper = self._shift_geometry(centered_copper, dx, dy)
        final_outline = self._shift_geometry(centered_outline, dx, dy)
        final_drills = []
        for d in centered_drills:
            final_drills.append({"x": d["x"] + dx, "y": d["y"] + dy, "diameter": d["diameter"]})

        # Ensure final_outline is a Polygon for boolean ops
        if isinstance(final_outline, MultiPolygon):
            # Take the largest polygon as the board outline
            board_poly = max(final_outline.geoms, key=lambda p: p.area)
        else:
            board_poly = final_outline

        gcode_files = {}

        # --- 1. Isolation ---
        if self.params.get("enable_isolation", True):
            iso_paths = self._generate_isolation_paths(final_copper, board_poly)

            # Rest clearing (Pocket milling narrow spaces unreachable by large rubout tool)
            if self.params.get("iso_rest_clearing", False):
                rest_paths = self._generate_rest_clearing_paths(final_copper, board_poly)
                if rest_paths:
                    iso_paths.extend(rest_paths)
                    iso_paths = self._optimize_paths(iso_paths)

            gcode_files["isolation.gcode"] = self._paths_to_gcode(
                iso_paths,
                feed_xy=self.params.get("iso_feed_xy", self.params.get("feed_xy", 150.0)),
                feed_z=self.params.get("iso_feed_z", self.params.get("feed_z", 50.0)),
                cut_z=self.params.get("iso_cut_z", self.params.get("cut_z", -0.1)),
                safe_z=self.params.get("safe_z", 2.0),
                spindle=self.params.get("iso_spindle", self.params.get("spindle_speed", 12000.0)),
                comment="Isolation Routing",
                copper_geom=final_copper,
                tool_dia=self.params.get("isolation_dia", 0.2),
            )

        # --- 2. Rubout (Clearing) ---
        if self.params.get("enable_rubout", True):
            rubout_width = self.params.get("rubout_width", 0.0)
            if rubout_width > 0:
                rub_paths = self._generate_rubout_paths(final_copper, board_poly)
                gcode_files["rubout.gcode"] = self._paths_to_gcode(
                    rub_paths,
                    feed_xy=self.params.get("rub_feed_xy", self.params.get("feed_xy", 400.0)),
                    feed_z=self.params.get("rub_feed_z", self.params.get("feed_z", 100.0)),
                    cut_z=self.params.get("rub_cut_z", self.params.get("cut_z", -0.1)),
                    safe_z=self.params.get("safe_z", 2.0),
                    spindle=self.params.get("rub_spindle", self.params.get("spindle_speed", 10000.0)),
                    comment="Rubout Clearing",
                    copper_geom=final_copper,
                    tool_dia=self.params.get("rubout_dia", 1.0),
                )

        # --- 3. Outline Cut ---
        if self.params.get("enable_outline", True):
            out_gcode = self._generate_outline_gcode(board_poly)
            gcode_files["outline.gcode"] = out_gcode

        # --- 4. Drilling ---
        if self.params.get("enable_drill", True) and final_drills:
            drill_gcode = self._generate_drill_gcode(final_drills)
            gcode_files["drills.gcode"] = drill_gcode

        # --- 5. Alignment Pins (if enabled) ---
        if self.params.get("use_alignment_pins", True):
            pin_gcode = self._generate_alignment_pins_gcode(width, height)
            gcode_files["alignment_pins.gcode"] = pin_gcode

        return gcode_files

    def _shift_geometry(self, geom, dx, dy):
        """Shifts shapely geometry by dx, dy"""
        from shapely.affinity import translate

        return translate(geom, xoff=dx, yoff=dy)

    def _mirror_geometry(self, geom):
        """Mirrors shapely geometry horizontally (along X axis)"""
        from shapely.affinity import scale

        # Scale X by -1, Y by 1 around origin (0,0)
        return scale(geom, xfact=-1.0, yfact=1.0, origin=(0.0, 0.0))

    def _extract_paths(self, geom):
        """Extracts individual point paths from shapely geometry"""
        paths = []
        if geom.is_empty:
            return paths

        if geom.geom_type == "Polygon":
            paths.append(list(geom.exterior.coords))
            for interior in geom.interiors:
                paths.append(list(interior.coords))
        elif geom.geom_type == "MultiPolygon":
            for poly in geom.geoms:
                paths.extend(self._extract_paths(poly))
        elif geom.geom_type in ["LineString", "LinearRing"]:
            paths.append(list(geom.coords))
        elif geom.geom_type == "MultiLineString":
            for line in geom.geoms:
                paths.append(list(line.coords))
        elif geom.geom_type == "GeometryCollection":
            for part in geom.geoms:
                paths.extend(self._extract_paths(part))
        return paths

    def _generate_isolation_paths(self, copper_geom, board_poly):
        """Generates concentric isolation paths around copper features"""
        iso_dia = self.params["isolation_dia"]
        passes = self.params["isolation_passes"]
        overlap = self.params["isolation_overlap"]

        all_paths = []

        # We restrict isolation toolpaths to stay inside the board outline (buffered inward by tool radius)
        # to prevent cutting off the board edges. Use mitre join style (2) to preserve sharp corners
        # of rectangular/square boards.
        allowed_area = board_poly.buffer(-iso_dia / 2.0, join_style=2)

        for p in range(passes):
            # Calculate offset distance for this pass
            if p == 0:
                offset = iso_dia / 2.0
            else:
                step = iso_dia * (1.0 - overlap)
                offset = (iso_dia / 2.0) + p * step

            # Buffer the copper features outwards
            buffered = copper_geom.buffer(offset)

            # Keep only the boundaries inside the allowed area
            if not allowed_area.is_empty:
                buffered_inside = buffered.intersection(allowed_area)
            else:
                buffered_inside = buffered

            # Extract boundaries (lines) of the buffered polygon
            paths = self._extract_paths(buffered_inside)
            all_paths.extend(paths)

        return self._optimize_paths(all_paths)

    def _generate_rubout_paths(self, copper_geom, board_poly):
        """Generates concentric clearing paths around copper features"""
        iso_dia = self.params["isolation_dia"]
        passes = self.params["isolation_passes"]
        overlap_iso = self.params["isolation_overlap"]

        rub_dia = self.params["rubout_dia"]
        rub_width = self.params["rubout_width"]
        rub_overlap = self.params["rubout_overlap"]
        clear_all = self.params.get("rubout_clear_all", False)

        all_paths = []

        # Calculate where isolation ended
        iso_step = iso_dia * (1.0 - overlap_iso)
        iso_end_offset = (iso_dia / 2.0) + (passes - 1) * iso_step

        # Rubout steps
        rub_step = rub_dia * (1.0 - rub_overlap)

        if clear_all:
            # Safe upper limit for clearing the entire board
            minx, miny, maxx, maxy = board_poly.bounds
            max_offset = math.hypot(maxx - minx, maxy - miny)
        else:
            max_offset = iso_end_offset + rub_width

        # Shift allowed area outward to the board outline (no inward buffering) to avoid touching traces/pads near edges
        allowed_area = board_poly
        if allowed_area.is_empty:
            return []

        offset = iso_end_offset + rub_step
        while offset <= max_offset + 1e-5:
            buffered = copper_geom.buffer(offset)

            # Check if all empty copper spaces are already cleared
            if clear_all:
                try:
                    if allowed_area.difference(buffered).area < 1e-4:
                        break
                except Exception:
                    pass

            # Extract boundary lines of the buffered geometry first
            # to avoid tracing the board outline (allowed_area boundary) repeatedly
            boundary = buffered.boundary
            if not boundary.is_empty:
                # Intersect the boundary lines with the allowed board area
                clipped_boundary = boundary.intersection(allowed_area)
                paths = self._extract_paths(clipped_boundary)
                all_paths.extend(paths)

            offset += rub_step

        return self._optimize_paths(all_paths)

    def _generate_rest_clearing_paths(self, copper_geom, board_poly):
        """
        Generates rest clearing toolpaths using the fine isolation cutter
        to clean up narrow slots and pockets that the larger rubout cutter cannot reach.
        """
        try:
            iso_dia = self.params["isolation_dia"]
            passes = self.params["isolation_passes"]
            overlap_iso = self.params["isolation_overlap"]

            rub_dia = self.params["rubout_dia"]
            rub_width = self.params.get("rubout_width", 0.0)

            # If rubout is disabled or has no width, no rest clearing is needed
            if not self.params.get("enable_rubout", True) or rub_width <= 0:
                return []

            # 1. Calculate where isolation ended
            iso_step = iso_dia * (1.0 - overlap_iso)
            iso_end_offset = (iso_dia / 2.0) + (passes - 1) * iso_step

            # 2. Area reachable by the large rubout cutter (morphological opening)
            large_offset = iso_end_offset + rub_dia / 2.0
            center_large = board_poly.difference(copper_geom.buffer(large_offset))
            if center_large.is_empty:
                cleared_large = Polygon()
            else:
                cleared_large = center_large.buffer(rub_dia / 2.0).intersection(board_poly)

            # 3. Area reachable by the fine isolation cutter
            center_fine = board_poly.difference(copper_geom.buffer(iso_dia / 2.0))
            if center_fine.is_empty:
                cleared_fine = Polygon()
            else:
                cleared_fine = center_fine.buffer(iso_dia / 2.0).intersection(board_poly)

            # 4. Rest area (slots unreachable by large cutter but reachable by fine cutter)
            rest_area = cleared_fine.difference(cleared_large)
            if rest_area.is_empty or rest_area.area < 1e-4:
                return []

            # 5. Generate pocket clearing paths inside rest_area
            rest_paths = []
            step = iso_dia * (1.0 - overlap_iso)
            offset = iso_dia / 2.0

            while True:
                inner_area = rest_area.buffer(-offset)
                if inner_area.is_empty or inner_area.area < 1e-4:
                    break

                boundary = inner_area.boundary
                if not boundary.is_empty:
                    paths = self._extract_paths(boundary)
                    rest_paths.extend(paths)

                offset += step
                if offset > 10.0:  # Safety break for infinite loops
                    break

            return rest_paths
        except Exception as e:
            print(f"Warning: Rest clearing calculation skipped due to geometry exception: {e}")
            return []

    def _generate_outline_gcode(self, board_poly):
        """Generates outline cut G-code with holding tabs and multiple passes support"""
        cut_dia = self.params["outline_dia"]
        depth = self.params.get("out_depth", self.params.get("outline_depth", 1.6))
        safe_z = self.params["safe_z"]
        feed_xy = self.params.get("out_feed_xy", self.params.get("feed_xy", 500.0))
        feed_z = self.params.get("out_feed_z", self.params.get("feed_z", 150.0))
        spindle = self.params.get("out_spindle", self.params.get("spindle_speed", 10000.0))

        # Offset board outline outward by cutter radius
        toolpath_geom = board_poly.buffer(cut_dia / 2.0)

        # Extract exterior coordinates of the cutter path
        if toolpath_geom.is_empty:
            return "; Error: Outline toolpath is empty"

        if isinstance(toolpath_geom, MultiPolygon):
            path_polygon = max(toolpath_geom.geoms, key=lambda p: p.area)
        else:
            path_polygon = toolpath_geom

        raw_coords = list(path_polygon.exterior.coords)

        # If tabs are disabled, simple path generation
        use_tabs = self.params.get("outline_tabs", True)
        tab_thickness = self.params.get("tab_thickness", 0.5)
        tab_w = self.params.get("tab_width", 2.0)
        tab_count = self.params.get("tab_count", 4)

        # Build G-code
        gcode = []
        gcode.append("; --- Outline Cut Toolpath ---")
        gcode.append(f"; Tool diameter = {cut_dia:.3f}")
        gcode.append("G21 ; Units in mm")
        gcode.append("G90 ; Absolute positioning")
        gcode.append(f"M03 S{spindle} ; Turn spindle on")
        gcode.append(f"G00 Z{safe_z:.3f} ; Move to safe Z")

        if not use_tabs or tab_count <= 0:
            # Simple cut in multiple Z passes
            passes = int(self.params.get("outline_passes", 1))
            depth_step = depth / max(1, passes)

            gcode.append(f"G00 X{raw_coords[0][0]:.3f} Y{raw_coords[0][1]:.3f}")
            for pass_idx in range(passes):
                z_cut = -depth_step * (pass_idx + 1)
                gcode.append(f"G01 Z{z_cut:.3f} F{feed_z} ; Pass {pass_idx + 1} Z depth")
                for pt in raw_coords[1:]:
                    gcode.append(f"G01 X{pt[0]:.3f} Y{pt[1]:.3f} F{feed_xy}")
            gcode.append(f"G00 Z{safe_z:.3f} ; Retract")
        else:
            # Complex tabs generation with multiple Z passes
            passes = int(self.params.get("outline_passes", 1))
            depth_step = depth / max(1, passes)

            # 1. Compute total perimeter of the outline
            perimeter = 0.0
            cum_dist = [0.0]

            for i in range(len(raw_coords) - 1):
                p1 = raw_coords[i]
                p2 = raw_coords[i + 1]
                d = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
                perimeter += d
                cum_dist.append(perimeter)

            # 2. Define tab centers
            tab_centers = []
            for i in range(tab_count):
                tab_centers.append((i + 0.5) * (perimeter / tab_count))

            # 3. Construct clean intervals
            # Each tab has zone [center - tab_w/2, center + tab_w/2]
            tab_zones = []
            for tc in tab_centers:
                start = tc - tab_w / 2.0
                end = tc + tab_w / 2.0
                # Handle wrapping
                tab_zones.append((start, end))

            def is_inside_tab(s):
                # Wrap s around perimeter
                s = s % perimeter
                for start, end in tab_zones:
                    if start < 0:
                        # Wrap start to positive
                        if s >= (start + perimeter) or s <= end:
                            return True
                    elif end > perimeter:
                        if s >= start or s <= (end - perimeter):
                            return True
                    else:
                        if start <= s <= end:
                            return True
                return False

            # Reconstruct the path, inserting points at exact tab boundaries to have clean transitions
            boundaries = []
            for tc in tab_centers:
                s1 = (tc - tab_w / 2.0) % perimeter
                s2 = (tc + tab_w / 2.0) % perimeter
                boundaries.extend([s1, s2])
            boundaries.sort()

            # Merge original path points and boundaries
            new_path_events = []  # tuples of (dist, point)

            # Add original points
            for i, dist in enumerate(cum_dist):
                new_path_events.append((dist, raw_coords[i]))

            # Add boundary points
            for b_dist in boundaries:
                # Find which segment this boundary distance lies on
                for i in range(len(cum_dist) - 1):
                    d1 = cum_dist[i]
                    d2 = cum_dist[i + 1]
                    if d1 <= b_dist <= d2:
                        # Interpolate coordinates
                        ratio = (b_dist - d1) / (d2 - d1) if (d2 - d1) > 0 else 0.0
                        p1 = raw_coords[i]
                        p2 = raw_coords[i + 1]
                        bx = p1[0] + ratio * (p2[0] - p1[0])
                        by = p1[1] + ratio * (p2[1] - p1[1])
                        new_path_events.append((b_dist, (bx, by)))
                        break

            # Sort events by distance
            new_path_events.sort(key=lambda ev: ev[0])

            # Remove duplicate distances
            unique_events = []
            for ev in new_path_events:
                if not unique_events or abs(unique_events[-1][0] - ev[0]) > 1e-4:
                    unique_events.append(ev)

            # Ensure path is closed
            if abs(unique_events[0][0] - (unique_events[-1][0] - perimeter)) > 1e-4:
                unique_events.append((perimeter, unique_events[0][1]))

            # 4. Generate G-code segments
            start_pt = unique_events[0][1]
            gcode.append(f"G00 X{start_pt[0]:.3f} Y{start_pt[1]:.3f}")

            for pass_idx in range(passes):
                z_cut = -depth_step * (pass_idx + 1)

                # Z plunge for start of this pass
                initial_inside = is_inside_tab(unique_events[0][0])
                init_z = min(z_cut + tab_thickness, 0.0) if initial_inside else z_cut
                gcode.append(f"G01 Z{init_z:.3f} F{feed_z} ; Pass {pass_idx + 1} Z depth")

                current_inside = initial_inside

                for i in range(1, len(unique_events)):
                    dist = unique_events[i][0]
                    pt = unique_events[i][1]

                    # Check if this segment is inside a tab (midpoint check)
                    mid_dist = (unique_events[i - 1][0] + dist) / 2.0
                    segment_inside = is_inside_tab(mid_dist)

                    if segment_inside != current_inside:
                        target_z = min(z_cut + tab_thickness, 0.0) if segment_inside else z_cut
                        gcode.append(f"G01 Z{target_z:.3f} F{feed_z} ; Tab transition")
                        current_inside = segment_inside

                    gcode.append(f"G01 X{pt[0]:.3f} Y{pt[1]:.3f} F{feed_xy}")

            gcode.append(f"G00 Z{safe_z:.3f} ; Retract")

        gcode.append("M05 ; Spindle off")
        gcode.append("G00 X0 Y0 ; Return to origin")
        gcode.append("M30 ; End of program")

        return "\n".join(gcode)

    def _generate_drill_gcode(self, drills):
        """Generates Excellon drilling G-code grouped by drill size"""
        safe_z = self.params["safe_z"]
        drill_depth = self.params.get("drill_depth", 1.8)
        feed_z = self.params.get("drill_feed_z", self.params.get("feed_z", 120.0))
        spindle = self.params.get("drill_spindle", self.params.get("spindle_speed", 12000.0))

        # Group drills by diameter
        drills_by_dia = {}
        for d in drills:
            dia = d["diameter"]
            if dia not in drills_by_dia:
                drills_by_dia[dia] = []
            drills_by_dia[dia].append(d)

        gcode = []
        gcode.append("; --- Drilling Toolpath ---")
        gcode.append("G21 ; Units in mm")
        gcode.append("G90 ; Absolute positioning")
        gcode.append(f"M03 S{spindle} ; Turn spindle on")

        # Output drills tool by tool
        tool_idx = 1
        for dia, hole_list in sorted(drills_by_dia.items()):
            gcode.append(f"\n; Tool {tool_idx}: Drill Diameter = {dia:.2f}mm")
            # In a real machine, we might pause for tool change here
            gcode.append(f"(MSG, Mount drill bit diameter {dia:.2f}mm)")
            gcode.append("M00 ; Pause for tool change")
            gcode.append(f"M03 S{spindle} ; Restart spindle")

            gcode.append(f"G00 Z{safe_z:.3f} ; Move to safe Z")

            for hole in hole_list:
                gcode.append(f"G00 X{hole['x']:.3f} Y{hole['y']:.3f} ; Rapid to hole position")
                gcode.append(f"G01 Z{-drill_depth:.3f} F{feed_z} ; Drill plunge")
                gcode.append(f"G00 Z{safe_z:.3f} ; Retract")

            tool_idx += 1

        gcode.append("\nM05 ; Spindle off")
        gcode.append("G00 X0 Y0 ; Return to origin")
        gcode.append("M30 ; End of program")

        return "\n".join(gcode)

    def _generate_alignment_pins_gcode(self, board_w, board_h):
        """Generates G-code for drilling reference pin holes in the wasteboard"""
        safe_z = self.params["safe_z"]
        feed_z = self.params["feed_z"]
        spindle = self.params["spindle_speed"]

        pin_dia = self.params.get("alignment_pin_dia", 3.0)
        pin_depth = self.params.get("alignment_pin_depth", 5.0)
        pin_offset = self.params.get("alignment_pin_offset", 5.0)

        # Calculate alignment pins relative to the centered board
        # In centered coords, they are at X = -board_w/2 - pin_offset and X = board_w/2 + pin_offset, Y = 0
        px1 = -board_w / 2.0 - pin_offset
        px2 = board_w / 2.0 + pin_offset
        py = 0.0

        # Shift to final origin
        dx, dy = 0.0, 0.0
        if self.params.get("origin", "bottom_left") == "bottom_left":
            dx, dy = board_w / 2.0, board_h / 2.0

        px1 += dx
        px2 += dx
        py += dy

        pins = [{"x": px1, "y": py}, {"x": px2, "y": py}]

        gcode = []
        gcode.append("; --- Alignment Pin Holes (Drill in Wasteboard) ---")
        gcode.append("; Drill these holes into the wasteboard before mounting the PCB.")
        gcode.append("; Insert alignment pins (dowels) to register double-sided boards.")
        gcode.append("G21 ; Units in mm")
        gcode.append("G90 ; Absolute positioning")
        gcode.append(f"M03 S{spindle} ; Turn spindle on")
        gcode.append(f"G00 Z{safe_z:.3f} ; Move to safe Z")

        gcode.append(f"(MSG, Mount drill bit diameter {pin_dia:.2f}mm for pins)")
        gcode.append("M00 ; Pause to verify tool")
        gcode.append(f"M03 S{spindle} ; Restart spindle")

        for i, pin in enumerate(pins):
            gcode.append(f"\n; Pin {i + 1} at X={pin['x']:.2f}, Y={pin['y']:.2f}")
            gcode.append(f"G00 X{pin['x']:.3f} Y{pin['y']:.3f} ; Move to pin position")
            gcode.append(f"G01 Z{-pin_depth:.3f} F{feed_z} ; Drill plunge")
            gcode.append(f"G00 Z{safe_z:.3f} ; Retract")

        gcode.append("\nM05 ; Spindle off")
        gcode.append("G00 X0 Y0 ; Return to origin")
        gcode.append("M30 ; End of program")

        return "\n".join(gcode)

    def _paths_to_gcode(
        self, paths, feed_xy, feed_z, cut_z, safe_z, spindle, comment="", copper_geom=None, tool_dia=None
    ):
        """Converts raw point paths to a G-code program with tool-down optimization"""
        gcode = []
        gcode.append(f"; --- {comment} Toolpath ---")
        if tool_dia is not None:
            gcode.append(f"; Tool diameter = {tool_dia:.3f}")
        gcode.append("G21 ; Units in mm")
        gcode.append("G90 ; Absolute positioning")
        gcode.append(f"M03 S{spindle} ; Turn spindle on")
        gcode.append(f"G00 Z{safe_z:.3f} ; Move to safe Z")

        tool_down = False

        for i, path in enumerate(paths):
            if len(path) < 2:
                continue

            start = path[0]
            gcode.append(f"\n; Path {i + 1} start")

            if not tool_down:
                gcode.append(f"G00 X{start[0]:.3f} Y{start[1]:.3f}")
                gcode.append(f"G01 Z{cut_z:.3f} F{feed_z} ; Plunge")
                tool_down = True
            else:
                gcode.append(f"G01 X{start[0]:.3f} Y{start[1]:.3f} F{feed_xy} ; Move directly at cutting depth")

            # Cut
            for pt in path[1:]:
                gcode.append(f"G01 X{pt[0]:.3f} Y{pt[1]:.3f} F{feed_xy}")

            # Check if we need to retract at the end of this path
            if i < len(paths) - 1:
                next_start = paths[i + 1][0]
                end_pt = path[-1]

                # Calculate distance between paths
                dist = math.hypot(next_start[0] - end_pt[0], next_start[1] - end_pt[1])

                # Use a dynamic threshold to distinguish local nested passes from separate groups
                t_dia = tool_dia if tool_dia is not None else 0.2
                max_stay_down_dist = max(t_dia * 6.0, 3.0)

                must_retract = False
                retract_reason = ""

                if dist > max_stay_down_dist:
                    must_retract = True
                    retract_reason = f"distance {dist:.2f}mm > threshold {max_stay_down_dist:.2f}mm"
                else:
                    travel_line = LineString([end_pt, next_start])
                    # Check if it intersects copper (length check is boundary-safe)
                    if copper_geom is not None and travel_line.intersection(copper_geom).length > 0.005:
                        must_retract = True
                        retract_reason = "intersects copper"

                if must_retract:
                    gcode.append(f"G00 Z{safe_z:.3f} ; Retract ({retract_reason})")
                    tool_down = False
                else:
                    gcode.append("; Keep tool down")
            else:
                gcode.append(f"G00 Z{safe_z:.3f} ; Retract")
                tool_down = False

        gcode.append("\nM05 ; Spindle off")
        gcode.append("G00 X0 Y0 ; Return to origin")
        gcode.append("M30 ; End of program")

        return "\n".join(gcode)

    def _optimize_paths(self, paths):
        """
        Optimizes path order to minimize travel distance (air time)
        using a Nearest Neighbor heuristic. Supports path reversal.
        """
        if not paths:
            return []

        optimized = [paths[0]]
        remaining = paths[1:]
        current_end = paths[0][-1]

        while remaining:
            best_idx = 0
            best_dist = float("inf")
            reverse_best = False

            for idx, path in enumerate(remaining):
                # Distance squared to start of path
                d_start = (path[0][0] - current_end[0]) ** 2 + (path[0][1] - current_end[1]) ** 2
                if d_start < best_dist:
                    best_dist = d_start
                    best_idx = idx
                    reverse_best = False

                # Distance squared to end of path (if reversed)
                d_end = (path[-1][0] - current_end[0]) ** 2 + (path[-1][1] - current_end[1]) ** 2
                if d_end < best_dist:
                    best_dist = d_end
                    best_idx = idx
                    reverse_best = True

            next_path = remaining.pop(best_idx)
            if reverse_best:
                next_path.reverse()
            optimized.append(next_path)
            current_end = next_path[-1]

        return optimized
