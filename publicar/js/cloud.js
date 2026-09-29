'use strict';
/* =====================================================================
   Cuentas y sincronización con Supabase.
   - Cada usuario tiene una fila en `user_data` con todo su estado en JSON.
   - La app trabaja siempre sobre la copia local (rápida y sin conexión) y
     sube los cambios con un pequeño retraso.
   - `version` detecta si otro dispositivo guardó antes: en ese caso se
     combinan los datos (por id) en lugar de pisarlos.
   Si Supabase no está configurado (js/config.js), nada de esto se activa.
   ===================================================================== */

const cloud = {
  client: null, user: null,
  version: 0,        // versión remota sobre la que se basa la copia local
  dirty: false,      // hay cambios locales sin subir
  lastJSON: null,    // último contenido subido/bajado (evita subidas repetidas)
  lastSync: null, status: 'local',
  pushing: false, timer: null, loggingOut: false, recoveryUser: null,
};
const SYNC_KEY = uid => `bruno-sync:${uid}`;
const PUSH_DELAY = 1500;
const COLLECTIONS = ['subjects', 'tasks', 'sessions', 'reminders'];

/** Lo que se sube: todo menos el temporizador en curso (es propio de cada dispositivo). */
function remotePayload(s = state) {
  const { pomoRun, ...rest } = s;
  return rest;
}
const hasContent = s => !!(s && (s.career || s.subjects?.length || s.tasks?.length || s.sessions?.length || s.reminders?.length));
const logWarn = (where, err) => console.warn(`[Focusly] ${where}:`, err?.code || '', err?.message || err);
/** Mensaje para mostrar en la pantalla de ingreso después de recargar. */
const GATE_MSG_KEY = 'bruno-gate-msg';
function reloadToGate(msg) {
  try { sessionStorage.setItem(GATE_MSG_KEY, msg); } catch (e) {}
  location.reload();
}
const parseJSON = str => { try { return JSON.parse(str); } catch (e) { return null; } };

function loadSyncMeta(uid) {
  return parseJSON(lsGet(SYNC_KEY(uid))) || { version: 0, dirty: false, lastSync: null };
}
function saveSyncMeta() {
  if (!cloud.user) return;
  try { localStorage.setItem(SYNC_KEY(cloud.user.id), JSON.stringify({ version: cloud.version, dirty: cloud.dirty, lastSync: cloud.lastSync })); } catch (e) {}
}

/** Combina dos estados: las colecciones se unen por id (gana la versión local); el resto, gana lo local. */
function mergeStates(local, remote) {
  const out = { ...remote, ...local };
  COLLECTIONS.forEach(k => {
    const map = new Map((remote[k] || []).map(x => [x.id, x]));
    (local[k] || []).forEach(x => map.set(x.id, x));
    out[k] = [...map.values()];
  });
  out.achieved = { ...remote.achieved, ...local.achieved };
  return out;
}

/** Reemplaza el estado en memoria sin recargar (conserva el Pomodoro en curso de este dispositivo). */
function replaceState(data) {
  const run = state.pomoRun;
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, { ...defaults, ...data, pomoRun: run });
  migrate(state);
  save(false);
  careerInput.value = state.career;
  institutionInput.value = state.institution;
  applyTheme();
  fillSettings();
  applyDurationIfIdle();
  renderAll();
}

/* ---------- Lectura / escritura remota ---------- */
async function fetchRemote() {
  const { data, error } = await cloud.client.from('user_data').select('data, version').eq('user_id', cloud.user.id).maybeSingle();
  if (error) throw error;
  return data; // null si el usuario todavía no tiene datos en la nube
}

/** Escribe si nadie cambió la fila desde `cloud.version`. Devuelve false si hubo conflicto. */
async function writeRemote(payload) {
  const db = cloud.client.from('user_data');
  if (!cloud.version) {
    const { data, error } = await db.insert({ user_id: cloud.user.id, data: payload, version: 1 }).select('version').single();
    if (error?.code === '23505') return false; // ya existía (otro dispositivo la creó)
    if (error) throw error;
    cloud.version = data.version;
    return true;
  }
  const { data, error } = await db
    .update({ data: payload, version: cloud.version + 1, updated_at: new Date().toISOString() })
    .eq('user_id', cloud.user.id).eq('version', cloud.version)
    .select('version');
  if (error) throw error;
  if (!data.length) return false;
  cloud.version = data[0].version;
  return true;
}

