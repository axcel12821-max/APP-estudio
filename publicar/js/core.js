'use strict';
/* =====================================================================
   Núcleo: utilidades, constantes, estado persistente y migraciones.
   Todos los módulos (js/*.js) comparten estas globales.
   ===================================================================== */

/* ============ Utilidades ============ */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysUntil = iso => Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const clamp01 = x => Math.max(0, Math.min(1, x));

/** Lunes de la semana de `d` (00:00). */
function startOfWeek(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
/** Rango [desde, hasta) en fechas ISO. */
function weekRange(d = new Date()) {
  const s = startOfWeek(d);
  return [todayISO(s), todayISO(addDays(s, 7))];
}
function monthRange(d = new Date()) {
  return [todayISO(new Date(d.getFullYear(), d.getMonth(), 1)), todayISO(new Date(d.getFullYear(), d.getMonth() + 1, 1))];
}
const inRange = (iso, [a, b]) => iso >= a && iso < b;

/** 135 → "2h 15m", 40 → "40m" */
function fmtDur(min) {
  min = Math.round(min);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const COLORS = ['#6366f1', '#f59e0b', '#0ea5e9', '#ef4444', '#10b981', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b'];
const TYPES = { tarea: 'Tarea', tp: 'Trabajo práctico', parcial: 'Parcial', final: 'Examen final' };
const STATUS = { pending: 'Pendiente', progress: 'En progreso', done: 'Completada' };
const PRIORITY = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const PRIORITY_RANK = { alta: 0, media: 1, baja: 2 };
const isExam = t => t.type === 'parcial' || t.type === 'final';
const isDone = t => t.status === 'done';

const ICONS = {
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8V4Z"/></svg>',
  chevL: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  chevR: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
};

/* ============ Estado ============ */
// Con Supabase configurado, cada usuario tiene su copia local en `estudio-app:<id>`
// (permite abrir la app al instante y usarla sin conexión). Sin Supabase: `estudio-app`.
const CLOUD = typeof BRUNO_CONFIG !== 'undefined' && !!(BRUNO_CONFIG.supabaseUrl && BRUNO_CONFIG.supabaseAnonKey);
const LOCAL_KEY = 'estudio-app';
const USER_KEY = 'bruno-user'; // id del último usuario que inició sesión en este navegador
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const cachedUserId = CLOUD ? lsGet(USER_KEY) : null;
const STORAGE_KEY = cachedUserId ? `${LOCAL_KEY}:${cachedUserId}` : LOCAL_KEY;
const afterSave = []; // p. ej. la sincronización con la nube
const DATA_VERSION = 2;
const DEFAULT_POMO = { work: 25, short: 5, long: 15, cycles: 4, auto: false, sound: true };
const DEFAULT_GOALS = {
  daily: { minutes: 120, pomodoros: 4, tasks: 3 },
  weekly: { minutes: 600, pomodoros: 20, allTasks: true },
};
const defaults = {
  version: DATA_VERSION,
  career: '', institution: '',
  subjects: [], tasks: [],
  sessions: [],          // sesiones Pomodoro (completadas e incompletas)
  reminders: [],         // recordatorios recurrentes
  goals: DEFAULT_GOALS,
  achieved: {},          // objetivos ya celebrados: { clave: true }
  pomo: { ...DEFAULT_POMO },
  pomoRun: null,         // temporizador en curso (sobrevive a recargas)
  theme: null,
};

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; }
}
/** Guarda en este navegador. `touch = false` no marca cambios para sincronizar. */
function save(touch = true) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  if (touch) afterSave.forEach(fn => fn());
}

const state = { ...defaults, ...load() };
migrate(state);

