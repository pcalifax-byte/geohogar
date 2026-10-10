/* GeoHogar · configuración pública (sin secretos).
   supabaseAnonKey es una clave PÚBLICA (protegida por RLS); nunca pongas aquí la service_role key. */
window.GH_CONFIG = {
  supabaseUrl: '',          // ej. 'https://xxxx.supabase.co'  (vacío = modo demo)
  supabaseAnonKey: '',      // clave anon pública del proyecto
  // Tilopay (solo URLs PÚBLICAS de registro a los planes recurrentes; nunca apiuser/password/key aquí)
  // Formato que devuelve Tilopay (recurrentUrl): https://app.tilopay.com/admin/recurrent/register/<ID>
  tilopay: { mensualUrl: '', anualUrl: '' },   // vacío = modo demo
  precios: { mensual: 7, anual: 59, moneda: 'USD' },
  pruebaDias: 2,
  limiteFavoritosGratis: 10,
  redirectTras: 'index.html'
};
