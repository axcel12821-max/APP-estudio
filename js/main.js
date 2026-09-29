'use strict';
/* ============ Datos: exportar / importar ============ */
$('#dataBtn').addEventListener('click', () => {
  $('#dataInfo').textContent = `${state.subjects.length} materias · ${state.tasks.length} tareas y exámenes · ${state.sessions.length} sesiones · ${state.reminders.length} recordatorios`;
  $('#dataDialog').showModal();
});
$('#exportBtn').addEventListener('click', () => {
  const data = { ...state, pomoRun: null };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `focusly-backup-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#importInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.subjects) || !Array.isArray(data.tasks)) throw new Error('formato');
    if (!confirm('Esto reemplaza todos los datos actuales por los del archivo. ¿Continuar?')) return;
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, { ...defaults, ...data, pomoRun: null });
    migrate(state);
    save();
    location.reload();
  } catch (err) {
    alert('No se pudo importar: el archivo no es una copia de seguridad válida de Focusly.');
  }
});

/* ============ Inicio ============ */
applyTheme();
fillSettings();
alwaysRender.forEach(fn => fn()); // opciones de materias antes de restaurar el Pomodoro
restorePomo();
route();
renderPomo();
checkReminders();

setInterval(checkReminders, 15000);
// Refrescar el panel y el calendario cada minuto (clase en curso, línea de hora actual)
setInterval(() => {
  if (['panel', 'calendario'].includes(currentView())) renderers[currentView()]();
}, 60000);
// Al volver a la pestaña, ponerse al día
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { checkReminders(); renderAll(); }
});
initCloud();
