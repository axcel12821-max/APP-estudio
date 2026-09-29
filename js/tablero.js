'use strict';
/* ============ Tablero de una tarea conjunta ============
   Cada tarea conjunta tiene su propio tablero (task.board, ver newBoard en core.js):
   { id, createdAt, updatedAt, view: { x, y, zoom }, grid, items: [] }.
   Es una hoja blanca (con o sin cuadrícula) con tres tipos de elementos, todos en
   coordenadas del tablero (no de la pantalla), así se ven igual con cualquier zoom:
   - trazo:  { id, type: 'stroke', color, size, points: [[x, y], …] }
   - texto:  { id, type: 'text', x, y, text, color, font, size, bold, italic, underline }
   - marco:  { id, type: 'frame', x, y, w, h, title }  (mini tablero con título)
   Se dibujan en capas: marcos abajo, trazos en el medio y textos arriba.
   El borrador borra solo la parte del trazo por donde pasa (y textos que toca).
   Con "Mover" se seleccionan, mueven y borran (Supr) textos y marcos; un marco
   arrastra lo que tiene adentro y se agranda desde su esquina. */

const BOARD_ZOOM_MIN = 0.25, BOARD_ZOOM_MAX = 3, BOARD_GRID = 24;
const PEN_COLORS = ['#1f2330', '#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#7c3aed'];
// Tamaños ajustables con los botones de la barra o Ctrl + / Ctrl − (y [ / ])
const PEN_SIZE = { min: 1, max: 40, def: 4 };      // grosor del trazo (en el tablero)
const ERASER_SIZE = { min: 6, max: 120, def: 24 }; // diámetro del borrador (en pantalla)
const TEXT_SIZE = { min: 8, max: 120, def: 20 };   // tamaño de letra (en el tablero)
const BOARD_FONTS = {
  sans: { label: 'Sans', css: 'var(--font-ui), system-ui, sans-serif' },
  serif: { label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  mono: { label: 'Mono', css: '"Cascadia Code", Consolas, "Courier New", monospace' },
  hand: { label: 'Manuscrita', css: '"Segoe Print", "Comic Sans MS", "Bradley Hand", cursive' },
};
const FRAME_DEFAULT = { w: 360, h: 240 };
const FRAME_TITLE_SIZE = { min: 8, max: 72, def: 14 }; // letra del título del marco (en el tablero)
const FRAME_MIN = 60;
const UNDO_MAX = 50;
const TOOL_PREFS_KEY = 'focusly-board-tools';      // preferencias de este navegador
const boardCanvas = $('#boardCanvas');
const boardLayer = $('#boardLayer');
const NS = 'http://www.w3.org/2000/svg';

let boardTask = null;          // tarea conjunta abierta
let boardSaveT = null;
let boardTool = 'pen';         // 'move' | 'pen' | 'eraser' | 'text' | 'frame'
let penColor = PEN_COLORS[0];
let penSize = PEN_SIZE.def;
let eraserSize = ERASER_SIZE.def;
let textPrefs = { color: PEN_COLORS[0], font: 'sans', size: TEXT_SIZE.def, bold: false, italic: false, underline: false };
let boardUndo = [];            // copias de los elementos antes de cada cambio (Ctrl+Z)
const selected = new Set();    // ids de los elementos seleccionados (uno o varios)
let editing = null;            // texto en edición: { item, before }
const textEls = new Map();     // id → elemento del texto (para medirlo)

try {
  const p = JSON.parse(localStorage.getItem(TOOL_PREFS_KEY)) || {};
  if (PEN_COLORS.includes(p.penColor)) penColor = p.penColor;
  if (p.penSize >= PEN_SIZE.min && p.penSize <= PEN_SIZE.max) penSize = p.penSize;
  if (p.eraserSize >= ERASER_SIZE.min && p.eraserSize <= ERASER_SIZE.max) eraserSize = p.eraserSize;
  if (p.text && BOARD_FONTS[p.text.font]) textPrefs = { ...textPrefs, ...p.text };
} catch (e) {}
const saveToolPrefs = () => { try { localStorage.setItem(TOOL_PREFS_KEY, JSON.stringify({ penColor, penSize, eraserSize, text: textPrefs })); } catch (e) {} };

const boardById = id => state.teamTasks.find(t => t.id === id);
const boardItems = () => boardTask.board.items;
const itemById = id => boardItems().find(i => i.id === id);
const selectedItems = () => boardItems().filter(i => selected.has(i.id));
/** El elemento seleccionado, si hay exactamente uno. */
const singleSelected = () => selected.size === 1 ? itemById([...selected][0]) || null : null;

/** Abre el tablero de una tarea conjunta (cierra la lista si estaba abierta). */
function openBoard(id) {
  $('#teamListDialog').open && $('#teamListDialog').close();
  location.hash = '#tablero/' + encodeURIComponent(id);
}

/* ---------- Vista: desplazamiento, zoom y cuadrícula ---------- */
function applyBoardView() {
  const v = boardTask.board.view;
  boardLayer.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  boardCanvas.style.setProperty('--grid', `${BOARD_GRID * v.zoom}px`);
  boardCanvas.style.backgroundPosition = `${v.x}px ${v.y}px`;
  $('#boardZoomReset').textContent = `${Math.round(v.zoom * 100)}%`;
  const grid = boardTask.board.grid !== false;
  boardCanvas.classList.toggle('no-grid', !grid);
  $('#boardGridToggle').setAttribute('aria-pressed', String(grid));
  renderToolOptions(); // la vista previa del lápiz depende del zoom
}

/** Guarda un momento después del último cambio (no en cada movimiento del mouse). */
function persistBoard(delay = 400) {
  clearTimeout(boardSaveT);
  const task = boardTask;
  boardSaveT = setTimeout(() => {
    boardSaveT = null;
    task.board.updatedAt = new Date().toISOString();
    save();
  }, delay);
}

function zoomBoard(factor, cx, cy) {
  const v = boardTask.board.view;
  const z = Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, v.zoom * factor));
  if (z === v.zoom) return;
  // Mantiene fijo el punto bajo el cursor (o el centro) al acercar/alejar
  if (cx === undefined) { cx = boardCanvas.clientWidth / 2; cy = boardCanvas.clientHeight / 2; }
  v.x = cx - (cx - v.x) * (z / v.zoom);
  v.y = cy - (cy - v.y) * (z / v.zoom);
  v.zoom = z;
  applyBoardView();
  persistBoard();
}

