/* GeoHogar · configuración pública (sin secretos).
   supabaseAnonKey es una clave PÚBLICA (protegida por RLS); nunca pongas aquí la service_role key. */
window.GH_CONFIG = {
  supabaseUrl: '',          // ej. 'https://xxxx.supabase.co'  (vacío = modo demo)
  supabaseAnonKey: '',      // clave anon pública del proyecto
  checkoutUrl: '',          // ej. enlace de pago Stripe / PayPal / Tilopay (vacío = demo)
  precios: { mensual: 7, anual: 59, moneda: 'USD', nota: 'precio de ejemplo' },
  limiteFavoritosGratis: 10,
  redirectTras: 'index.html'
};
