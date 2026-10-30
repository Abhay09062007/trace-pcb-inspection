const toastEl = document.getElementById('toast');
let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

const fileInput = document.getElementById('fileInput');
const refInput = document.getElementById('referenceInput');
const uploaded = document.getElementById('uploaded');
const overlay = document.getElementById('defectOverlay');
const stage = document.getElementById('stage');
const pcb = document.getElementById('pcb');
const demoRows = [
  ['Open trace · copper gap', 'Missing 3.00 mm · coordinates in mm', 'HIGH'],
  ['Added copper bridge', 'Potential short · confirm netlist', 'REVIEW'],
  ['Missing copper pad', 'Reference flash absent in test', 'HIGH']
];
document.querySelector('.historyhead h2').textContent = 'Example findings';
document.getElementById('historyBtn').textContent = 'About findings →';
document.querySelectorAll('.histitem').forEach((row, index) => {
  const [title, description, status] = demoRows[index];
  row.querySelector('b').textContent = title;
  row.querySelector('small').textContent = description;
  row.querySelector('.histstatus').textContent = status;
});
let referenceBoard = null;
let testBoard = null;
let lastResult = null;
let boxes = true;
let zoom = 1;

document.getElementById('uploadBtn').onclick = () => fileInput.click();
document.getElementById('referenceBtn').onclick = () => refInput.click();
refInput.onchange = async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    referenceBoard = await parseDesignFile(file);
    document.getElementById('compareTag').textContent = 'CLEAN DESIGN LOADED';
    document.getElementById('referenceName').textContent = referenceBoard.name;
    toast(`Clean copper layer loaded: ${referenceBoard.name}`);
    if (testBoard) compareDesigns('Uploaded Gerber package pair');
  } catch (error) {
    referenceBoard = null;
    toast(error.message || 'Could not read that PCB design file.');
  }
};
fileInput.onchange = async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    testBoard = await parseDesignFile(file);
    document.getElementById('testName').textContent = testBoard.name;
    renderBoard(testBoard, []);
    document.getElementById('compareTag').textContent = referenceBoard ? 'READY TO COMPARE' : 'TEST DESIGN LOADED';
    if (referenceBoard) compareDesigns('Uploaded Gerber package pair');
    else toast('Test copper loaded. Add a clean reference Gerber design to inspect changes.');
  } catch (error) {
    testBoard = null;
    toast(error.message || 'Could not read that PCB design file.');
  }
};

document.getElementById('samplePairBtn').onclick = async () => {
  try {
    const [clean, fault] = await Promise.all([
      fetch('samples/manufacturing/trace-status-clean.zip').then(assertFetch).then(r => r.blob()),
      fetch('samples/manufacturing/trace-status-open-trace.zip').then(assertFetch).then(r => r.blob())
    ]);
    referenceBoard = await parseDesignFile(new File([clean], 'trace-status-clean.zip'));
    testBoard = await parseDesignFile(new File([fault], 'trace-status-open-trace.zip'));
    document.getElementById('referenceName').textContent = referenceBoard.name;
    document.getElementById('testName').textContent = testBoard.name;
    compareDesigns('Sample · open-trace Gerber artwork');
  } catch (error) {
    toast(error.message || 'Could not load the built-in Gerber sample.');
  }
};
document.getElementById('shortSampleBtn').onclick = async () => {
  try {
    const [clean, fault] = await Promise.all([
      fetch('samples/manufacturing/trace-status-clean.zip').then(assertFetch).then(r => r.blob()),
      fetch('samples/manufacturing/trace-status-copper-short.zip').then(assertFetch).then(r => r.blob())
    ]);
    referenceBoard = await parseDesignFile(new File([clean], 'trace-status-clean.zip'));
    testBoard = await parseDesignFile(new File([fault], 'trace-status-copper-short.zip'));
    document.getElementById('referenceName').textContent = referenceBoard.name;
    document.getElementById('testName').textContent = testBoard.name;
    compareDesigns('Sample · added-copper Gerber artwork');
  } catch (error) {
    toast(error.message || 'Could not load the built-in Gerber sample.');
  }
};

async function assertFetch(response) {
  if (!response.ok) throw new Error('Sample design package is unavailable. Try a manual Gerber ZIP upload.');
  return response;
}

