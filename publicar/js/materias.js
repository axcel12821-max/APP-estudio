'use strict';
/* ============ Materias ============ */

const careerInput = $('#careerInput');
const institutionInput = $('#institutionInput');
careerInput.value = state.career;
institutionInput.value = state.institution;
careerInput.addEventListener('input', () => { state.career = careerInput.value.trim(); save(); });
institutionInput.addEventListener('input', () => { state.institution = institutionInput.value.trim(); save(); });

function allSlots() {
  return state.subjects.flatMap(s => (s.slots || []).map(sl => ({ ...sl, subject: s })));
}
const sortSlots = slots => [...slots].sort((a, b) =>
  DAY_ORDER.indexOf(Number(a.day)) - DAY_ORDER.indexOf(Number(b.day)) || toMin(a.start) - toMin(b.start));

/** Progreso semanal de los objetivos de una materia (solo los definidos). */
function subjectGoalProgress(s, range = weekRange()) {
  const g = s.goals || {};
  const tot = studyTotals(range, s.id);
  const out = [];
  if (g.hours > 0) out.push({ key: 'hours', label: 'Horas', value: tot.minutes, target: g.hours * 60, fmt: fmtDur });
  if (g.pomodoros > 0) out.push({ key: 'pomodoros', label: 'Pomodoros', value: tot.pomodoros, target: g.pomodoros });
  if (g.sessions > 0) out.push({ key: 'sessions', label: 'Sesiones', value: studyBlocks(range, s.id), target: g.sessions });
  return out;
}

function renderSubjects() {
  const el = $('#subjectList');
  if (!state.subjects.length) {
    el.innerHTML = '<div class="card empty" style="grid-column:1/-1">Agregá tu primera materia con sus días y horarios.</div>';
    return;
  }
  const week = weekRange();
  el.innerHTML = state.subjects.map(s => {
    const slots = sortSlots(s.slots || []);
    const pend = state.tasks.filter(t => t.subjectId === s.id && !isDone(t)).length;
    const info = [s.teacher, s.room].filter(Boolean).map(esc).join(' · ');
    const total = studyTotals(null, s.id);
    const wk = studyTotals(week, s.id);
    const goals = subjectGoalProgress(s, week);
    return `<div class="card subject-card" style="--c:${s.color}">
      <div class="top">
        <div><h3>${esc(s.name)}</h3>${info ? `<div class="info">${info}</div>` : ''}</div>
        <div class="actions">
          <button class="icon-plain" data-edit="${s.id}" aria-label="Editar">${ICONS.edit}</button>
          <button class="icon-plain danger" data-del="${s.id}" aria-label="Eliminar">${ICONS.trash}</button>
        </div>
      </div>
      <div class="chips">${slots.length ? slots.map(sl => `<span class="chip">${DAYS_SHORT[sl.day]} ${sl.start}–${sl.end}</span>`).join('') : '<span class="muted small">Sin horarios</span>'}</div>
      <div class="mini-stats">
        <div><span class="mini-num">${fmtDur(wk.minutes)}</span><span class="muted small">esta semana</span></div>
        <div><span class="mini-num">${fmtDur(total.minutes)}</span><span class="muted small">en total</span></div>
        <div><span class="mini-num">${total.pomodoros}</span><span class="muted small">pomodoros</span></div>
      </div>
      ${goals.map(g => progressHTML(`${g.label} (semana)`, g.value, g.target, g.fmt, s.color)).join('')}
      ${pend ? `<a class="muted small link" href="#tareas" data-filter-subject="${s.id}">${pend} tarea${pend > 1 ? 's' : ''} pendiente${pend > 1 ? 's' : ''} →</a>` : ''}
    </div>`;
  }).join('');
}
renderers.materias = renderSubjects;

$('#subjectList').addEventListener('click', e => {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  const fs = e.target.closest('[data-filter-subject]');
  if (fs) taskView.subject = fs.dataset.filterSubject;
  if (edit) openSubjectDialog(subjectById(edit.dataset.edit));
  if (del) {
    const s = subjectById(del.dataset.del);
    if (confirm(`¿Eliminar "${s.name}"? Las tareas, sesiones y recordatorios asociados quedarán sin materia.`)) {
      state.subjects = state.subjects.filter(x => x.id !== s.id);
      state.tasks.forEach(t => { if (t.subjectId === s.id) t.subjectId = ''; });
      state.sessions.forEach(x => { if (x.subjectId === s.id) x.subjectId = ''; });
      state.reminders.forEach(r => { if (r.subjectId === s.id) r.subjectId = ''; });
      save(); renderAll();
    }
  }
});