function panBoard(dx, dy) {
  const v = boardTask.board.view;
  v.x += dx; v.y += dy;
  applyBoardView();
  persistBoard();
}

function resetBoardView() {
  Object.assign(boardTask.board.view, { x: 0, y: 0, zoom: 1 });
  applyBoardView();
  persistBoard();
}

function toggleGrid() {
  boardTask.board.grid = boardTask.board.grid === false;
  applyBoardView();
  persistBoard(0);
}

/** Punto del evento relativo al interior del lienzo (sin contar su borde). */
function canvasPoint(e) {
  const r = boardCanvas.getBoundingClientRect();
  return [e.clientX - r.left - boardCanvas.clientLeft, e.clientY - r.top - boardCanvas.clientTop];
}
/** Punto de pantalla (evento) → coordenadas del tablero. */
function toBoard(e) {
  const [sx, sy] = canvasPoint(e);
  const v = boardTask.board.view;
  return [(sx - v.x) / v.zoom, (sy - v.y) / v.zoom];
}

/* ---------- Dibujo de los elementos ---------- */
const r1 = n => Math.round(n * 10) / 10;

/** Camino SVG suavizado (curvas por los puntos medios). */
function strokePath(pts) {
  if (!pts.length) return '';
  const [x0, y0] = pts[0];
  if (pts.length === 1) return `M${x0} ${y0}l0.01 0`; // un toque: punto
  let d = `M${x0} ${y0}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i], [nx, ny] = pts[i + 1];
    d += `Q${x} ${y} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + `L${lx} ${ly}`;
}

function strokeEl(s) {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', strokePath(s.points));
  p.setAttribute('stroke', s.color);
  p.setAttribute('stroke-width', s.size);
  p.dataset.id = s.id;
  return p;
}

function styleText(el, t) {
  el.style.left = `${t.x}px`;
  el.style.top = `${t.y}px`;
  el.style.color = t.color;
  el.style.fontFamily = (BOARD_FONTS[t.font] || BOARD_FONTS.sans).css;
  el.style.fontSize = `${t.size}px`;
  el.style.fontWeight = t.bold ? '700' : '400';
  el.style.fontStyle = t.italic ? 'italic' : 'normal';
  el.style.textDecoration = t.underline ? 'underline' : 'none';
}

function textEl(t) {
  const el = document.createElement('div');
  el.className = 'board-text';
  el.dataset.id = t.id;
  el.textContent = t.text;
  styleText(el, t);
  return el;
}

function frameEl(f) {
  const el = document.createElement('div');
  el.className = 'board-frame';
  el.dataset.id = f.id;
  el.style.left = `${f.x}px`; el.style.top = `${f.y}px`;
  el.style.width = `${f.w}px`; el.style.height = `${f.h}px`;
  el.innerHTML = `<input class="frame-title" type="text" maxlength="60" placeholder="Título del marco" aria-label="Título del marco"><span class="frame-handle"></span>`;
  const input = el.firstChild;
  input.value = f.title || '';
  input.style.fontSize = `${f.titleSize || FRAME_TITLE_SIZE.def}px`;
  sizeFrameTitle(input);
  return el;
}
/** El título (afuera del marco, arriba a la izquierda) se ajusta al largo de lo escrito. */
function sizeFrameTitle(input) {
  input.style.width = `${(input.value ? input.value.length : input.placeholder.length) + 2}ch`;
}

/** Vuelve a dibujar todo (el texto en edición se conserva tal cual). */
function renderItems() {
  const items = boardItems();
  $('#boardFrames').replaceChildren(...items.filter(i => i.type === 'frame').map(frameEl));
  $('#boardStrokes').replaceChildren(...items.filter(i => i.type === 'stroke').map(strokeEl));
  const keep = editing && textEls.get(editing.item.id);
  textEls.clear();
  $('#boardTexts').replaceChildren(...items.filter(i => i.type === 'text').map(t => {
    const el = keep && t === editing.item ? keep : textEl(t);
    textEls.set(t.id, el);
    return el;
  }));
  markSelection();
  $('#boardEmpty').hidden = items.length > 0 || !!editing;
}

function markSelection() {
  [...selected].forEach(id => { if (!itemById(id)) selected.delete(id); });
  $$('#boardLayer .selected').forEach(el => el.classList.remove('selected'));
  $$('#boardLayer .solo').forEach(el => el.classList.remove('solo'));
  selected.forEach(id => $(`#boardLayer [data-id="${id}"]`)?.classList.add('selected'));
  if (selected.size === 1) $(`#boardLayer [data-id="${[...selected][0]}"]`)?.classList.add('solo');
  // Recuadro alrededor de todo lo seleccionado (si son varios o hay trazos)
  const box = $('#boardSelBox');
  const items = selectedItems();
  const show = items.length > 1 || items.some(i => i.type === 'stroke');
  box.hidden = !show;
  if (show) {
    const b = unionBox(items);
    const pad = 6 / boardTask.board.view.zoom;
    Object.assign(box.style, { left: `${b.x - pad}px`, top: `${b.y - pad}px`, width: `${b.w + pad * 2}px`, height: `${b.h + pad * 2}px` });
  }
  const n = selected.size;
  $('#boardClearLabel').textContent = n ? (n > 1 ? `Borrar ${n}` : 'Selección') : 'Todo';
  $('#boardClear').title = n ? 'Borrar lo seleccionado (Supr)' : 'Borrar todo';
}

