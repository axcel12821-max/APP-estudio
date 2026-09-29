'use strict';
/* ============ Calendario ============
   Reúne clases, tareas, exámenes, planes de estudio, sesiones Pomodoro y recordatorios. */

const CAL_KINDS = {
  class: 'Clases', task: 'Tareas', exam: 'Exámenes', plan: 'Plan de estudio', session: 'Sesiones', reminder: 'Recordatorios',
};
// En el teléfono arranca en vista Día: la semana completa no entra en una pantalla angosta
const calView = { mode: window.matchMedia('(max-width: 760px)').matches ? 'day' : 'week', cursor: new Date(), hidden: new Set() };
const MARKER_MIN = 30; // alto mínimo (en minutos) de eventos puntuales

/** Todos los eventos de un día. Timed: { s, e } en minutos. All-day: allDay: true. */
function eventsOn(date) {
  const iso = todayISO(date);
  const ev = [];
  state.subjects.forEach(sub => (sub.slots || []).forEach(sl => {
    if (Number(sl.day) === date.getDay()) {
      ev.push({ kind: 'class', ref: sub.id, title: sub.name, sub: sub.room, color: sub.color, s: toMin(sl.start), e: toMin(sl.end), time: `${sl.start}–${sl.end}` });
    }
  }));
  state.tasks.forEach(t => {
    const kind = isExam(t) ? 'exam' : 'task';
    if (t.date === iso) {
      const base = { kind, ref: t.id, title: t.title, sub: TYPES[t.type], color: subjectColor(t.subjectId), done: isDone(t) };
      if (t.time) ev.push({ ...base, s: toMin(t.time), e: toMin(t.time) + MARKER_MIN, time: t.time, marker: true });
      else ev.push({ ...base, allDay: true });
    }
    if (isExam(t)) t.plan.filter(i => i.date === iso).forEach(i => ev.push({
      kind: 'plan', ref: t.id, allDay: true, title: `${i.topic} · ${i.pomodoros} 🍅`, sub: t.title,
      color: subjectColor(t.subjectId), done: planItemProgress(i) >= 1,
    }));
    const at = !isDone(t) && taskReminderAt(t);
    if (at && todayISO(at) === iso) {
      const m = at.getHours() * 60 + at.getMinutes();
      ev.push({ kind: 'reminder', ref: 'task:' + t.id, title: t.title, sub: 'Recordatorio de tarea', color: subjectColor(t.subjectId), s: m, e: m + MARKER_MIN, time: hhmm(at), marker: true });
    }
  });
  remindersOn(date).forEach(r => {
    const m = toMin(r.time);
    ev.push({ kind: 'reminder', ref: 'rem:' + r.id, title: r.message || defaultReminderMessage(r.subjectId), sub: 'Recordatorio', color: subjectColor(r.subjectId), s: m, e: m + MARKER_MIN, time: r.time, marker: true });
  });
  state.sessions.filter(x => x.date === iso && x.start).forEach(x => {
    const a = new Date(x.start), b = new Date(x.end);
    const s = a.getHours() * 60 + a.getMinutes();
    const e = todayISO(b) === iso ? b.getHours() * 60 + b.getMinutes() : 24 * 60;
    ev.push({
      kind: 'session', ref: x.id, title: `${subjectName(x.subjectId)}${x.topic ? ' · ' + x.topic : ''}`,
      sub: x.status === 'completed' ? 'Pomodoro completado' : 'Pomodoro incompleto', color: subjectColor(x.subjectId),
      s, e: Math.max(e, s + 10), time: `${hhmm(a)}–${hhmm(b)}`, incomplete: x.status !== 'completed',
    });
  });
  return ev.filter(x => !calView.hidden.has(x.kind));
}

/** Reparte eventos superpuestos en carriles (por grupo de solapamiento). */
function layoutLanes(evts) {
  evts.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    cluster.forEach(ev => {
      let i = lanes.findIndex(end => end <= ev.s);
      if (i < 0) { i = lanes.length; lanes.push(0); }
      lanes[i] = ev.e;
      ev.lane = i;
    });
    cluster.forEach(ev => { ev.lanes = lanes.length; });
    cluster = [];
  };
  evts.forEach(ev => {
    if (ev.s >= clusterEnd) flush();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.e);
  });
  flush();
  return evts;
}