async function parseDesignFile(file) {
  const extension = file.name.toLowerCase().split('.').pop();
  let layers;
  if (extension === 'zip') layers = await readGerberZip(file);
  else if (/^(gbr|ger|gtl|gbl|g[1-9]|gbx|pho|art)$/.test(extension)) {
    layers = [{ name: file.name, text: await file.text() }];
  } else {
    throw new Error('Choose a manufacturing Gerber ZIP, or a single copper Gerber layer (.gbr, .gtl, .gbl).');
  }
  const layer = layers.find(item => isCopperLayer(item.name));
  if (!layer) throw new Error('No copper Gerber layer found. Include a file named F_Cu, Top Copper, .GTL, or .GBR.');
  const parsed = parseGerber(layer.text);
  if (!parsed.operations.length) throw new Error('The copper Gerber contains no supported draw or flash features.');
  return { name: file.name, copperName: layer.name, operations: parsed.operations, warnings: parsed.warnings };
}

function isCopperLayer(name) {
  const lower = name.toLowerCase().replaceAll('\\', '/').split('/').pop();
  return /(^|[-_. ])(f[_ .-]?cu|front[_ .-]?copper|top[_ .-]?copper|gtl)([-_. ]|$)/i.test(lower)
    || /(^|\.)gtl$/i.test(lower)
    || /\.gbr$/i.test(lower) && /cu|copper|top/i.test(lower);
}

async function readGerberZip(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read32 = offset => view.getUint32(offset, true);
  let eocd = -1;
  for (let offset = Math.max(0, bytes.length - 65557); offset <= bytes.length - 22; offset++) {
    if (read32(offset) === 0x06054b50) eocd = offset;
  }
  if (eocd < 0) throw new Error('That ZIP archive could not be read. Re-export the Gerber package as a standard ZIP.');
  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = read32(eocd + 16);
  const files = [];
  for (let i = 0; i < entryCount; i++) {
    if (read32(cursor) !== 0x02014b50) throw new Error('The Gerber ZIP directory is damaged or uses an unsupported ZIP extension.');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = read32(cursor + 20);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = read32(cursor + 42);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error('Password-protected Gerber ZIP files are not supported.');
    if (compressedSize > 24 * 1024 * 1024) throw new Error('A file in this Gerber ZIP is too large for the browser demo.');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(start, start + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8 && 'DecompressionStream' in window) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error('This ZIP compression method is not supported by the current browser.');
    if (/\.(gbr|ger|gtl|gbl|g[1-9]|gbx|pho|art)$/i.test(name)) {
      files.push({ name, text: new TextDecoder('utf-8').decode(data) });
    }
  }
  return files;
}

function parseGerber(source) {
  const operations = [];
  const warnings = [];
  const apertures = new Map();
  let formatX = 6, formatY = 6, units = 'mm', currentAperture = null;
  let current = { x: 0, y: 0 }, polarity = 'positive';
  const extended = source.match(/%[^%]*%/gs) || [];
  for (const block of extended) {
    const content = block.slice(1, -1);
    for (const command of content.split('*').map(s => s.trim()).filter(Boolean)) {
      if (command.startsWith('FS')) {
        const match = command.match(/FSL?AX(\d)(\d)Y(\d)(\d)/);
        if (match) { formatX = Number(match[2]); formatY = Number(match[4]); }
      } else if (command === 'MOMM') units = 'mm';
      else if (command === 'MOIN') units = 'in';
      else if (command === 'LPD') polarity = 'positive';
      else if (command === 'LPC') polarity = 'clear';
      else if (command.startsWith('ADD')) {
        const match = command.match(/^ADD(\d+)([CRO]),?([0-9.]+)?(?:X([0-9.]+))?/);
        if (match) apertures.set(Number(match[1]), { shape: match[2], a: Number(match[3] || 0.2), b: Number(match[4] || match[3] || 0.2) });
        else warnings.push('An aperture macro was skipped; some copper detail may be missing.');
      } else if (command.startsWith('AM')) warnings.push('A macro aperture was skipped; some copper detail may be missing.');
    }
  }
  const body = source.replace(/%[^%]*%/gs, '').replace(/^\s*G04[^*]*(?:\*|$)/gim, '');
  const tokens = body.split('*').map(s => s.trim()).filter(Boolean);
  const coordinate = (token, axis, previous, precision) => {
    const match = token.match(new RegExp(axis + '([+-]?\\d+)'));
    if (!match) return previous;
    const raw = match[1], sign = raw.startsWith('-') ? -1 : 1, digits = raw.replace(/[+-]/g, '');
    const value = sign * Number(digits) / 10 ** precision;
    return units === 'in' ? value * 25.4 : value;
  };
  for (const token of tokens) {
    if (/^G0?[23]/.test(token)) { warnings.push('Circular Gerber arcs (G02/G03) are not supported in this demo; use a linearized manufacturing export.'); continue; }
    if (/G36|G37/.test(token)) { warnings.push('Filled Gerber regions (G36/G37) are not supported in this demo; use a line/flash copper export.'); continue; }
    if (/^G04/.test(token) || /^M0?[012]/.test(token)) continue;
    const dMatch = token.match(/D0?(\d+)/);
    if (!dMatch) continue;
    const d = Number(dMatch[1]);
    if (d >= 10 && !/[XY]/.test(token)) { currentAperture = apertures.get(d) || null; continue; }
    if (![1, 2, 3].includes(d)) continue;
    const next = {
      x: coordinate(token, 'X', current.x, formatX),
      y: coordinate(token, 'Y', current.y, formatY)
    };
    const aperture = currentAperture || { shape: 'C', a: 0.2, b: 0.2 };
    if (polarity === 'clear') warnings.push('Clear-polarity Gerber features were skipped; compare positive copper layers.');
    else if (d === 1 && Math.hypot(next.x - current.x, next.y - current.y) > 1e-6) {
      operations.push({ kind: 'line', x1: current.x, y1: current.y, x2: next.x, y2: next.y, width: units === 'in' ? aperture.a * 25.4 : aperture.a });
    } else if (d === 3) {
      operations.push({ kind: 'flash', x: next.x, y: next.y, shape: aperture.shape, a: units === 'in' ? aperture.a * 25.4 : aperture.a, b: units === 'in' ? aperture.b * 25.4 : aperture.b });
    }
    current = next;
  }
  return { operations, warnings: [...new Set(warnings)] };
}

