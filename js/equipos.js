'use strict';
/* ============ Equipos ============
   Tareas conjuntas: un trabajo con nombre, fecha límite, color y participantes
   (invitados por email). Solo se suman quienes tienen cuenta en Focusly, pero la
   app nunca muestra si un email está registrado: así no se puede usar el formulario
   para averiguar quién tiene cuenta. */

const teamDialog = $('#teamDialog');
const teamForm = $('#teamForm');
const MAX_MEMBERS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLUS_ICON = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
let teamColor = COLORS[0];

const activeTeamTasks = () => state.teamTasks.filter(t => t.status !== 'archived');

/* ---- Color ---- */
function renderTeamSwatches() {
  $('#teamSwatches').innerHTML = COLORS.map(c =>
    `<button type="button" class="swatch" style="background:${c}" data-color="${c}" aria-pressed="${c === teamColor}" aria-label="Color ${c}"></button>`).join('');
}
$('#teamSwatches').addEventListener('click', e => {
  const b = e.target.closest('[data-color]');
  if (b) { teamColor = b.dataset.color; renderTeamSwatches(); }
});

/* ---- Participantes: la última fila tiene "+", las anteriores "×" para quitarlas ---- */
function memberRow(value = '') {
  const div = document.createElement('div');
  div.className = 'member-row';
  div.innerHTML = `<input type="email" name="member" placeholder="compañero@email.com" autocomplete="off" value="${esc(value)}" aria-label="Email del participante"><button type="button" class="icon-plain"></button>`;
  return div;
}
function syncMemberButtons() {
  const rows = $$('#teamMembers .member-row');
  rows.forEach((r, i) => {
    const b = r.querySelector('button');
    const last = i === rows.length - 1;
    const canAdd = last && rows.length < MAX_MEMBERS;
    b.className = `icon-plain ${canAdd ? 'add' : 'danger'}`;
    b.dataset.act = canAdd ? 'add' : 'remove';
    b.innerHTML = canAdd ? PLUS_ICON : ICONS.x;
    b.setAttribute('aria-label', canAdd ? 'Agregar otro participante' : 'Quitar participante');
    b.hidden = last && !canAdd && rows.length === 1;
  });
}
$('#teamMembers').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  if (b.dataset.act === 'add') {
    const row = memberRow();
    $('#teamMembers').appendChild(row);
    row.querySelector('input').focus();
  } else {
    b.closest('.member-row').remove();
  }
  syncMemberButtons();
});
// Enter en un email agrega otra fila en lugar de enviar el formulario
$('#teamMembers').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.name !== 'member') return;
  e.preventDefault();
  $('#teamMembers .member-row:last-child button[data-act="add"]')?.click();
});

function openTeamDialog() {
  teamForm.reset();
  $('#teamError').textContent = '';
  teamForm.elements.date.value = todayISO(addDays(new Date(), 7));
  teamColor = COLORS[state.teamTasks.length % COLORS.length];
  renderTeamSwatches();
  $('#teamMembers').innerHTML = '';
  $('#teamMembers').appendChild(memberRow());
  syncMemberButtons();
  teamDialog.showModal();
  teamForm.elements.name.focus();
}

teamForm.addEventListener('submit', e => {
  const f = teamForm.elements;
  const err = msg => { e.preventDefault(); $('#teamError').textContent = msg; };
  const name = f.name.value.trim();
  if (!name) return err('Poné un nombre para la tarea.');
  if (!f.date.value) return err('Elegí una fecha límite.');
  const own = (typeof cloud !== 'undefined' && cloud.user?.email || '').toLowerCase();
  const emails = [...new Set($$('#teamMembers input[name=member]').map(i => i.value.trim().toLowerCase()).filter(Boolean))]
    .filter(m => m !== own);
  const bad = emails.find(m => !EMAIL_RE.test(m));
  if (bad) return err(`Revisá el email "${bad}".`);

  state.teamTasks.push({
    id: uid(), name, date: f.date.value, color: teamColor,
    // Invitaciones pendientes: se confirman del lado del servidor solo para cuentas existentes
    members: emails.map(email => ({ email, status: 'invited' })),
    status: 'active', createdAt: new Date().toISOString(),
  });
  save(); renderAll();
  toast('Tarea conjunta creada', emails.length ? `Se invitó a ${emails.length} participante${emails.length > 1 ? 's' : ''}.` : name, 'success');
});

