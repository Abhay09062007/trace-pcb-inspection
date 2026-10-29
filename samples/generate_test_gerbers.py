from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
FAB = ROOT / "manufacturing"
FAB.mkdir(parents=True, exist_ok=True)
OUTDIR = FAB / "files"
OUTDIR.mkdir(parents=True, exist_ok=True)

PAD = [(6.0, 9.0), (6.0, 21.0), (16.5, 9.0), (24.12, 9.0), (34.0, 9.0), (36.54, 9.0)]
SCALE = 1_000_000

def xy(x, y):
    return f"X{round(x*SCALE):09d}Y{round(y*SCALE):09d}"

def gerber_header():
    return ["G04 Trace low-voltage LED status board - RS-274X*", "%FSLAX36Y36*%", "%MOMM*%", "%IPPOS*%", "%LPD*%"]

def copper(kind):
    lines = gerber_header() + ["%ADD10C,2.400*%", "%ADD11C,0.650*%", "D10*"]
    for x,y in PAD:
        lines.append(f"{xy(x,y)}D03*")
    lines += ["D11*"]
    paths = [
        [(6,9),(16.5,9),(24.12,9)],
        [(24.12,9),(34,9)],
        [(36.54,9),(36.54,21),(6,21)],
    ]
    for path in paths:
        if kind == "open" and path[0] == (24.12,9):
            lines += [f"{xy(24.12,9)}D02*", f"{xy(28,9)}D01*", f"{xy(31,9)}D02*", f"{xy(34,9)}D01*"]
            continue
        lines.append(f"{xy(*path[0])}D02*")
        for point in path[1:]:
            lines.append(f"{xy(*point)}D01*")
    if kind == "short":
        lines += ["D11*", f"{xy(20.31,9)}D02*", f"{xy(20.31,21)}D01*"]
    lines += ["M02*"]
    return "\n".join(lines)+"\n"

def mask():
    lines = gerber_header() + ["%ADD10C,3.000*%", "D10*"]
    for x,y in PAD:
        lines.append(f"{xy(x,y)}D03*")
    lines += ["M02*"]
    return "\n".join(lines)+"\n"

def silkscreen():
    lines = gerber_header() + ["%ADD10C,0.200*%", "D10*"]
    def route(points):
        lines.append(f"{xy(*points[0])}D02*")
        for p in points[1:]: lines.append(f"{xy(*p)}D01*")
    # component outlines and readable stroke-font identifiers
    route([(3,6),(9,6),(9,24),(3,24),(3,6)])
    route([(14,6),(26.5,6),(26.5,12),(14,12),(14,6)])
    route([(32,6),(39,6),(39,12),(32,12),(32,6)])
    # simple vector labels J1, R1, D1, +5V, GND
    # compact label strokes as line segments (digits and letters)
    strokes = {
      "J": [[(0,0),(0,1.4)],[(0,1.4),(0.9,1.4)],[(0,0),(0.6,0),(0.9,0.35)]],
      "R": [[(0,0),(0,1.4),(0.8,1.4),(0.9,0.95),(0,0.75)],[(0,0.75),(0.9,0)]],
      "D": [[(0,0),(0,1.4),(0.55,1.4),(0.9,1.1),(0.9,0.3),(0.55,0),(0,0)]],
      "1": [[(0,1.0),(0.45,1.4),(0.45,0)],[(0.1,0),(0.8,0)]],
    }
    def text(label, x, y):
        cursor=x
        for c in label:
            if c==" ": cursor+=1.4; continue
            for stroke in strokes.get(c,[]): route([(cursor+a,y+b) for a,b in stroke])
            cursor+=1.5
    text("J1",4,14)
    text("R1",18,7)
    text("D1",34,7)
    route([(11,9),(12,9)]); route([(11.5,8.5),(11.5,9.5)])
    route([(11,21),(12,21)])
    lines += ["M02*"]
    return "\n".join(lines)+"\n"

def outline():
    lines = gerber_header() + ["%ADD10C,0.150*%", "D10*", f"{xy(0,0)}D02*", f"{xy(42,0)}D01*", f"{xy(42,30)}D01*", f"{xy(0,30)}D01*", f"{xy(0,0)}D01*", "M02*"]
    return "\n".join(lines)+"\n"

def drill():
    points = [(6,9),(6,21),(16.5,9),(24.12,9),(34,9),(36.54,9)]
    lines=["M48", "; DRILL file for Trace low-voltage LED status board", "METRIC,TZ", "T1C0.800", "%", "T1"]
    for x,y in points: lines.append(f"X{x:.3f}Y{y:.3f}")
    lines += ["T0", "M30"]
    return "\n".join(lines)+"\n"

