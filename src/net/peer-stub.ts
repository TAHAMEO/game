/**
 * Stands in for PeerJS in the build published as a claude.ai page: that page's sandbox
 * allows no WebRTC and no connections to other hosts, so shared runs are not offered there
 * (the friends screen says so) and this is never constructed.
 */
export class Peer {
  constructor() {
    throw new Error('Peer-to-peer connections are not available on this page.');
  }
}

export type DataConnection = never;
