'use strict';
/* ============ Chat del tablero ============
   Burbuja abajo a la izquierda del tablero que abre un panel flotante. Funciona como
   una sección de comentarios: todo queda guardado como registro en board.chat y cada
   mensaje se puede fijar (aparece arriba, en "Fijados") o votar (▲).
   Mensaje: { id, author: { id, name, avatar }, text, at (ISO), pinned, votes: [idDeUsuario…],
              files: [{ id, name, type, size }] }
   - Los enlaces del texto se pueden abrir, previo aviso de que llevan a un sitio externo.
   - Los adjuntos (imágenes, video, audio, PDF; hasta 10 MB) se guardan en IndexedDB de
     este navegador: el almacenamiento común no alcanza para archivos. El mensaje solo
     guarda sus datos (nombre, tipo, tamaño) y los busca por id al mostrarlos.
   El autor se guarda con el mensaje (nombre y foto de ese momento). */

const CHAT_OPEN_KEY = 'focusly-board-chat-open'; // preferencia de este navegador
const CHAT_FILE_MAX = 10 * 1024 * 1024;          // 10 MB por archivo
const CHAT_FILE_TYPES = /^(image|video|audio)\/|^application\/pdf$/;
const GUEST_AVATAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const PIN_ICON = '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 5 4 4H6l4-4Z"/><path d="M12 13v8"/></svg>';
const UP_ICON = '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>';
const FILE_ICON = '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/></svg>';
let chatSort = 'recent'; // 'recent' | 'top'
let chatPending = [];    // archivos elegidos para el próximo mensaje: [{ id, file }]

const boardChat = () => (boardTask.board.chat = boardTask.board.chat || []);

/* ---------- Archivos adjuntos (IndexedDB) ---------- */
const fileDB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const req = indexedDB.open('focusly-files', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
    req.onsuccess = () => res(req.result);
    req.onerror = () => { dbp = null; rej(req.error); };
  }));
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const tx = db.transaction('files', mode);
    const r = fn(tx.objectStore('files'));
    tx.oncomplete = () => res(r?.result);
    tx.onerror = () => rej(tx.error);
  }));
  return {
    put: rec => run('readwrite', st => st.put(rec)),
    get: id => run('readonly', st => st.get(id)),
    del: id => run('readwrite', st => st.delete(id)),
  };
})();
const fileURLs = new Map(); // id → URL local del archivo (se crea una sola vez)

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.0', '')} MB`;
}

/** Busca cada adjunto de la lista en IndexedDB y lo muestra (o avisa si no está en este dispositivo). */
async function hydrateAttachments(root) {
  for (const el of root.querySelectorAll('[data-file]:not([data-ready])')) {
    el.dataset.ready = '1';
    const id = el.dataset.file;
    try {
      let url = fileURLs.get(id);
      if (!url) {
        const rec = await fileDB.get(id);
        if (!rec) throw new Error('missing');
        url = URL.createObjectURL(rec.blob);
        fileURLs.set(id, url);
      }
      const media = el.querySelector('img, video, audio');
      if (media) media.src = url;
      const a = el.querySelector('a');
      if (a) a.href = url;
      el.classList.add('loaded');
    } catch (e) {
      el.classList.add('missing');
      el.title = 'Este archivo no está guardado en este dispositivo.';
    }
  }
}

function attachmentHTML(f) {
  const name = esc(f.name);
  const meta = `<span class="chat-file-meta">${name} · ${fmtBytes(f.size)}</span>`;
  if (f.type.startsWith('image/')) return `<figure class="chat-file image" data-file="${f.id}"><a target="_blank" rel="noopener" title="Ver en tamaño completo"><img alt="${name}"></a>${meta}</figure>`;
  if (f.type.startsWith('video/')) return `<figure class="chat-file video" data-file="${f.id}"><video controls preload="metadata"></video>${meta}</figure>`;
  if (f.type.startsWith('audio/')) return `<figure class="chat-file audio" data-file="${f.id}"><audio controls preload="metadata"></audio>${meta}</figure>`;
  return `<figure class="chat-file doc" data-file="${f.id}"><a target="_blank" rel="noopener" download="${name}">${FILE_ICON}<span>${name}</span><small>${fmtBytes(f.size)}</small></a></figure>`;
}

