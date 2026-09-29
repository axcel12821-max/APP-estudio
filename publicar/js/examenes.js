'use strict';
/* ============ Exámenes y planes de estudio ============
   Un examen es una tarea de tipo "parcial" o "final" con `topics` y `plan`.
   Cada ítem del plan: { id, date, topic, pomodoros (planificados), done (marcado a mano) }.
   El avance de cada ítem sale de las sesiones Pomodoro completadas vinculadas a él. */

const planItemPomos = item => completedSessions().filter(x => x.planItemId === item.id).length;
const planItemProgress = item => (item.done ? 1 : clamp01(planItemPomos(item) / Math.max(1, item.pomodoros)));

function planProgress(exam) {
  const total = exam.plan.reduce((a, i) => a + i.pomodoros, 0);
  const done = exam.plan.reduce((a, i) => a + Math.min(i.pomodoros, i.done ? i.pomodoros : planItemPomos(i)), 0);
  return { total, done, pct: total ? done / total : 0 };
}

/** Ítems de plan pendientes de exámenes futuros (para vincular desde el Pomodoro). */
function openPlanItems(subjectId) {
  return state.tasks
    .filter(t => isExam(t) && !isDone(t) && daysUntil(t.date) >= 0 && (!subjectId || t.subjectId === subjectId))
    .sort(byDate)
    .flatMap(t => [...t.plan].sort((a, b) => a.date.localeCompare(b.date))
      .filter(i => planItemProgress(i) < 1)
      .map(i => ({ exam: t, item: i })));
}

function daysLeftText(d) {
  if (d < 0) return { num: '—', label: 'ya pasó' };
  if (d === 0) return { num: 'Hoy', label: '' };
  if (d === 1) return { num: '1', label: 'día' };
  return { num: String(d), label: 'días' };
}

function renderExams() {
  const exams = state.tasks.filter(isExam);
  const upcoming = exams.filter(t => !isDone(t) && daysUntil(t.date) >= 0).sort(byDate);
  const past = exams.filter(t => isDone(t) || daysUntil(t.date) < 0).sort((a, b) => byDate(b, a));
  const el = $('#examList');
  if (!exams.length) {
    el.innerHTML = '<div class="card empty">No cargaste exámenes todavía.<br>Creá uno con sus temas y armá un plan de estudio por días.</div>';
    return;
  }
  el.innerHTML =
    (upcoming.length ? upcoming.map(examCardHTML).join('') : '<div class="card empty">No tenés exámenes próximos.</div>') +
    (past.length ? `<details class="past-exams"><summary>Rendidos o pasados · ${past.length}</summary>${past.map(examCardHTML).join('')}</details>` : '');
}
renderers.examenes = renderExams;

