'use strict';
/* ============ Estadísticas ============
   Todo se calcula a partir de state.sessions (solo completadas suman tiempo),
   state.tasks (completedAt) y state.subjects. Nada es estimado. */

const statsView = { period: 'week', offset: 0 };

function statsRange() {
  const now = new Date();
  if (statsView.period === 'day') {
    const d = addDays(now, statsView.offset);
    return { range: [todayISO(d), todayISO(addDays(d, 1))], label: capitalize(d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })), start: d };
  }
  if (statsView.period === 'week') {
    const s = addDays(startOfWeek(now), statsView.offset * 7);
    const e = addDays(s, 6);
    return { range: weekRange(s), label: `${s.getDate()} ${s.toLocaleDateString('es', { month: 'short' })} – ${e.getDate()} ${e.toLocaleDateString('es', { month: 'short' })}`, start: s };
  }
  const m = new Date(now.getFullYear(), now.getMonth() + statsView.offset, 1);
  return { range: monthRange(m), label: capitalize(m.toLocaleDateString('es', { month: 'long', year: 'numeric' })), start: m };
}

/** Minutos completados por materia en un rango, de mayor a menor. */
function minutesBySubject(range) {
  const map = {};
  completedSessions().filter(x => inRange(x.date, range)).forEach(x => {
    const m = map[x.subjectId] || (map[x.subjectId] = { minutes: 0, pomodoros: 0 });
    m.minutes += x.plannedMin;
    m.pomodoros++;
  });
  return Object.entries(map).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.minutes - a.minutes);
}

/** Barras horizontales por materia, rotuladas con nombre y valor (identidad nunca solo por color). */
function subjectBarsHTML(rows, showShare) {
  if (!rows.length) return '<p class="empty">Sin sesiones completadas en este período.</p>';
  const max = rows[0].minutes;
  const total = rows.reduce((a, r) => a + r.minutes, 0);
  return `<div class="hbars">${rows.map(r => `
    <div class="hbar-row" ${tipAttr(`<strong>${esc(subjectName(r.id))}</strong><br>${fmtDur(r.minutes)} · ${r.pomodoros} pomodoro${r.pomodoros === 1 ? '' : 's'}${showShare ? ` · ${Math.round(r.minutes / total * 100)}%` : ''}`)}>
      <span class="hbar-label">${esc(subjectName(r.id))}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(2, r.minutes / max * 100)}%;background:${subjectColor(r.id)}"></span></span>
      <span class="hbar-value">${fmtDur(r.minutes)}${showShare ? `<span class="muted"> · ${Math.round(r.minutes / total * 100)}%</span>` : ''}</span>
    </div>`).join('')}</div>`;
}

/** Columnas verticales de una sola serie. `cols`: [{ label, minutes, tip, highlight }] */
function columnsHTML(cols, { dense = false } = {}) {
  const max = Math.max(...cols.map(c => c.minutes));
  if (!max) return '<p class="empty">Sin sesiones completadas en este período.</p>';
  const peak = cols.findIndex(c => c.minutes === max);
  return `<div class="vbars ${dense ? 'dense' : ''}">${cols.map((c, i) => `
    <div class="vbar-col ${c.highlight ? 'hl' : ''}" ${tipAttr(`<strong>${esc(c.tip)}</strong><br>${c.minutes ? fmtDur(c.minutes) : 'Sin estudio'}`)}>
      <span class="vbar-value">${i === peak ? fmtDur(c.minutes) : ''}</span>
      <span class="vbar-bar" style="height:${c.minutes / max * 100}%"></span>
      <span class="vbar-label">${c.label}</span>
    </div>`).join('')}</div>`;
}

function dailyMinutes(range) {
  const map = {};
  completedSessions().filter(x => inRange(x.date, range)).forEach(x => { map[x.date] = (map[x.date] || 0) + x.plannedMin; });
  return map;
}

