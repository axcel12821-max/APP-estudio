'use strict';
/* ============ Buzón ============
   Guarda lo que la app avisa (recordatorios, Pomodoro terminado…) y las invitaciones
   a tareas conjuntas, para verlo después aunque el aviso se haya cerrado.
   Ítem: { id, type, title, body, at (ISO), read, invite? }
   Invitación: type 'invite' con invite = { teamTaskId, name, date, color, from: { name, email },
   members, response: null | 'accepted' | 'declined' }.
   Las invitaciones llegan desde el servidor (compartir tareas conjuntas); el buzón
   solo las muestra y guarda la respuesta. */

const INBOX_MAX = 60; // los más viejos se descartan
const INBOX_TYPES = {
  reminder: { label: 'Recordatorio', icon: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>' },
  task: { label: 'Tarea', icon: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m9 12 2 2 4-4"/></svg>' },
  pomodoro: { label: 'Pomodoro', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>' },
  invite: { label: 'Invitación', icon: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/></svg>' },
  team: { label: 'Equipos', icon: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/></svg>' },
};

/** Agrega un aviso al buzón. `type`: reminder | task | pomodoro | invite | team. */
function addInbox(type, title, body = '', extra = {}) {
  state.inbox.unshift({ id: uid(), type, title, body, at: new Date().toISOString(), read: false, ...extra });
  state.inbox.sort((a, b) => b.at.localeCompare(a.at));
  if (state.inbox.length > INBOX_MAX) state.inbox.length = INBOX_MAX;
  save();
  renderInboxBadge();
  if ($('#inboxDialog').open) renderInbox();
}

const inboxUnread = () => state.inbox.filter(x => !x.read).length;

function renderInboxBadge() {
  const n = inboxUnread();
  ['#inboxCount', '#inboxCountTop'].forEach(sel => {
    const el = $(sel);
    el.hidden = !n;
    el.textContent = n > 9 ? '9+' : String(n);
  });
  $('#inboxBtn').setAttribute('aria-label', n ? `Buzón: ${n} sin leer` : 'Buzón de notificaciones');
}

/** "ahora", "hace 5 min", "hace 3 h", "ayer", "12 sept". */
function inboxWhen(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  const d = daysUntil(todayISO(new Date(iso)));
  if (d === -1) return 'ayer';
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

function inviteHTML(x) {
  const inv = x.invite;
  const who = esc(inv.from?.name || inv.from?.email || 'Alguien');
  const body = `<strong>${who}</strong> te invitó a <strong>${esc(inv.name)}</strong>${inv.date ? ` · vence ${esc(shortDate(inv.date))}` : ''}`;
  const actions = inv.response
    ? `<span class="pill ${inv.response === 'accepted' ? 'live' : ''}">${inv.response === 'accepted' ? 'Aceptada' : 'Rechazada'}</span>`
    : `<div class="inbox-invite-actions">
         <button type="button" class="btn btn-primary btn-sm" data-act="accept">Aceptar</button>
         <button type="button" class="btn btn-ghost btn-sm" data-act="decline">Rechazar</button>
       </div>`;
  return `<p class="inbox-body">${body}</p>${actions}`;
}

function inboxItemHTML(x) {
  const t = INBOX_TYPES[x.type] || INBOX_TYPES.reminder;
  const color = x.type === 'invite' && x.invite?.color ? x.invite.color : 'var(--accent)';
  return `<li class="inbox-item ${x.read ? '' : 'unread'}" data-id="${x.id}" style="--c:${color}">
    <span class="inbox-icon">${t.icon}</span>
    <div class="grow">
      <div class="inbox-meta"><span class="inbox-type">${t.label}</span><span class="muted small">${inboxWhen(x.at)}</span></div>
      ${x.type === 'invite' && x.invite ? inviteHTML(x) : `<p class="inbox-body"><strong>${esc(x.title)}</strong>${x.body ? ` — ${esc(x.body)}` : ''}</p>`}
    </div>
    <button type="button" class="icon-plain" data-act="remove" aria-label="Borrar aviso" title="Borrar">${ICONS.x}</button>
  </li>`;
}

function renderInbox() {
  $('#inboxList').innerHTML = state.inbox.length
    ? state.inbox.map(inboxItemHTML).join('')
    : '<li class="empty">No tenés notificaciones.</li>';
  $('#inboxReadAll').hidden = !inboxUnread();
}

function openInbox() {
  renderInbox();
  $('#inboxDialog').showModal();
}

/** Aceptar: la tarea conjunta pasa a "activas". Rechazar: solo se guarda la respuesta. */
function respondInvite(x, accept) {
  const inv = x.invite;
  inv.response = accept ? 'accepted' : 'declined';
  x.read = true;
  if (accept && !state.teamTasks.some(t => t.id === inv.teamTaskId)) {
    state.teamTasks.push({
      id: inv.teamTaskId || uid(), name: inv.name, date: inv.date, color: inv.color || COLORS[0],
      members: inv.members || [], owner: inv.from || null,
      status: 'active', createdAt: new Date().toISOString(), board: newBoard(),
    });
  }
  save(); renderAll(); renderInbox(); renderInboxBadge();
  toast(accept ? 'Invitación aceptada' : 'Invitación rechazada', accept ? `${inv.name} ya está en tus tareas conjuntas activas.` : inv.name, accept ? 'success' : 'info');
}

$('#inboxList').addEventListener('click', e => {
  const li = e.target.closest('.inbox-item');
  if (!li) return;
  const x = state.inbox.find(i => i.id === li.dataset.id);
  if (!x) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'remove') {
    // Una invitación sin responder no se borra sin avisar
    if (x.type === 'invite' && !x.invite?.response && !confirm('Esta invitación todavía no fue respondida. ¿Borrarla igual?')) return;
    state.inbox.splice(state.inbox.indexOf(x), 1);
  } else if (act === 'accept' || act === 'decline') {
    respondInvite(x, act === 'accept');
    return;
  } else if (!x.read) {
    x.read = true;
  } else return;
  save(); renderInbox(); renderInboxBadge();
});

$('#inboxReadAll').addEventListener('click', () => {
  // Las invitaciones pendientes quedan sin leer hasta que se respondan
  state.inbox.forEach(x => { if (x.type !== 'invite' || x.invite?.response) x.read = true; });
  save(); renderInbox(); renderInboxBadge();
});

$('#inboxDialog [data-close]').innerHTML = ICONS.x;
$('#inboxBtn').addEventListener('click', openInbox);
alwaysRender.push(renderInboxBadge); // también tras sincronizar con otro dispositivo
renderInboxBadge();
