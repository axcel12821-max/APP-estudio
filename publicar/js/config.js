/* =====================================================================
   Configuración de Supabase (Project Settings → API en tu proyecto).
   - supabaseUrl: "Project URL", p. ej. https://abcd1234.supabase.co
   - supabaseAnonKey: la clave "anon" / "publishable". Es pública por diseño:
     los datos quedan protegidos por las políticas RLS de supabase/schema.sql.
   ¡Nunca pongas acá la clave "service_role" / "secret"!
   Si se dejan vacíos, Focusly funciona sin cuentas y guarda todo en este navegador.
   ===================================================================== */
const BRUNO_CONFIG = {
  supabaseUrl: 'https://yvybquzksjmthxiitobi.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2eWJxdXprc2ptdGh4aWl0b2JpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzODM5NjMsImV4cCI6MjEwNTk1OTk2M30.kx41DM3VgYvvSpDcKIP7qnpURxvLNCYixJ3udKbnYAE',
};
