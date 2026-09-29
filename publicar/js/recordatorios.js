'use strict';
/* ============ Recordatorios ============
   Recurrentes: { id, message, time 'HH:MM', days [0..6], subjectId, enabled, lastFired 'YYYY-MM-DD' }
   De tareas: task.reminder (ver tareas.js); task.reminderFired guarda el momento ya avisado.
   Se comprueban cada 15 s mientras la app está abierta (aunque esté minimizada). */

const LATE_GRACE_MIN = 180; // si la app se abre tarde, avisa igual dentro de este margen

function defaultReminderMessage(subjectId) {
  const s = subjectById(subjectId);
  return s ? `Es hora de estudiar ${s.name} 📚` : 'Es hora de estudiar 📚';
}

function fireRecurring(r, late) {
  const title = subjectById(r.subjectId)?.name || 'Recordatorio';
  const body = (r.message || defaultReminderMessage(r.subjectId)) + (late ? ` (programado ${r.time})` : '');
  toast(title, body, 'reminder');
  notify(`Focusly · ${title}`, body, { tag: 'rem-' + r.id });
  beep([880, 660, 880]);
}

function fireTaskReminder(t) {
  const sub = subjectById(t.subjectId);
  const d = daysUntil(t.date);
  const when = d < 0 ? 'estaba para el ' + shortDate(t.date) : d === 0 ? `es hoy${t.time ? ' a las ' + t.time : ''}` : d === 1 ? 'es mañana' : `es el ${parseISO(t.date).toLocaleDateString('es', { weekday: 'long', day: 'numeric' })}`;
  const title = `${TYPES[t.type]}${sub ? ' de ' + sub.name : ''}`;
  const body = `${t.title} — ${when}`;
  toast(title, body, 'reminder');
  notify(`Focusly · ${title}`, body, { tag: 'task-' + t.id });
  beep([880, 660, 880]);
}

function checkReminders() {
  const now = new Date();
  const today = todayISO(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let changed = false;

  state.reminders.forEach(r => {
    if (!r.enabled || r.lastFired === today || !r.days.includes(now.getDay())) return;
    const diff = nowMin - toMin(r.time);
    if (diff < 0 || diff > LATE_GRACE_MIN) return;
    r.lastFired = today;
    changed = true;
    fireRecurring(r, diff > 2);
  });

  state.tasks.forEach(t => {
    if (isDone(t) || !t.reminder) return;
    const at = taskReminderAt(t);
    if (!at || now < at) return;
    const key = at.toISOString();
    if (t.reminderFired === key) return;
    t.reminderFired = key;
    changed = true;
    // No avisar recordatorios de tareas vencidas hace más de un día
    if (daysUntil(t.date) >= -1) fireTaskReminder(t);
  });

  if (changed) { save(); renderAll(); }
}

/* ---- Vista ---- */
const dayPills = days => DAY_ORDER.map(d => `<span class="day-pill ${days.includes(d) ? 'on' : ''}" title="${DAYS[d]}">${DAYS[d][0]}</span>`).join('');

function describeDays(days) {
  const set = [...days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  if (set.length === 7) return 'Todos los días';
  if (set.length === 5 && [1, 2, 3, 4, 5].every(d => set.includes(d))) return 'De lunes a viernes';
  if (set.length === 2 && set.includes(0) && set.includes(6)) return 'Fines de semana';
  const names = set.map(d => DAYS[d].toLowerCase());
  return capitalize(names.length > 1 ? names.slice(0, -1).join(', ') + ' y ' + names.at(-1) : names[0] || 'Sin días');
}

function renderNotifStatus() {
  const p = notifPermission();
  const file = location.protocol === 'file:';
  const text = {
    granted: 'Activadas. Vas a recibir avisos del sistema mientras Focusly esté abierto (aunque esté minimizado o en otra pestaña).',
    default: 'Todavía no diste permiso. Sin permiso, los recordatorios solo aparecen dentro de la app.',
    denied: 'Bloqueadas en este navegador. Habilitalas desde el candado de la barra de direcciones para recibir avisos.',
    unsupported: 'Este navegador no soporta notificaciones. Los recordatorios aparecen solo dentro de la app.',
  }[p];
  $('#notifStatus').innerHTML = `
    <div class="notif-state ${p}"><span class="dot"></span><strong>${{ granted: 'Notificaciones activadas', default: 'Notificaciones sin activar', denied: 'Notificaciones bloqueadas', unsupported: 'Sin soporte' }[p]}</strong></div>
    <p class="muted small">${text}${file ? ' Para mejores resultados abrí Focusly con <code>Abrir Focusly.bat</code>.' : ''}</p>
    <div class="row-gap">
      ${p === 'default' ? '<button class="btn btn-primary btn-sm" id="notifEnable" type="button">Activar notificaciones</button>' : ''}
      ${p === 'granted' ? '<button class="btn btn-ghost btn-sm" id="notifTest" type="button">Probar notificación</button>' : ''}
    </div>`;
}

function renderReminders() {
  renderNotifStatus();
  const el = $('#reminderList');
  const list = [...state.reminders].sort((a, b) => a.time.localeCompare(b.time));
  el.innerHTML = list.length ? list.map(r => {
    const s = subjectById(r.subjectId);
    return `<div class="card reminder ${r.enabled ? '' : 'off'}" style="--c:${s?.color || 'var(--border)'}">
      <div class="reminder-time">${r.time}</div>
      <div class="grow">
        <div class="reminder-msg">${esc(r.message || defaultReminderMessage(r.subjectId))}</div>
        <div class="task-meta">${s ? `<span><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</span>` : ''}<span>${describeDays(r.days)}</span></div>
        <div class="day-pills">${dayPills(r.days)}</div>
      </div>
      <div class="reminder-actions">
        <label class="switch" title="${r.enabled ? 'Desactivar' : 'Activar'}"><input type="checkbox" data-rem-toggle="${r.id}" ${r.enabled ? 'checked' : ''} aria-label="Activo"><span></span></label>
        <button class="icon-plain" data-rem-edit="${r.id}" aria-label="Editar">${ICONS.edit}</button>
        <button class="icon-plain danger" data-rem-del="${r.id}" aria-label="Eliminar">${ICONS.trash}</button>
      </div>
    </div>`;
  }).join('') : '<div class="card empty">No tenés recordatorios. Creá uno para que Focusly te avise cuándo estudiar.</div>';

  const taskRems = state.tasks.filter(t => !isDone(t) && t.reminder && taskReminderAt(t) > new Date())
    .sort((a, b) => taskReminderAt(a) - taskReminderAt(b));
  $('#taskReminderList').innerHTML = taskRems.length ? taskRems.map(t => `
    <li class="row-item">
      <span class="bar" style="background:${subjectColor(t.subjectId)}"></span>
      <div class="grow"><div class="title">${esc(t.title)}</div><div class="meta">${TYPES[t.type]}${t.subjectId ? ' · ' + esc(subjectName(t.subjectId)) : ''} · vence ${shortDate(t.date)}</div></div>
      <span class="rem">${ICONS.bell}${reminderLabel(t)}</span>
    </li>`).join('') : '<li class="muted small">Ninguna tarea tiene recordatorios pendientes. Se configuran al crear o editar una tarea.</li>';
}
renderers.recordatorios = renderReminders;

$('#notifStatus').addEventListener('click', async e => {
  if (e.target.id === 'notifEnable') { await requestNotifications(); renderNotifStatus(); }
  if (e.target.id === 'notifTest') notify('Focusly', 'Así se verán tus recordatorios 📚', { tag: 'test' });
});

$('#reminderList').addEventListener('change', e => {
  const t = e.target.closest('[data-rem-toggle]');
  if (!t) return;
  state.reminders.find(r => r.id === t.dataset.remToggle).enabled = t.checked;
  save(); renderReminders();
});
$('#reminderList').addEventListener('click', e => {
  const ed = e.target.closest('[data-rem-edit]');
  const del = e.target.closest('[data-rem-del]');
  if (ed) openReminderDialog(state.reminders.find(r => r.id === ed.dataset.remEdit));
  if (del && confirm('¿Eliminar este recordatorio?')) {
    state.reminders = state.reminders.filter(r => r.id !== del.dataset.remDel);
    save(); renderReminders();
  }
});

/* ---- Diálogo ---- */
const remDialog = $('#reminderDialog');
const remForm = $('#reminderForm');
let editingReminder = null;

$('#remDays').innerHTML = DAY_ORDER.map(d => `
  <label class="day-check"><input type="checkbox" value="${d}"><span>${DAYS[d]}</span></label>`).join('');
const setRemDays = days => $$('#remDays input').forEach(i => { i.checked = days.includes(Number(i.value)); });
$('#remPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-days]');
  if (b) setRemDays(b.dataset.days.split(',').map(Number));
});
// Sugerir el mensaje según la materia, salvo que el usuario lo haya escrito
remForm.elements.subjectId.addEventListener('change', () => {
  const m = remForm.elements.message;
  if (!m.value || m.dataset.auto === '1') { m.value = defaultReminderMessage(remForm.elements.subjectId.value); m.dataset.auto = '1'; }
});
remForm.elements.message.addEventListener('input', e => { e.target.dataset.auto = ''; });

