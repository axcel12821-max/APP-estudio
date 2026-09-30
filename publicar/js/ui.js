'use strict';
/* =====================================================================
   Piezas de interfaz compartidas: tema, navegación, avisos (toasts),
   barras de progreso, sonido y notificaciones del sistema.
   ===================================================================== */

/* ============ Tema ============ */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const root = document.documentElement;
  if (state.theme) root.dataset.theme = state.theme; else delete root.dataset.theme;
  const dark = state.theme ? state.theme === 'dark' : mq.matches;
  root.dataset.dark = dark ? '1' : '0';
  $('.theme-label').textContent = dark ? 'Modo claro' : 'Modo oscuro';
  $('.more-theme-label').textContent = dark ? 'Modo claro' : 'Modo oscuro';
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = dark ? '#121019' : '#f6f5f9'; });
}
$('#themeToggle').addEventListener('click', () => {
  const dark = document.documentElement.dataset.dark === '1';
  state.theme = dark ? 'light' : 'dark';
  save(); applyTheme();
});
mq.addEventListener('change', applyTheme);

/* ============ Navegación ============ */
// Secciones tomadas del HTML (cada <section class="view" id="view-…">): agregar una no requiere tocar esta lista
const VIEWS = $$('.view').map(v => v.id.replace('view-', ''));
// Dirección "#vista/parámetro" (p. ej. #tablero/abc123): el parámetro queda en routeArg
let routeArg = '';
function route() {
  const [name, arg = ''] = location.hash.slice(1).split('/');
  const view = VIEWS.includes(name) ? name : 'calendario'; // inicio: el día de hoy
  routeArg = decodeURIComponent(arg);
  // Una subsección (data-parent) marca como activa a su sección en el menú
  const navView = $('#view-' + view).dataset.parent || view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === navView));
  $('#moreBtn').classList.toggle('active', !['panel', 'calendario', 'tareas', 'pomodoro'].includes(navView));
  document.body.classList.remove('nav-open');
  $$('.more-grid a').forEach(a => a.classList.toggle('active', a.dataset.view === navView));
  $('#topbarTitle').textContent = $(`.nav a[data-view="${navView}"] span`)?.textContent || 'Focusly';
  renderers[view]?.();
  // Animación de entrada (barras que se llenan) solo al cambiar de sección
  const el = $('#view-' + view);
  el.classList.remove('entering');
  void el.offsetWidth;
  el.classList.add('entering');
  clearTimeout(route.t);
  route.t = setTimeout(() => el.classList.remove('entering'), 2200);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
$('#moreBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#navScrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
$('#moreSheet').addEventListener('click', e => { if (e.target.closest('a, button')) document.body.classList.remove('nav-open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('nav-open'); });
// Botones del teléfono que repiten acciones de la barra lateral (tema, cuenta, comentarios)
document.addEventListener('click', e => {
  const b = e.target.closest('[data-proxy]');
  if (b) $(b.dataset.proxy).click();
});
/** ¿Pantalla de teléfono? (mismo corte que el CSS) */
const isPhone = () => window.matchMedia('(max-width: 760px)').matches;

/* ============ Diálogos ============ */
$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

/* ============ Toasts ============ */
/**
 * Muestra un aviso breve. `kind`: 'info' | 'success' | 'reminder'.
 * Los recordatorios quedan más tiempo y se cierran a mano.
 */
function toast(title, body = '', kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="toast-icon">${kind === 'reminder' ? ICONS.bell : ICONS.check}</div>
    <div class="grow"><strong>${esc(title)}</strong>${body ? `<span>${esc(body)}</span>` : ''}</div>
    <button class="icon-plain" aria-label="Cerrar">${ICONS.x}</button>`;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  el.querySelector('button').addEventListener('click', close);
  $('#toasts').appendChild(el);
  setTimeout(close, kind === 'reminder' ? 30000 : 5000);
}

/* ============ Barras de progreso ============ */
/** Barra con etiqueta, valor y porcentaje. `fmt` formatea los valores (p. ej. fmtDur). */
function progressHTML(label, value, target, fmt = v => v, color) {
  const pct = target > 0 ? clamp01(value / target) : 0;
  const done = pct >= 1;
  return `<div class="progress ${done ? 'done' : ''}">
    <div class="progress-top">
      <span class="progress-label">${done ? `<span class="done-mark">${ICONS.check}</span>` : ''}${label}</span>
      <span class="progress-value">${fmt(value)} / ${fmt(target)} · ${Math.round(pct * 100)}%</span>
    </div>
    <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct * 100)}" aria-label="${esc(String(label).replace(/<[^>]+>/g, ''))}">
      <div class="progress-fill" style="width:${pct * 100}%;${color && !done ? `background:${color}` : ''}"></div>
    </div>
  </div>`;
}

/* ============ Sonido ============ */
let audioCtx = null;
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}
document.addEventListener('pointerdown', unlockAudio, { once: true });

function beep(notes = [784, 784, 1046]) {
  if (!state.pomo.sound || !audioCtx) return;
  const t0 = audioCtx.currentTime;
  notes.forEach((freq, i) => {
    const off = i * 0.25;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0 + off);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + off + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.22);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + off);
    o.stop(t0 + off + 0.25);
  });
}

/* ============ Notificaciones del sistema ============ */
// El service worker permite notificaciones también en Android. Solo funciona servido por http(s).
let swReg = null;
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(() => {});
}
const notifSupported = () => 'Notification' in window;
const notifPermission = () => (notifSupported() ? Notification.permission : 'unsupported');

async function requestNotifications() {
  if (!notifSupported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch (e) { return Notification.permission; }
}

/**
 * Notificación del sistema. Si `onlyHidden`, solo se envía cuando la app no está a la vista
 * (dentro de la app ya se muestra un toast).
 */
function notify(title, body, { onlyHidden = false, tag } = {}) {
  if (notifPermission() !== 'granted') return;
  if (onlyHidden && !document.hidden) return;
  const opts = { body, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', tag, renotify: !!tag };
  try {
    if (swReg) swReg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch (e) {
    try { new Notification(title, opts); } catch (e2) {}
  }
}

/* ============ Tooltip para gráficos ============ */
/** Atributo data-tip: `html` ya debe venir con los textos escapados; se escapa otra vez para el atributo. */
const tipAttr = html => `data-tip="${esc(html)}"`;
const tip = $('#chartTip');
document.addEventListener('pointerover', e => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.innerHTML = t.dataset.tip;
  tip.hidden = false;
});
document.addEventListener('pointermove', e => {
  if (tip.hidden) return;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = e.clientY - tip.offsetHeight - 12;
  tip.style.transform = `translate(${x}px, ${y < 8 ? e.clientY + 16 : y}px)`;
});

/* ============ Íconos de navegación ============ */
$$('#calPrev, #statsPrev').forEach(b => { b.innerHTML = ICONS.chevL; });
$$('#calNext, #statsNext').forEach(b => { b.innerHTML = ICONS.chevR; });
