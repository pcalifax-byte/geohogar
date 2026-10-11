/* MapMarket · configuración pública (sin secretos).
   supabaseAnonKey es una clave PÚBLICA (protegida por RLS); nunca pongas aquí la service_role key. */
window.GH_CONFIG = {
  siteUrl: 'https://mapmarketapp.com/',   // base pública para los enlaces de los correos
  supabaseUrl: 'https://cgswjjhvmexeiglzrysv.supabase.co',          // ej. 'https://xxxx.supabase.co'  (vacío = modo demo)
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnc3dqamh2bWV4ZWlnbHpyeXN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NjAxOTcsImV4cCI6MjEwNzIzNjE5N30.GYt_Ssx9sE_MoqmJ7uRGCZuS6g9z-6JCK-6uTGQlgAw',      // clave anon pública del proyecto
  // ONVO Pay (Costa Rica) · solo IDs públicos. El cobro se crea en la Edge Function 'onvo-checkout' (llave secreta solo en Supabase).
  onvo: { modo: 'test', publishableKey: 'onvo_test_publishable_key_4nHgqad-gy0fH9FbOs_WgydEMTDVWyV6qErGITz1Khql4R5_DMwIjki-LdK3ZA-DDx7XCu0JCVz8-Ul-godjXg', productId: 'cmv2wqot11z5sk1237kjvzwsk', priceMensual: 'cmv2wqq6w20bik36vkrllfl8e', priceAnual: 'cmv2wqqz91za8k86v0ucnv13w', checkoutFunction: 'onvo-checkout' },
  precios: { mensual: 3990, anual: 29990, moneda: 'CRC' },   // ₡3.990/mes · ₡29.990/año (ahorro ~37 %)
  pruebaDias: 2,
  limiteFavoritosGratis: 10,
  redirectTras: 'index.html'
};