/* ---------- Enlaces ---------- */
/** Texto con los enlaces convertidos en botones que avisan antes de abrir. */
function linkify(text) {
  const re = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}])/gi;
  let out = '', last = 0, m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    const raw = m[1];
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    out += `<a class="chat-link" href="${esc(href)}" data-link="${esc(href)}" rel="noopener noreferrer nofollow">${esc(raw)}</a>`;
    last = m.index + raw.length;
  }
  return out + esc(text.slice(last));
}

let linkPending = null;
function confirmLink(href) {
  let u;
  try { u = new URL(href); } catch (e) { return; }
  if (!/^https?:$/.test(u.protocol)) return; // solo web (nada de javascript:, file:, etc.)
  linkPending = u.href;
  $('#linkDialogHost').textContent = u.hostname;
  $('#linkDialogUrl').textContent = u.href;
  $('#linkDialog').showModal();
}
$('#linkDialogGo').addEventListener('click', () => {
  if (linkPending) window.open(linkPending, '_blank', 'noopener,noreferrer');
  linkPending = null;
  $('#linkDialog').close();
});

/* ---------- Autor ---------- */
/** Quién escribe: la cuenta (nombre y foto si los tiene) o el invitado del perfil sin conexión. */
function chatMe() {
  const u = typeof cloud !== 'undefined' && !cloud.localOnly ? cloud.user : null;
  if (u?.id) {
    const md = u.user_metadata || {};
    const name = md.full_name || md.name || (u.email ? u.email.split('@')[0] : '') || 'Usuario';
    return { id: u.id, name, avatar: md.avatar_url || md.picture || null };
  }
  return { id: OFFLINE_ID, name: 'Invitado', avatar: null, guest: true };
}

