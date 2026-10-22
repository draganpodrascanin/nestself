/**
 * Minimal Socket.IO v4 test client using HTTP long-polling.
 *
 * Engine.IO packet types: 0=open, 1=close, 2=ping, 3=pong, 4=message, 6=noop
 * Socket.IO packet types (inside EIO type 4):
 *   0=CONNECT, 1=DISCONNECT, 2=EVENT, 3=ACK, 4=CONNECT_ERROR
 *
 * Wire format for polling:
 *   GET  /api/ws/?EIO=4&transport=polling           -> handshake
 *   POST /api/ws/?EIO=4&transport=polling&sid=X      -> send
 *   GET  /api/ws/?EIO=4&transport=polling&sid=X      -> receive (long-poll)
 *   Packets in a single response are delimited by \x1e.
 *
 * The client must always have an outstanding GET (long-poll) request.
 * Engine.IO closes the transport if no GET arrives within pingTimeout.
 */

interface EngineOpenData {
  sid: string;
  upgrades: string[];
  pingInterval: number;
  pingTimeout: number;
}

export interface TestSocketOptions {
  baseUrl: string;
  cookie?: string;
  ticket?: string;
  origin?: string;
  extraHeaders?: Record<string, string>;
}

function splitPayload(text: string): string[] {
  return text.split('\x1e');
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class TestSocket {
  private sid: string | null = null;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly authPayload: Record<string, unknown>;
  private connected = false;
  private closed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  /** Incoming events collected by the background poller. */
  private incomingEvents: Array<{ event: string; data: unknown }> = [];
  /** Set to true when the server disconnects us. */
  private serverDisconnected = false;
  /** Background poller promise. */
  private pollerRunning = false;

  constructor(opts: TestSocketOptions) {
    this.baseUrl = opts.baseUrl;
    this.headers = {};
    this.authPayload = {};
    if (opts.cookie) this.headers['Cookie'] = opts.cookie;
    if (opts.origin) this.headers['Origin'] = opts.origin;
    if (opts.extraHeaders) Object.assign(this.headers, opts.extraHeaders);
    if (opts.ticket) this.authPayload.ticket = opts.ticket;
  }

  async connect(timeoutMs = 5000): Promise<void> {
    // Engine.IO handshake
    const url = `${this.baseUrl}/api/ws/?EIO=4&transport=polling`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Engine.IO handshake failed: ${res.status} ${body}`);
    }

    const text = await res.text();
    const packets = splitPayload(text);
    const open = packets.find((p) => p.startsWith('0'));
    if (!open) throw new Error(`No open packet: ${text}`);

    const openData = JSON.parse(open.slice(1)) as EngineOpenData;
    this.sid = openData.sid;

    // Send Socket.IO CONNECT
    const connectPkt =
      Object.keys(this.authPayload).length > 0
        ? `40${JSON.stringify(this.authPayload)}`
        : '40';
    await this.post(connectPkt);

    // Wait for Socket.IO CONNECT response
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pkts = await this.get();
      for (const p of pkts) {
        if (p.startsWith('40')) {
          this.connected = true;
          // Start background polling loop
          this.startPoller();
          // Start periodic pings
          this.pingTimer = setInterval(() => {
            if (!this.closed) this.post('2').catch(() => {});
          }, Math.min(openData.pingInterval, 15_000));
          return;
        }
        if (p.startsWith('44')) {
          let msg = p;
          try {
            const d = JSON.parse(p.slice(2)) as { message?: string };
            msg = d.message ?? p;
          } catch { /* use raw */ }
          throw new Error(`Socket.IO connect error: ${msg}`);
        }
      }
      await delay(50);
    }
    throw new Error('Socket.IO connect timed out');
  }

  /**
   * Send an event (fire-and-forget). Use waitForEvent() to read the reply.
   */
  async emitEvent(event: string, data: unknown): Promise<void> {
    if (!this.connected) throw new Error('Not connected');
    const pkt = `42${JSON.stringify([event, data])}`;
    await this.post(pkt);
  }

  /**
   * Wait for a server-sent event by name.
   */
  async waitForEvent(eventName: string, timeoutMs = 5000): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Check collected events
      const qi = this.incomingEvents.findIndex((e) => e.event === eventName);
      if (qi !== -1) return this.incomingEvents.splice(qi, 1)[0]!.data;

      if (this.serverDisconnected) throw new Error('disconnected');

      await delay(50);
    }
    throw new Error(`Timeout waiting for event: ${eventName}`);
  }

  /**
   * Wait until the server disconnects us.
   */
  async waitForDisconnect(timeoutMs = 5000): Promise<boolean> {
    if (this.serverDisconnected || !this.connected) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.serverDisconnected || !this.connected) return true;
      await delay(100);
    }
    return this.serverDisconnected || !this.connected;
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.connected && this.sid) {
      try { await this.post('41'); } catch { /* ignore */ }
    }
    this.connected = false;
  }

  get isConnected(): boolean { return this.connected && !this.serverDisconnected; }

  // -- background poller --------------------------------------------------

  private startPoller(): void {
    if (this.pollerRunning) return;
    this.pollerRunning = true;
    this.pollLoop().catch(() => {});
  }

  private async pollLoop(): Promise<void> {
    while (!this.closed && !this.serverDisconnected) {
      const pkts = await this.get();
      for (const p of pkts) {
        // Engine.IO close
        if (p === '1') {
          this.serverDisconnected = true;
          this.connected = false;
          this.pollerRunning = false;
          return;
        }
        // Socket.IO disconnect
        if (p.startsWith('41')) {
          this.serverDisconnected = true;
          this.connected = false;
          this.pollerRunning = false;
          return;
        }
        // Engine.IO pong (ignore)
        if (p === '3') continue;
        // Engine.IO noop (ignore)
        if (p === '6') continue;
        // Socket.IO EVENT
        const ev = this.parseEvent(p);
        if (ev) {
          this.incomingEvents.push(ev);
        }
      }
    }
    this.pollerRunning = false;
  }

  // -- transport helpers --------------------------------------------------

  private async post(packet: string): Promise<void> {
    const url = `${this.baseUrl}/api/ws/?EIO=4&transport=polling&sid=${this.sid}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: packet,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 400 || res.status === 404) {
        this.serverDisconnected = true;
        this.connected = false;
        return;
      }
      throw new Error(`POST failed: ${res.status} ${body}`);
    }
  }

  private async get(): Promise<string[]> {
    if (this.closed || !this.sid) return [];
    const url = `${this.baseUrl}/api/ws/?EIO=4&transport=polling&sid=${this.sid}`;
    try {
      const res = await fetch(url, {
        headers: this.headers,
        signal: AbortSignal.timeout(25_000), // long-poll can hang for pingInterval
      });
      if (!res.ok) {
        if (res.status === 400 || res.status === 404) {
          this.serverDisconnected = true;
          this.connected = false;
          return ['1'];
        }
        return [];
      }
      const text = await res.text();
      return splitPayload(text);
    } catch {
      return [];
    }
  }

  private parseEvent(packet: string): { event: string; data: unknown } | null {
    if (!packet.startsWith('42')) return null;
    const rest = packet.slice(2);
    const idx = rest.indexOf('[');
    if (idx === -1) return null;
    try {
      const arr = JSON.parse(rest.slice(idx)) as unknown[];
      return { event: arr[0] as string, data: arr[1] };
    } catch {
      return null;
    }
  }
}

/**
 * Attempt connection and expect rejection; returns the error message.
 */
export async function expectConnectRejected(
  opts: TestSocketOptions,
): Promise<string> {
  const socket = new TestSocket(opts);
  try {
    await socket.connect(3000);
    throw new Error('Expected connection to be rejected');
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