const evAttr = ev => `data-ev="${ev.kind}|${esc(ev.ref)}" ${tipAttr(`<strong>${esc(ev.title)}</strong><br>${esc(ev.sub || '')}${ev.time ? ' · ' + ev.time : ''}`)}`;

function renderTimeGrid(dates) {
  const hourPx = 48;
  const perDay = dates.map(d => eventsOn(d));
  const timed = perDay.flat().filter(e => !e.allDay);
  let minH = 7, maxH = 22;
  if (timed.length) {
    minH = Math.min(minH, ...timed.map(e => Math.floor(e.s / 60)));
    maxH = Math.max(maxH, ...timed.map(e => Math.ceil(e.e / 60)));
  }
  maxH = Math.min(24, maxH);
  const today = todayISO();
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();

  let times = '';
  for (let h = minH + 1; h < maxH; h++) times += `<div style="top:${(h - minH) * hourPx}px">${pad(h)}:00</div>`;

  const allDayRow = perDay.map(evs => `<div class="cal-allday-cell">${evs.filter(e => e.allDay).map(e =>
    `<button class="cal-chip k-${e.kind} ${e.done ? 'done' : ''}" style="--c:${e.color}" ${evAttr(e)}>${esc(e.title)}</button>`).join('')}</div>`).join('');
  const hasAllDay = perDay.some(evs => evs.some(e => e.allDay));

  const cols = dates.map((d, i) => {
    const evs = layoutLanes(perDay[i].filter(e => !e.allDay));
    const blocks = evs.map(e => {
      const top = (e.s - minH * 60) / 60 * hourPx;
      const h = Math.max(18, (e.e - e.s) / 60 * hourPx - 2);
      const w = 100 / e.lanes;
      return `<button class="cal-ev k-${e.kind} ${e.done ? 'done' : ''} ${e.incomplete ? 'incomplete' : ''}" style="--c:${e.color};top:${top + 1}px;height:${h}px;left:calc(${e.lane * w}% + 2px);width:calc(${w}% - 4px)" ${evAttr(e)}>
        ${e.kind === 'reminder' ? ICONS.bell : ''}<strong>${esc(e.title)}</strong>${h > 30 ? `<span>${e.time}</span>` : ''}</button>`;
    }).join('');
    const iso = todayISO(d);
    const nowLine = iso === today && nowMin >= minH * 60 && nowMin <= maxH * 60 ? `<div class="sch-now" style="top:${(nowMin - minH * 60) / 60 * hourPx}px"></div>` : '';
    return `<div class="sch-col ${iso === today ? 'today' : ''}" style="background-size:100% ${hourPx}px">${blocks}${nowLine}</div>`;
  }).join('');

  const head = dates.map(d => `<button class="sch-day cal-dayhead ${todayISO(d) === today ? 'today' : ''}" data-goto="${todayISO(d)}"><span>${DAYS_SHORT[d.getDay()]} ${d.getDate()}</span></button>`).join('');
  return `<div class="schedule cal-grid ${dates.length === 1 ? 'single' : ''}" style="--days:${dates.length}">
    <div class="sch-head"><div></div>${head}</div>
    ${hasAllDay ? `<div class="sch-head cal-allday"><div class="cal-allday-label">Todo el día</div>${allDayRow}</div>` : ''}
    <div class="sch-body" style="height:${(maxH - minH) * hourPx}px"><div class="sch-times">${times}</div>${cols}</div>
  </div>`;
}