/** Selecciona: null (nada), un id o una lista de ids. `add` suma a lo ya seleccionado. */
function select(ids, add = false) {
  if (!add) selected.clear();
  (ids == null ? [] : Array.isArray(ids) ? ids : [ids]).forEach(id => selected.add(id));
  markSelection();
  renderToolOptions();
}

/* ---------- Deshacer ---------- */
function pushUndo(snapshot = JSON.stringify(boardItems())) {
  boardUndo.push(snapshot);
  if (boardUndo.length > UNDO_MAX) boardUndo.shift();
}
function undoBoard() {
  if (!boardTask || !boardUndo.length) return;
  if (editing) finishEdit();
  boardTask.board.items = JSON.parse(boardUndo.pop());
  renderItems();
  persistBoard(0);
}

/* ---------- Ubicar elementos bajo el puntero ---------- */
function textBox(t) {
  const el = textEls.get(t.id);
  return { x: t.x, y: t.y, w: el ? el.offsetWidth : 0, h: el ? el.offsetHeight : 0 };
}
const inBox = (x, y, b, pad = 0) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

/** Rectángulo que ocupa un elemento (en coordenadas del tablero). */
function itemBox(i) {
  if (i.type === 'text') return textBox(i);
  if (i.type === 'frame') return { x: i.x, y: i.y, w: i.w, h: i.h };
  const xs = i.points.map(p => p[0]), ys = i.points.map(p => p[1]);
  const h = i.size / 2;
  const x0 = Math.min(...xs) - h, y0 = Math.min(...ys) - h;
  return { x: x0, y: y0, w: Math.max(...xs) + h - x0, h: Math.max(...ys) + h - y0 };
}
function unionBox(items) {
  const bs = items.map(itemBox);
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  return { x: x0, y: y0, w: Math.max(...bs.map(b => b.x + b.w)) - x0, h: Math.max(...bs.map(b => b.y + b.h)) - y0 };
}
const boxesOverlap = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
const boxInside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** Distancia de (x, y) a la línea central del trazo. */
function strokeDistance(s, x, y) {
  const P = s.points;
  if (P.length === 1) return Math.hypot(P[0][0] - x, P[0][1] - y);
  let best = Infinity;
  for (let k = 0; k < P.length - 1; k++) {
    const [ax, ay] = P[k], [bx, by] = P[k + 1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

/** Elemento bajo (x, y), de arriba hacia abajo: textos, trazos y por último marcos. */
function itemAt(x, y) {
  const items = boardItems();
  const pad = 5 / boardTask.board.view.zoom;
  for (let i = items.length - 1; i >= 0; i--) if (items[i].type === 'text' && inBox(x, y, textBox(items[i]), pad)) return items[i];
  for (let i = items.length - 1; i >= 0; i--) if (items[i].type === 'stroke' && strokeDistance(items[i], x, y) <= items[i].size / 2 + pad) return items[i];
  for (let i = items.length - 1; i >= 0; i--) if (items[i].type === 'frame' && inBox(x, y, items[i])) return items[i];
  return null;
}

/** Elementos dentro del recuadro de selección: marcos enteros adentro; lo demás, con solo tocarlo. */
function itemsInRect(rect) {
  return boardItems().filter(i => i.type === 'frame' ? boxInside(itemBox(i), rect) : boxesOverlap(itemBox(i), rect));
}

/** ¿(x, y) está sobre la esquina para agrandar el marco seleccionado? */
function onFrameHandle(x, y) {
  const f = singleSelected();
  if (!f || f.type !== 'frame') return null;
  const tol = 10 / boardTask.board.view.zoom;
  return Math.abs(x - (f.x + f.w)) <= tol && Math.abs(y - (f.y + f.h)) <= tol ? f : null;
}

/** Lo que está completamente dentro de un marco (se mueve con él). */
function frameContents(f) {
  const b = { x: f.x, y: f.y, w: f.w, h: f.h };
  return boardItems().filter(i =>
    (i.type === 'stroke' && i.points.every(([px, py]) => inBox(px, py, b))) ||
    (i.type === 'text' && inBox(i.x, i.y, b)));
}

/* ---------- Borrador ---------- */
/** Parte del segmento A→B (t de 0 a 1) dentro del círculo (cx, cy, R), o null si no lo toca. */
function segmentInCircle([ax, ay], [bx, by], cx, cy, R) {
  const dx = bx - ax, dy = by - ay;
  const fx = ax - cx, fy = ay - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return fx * fx + fy * fy <= R * R ? [0, 1] : null; // segmento de largo 0
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - R * R;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = Math.max(0, (-b - sq) / (2 * a));
  const t1 = Math.min(1, (-b + sq) / (2 * a));
  return t0 <= t1 ? [t0, t1] : null;
}

/**
 * Borra con un círculo de radio r (coordenadas del tablero) centrado en (x, y).
 * Los trazos se cortan exactamente donde entran y salen del círculo (a r + medio grosor,
 * así el extremo redondeado que queda termina en el borde del borrador).
 * Un texto que el círculo toque se borra entero. Los marcos no se borran con el borrador.
 */
function eraseAt(x, y, r) {
  const items = boardItems();
  let changed = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const s = items[i];
    if (s.type === 'text') {
      const b = textBox(s);
      const nx = Math.max(b.x, Math.min(x, b.x + b.w)), ny = Math.max(b.y, Math.min(y, b.y + b.h));
      if ((nx - x) ** 2 + (ny - y) ** 2 <= r * r) { items.splice(i, 1); changed = true; }
      continue;
    }
    if (s.type !== 'stroke') continue;
    const R = r + s.size / 2;
    const P = s.points;
    if (P.length === 1) { // un punto suelto
      if ((P[0][0] - x) ** 2 + (P[0][1] - y) ** 2 <= R * R) { items.splice(i, 1); changed = true; }
      continue;
    }
    const pieces = [];
    let cur = [];
    let hit = false;
    const at = (A, B, t) => [r1(A[0] + (B[0] - A[0]) * t), r1(A[1] + (B[1] - A[1]) * t)];
    if (!segmentInCircle(P[0], P[0], x, y, R)) cur.push(P[0]);
    for (let k = 0; k < P.length - 1; k++) {
      const A = P[k], B = P[k + 1];
      const inside = segmentInCircle(A, B, x, y, R);
      if (!inside) { cur.push(B); continue; }
      hit = true;
      const [t0, t1] = inside;
      if (t0 > 0) cur.push(at(A, B, t0));
      if (cur.length > 1) pieces.push(cur);
      cur = t1 < 1 ? [at(A, B, t1), B] : [];
    }
    if (cur.length > 1) pieces.push(cur);
    if (!hit) continue;
    changed = true;
    // Descartar restos de largo casi nulo
    const keep = pieces.filter(pc => pc.some(([px, py]) => Math.hypot(px - pc[0][0], py - pc[0][1]) > 0.5));
    items.splice(i, 1, ...keep.map((pts, k) => ({ ...s, id: k ? uid() : s.id, points: pts })));
  }
  return changed;
}

/* ---------- Texto ---------- */
/** Texto al que se aplican las opciones: el que se edita o el seleccionado. */
function textTarget() {
  if (editing) return editing.item;
  const s = singleSelected();
  return s?.type === 'text' ? s : null;
}

function startEdit(t, before = JSON.stringify(boardItems())) {
  if (editing) finishEdit();
  editing = { item: t, before };
  selected.clear();
  selected.add(t.id);
  renderItems();
  const el = textEls.get(t.id);
  el.contentEditable = 'true';
  el.classList.add('editing');
  el.focus({ preventScroll: true });
  // Cursor al final del texto
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  renderToolOptions();
}

/** Cierra la edición: un texto vacío se descarta; si cambió, se puede deshacer. */
function finishEdit() {
  if (!editing) return;
  const { item, before } = editing;
  const el = textEls.get(item.id);
  editing = null;
  if (el) { el.contentEditable = 'false'; el.classList.remove('editing'); }
  item.text = (el ? el.innerText : item.text).replace(/\n+$/, '');
  if (!item.text.trim()) {
    boardItems().splice(boardItems().indexOf(item), 1);
    selected.delete(item.id);
  }
  if (JSON.stringify(boardItems()) !== before) { pushUndo(before); persistBoard(0); }
  renderItems();
  renderToolOptions();
}

// El texto se guarda mientras se escribe (no solo al terminar)
$('#boardTexts').addEventListener('input', e => {
  if (!editing || e.target !== textEls.get(editing.item.id)) return;
  editing.item.text = e.target.innerText.replace(/\n+$/, '');
  persistBoard();
});
$('#boardTexts').addEventListener('focusout', e => {
  if (editing && e.target === textEls.get(editing.item.id)) finishEdit();
});
$('#boardTexts').addEventListener('keydown', e => {
  if (!editing) return;
  if (e.key === 'Escape') { e.preventDefault(); finishEdit(); boardCanvas.focus({ preventScroll: true }); return; }
  // Ctrl+B / I / U: estilo del texto entero
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(k)) {
    e.preventDefault();
    toggleTextStyle({ b: 'bold', i: 'italic', u: 'underline' }[k]);
  }
});
// Pegar solo como texto (sin formato de otras páginas)
$('#boardTexts').addEventListener('paste', e => {
  if (!editing) return;
  e.preventDefault();
  document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
});

/** Cambia una opción de texto: en el texto actual (si hay) y para los próximos. */
function setTextOption(key, value) {
  textPrefs[key] = value;
  saveToolPrefs();
  const t = textTarget();
  if (t && t[key] !== value) {
    if (!editing) pushUndo();
    t[key] = value;
    const el = textEls.get(t.id);
    if (el) styleText(el, t);
    persistBoard();
  }
  renderToolOptions();
}
function toggleTextStyle(key) {
  const t = textTarget();
  setTextOption(key, !(t ? t[key] : textPrefs[key]));
}

/* ---------- Herramientas y sus opciones ---------- */
function setBoardTool(tool) {
  if (editing && tool !== 'text') finishEdit();
  boardTool = tool;
  $$('.board-tool[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  boardCanvas.classList.remove('tool-move', 'tool-select', 'tool-pen', 'tool-eraser', 'tool-text', 'tool-frame');
  boardCanvas.classList.add('tool-' + tool);
  $('#boardEraser').hidden = true;
  if (!['move', 'select', 'text'].includes(tool)) select(null);
  renderToolOptions();
}

/** Opciones visibles según la herramienta (o el texto seleccionado). */
/** Marco seleccionado solo (su título se agranda y achica como un texto). */
function frameTarget() {
  const s = singleSelected();
  return s?.type === 'frame' && (boardTool === 'move' || boardTool === 'select') ? s : null;
}

function renderToolOptions() {
  const t = textTarget();
  const fr = !t && frameTarget();
  const mode = boardTool === 'pen' ? 'pen' : boardTool === 'eraser' ? 'eraser' : (boardTool === 'text' || t) ? 'text' : fr ? 'frame' : null;
  $('#boardToolOpts').hidden = !mode;
  if (!mode) return;
  if (mode === 'frame') {
    $('#boardColors').hidden = $('#boardFonts').hidden = $('#boardStyles').hidden = true;
    const prev = $('#boardSizePreview');
    prev.className = 'board-size-preview text';
    prev.style.setProperty('--c', 'var(--text)');
    const dot = prev.firstElementChild;
    const size = fr.titleSize || FRAME_TITLE_SIZE.def;
    dot.textContent = 'T';
    dot.style.width = dot.style.height = '';
    dot.style.fontFamily = 'var(--font-ui)';
    dot.style.fontSize = `${Math.max(10, Math.min(24, size))}px`;
    $('#boardSizeNum').textContent = `Título ${size}px`;
    $('#boardSizeUp').title = 'Agrandar el título del marco (Ctrl +)';
    $('#boardSizeDown').title = 'Achicar el título del marco (Ctrl -)';
    return;
  }
  const tp = t || textPrefs;
  const color = mode === 'text' ? tp.color : penColor;
  $('#boardColors').hidden = mode === 'eraser';
  $('#boardColors').innerHTML = PEN_COLORS.map(c =>
    `<button type="button" class="board-color" style="background:${c}" data-color="${c}" aria-pressed="${c === color}" aria-label="Color ${c}"></button>`).join('');
  $('#boardFonts').hidden = $('#boardStyles').hidden = mode !== 'text';
  if (mode === 'text') {
    $('#boardFonts').innerHTML = Object.entries(BOARD_FONTS).map(([k, f]) =>
      `<button type="button" class="board-font" data-font="${k}" aria-pressed="${k === tp.font}" title="${f.label}" style="font-family:${f.css}">Aa</button>`).join('');
    $$('#boardStyles [data-style]').forEach(b => b.setAttribute('aria-pressed', String(!!tp[b.dataset.style])));
  }
  const prev = $('#boardSizePreview');
  prev.className = `board-size-preview ${mode}`;
  prev.style.setProperty('--c', color);
  const dot = prev.firstElementChild;
  if (mode === 'text') {
    dot.textContent = 'A';
    dot.style.width = dot.style.height = '';
    dot.style.fontFamily = (BOARD_FONTS[tp.font] || BOARD_FONTS.sans).css;
    dot.style.fontSize = `${Math.max(10, Math.min(24, tp.size * 0.8))}px`;
  } else {
    dot.textContent = '';
    dot.style.fontFamily = dot.style.fontSize = '';
    // Vista previa a escala de pantalla (el lápiz se ve según el zoom actual)
    const px = mode === 'eraser' ? eraserSize : penSize * (boardTask?.board.view.zoom || 1);
    dot.style.width = dot.style.height = `${Math.max(3, Math.min(28, px))}px`;
  }
  $('#boardSizeNum').textContent = `${mode === 'eraser' ? eraserSize : mode === 'text' ? tp.size : penSize}px`;
  const name = { pen: 'lápiz', eraser: 'borrador', text: 'texto' }[mode];
  $('#boardSizeUp').title = `Agrandar ${name} (Ctrl +)`;
  $('#boardSizeDown').title = `Achicar ${name} (Ctrl -)`;
}

/** Agranda (dir 1) o achica (dir -1) el lápiz, el borrador o el texto, a pasos proporcionales. */
function stepToolSize(dir) {
  const step = v => Math.max(1, Math.round(v * 0.2));
  const clamp = (v, r) => Math.min(r.max, Math.max(r.min, v));
  if (boardTool === 'eraser') eraserSize = clamp(eraserSize + dir * step(eraserSize), ERASER_SIZE);
  else if (boardTool === 'pen') penSize = clamp(penSize + dir * step(penSize), PEN_SIZE);
  else if (frameTarget() && !textTarget()) {
    const f = frameTarget();
    const cur = f.titleSize || FRAME_TITLE_SIZE.def;
    const next = clamp(cur + dir * step(cur), FRAME_TITLE_SIZE);
    if (next === cur) return true;
    pushUndo();
    f.titleSize = next;
    renderItems();
    renderToolOptions();
    persistBoard();
    return true;
  } else if (boardTool === 'text' || textTarget()) {
    const cur = (textTarget() || textPrefs).size;
    setTextOption('size', clamp(cur + dir * step(cur), TEXT_SIZE));
    return true;
  } else return false;
  saveToolPrefs();
  renderToolOptions();
  if (boardTool === 'eraser' && lastPointer) showEraser(lastPointer);
  return true;
}

$('#boardColors').addEventListener('click', e => {
  const b = e.target.closest('[data-color]');
  if (!b) return;
  if (boardTool === 'pen') { penColor = b.dataset.color; saveToolPrefs(); renderToolOptions(); }
  else setTextOption('color', b.dataset.color);
});
$('#boardFonts').addEventListener('click', e => {
  const b = e.target.closest('[data-font]');
  if (b) setTextOption('font', b.dataset.font);
});
$('#boardStyles').addEventListener('click', e => {
  const b = e.target.closest('[data-style]');
  if (b) toggleTextStyle(b.dataset.style);
});
// Que los botones de opciones no le saquen el foco al texto que se está escribiendo
$('#boardToolOpts').addEventListener('pointerdown', e => { if (editing && e.target.closest('button')) e.preventDefault(); });
$('#boardSizeUp').addEventListener('click', () => stepToolSize(1));
$('#boardSizeDown').addEventListener('click', () => stepToolSize(-1));
$$('.board-tool[data-tool]').forEach(b => b.addEventListener('click', () => setBoardTool(b.dataset.tool)));

/* ---------- Título de los marcos ---------- */
$('#boardFrames').addEventListener('input', e => {
  const f = e.target.classList.contains('frame-title') && itemById(e.target.closest('[data-id]').dataset.id);
  if (f) { f.title = e.target.value; sizeFrameTitle(e.target); persistBoard(); }
});
$('#boardFrames').addEventListener('keydown', e => {
  if (e.target.classList.contains('frame-title') && (e.key === 'Enter' || e.key === 'Escape')) e.target.blur();
});

/* ---------- Pantalla ---------- */
/** El tablero ocupa el alto que queda en pantalla, sin desplazar la página. */
function fitBoardCanvas() {
  const wrap = $('#boardWrap');
  wrap.style.height = `${Math.max(320, fillHeight(wrap))}px`;
}

function renderBoard() {
  // Guardar lo pendiente del tablero anterior antes de cambiar
  if (editing) finishEdit();
  if (boardSaveT) { clearTimeout(boardSaveT); boardSaveT = null; save(); }
  const prev = boardTask;
  boardTask = boardById(routeArg) || null;
  if (boardTask !== prev) { boardUndo = []; selected.clear(); }
  const found = !!boardTask;
  $$('#view-tablero .board-head, #boardWrap').forEach(el => { el.hidden = !found; });
  $('#boardMissing').hidden = found;
  if (!found) return;
  const t = boardTask;
  t.board = t.board || newBoard(t.createdAt);
  $('#boardTitle').textContent = t.name;
  $('#boardSwatch').style.background = t.color;
  $('#boardDue').innerHTML = `${teamDueHTML(t)}${t.status === 'archived' ? '<span class="pill">Archivada</span>' : ''}`;
  setBoardTool(boardTool);
  applyBoardView();
  renderItems();
  fitBoardCanvas();
}
renderers.tablero = renderBoard;

/* ---------- Puntero ---------- */
let gesture = null;     // { kind: 'pan' | 'draw' | 'erase' | 'move' | 'resize' | 'frame', … }
let spaceHeld = false;
let lastPointer = null; // última posición del mouse sobre el lienzo (para redibujar el borrador)
const eraserRadius = () => eraserSize / 2 / boardTask.board.view.zoom;

/** Círculo del borrador que sigue al mouse: su tamaño es exactamente el que borra. */
function showEraser(e) {
  const [sx, sy] = canvasPoint(e);
  const el = $('#boardEraser');
  el.hidden = false;
  el.style.width = el.style.height = `${eraserSize}px`;
  el.style.left = `${sx}px`;
  el.style.top = `${sy}px`;
}

/** Borra a lo largo del recorrido desde el último punto (rellena si el mouse va rápido). */
function eraseAlong(x, y) {
  const [lx, ly] = gesture.last;
  const r = eraserRadius();
  const steps = Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly) / (r / 3)));
  let changed = false;
  for (let k = 1; k <= steps; k++) changed = eraseAt(lx + (x - lx) * k / steps, ly + (y - ly) * k / steps, r) || changed;
  gesture.last = [x, y];
  if (changed) { gesture.changed = true; renderItems(); }
}

