const KEY = 'mind-palace-token';

function remembered() {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

export function readToken() {
  const fromAddress = new URLSearchParams(location.hash.slice(1)).get('token');
  if (fromAddress) saveToken(fromAddress);
  return fromAddress || remembered();
}

export function saveToken(token) {
  try { localStorage.setItem(KEY, token); } catch { /* private window: the address still carries it */ }
}

/** What this browser plays: embedded players from other sites, and the file types its video element takes. */
function playback() {
  const probe = document.createElement('video');
  const types = { mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg' };
  return { embeds: true, files: Object.keys(types).filter((ext) => probe.canPlayType(types[ext]) !== '') };
}

/**
 * One socket to the service, reopened with backoff when it drops.
 * status: 'no-token' | 'connecting' | 'live' | 'offline' | 'denied'
 */
export class Connection {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.token = '';
    this.socket = null;
    this.retry = 0;
    this.timer = null;
  }

  start(token) {
    this.token = token;
    clearTimeout(this.timer);
    this.socket?.close();
    if (!token) return this.onStatus('no-token');
    this.retry = 0;
    this.open();
  }

  open() {
    this.onStatus(this.retry === 0 ? 'connecting' : 'offline');
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/ws?token=${encodeURIComponent(this.token)}`);
    this.socket = socket;
    let opened = false;
    socket.onopen = () => {
      opened = true;
      this.retry = 0;
      this.send({ t: 'client', media: playback() });
      this.onStatus('live');
    };
    socket.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      this.onMessage(message);
    };
    socket.onclose = async () => {
      if (this.socket !== socket) return;
      // A refused socket looks the same as an unreachable one, so ask the API which it was.
      if (!opened && (await this.refused())) return this.onStatus('denied');
      this.onStatus('offline');
      const wait = Math.min(8000, 500 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.open(), wait);
    };
  }

  async refused() {
    try {
      return (await fetch('/api/state', { headers: this.auth() })).status === 401;
    } catch {
      return false;
    }
  }

  auth() {
    return { Authorization: `Bearer ${this.token}` };
  }

  /** Returns false when the message could not be sent. */
  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  /** A JSON request to the service's own API. */
  async api(method, path) {
    const reply = await fetch(path, { method, headers: this.auth() });
    if (!reply.ok) throw new Error(`${path} answered ${reply.status}`);
    return reply.json();
  }

  /** Assets and handoffs are fetched by the browser itself, which sends no header. */
  withToken(url) {
    if (!/^\/(assets|handoffs)\//.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.token)}`;
  }

  async upload(file) {
    const reply = await fetch(`/api/assets?name=${encodeURIComponent(file.name || 'file')}`, {
      method: 'POST',
      headers: { ...this.auth(), 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!reply.ok) throw new Error(`upload failed (${reply.status})`);
    return reply.json();
  }

  speechUrl(text) {
    return `/api/speak?token=${encodeURIComponent(this.token)}&text=${encodeURIComponent(text)}`;
  }

  /** `woke`: the recording began with what the page's spotter took for the name, so the service checks that it was (and answers '' if not). */
  async transcribe(blob, treeId, { woke = false } = {}) {
    const query = new URLSearchParams({ ...(treeId ? { tree: treeId } : {}), ...(woke ? { woke: '1' } : {}) }).toString();
    const reply = await fetch(`/api/transcribe${query ? `?${query}` : ''}`, {
      method: 'POST',
      headers: { ...this.auth(), 'Content-Type': blob.type.split(';')[0] || 'audio/webm' },
      body: blob,
    });
    if (!reply.ok) throw new Error(`transcription failed (${reply.status})`);
    return (await reply.json()).text ?? '';
  }
}