// Diálogo de materia
const subjectDialog = $('#subjectDialog');
const subjectForm = $('#subjectForm');
let editingSubject = null;
let selectedColor = COLORS[0];

function renderSwatches() {
  $('#swatches').innerHTML = COLORS.map(c =>
    `<button type="button" class="swatch" style="background:${c}" data-color="${c}" aria-pressed="${c === selectedColor}" aria-label="Color ${c}"></button>`).join('');
}
$('#swatches').addEventListener('click', e => {
  const b = e.target.closest('[data-color]');
  if (b) { selectedColor = b.dataset.color; renderSwatches(); }
});

function slotRow(sl = { day: 1, start: '08:00', end: '10:00' }) {
  const div = document.createElement('div');
  div.className = 'slot';
  div.innerHTML = `
    <select name="day" aria-label="Día">${DAY_ORDER.map(d => `<option value="${d}" ${Number(sl.day) === d ? 'selected' : ''}>${DAYS[d]}</option>`).join('')}</select>
    <input type="time" name="start" value="${sl.start}" required aria-label="Inicio">
    <input type="time" name="end" value="${sl.end}" required aria-label="Fin">
    <button type="button" class="icon-plain danger" aria-label="Quitar horario">${ICONS.x}</button>`;
  div.querySelector('button').addEventListener('click', () => div.remove());
  return div;
}
$('#addSlotBtn').addEventListener('click', () => {
  const rows = $$('#slotList .slot');
  const last = rows[rows.length - 1];
  const next = last
    ? { day: DAY_ORDER[(DAY_ORDER.indexOf(Number(last.querySelector('[name=day]').value)) + 1) % 7], start: last.querySelector('[name=start]').value, end: last.querySelector('[name=end]').value }
    : undefined;
  $('#slotList').appendChild(slotRow(next));
});

function openSubjectDialog(subject = null) {
  editingSubject = subject;
  subjectForm.reset();
  $('#subjectError').textContent = '';
  $('#subjectDialogTitle').textContent = subject ? 'Editar materia' : 'Nueva materia';
  subjectForm.elements.name.value = subject?.name || '';
  subjectForm.elements.teacher.value = subject?.teacher || '';
  subjectForm.elements.room.value = subject?.room || '';
  selectedColor = subject?.color || COLORS[state.subjects.length % COLORS.length];
  renderSwatches();
  const list = $('#slotList');
  list.innerHTML = '';
  (subject?.slots?.length ? subject.slots : [undefined]).forEach(sl => list.appendChild(slotRow(sl)));
  subjectDialog.showModal();
}
$('#addSubjectBtn').addEventListener('click', () => openSubjectDialog());

subjectForm.addEventListener('submit', e => {
  const slots = $$('#slotList .slot').map(r => ({
    day: Number(r.querySelector('[name=day]').value),
    start: r.querySelector('[name=start]').value,
    end: r.querySelector('[name=end]').value,
  }));
  const bad = slots.find(s => !s.start || !s.end || toMin(s.end) <= toMin(s.start));
  if (bad) {
    e.preventDefault();
    $('#subjectError').textContent = `Revisá el horario del ${DAYS[bad.day].toLowerCase()}: la hora de fin debe ser posterior a la de inicio.`;
    return;
  }
  const data = {
    name: subjectForm.elements.name.value.trim(),
    teacher: subjectForm.elements.teacher.value.trim(),
    room: subjectForm.elements.room.value.trim(),
    color: selectedColor,
    slots,
  };
  if (editingSubject) Object.assign(editingSubject, data);
  else state.subjects.push({ id: uid(), goals: { hours: 0, pomodoros: 0, sessions: 0 }, ...data });
  save(); renderAll();
});

/** Rellena todos los <select> de materias de la app conservando la selección. */
function renderSubjectOptions() {
  const opts = state.subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $$('select[data-subjects]').forEach(sel => {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${sel.dataset.subjects}</option>${opts}`;
    sel.value = subjectById(cur) ? cur : '';
  });
}
alwaysRender.push(renderSubjectOptions);