/** Color estable a partir de un texto (para las iniciales de quien no tiene foto). */
function chatColor(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function avatarHTML(a) {
  if (a?.avatar && /^https?:\/\//i.test(a.avatar)) return `<span class="chat-avatar"><img src="${esc(a.avatar)}" alt="" referrerpolicy="no-referrer"></span>`;
  if (!a || a.guest || a.id === OFFLINE_ID) return `<span class="chat-avatar guest">${GUEST_AVATAR}</span>`;
  const initials = (a.name || '?').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  return `<span class="chat-avatar" style="background:${chatColor(a.id || a.name)}">${esc(initials)}</span>`;
}

/* ---------- Mensajes ---------- */
function chatMsgHTML(m, me) {
  const voted = m.votes.includes(me.id);
  const mine = m.author?.id === me.id;
  const files = m.files?.length ? `<div class="chat-files">${m.files.map(attachmentHTML).join('')}</div>` : '';
  return `<article class="chat-msg ${m.pinned ? 'pinned' : ''}" data-id="${m.id}">
    ${avatarHTML(m.author)}
    <div class="chat-body">
      <div class="chat-meta"><strong>${esc(m.author?.name || 'Anónimo')}</strong><span title="${esc(new Date(m.at).toLocaleString('es'))}">${inboxWhen(m.at)}</span>${m.pinned ? `<span class="chat-pin-badge">${PIN_ICON}Fijado</span>` : ''}</div>
      ${m.text ? `<p class="chat-text">${linkify(m.text)}</p>` : ''}
      ${files}
      <div class="chat-actions">
        <button type="button" class="chat-act vote" data-act="vote" aria-pressed="${voted}" title="${voted ? 'Quitar voto' : 'Votar'}">${UP_ICON}<span>${m.votes.length}</span></button>
        <button type="button" class="chat-act" data-act="pin" aria-pressed="${!!m.pinned}">${PIN_ICON}<span>${m.pinned ? 'Desfijar' : 'Fijar'}</span></button>
        ${mine ? '<button type="button" class="chat-act danger" data-act="del">Borrar</button>' : ''}
      </div>
    </div>
  </article>`;
}

function renderChat() {
  if (!boardTask) return;
  const msgs = boardChat();
  const me = chatMe();
  $('#boardChatCount').textContent = msgs.length ? (msgs.length > 99 ? '99+' : msgs.length) : '';
  $('#boardChatMe').innerHTML = avatarHTML(me);
  $('#boardChatMe').title = `Escribís como ${me.name}`;
  $$('#boardChatSort [data-sort]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sort === chatSort)));
  const list = $('#boardChatList');
  if ($('#boardChatPanel').hidden) return; // cerrado: solo el contador
  if (!msgs.length) { list.innerHTML = '<p class="chat-empty">Todavía no hay mensajes. Dejá el primero: ideas, dudas, enlaces o fotos para el equipo.</p>'; return; }
  const pinned = msgs.filter(m => m.pinned);
  const rest = msgs.filter(m => !m.pinned);
  const order = chatSort === 'top'
    ? (a, b) => b.votes.length - a.votes.length || b.at.localeCompare(a.at)
    : (a, b) => a.at.localeCompare(b.at); // registro cronológico: lo último abajo
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.innerHTML =
    (pinned.length ? `<div class="chat-section">${PIN_ICON}Fijados (${pinned.length})</div>${[...pinned].sort(order).map(m => chatMsgHTML(m, me)).join('')}` : '') +
    (pinned.length && rest.length ? '<div class="chat-section">Todos los mensajes</div>' : '') +
    rest.sort(order).map(m => chatMsgHTML(m, me)).join('');
  hydrateAttachments(list);
  // En "Recientes", seguir mostrando lo último si ya se estaba abajo
  if (chatSort === 'recent' && atBottom) list.scrollTop = list.scrollHeight;
}

function setChatOpen(open, focus = true) {
  $('#boardChatPanel').hidden = !open;
  $('#boardChatTab').setAttribute('aria-expanded', String(open));
  $('#boardChat').classList.toggle('open', open);
  try { localStorage.setItem(CHAT_OPEN_KEY, open ? '1' : ''); } catch (e) {}
  if (open) syncChatHeight();
  renderChat();
  if (open) {
    const list = $('#boardChatList');
    if (chatSort === 'recent') list.scrollTop = list.scrollHeight;
    if (focus) $('#boardChatInput').focus({ preventScroll: true });
  }
}

/* ---------- Adjuntar ---------- */
function renderPending() {
  const box = $('#boardChatPending');
  box.hidden = !chatPending.length;
  box.innerHTML = chatPending.map(p => `<span class="chat-chip" data-pending="${p.id}">${FILE_ICON}<span>${esc(p.file.name)}</span><small>${fmtBytes(p.file.size)}</small><button type="button" class="icon-plain" aria-label="Quitar ${esc(p.file.name)}">${ICONS.x}</button></span>`).join('');
}

function addChatFiles(files) {
  const rejected = [];
  [...files].forEach(file => {
    if (!CHAT_FILE_TYPES.test(file.type)) rejected.push(`"${file.name}" no es una imagen, video, audio ni PDF`);
    else if (file.size > CHAT_FILE_MAX) rejected.push(`"${file.name}" pesa ${fmtBytes(file.size)} (máximo 10 MB)`);
    else chatPending.push({ id: uid(), file });
  });
  if (rejected.length) toast('No se pudo adjuntar', rejected.join('. ') + '.', 'error');
  renderPending();
}

$('#boardChatAttach').addEventListener('click', () => $('#boardChatFile').click());
$('#boardChatFile').addEventListener('change', e => { addChatFiles(e.target.files); e.target.value = ''; });
$('#boardChatPending').addEventListener('click', e => {
  const chip = e.target.closest('button') && e.target.closest('[data-pending]');
  if (!chip) return;
  chatPending = chatPending.filter(p => p.id !== chip.dataset.pending);
  renderPending();
});
// También se puede pegar una imagen o soltar archivos sobre el panel
$('#boardChatInput').addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addChatFiles(files); }
});
$('#boardChatPanel').addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); $('#boardChatPanel').classList.add('drop'); } });
$('#boardChatPanel').addEventListener('dragleave', e => { if (!$('#boardChatPanel').contains(e.relatedTarget)) $('#boardChatPanel').classList.remove('drop'); });
$('#boardChatPanel').addEventListener('drop', e => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  $('#boardChatPanel').classList.remove('drop');
  addChatFiles(e.dataTransfer.files);
});