/** Trae lo remoto y lo aplica (o lo combina si hay cambios locales pendientes). */
async function syncFromRemote() {
  const remote = await fetchRemote();
  if (!remote) { cloud.version = 0; return; }
  if (remote.version === cloud.version) return;
  if (cloud.dirty) {
    replaceState(mergeStates(remotePayload(), remote.data));
  } else {
    replaceState(remote.data);
    cloud.lastJSON = JSON.stringify(remotePayload());
  }
  cloud.version = remote.version;
}

async function pushNow() {
  clearTimeout(cloud.timer);
  if (!cloud.user || cloud.pushing) return;
  cloud.pushing = true;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const payload = remotePayload();
      const json = JSON.stringify(payload);
      if (json === cloud.lastJSON) { cloud.dirty = false; break; }
      setSyncStatus('syncing');
      if (await writeRemote(payload)) {
        cloud.dirty = false;
        cloud.lastJSON = json;
        cloud.lastSync = new Date().toISOString();
        break;
      }
      await syncFromRemote(); // conflicto: combinar y reintentar
    }
    setSyncStatus(cloud.dirty ? 'offline' : 'ok');
  } catch (e) {
    logWarn('subir datos', e);
    cloud.dirty = true;
    setSyncStatus('offline');
  } finally {
    cloud.pushing = false;
    saveSyncMeta();
  }
}

function schedulePush(delay = PUSH_DELAY) {
  if (!cloud.user) return;
  cloud.dirty = true;
  saveSyncMeta();
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(pushNow, delay);
}
afterSave.push(() => schedulePush());

async function pull() {
  if (!cloud.user || cloud.pushing) return;
  try {
    await syncFromRemote();
    cloud.lastSync = new Date().toISOString();
    if (cloud.dirty || !cloud.version) await pushNow();
    else setSyncStatus('ok');
    saveSyncMeta();
  } catch (e) {
    logWarn('traer datos', e);
    setSyncStatus('offline');
  }
}