for variant in ("clean", "open-trace", "copper-short"):
    kind = {"clean":"clean", "open-trace":"open", "copper-short":"short"}[variant]
    prefix = f"trace-status-{variant}"
    filemap = {
      f"{prefix}-F_Cu.gbr": copper(kind),
      f"{prefix}-F_Mask.gbr": mask(),
      f"{prefix}-F_Silkscreen.gbr": silkscreen(),
      f"{prefix}-Edge_Cuts.gbr": outline(),
      f"{prefix}-PTH.drl": drill(),
    }
    for name, content in filemap.items(): (OUTDIR/name).write_text(content, encoding="ascii", newline="\n")
    readme = (
      "Trace Low-Voltage LED Status Board — " + variant + " variant\n"
      "Single-sided, 42 x 30 mm, FR-4, 1.6 mm, 1 oz copper. 0.8 mm plated holes.\n"
      "Layers: F_Cu, F_Mask, F_Silkscreen, Edge_Cuts, PTH drill.\n"
      "Circuit: J1 supplies 5 V; R1 is 330 ohm; D1 is a red through-hole LED.\n"
    )
    if variant == "open-trace": readme += "TEST FAULT: 3 mm interruption in the series path between R1 and D1. Do not fabricate as a functional board.\n"
    elif variant == "copper-short": readme += "TEST FAULT: copper bridge between +5 V and GND. Do not fabricate as a functional board.\n"
    else: readme += "Clean reference variant.\n"
    readme += "These files are generated test artwork, not a manufacturer's validated production release. Review all layers and drill data in a Gerber viewer and run the fabricator's DFM checks before ordering.\n"
    (OUTDIR/f"{prefix}-README.txt").write_text(readme, encoding="utf-8", newline="\n")
    with ZipFile(FAB/f"{prefix}.zip", "w", ZIP_DEFLATED) as z:
        for name in filemap: z.write(OUTDIR/name, arcname=name)
        z.writestr(f"{prefix}-README.txt", readme)

# Matched previews use the same geometry and scale, so a visual difference check is deterministic.
def svg(kind):
    board_x, board_y, s = 80, 62, 20
    def X(mm): return board_x + mm*s
    def Y(mm): return board_y + mm*s
    def line(a,b,color="#cfaa62",width=11):
        return f'<path d="M{X(a[0])} {Y(a[1])} L{X(b[0])} {Y(b[1])}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>'
    traces=[]
    routes=[[(6,9),(16.5,9),(24.12,9)],[(24.12,9),(34,9)],[(36.54,9),(36.54,21),(6,21)]]
    for path in routes:
        if kind=="open" and path[0]==(24.12,9):
            traces += [line((24.12,9),(28,9)),line((31,9),(34,9))]
            continue
        traces += [line(a,b) for a,b in zip(path,path[1:])]
    if kind=="short": traces.append(line((20.31,9),(20.31,21),"#f07970",11))
    pads="".join(f'<circle cx="{X(x)}" cy="{Y(y)}" r="24" fill="#e6c878" stroke="#102c23" stroke-width="5"/><circle cx="{X(x)}" cy="{Y(y)}" r="7" fill="#111a16"/>' for x,y in PAD)
    labels=f'<g fill="#edf2df" font-family="monospace" font-size="16"><text x="{X(3)}" y="{Y(5)}">J1 5V</text><text x="{X(17)}" y="{Y(5)}">R1 330R</text><text x="{X(32)}" y="{Y(5)}">D1 LED</text><text x="{X(4)}" y="{Y(15)}">+</text><text x="{X(4)}" y="{Y(23)}">GND</text><text x="{X(15)}" y="{Y(14)}">SERIES STATUS CIRCUIT</text></g>'
    caption="REFERENCE COMPARISON · TEST BOARD"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 720" role="img" aria-label="{caption}"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#0b1110"/><stop offset="1" stop-color="#171614"/></linearGradient><linearGradient id="mask" x2="0" y2="1"><stop stop-color="#14684b"/><stop offset="1" stop-color="#0a4635"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="20" stdDeviation="20" flood-color="#000" flood-opacity=".45"/></filter></defs><rect width="1000" height="720" fill="url(#bg)"/><text x="60" y="48" fill="#d8bc82" font-family="monospace" font-size="14" letter-spacing="2">TRACE · GERBER TEST ARTWORK</text><text x="60" y="86" fill="#f2efe7" font-family="Arial,sans-serif" font-size="25" font-weight="600">Low-voltage LED status board</text><text x="940" y="76" text-anchor="end" fill="#a3a197" font-family="monospace" font-size="13">42 × 30 mm · SINGLE LAYER</text><g filter="url(#shadow)"><rect x="{board_x}" y="{board_y}" width="{42*s}" height="{30*s}" rx="20" fill="url(#mask)" stroke="#9fbd8a" stroke-width="3"/><rect x="{board_x+12}" y="{board_y+12}" width="{42*s-24}" height="{30*s-24}" rx="13" fill="none" stroke="#c1d1a8" stroke-opacity=".25" stroke-width="2"/></g><g opacity=".18" fill="#c9ddbc">{''.join(f'<circle cx="{X(x)}" cy="{Y(y)}" r="2"/>' for x in range(2,41,2) for y in range(2,29,2))}</g>{''.join(traces)}{pads}<g fill="#212829" stroke="#9ca99b" stroke-width="3"><rect x="{X(15)}" y="{Y(7)-25}" width="{11*s}" height="50" rx="8"/><rect x="{X(32)}" y="{Y(7)-25}" width="{8*s}" height="50" rx="8"/></g><g fill="#ecdfb4" font-family="monospace" font-size="13"><text x="{X(17)}" y="{Y(7)+5}">R1</text><text x="{X(34)}" y="{Y(7)+5}">D1</text></g><text x="500" y="690" text-anchor="middle" fill="#c6b78f" font-family="monospace" font-size="14" letter-spacing="2">{caption}</text></svg>'''

for name,kind in [("clean-reference.svg","clean"),("fault-open-trace.svg","open"),("fault-copper-short.svg","short")]:
    (ROOT/name).write_text(svg(kind), encoding="utf-8", newline="\n")
print(f"Created 3 Gerber ZIP sets in {FAB} and matched SVG previews in {ROOT}")
