'use strict';
/* ============ Tareas y exámenes ============ */

const taskView = { filter: 'all', subject: '', sort: 'date' };

const byDate = (a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99'));
/** Orden por defecto: activas por fecha más próxima; completadas al final (la más reciente primero). */
function defaultTaskOrder(a, b) {
  if (isDone(a) !== isDone(b)) return isDone(a) ? 1 : -1;
  if (isDone(a)) return (b.completedAt || b.date).localeCompare(a.completedAt || a.date);
  return byDate(a, b);
}

function dueLabel(t) {
  const d = daysUntil(t.date);
  if (d < 0) return { text: `Vencida hace ${-d} día${d === -1 ? '' : 's'}`, cls: 'urgent' };
  if (d === 0) return { text: t.time ? `Hoy ${t.time}` : 'Hoy', cls: 'urgent' };
  if (d === 1) return { text: 'Mañana', cls: 'soon' };
  if (d <= 7) return { text: `En ${d} días`, cls: 'soon' };
  return { text: `En ${d} días`, cls: '' };
}
const shortDate = iso => parseISO(iso).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });

/* ---- Recordatorios de tareas ---- */
const REMINDER_OPTIONS = [
  ['', 'Sin recordatorio'], ['0', 'En el momento'], ['15', '15 minutos antes'], ['60', '1 hora antes'],
  ['180', '3 horas antes'], ['1440', '1 día antes'], ['2880', '2 días antes'], ['10080', '1 semana antes'], ['custom', 'Fecha y hora personalizada'],
];
const DEFAULT_DUE_TIME = '09:00'; // si la tarea no tiene hora, se toma esta para calcular el aviso

/** Momento exacto (Date) del recordatorio de una tarea, o null. */
function taskReminderAt(t) {
  const r = t.reminder;
  if (!r) return null;
  if (r.type === 'custom') return r.at ? new Date(r.at) : null;
  const due = parseISO(t.date);
  const [h, m] = (t.time || DEFAULT_DUE_TIME).split(':').map(Number);
  due.setHours(h, m, 0, 0);
  return new Date(due.getTime() - r.minutes * 60000);
}
function reminderLabel(t) {
  const at = taskReminderAt(t);
  if (!at) return '';
  return at.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hhmm(at);
}

/* ---- Lista ---- */
function renderTasks() {
  let tasks = state.tasks;
  if (taskView.subject) tasks = tasks.filter(t => t.subjectId === taskView.subject);
  const f = taskView.filter;
  if (f === 'pending') tasks = tasks.filter(t => t.status === 'pending');
  if (f === 'progress') tasks = tasks.filter(t => t.status === 'progress');
  if (f === 'done') tasks = tasks.filter(isDone);
  if (f === 'exams') tasks = tasks.filter(isExam);
  tasks = [...tasks].sort(defaultTaskOrder);

  const el = $('#taskList');
  if (!tasks.length) {
    const msg = {
      all: 'No hay nada cargado todavía.', pending: 'No tenés tareas pendientes.', progress: 'No hay tareas en progreso.',
      exams: 'No hay exámenes cargados.', done: 'Todavía no completaste tareas.',
    }[f];
    el.innerHTML = `<div class="card empty">${msg}</div>`;
    return;
  }

  const groups = [];
  const push = (name, t) => {
    let g = groups.find(x => x.name === name);
    if (!g) groups.push(g = { name, items: [] });
    g.items.push(t);
  };
  const periodOf = t => {
    const d = daysUntil(t.date);
    if (d < 0) return 'Vencidas';
    if (d === 0) return 'Hoy';
    if (d <= 7) return 'Próximos 7 días';
    if (d <= 31) return 'Este mes';
    return 'Más adelante';
  };

  if (taskView.sort === 'status') {
    ['progress', 'pending', 'done'].forEach(st => tasks.filter(t => t.status === st).forEach(t => push(STATUS[st], t)));
  } else {
    const active = tasks.filter(t => !isDone(t));
    if (taskView.sort === 'priority') {
      ['alta', 'media', 'baja'].forEach(p => active.filter(t => t.priority === p).forEach(t => push(`Prioridad ${PRIORITY[p].toLowerCase()}`, t)));
    } else if (taskView.sort === 'subject') {
      [...active].sort((a, b) => subjectName(a.subjectId).localeCompare(subjectName(b.subjectId), 'es') || byDate(a, b))
        .forEach(t => push(t.subjectId ? subjectName(t.subjectId) : 'Sin materia', t));
    } else {
      active.forEach(t => push(periodOf(t), t));
    }
    tasks.filter(isDone).forEach(t => push('Completadas', t));
  }

  el.innerHTML = groups.map(g => `<div class="task-group"><h3>${esc(g.name)} <span class="muted">· ${g.items.length}</span></h3>${g.items.map(taskHTML).join('')}</div>`).join('');
}
renderers.tareas = () => {
  $('#taskSubjectFilter').value = taskView.subject;
  renderTasks();
};

