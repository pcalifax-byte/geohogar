/* MapMarket · cuenta.html «Datos personales»: perfil, teléfono/WhatsApp, dirección, foto, idioma, cambio de correo y contraseña.
   Solo el dueño (y admin) puede leer/editar estos datos (RLS). */
(function () {
  const $ = i => document.getElementById(i), E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = window.MMT || (k => k);
  const toast = (t, ok = true) => { const d = document.createElement('div'); d.setAttribute('role', 'status'); d.className = 'fixed z-[3000] left-1/2 -translate-x-1/2 bottom-6 rounded-xl px-4 py-3 text-sm shadow-xl ' + (ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'); d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3500) };
  const inp = 'w-full mt-1 px-3 rounded-lg border dark:bg-slate-700 dark:border-slate-600';
  const telNorm = v => { const d = String(v || '').replace(/\D/g, '').replace(/^506/, ''); return d ? '+506' + d : '' };
  async function init() {
    const u = await Auth.user(); if (!u || Auth.demo) return; const c = await Auth.client(); if (!c) return;
    const { data: p } = await c.from('profiles').select('nombre,apellidos,telefono,whatsapp,telefono_publico,provincia,canton,distrito,senas,cedula,foto_url,idioma').eq('id', u.id).maybeSingle();
    const DIV = await fetch('data/cr_division.json').then(r => r.json()).catch(() => ({}));
    const pf = p || {}, opt = (arr, v, ph) => `<option value="">${ph}</option>` + arr.map(x => `<option ${x === v ? 'selected' : ''}>${E(x)}</option>`).join('');
    const sec = document.createElement('section'); sec.id = 'datos'; sec.className = 'bg-white dark:bg-slate-800 rounded-2xl shadow p-5';
    sec.innerHTML = `<h2 class="font-bold">👤 ${T('Datos personales')}</h2><p class="text-xs opacity-70 mt-1">${T('Solo tú y el equipo de MapMarket pueden ver estos datos. En tus anuncios solo se muestran tu nombre y tu foto (y tu teléfono si lo permites).')}</p>
      <form id="dForm" class="grid sm:grid-cols-2 gap-3 mt-3 text-sm" novalidate>
        <div class="sm:col-span-2 flex items-center gap-3"><img id="dFotoImg" src="${E(pf.foto_url || 'icons/icon-192.png')}" alt="${T('Foto de perfil')}" class="w-16 h-16 rounded-full object-cover border dark:border-slate-600"><label class="rounded-lg border dark:border-slate-600 px-3 cursor-pointer" style="min-height:44px;line-height:44px">📷 ${T('Cambiar foto')}<input id="dFoto" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only"></label><span class="text-[11px] opacity-60">${T('Se revisa antes de mostrarse')}</span></div>
        <label>${T('Nombre')} *<input id="dNombre" required maxlength="80" autocomplete="given-name" value="${E(pf.nombre || '')}" class="${inp}" style="min-height:44px"></label>
        <label>${T('Apellidos')}<input id="dApe" maxlength="100" autocomplete="family-name" value="${E(pf.apellidos || '')}" class="${inp}" style="min-height:44px"></label>
        <label>${T('Teléfono')}<div class="flex mt-1"><span class="px-2 rounded-l-lg border border-r-0 dark:border-slate-600 flex items-center">+506</span><input id="dTel" inputmode="tel" autocomplete="tel-national" placeholder="8888 8888" value="${E((pf.telefono || '').replace(/^\+506/, '').replace(/(\d{4})(\d{4})/, '$1 $2'))}" class="w-full px-3 rounded-r-lg border dark:bg-slate-700 dark:border-slate-600" style="min-height:44px"></div></label>
        <div class="flex flex-col justify-end gap-1"><label class="flex items-center gap-2"><input id="dWa" type="checkbox" class="w-5 h-5" ${pf.whatsapp ? 'checked' : ''}> ${T('Este número tiene WhatsApp')}</label><label class="flex items-center gap-2"><input id="dTelPub" type="checkbox" class="w-5 h-5" ${pf.telefono_publico ? 'checked' : ''}> ${T('Mostrar mi teléfono en mis anuncios')}</label></div>
        <label>${T('Provincia')}<select id="dProv" class="${inp}" style="min-height:44px">${opt(Object.keys(DIV), pf.provincia, T('Elegir…'))}</select></label>
        <label>${T('Cantón')}<select id="dCant" class="${inp}" style="min-height:44px"></select></label>
        <label>${T('Distrito')}<select id="dDist" class="${inp}" style="min-height:44px"></select></label>
        <label>${T('Cédula (opcional)')}<input id="dCed" maxlength="20" placeholder="1-2345-6789" value="${E(pf.cedula || '')}" class="${inp}" style="min-height:44px"></label>
        <label class="sm:col-span-2">${T('Otras señas')}<textarea id="dSenas" maxlength="300" rows="2" class="${inp} py-2">${E(pf.senas || '')}</textarea></label>
        <label>${T('Idioma')}<select id="dIdioma" class="${inp}" style="min-height:44px"><option value="es" ${pf.idioma !== 'en' ? 'selected' : ''}>🇨🇷 Español</option><option value="en" ${pf.idioma === 'en' ? 'selected' : ''}>🇺🇸 English</option></select></label>
        <div class="flex items-end"><button id="dSave" class="w-full bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold" style="min-height:44px">💾 ${T('Guardar datos')}</button></div>
        <p id="dErr" class="sm:col-span-2 text-red-600 text-sm" role="alert"></p>
      </form>
      <div class="grid sm:grid-cols-2 gap-4 mt-5 pt-4 border-t dark:border-slate-700 text-sm">
        <form id="eForm"><b>✉️ ${T('Cambiar correo')}</b><p class="text-xs opacity-70">${T('Actual')}: ${E(u.email)}</p><input id="eNew" type="email" autocomplete="email" placeholder="${T('nuevo@correo.com')}" class="${inp}" style="min-height:44px" required><button class="mt-2 rounded-lg border border-teal-600 text-teal-700 dark:text-teal-300 px-3 w-full" style="min-height:44px">${T('Enviar confirmación')}</button><p class="text-[11px] opacity-60 mt-1">${T('Te enviaremos un enlace al correo nuevo (y, según la configuración, también al actual). El cambio se aplica al confirmarlo.')}</p></form>
        <form id="pForm"><b>🔑 ${T('Cambiar contraseña')}</b><input id="pNew" type="password" minlength="8" autocomplete="new-password" placeholder="${T('Nueva contraseña (mín. 8)')}" class="${inp}" style="min-height:44px" required><input id="pNew2" type="password" minlength="8" autocomplete="new-password" placeholder="${T('Repite la contraseña')}" class="${inp}" style="min-height:44px" required><button class="mt-2 rounded-lg border border-teal-600 text-teal-700 dark:text-teal-300 px-3 w-full" style="min-height:44px">${T('Actualizar contraseña')}</button></form>
      </div>`;
    const first = $('m').querySelector('section'); first ? first.insertAdjacentElement('afterend', sec) : $('m').appendChild(sec);
    const fillC = (cv) => { const cs = DIV[$('dProv').value] || {}; $('dCant').innerHTML = opt(Object.keys(cs), cv, T('Elegir…')); fillD() };
    const fillD = (dv) => { const ds = (DIV[$('dProv').value] || {})[$('dCant').value] || []; $('dDist').innerHTML = opt(ds, dv, T('Elegir…')) };
    $('dProv').onchange = () => fillC(); $('dCant').onchange = () => fillD();
    fillC(pf.canton); fillD(pf.distrito);
    $('dForm').onsubmit = async e => {
      e.preventDefault(); const err = $('dErr'); err.textContent = '';
      const tel = telNorm($('dTel').value), ced = $('dCed').value.trim();
      if (!$('dNombre').value.trim()) return err.textContent = T('El nombre es obligatorio.');
      if (tel && !/^\+506[2-8]\d{7}$/.test(tel)) return err.textContent = T('Teléfono inválido: usa 8 dígitos de Costa Rica (p. ej. 8888 8888).');
      if (ced && !/^[0-9A-Za-z-]{9,20}$/.test(ced)) return err.textContent = T('Cédula inválida (9 a 20 caracteres: números, letras o guiones).');
      if ($('dTelPub').checked && !tel) return err.textContent = T('Agrega un teléfono para mostrarlo en tus anuncios.');
      const row = { nombre: $('dNombre').value.trim(), apellidos: $('dApe').value.trim() || null, telefono: tel || null, whatsapp: $('dWa').checked, telefono_publico: $('dTelPub').checked, provincia: $('dProv').value || null, canton: $('dCant').value || null, distrito: $('dDist').value || null, senas: $('dSenas').value.trim() || null, cedula: ced || null, idioma: $('dIdioma').value };
      const b = $('dSave'); b.disabled = true;
      const { error } = await c.from('profiles').update(row).eq('id', u.id); b.disabled = false;
      if (error) { err.textContent = error.message; toast(T('No se pudo guardar'), false); return }
      const cambio = row.idioma !== window.MMLang; localStorage.setItem('mm_idioma', row.idioma); toast('✅ ' + T('Datos guardados')); if (cambio) setTimeout(() => location.reload(), 900);
    };
    $('dFoto').onchange = async e => {
      const f = e.target.files[0]; if (!f) return; if (f.size > 8e6) return toast(T('La imagen es muy grande (máx. 8 MB).'), false);
      try {
        const img = await createImageBitmap(f), s = 512 / Math.max(img.width, img.height), cv = document.createElement('canvas'); cv.width = Math.round(img.width * Math.min(1, s)); cv.height = Math.round(img.height * Math.min(1, s)); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', .85)), path = `${u.id}/${Date.now()}.jpg`;
        const up = await c.storage.from('avatares').upload(path, blob, { contentType: 'image/jpeg' }); if (up.error) throw up.error;
        const url = c.storage.from('avatares').getPublicUrl(path).data.publicUrl;
        const r = await c.rpc('registrar_avatar', { p_url: url }); if (r.error) throw r.error;
        if (pf.foto_url) { const old = pf.foto_url.split('/object/public/avatares/')[1]; if (old) c.storage.from('avatares').remove([old]).catch(() => {}) }
        pf.foto_url = url; $('dFotoImg').src = url; toast('✅ ' + T('Foto actualizada (se revisará antes de mostrarse públicamente)'));
        c.functions.invoke('moderar-imagenes', { body: {} }).catch(() => {});
      } catch (er) { toast(er.message || T('No se pudo subir la foto'), false) }
    };
    $('eForm').onsubmit = async e => {
      e.preventDefault(); const em = $('eNew').value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast(T('Correo inválido'), false); if (em === u.email) return toast(T('Ese ya es tu correo'), false);
      const { error } = await c.auth.updateUser({ email: em }, { emailRedirectTo: (GH_CONFIG.siteUrl || location.origin + '/') + 'confirmar.html?tipo=email&next=cuenta.html' });
      error ? toast(error.message, false) : toast('📧 ' + T('Te enviamos un enlace de confirmación. Revisa tu bandeja (y Spam).'));
    };
    $('pForm').onsubmit = async e => {
      e.preventDefault(); const a = $('pNew').value, b = $('pNew2').value; if (a.length < 8) return toast(T('La contraseña debe tener al menos 8 caracteres.'), false); if (a !== b) return toast(T('Las contraseñas no coinciden.'), false);
      const { error } = await c.auth.updateUser({ password: a }); if (error) return toast(error.message, false); $('pForm').reset(); toast('✅ ' + T('Contraseña actualizada'));
    };
  }
  const wait = setInterval(() => { const m = $('m'); if (m && m.querySelector('section')) { clearInterval(wait); init().catch(e => console.warn('datos', e)) } }, 200);
  setTimeout(() => clearInterval(wait), 15000);
})();
