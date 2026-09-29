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

/* ---- Vista ---- */
function renderEquipos() {
  const n = activeTeamTasks().length;
  $('#teamActiveNote').textContent = n ? `${n} tarea${n > 1 ? 's' : ''} conjunta${n > 1 ? 's' : ''} en curso.` : 'Todavía no tenés tareas conjuntas activas.';
}
renderers.equipos = renderEquipos;

$('#teamCreate').addEventListener('click', openTeamDialog);
// Activas y Archivados: se desarrollan después
['#teamActive', '#teamArchived'].forEach(sel => $(sel).addEventListener('click', () => toast('Próximamente', 'Esta sección todavía está en construcción.')));
