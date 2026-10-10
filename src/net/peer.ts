import { type DataConnection, Peer } from 'peerjs';
import { type HostRoom, type Link, randomCode, type Transport } from './transport';

type PeerOpts = NonNullable<ConstructorParameters<typeof Peer>[1]>;

const PREFIX = 'the-quiet-v1-';

function describe(type: string | undefined, err: unknown): string {
  switch (type) {
    case 'browser-incompatible':
      return 'This browser cannot make peer-to-peer connections. Try a current Chrome, Firefox, Edge or Safari.';
    case 'network':
    case 'socket-error':
    case 'socket-closed':
    case 'server-error':
      return 'Could not reach the matchmaking server. Check your connection, or play through your own server.';
    case 'peer-unavailable':
      return 'No game with that code.';
    case 'unavailable-id':
      return 'Could not get a room code. Try again.';
    default:
      return `Connection failed (${type ?? String(err)}).`;
  }
}

function wrap(conn: DataConnection, onGone?: () => void): Link {
  let closed = false;
  const link: Link = {
    send: (m) => {
      if (!closed && conn.open) conn.send(m);
    },
    onMessage: () => {},
    onClose: () => {},
    close: () => {
      if (closed) return;
      closed = true;
      conn.close();
      onGone?.();
    },
  };
  const lost = (why: string) => {
    if (closed) return;
    closed = true;
    onGone?.();
    link.onClose(why);
  };
  conn.on('data', (d) => {
    if (!closed) link.onMessage(d);
  });
  conn.on('close', () => lost('closed'));
  conn.on('error', (e) => lost(String((e as { type?: string }).type ?? e)));
  conn.on('iceStateChanged', (s) => {
    if (s === 'failed' || s === 'closed') lost(s);
  });
  return link;
}

/**
 * Peer-to-peer over WebRTC. The PeerJS public server only introduces the machines (that is
 * all a room code is: the host's address on it); the run itself flows directly between
 * them, through the PeerJS TURN relays when a network will not allow a direct line.
 */
export class PeerTransport implements Transport {
  readonly name = 'peer';

  constructor(private readonly opts: PeerOpts = {}) {}

  host(): Promise<HostRoom> {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = () => {
        const code = randomCode();
        const peer = new Peer(PREFIX + code.toLowerCase(), this.opts);
        let opened = false;
        const room: HostRoom = {
          code,
          onJoin: () => {},
          onError: () => {},
          close: () => peer.destroy(),
        };
        peer.on('open', () => {
          opened = true;
          resolve(room);
        });
        peer.on('connection', (conn) => {
          conn.on('open', () => room.onJoin(wrap(conn)));
        });
        peer.on('error', (err) => {
          const type = (err as { type?: string }).type;
          if (!opened) {
            peer.destroy();
            if (type === 'unavailable-id' && tries++ < 4) attempt();
            else reject(new Error(describe(type, err)));
            return;
          }
          // a guest who never arrived is not the room's problem
          if (type === 'peer-unavailable') return;
          if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') room.onError(describe(type, err));
        });
        // stay reachable for friends still to come (running games don't need the server)
        peer.on('disconnected', () => {
          if (!peer.destroyed) {
            try {
              peer.reconnect();
            } catch {
              /* it will report through 'error' */
            }
          }
        });
      };
      attempt();
    });
  }

  join(code: string): Promise<Link> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(this.opts);
      let done = false;
      const fail = (msg: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail('Nobody answered. Check the code and try again.'), 25000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code.toLowerCase(), { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(wrap(conn, () => peer.destroy()));
        });
        conn.on('error', (e) => fail(describe((e as { type?: string }).type, e)));
      });
      peer.on('error', (err) => fail(describe((err as { type?: string }).type, err)));
    });
  }
}

/** `host:port[/path]` of a self-run PeerServer, for testing without the public one. */
export function peerServerOptions(spec: string | null): PeerOpts {
  if (!spec) return {};
  const m = /^(?:(wss?|https?):\/\/)?([^:/]+)(?::(\d+))?(\/.*)?$/.exec(spec);
  if (!m) return {};
  const secure = m[1] === 'https' || m[1] === 'wss';
  return { host: m[2]!, port: Number(m[3] ?? (secure ? 443 : 80)), path: m[4] ?? '/', secure };
}