function compareDesigns(label) {
  const started = performance.now();
  const refLines = referenceBoard.operations.filter(op => op.kind === 'line');
  const testLines = testBoard.operations.filter(op => op.kind === 'line');
  const refFlashes = referenceBoard.operations.filter(op => op.kind === 'flash');
  const testFlashes = testBoard.operations.filter(op => op.kind === 'flash');
  const defects = [];
  const tolerance = 0.025;

  for (const line of refLines) {
    const axis = Math.abs(line.x2 - line.x1) >= Math.abs(line.y2 - line.y1) ? 'x' : 'y';
    const start = Math.min(line[axis + '1'], line[axis + '2']);
    const end = Math.max(line[axis + '1'], line[axis + '2']);
    const covered = testLines.filter(candidate =>
      Math.abs(candidate.width - line.width) <= tolerance &&
      sameInfiniteLine(line, candidate, tolerance)
    ).map(candidate => [
      Math.max(start, Math.min(candidate[axis + '1'], candidate[axis + '2'])),
      Math.min(end, Math.max(candidate[axis + '1'], candidate[axis + '2']))
    ]).filter(([a, b]) => b - a > tolerance).sort((a, b) => a[0] - b[0]);
    let cursor = start;
    for (const [a, b] of covered) {
      if (a - cursor > tolerance) defects.push(makeGap(line, axis, cursor, a));
      cursor = Math.max(cursor, b);
    }
    if (end - cursor > tolerance) defects.push(makeGap(line, axis, cursor, end));
  }

  for (const line of testLines) {
    const redundantCoverage = refLines.some(reference =>
      Math.abs(reference.width - line.width) <= tolerance &&
      sameInfiniteLine(reference, line, tolerance) &&
      segmentCovers(reference, line, tolerance)
    );
    if (redundantCoverage) continue;
    const contacts = refLines.flatMap(reference => {
      const point = segmentIntersection(line, reference, tolerance);
      return point ? [point] : [];
    });
    const uniqueContacts = [];
    for (const point of contacts) {
      if (!uniqueContacts.some(other => Math.hypot(point.x - other.x, point.y - other.y) < 0.08)) uniqueContacts.push(point);
    }
    if (!refLines.some(reference => sameLineGeometry(reference, line, tolerance))) {
      const bridge = uniqueContacts.length >= 2;
      defects.push({
        type: bridge ? 'Added copper bridge' : 'Unexpected copper trace',
        detail: bridge
          ? 'New copper touches multiple existing traces. This is a potential short; confirm the nets with a netlist.'
          : 'This trace is present in the test Gerber but not in the clean reference.',
        x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2, width: line.width,
        x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2,
        length: Math.hypot(line.x2 - line.x1, line.y2 - line.y1),
        severity: bridge ? 'High' : 'Review'
      });
    }
  }

  for (const flash of refFlashes) {
    if (!testFlashes.some(candidate => sameFlash(flash, candidate, tolerance))) {
      defects.push({ type: 'Missing copper pad', detail: 'A copper flash/pad in the clean design is absent from the test Gerber.', x1: flash.x - flash.a / 2, x2: flash.x + flash.a / 2, y1: flash.y - flash.b / 2, y2: flash.y + flash.b / 2, x: flash.x, y: flash.y, severity: 'High' });
    }
  }
  for (const flash of testFlashes) {
    if (!refFlashes.some(candidate => sameFlash(flash, candidate, tolerance))) {
      defects.push({ type: 'Unexpected copper pad', detail: 'A copper flash/pad exists only in the test Gerber.', x1: flash.x - flash.a / 2, x2: flash.x + flash.a / 2, y1: flash.y - flash.b / 2, y2: flash.y + flash.b / 2, x: flash.x, y: flash.y, severity: 'Review' });
    }
  }

  lastResult = {
    label,
    defects,
    warnings: [...new Set([...referenceBoard.warnings, ...testBoard.warnings])],
    elapsed: ((performance.now() - started) / 1000).toFixed(2),
    referenceName: referenceBoard.name,
    testName: testBoard.name,
    copperName: testBoard.copperName,
    units: 'mm'
  };
  renderBoard(testBoard, defects);
  renderResults();
}

