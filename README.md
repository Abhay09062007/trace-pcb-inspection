# Trace · PCB Design Inspector

Trace is a browser-only educational tool for comparing the front-copper layer from a clean PCB manufacturing design with a test Gerber design. It reads Gerber ZIP packages or an individual copper Gerber, draws the parsed copper artwork, identifies geometric changes, marks their board locations, and exports a JSON report.

## Try the built-in Gerber examples

Open the site and choose **Demo: open trace**. The inspector compares the clean board against the faulted Gerber and reports an **Open trace · copper gap**, the gap length, and its centre in X/Y millimetres. Choose **Demo: added copper** to inspect an extra trace. Added copper that touches multiple reference traces is labelled a **potential short** and must be checked against the electrical netlist.

## Upload your manufacturing design

1. Choose **Load clean PCB design** and select the known-good manufacturing Gerber ZIP.
2. Choose **Load test PCB design** and select the board revision or manufactured-design Gerber ZIP you want to inspect.
3. The site extracts the front copper layer from both packages and compares the copper strokes and pads.
4. Review the marked coordinate and finding details, then export the JSON report.

The package should contain a front-copper Gerber whose filename includes `F_Cu`, `Front Copper`, `Top Copper`, or the `.GTL` extension. A single copper Gerber layer can also be loaded directly. The comparison assumes both designs use the same origin, scale, orientation, and units. ZIP extraction and analysis run locally in the browser; the files are not sent to a server.

## What this demo checks

- Missing portions of a reference copper trace, reported as an open trace/copper gap.
- Added copper traces, including additions that touch multiple reference traces (flagged as a potential short).
- Missing or unexpected copper pads.
- Finding locations and dimensions in Gerber board coordinates (millimetres).

The demo parses common RS-274X line and flash features, including circular and rectangular apertures. It displays a note when Gerber features such as aperture macros, circular arcs, filled regions, or clear-polarity operations are skipped. Export an appropriate linearized, positive-polarity copper layer for this version.

This is a geometric comparison of design files. It is not a full Gerber/ODB++ viewer, electrical netlist connectivity checker, DRC, manufacturer DFM validation, AOI inspection of a fabricated board, or guarantee that a board is defective. A potential short needs a netlist check. Use a professional EDA/DFM workflow before manufacturing.

## Generated Gerber test files

`samples/manufacturing/` contains clean, open-trace, and added-copper Gerber ZIP packages. They are generated educational RS-274X and Excellon examples, not validated manufacturing releases. Do not fabricate the intentional fault packages.

## Files

- `index.html` — dashboard and Gerber upload controls
- `styles.css` — responsive interface
- `app.js` — ZIP extraction, Gerber parser, geometry comparison, overlays, and report export
- `samples/manufacturing/` — sample Gerber and drill packages
- GitHub Pages serves the site from the `main` branch root

Open `index.html` or serve the folder with a static web server. No build step or upload backend is required.
