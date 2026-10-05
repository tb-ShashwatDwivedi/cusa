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
  }

  start() {
    this.shouldRun = true;
    this.connect();
  }

  connect() {
    if (!this.shouldRun) return;
    this.socket = net.connect({ host: this.host, port: this.port }, () => {
      this.connected = true;
      this.reconnectMs = 1000;
      this.emit('connect');
    });
    this.socket.on('data', (chunk) => this.onData(chunk));
    this.socket.on('error', (err) => this.emit('error', err));
    this.socket.on('close', () => {
      this.connected = false;
      this.emit('disconnect');
      if (this.shouldRun) setTimeout(() => this.connect(), this.reconnectMs);
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
    if (!this.connected || !this.socket) return false;
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    this.socket.write(Buffer.concat([header, payload]));
    return true;
  }

  stop() {
    this.shouldRun = false;
    this.socket?.destroy();
  }
}
