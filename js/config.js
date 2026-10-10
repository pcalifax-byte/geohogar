/* GeoHogar · configuración pública (sin secretos).
   supabaseAnonKey es una clave PÚBLICA (protegida por RLS); nunca pongas aquí la service_role key. */
window.GH_CONFIG = {
  supabaseUrl: 'https://cgswjjhvmexeiglzrysv.supabase.co',          // ej. 'https://xxxx.supabase.co'  (vacío = modo demo)
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnc3dqamh2bWV4ZWlnbHpyeXN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NjAxOTcsImV4cCI6MjEwNzIzNjE5N30.GYt_Ssx9sE_MoqmJ7uRGCZuS6g9z-6JCK-6uTGQlgAw',      // clave anon pública del proyecto
  // Tilopay (solo URLs PÚBLICAS de registro a los planes recurrentes; nunca apiuser/password/key aquí)
  // Formato que devuelve Tilopay (recurrentUrl): https://app.tilopay.com/admin/recurrent/register/<ID>
  tilopay: { mensualUrl: '', anualUrl: '' },   // vacío = modo demo
  precios: { mensual: 7, anual: 59, moneda: 'USD' },
  pruebaDias: 2,
  limiteFavoritosGratis: 10,
  redirectTras: 'index.html'
};
