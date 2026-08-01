export function createNetModule(opts) {
  const onBytesIn = opts?.onBytesIn;
  const onBytesOut = opts?.onBytesOut;
  const onTextMsg = opts?.onTextMsg;
  const onBinaryMsg = opts?.onBinaryMsg;
  const onStatusChange = opts?.onStatusChange;
  const onOpen = opts?.onOpen;
  const onClose = opts?.onClose;

  const wsQuery = typeof opts?.wsQuery === 'function' ? opts.wsQuery : opts?.wsQuery;

  const t = typeof opts?.t === 'function' ? opts.t : (k) => String(k || '');

  let ws = null;
  let wsConnected = false;

  let wsReconnectAttempt = 0;
  let wsReconnectTimer = 0;

  let pingTimer = 0;

  const textEncoder = new TextEncoder();

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = `${proto}//${location.host}/ws`;
    const q = typeof wsQuery === 'function' ? wsQuery() : wsQuery;
    if (!q) return base;
    const s = String(q);
    if (s.startsWith('?')) return base + s;
    return base + `?${s}`;
  }

  function isConnected() {
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  function send(type, data) {
    if (!isConnected()) return false;
    const payload = JSON.stringify({ type, data });
    try {
      if (typeof onBytesOut === 'function') onBytesOut(textEncoder.encode(payload).length);
    } catch {}
    try {
      ws.send(payload);
    } catch (e) {
      try {
        console.error('ws_send_error', e);
      } catch {}
      return false;
    }
    return true;
  }

  function statusSuffix() {
    if (wsConnected) return '';
    if (ws && ws.readyState === WebSocket.CONNECTING) return ` • ${t('net.connecting')}`;
    if (wsReconnectTimer) return ` • ${t('net.reconnecting')}`;
    return ` • ${t('net.offline')}`;
  }

  function scheduleReconnect() {
    if (wsReconnectTimer) return;
    const base = 500;
    const exp = Math.round(base * Math.pow(2, Math.min(6, wsReconnectAttempt)));
    const delay = Math.min(5000, Math.round(exp * (0.75 + Math.random() * 0.5)));
    wsReconnectAttempt++;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = 0;
      connect();
    }, delay);
  }

  function connect() {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = 0;
    }

    try {
      ws = new WebSocket(wsUrl());
    } catch {
      return;
    }

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      wsConnected = true;
      wsReconnectAttempt = 0;

      if (!pingTimer) {
        pingTimer = setInterval(() => {
          const now = performance.now();
          send('rttPing', { t: now });
        }, 1000);
      }

      try {
        if (typeof onStatusChange === 'function') onStatusChange();
      } catch {}

      try {
        if (typeof onOpen === 'function') onOpen({ send });
      } catch (e) {
        try {
          console.error('ws_onopen_handler_error', e);
        } catch {}
      }
    };

    ws.onclose = (ev) => {
      wsConnected = false;

      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = 0;
      }

      try {
        if (typeof onClose === 'function') onClose(ev);
      } catch {}

      try {
        if (typeof onStatusChange === 'function') onStatusChange();
      } catch {}

      scheduleReconnect();
    };

    ws.onerror = (ev) => {
      wsConnected = false;
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = 0;
      }
      try {
        if (typeof onStatusChange === 'function') onStatusChange();
      } catch {}

      scheduleReconnect();

      try {
        if (typeof onClose === 'function') onClose(ev);
      } catch {}
    };

    ws.onmessage = async (ev) => {
      if (typeof ev.data === 'string') {
        try {
          if (typeof onBytesIn === 'function') onBytesIn(textEncoder.encode(ev.data).length);
        } catch {}

        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }

        try {
          if (typeof onTextMsg === 'function') onTextMsg(msg?.type, msg?.data);
        } catch (e) {
          try {
            console.error('ws_text_handler_error', e);
          } catch {}
        }
        return;
      }

      if (ev.data instanceof ArrayBuffer) {
        try {
          if (typeof onBytesIn === 'function') onBytesIn(ev.data.byteLength);
        } catch {}
        try {
          if (typeof onBinaryMsg === 'function') onBinaryMsg(ev.data);
        } catch (e) {
          try {
            console.error('ws_binary_handler_error', e);
          } catch {}
        }
        return;
      }

      if (ev.data && typeof ev.data.arrayBuffer === 'function') {
        const buf = await ev.data.arrayBuffer();
        try {
          if (typeof onBytesIn === 'function') onBytesIn(buf.byteLength);
        } catch {}
        try {
          if (typeof onBinaryMsg === 'function') onBinaryMsg(buf);
        } catch (e) {
          try {
            console.error('ws_binary_handler_error', e);
          } catch {}
        }
      }
    };

    try {
      if (typeof onStatusChange === 'function') onStatusChange();
    } catch {}
  }

  return {
    send,
    isConnected,
    connect,
    statusSuffix
  };
}
