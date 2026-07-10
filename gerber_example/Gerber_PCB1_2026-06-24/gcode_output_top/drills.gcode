; --- Drilling Toolpath ---
G21 ; Units in mm
G90 ; Absolute positioning
M03 S10000 ; Turn spindle on

; Tool 1: Drill Diameter = 1.00mm
(MSG, Mount drill bit diameter 1.00mm)
M00 ; Pause for tool change
M03 S10000 ; Restart spindle
G00 Z2.000 ; Move to safe Z
G00 X10.310 Y29.020 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X10.310 Y26.480 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X2.690 Y29.020 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X2.690 Y26.480 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X8.520 Y8.000 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X5.980 Y8.000 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X13.230 Y8.000 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X15.770 Y8.000 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X13.750 Y22.750 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X13.750 Y33.250 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X14.290 Y19.000 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X11.750 Y19.000 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X9.210 Y19.000 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X16.500 Y33.250 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X2.750 Y33.250 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X6.250 Y33.250 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X3.500 Y2.500 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X10.750 Y2.500 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract
G00 X10.750 Y23.250 ; Rapid to hole position
G01 Z-1.800 F100 ; Drill plunge
G00 Z2.000 ; Retract

M05 ; Spindle off
G00 X0 Y0 ; Return to origin
M30 ; End of program