function sameInfiniteLine(a, b, tolerance) {
  const ax = a.x2 - a.x1, ay = a.y2 - a.y1, bx = b.x2 - b.x1, by = b.y2 - b.y1;
  const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (!lengths || Math.abs(ax * by - ay * bx) / lengths > 0.002) return false;
  return Math.abs(ax * (b.y1 - a.y1) - ay * (b.x1 - a.x1)) / Math.hypot(ax, ay) <= tolerance;
}
function segmentCovers(a, b, tolerance) {
  const axis = Math.abs(a.x2 - a.x1) >= Math.abs(a.y2 - a.y1) ? 'x' : 'y';
  return Math.min(b[axis + '1'], b[axis + '2']) >= Math.min(a[axis + '1'], a[axis + '2']) - tolerance &&
    Math.max(b[axis + '1'], b[axis + '2']) <= Math.max(a[axis + '1'], a[axis + '2']) + tolerance;
}
function sameLineGeometry(a, b, tolerance) {
  return Math.abs(a.width - b.width) <= tolerance &&
    sameInfiniteLine(a, b, tolerance) &&
    segmentCovers(a, b, tolerance) && segmentCovers(b, a, tolerance);
}
function sameFlash(a, b, tolerance) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance &&
    Math.abs(a.a - b.a) <= tolerance && Math.abs(a.b - b.b) <= tolerance;
}
function segmentIntersection(a, b, tolerance) {
  const dax = a.x2 - a.x1, day = a.y2 - a.y1, dbx = b.x2 - b.x1, dby = b.y2 - b.y1;
  const determinant = dax * dby - day * dbx;
  if (Math.abs(determinant) < 1e-8) return null;
  const dx = b.x1 - a.x1, dy = b.y1 - a.y1;
  const t = (dx * dby - dy * dbx) / determinant, u = (dx * day - dy * dax) / determinant;
  if (t < -tolerance || t > 1 + tolerance || u < -tolerance || u > 1 + tolerance) return null;
  return { x: a.x1 + t * dax, y: a.y1 + t * day };
}
function makeGap(line, axis, start, end) {
  const ratioA = (start - line[axis + '1']) / (line[axis + '2'] - line[axis + '1']);
  const ratioB = (end - line[axis + '1']) / (line[axis + '2'] - line[axis + '1']);
  const a = { x: line.x1 + ratioA * (line.x2 - line.x1), y: line.y1 + ratioA * (line.y2 - line.y1) };
  const b = { x: line.x1 + ratioB * (line.x2 - line.x1), y: line.y1 + ratioB * (line.y2 - line.y1) };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return { type: 'Open trace · copper gap', detail: `Reference copper is missing over a ${length.toFixed(2)} mm gap along the original track.`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, length, width: line.width, severity: 'High' };
}

