'use strict';
/* ============ Pomodoro ============
   Solo los bloques de enfoque generan sesiones. Una sesión se registra:
   - "completed" cuando el temporizador llega a 0 (cuenta el tiempo planificado completo
     y suma un pomodoro);
   - "incomplete" (parcial) si se reinicia, salta o cambia de modo antes de terminar:
     guarda los minutos reales de enfoque, que suman al tiempo de estudio igual que los
     completos, pero no cuentan como pomodoro. */

const APP_TITLE = 'Focusly';
const MODE_LABEL = { work: 'Enfoque', short: 'Descanso', long: 'Descanso largo' };
const RING_LEN = 2 * Math.PI * 98;
const MIN_RECORD_MS = 30000; // intentos cancelados antes de 30 s no se registran (toques accidentales)
const ring = $('#ringProgress');
ring.style.strokeDasharray = RING_LEN;

const durationOf = mode => state.pomo[mode] * 60000;
const pomo = {
  mode: 'work', total: durationOf('work'), remaining: durationOf('work'),
  running: false, endAt: 0, cycleCount: 0, timer: null,
  session: null, // sesión de enfoque en curso
};

function persistRun() {
  const { mode, total, remaining, running, endAt, cycleCount, session } = pomo;
  state.pomoRun = { mode, total, remaining, running, endAt, cycleCount, session };
  save();
}

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

function renderPomo() {
  const t = fmt(pomo.remaining);
  const started = pomo.remaining < pomo.total;
  $('#pomoTime').textContent = t;
  $('#pomoModeLabel').textContent = pomo.running ? MODE_LABEL[pomo.mode] : (started ? 'En pausa' : MODE_LABEL[pomo.mode]);
  ring.style.strokeDashoffset = RING_LEN * (1 - pomo.remaining / pomo.total);
  const sid = pomo.session?.subjectId ?? $('#pomoSubject').value;
  ring.style.stroke = pomo.mode === 'work' && subjectById(sid) ? subjectById(sid).color : '';
  $('#pomoToggle').textContent = pomo.running ? 'Pausar' : (started ? 'Continuar' : 'Iniciar');
  $$('#pomoModes button').forEach(b => b.classList.toggle('active', b.dataset.mode === pomo.mode));
  const filled = pomo.mode === 'long' ? state.pomo.cycles : pomo.cycleCount % state.pomo.cycles;
  $('#cycleDots').innerHTML = Array.from({ length: state.pomo.cycles }, (_, i) => `<span class="${i < filled ? 'on' : ''}"></span>`).join('');
  document.title = pomo.running || started ? `${t} · ${MODE_LABEL[pomo.mode]}` : APP_TITLE;

  // Materia/tema bloqueados mientras hay una sesión de enfoque en curso
  const locked = !!pomo.session;
  ['#pomoSubject', '#pomoTopic', '#pomoPlan'].forEach(s => { $(s).disabled = locked; });
  $('#pomoLockNote').hidden = !locked;
}

function tick() {
  pomo.remaining = pomo.endAt - Date.now();
  if (pomo.remaining <= 0) complete();
  else renderPomo();
}

function startPomo() {
  if (pomo.mode === 'work' && !pomo.session) {
    const planItemId = $('#pomoPlan').value || null;
    pomo.session = {
      id: uid(), start: new Date().toISOString(), plannedMin: pomo.total / 60000, focusMs: 0,
      subjectId: $('#pomoSubject').value, topic: $('#pomoTopic').value.trim(), planItemId,
    };
  }
  if (pomo.session) pomo.session.runStartedAt = Date.now();
  pomo.endAt = Date.now() + pomo.remaining;
  pomo.running = true;
  clearInterval(pomo.timer);
  pomo.timer = setInterval(tick, 250);
  unlockAudio();
  if (notifPermission() === 'default') requestNotifications();
  persistRun();
  renderPomo();
}

function pausePomo() {
  pomo.running = false;
  clearInterval(pomo.timer);
  pomo.remaining = Math.max(0, pomo.endAt - Date.now());
  if (pomo.session?.runStartedAt) {
    pomo.session.focusMs += Date.now() - pomo.session.runStartedAt;
    pomo.session.runStartedAt = null;
  }
  persistRun();
  renderPomo();
}

/** Cierra la sesión en curso y la guarda en el historial. */
function finishSession(status, endTime = Date.now()) {
  const s = pomo.session;
  pomo.session = null;
  if (!s) return;
  if (s.runStartedAt) s.focusMs += endTime - s.runStartedAt;
  if (status === 'incomplete' && s.focusMs < MIN_RECORD_MS) return;
  const start = new Date(s.start);
  state.sessions.push({
    id: s.id,
    date: todayISO(start),
    start: s.start,
    end: new Date(endTime).toISOString(),
    plannedMin: s.plannedMin,
    // Minutos con precisión de segundos (p. ej. 2m 35s → 2.5833)
    focusMin: status === 'completed' ? s.plannedMin : Math.round(s.focusMs / 1000) / 60,
    subjectId: s.subjectId,
    topic: s.topic,
    planItemId: s.planItemId,
    status,
  });
  save();
}