/** Guarda la posición original de lo que se va a mover (para arrastrar sin acumular errores). */
const snapshotPos = i => i.type === 'stroke' ? { points: i.points.map(p => [...p]) } : { x: i.x, y: i.y };

boardCanvas.addEventListener('pointerdown', e => {
  if (!boardTask || gesture) return;
  // Escribir en un título de marco o en el texto en edición: comportamiento normal
  if (e.target.closest('.frame-title, .board-text.editing')) return;
  // Mover la vista: botón del medio o Espacio apretado (con cualquier herramienta)
  const pan = e.button === 1 || spaceHeld;
  if (!pan && e.button !== 0) return;
  e.preventDefault();
  if (editing) finishEdit(); // clic fuera del texto: termina la edición
  boardCanvas.focus({ preventScroll: true });
  boardCanvas.setPointerCapture(e.pointerId);
  const [x, y] = toBoard(e);
  const startPan = () => { gesture = { kind: 'pan', x: e.clientX, y: e.clientY }; boardCanvas.classList.add('dragging'); };
  if (pan) return startPan();

  if (boardTool === 'move' || boardTool === 'select') {
    const handle = onFrameHandle(x, y);
    if (handle) {
      pushUndo();
      gesture = { kind: 'resize', frame: handle, start: [x, y], orig: { w: handle.w, h: handle.h }, moved: false };
      return;
    }
    const hit = itemAt(x, y);
    // Shift + clic: suma o quita ese elemento de la selección
    if (hit && e.shiftKey) {
      if (selected.has(hit.id)) selected.delete(hit.id); else selected.add(hit.id);
      select([...selected]);
      return;
    }
    if (!hit) {
      // Selección: arrastrar sobre el fondo dibuja un recuadro; Mover: desplaza la vista
      if (boardTool === 'select') {
        const base = e.shiftKey ? [...selected] : [];
        if (!e.shiftKey) select(null);
        gesture = { kind: 'marquee', start: [x, y], base };
        return;
      }
      select(null);
      return startPan();
    }
    if (!selected.has(hit.id)) select(hit.id);
    // Se mueve todo lo seleccionado; cada marco arrastra lo que tiene adentro
    const moving = new Set(selectedItems());
    selectedItems().filter(i => i.type === 'frame').forEach(f => frameContents(f).forEach(i => moving.add(i)));
    pushUndo();
    gesture = { kind: 'move', start: [x, y], hit, moving: [...moving].map(i => [i, snapshotPos(i)]), moved: false };
  } else if (boardTool === 'pen') {
    pushUndo();
    const s = { id: uid(), type: 'stroke', color: penColor, size: penSize, points: [[r1(x), r1(y)]] };
    boardItems().push(s);
    const el = strokeEl(s);
    $('#boardStrokes').appendChild(el);
    $('#boardEmpty').hidden = true;
    gesture = { kind: 'draw', stroke: s, el };
  } else if (boardTool === 'eraser') {
    pushUndo();
    gesture = { kind: 'erase', last: [x, y], changed: false };
    // Un clic sin mover también borra lo que está debajo
    if (eraseAt(x, y, eraserRadius())) { gesture.changed = true; renderItems(); }
  } else if (boardTool === 'text') {
    // Clic sobre un texto: editarlo; en otro lado: texto nuevo donde se hizo clic
    const hit = itemAt(x, y);
    if (hit?.type === 'text') { gesture = { kind: 'edit', item: hit }; return; }
    const before = JSON.stringify(boardItems()); // para deshacer: antes de que exista el texto
    const t = { id: uid(), type: 'text', x: r1(x - 3), y: r1(y - textPrefs.size * 0.65), text: '', ...textPrefs };
    boardItems().push(t);
    gesture = { kind: 'edit', item: t, before };
  } else if (boardTool === 'frame') {
    const f = { id: uid(), type: 'frame', x: r1(x), y: r1(y), w: 0, h: 0, title: '' };
    const el = frameEl(f);
    el.classList.add('draft');
    $('#boardFrames').appendChild(el);
    gesture = { kind: 'frame', frame: f, el, start: [x, y] };
  }
});

