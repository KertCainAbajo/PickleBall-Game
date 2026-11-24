// Peer-to-peer networking via PeerJS (WebRTC). PeerJS's free public broker is
// only used to introduce the two browsers; game data then flows directly
// between them, so no game server is needed.

const PREFIX = 'pickle-rally-v1-';
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

function friendly(err) {
  const t = err && err.type;
  if (t === 'peer-unavailable') return 'Room not found. Check the code.';
  if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(t)) return 'Can’t reach the matchmaking server. Check your connection.';
  if (t === 'browser-incompatible') return 'This browser doesn’t support online play.';
  return `Connection error${t ? ` (${t})` : ''}.`;
}

const noop = { send() {}, close() {} };

export function hostRoom(h) {
  if (!window.Peer) { h.onError('Online play unavailable (PeerJS failed to load).'); return noop; }
  let peer, conn = null, closed = false, tries = 0;
  function start() {
    const code = makeCode();
    peer = new window.Peer(PREFIX + code);
    peer.on('open', () => h.onCode(code));
    peer.on('connection', c => {
      if (conn && conn.open) {
        c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 500); });
        return;
      }
      conn = c;
      c.on('open', () => h.onOpen());
      c.on('data', d => h.onData(d));
      c.on('close', () => { if (!closed) h.onClose(); });
      c.on('error', () => {});
    });
    peer.on('error', e => {
      if (closed) return;
      if (e.type === 'unavailable-id' && tries++ < 5) { peer.destroy(); start(); return; }
      if (e.type === 'peer-unavailable') return;
      h.onError(friendly(e));
    });
    peer.on('disconnected', () => {
      if (!closed && !peer.destroyed) { try { peer.reconnect(); } catch { /* ignore */ } }
    });
  }
  start();
  return {
    send(o) { if (conn && conn.open) conn.send(o); },
    close() { closed = true; try { peer.destroy(); } catch { /* ignore */ } },
  };
}

export function joinRoom(code, h) {
  if (!window.Peer) { h.onError('Online play unavailable (PeerJS failed to load).'); return noop; }
  let closed = false, opened = false, conn = null;
  const peer = new window.Peer();
  const timer = setTimeout(() => {
    if (!opened && !closed) h.onError('Timed out. The room may be closed, or your network blocks peer-to-peer connections.');
  }, 15000);
  peer.on('open', () => {
    conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    conn.on('open', () => { opened = true; clearTimeout(timer); h.onOpen(); });
    conn.on('data', d => h.onData(d));
    conn.on('close', () => { if (!closed && opened) h.onClose(); });
  });
  peer.on('error', e => { clearTimeout(timer); if (!closed) h.onError(friendly(e)); });
  return {
    send(o) { if (conn && conn.open) conn.send(o); },
    close() { closed = true; clearTimeout(timer); try { peer.destroy(); } catch { /* ignore */ } },
  };
}