function renderMonth() {
  const c = calView.cursor;
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const start = startOfWeek(first);
  const today = todayISO();
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  // Recortar la última fila si es del mes siguiente
  const visible = cells[35].getMonth() !== c.getMonth() ? cells.slice(0, 35) : cells;
  return `<div class="cal-month">
    ${DAY_ORDER.map(d => `<div class="cal-mhead">${DAYS_SHORT[d]}</div>`).join('')}
    ${visible.map(d => {
      const iso = todayISO(d);
      const evs = eventsOn(d);
      const chips = evs.filter(e => ['exam', 'task', 'plan'].includes(e.kind)).sort((a, b) => (a.kind === 'exam' ? -1 : 0) - (b.kind === 'exam' ? -1 : 0));
      const classes = evs.filter(e => e.kind === 'class').length;
      const sessions = evs.filter(e => e.kind === 'session' && !e.incomplete).length;
      const rems = evs.filter(e => e.kind === 'reminder').length;
      return `<button class="cal-mcell ${d.getMonth() !== c.getMonth() ? 'other' : ''} ${iso === today ? 'today' : ''}" data-goto="${iso}">
        <span class="cal-mnum">${d.getDate()}</span>
        <span class="cal-mchips">
          ${chips.slice(0, 3).map(e => `<span class="cal-mchip k-${e.kind} ${e.done ? 'done' : ''}" style="--c:${e.color}">${esc(e.title)}</span>`).join('')}
          ${chips.length > 3 ? `<span class="muted cal-more">+${chips.length - 3} más</span>` : ''}
        </span>
        <span class="cal-mdots">
          ${classes ? `<span title="${classes} clase${classes > 1 ? 's' : ''}">${classes} cl</span>` : ''}
          ${sessions ? `<span title="${sessions} pomodoro${sessions > 1 ? 's' : ''}">${sessions} 🍅</span>` : ''}
          ${rems ? `<span title="${rems} recordatorio${rems > 1 ? 's' : ''}">${ICONS.bell}${rems}</span>` : ''}
        </span>
      </button>`;
    }).join('')}
  </div>`;
}

function renderCalendar() {
  const c = calView.cursor;
  $$('#calMode button').forEach(b => b.classList.toggle('active', b.dataset.mode === calView.mode));
  $('#calFilters').innerHTML = Object.entries(CAL_KINDS).map(([k, l]) =>
    `<button type="button" class="filter-chip k-${k} ${calView.hidden.has(k) ? '' : 'on'}" data-kind="${k}" aria-pressed="${!calView.hidden.has(k)}">${l}</button>`).join('');

  let title, body;
  if (calView.mode === 'day') {
    title = capitalize(c.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    body = renderTimeGrid([c]);
  } else if (calView.mode === 'week') {
    const s = startOfWeek(c), e = addDays(s, 6);
    title = `${s.getDate()} ${s.toLocaleDateString('es', { month: 'short' })} – ${e.getDate()} ${e.toLocaleDateString('es', { month: 'short', year: 'numeric' })}`;
    body = renderTimeGrid(Array.from({ length: 7 }, (_, i) => addDays(s, i)));
  } else {
    title = capitalize(c.toLocaleDateString('es', { month: 'long', year: 'numeric' }));
    body = renderMonth();
  }
  $('#calTitle').textContent = title;
  $('#calBody').innerHTML = body;
}
renderers.calendario = renderCalendar;

function calShift(dir) {
  const c = calView.cursor;
  if (calView.mode === 'day') calView.cursor = addDays(c, dir);
  else if (calView.mode === 'week') calView.cursor = addDays(c, dir * 7);
  else calView.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
  renderCalendar();
}
$('#calPrev').addEventListener('click', () => calShift(-1));
$('#calNext').addEventListener('click', () => calShift(1));
$('#calToday').addEventListener('click', () => { calView.cursor = new Date(); renderCalendar(); });
$('#calMode').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  calView.mode = b.dataset.mode;
  renderCalendar();
});
$('#calFilters').addEventListener('click', e => {
  const b = e.target.closest('[data-kind]');
  if (!b) return;
  const k = b.dataset.kind;
  calView.hidden.has(k) ? calView.hidden.delete(k) : calView.hidden.add(k);
  renderCalendar();
});
$('#calBody').addEventListener('click', e => {
  const ev = e.target.closest('[data-ev]');
  if (ev) {
    const [kind, ref] = ev.dataset.ev.split('|');
    if (kind === 'class') openSubjectDialog(subjectById(ref));
    else if (kind === 'task' || kind === 'exam') openTaskDialog(taskById(ref));
    else if (kind === 'plan') location.hash = '#examenes';
    else if (kind === 'reminder') {
      const [src, id] = ref.split(':');
      if (src === 'rem') openReminderDialog(state.reminders.find(r => r.id === id));
      else openTaskDialog(taskById(id));
    }
    return;
  }
  const go = e.target.closest('[data-goto]');
  if (go && !(calView.mode === 'day')) {
    calView.cursor = parseISO(go.dataset.goto);
    calView.mode = 'day';
    renderCalendar();
  }
});