boardCanvas.addEventListener('pointermove', e => {
  if (!boardTask) return;
  lastPointer = { clientX: e.clientX, clientY: e.clientY };
  if (boardTool === 'eraser' && !spaceHeld) showEraser(e);
  if (!gesture) return;
  if (gesture.kind === 'pan') {
    panBoard(e.clientX - gesture.x, e.clientY - gesture.y);
    gesture.x = e.clientX; gesture.y = e.clientY;
    return;
  }
  const [x, y] = toBoard(e);
  if (gesture.kind === 'move') {
    const dx = x - gesture.start[0], dy = y - gesture.start[1];
    if (!gesture.moved && Math.hypot(dx, dy) * boardTask.board.view.zoom < 3) return; // un clic no mueve
    gesture.moved = true;
    gesture.moving.forEach(([i, o]) => {
      if (i.type === 'stroke') i.points = o.points.map(([px, py]) => [r1(px + dx), r1(py + dy)]);
      else { i.x = r1(o.x + dx); i.y = r1(o.y + dy); }
    });
    renderItems();
  } else if (gesture.kind === 'resize') {
    const f = gesture.frame;
    f.w = r1(Math.max(FRAME_MIN, gesture.orig.w + x - gesture.start[0]));
    f.h = r1(Math.max(FRAME_MIN, gesture.orig.h + y - gesture.start[1]));
    gesture.moved = true;
    renderItems();
  } else if (gesture.kind === 'marquee') {
    const v = boardTask.board.view;
    const [sx, sy] = gesture.start;
    gesture.rect = { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) };
    const m = $('#boardMarquee');
    m.hidden = false;
    Object.assign(m.style, { left: `${gesture.rect.x * v.zoom + v.x}px`, top: `${gesture.rect.y * v.zoom + v.y}px`, width: `${gesture.rect.w * v.zoom}px`, height: `${gesture.rect.h * v.zoom}px` });
    // Vista previa: se marca lo que quedaría seleccionado
    selected.clear();
    [...gesture.base, ...itemsInRect(gesture.rect).map(i => i.id)].forEach(id => selected.add(id));
    markSelection();
  } else if (gesture.kind === 'frame') {
    const [sx, sy] = gesture.start;
    Object.assign(gesture.frame, { x: r1(Math.min(sx, x)), y: r1(Math.min(sy, y)), w: r1(Math.abs(x - sx)), h: r1(Math.abs(y - sy)) });
    const s = gesture.el.style, f = gesture.frame;
    s.left = `${f.x}px`; s.top = `${f.y}px`; s.width = `${f.w}px`; s.height = `${f.h}px`;
  } else if (gesture.kind === 'draw' || gesture.kind === 'erase') {
    // Todos los movimientos intermedios que el navegador agrupó en este evento
    const evs = e.getCoalescedEvents?.() || [];
    const list = evs.length ? evs : [e];
    if (gesture.kind === 'draw') {
      const pts = gesture.stroke.points;
      let added = false;
      list.forEach(ev => {
        const [px, py] = toBoard(ev);
        const [lx, ly] = pts[pts.length - 1];
        // Un punto cada ~2 px de pantalla: trazo suave sin guardar puntos de más
        if (Math.hypot(px - lx, py - ly) * boardTask.board.view.zoom < 2) return;
        pts.push([r1(px), r1(py)]);
        added = true;
      });
      if (added) gesture.el.setAttribute('d', strokePath(pts));
    } else {
      list.forEach(ev => eraseAlong(...toBoard(ev)));
    }
  }
});