function renderBoard(board, defects) {
  const ops = board.operations;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const op of ops) {
    const pad = op.kind === 'line' ? op.width / 2 : Math.max(op.a, op.b) / 2;
    const xs = op.kind === 'line' ? [op.x1, op.x2] : [op.x];
    const ys = op.kind === 'line' ? [op.y1, op.y2] : [op.y];
    minX = Math.min(minX, ...xs.map(x => x - pad)); maxX = Math.max(maxX, ...xs.map(x => x + pad));
    minY = Math.min(minY, ...ys.map(y => y - pad)); maxY = Math.max(maxY, ...ys.map(y => y + pad));
  }
  const padding = Math.max(maxX - minX, maxY - minY) * 0.08 || 2;
  minX -= padding; maxX += padding; minY -= padding; maxY += padding;
  const pxPerMm = 22, width = Math.max(900, Math.round((maxX - minX) * pxPerMm)), height = Math.max(480, Math.round((maxY - minY) * pxPerMm));
  const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
  const actualWidth = (maxX - minX) * scale, actualHeight = (maxY - minY) * scale;
  const ox = (width - actualWidth) / 2, oy = (height - actualHeight) / 2;
  const X = x => ox + (x - minX) * scale;
  const Y = y => height - oy - (y - minY) * scale;
  const shapes = ops.map(op => op.kind === 'line'
    ? `<path d="M ${X(op.x1)} ${Y(op.y1)} L ${X(op.x2)} ${Y(op.y2)}" stroke="#dfbd7f" stroke-width="${Math.max(1, op.width * scale)}" stroke-linecap="round"/>`
    : op.shape === 'R'
      ? `<rect x="${X(op.x) - op.a * scale / 2}" y="${Y(op.y) - op.b * scale / 2}" width="${op.a * scale}" height="${op.b * scale}" rx="2" fill="#dfbd7f"/>`
      : `<circle cx="${X(op.x)}" cy="${Y(op.y)}" r="${Math.max(op.a, op.b) * scale / 2}" fill="#dfbd7f"/>`
  ).join('');
  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="18" fill="#10291f"/><rect x="${ox}" y="${oy}" width="${actualWidth}" height="${actualHeight}" rx="10" fill="#145439" stroke="#b89b67" stroke-width="3"/><g opacity=".16" fill="#e8dabd">${Array.from({length: Math.max(1, Math.floor(actualWidth / 32))}, (_,i)=>Array.from({length:Math.max(1,Math.floor(actualHeight/32))},(_,j)=>`<circle cx="${ox+14+i*32}" cy="${oy+14+j*32}" r="1.4"/>`).join('')).join('')}</g><g fill="none" stroke-linejoin="round">${shapes}</g><text x="22" y="31" font-family="monospace" font-size="13" fill="#d9d2c0" opacity=".85">${escapeSvg(board.name)} · ${escapeSvg(board.copperName)}</text><text x="22" y="${height-18}" font-family="monospace" font-size="12" fill="#d9d2c0" opacity=".8">GERBER COPPER · DESIGN UNITS MM</text></svg>`;
  const marks = defects.map((defect, i) => {
    const ax = X(defect.x1 ?? defect.x), bx = X(defect.x2 ?? defect.x);
    const ay = Y(defect.y1 ?? defect.y), by = Y(defect.y2 ?? defect.y);
    const pad = Math.max(13, (defect.width || 0.65) * scale * 2, 20);
    const left = Math.min(ax, bx) - pad, top = Math.min(ay, by) - pad, w = Math.max(Math.abs(bx - ax) + 2*pad, 30), h = Math.max(Math.abs(by - ay) + 2*pad, 30);
    return `<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="7" fill="#f0847618" stroke="#ff7467" stroke-width="3"/><circle cx="${X(defect.x)}" cy="${Y(defect.y)}" r="7" fill="#ff7467" stroke="#fff0e0" stroke-width="2"/><text x="${left}" y="${Math.max(46,top-7)}" font-family="monospace" font-weight="bold" font-size="14" fill="#ff9588">DEFECT ${i+1}</text>`;
  }).join('');
  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${marks}</svg>`;
  const data = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  uploaded.src = data(base);
  uploaded.onload = () => {
    uploaded.style.display = 'block'; pcb.style.display = 'none';
    overlay.src = data(overlaySvg); overlay.style.display = defects.length && boxes ? 'block' : 'none';
  };
}
function escapeSvg(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function renderResults() {
  const result = lastResult, defects = result.defects;
  document.getElementById('compareTag').textContent = defects.length ? `${defects.length} FINDING${defects.length === 1 ? '' : 'S'} FOUND` : 'GEOMETRY MATCH';
  document.getElementById('stageLabel').textContent = `${result.label.toUpperCase()} · ${defects.length} GEOMETRY FINDING${defects.length === 1 ? '' : 'S'}`;
  document.getElementById('faultCount').textContent = String(defects.length).padStart(2, '0');
  document.getElementById('faultCaption').textContent = defects.length ? 'geometry findings' : 'no copper changes';
  document.getElementById('scoreValue').innerHTML = `${Math.max(0, 100 - defects.length * 12)} <em>/ 100</em>`;
  document.getElementById('confidenceValue').textContent = defects.length ? 'Review' : 'Matched';
  document.getElementById('severity').textContent = defects.length ? 'DESIGN REVIEW' : 'GEOMETRY MATCH';
  document.getElementById('timeValue').innerHTML = `${result.elapsed} <small>s</small>`;
  document.getElementById('resultsList').replaceChildren();
  if (!defects.length) addResultRow('Copper geometry', 'No difference');
  defects.forEach((defect, i) => {
    const row = document.createElement('div');
    row.className = 'defect-result';
    const title = document.createElement('strong');
    title.textContent = `${i + 1}. ${defect.type}`;
    const detail = document.createElement('span');
    detail.textContent = defect.detail;
    const coords = document.createElement('small');
    coords.textContent = `X ${defect.x.toFixed(3)} mm · Y ${defect.y.toFixed(3)} mm${defect.length ? ` · ${defect.length.toFixed(2)} mm` : ''} · ${defect.severity}`;
    row.append(title, detail, coords);
    document.getElementById('resultsList').append(row);
  });
  result.warnings.forEach(warning => addResultRow('Parser note', warning));
  addResultRow('Compared layer', result.copperName);
  addResultRow('Reference design', result.referenceName);
  addResultRow('Test design', result.testName);
  if (!defects.length) toast('Copper geometry matches the clean reference.');
  else toast(`${defects.length} design finding${defects.length === 1 ? '' : 's'} located in Gerber coordinates.`);
}
function addResultRow(label, value) {
  const row = document.createElement('div');
  row.className = 'breakrow';
  const key = document.createElement('span'); key.className = 'breakname'; key.textContent = label;
  const val = document.createElement('span'); val.className = 'breakcount'; val.textContent = value;
  row.append(key, val); document.getElementById('resultsList').append(row);
}

document.getElementById('boxesBtn').onclick = event => {
  boxes = !boxes;
  overlay.style.display = boxes && lastResult?.defects.length ? 'block' : 'none';
  event.currentTarget.classList.toggle('active', boxes);
};
document.getElementById('scanBtn').onclick = event => {
  document.getElementById('scanline').classList.toggle('paused');
  event.currentTarget.classList.toggle('active');
};
function updateZoom() {
  uploaded.style.transform = `scale(${zoom})`;
  overlay.style.transform = `translate(-50%,-50%) scale(${zoom})`;
  pcb.style.transform = `scale(${zoom})`;
}
document.getElementById('zoomIn').onclick = () => { zoom = Math.min(1.35, zoom + 0.1); updateZoom(); };
document.getElementById('zoomOut').onclick = () => { zoom = Math.max(0.8, zoom - 0.1); updateZoom(); };
document.getElementById('downloadBtn').onclick = () => {
  if (!lastResult) { toast('Compare two Gerber designs before exporting a report.'); return; }
  const report = {
    product: 'Trace PCB Design Comparison',
    result: lastResult.defects.length ? 'review' : 'geometry-match',
    reference: lastResult.referenceName,
    test: lastResult.testName,
    layer: lastResult.copperName,
    coordinateUnits: 'mm',
    findings: lastResult.defects.map(({ type, detail, x, y, x1, y1, x2, y2, length, severity }) => ({ type, detail, location_mm: { x, y }, bounds_mm: { x1, y1, x2, y2 }, length_mm: length, severity })),
    parserNotes: lastResult.warnings,
    limitation: 'Static geometry comparison of parsed Gerber copper. It does not run electrical connectivity, netlist/DRC checks, optical inspection, or verify the fabricated board.'
  };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  link.download = 'trace-pcb-design-inspection.json'; link.click(); URL.revokeObjectURL(link.href);
};
document.getElementById('historyBtn').onclick = () => toast('Examples show a copper gap, added bridge, and missing pad. A netlist is needed to confirm electrical shorts.');