function renderStats() {
  const { range, label, start } = statsRange();
  $('#statsLabel').textContent = label;
  $('#statsNext').disabled = statsView.offset >= 0;
  $$('#statsPeriod button').forEach(b => b.classList.toggle('active', b.dataset.period === statsView.period));

  const tot = studyTotals(range);
  const tasksDone = tasksCompletedIn(range);
  const bySub = minutesBySubject(range);
  const incomplete = state.sessions.filter(x => x.status === 'incomplete' && inRange(x.date, range)).length;
  const p = statsView.period;

  const kpis = [
    [fmtDur(tot.minutes), p === 'day' ? 'Tiempo estudiado' : 'Horas estudiadas'],
    [tot.pomodoros, 'Pomodoros completados'],
    [tasksDone, 'Tareas completadas'],
    p === 'day' ? [incomplete, 'Sesiones incompletas'] : [bySub.length, 'Materias estudiadas'],
  ];
  $('#statsKpis').innerHTML = kpis.map(([n, l]) => `<div class="stat"><span class="stat-num">${n}</span><span class="stat-label">${l}</span></div>`).join('');

  $('#statsBySubjectTitle').textContent = p === 'month' ? 'Distribución del tiempo por materia' : 'Horas de estudio por materia';
  $('#statsBySubject').innerHTML = subjectBarsHTML(bySub, p === 'month');

  // Serie temporal del período
  const today = todayISO();
  if (p === 'day') {
    $('#statsTimeTitle').textContent = 'Sesiones del día';
    const list = state.sessions.filter(x => inRange(x.date, range)).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    $('#statsTime').innerHTML = list.length ? `<ul class="session-list">${list.map(sessionRowHTML).join('')}</ul>` : '<p class="empty">No hay sesiones registradas este día.</p>';
  } else if (p === 'week') {
    $('#statsTimeTitle').textContent = 'Estudio por día';
    const map = dailyMinutes(range);
    $('#statsTime').innerHTML = columnsHTML(Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i), iso = todayISO(d);
      return { label: DAYS_SHORT[d.getDay()], minutes: map[iso] || 0, tip: capitalize(d.toLocaleDateString('es', { weekday: 'long', day: 'numeric' })), highlight: iso === today };
    }));
  } else {
    $('#statsTimeTitle').textContent = 'Estudio por día del mes';
    const map = dailyMinutes(range);
    const days = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    $('#statsTime').innerHTML = columnsHTML(Array.from({ length: days }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), i + 1), iso = todayISO(d);
      return { label: (i + 1) % 5 === 0 || i === 0 ? String(i + 1) : '', minutes: map[iso] || 0, tip: capitalize(d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' })), highlight: iso === today };
    }), { dense: true });
  }

  renderWeekdayChart();

  // Historial del período
  const hist = state.sessions.filter(x => inRange(x.date, range)).sort((a, b) => (b.start || b.date).localeCompare(a.start || a.date));
  $('#statsHistory').innerHTML = hist.length ? hist.map(x => sessionRowHTML(x).replace('<li class="session-row">', `<li class="session-row"><span class="muted small hist-date">${shortDate(x.date)}</span>`)).join('') : '<li class="muted small">Sin sesiones en este período.</li>';
  $('#statsHistoryCount').textContent = hist.length ? `${hist.length} sesión${hist.length === 1 ? '' : 'es'}` : '';
}
renderers.estadisticas = renderStats;

/** ¿Qué días estudio más? Total por día de la semana en las últimas 8 semanas completas + la actual. */
function renderWeekdayChart() {
  const from = todayISO(addDays(startOfWeek(), -56));
  const totals = [0, 0, 0, 0, 0, 0, 0];
  completedSessions().filter(x => x.date >= from).forEach(x => { totals[parseISO(x.date).getDay()] += x.plannedMin; });
  const best = totals.indexOf(Math.max(...totals));
  $('#statsWeekdayNote').textContent = Math.max(...totals) ? `Tu mejor día: ${DAYS[best].toLowerCase()}` : '';
  $('#statsWeekday').innerHTML = columnsHTML(DAY_ORDER.map(d => ({
    label: DAYS_SHORT[d], minutes: totals[d], tip: `${DAYS[d]} (últimas 9 semanas)`, highlight: false,
  })));
}

$('#statsPeriod').addEventListener('click', e => {
  const b = e.target.closest('[data-period]');
  if (!b) return;
  statsView.period = b.dataset.period;
  statsView.offset = 0;
  renderStats();
});
$('#statsPrev').addEventListener('click', () => { statsView.offset--; renderStats(); });
$('#statsNext').addEventListener('click', () => { if (statsView.offset < 0) { statsView.offset++; renderStats(); } });