/* ---- Listas: activas y archivadas ---- */
const archivedTeamTasks = () => state.teamTasks.filter(t => t.status === 'archived');
const ARCHIVE_ICON = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>';
const RESTORE_ICON = '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
let teamListMode = 'active'; // 'active' | 'archived'

/** "Vence hoy", "Vence en 3 días", "Venció hace 2 días" (+ fecha corta). */
function teamDueHTML(t) {
  const d = daysUntil(t.date);
  const when = d === 0 ? 'Vence hoy' : d === 1 ? 'Vence mañana' : d > 1 ? `Vence en ${d} días` : `Venció hace ${-d} día${d === -1 ? '' : 's'}`;
  const cls = d < 0 ? 'urgent' : d <= 2 ? 'soon' : '';
  return `<span class="pill ${cls}">${when}</span><span class="muted small">${shortDate(t.date)}</span>`;
}

function teamRowHTML(t) {
  const members = t.members || [];
  const chips = members.length
    ? members.map(m => `<span class="chip">${esc(m.email)}</span>`).join('')
    : '<span class="muted small">Sin participantes</span>';
  const actions = teamListMode === 'active'
    ? `<button type="button" class="icon-plain" data-act="archive" aria-label="Archivar" title="Archivar">${ARCHIVE_ICON}</button>`
    : `<button type="button" class="icon-plain" data-act="restore" aria-label="Restaurar" title="Restaurar">${RESTORE_ICON}</button>
       <button type="button" class="icon-plain danger" data-act="delete" aria-label="Eliminar" title="Eliminar">${TRASH_ICON}</button>`;
  return `<li class="team-row" data-id="${t.id}" style="--c:${t.color}">
    <div class="grow">
      <strong>${esc(t.name)}</strong>
      <div class="team-row-due">${teamDueHTML(t)}</div>
      <div class="team-row-members">${chips}</div>
    </div>
    <div class="team-row-actions">${actions}</div>
  </li>`;
}

function renderTeamList() {
  const active = teamListMode === 'active';
  $('#teamListTitle').textContent = active ? 'Tareas conjuntas activas' : 'Archivados';
  const list = (active ? activeTeamTasks() : archivedTeamTasks())
    .sort((a, b) => active ? a.date.localeCompare(b.date) : (b.archivedAt || '').localeCompare(a.archivedAt || ''));
  $('#teamList').innerHTML = list.length ? list.map(teamRowHTML).join('')
    : active
      ? '<li class="empty">Todavía no tenés tareas conjuntas activas.<br><button type="button" class="btn btn-primary btn-sm" data-act="create">Crear una tarea conjunta</button></li>'
      : '<li class="empty">No hay tareas conjuntas archivadas.</li>';
}

function openTeamList(mode) {
  teamListMode = mode;
  renderTeamList();
  $('#teamListDialog').showModal();
}

$('#teamList').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'create') { $('#teamListDialog').close(); openTeamDialog(); return; }
  const t = state.teamTasks.find(x => x.id === b.closest('[data-id]').dataset.id);
  if (!t) return;
  if (b.dataset.act === 'archive') {
    t.status = 'archived';
    t.archivedAt = new Date().toISOString();
    toast('Tarea archivada', t.name);
  } else if (b.dataset.act === 'restore') {
    t.status = 'active';
    delete t.archivedAt;
    toast('Tarea restaurada', t.name, 'success');
  } else if (b.dataset.act === 'delete') {
    if (!confirm(`¿Eliminar "${t.name}" para siempre? No se puede deshacer.`)) return;
    state.teamTasks.splice(state.teamTasks.indexOf(t), 1);
  }
  save(); renderAll(); renderTeamList();
});

/* ---- Vista ---- */
function renderEquipos() {
  const n = activeTeamTasks().length;
  $('#teamActiveNote').textContent = n ? `${n} tarea${n > 1 ? 's' : ''} conjunta${n > 1 ? 's' : ''} en curso.` : 'Todavía no tenés tareas conjuntas activas.';
  const a = archivedTeamTasks().length;
  $('#teamArchivedNote').textContent = a ? `${a} tarea${a > 1 ? 's' : ''} archivada${a > 1 ? 's' : ''}.` : 'No hay tareas conjuntas archivadas.';
}
renderers.equipos = renderEquipos;

$('#teamListDialog [data-close]').innerHTML = ICONS.x;
$('#teamCreate').addEventListener('click', openTeamDialog);
$('#teamActive').addEventListener('click', () => openTeamList('active'));
$('#teamArchived').addEventListener('click', () => openTeamList('archived'));
