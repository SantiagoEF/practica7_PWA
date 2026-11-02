(() => {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => console.log('[PWA] Service Worker registrado. Scope:', reg.scope))
        .catch((err) => console.error('[PWA] Error al registrar el Service Worker:', err));
    });
  }

  const $ = (id) => document.getElementById(id);
  const els = {
    estado: $('estado'),
    estadoTexto: $('estado-texto'),
    bannerOffline: $('banner-offline'),
    nombre: $('nombre'),
    canal: $('canal'),
    totalUsuarios: $('total-usuarios'),
    mensajes: $('mensajes'),
    formulario: $('formulario'),
    texto: $('texto'),
    enviar: $('enviar'),
    estadoHub: $('estado-hub')
  };

  const CLAVE_NOMBRE = 'hub_nombre';
  const CLAVE_CANAL = 'hub_canal';
  let socket = null;

  function leerAlmacenamiento(clave, valorPorDefecto) {
    try {
      return localStorage.getItem(clave) || valorPorDefecto;
    } catch (e) {
      return valorPorDefecto;
    }
  }

  function guardarAlmacenamiento(clave, valor) {
    try {
      localStorage.setItem(clave, valor);
    } catch (e) {
    }
  }

  els.nombre.value = leerAlmacenamiento(
    CLAVE_NOMBRE,
    `Usuario-${Math.floor(1000 + Math.random() * 9000)}`
  );
  els.canal.value = leerAlmacenamiento(CLAVE_CANAL, 'general');

  function setEstado(conectado) {
    els.estado.classList.toggle('conectado', conectado);
    els.estado.classList.toggle('desconectado', !conectado);
    els.estadoTexto.textContent = conectado ? 'Conectado' : 'Desconectado';
    els.texto.disabled = !conectado;
    els.enviar.disabled = !conectado;
    els.texto.placeholder = conectado
      ? 'Escribe un mensaje...'
      : 'Sin conexión con el Hub...';
  }

  function formatearHora(iso) {
    const fecha = new Date(iso);
    return fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  function mostrarVacio() {
    els.mensajes.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'vacio';
    p.textContent = 'Aún no hay mensajes en este canal.';
    els.mensajes.appendChild(p);
  }

  function limpiarVacio() {
    const vacio = els.mensajes.querySelector('.vacio');
    if (vacio) vacio.remove();
  }

  function agregarMensaje(sobre) {
    limpiarVacio();

    const contenedor = document.createElement('div');
    const esSistema = sobre.tipo === 'sistema';
    const esPropio = !esSistema && socket && sobre.origenId === socket.id;
    contenedor.className = `msg ${esSistema ? 'sistema' : esPropio ? 'propio' : ''}`.trim();

    if (esSistema) {
      contenedor.textContent = sobre.contenido;
    } else {
      const meta = document.createElement('div');
      meta.className = 'meta';

      const autor = document.createElement('span');
      autor.className = 'autor';
      autor.textContent = esPropio ? 'Tú' : sobre.origen;

      const hora = document.createElement('span');
      hora.textContent = formatearHora(sobre.timestamp);

      meta.appendChild(autor);
      meta.appendChild(hora);

      const cuerpo = document.createElement('div');
      cuerpo.className = 'cuerpo';
      cuerpo.textContent = sobre.contenido;

      contenedor.appendChild(meta);
      contenedor.appendChild(cuerpo);
    }

    els.mensajes.appendChild(contenedor);
    els.mensajes.scrollTop = els.mensajes.scrollHeight;
  }

  function mostrarMensajeLocalSistema(texto) {
    agregarMensaje({
      tipo: 'sistema',
      contenido: texto,
      timestamp: new Date().toISOString()
    });
  }

  function renderizarHistorial(lista) {
    els.mensajes.innerHTML = '';
    if (!lista || lista.length === 0) {
      mostrarVacio();
      return;
    }
    lista.forEach(agregarMensaje);
  }

  function unirseAlHub() {
    if (!socket || !socket.connected) return;

    const usuario = els.nombre.value.trim();
    const canal = els.canal.value;
    guardarAlmacenamiento(CLAVE_NOMBRE, usuario);
    guardarAlmacenamiento(CLAVE_CANAL, canal);

    socket.emit('unirse', { usuario, canal }, (respuesta) => {
      if (!respuesta || !respuesta.ok) {
        mostrarMensajeLocalSistema('No se pudo unir al canal.');
        return;
      }
      els.nombre.value = respuesta.usuario;
      els.canal.value = respuesta.canal;
      renderizarHistorial(respuesta.historial);
    });
  }

  function iniciarSocket() {
    if (typeof io === 'undefined') {
      setEstado(false);
      mostrarMensajeLocalSistema(
        'No se pudo cargar Socket.io. Abre la aplicación desde http://localhost:3000 con el servidor encendido.'
      );
      return;
    }

    socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    socket.on('connect', () => {
      setEstado(true);
      unirseAlHub();
    });

    socket.on('disconnect', () => {
      setEstado(false);
      mostrarMensajeLocalSistema('Conexión con el Hub perdida. Reintentando...');
    });

    socket.on('connect_error', () => {
      setEstado(false);
    });

    socket.on('mensaje', (sobre) => {
      agregarMensaje(sobre);
    });

    socket.on('usuarios', (info) => {
      els.totalUsuarios.textContent = info.total;
    });
  }

  els.formulario.addEventListener('submit', (e) => {
    e.preventDefault();
    const contenido = els.texto.value.trim();
    if (!contenido || !socket || !socket.connected) return;

    socket.emit('mensaje', { contenido }, (respuesta) => {
      if (!respuesta || !respuesta.ok) {
        mostrarMensajeLocalSistema(
          `Error: ${respuesta && respuesta.error ? respuesta.error : 'no se pudo enviar'}`
        );
      }
    });

    els.texto.value = '';
    els.texto.focus();
  });

  els.canal.addEventListener('change', unirseAlHub);
  els.nombre.addEventListener('change', unirseAlHub);

  window.addEventListener('online', () => els.bannerOffline.classList.add('oculto'));
  window.addEventListener('offline', () => els.bannerOffline.classList.remove('oculto'));
  if (!navigator.onLine) els.bannerOffline.classList.remove('oculto');

  async function consultarEstadoHub() {
    try {
      const respuesta = await fetch('/api/estado');
      const datos = await respuesta.json();

      if (datos.ok) {
        els.estadoHub.textContent =
          `Estado del Hub: activo · ${datos.clientesConectados} cliente(s) · ` +
          `uptime ${datos.uptimeSegundos}s`;
      } else {
        els.estadoHub.textContent = `Estado del Hub: ${datos.mensaje || 'sin información'}`;
      }
    } catch (err) {
      els.estadoHub.textContent = 'Estado del Hub: no disponible';
    }
  }

  setEstado(false);
  mostrarVacio();
  iniciarSocket();
  consultarEstadoHub();
  setInterval(consultarEstadoHub, 15000);
})();