function taskHTML(t) {
  const sub = subjectById(t.subjectId);
  const due = dueLabel(t);
  const dateStr = shortDate(t.date) + (t.time ? ` · ${t.time}` : '');
  const rem = !isDone(t) ? reminderLabel(t) : '';
  const planInfo = isExam(t) && t.plan.length ? planProgress(t) : null;
  return `<div class="task status-${t.status}">
    <button class="task-check" data-toggle="${t.id}" aria-label="${isDone(t) ? 'Marcar como pendiente' : 'Marcar como completada'}">${ICONS.check}</button>
    <div class="task-body">
      <div class="task-title">${esc(t.title)}</div>
      <div class="task-meta">
        <span class="type-badge ${isExam(t) ? 'exam' : ''}">${TYPES[t.type]}</span>
        ${t.priority === 'alta' ? '<span class="prio prio-alta">Prioridad alta</span>' : t.priority === 'baja' ? '<span class="prio">Prioridad baja</span>' : ''}
        ${sub ? `<span><span class="dot" style="background:${sub.color}"></span>${esc(sub.name)}</span>` : ''}
        <span>${dateStr}</span>
        ${isDone(t) ? (t.completedAt ? `<span>Completada el ${shortDate(todayISO(new Date(t.completedAt)))}</span>` : '') : `<span class="pill ${due.cls}">${due.text}</span>`}
        ${rem ? `<span class="rem" title="Recordatorio">${ICONS.bell}${rem}</span>` : ''}
      </div>
      ${isExam(t) && t.topics.length ? `<div class="chips topics">${t.topics.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
      ${planInfo ? `<a class="plan-link" href="#examenes">Plan de estudio · ${Math.round(planInfo.pct * 100)}% →</a>` : ''}
      ${t.notes ? `<div class="task-notes">${esc(t.notes)}</div>` : ''}
    </div>
    <div class="task-side">
      <select class="status-select status-${t.status}" data-status="${t.id}" aria-label="Estado">
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <div class="task-actions">
        <button class="icon-plain" data-edit-task="${t.id}" aria-label="Editar">${ICONS.edit}</button>
        <button class="icon-plain danger" data-del-task="${t.id}" aria-label="Eliminar">${ICONS.trash}</button>
      </div>
    </div>
  </div>`;
}

/** Acciones comunes de tarea (se usan en Tareas, Panel y Exámenes). */
function handleTaskClick(e) {
  const tog = e.target.closest('[data-toggle]');
  const ed = e.target.closest('[data-edit-task]');
  const del = e.target.closest('[data-del-task]');
  if (tog) {
    const t = taskById(tog.dataset.toggle);
    setTaskStatus(t, isDone(t) ? 'pending' : 'done');
    if (isDone(t)) toast('Tarea completada', t.title, 'success');
  }
  if (ed) openTaskDialog(taskById(ed.dataset.editTask));
  if (del) {
    const t = taskById(del.dataset.delTask);
    if (confirm(`¿Eliminar "${t.title}"?`)) {
      state.tasks = state.tasks.filter(x => x.id !== t.id);
      save(); renderAll();
    }
  }
}
function handleStatusChange(e) {
  const sel = e.target.closest('[data-status]');
  if (!sel) return;
  const t = taskById(sel.dataset.status);
  setTaskStatus(t, sel.value);
  if (isDone(t)) toast('Tarea completada', t.title, 'success');
}
$('#taskList').addEventListener('click', handleTaskClick);
$('#taskList').addEventListener('change', handleStatusChange);

$('#taskFilter').addEventListener('click', e => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  taskView.filter = b.dataset.filter;
  $$('#taskFilter button').forEach(x => x.classList.toggle('active', x === b));
  renderTasks();
});
$('#taskSubjectFilter').addEventListener('change', e => { taskView.subject = e.target.value; renderTasks(); });
$('#taskSort').addEventListener('change', e => { taskView.sort = e.target.value; renderTasks(); });

/* ---- Diálogo ---- */
const taskDialog = $('#taskDialog');
const taskForm = $('#taskForm');
const tf = taskForm.elements;
let editingTask = null;

tf.reminder.innerHTML = REMINDER_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

function syncTaskDialog() {
  const exam = tf.type.value === 'parcial' || tf.type.value === 'final';
  $('#taskTitleLabel').textContent = exam ? 'Nombre del examen' : 'Título';
  tf.title.placeholder = exam ? 'Ej: Parcial de Matemática' : 'Ej: Entregar TP 2';
  $('#topicsField').hidden = !exam;
  $('#taskDateLabel').textContent = exam ? 'Fecha' : 'Fecha límite';
  $('#reminderCustom').hidden = tf.reminder.value !== 'custom';
  tf.reminderAt.required = tf.reminder.value === 'custom';
  $('#reminderHint').textContent = tf.reminder.value && tf.reminder.value !== 'custom' && !tf.time.value
    ? `Sin hora cargada, se calcula desde las ${DEFAULT_DUE_TIME}.` : '';
}
['type', 'reminder', 'time'].forEach(n => tf[n].addEventListener('change', syncTaskDialog));

function openTaskDialog(task = null, preset = {}) {
  editingTask = task;
  taskForm.reset();
  const t = task || preset;
  $('#taskDialogTitle').textContent = task ? 'Editar' : (isExam(preset) ? 'Nuevo examen' : 'Nueva tarea o examen');
  tf.title.value = t.title || '';
  tf.type.value = t.type || 'tarea';
  tf.subjectId.value = t.subjectId || taskView.subject || '';
  tf.date.value = t.date || todayISO();
  tf.time.value = t.time || '';
  tf.priority.value = t.priority || 'media';
  tf.status.value = t.status || 'pending';
  tf.topics.value = (t.topics || []).join('\n');
  tf.notes.value = t.notes || '';
  const r = t.reminder;
  tf.reminder.value = !r ? '' : r.type === 'custom' ? 'custom' : String(r.minutes);
  tf.reminderAt.value = r?.type === 'custom' ? r.at : '';
  syncTaskDialog();
  taskDialog.showModal();
}
$('#addTaskBtn').addEventListener('click', () => openTaskDialog());

taskForm.addEventListener('submit', () => {
  const remVal = tf.reminder.value;
  const reminder = !remVal ? null : remVal === 'custom' ? { type: 'custom', at: tf.reminderAt.value } : { type: 'offset', minutes: Number(remVal) };
  const exam = tf.type.value === 'parcial' || tf.type.value === 'final';
  const data = {
    title: tf.title.value.trim(),
    type: tf.type.value,
    subjectId: tf.subjectId.value,
    date: tf.date.value,
    time: tf.time.value,
    priority: tf.priority.value,
    notes: tf.notes.value.trim(),
    topics: exam ? tf.topics.value.split('\n').map(x => x.trim()).filter(Boolean) : [],
    reminder,
  };
  let t = editingTask;
  // Si cambió el momento del recordatorio, vuelve a avisar
  if (t && JSON.stringify(t.reminder) !== JSON.stringify(reminder)) t.reminderFired = null;
  if (t) Object.assign(t, data);
  else state.tasks.push(t = { id: uid(), status: 'pending', completedAt: null, plan: [], reminderFired: null, ...data });
  if (tf.status.value !== t.status) setTaskStatus(t, tf.status.value);
  if (reminder && notifPermission() === 'default') requestNotifications();
  save(); renderAll();
});