function setMode(mode) {
  const cut = !!pomo.session;
  if (cut) finishSession('incomplete');
  pomo.running = false;
  clearInterval(pomo.timer);
  pomo.mode = mode;
  pomo.total = durationOf(mode);
  pomo.remaining = pomo.total;
  persistRun();
  renderPomo();
  renderAll();
  if (cut) checkGoals(); // el tiempo parcial también puede cumplir el objetivo de minutos
}

function complete({ restored = false } = {}) {
  const wasWork = pomo.mode === 'work';
  const s = pomo.session;
  if (wasWork) {
    pomo.cycleCount++;
    finishSession('completed', pomo.endAt);
  }
  const next = wasWork ? (pomo.cycleCount % state.pomo.cycles === 0 ? 'long' : 'short') : 'work';
  if (!restored) beep();
  if (wasWork) {
    const what = [subjectById(s?.subjectId)?.name, s?.topic].filter(Boolean).join(' · ');
    const msg = restored ? 'Se completó mientras la app estaba cerrada.' : 'Tomate un descanso.';
    toast('¡Pomodoro completado!', what ? `${what}. ${msg}` : msg, 'success');
    notify('¡Pomodoro completado!', `${what ? what + ' · ' : ''}Tomate un descanso.`, { onlyHidden: true, tag: 'pomodoro' });
  } else if (!restored) {
    toast('Fin del descanso', '¡A enfocarse!');
    notify('Fin del descanso', '¡A enfocarse!', { onlyHidden: true, tag: 'pomodoro' });
  }
  setMode(next);
  if (state.pomo.auto && !restored) startPomo();
  if (wasWork) checkGoals();
}

/** Minutos de enfoque acumulados en la sesión en curso (incluye el tramo que está corriendo). */
function currentFocusMs() {
  const s = pomo.session;
  if (!s) return 0;
  return s.focusMs + (s.runStartedAt ? Date.now() - s.runStartedAt : 0);
}
/** Aviso al cortar una sesión: el tiempo ya estudiado se guarda igual. */
function confirmCut(action) {
  if (!pomo.session) return true;
  const ms = currentFocusMs();
  if (ms < MIN_RECORD_MS) return confirm(`Llevás menos de 30 segundos: esta sesión no se va a guardar. ¿${action}?`);
  return confirm(`Se guardan ${fmtDur(ms / 60000)} de estudio en tus estadísticas (como sesión parcial). ¿${action}?`);
}

$('#pomoToggle').addEventListener('click', () => (pomo.running ? pausePomo() : startPomo()));
$('#pomoReset').addEventListener('click', () => {
  if (!confirmCut('Reiniciar')) return;
  setMode(pomo.mode);
});
$('#pomoSkip').addEventListener('click', () => {
  if (!confirmCut('Saltar')) return;
  const next = pomo.mode === 'work' ? ((pomo.cycleCount + 1) % state.pomo.cycles === 0 ? 'long' : 'short') : 'work';
  if (pomo.mode === 'work') pomo.cycleCount++;
  setMode(next);
});
$('#pomoModes').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.dataset.mode === pomo.mode) return;
  if (pomo.session ? !confirmCut('Cambiar de modo') : pomo.running && !confirm('Hay un temporizador en curso. ¿Cambiar de modo?')) return;
  setMode(b.dataset.mode);
});

/* ---- Materia, tema y plan ---- */
function renderPomoPickers() {
  const sid = $('#pomoSubject').value;
  // Temas sugeridos: temas de exámenes y temas usados antes en esa materia
  const topics = new Set();
  state.tasks.filter(t => isExam(t) && (!sid || t.subjectId === sid)).forEach(t => t.topics.forEach(x => topics.add(x)));
  state.sessions.filter(x => x.topic && (!sid || x.subjectId === sid)).forEach(x => topics.add(x.topic));
  $('#pomoTopicList').innerHTML = [...topics].map(x => `<option value="${esc(x)}">`).join('');

  const sel = $('#pomoPlan');
  const cur = sel.value;
  const items = openPlanItems(sid || undefined);
  sel.innerHTML = '<option value="">Sin vincular</option>' + items.map(({ exam, item }) =>
    `<option value="${item.id}">${esc(exam.title)} · ${esc(item.topic)} (${shortDate(item.date)}, ${planItemPomos(item)}/${item.pomodoros})</option>`).join('');
  sel.value = items.some(x => x.item.id === cur) ? cur : '';
  $('#pomoPlanField').hidden = !items.length;
}
$('#pomoSubject').addEventListener('change', () => { renderPomoPickers(); renderPomo(); });
$('#pomoPlan').addEventListener('change', e => {
  const found = openPlanItems().find(x => x.item.id === e.target.value);
  if (found) {
    $('#pomoSubject').value = found.exam.subjectId;
    $('#pomoTopic').value = found.item.topic;
    renderPomoPickers();
    $('#pomoPlan').value = found.item.id;
    renderPomo();
  }
});

