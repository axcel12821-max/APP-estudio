'use strict';
/* ============ Panel (centro de control) ============ */

function renderPanel() {
  const now = new Date();
  $('#todayLabel').textContent = capitalize(now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  $('#careerLabel').textContent = [state.career, state.institution].filter(Boolean).join(' · ') || 'Cargá tu carrera en la sección Materias.';

  // Resumen
  const slots = allSlots();
  const weeklyMin = slots.reduce((acc, s) => acc + Math.max(0, toMin(s.end) - toMin(s.start)), 0);
  const pending = state.tasks.filter(t => !isDone(t));
  const nextExam = pending.filter(t => isExam(t) && daysUntil(t.date) >= 0).sort(byDate)[0];
  $('#statSubjects').textContent = state.subjects.length;
  $('#statHours').textContent = +(weeklyMin / 60).toFixed(1);
  $('#statPending').textContent = pending.filter(t => !isExam(t)).length;
  if (nextExam) {
    const d = daysUntil(nextExam.date);
    $('#statExam').textContent = d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `${d} días`;
    $('#statExamLabel').textContent = `${TYPES[nextExam.type]}${nextExam.subjectId ? ' · ' + subjectName(nextExam.subjectId) : ''}`;
  } else {
    $('#statExam').textContent = '—';
    $('#statExamLabel').textContent = 'Próximo examen';
  }

  $('#todayTitle').textContent = `Hoy — ${DAYS[now.getDay()]} ${now.getDate()}`;
  renderToday(slots, now);
  renderPanelGoals();
  renderStudyToday();
  renderUpcoming(pending);
  renderPanelTasks(pending);
  renderPanelSubjects();
  renderSchedule(slots, now);
}
renderers.panel = renderPanel;

function renderToday(slots, now) {
  const list = $('#todayList');
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = slots.filter(s => Number(s.day) === now.getDay()).sort((a, b) => toMin(a.start) - toMin(b.start));
  $('#todayCount').textContent = today.length ? `${today.length} clase${today.length > 1 ? 's' : ''}` : '';
  if (!today.length) {
    list.innerHTML = `<li class="empty">${state.subjects.length ? 'No tenés clases hoy.' : 'Todavía no cargaste materias.<br><a class="btn btn-ghost btn-sm" href="#materias">Agregar materias</a>'}</li>`;
    return;
  }
  let nextMarked = false;
  list.innerHTML = today.map(s => {
    const st = toMin(s.start), en = toMin(s.end);
    let pill = '', cls = '';
    if (nowMin >= st && nowMin < en) { pill = '<span class="pill live">En curso</span>'; nextMarked = true; }
    else if (nowMin >= en) { cls = 'past'; pill = '<span class="pill">Terminada</span>'; }
    else if (!nextMarked) {
      nextMarked = true;
      const diff = st - nowMin;
      pill = `<span class="pill next">${diff < 60 ? `En ${diff} min` : `En ${Math.floor(diff / 60)} h ${diff % 60 ? diff % 60 + ' min' : ''}`}</span>`;
    }
    return `<li class="row-item ${cls}">
      <span class="time-col">${s.start}</span>
      <span class="bar" style="background:${s.subject.color}"></span>
      <div class="grow">
        <div class="title">${esc(s.subject.name)}</div>
        <div class="meta">hasta ${s.end}${s.subject.room ? ' · ' + esc(s.subject.room) : ''}</div>
      </div>${pill}</li>`;
  }).join('');
}

function renderPanelGoals() {
  const items = dailyGoalItems();
  const done = items.filter(i => i.value >= i.target).length;
  $('#panelGoalsNote').textContent = items.length ? `${done} de ${items.length} cumplido${items.length > 1 ? 's' : ''}` : '';
  $('#panelGoals').innerHTML = items.length ? goalsHTML(items) : '<p class="muted small">No definiste objetivos diarios. <a class="link" href="#objetivos">Definir →</a></p>';
}

function renderStudyToday() {
  const tot = studyTotals(todayRange());
  $('#studyTodayTime').textContent = fmtDur(tot.minutes);
  $('#studyTodayPomos').textContent = tot.pomodoros;
  const running = pomo.session || pomo.running;
  $('#studyTodayBtn').innerHTML = running ? `${ICONS.play}Volver al Pomodoro (${fmt(pomo.remaining)})` : `${ICONS.play}Iniciar Pomodoro`;

  // Sesiones del plan de estudio previstas para hoy
  const today = todayISO();
  const planToday = state.tasks.filter(t => isExam(t) && !isDone(t)).flatMap(t => t.plan.filter(i => i.date === today).map(i => ({ t, i })));
  $('#planToday').innerHTML = planToday.length ? `<div class="muted small label-sm">Plan de estudio de hoy</div>` + planToday.map(({ t, i }) => {
    const n = planItemPomos(i), complete = planItemProgress(i) >= 1;
    return `<div class="plan-item ${complete ? 'complete' : ''}">
      <span class="dot" style="background:${subjectColor(t.subjectId)}"></span>
      <span class="grow">${esc(i.topic)} <span class="muted small">· ${esc(t.title)}</span></span>
      <span class="muted small tnum">${Math.min(n, i.pomodoros)}/${i.pomodoros} 🍅</span>
      ${complete ? '' : `<button class="btn btn-ghost btn-xs" data-plan-study="${t.id}:${i.id}">${ICONS.play}Estudiar</button>`}
    </div>`;
  }).join('') : '';
}
$('#planToday').addEventListener('click', e => {
  const b = e.target.closest('[data-plan-study]');
  if (!b) return;
  const [tid, iid] = b.dataset.planStudy.split(':');
  const t = taskById(tid), i = t.plan.find(x => x.id === iid);
  pomoPrefill({ subjectId: t.subjectId, topic: i.topic, planItemId: i.id });
  location.hash = '#pomodoro';
});

/** Próximos eventos: exámenes, parciales, entregas y tareas, con semáforo de urgencia. */
function renderUpcoming(pending) {
  const list = $('#upcomingList');
  const items = [...pending].filter(t => daysUntil(t.date) >= -7).sort(byDate).slice(0, 6);
  if (!items.length) {
    list.innerHTML = '<li class="empty">Nada pendiente. ¡Bien ahí!<br><a class="btn btn-ghost btn-sm" href="#tareas">Agregar tarea</a></li>';
    return;
  }
  list.innerHTML = items.map(t => {
    const sub = subjectById(t.subjectId);
    const due = dueLabel(t);
    const d = daysUntil(t.date);
    const level = d <= 3 ? 'red' : d <= 7 ? 'yellow' : 'green';
    const levelText = { red: 'Urgente', yellow: 'Pronto', green: 'Con tiempo' }[level];
    return `<li class="row-item">
      <span class="sem sem-${level}" title="${levelText}" aria-label="${levelText}"></span>
      <div class="grow">
        <div class="title">${esc(t.title)}</div>
        <div class="meta">${TYPES[t.type]}${sub ? ' · ' + esc(sub.name) : ''}</div>
      </div><span class="pill ${due.cls}">${due.text}</span></li>`;
  }).join('');
}

function renderPanelTasks(pending) {
  const tasks = pending.filter(t => !isExam(t)).sort(byDate).slice(0, 6);
  $('#panelTasks').innerHTML = tasks.length ? tasks.map(t => `
    <li class="mini-task status-${t.status}">
      <button class="task-check sm" data-toggle="${t.id}" aria-label="Marcar como completada">${ICONS.check}</button>
      <div class="grow">
        <div class="title">${esc(t.title)}</div>
        <div class="meta">${t.subjectId ? `<span class="dot" style="background:${subjectColor(t.subjectId)}"></span>${esc(subjectName(t.subjectId))} · ` : ''}${dueLabel(t).text}${t.status === 'progress' ? ' · en progreso' : ''}</div>
      </div>
    </li>`).join('') : '<li class="empty">No hay tareas pendientes.</li>';
}
$('#panelTasks').addEventListener('click', handleTaskClick);

function renderPanelSubjects() {
  const el = $('#panelSubjects');
  if (!state.subjects.length) {
    el.innerHTML = '<p class="empty">Todavía no cargaste materias.</p>';
    return;
  }
  const week = weekRange();
  el.innerHTML = state.subjects.map(s => {
    const wk = studyTotals(week, s.id);
    const g = subjectGoalProgress(s, week)[0];
    return `<div class="panel-subject" style="--c:${s.color}">
      <div class="ps-top"><span class="dot" style="background:${s.color}"></span><span class="grow">${esc(s.name)}</span></div>
      <div class="ps-num">${fmtDur(wk.minutes)}</div>
      <div class="muted small">esta semana · ${wk.pomodoros} 🍅</div>
      ${g ? `<div class="ps-goal"><div class="progress-track"><div class="progress-fill" style="width:${clamp01(g.value / g.target) * 100}%;background:${s.color}"></div></div><span class="muted small">${Math.round(clamp01(g.value / g.target) * 100)}% del objetivo</span></div>` : ''}
    </div>`;
  }).join('');
}

function renderSchedule(slots, now) {
  const wrap = $('#schedule');
  if (!slots.length) {
    wrap.innerHTML = '<div class="empty">Tus clases van a aparecer acá, organizadas por día y horario.<br><a class="btn btn-ghost btn-sm" href="#materias">Cargar materias y horarios</a></div>';
    return;
  }
  const used = new Set(slots.map(s => Number(s.day)));
  const days = DAY_ORDER.filter(d => d <= 5 && d >= 1 || used.has(d));
  let minH = Math.min(...slots.map(s => Math.floor(toMin(s.start) / 60)));
  let maxH = Math.max(...slots.map(s => Math.ceil(toMin(s.end) / 60)));
  minH = Math.max(0, Math.min(minH, 8));
  maxH = Math.min(24, Math.max(maxH, minH + 8));
  const hourPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour')) || 56;
  const height = (maxH - minH) * hourPx;
  const todayIdx = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  let times = '';
  for (let h = minH + 1; h < maxH; h++) times += `<div style="top:${(h - minH) * hourPx}px">${pad(h)}:00</div>`;

  const cols = days.map(d => {
    const blocks = slots.filter(s => Number(s.day) === d).map(s => {
      const top = (toMin(s.start) - minH * 60) / 60 * hourPx;
      const h = Math.max(22, (toMin(s.end) - toMin(s.start)) / 60 * hourPx - 2);
      return `<div class="sch-block" style="--c:${s.subject.color};top:${top + 1}px;height:${h}px" title="${esc(s.subject.name)} ${s.start}–${s.end}">
        <strong>${esc(s.subject.name)}</strong><span>${s.start} – ${s.end}</span>${s.subject.room ? `<span>${esc(s.subject.room)}</span>` : ''}</div>`;
    }).join('');
    const nowLine = d === todayIdx && nowMin >= minH * 60 && nowMin <= maxH * 60
      ? `<div class="sch-now" style="top:${(nowMin - minH * 60) / 60 * hourPx}px"></div>` : '';
    return `<div class="sch-col ${d === todayIdx ? 'today' : ''}">${blocks}${nowLine}</div>`;
  }).join('');

  wrap.innerHTML = `<div class="schedule" style="--days:${days.length}">
    <div class="sch-head"><div></div>${days.map(d => `<div class="sch-day ${d === todayIdx ? 'today' : ''}"><span>${DAYS_SHORT[d]}</span></div>`).join('')}</div>
    <div class="sch-body" style="height:${height}px"><div class="sch-times">${times}</div>${cols}</div>
  </div>`;
}