function endGesture() {
  if (!gesture) return;
  const g = gesture;
  gesture = null;
  if (g.kind === 'pan') boardCanvas.classList.remove('dragging');
  else if (g.kind === 'marquee') {
    $('#boardMarquee').hidden = true;
    renderToolOptions();
    return;
  } else if ((g.kind === 'erase' && !g.changed) || ((g.kind === 'move' || g.kind === 'resize') && !g.moved)) {
    boardUndo.pop(); // no cambió nada
    // Clic (sin arrastrar) sobre algo de una selección múltiple: queda solo eso
    if (g.kind === 'move' && selected.size > 1) select(g.hit.id);
  }
  else if (g.kind === 'edit') {
    // Se abre al soltar, para que el foco quede en el texto
    startEdit(g.item, g.before);
    return;
  } else if (g.kind === 'frame') {
    const f = g.frame;
    // Un clic sin arrastrar crea un marco del tamaño estándar
    if (f.w * boardTask.board.view.zoom < 12 || f.h * boardTask.board.view.zoom < 12) {
      Object.assign(f, { x: r1(g.start[0]), y: r1(g.start[1]), w: FRAME_DEFAULT.w, h: FRAME_DEFAULT.h });
    }
    f.w = Math.max(FRAME_MIN, f.w); f.h = Math.max(FRAME_MIN, f.h);
    pushUndo();
    boardItems().push(f);
    // Queda seleccionado (con Mover) y listo para escribirle el título
    setBoardTool('move');
    select(f.id);
    renderItems();
    $(`#boardFrames [data-id="${f.id}"] .frame-title`)?.focus({ preventScroll: true });
  }
  persistBoard(150);
}
boardCanvas.addEventListener('pointerup', endGesture);
boardCanvas.addEventListener('pointercancel', endGesture);
boardCanvas.addEventListener('pointerleave', () => { $('#boardEraser').hidden = true; lastPointer = null; });
// Doble clic sobre un texto (con cualquier herramienta menos el lápiz/borrador): editarlo
boardCanvas.addEventListener('dblclick', e => {
  if (!boardTask || boardTool === 'pen' || boardTool === 'eraser' || editing) return;
  const hit = itemAt(...toBoard(e));
  if (hit?.type === 'text') startEdit(hit);
  else if (hit?.type === 'frame') $(`#boardFrames [data-id="${hit.id}"] .frame-title`)?.focus({ preventScroll: true });
});

