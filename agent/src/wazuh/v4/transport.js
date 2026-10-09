import net from 'node:net';
import { EventEmitter } from 'node:events';

export class TcpTransport extends EventEmitter {
  /** @param {object} opts */
  constructor(opts) {
    super();
    this.host = opts.host;
    this.port = opts.port;
    this.socket = null;
    this.connected = false;
    this.buffer = Buffer.alloc(0);
    this.reconnectMs = 1000;
    this.maxReconnectMs = 60000;
    this.shouldRun = false;
    this.reconnectTimer = null;
  }

  start() {
    this.shouldRun = true;
    this.connect();
  }

  detachSocket() {
    const sock = this.socket;
    if (!sock) return;
    sock.removeAllListeners();
    sock.destroy();
    this.socket = null;
    this.connected = false;
    this.buffer = Buffer.alloc(0);
  }

  connect() {
    if (!this.shouldRun) return;
    this.detachSocket();
    this.socket = net.connect({ host: this.host, port: this.port }, () => {
      this.connected = true;
      this.reconnectMs = 1000;
      this.emit('connect');
    });
    this.socket.on('data', (chunk) => this.onData(chunk));
    this.socket.on('error', (err) => {
      this.connected = false;
      this.emit('error', err);
    });
    this.socket.on('close', () => {
      this.connected = false;
      this.detachSocket();
      this.emit('disconnect');
      if (this.shouldRun) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        const jitter = Math.floor(Math.random() * 1000);
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectMs + jitter);
        this.reconnectTimer.unref?.();
      }
      this.reconnectMs = Math.min(this.reconnectMs * 2, this.maxReconnectMs);
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + len) break;
      const payload = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      this.emit('message', payload);
    }
  }

  /** @param {Buffer} payload */
  send(payload) {
    if (!this.connected || !this.socket || this.socket.destroyed || !this.socket.writable) return false;
    try {
      const header = Buffer.alloc(4);
      header.writeUInt32LE(payload.length, 0);
      this.socket.write(Buffer.concat([header, payload]));
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  stop() {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.detachSocket();
    this.removeAllListeners();
  }
}
