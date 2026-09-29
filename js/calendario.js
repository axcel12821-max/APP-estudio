'use strict';
/* ============ Calendario ============
   Reúne clases, tareas, exámenes, planes de estudio, sesiones Pomodoro y recordatorios. */

const CAL_KINDS = {
  class: 'Clases', task: 'Tareas', exam: 'Exámenes', plan: 'Plan de estudio', session: 'Sesiones', reminder: 'Recordatorios',
};
// Arranca en vista Día: es la página de inicio y lo primero que se ve son las tareas de hoy
const calView = { mode: 'day', cursor: new Date(), hidden: new Set() };
const MARKER_MIN = 30; // alto mínimo (en minutos) de eventos puntuales
const EV_MIN_PX = 22; // alto mínimo de un evento para que el título se lea entero

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
    const at = !isDone(t) && taskReminderAt(t);
    if (t.date === iso) {
      // El recordatorio no se dibuja aparte: se muestra como reloj (con su hora al pasar el mouse)
      const remindAt = at ? (todayISO(at) === iso ? hhmm(at) : `${at.toLocaleDateString('es', { day: 'numeric', month: 'short' })} ${hhmm(at)}`) : null;
      const base = { kind, ref: t.id, subjectId: t.subjectId, priority: t.priority, remindAt, title: t.title, sub: TYPES[t.type], color: subjectColor(t.subjectId), done: isDone(t) };
      if (t.time) ev.push({ ...base, s: toMin(t.time), e: toMin(t.time) + MARKER_MIN, time: t.time, marker: true });
      else ev.push({ ...base, allDay: true });
    }
    if (isExam(t)) t.plan.filter(i => i.date === iso).forEach(i => ev.push({
      kind: 'plan', ref: t.id, allDay: true, title: `${i.topic} · ${i.pomodoros} 🍅`, sub: t.title,
      color: subjectColor(t.subjectId), done: planItemProgress(i) >= 1,
    }));
    // Solo si la tarea no aparece ese día (p. ej. recordatorio la víspera de la entrega)
    if (at && todayISO(at) === iso && t.date !== iso) {
      const m = at.getHours() * 60 + at.getMinutes();
      ev.push({ kind: 'reminder', ref: 'task:' + t.id, subjectId: t.subjectId, priority: t.priority, title: t.title, sub: 'Recordatorio de tarea', color: subjectColor(t.subjectId), s: m, e: m + MARKER_MIN, time: hhmm(at), marker: true });
    }
  });
  remindersOn(date).forEach(r => {
    const m = toMin(r.time);
    ev.push({ kind: 'reminder', ref: 'rem:' + r.id, subjectId: r.subjectId, title: r.message || defaultReminderMessage(r.subjectId), sub: 'Recordatorio', color: subjectColor(r.subjectId), s: m, e: m + MARKER_MIN, time: r.time, marker: true });
  });
  state.sessions.filter(x => x.date === iso && x.start).forEach(x => {
    const a = new Date(x.start), b = new Date(x.end);
    const s = a.getHours() * 60 + a.getMinutes();
    const e = todayISO(b) === iso ? b.getHours() * 60 + b.getMinutes() : 24 * 60;
    ev.push({
      kind: 'session', ref: x.id, subjectId: x.subjectId, title: `${subjectName(x.subjectId)}${x.topic ? ' · ' + x.topic : ''}`,
      short: x.topic || 'Pomodoro', // dentro de la clase la materia ya se ve: solo el tema
      sub: x.status === 'completed' ? 'Pomodoro completado' : `Pomodoro parcial (${fmtDur(sessionMinutes(x))})`, color: subjectColor(x.subjectId),
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

/**
 * Tareas, exámenes y recordatorios de una materia con clase ese día se dibujan dentro
 * de esa clase (la más cercana a su horario; las de todo el día, en la primera clase)
 * en lugar de ocupar un carril propio o la fila "Todo el día".
 * Devuelve [eventos libres, mapa clase → eventos anidados].
 */
const NESTABLE = ['task', 'exam', 'reminder', 'session'];
const SESSION_PX = 16; // las sesiones Pomodoro dentro de una clase son barras finas
function nestInClasses(evs) {
  const classes = evs.filter(e => e.kind === 'class').sort((a, b) => a.s - b.s);
  const nested = new Map();
  const free = evs.filter(e => {
    if (!NESTABLE.includes(e.kind) || !e.subjectId) return true;
    const own = classes.filter(c => c.ref === e.subjectId);
    if (!own.length) return true;
    const dist = c => e.s < c.s ? c.s - e.s : e.s >= c.e ? e.s - c.e + 1 : 0;
    const host = e.allDay ? own[0] : own.reduce((a, b) => dist(b) < dist(a) ? b : a);
    if (!nested.has(host)) nested.set(host, []);
    nested.get(host).push(e);
    return false;
  });
  return [free, nested];
}

/** Alto de una hora para que el día entero entre en la pantalla sin desplazarse. */
const HOUR_PX_MIN = 18, HOUR_PX_MAX = 96;
function fitHourPx(hours) {
  const body = $('#calBody .sch-body');
  if (!body || !hours) return 48;
  // Posiciones absolutas en la página: lo que hay arriba de la grilla y lo que queda debajo
  // (borde de la tarjeta, márgenes, espacio para la barra inferior del teléfono)
  const r = body.getBoundingClientRect();
  const above = r.top + scrollY;
  const below = document.documentElement.scrollHeight - (r.bottom + scrollY);
  const avail = innerHeight - above - below - 1;
  return Math.max(HOUR_PX_MIN, Math.min(HOUR_PX_MAX, Math.floor(avail / hours)));
}

const prioDot = ev => ev.priority ? `<i class="prio-dot p-${ev.priority}" title="Prioridad ${PRIORITY[ev.priority]?.toLowerCase() || ''}"></i>` : '';
/** Reloj junto a la prioridad cuando la tarea tiene recordatorio; su hora aparece al pasar el mouse. */
const remindIcon = ev => ev.remindAt ? `<i class="cal-remind" ${tipAttr(`Recordatorio · ${esc(ev.remindAt)}`)}>${ICONS.clock}</i>` : '';
const evBadges = ev => `${ev.priority ? 'has-prio' : ''} ${ev.remindAt ? 'has-remind' : ''}`;
const evAttr = ev =>`data-ev="${ev.kind}|${esc(ev.ref)}" ${tipAttr(`<strong>${esc(ev.title)}</strong><br>${esc(ev.sub || '')}${ev.time ? ' · ' + ev.time : ''}${ev.remindAt ? `<br>Recordatorio · ${esc(ev.remindAt)}` : ''}`)}`;

function renderTimeGrid(dates, hourPx = 48) {
  const perDay = dates.map(d => eventsOn(d));
  const split = perDay.map(evs => nestInClasses(evs));
  const timed = split.flatMap(([free]) => free.filter(e => !e.allDay));
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

  const allDayFree = split.map(([free]) => free.filter(e => e.allDay));
  const allDayRow = allDayFree.map(evs => `<div class="cal-allday-cell">${evs.map(e =>
    `<button class="cal-chip k-${e.kind} ${e.done ? 'done' : ''} ${evBadges(e)}" style="--c:${e.color}" ${evAttr(e)}>${esc(e.title)}${remindIcon(e)}${prioDot(e)}</button>`).join('')}</div>`).join('');
  const hasAllDay = allDayFree.some(evs => evs.length);

  // `host`: clase que contiene al evento; toma su color para que el trazo coincida con el de la materia
  const evBtn = (e, top, h, left, width, host = null) =>
    `<button class="cal-ev k-${e.kind} ${e.done ? 'done' : ''} ${e.incomplete ? 'incomplete' : ''} ${host ? 'nested' : ''} ${evBadges(e)}" style="--c:${host ? host.color : e.color};top:${top}px;height:${h}px;left:${left};width:${width}${host ? ';z-index:2' : ''}" ${evAttr(e)}>
        ${e.kind === 'reminder' ? ICONS.bell : ''}${remindIcon(e)}${prioDot(e)}<strong>${esc(host && e.short ? e.short : e.title)}</strong>${h > 30 && e.time ? `<span>${e.time}</span>` : ''}</button>`;

  const cols = dates.map((d, i) => {
    const [free, nested] = split[i];
    const evs = layoutLanes(free.filter(e => !e.allDay));
    const blocks = evs.map(e => {
      const top = (e.s - minH * 60) / 60 * hourPx + 1;
      const h = Math.max(EV_MIN_PX, (e.e - e.s) / 60 * hourPx - 2);
      const w = 100 / e.lanes;
      let html = evBtn(e, top, h, `calc(${e.lane * w}% + 2px)`, `calc(${w}% - 4px)`);
      // Lo anidado queda dentro del rango de la clase, debajo de su título
      // Las de todo el día van primero, arriba de todo
      const inner = (nested.get(e) || []).sort((a, b) => (a.allDay ? -Infinity : a.s) - (b.allDay ? -Infinity : b.s) || 0);
      const mh = Math.max(EV_MIN_PX, MARKER_MIN / 60 * hourPx - 2);
      const hs = inner.map(x => x.kind === 'session' ? SESSION_PX : mh);
      const lo = Math.min(top + (h > 30 ? 34 : 20), top + h - mh - 2);
      const hiOf = k => Math.max(lo, top + h - hs[k] - 2);
      // Hacia abajo sin encimarse; si se pasan del final de la clase, se apilan hacia arriba.
      // Si ya no queda lugar en la clase, el siguiente se dibuja encima del anterior.
      const ys = [];
      inner.forEach((x, k) => {
        const want = x.allDay ? lo : (x.s - minH * 60) / 60 * hourPx + 1;
        ys[k] = Math.min(hiOf(k), Math.max(lo, want, k ? ys[k - 1] + hs[k - 1] + 2 : -Infinity));
      });
      for (let k = ys.length - 2; k >= 0; k--) ys[k] = Math.max(lo, Math.min(ys[k], ys[k + 1] - hs[k] - 2));
      inner.forEach((x, k) => { html += evBtn(x, ys[k], hs[k], `calc(${e.lane * w}% + 8px)`, `calc(${w}% - 16px)`, e); });
      return html;
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

  let title, dates = null;
  if (calView.mode === 'day') {
    title = capitalize(c.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    dates = [c];
  } else if (calView.mode === 'week') {
    const s = startOfWeek(c), e = addDays(s, 6);
    title = `${s.getDate()} ${s.toLocaleDateString('es', { month: 'short' })} – ${e.getDate()} ${e.toLocaleDateString('es', { month: 'short', year: 'numeric' })}`;
    dates = Array.from({ length: 7 }, (_, i) => addDays(s, i));
  } else {
    title = capitalize(c.toLocaleDateString('es', { month: 'long', year: 'numeric' }));
  }
  $('#calTitle').textContent = title;
  if (!dates) { $('#calBody').innerHTML = renderMonth(); return; }
  // Primero se dibuja para medir dónde empieza la grilla; después se ajusta al alto de la pantalla
  $('#calBody').innerHTML = renderTimeGrid(dates);
  const body = $('#calBody .sch-body');
  const hourPx = fitHourPx(body.offsetHeight / 48);
  if (hourPx !== 48) $('#calBody').innerHTML = renderTimeGrid(dates, hourPx);
}
renderers.calendario = renderCalendar;
let calResizeT;
window.addEventListener('resize', () => {
  clearTimeout(calResizeT);
  calResizeT = setTimeout(() => { if (currentView() === 'calendario') renderCalendar(); }, 150);
});

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