/** Preselecciona materia/tema/ítem de plan (desde Exámenes o el Panel). */
function pomoPrefill({ subjectId = '', topic = '', planItemId = '' }) {
  if (pomo.session) { toast('Hay una sesión en curso', 'Terminala o reiniciala para cambiar de materia.'); return; }
  if (pomo.mode !== 'work') setMode('work');
  $('#pomoSubject').value = subjectId;
  $('#pomoTopic').value = topic;
  renderPomoPickers();
  $('#pomoPlan').value = planItemId;
  renderPomo();
}

/* ---- Estadísticas del día en la vista Pomodoro ---- */
function renderPomoStats() {
  const today = todayISO();
  const range = [today, todayISO(addDays(new Date(), 1))];
  const tot = studyTotals(range);
  $('#pomoCountToday').textContent = tot.pomodoros;
  $('#pomoMinutesToday').textContent = fmtDur(tot.minutes);
  const bySub = {};
  state.sessions.filter(x => x.date === today).forEach(x => { bySub[x.subjectId] = (bySub[x.subjectId] || 0) + sessionMinutes(x); });
  $('#pomoBreakdown').innerHTML = Object.entries(bySub).sort((a, b) => b[1] - a[1]).map(([id, min]) =>
    `<li><span><span class="dot" style="background:${subjectColor(id)}"></span>${esc(subjectName(id))}</span><span>${fmtDur(min)}</span></li>`).join('');

  const todays = state.sessions.filter(x => x.date === today).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  $('#pomoHistory').innerHTML = todays.length ? todays.map(sessionRowHTML).join('') : '<li class="muted small">Todavía no hay sesiones hoy.</li>';
}

function sessionRowHTML(x) {
  const time = x.start ? `${hhmm(new Date(x.start))}–${hhmm(new Date(x.end))}` : 'sin hora';
  const ok = x.status === 'completed';
  return `<li class="session-row">
    <span class="dot" style="background:${subjectColor(x.subjectId)}"></span>
    <span class="grow"><span>${esc(subjectName(x.subjectId))}${x.topic ? ` · ${esc(x.topic)}` : ''}</span><span class="muted small">${time} · ${ok ? fmtDur(x.plannedMin) : `${fmtDur(x.focusMin)} de ${fmtDur(x.plannedMin)}`}</span></span>
    <span class="pill ${ok ? 'live' : ''}" ${ok ? '' : 'title="Suma al tiempo de estudio, pero no cuenta como pomodoro"'}>${ok ? 'Completada' : 'Parcial'}</span>
  </li>`;
}

renderers.pomodoro = () => { renderPomoPickers(); renderPomoStats(); renderPomo(); };

/* ---- Configuración ---- */
const settingInputs = { work: '#setWork', short: '#setShort', long: '#setLong', cycles: '#setCycles' };
function fillSettings() {
  Object.entries(settingInputs).forEach(([k, sel]) => { $(sel).value = state.pomo[k]; });
  $('#setAuto').checked = state.pomo.auto;
  $('#setSound').checked = state.pomo.sound;
}
/** Aplica una nueva duración solo si el bloque actual no empezó (no altera sesiones en curso). */
function applyDurationIfIdle() {
  if (!pomo.running && pomo.remaining === pomo.total) {
    pomo.total = pomo.remaining = durationOf(pomo.mode);
    persistRun();
  }
  renderPomo();
}
Object.entries(settingInputs).forEach(([k, sel]) => {
  $(sel).addEventListener('change', e => {
    const input = e.target;
    const v = Math.round(Number(input.value));
    const clamped = Math.min(Number(input.max), Math.max(Number(input.min), v || state.pomo[k]));
    input.value = clamped;
    state.pomo[k] = clamped;
    save();
    applyDurationIfIdle();
  });
});
$('#setAuto').addEventListener('change', e => { state.pomo.auto = e.target.checked; save(); });
$('#setSound').addEventListener('change', e => { state.pomo.sound = e.target.checked; save(); });
$('#pomoDefaults').addEventListener('click', () => {
  Object.assign(state.pomo, { work: DEFAULT_POMO.work, short: DEFAULT_POMO.short, long: DEFAULT_POMO.long, cycles: DEFAULT_POMO.cycles });
  save(); fillSettings();
  applyDurationIfIdle();
});

/* ---- Restaurar un temporizador en curso tras recargar ---- */
function restorePomo() {
  const r = state.pomoRun;
  if (!r) return;
  Object.assign(pomo, { mode: r.mode, total: r.total, remaining: r.remaining, running: r.running, endAt: r.endAt, cycleCount: r.cycleCount || 0, session: r.session });
  if (pomo.session) {
    $('#pomoSubject').value = pomo.session.subjectId;
    $('#pomoTopic').value = pomo.session.topic;
  }
  if (pomo.running) {
    if (Date.now() >= pomo.endAt) complete({ restored: true });
    else pomo.timer = setInterval(tick, 250);
  }
}
