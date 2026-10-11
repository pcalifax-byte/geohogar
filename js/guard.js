/* Login obligatorio: sin sesión, redirige a login.html?next=<página actual> (conserva ?p= y demás). */
(function () {
  var next = (location.pathname.split('/').pop() || 'index.html') + location.search + location.hash;
  var go = function () { location.replace('login.html?next=' + encodeURIComponent(next)) };
  var tiene = false;
  try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (/^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) { tiene = true; break } } } catch (e) {}
  if (!tiene) { document.documentElement.style.visibility = 'hidden'; return go() }
  // sesión vencida/inválida: verificar con el servidor
  window.addEventListener('DOMContentLoaded', function () { if (window.Auth && Auth.user) Auth.user().then(function (u) { if (!u) go() }).catch(function () {}) });
})();