function examCardHTML(t) {
  const sub = subjectById(t.subjectId);
  const d = daysUntil(t.date);
  const left = daysLeftText(d);
  const prog = planProgress(t);
  const days = [...new Set(t.plan.map(i => i.date))].sort();
  const active = !isDone(t) && d >= 0;
  const planHTML = t.plan.length ? `
    ${progressHTML('Progreso del plan', prog.done, prog.total, v => `${v}`, sub?.color)}
    <p class="muted small plan-legend">Pomodoros completados / planificados</p>
    <div class="plan-days">${days.map((day, idx) => `
      <div class="plan-day ${day < todayISO() ? 'past' : ''} ${day === todayISO() ? 'today' : ''}">
        <div class="plan-day-head">Día ${idx + 1} <span class="muted">· ${shortDate(day)}${day === todayISO() ? ' · hoy' : ''}</span></div>
        ${t.plan.filter(i => i.date === day).map(i => {
          const n = planItemPomos(i), p = planItemProgress(i);
          return `<div class="plan-item ${p >= 1 ? 'complete' : ''}">
            <button class="task-check sm" data-plan-toggle="${t.id}:${i.id}" aria-label="${i.done ? 'Desmarcar' : 'Marcar como estudiado'}">${ICONS.check}</button>
            <span class="grow">${esc(i.topic)}</span>
            <span class="pomo-dots" title="${n} de ${i.pomodoros} pomodoros">${Array.from({ length: i.pomodoros }, (_, k) => `<span class="${k < n || i.done ? 'on' : ''}"></span>`).join('')}</span>
            <span class="muted small tnum">${i.done && n < i.pomodoros ? 'hecho' : `${Math.min(n, i.pomodoros)}/${i.pomodoros}`}</span>
            ${active && p < 1 ? `<button class="btn btn-ghost btn-xs" data-plan-study="${t.id}:${i.id}">${ICONS.play}Estudiar</button>` : ''}
          </div>`;
        }).join('')}
      </div>`).join('')}
    </div>` : `<p class="muted small">Sin plan de estudio todavía.</p>`;

  return `<div class="card exam-card ${active ? '' : 'inactive'}" style="--c:${sub?.color || 'var(--border)'}">
    <div class="exam-head">
      <div class="grow">
        <div class="task-meta"><span class="type-badge exam">${TYPES[t.type]}</span>${sub ? `<span><span class="dot" style="background:${sub.color}"></span>${esc(sub.name)}</span>` : ''}${isDone(t) ? '<span class="pill">Rendido</span>' : ''}</div>
        <h3>${esc(t.title)}</h3>
        <div class="muted small">${capitalize(parseISO(t.date).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}${t.time ? ` · ${t.time}` : ''}</div>
      </div>
      <div class="days-left ${d <= 3 && active ? 'urgent' : ''}"><span class="days-num">${left.num}</span><span class="muted small">${left.label}</span></div>
    </div>
    ${t.topics.length ? `<div><div class="muted small label-sm">Temas</div><div class="chips">${t.topics.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>` : ''}
    ${t.notes ? `<div class="task-notes">${esc(t.notes)}</div>` : ''}
    <div class="plan">${planHTML}</div>
    <div class="exam-actions">
      <button class="btn btn-ghost btn-sm" data-plan-edit="${t.id}">${t.plan.length ? 'Editar plan' : 'Crear plan de estudio'}</button>
      <button class="icon-plain" data-edit-task="${t.id}" aria-label="Editar examen">${ICONS.edit}</button>
      <button class="icon-plain danger" data-del-task="${t.id}" aria-label="Eliminar examen">${ICONS.trash}</button>
    </div>
  </div>`;
}

$('#examList').addEventListener('click', e => {
  handleTaskClick(e);
  const tog = e.target.closest('[data-plan-toggle]');
  const study = e.target.closest('[data-plan-study]');
  const edit = e.target.closest('[data-plan-edit]');
  if (tog) {
    const [tid, iid] = tog.dataset.planToggle.split(':');
    const item = taskById(tid).plan.find(i => i.id === iid);
    item.done = !item.done;
    save(); renderAll();
  }
  if (study) {
    const [tid, iid] = study.dataset.planStudy.split(':');
    const t = taskById(tid);
    const item = t.plan.find(i => i.id === iid);
    pomoPrefill({ subjectId: t.subjectId, topic: item.topic, planItemId: item.id });
    location.hash = '#pomodoro';
  }
  if (edit) openPlanDialog(taskById(edit.dataset.planEdit));
});
$('#addExamBtn').addEventListener('click', () => openTaskDialog(null, { type: 'parcial', priority: 'alta' }));

/* ---- Diálogo del plan ---- */
const planDialog = $('#planDialog');
let planExam = null;

function planRow(i = {}) {
  const div = document.createElement('div');
  div.className = 'plan-row';
  div.dataset.id = i.id || uid();
  div.dataset.done = i.done ? '1' : '';
  div.innerHTML = `
    <input type="date" name="pdate" value="${i.date || todayISO()}" max="${planExam.date}" required aria-label="Día">
    <input type="text" name="ptopic" value="${esc(i.topic || '')}" list="planTopics" required placeholder="Tema" aria-label="Tema">
    <input type="number" name="ppomos" value="${i.pomodoros || 2}" min="1" max="20" required aria-label="Pomodoros">
    <button type="button" class="icon-plain danger" aria-label="Quitar sesión">${ICONS.x}</button>`;
  div.querySelector('button').addEventListener('click', () => div.remove());
  return div;
}

function openPlanDialog(exam) {
  planExam = exam;
  $('#planDialogTitle').textContent = `Plan · ${exam.title}`;
  const d = daysUntil(exam.date);
  $('#planDialogSub').textContent = `${shortDate(exam.date)} · ${d > 1 ? `faltan ${d} días` : d === 1 ? 'es mañana' : d === 0 ? 'es hoy' : 'ya pasó'}`;
  $('#planTopics').innerHTML = [...exam.topics, 'Repaso general'].map(x => `<option value="${esc(x)}">`).join('');
  $('#planError').textContent = '';
  const list = $('#planRows');
  list.innerHTML = '';
  [...exam.plan].sort((a, b) => a.date.localeCompare(b.date)).forEach(i => list.appendChild(planRow(i)));
  if (!exam.plan.length && exam.topics.length) generatePlan();
  planDialog.showModal();
}

/**
 * Reparte los temas en los días que quedan antes del examen y deja
 * el repaso general para el día anterior (si hay al menos dos días).
 */
function generatePlan() {
  const exam = planExam;
  const start = parseISO(todayISO());
  const available = daysUntil(exam.date); // días antes del examen (sin contarlo)
  const dayAt = i => (available > 0 ? todayISO(addDays(start, i)) : exam.date);
  const topicDays = available >= 2 ? available - 1 : Math.max(1, available);
  const list = $('#planRows');
  list.innerHTML = '';
  exam.topics.forEach((topic, i) => {
    list.appendChild(planRow({ date: dayAt(Math.floor(i * topicDays / exam.topics.length)), topic, pomodoros: 2 }));
  });
  list.appendChild(planRow({ date: dayAt(Math.max(0, available - 1)), topic: 'Repaso general', pomodoros: 2 }));
}
$('#planGenerate').addEventListener('click', () => {
  if (!planExam.topics.length) { $('#planError').textContent = 'Primero cargá los temas del examen (editando el examen).'; return; }
  if ($$('#planRows .plan-row').length && !confirm('Esto reemplaza las sesiones cargadas. ¿Continuar?')) return;
  generatePlan();
});
$('#planAddRow').addEventListener('click', () => {
  const rows = $$('#planRows .plan-row');
  const last = rows[rows.length - 1];
  const next = last ? todayISO(addDays(parseISO(last.querySelector('[name=pdate]').value), 1)) : todayISO();
  $('#planRows').appendChild(planRow({ date: next <= planExam.date ? next : planExam.date }));
});

$('#planForm').addEventListener('submit', e => {
  const rows = $$('#planRows .plan-row');
  const plan = rows.map(r => ({
    id: r.dataset.id,
    date: r.querySelector('[name=pdate]').value,
    topic: r.querySelector('[name=ptopic]').value.trim(),
    pomodoros: Math.max(1, Math.min(20, Number(r.querySelector('[name=ppomos]').value) || 1)),
    done: r.dataset.done === '1',
  }));
  if (plan.some(i => i.date > planExam.date)) {
    e.preventDefault();
    $('#planError').textContent = 'Hay sesiones con fecha posterior al examen.';
    return;
  }
  planExam.plan = plan;
  save(); renderAll();
});