/** Normaliza datos guardados por versiones anteriores de la app. */
function migrate(s) {
  s.pomo = { ...DEFAULT_POMO, ...s.pomo };
  s.goals = {
    daily: { ...DEFAULT_GOALS.daily, ...(s.goals?.daily) },
    weekly: { ...DEFAULT_GOALS.weekly, ...(s.goals?.weekly) },
  };
  s.sessions = s.sessions || [];
  s.reminders = s.reminders || [];
  s.achieved = s.achieved || {};

  s.subjects.forEach(sub => {
    sub.slots = sub.slots || [];
    sub.goals = { hours: 0, pomodoros: 0, sessions: 0, ...sub.goals };
  });

  // v1: tareas con `done: boolean` → estado, prioridad, recordatorio, plan
  s.tasks.forEach(t => {
    if (!t.status) t.status = t.done ? 'done' : 'pending';
    delete t.done;
    if (!('completedAt' in t)) t.completedAt = null; // se desconoce cuándo se completaron las viejas
    t.priority = t.priority || 'media';
    t.reminder = t.reminder || null;
    t.topics = t.topics || [];
    t.plan = t.plan || [];
  });

  // v1: `focusLog` agregado por día → sesiones completadas (sin hora exacta)
  if (s.focusLog) {
    Object.entries(s.focusLog).forEach(([date, day]) => {
      const perPomo = day.count ? day.minutes / day.count : s.pomo.work;
      Object.entries(day.bySubject || {}).forEach(([sid, min]) => {
        const n = Math.max(1, Math.round(min / perPomo));
        for (let i = 0; i < n; i++) {
          s.sessions.push({
            id: uid(), date, start: null, end: null, plannedMin: min / n, focusMin: min / n,
            subjectId: sid === '_general' ? '' : sid, topic: '', status: 'completed', legacy: true,
          });
        }
      });
    });
    delete s.focusLog;
  }
  s.version = DATA_VERSION;
}
save(false);

const subjectById = id => state.subjects.find(s => s.id === id);
const taskById = id => state.tasks.find(t => t.id === id);
const subjectColor = id => subjectById(id)?.color || 'var(--muted)';
const subjectName = id => subjectById(id)?.name || 'General';

/* ============ Datos derivados de sesiones ============ */
const completedSessions = () => state.sessions.filter(x => x.status === 'completed');

/** Suma minutos y pomodoros completados en un rango de fechas (opcionalmente por materia). */
function studyTotals(range, subjectId) {
  let minutes = 0, pomodoros = 0;
  completedSessions().forEach(x => {
    if (range && !inRange(x.date, range)) return;
    if (subjectId !== undefined && x.subjectId !== subjectId) return;
    minutes += x.plannedMin;
    pomodoros++;
  });
  return { minutes, pomodoros };
}

/**
 * Sesiones de estudio: bloques continuos de pomodoros completados de la misma materia.
 * Dos pomodoros pertenecen al mismo bloque si el segundo empieza dentro de
 * (descanso largo + 10 min) desde que terminó el anterior.
 */
function studyBlocks(range, subjectId) {
  const gapMs = (state.pomo.long + 10) * 60000;
  const list = completedSessions()
    .filter(x => (!range || inRange(x.date, range)) && (subjectId === undefined || x.subjectId === subjectId))
    .sort((a, b) => (a.start || a.date).localeCompare(b.start || b.date));
  let blocks = 0, prev = null;
  list.forEach(x => {
    const joins = prev && prev.subjectId === x.subjectId && x.start && prev.end &&
      new Date(x.start) - new Date(prev.end) <= gapMs;
    if (!joins) blocks++;
    prev = x;
  });
  return blocks;
}

/** Tareas (no exámenes) completadas en un rango, según la fecha real en que se completaron. */
function tasksCompletedIn(range) {
  return state.tasks.filter(t => !isExam(t) && isDone(t) && t.completedAt && inRange(todayISO(new Date(t.completedAt)), range)).length;
}

/** Cambia el estado de una tarea registrando cuándo se completó. */
function setTaskStatus(t, status) {
  if (t.status === status) return;
  t.status = status;
  t.completedAt = status === 'done' ? new Date().toISOString() : null;
  save();
  renderAll();
  checkGoals();
}

/* ============ Registro de vistas ============ */
// Cada módulo registra cómo se dibuja; renderAll() repinta lo visible.
const renderers = {};
const alwaysRender = [];
function currentView() {
  return $('.view.active')?.id.replace('view-', '') || 'panel';
}
function renderAll() {
  alwaysRender.forEach(fn => fn());
  renderers[currentView()]?.();
}