/* ---------- Enviar ---------- */
let chatSending = false;
async function sendChat() {
  const input = $('#boardChatInput');
  const text = input.value.trim();
  if ((!text && !chatPending.length) || !boardTask || chatSending) return;
  chatSending = true;
  const task = boardTask;
  const files = [];
  try {
    for (const { id, file } of chatPending) {
      await fileDB.put({ id, blob: file, name: file.name, type: file.type, size: file.size, boardId: task.board.id, createdAt: new Date().toISOString() });
      files.push({ id, name: file.name, type: file.type, size: file.size });
    }
  } catch (e) {
    chatSending = false;
    toast('No se pudo guardar el archivo', 'El navegador no tiene espacio o no permite guardar archivos (¿modo incógnito?).', 'error');
    return;
  }
  const me = chatMe();
  const msg = { id: uid(), author: { id: me.id, name: me.name, avatar: me.avatar }, text, at: new Date().toISOString(), pinned: false, votes: [] };
  if (files.length) msg.files = files;
  (task.board.chat = task.board.chat || []).push(msg);
  input.value = '';
  chatPending = [];
  renderPending();
  chatSort = 'recent';
  chatSending = false;
  renderChat();
  $('#boardChatList').scrollTop = $('#boardChatList').scrollHeight;
  persistBoard(0);
}

$('#boardChatForm').addEventListener('submit', e => { e.preventDefault(); sendChat(); });
$('#boardChatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
});
$('#boardChatTab').addEventListener('click', () => setChatOpen($('#boardChatPanel').hidden));
$('#boardChatClose').innerHTML = ICONS.x;
$('#boardChatClose').addEventListener('click', () => setChatOpen(false));
$('#boardChatPanel').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); setChatOpen(false); $('#boardChatTab').focus(); } });
$('#boardChatSort').addEventListener('click', e => {
  const b = e.target.closest('[data-sort]');
  if (!b) return;
  chatSort = b.dataset.sort;
  renderChat();
  $('#boardChatList').scrollTop = chatSort === 'recent' ? $('#boardChatList').scrollHeight : 0;
});

$('#boardChatList').addEventListener('click', e => {
  // Enlaces del texto: primero el aviso de sitio externo
  const link = e.target.closest('.chat-link');
  if (link) { e.preventDefault(); confirmLink(link.dataset.link); return; }
  const b = e.target.closest('[data-act]');
  const m = b && boardChat().find(x => x.id === b.closest('[data-id]').dataset.id);
  if (!m) return;
  const me = chatMe();
  if (b.dataset.act === 'vote') {
    const i = m.votes.indexOf(me.id);
    if (i >= 0) m.votes.splice(i, 1); else m.votes.push(me.id);
  } else if (b.dataset.act === 'pin') {
    m.pinned = !m.pinned;
  } else if (b.dataset.act === 'del') {
    if (m.author?.id !== me.id || !confirm('¿Borrar este mensaje?')) return;
    boardChat().splice(boardChat().indexOf(m), 1);
    (m.files || []).forEach(f => { fileDB.del(f.id).catch(() => {}); const u = fileURLs.get(f.id); if (u) { URL.revokeObjectURL(u); fileURLs.delete(f.id); } });
  }
  const list = $('#boardChatList');
  const keep = list.scrollTop;
  renderChat();
  list.scrollTop = keep; // votar o fijar no mueve la lista
  persistBoard(0);
});

// El chat se dibuja junto con el tablero (y recuerda si estaba abierto)
const renderBoardBase = renderers.tablero;
let chatBoardId = null;
/** El panel flotante no pasa del alto del tablero. */
const syncChatHeight = () => $('#boardWrap').style.setProperty('--wrap-h', `${$('#boardWrap').clientHeight}px`);
// (se registra después del ajuste del tablero en tablero.js, así ya tiene el alto nuevo)
window.addEventListener('resize', () => { if (currentView() === 'tablero') syncChatHeight(); });

renderers.tablero = () => {
  renderBoardBase();
  if (!boardTask) return;
  syncChatHeight();
  if (chatBoardId !== boardTask.id) { chatBoardId = boardTask.id; chatPending = []; renderPending(); }
  let open = false;
  try { open = !!localStorage.getItem(CHAT_OPEN_KEY); } catch (e) {}
  // No redibujar mientras se escribe un mensaje
  if (document.activeElement !== $('#boardChatInput')) {
    if ($('#boardChatPanel').hidden === open) setChatOpen(open, false);
    else renderChat();
  }
};