function openReminderDialog(r = null) {
  editingReminder = r;
  remForm.reset();
  $('#remError').textContent = '';
  $('#reminderDialogTitle').textContent = r ? 'Editar recordatorio' : 'Nuevo recordatorio';
  remForm.elements.subjectId.value = r?.subjectId || '';
  remForm.elements.time.value = r?.time || '18:00';
  remForm.elements.message.value = r?.message || defaultReminderMessage(r?.subjectId);
  remForm.elements.message.dataset.auto = r ? '' : '1';
  setRemDays(r?.days || []);
  remDialog.showModal();
}
$('#addReminderBtn').addEventListener('click', () => openReminderDialog());

remForm.addEventListener('submit', e => {
  const days = $$('#remDays input:checked').map(i => Number(i.value));
  if (!days.length) {
    e.preventDefault();
    $('#remError').textContent = 'Elegí al menos un día.';
    return;
  }
  const data = {
    subjectId: remForm.elements.subjectId.value,
    time: remForm.elements.time.value,
    message: remForm.elements.message.value.trim() || defaultReminderMessage(remForm.elements.subjectId.value),
    days,
  };
  if (editingReminder) {
    // Si se movió la hora o los días, que pueda volver a sonar hoy
    if (editingReminder.time !== data.time || String(editingReminder.days) !== String(days)) editingReminder.lastFired = null;
    Object.assign(editingReminder, data);
  } else {
    // Si la hora de hoy ya pasó, no avisar retroactivamente al crearlo
    const now = new Date();
    const past = days.includes(now.getDay()) && toMin(data.time) <= now.getHours() * 60 + now.getMinutes();
    state.reminders.push({ id: uid(), enabled: true, lastFired: past ? todayISO() : null, ...data });
  }
  if (notifPermission() === 'default') requestNotifications().then(renderNotifStatus);
  save(); renderAll();
});

/** Recordatorios recurrentes que caen en una fecha (para el calendario). */
function remindersOn(date) {
  return state.reminders.filter(r => r.enabled && r.days.includes(date.getDay()));
}
