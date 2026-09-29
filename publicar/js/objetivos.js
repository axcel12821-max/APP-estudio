'use strict';
/* ============ Objetivos ============
   Todo el progreso sale de sesiones Pomodoro completadas y tareas completadas reales.
   Un valor 0 desactiva el objetivo. */

const todayRange = () => [todayISO(), todayISO(addDays(new Date(), 1))];

function dailyGoalItems() {
  const g = state.goals.daily;
  const tot = studyTotals(todayRange());
  const out = [];
  if (g.minutes > 0) out.push({ key: 'minutes', label: 'Estudio', value: tot.minutes, target: g.minutes, fmt: fmtDur });
  if (g.pomodoros > 0) out.push({ key: 'pomodoros', label: 'Pomodoros', value: tot.pomodoros, target: g.pomodoros });
  if (g.tasks > 0) out.push({ key: 'tasks', label: 'Tareas', value: tasksCompletedIn(todayRange()), target: g.tasks });
  return out;
}

/** Tareas (no exámenes) que vencen esta semana: completadas / total. */
function weekTasksDue() {
  const wr = weekRange();
  const list = state.tasks.filter(t => !isExam(t) && inRange(t.date, wr));
  return { done: list.filter(isDone).length, total: list.length };
}

function weeklyGoalItems() {
  const g = state.goals.weekly;
  const tot = studyTotals(weekRange());
  const out = [];
  if (g.minutes > 0) out.push({ key: 'minutes', label: 'Estudio', value: tot.minutes, target: g.minutes, fmt: fmtDur });
  if (g.pomodoros > 0) out.push({ key: 'pomodoros', label: 'Pomodoros', value: tot.pomodoros, target: g.pomodoros });
  if (g.allTasks) {
    const w = weekTasksDue();
    if (w.total) out.push({ key: 'allTasks', label: 'Tareas que vencen esta semana', value: w.done, target: w.total });
  }
  return out;
}

const goalsHTML = items => items.map(i => progressHTML(i.label, i.value, i.target, i.fmt)).join('');

/** Celebra (una sola vez por período) los objetivos que se acaban de cumplir. */
function checkGoals() {
  const day = todayISO(), week = weekRange()[0];
  const hits = [];
  const mark = (key, text) => {
    if (state.achieved[key]) return;
    state.achieved[key] = true;
    hits.push(text);
  };
  dailyGoalItems().forEach(i => { if (i.value >= i.target) mark(`d:${day}:${i.key}`, `Objetivo diario · ${i.label}`); });
  weeklyGoalItems().forEach(i => { if (i.value >= i.target) mark(`w:${week}:${i.key}`, `Objetivo semanal · ${i.label}`); });
  state.subjects.forEach(s => subjectGoalProgress(s).forEach(i => {
    if (i.value >= i.target) mark(`s:${week}:${s.id}:${i.key}`, `${s.name} · ${i.label} de la semana`);
  }));
  // Limpiar marcas de más de 60 días
  const cutoff = todayISO(addDays(new Date(), -60));
  Object.keys(state.achieved).forEach(k => { if (k.split(':')[1] < cutoff) delete state.achieved[k]; });
  save();
  hits.forEach(h => toast('¡Objetivo cumplido! 🎉', h, 'success'));
  if (hits.length) beep([659, 784, 1046]);
}

function renderGoals() {
  const d = dailyGoalItems(), w = weeklyGoalItems();
  $('#goalsDaily').innerHTML = d.length ? goalsHTML(d) : '<p class="muted small">No definiste objetivos diarios.</p>';
  $('#goalsWeekly').innerHTML = w.length ? goalsHTML(w)
    : `<p class="muted small">${state.goals.weekly.allTasks && !weekTasksDue().total ? 'No hay tareas que venzan esta semana. ' : ''}${!state.goals.weekly.minutes && !state.goals.weekly.pomodoros ? 'No definiste objetivos semanales.' : ''}</p>`;

  const gd = state.goals.daily, gw = state.goals.weekly;
  $('#gDailyHours').value = +(gd.minutes / 60).toFixed(2);
  $('#gDailyPomos').value = gd.pomodoros;
  $('#gDailyTasks').value = gd.tasks;
  $('#gWeeklyHours').value = +(gw.minutes / 60).toFixed(2);
  $('#gWeeklyPomos').value = gw.pomodoros;
  $('#gWeeklyAll').checked = gw.allTasks;

  const el = $('#subjectGoals');
  if (!state.subjects.length) {
    el.innerHTML = '<div class="card empty">Cargá materias para definir objetivos por materia.</div>';
    return;
  }
  el.innerHTML = state.subjects.map(s => {
    const prog = subjectGoalProgress(s);
    return `<div class="card subject-goal" style="--c:${s.color}">
      <div class="card-head"><h2><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</h2><span class="muted small">Objetivo semanal</span></div>
      <div class="goal-inputs">
        <label class="field"><span>Horas</span><input type="number" min="0" max="80" step="0.5" value="${s.goals.hours}" data-sgoal="${s.id}:hours"></label>
        <label class="field"><span>Pomodoros</span><input type="number" min="0" max="200" value="${s.goals.pomodoros}" data-sgoal="${s.id}:pomodoros"></label>
        <label class="field"><span>Sesiones <span class="info-tip" title="Una sesión es un bloque continuo de Pomodoros de la materia (con sus descansos).">?</span></span><input type="number" min="0" max="50" value="${s.goals.sessions}" data-sgoal="${s.id}:sessions"></label>
      </div>
      ${prog.length ? prog.map(i => progressHTML(i.label, i.value, i.target, i.fmt, s.color)).join('') : '<p class="muted small">Sin objetivos. Poné un valor mayor a 0 para activarlo.</p>'}
    </div>`;
  }).join('');
}
renderers.objetivos = renderGoals;

function readNum(el, max) {
  const v = Math.max(0, Math.min(max, Number(el.value) || 0));
  el.value = v;
  return v;
}
$('#goalsForm').addEventListener('change', e => {
  const gd = state.goals.daily, gw = state.goals.weekly;
  gd.minutes = Math.round(readNum($('#gDailyHours'), 24) * 60);
  gd.pomodoros = readNum($('#gDailyPomos'), 50);
  gd.tasks = readNum($('#gDailyTasks'), 50);
  gw.minutes = Math.round(readNum($('#gWeeklyHours'), 120) * 60);
  gw.pomodoros = readNum($('#gWeeklyPomos'), 300);
  gw.allTasks = $('#gWeeklyAll').checked;
  save(); renderGoals();
});
$('#subjectGoals').addEventListener('change', e => {
  const inp = e.target.closest('[data-sgoal]');
  if (!inp) return;
  const [sid, key] = inp.dataset.sgoal.split(':');
  subjectById(sid).goals[key] = readNum(inp, Number(inp.max));
  save(); renderGoals();
});
