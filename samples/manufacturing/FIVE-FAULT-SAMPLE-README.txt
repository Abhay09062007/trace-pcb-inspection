TRACE · FIVE-FAULT GERBER SAMPLE
Use trace-status-clean.zip as the clean reference and trace-status-five-faults.zip as the test design.
Expected five findings:
1. Open trace · copper gap — R1-to-D1, 1.00 mm, centre X 26.50 mm / Y 9.00 mm.
2. Open trace · copper gap — GND return, 1.00 mm, centre X 24.50 mm / Y 21.00 mm.
3. Missing copper pad — X 6.00 mm / Y 21.00 mm.
4. Unexpected copper pad — X 30.00 mm / Y 21.00 mm.
5. Added copper bridge — potential +5 V-to-GND short near X 20.31 mm; confirm with an electrical netlist.

These are generated educational RS-274X/Excellon test files, not validated manufacturing releases.
The intentional-fault package must not be fabricated. The comparison is geometric and does not
perform electrical connectivity, DRC, AOI, or fabricator DFM validation.
