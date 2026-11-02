'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const CANALES = ['general', 'avisos', 'proyectos'];
const MAX_HISTORIAL = 50;
const MAX_LONGITUD_MENSAJE = 500;
const MAX_LONGITUD_USUARIO = 20;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const clientes = new Map();

const historial = {};
CANALES.forEach((c) => (historial[c] = []));

const inicioServidor = Date.now();

function hora() {
  return new Date().toLocaleTimeString('es-MX', { hour12: false });
}

function log(etiqueta, texto) {
  console.log(`[${hora()}] [${etiqueta.padEnd(10)}] ${texto}`);
}

function limpiarTexto(valor, maxLongitud) {
  if (typeof valor !== 'string') return '';
  return valor.replace(/\s+/g, ' ').trim().slice(0, maxLongitud);
}

function crearSobre({ tipo, canal, origen, origenId, contenido }) {
  return {
    id: crypto.randomUUID(),
    version: '1.0',
    tipo,
    canal,
    origen,
    origenId,
    contenido,
    timestamp: new Date().toISOString()
  };
}

function guardarEnHistorial(sobre) {
  const lista = historial[sobre.canal];
  lista.push(sobre);
  if (lista.length > MAX_HISTORIAL) lista.shift();
}

function emitirUsuarios() {
  const lista = [...clientes.values()]
    .filter((c) => c.unido)
    .map((c) => ({ usuario: c.usuario, canal: c.canal }));
  io.emit('usuarios', { total: clientes.size, lista });
}

function anunciarEnCanal(canal, texto) {
  const sobre = crearSobre({
    tipo: 'sistema',
    canal,
    origen: 'Hub',
    origenId: 'hub',
    contenido: texto
  });
  guardarEnHistorial(sobre);
  io.to(canal).emit('mensaje', sobre);
}

app.use(
  express.static(CLIENT_DIR, {
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'sw.js') {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  })
);

app.get('/api/estado', (req, res) => {
  res.json({
    ok: true,
    servidor: 'Hub Central',
    clientesConectados: clientes.size,
    canales: CANALES,
    uptimeSegundos: Math.floor((Date.now() - inicioServidor) / 1000),
    timestamp: new Date().toISOString()
  });
});

io.on('connection', (socket) => {
  const usuarioInicial = `Anon-${socket.id.slice(0, 4)}`;
  clientes.set(socket.id, { usuario: usuarioInicial, canal: 'general', unido: false });
  socket.join('general');

  log('CONEXION', `Cliente ${socket.id} conectado (${usuarioInicial}). Total: ${clientes.size}`);
  emitirUsuarios();

  socket.on('unirse', (data, ack) => {
    const respuesta = typeof ack === 'function' ? ack : () => {};
    const actual = clientes.get(socket.id);
    if (!actual) return respuesta({ ok: false, error: 'Cliente no registrado' });

    const usuario = limpiarTexto(data && data.usuario, MAX_LONGITUD_USUARIO) || actual.usuario;
    const canal = data && CANALES.includes(data.canal) ? data.canal : 'general';

    const cambioNombre = usuario !== actual.usuario;
    const cambioCanal = canal !== actual.canal;
    const primeraVez = !actual.unido;

    if (cambioCanal) {
      socket.leave(actual.canal);
      anunciarEnCanal(actual.canal, `${actual.usuario} salió del canal #${actual.canal}`);
      socket.join(canal);
    }

    const nombreAnterior = actual.usuario;
    actual.usuario = usuario;
    actual.canal = canal;
    actual.unido = true;

    if (primeraVez || cambioCanal) {
      log('SUSCRIPCION', `${usuario} (${socket.id}) -> #${canal}`);
      anunciarEnCanal(canal, `${usuario} se unió al canal #${canal}`);
    } else if (cambioNombre) {
      log('RENOMBRE', `${nombreAnterior} ahora es ${usuario}`);
      anunciarEnCanal(canal, `${nombreAnterior} ahora se llama ${usuario}`);
    }

    emitirUsuarios();
    respuesta({
      ok: true,
      usuario,
      canal,
      canales: CANALES,
      historial: historial[canal]
    });
  });

  socket.on('mensaje', (data, ack) => {
    const respuesta = typeof ack === 'function' ? ack : () => {};
    const actual = clientes.get(socket.id);
    if (!actual) return respuesta({ ok: false, error: 'Cliente no registrado' });

    const contenido = limpiarTexto(data && data.contenido, MAX_LONGITUD_MENSAJE);
    if (!contenido) {
      log('RECHAZADO', `Mensaje vacío o inválido de ${actual.usuario}`);
      return respuesta({ ok: false, error: 'El mensaje está vacío o no es válido' });
    }

    const sobre = crearSobre({
      tipo: 'mensaje',
      canal: actual.canal,
      origen: actual.usuario,
      origenId: socket.id,
      contenido
    });

    guardarEnHistorial(sobre);
    io.to(actual.canal).emit('mensaje', sobre);

    log('MENSAJE', `#${sobre.canal} | ${sobre.origen}: ${sobre.contenido}`);
    respuesta({ ok: true, id: sobre.id });
  });

  socket.on('disconnect', (motivo) => {
    const actual = clientes.get(socket.id);
    clientes.delete(socket.id);

    if (actual && actual.unido) {
      anunciarEnCanal(actual.canal, `${actual.usuario} se desconectó`);
    }

    log(
      'DESCONEXION',
      `Cliente ${socket.id} (${actual ? actual.usuario : 'desconocido'}) salió. Motivo: ${motivo}. Total: ${clientes.size}`
    );
    emitirUsuarios();
  });

  socket.on('error', (err) => {
    log('ERROR', `Socket ${socket.id}: ${err.message}`);
  });
});

server.listen(PORT, () => {
  console.log('==============================================');
  console.log('  HUB CENTRAL - Sistema Distribuido');
  console.log(`  Servidor escuchando en http://localhost:${PORT}`);
  console.log(`  Sirviendo cliente desde: ${CLIENT_DIR}`);
  console.log('==============================================');
});

process.on('SIGINT', () => {
  log('SISTEMA', 'Apagando el Hub...');
  io.close(() => {
    server.close(() => process.exit(0));
  });
});