/* ---------- Estado visible ---------- */
function setSyncStatus(s) {
  cloud.status = s;
  renderAccount();
}
function syncStatusText() {
  if (cloud.status === 'syncing') return 'Sincronizando…';
  if (cloud.status === 'offline') return 'Sin conexión: tus cambios quedan en este dispositivo y se suben al volver la conexión.';
  if (cloud.lastSync) return `Sincronizado · ${new Date(cloud.lastSync).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  return 'Conectando…';
}
function renderAccount() {
  const el = $('#accountInfo');
  if (!el || !cloud.user) return;
  el.hidden = false;
  el.innerHTML = `
    <div class="account-row">
      <div class="grow"><strong>${esc(cloud.user.email || '')}</strong><span class="muted small sync-${cloud.status}">${syncStatusText()}</span></div>
      <button type="button" class="btn btn-ghost btn-sm" id="logoutBtn">Cerrar sesión</button>
    </div>`;
  $('#accountBadge').textContent = cloud.status === 'offline' ? 'Sin conexión' : '';
}

/* ---------- Pantalla de ingreso ---------- */
let authMode = 'login';
function showGate(msg = '') {
  document.body.classList.add('auth-mode');
  $('#authGate').hidden = false;
  setAuthMsg(msg, !!msg);
}
function setAuthMsg(text, isError = false) {
  const m = $('#authMsg');
  m.textContent = text;
  m.classList.toggle('error', isError);
}
function setAuthBusy(busy) {
  $$('#authForm button, #authForm input').forEach(el => { el.disabled = busy; });
}
function setAuthMode(mode) {
  authMode = mode;
  $$('#authTabs button').forEach(b => b.classList.toggle('active', b.dataset.auth === mode));
  $('#authSubmit').textContent = mode === 'login' ? 'Ingresar' : 'Crear cuenta';
  $('#authForm').elements.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#authPassHint').hidden = mode === 'login';
  showResend(false);
  setAuthMsg('');
}

function authErrorText(error) {
  const code = error?.code || '';
  const msg = error?.message || '';
  if (code === 'invalid_credentials' || /invalid login/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'Todavía no confirmaste tu email. Revisá tu bandeja de entrada (y spam).';
  if (code === 'user_already_exists' || /already registered/i.test(msg)) return 'Ya existe una cuenta con ese email. Probá ingresar.';
  if (code === 'weak_password' || /password/i.test(msg) && /characters|weak/i.test(msg)) return 'La contraseña es muy débil: usá al menos 6 caracteres.';
  if (/rate limit|too many/i.test(msg) || code.includes('rate_limit')) return 'Demasiados intentos. Esperá unos minutos y probá de nuevo.';
  if (/sending .*email/i.test(msg)) return 'No pudimos enviar el email de verificación. Probá de nuevo en unos minutos; si sigue pasando, avisanos.';
  if (/fetch|network/i.test(msg)) return 'No hay conexión con el servidor. Revisá tu internet.';
  return (msg || 'Ocurrió un error. Probá de nuevo.') + (code ? ` (${code})` : '');
}

async function onAuthSubmit(e) {
  e.preventDefault();
  const f = e.target.elements;
  const email = f.email.value.trim();
  const password = f.password.value;
  setAuthBusy(true);
  setAuthMsg(authMode === 'login' ? 'Ingresando…' : 'Creando tu cuenta…');
  try {
    if (authMode === 'login') {
      const { data, error } = await cloud.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await enterAs(data.user);
    } else {
      const { data, error } = await cloud.client.auth.signUp({ email, password, options: { emailRedirectTo: emailRedirect() } });
      if (error) throw error;
      if (data.user && data.user.identities && !data.user.identities.length) throw { code: 'user_already_exists' };
      if (data.session) await enterAs(data.user);
      else {
        setAuthMode('login');
        setAuthMsg(`¡Cuenta creada! Te enviamos un email a ${email}. Abrí el enlace para verificarla y vas a entrar directo (revisá también spam).`);
        showResend(true);
      }
    }
  } catch (err) {
    logWarn('ingreso', err);
    setAuthMsg(authErrorText(err), true);
    showResend(err?.code === 'email_not_confirmed' || /not confirmed/i.test(err?.message || ''));
  } finally {
    setAuthBusy(false);
  }
}

/* ---------- Verificación de email ---------- */
const emailRedirect = () => location.origin + location.pathname;
function showResend(show) { $('#resendBtn').hidden = !show; }
async function onResend() {
  const email = $('#authForm').elements.email.value.trim();
  if (!email) { setAuthMsg('Escribí tu email arriba para reenviarte la verificación.', true); return; }
  setAuthBusy(true);
  const { error } = await cloud.client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: emailRedirect() } });
  setAuthBusy(false);
  if (error) { logWarn('reenviar verificación', error); setAuthMsg(authErrorText(error), true); }
  else setAuthMsg(`Te reenviamos el email de verificación a ${email}. Puede tardar unos minutos (revisá spam).`);
}

/** Errores que Supabase agrega a la dirección cuando un enlace de email falla (p. ej. vencido). */
function linkErrorFromUrl() {
  const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  const code = params.get('error_code');
  if (!code && !params.get('error')) return '';
  history.replaceState(null, '', location.pathname);
  if (code === 'otp_expired') return 'El enlace del email venció o ya se usó. Ingresá con tu email para pedir uno nuevo.';
  return 'El enlace del email no es válido. Probá pedir uno nuevo.';
}

async function onForgot() {
  const email = $('#authForm').elements.email.value.trim();
  if (!email) { setAuthMsg('Escribí tu email arriba y volvé a tocar "Olvidé mi contraseña".', true); return; }
  setAuthBusy(true);
  const { error } = await cloud.client.auth.resetPasswordForEmail(email, { redirectTo: emailRedirect() });
  setAuthBusy(false);
  if (error) setAuthMsg(authErrorText(error), true);
  else setAuthMsg(`Si existe una cuenta con ${email}, te llegará un email para crear una contraseña nueva.`);
}

/**
 * Prepara la copia local del usuario y recarga la app con sus datos.
 * Si es su primera vez y en este navegador había datos sin cuenta, ofrece pasarlos.
 */
async function enterAs(user) {
  setAuthMsg('Cargando tus datos…');
  cloud.user = user;
  const userKey = `${LOCAL_KEY}:${user.id}`;
  const cached = parseJSON(lsGet(userKey));
  const meta = loadSyncMeta(user.id);
  let remote = null, remoteOk = true;
  try { remote = await fetchRemote(); } catch (e) { logWarn('leer datos al ingresar', e); remoteOk = false; }

  let data, version = 0, dirty = true;
  if (remote) {
    const pending = cached && meta.dirty;
    data = pending ? mergeStates(remotePayload(cached), remote.data) : remote.data;
    version = remote.version;
    dirty = !!pending;
  } else if (cached) {
    data = cached;
    version = remoteOk ? 0 : meta.version;
    dirty = true;
  } else {
    const anon = parseJSON(lsGet(LOCAL_KEY));
    const n = anon ? `${anon.subjects?.length || 0} materias, ${anon.tasks?.length || 0} tareas y ${anon.sessions?.length || 0} sesiones` : '';
    if (hasContent(anon) && confirm(`En este navegador hay datos guardados sin cuenta (${n}). ¿Querés pasarlos a tu cuenta?`)) {
      data = anon;
      try { localStorage.removeItem(LOCAL_KEY); } catch (e) {}
    } else {
      data = { theme: anon?.theme ?? null };
    }
  }
  try {
    localStorage.setItem(userKey, JSON.stringify({ ...data, pomoRun: cached?.pomoRun ?? null }));
    localStorage.setItem(SYNC_KEY(user.id), JSON.stringify({ version, dirty, lastSync: null }));
    localStorage.setItem(USER_KEY, user.id);
  } catch (e) {
    logWarn('guardar sesión en el navegador', e);
    setAuthMsg('Tu navegador no permite guardar datos (¿modo incógnito o cookies bloqueadas?). Probá en una ventana normal.', true);
    return;
  }
  try { sessionStorage.setItem('bruno-just-logged', user.id); } catch (e) {}
  location.replace(location.pathname + '#panel');
  location.reload();
}

async function logout() {
  if (cloud.dirty) await pushNow();
  if (cloud.dirty && !confirm('Hay cambios que todavía no se subieron (sin conexión). Si cerrás sesión ahora se pierden. ¿Cerrar igual?')) return;
  cloud.loggingOut = true;
  try { await cloud.client.auth.signOut(); } catch (e) {}
  forgetUser();
  location.replace(location.pathname);
}
/**
 * Olvida al usuario en este navegador. Al cerrar sesión también borra su copia local
 * (importante en computadoras compartidas); si la sesión venció sola, la conserva
 * para no perder cambios sin subir.
 */
function forgetUser({ keepData = false } = {}) {
  const uid = cachedUserId || cloud.user?.id;
  try {
    if (uid && !keepData) {
      localStorage.removeItem(`${LOCAL_KEY}:${uid}`);
      localStorage.removeItem(SYNC_KEY(uid));
    }
    localStorage.removeItem(USER_KEY);
  } catch (e) {}
}

/* ---------- Contraseña nueva (enlace de recuperación) ---------- */
$('#passwordForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pass = e.target.elements.newPassword.value;
  const { error } = await cloud.client.auth.updateUser({ password: pass });
  if (error) { $('#passwordError').textContent = authErrorText(error); return; }
  $('#passwordDialog').close();
  toast('Contraseña actualizada', 'Ya podés usarla para ingresar.', 'success');
  if (cloud.recoveryUser) await enterAs(cloud.recoveryUser);
});

/* ---------- Comentarios ---------- */
$('#feedbackBtn').addEventListener('click', () => {
  $('#feedbackForm').reset();
  $('#feedbackError').textContent = '';
  $('#feedbackDialog').showModal();
});
$('#feedbackForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  if (!cloud.client) { $('#feedbackError').textContent = 'Sin conexión. Probá de nuevo cuando vuelva internet.'; return; }
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  const { error } = await cloud.client.from('feedback').insert({
    user_id: cloud.user.id,
    email: cloud.user.email,
    kind: f.kind.value,
    message: f.message.value.trim(),
    page: currentView(),
    user_agent: navigator.userAgent.slice(0, 300),
  });
  btn.disabled = false;
  if (error) { $('#feedbackError').textContent = 'No se pudo enviar. Revisá tu conexión y probá de nuevo.'; return; }
  $('#feedbackDialog').close();
  toast('¡Gracias por tu comentario!', 'Nos ayuda a mejorar Focusly.', 'success');
});

/* ---------- Inicio ---------- */
async function initCloud() {
  if (!CLOUD) return;
  document.body.classList.add('cloud');
  const recovery = /type=recovery/.test(location.hash);
  const linkError = linkErrorFromUrl();
  $('#resendBtn').addEventListener('click', onResend);
  $('#authForm').addEventListener('submit', onAuthSubmit);
  $('#forgotBtn').addEventListener('click', onForgot);
  $('#authTabs').addEventListener('click', e => { const b = e.target.closest('[data-auth]'); if (b) setAuthMode(b.dataset.auth); });
  $('#dataDialog').addEventListener('click', e => { if (e.target.id === 'logoutBtn') logout(); });

  if (!window.supabase?.createClient) {
    // Sin conexión y sin la librería: si ya había sesión, se usa la copia local.
    if (cachedUserId) { cloud.user = { id: cachedUserId, email: '' }; setSyncStatus('offline'); }
    else showGate('No se pudo conectar con el servidor. Revisá tu conexión y recargá la página.');
    return;
  }
  cloud.client = window.supabase.createClient(BRUNO_CONFIG.supabaseUrl, BRUNO_CONFIG.supabaseAnonKey, {
    auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  if (!cachedUserId) {
    let msg = '';
    try { msg = sessionStorage.getItem(GATE_MSG_KEY) || ''; sessionStorage.removeItem(GATE_MSG_KEY); } catch (e) {}
    showGate(linkError || msg);
    if (linkError) showResend(true);
  }

  cloud.client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      cloud.recoveryUser = session?.user || null;
      $('#passwordError').textContent = '';
      $('#passwordDialog').showModal();
    }
    if (event === 'SIGNED_OUT' && cachedUserId && !cloud.loggingOut) { forgetUser({ keepData: true }); reloadToGate('Tu sesión se cerró. Volvé a ingresar.'); }
  });

  let session = null;
  let sessionError = null;
  try { const r = await cloud.client.auth.getSession(); session = r.data.session; sessionError = r.error; } catch (e) { sessionError = e; }
  if (sessionError) logWarn('recuperar sesión', sessionError);
  const justLogged = (() => { try { const v = sessionStorage.getItem('bruno-just-logged'); sessionStorage.removeItem('bruno-just-logged'); return v; } catch (e) { return null; } })();
  if (!session) {
    if (cachedUserId) {
      // Sin red la sesión puede no validarse: seguir con la copia local
      if (!navigator.onLine) { cloud.user = { id: cachedUserId, email: '' }; setSyncStatus('offline'); return; }
      forgetUser({ keepData: true });
      reloadToGate(justLogged
        ? 'Ingresaste, pero el navegador no conservó la sesión. Probá en una ventana normal (no incógnito) y sin bloquear cookies/datos de sitios.'
        : 'Tu sesión venció. Volvé a ingresar.');
    }
    return;
  }
  if (session.user.id !== cachedUserId) {
    if (recovery) { cloud.recoveryUser = session.user; return; } // primero elegir contraseña nueva
    await enterAs(session.user);
    return;
  }

  cloud.user = session.user;
  const meta = loadSyncMeta(cloud.user.id);
  cloud.version = meta.version;
  cloud.dirty = meta.dirty;
  cloud.lastSync = meta.lastSync;
  cloud.lastJSON = meta.dirty ? null : JSON.stringify(remotePayload());
  setSyncStatus('syncing');
  await pull();

  // Mantenerse al día con otros dispositivos
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (cloud.dirty) pushNow(); } else pull(); });
  window.addEventListener('online', () => pull());
  window.addEventListener('pagehide', () => { if (cloud.dirty) pushNow(); });
  setInterval(() => { if (!document.hidden) pull(); }, 60000);
}