/* ---------- Rueda: Ctrl + rueda (o pellizco en el touchpad) acerca; la rueda sola mueve ---------- */
boardCanvas.addEventListener('wheel', e => {
  if (!boardTask) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomBoard(Math.exp(-e.deltaY * 0.0015), ...canvasPoint(e));
  else panBoard(-e.deltaX, -e.deltaY);
}, { passive: false });

/* ---------- Teclado ---------- */
function deleteSelected() {
  if (!selected.size) return false;
  pushUndo();
  boardTask.board.items = boardItems().filter(i => !selected.has(i.id));
  selected.clear();
  renderItems();
  renderToolOptions();
  persistBoard(0);
  return true;
}

document.addEventListener('keydown', e => {
  if (currentView() !== 'tablero' || !boardTask) return;
  const k = e.key.toLowerCase();
  const bigger = k === '+' || k === '=' || e.code === 'NumpadAdd';
  const smaller = k === '-' || k === '_' || e.code === 'NumpadSubtract';
  // Escribiendo un texto: solo Ctrl + / Ctrl − (tamaño de la letra); el resto lo maneja el texto
  if (editing) {
    if ((e.ctrlKey || e.metaKey) && (bigger || smaller)) { e.preventDefault(); stepToolSize(bigger ? 1 : -1); }
    return;
  }
  if (e.target.closest?.('input, textarea, select, dialog[open]')) return;
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z') { e.preventDefault(); undoBoard(); }
    // Ctrl+A: seleccionar todo (con Mover o Selección)
    else if (k === 'a' && (boardTool === 'select' || boardTool === 'move')) { e.preventDefault(); select(boardItems().map(i => i.id)); }
    // Ctrl + / Ctrl − : tamaño de la herramienta (en lugar del zoom del navegador)
    else if ((bigger || smaller) && stepToolSize(bigger ? 1 : -1)) e.preventDefault();
    return;
  }
  if (e.altKey) return;
  if (k === ']' || k === '[') { stepToolSize(k === ']' ? 1 : -1); return; }
  const step = e.shiftKey ? 120 : 40;
  const moves = { arrowleft: [step, 0], arrowright: [-step, 0], arrowup: [0, step], arrowdown: [0, -step] };
  if (moves[k]) { e.preventDefault(); panBoard(...moves[k]); }
  else if ((k === 'delete' || k === 'backspace') && selected.size) { e.preventDefault(); deleteSelected(); }
  else if (k === 'escape') select(null);
  else if (k === ' ' && !e.target.closest?.('button, a')) { e.preventDefault(); if (!spaceHeld) { spaceHeld = true; boardCanvas.classList.add('tool-move'); $('#boardEraser').hidden = true; } }
  else if (k === 'p') setBoardTool('pen');
  else if (k === 'e') setBoardTool('eraser');
  else if (k === 'm') setBoardTool('move');
  else if (k === 's') setBoardTool('select');
  else if (k === 't') setBoardTool('text');
  else if (k === 'f') setBoardTool('frame');
  else if (k === 'g') toggleGrid();
  else if (bigger) zoomBoard(1.2);
  else if (smaller) zoomBoard(1 / 1.2);
  else if (k === '0') resetBoardView();
});
document.addEventListener('keyup', e => {
  if (e.key === ' ' && spaceHeld) { spaceHeld = false; setBoardTool(boardTool); }
});

$('#boardGridToggle').addEventListener('click', toggleGrid);
$('#boardZoomIn').addEventListener('click', () => zoomBoard(1.2));
$('#boardZoomOut').addEventListener('click', () => zoomBoard(1 / 1.2));
$('#boardZoomReset').addEventListener('click', resetBoardView);
$('#boardClear').addEventListener('click', () => {
  if (deleteSelected()) return;
  if (!boardTask?.board.items.length) return;
  if (!confirm('¿Borrar todo lo que hay en este tablero? Podés deshacerlo con Ctrl+Z mientras sigas acá.')) return;
  pushUndo();
  boardTask.board.items = [];
  selected.clear();
  renderItems();
  persistBoard(0);
});

window.addEventListener('resize', () => { if (currentView() === 'tablero' && boardTask) fitBoardCanvas(); });
// Al salir de la página, no perder el último cambio
window.addEventListener('pagehide', () => {
  if (editing) finishEdit();
  if (boardSaveT) { clearTimeout(boardSaveT); boardSaveT = null; save(); }
});
