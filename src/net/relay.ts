import type { HostRoom, Link, Transport } from './transport';

interface RelayMsg {
  t: string;
  code?: string;
  id?: number;
  m?: unknown;
  reason?: string;
}

/**
 * Through a relay server (`npm run server`): for a LAN party, a network that blocks
 * peer-to-peer, or a server of your own. Every message goes through the server, which
 * passes it on and keeps nothing.
 */
export class RelayTransport implements Transport {
  readonly name = 'relay';

  constructor(private readonly url: string) {}

  private connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch {
        reject(new Error(`That server address does not look right: ${this.url}`));
        return;
      }
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('The server did not answer.'));
      }, 8000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Could not reach the server at ${this.url}.`));
      };
    });
  }

  private first(ws: WebSocket, want: string): Promise<RelayMsg> {
    return new Promise((resolve, reject) => {
      ws.onmessage = (ev) => {
        const m = parse(ev.data);
        if (!m) return;
        if (m.t === want) resolve(m);
        else if (m.t === 'error') reject(new Error(m.reason ?? 'The server refused.'));
      };
      ws.onclose = () => reject(new Error('The server closed the connection.'));
    });
  }

  async host(): Promise<HostRoom> {
    const ws = await this.connect();
    ws.send(JSON.stringify({ t: 'host' }));
    const hosted = await this.first(ws, 'hosted');
    const links = new Map<number, Link & { gone(): void }>();
    const room: HostRoom = {
      code: String(hosted.code),
      onJoin: () => {},
      onError: () => {},
      close: () => ws.close(),
    };
    ws.onmessage = (ev) => {
      const m = parse(ev.data);
      if (!m) return;
      const id = Number(m.id);
      if (m.t === 'peer') {
        let closed = false;
        const link = {
          send: (msg: unknown) => {
            if (!closed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'to', id, m: msg }));
          },
          onMessage: (_: unknown) => {},
          onClose: (_: string) => {},
          close: () => {
            if (closed) return;
            closed = true;
            links.delete(id);
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'kick', id }));
          },
          gone: () => {
            if (closed) return;
            closed = true;
            links.delete(id);
            link.onClose('left');
          },
        };
        links.set(id, link);
        room.onJoin(link);
      } else if (m.t === 'from') links.get(id)?.onMessage(m.m);
      else if (m.t === 'left') links.get(id)?.gone();
    };
    ws.onclose = () => {
      for (const l of [...links.values()]) l.gone();
      room.onError('The server closed the connection.');
    };
    return room;
  }

  async join(code: string): Promise<Link> {
    const ws = await this.connect();
    ws.send(JSON.stringify({ t: 'join', code }));
    await this.first(ws, 'joined');
    let closed = false;
    const link: Link = {
      send: (msg) => {
        if (!closed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'up', m: msg }));
      },
      onMessage: () => {},
      onClose: () => {},
      close: () => {
        if (closed) return;
        closed = true;
        ws.close();
      },
    };
    const lost = (why: string) => {
      if (closed) return;
      closed = true;
      link.onClose(why);
    };
    ws.onmessage = (ev) => {
      const m = parse(ev.data);
      if (!m) return;
      if (m.t === 'down') link.onMessage(m.m);
      else if (m.t === 'closed') lost(m.reason ?? 'closed');
    };
    ws.onclose = () => lost('closed');
    return link;
  }
}

function parse(data: unknown): RelayMsg | null {
  try {
    const m = JSON.parse(String(data)) as RelayMsg;
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}

/** The relay that served this page, if it did (a LAN party: everyone opens the host's address). */
export async function sameOriginRelay(): Promise<string | null> {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const r = await fetch('relay.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { relay?: string };
    if (!j.relay) return null;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return j.relay.startsWith('ws') ? j.relay : `${proto}//${location.host}${j.relay}`;
  } catch {
    return null;
  }
}
