/*
 * Minimal Modbus TCP client (no dependencies).
 *
 * Supports the functions a vision station needs for a PLC handshake:
 *   FC1 read coils, FC2 read discrete inputs, FC3 read holding registers, FC4 read input registers,
 *   FC5 write single coil, FC6 write single register.
 * Requests are matched to replies by transaction id, time out individually, and the socket
 * reconnects with back-off after errors.
 */

const net = require('net');
const { EventEmitter } = require('events');

const EXCEPTIONS = {
  1: 'illegal function', 2: 'illegal data address', 3: 'illegal data value', 4: 'server device failure',
  5: 'acknowledge', 6: 'server device busy', 10: 'gateway path unavailable', 11: 'gateway target failed to respond',
};

class ModbusTcpClient extends EventEmitter {
  constructor({ host, port = 502, unitId = 1, timeoutMs = 1000 }) {
    super();
    Object.assign(this, { host, port, unitId, timeoutMs });
    this.socket = null;
    this.connected = false;
    this.transaction = 0;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.retryMs = 500;
    this.closed = false;
  }

  connect() {
    if (this.closed || this.socket) return;
    const socket = net.connect({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on('connect', () => { this.connected = true; this.retryMs = 500; this.emit('connect'); });
    socket.on('data', (chunk) => this.onData(chunk));
    const drop = (error) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const wasConnected = this.connected;
      this.connected = false;
      this.buffer = Buffer.alloc(0);
      this.pending.forEach(({ reject, timer }) => { clearTimeout(timer); reject(new Error(`PLC connection lost${error ? ` (${error.code || error.message})` : ''}`)); });
      this.pending.clear();
      if (wasConnected || error) this.emit('disconnect', error);
      if (!this.closed) { setTimeout(() => this.connect(), this.retryMs); this.retryMs = Math.min(this.retryMs * 2, 5000); }
    };
    socket.on('error', drop);
    socket.on('close', () => drop());
  }

  close() {
    this.closed = true;
    this.socket?.destroy();
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 7) {
      const length = this.buffer.readUInt16BE(4); // unit id + PDU
      if (this.buffer.length < 6 + length) return;
      const frame = this.buffer.subarray(0, 6 + length);
      this.buffer = this.buffer.subarray(6 + length);
      const id = frame.readUInt16BE(0);
      const request = this.pending.get(id);
      if (!request) continue;
      this.pending.delete(id);
      clearTimeout(request.timer);
      const pdu = frame.subarray(7);
      if (pdu[0] & 0x80) request.reject(new Error(`PLC exception ${pdu[1]}: ${EXCEPTIONS[pdu[1]] || 'unknown'}`));
      else request.resolve(pdu);
    }
  }

  request(pdu) {
    if (!this.connected) return Promise.reject(new Error('PLC not connected'));
    this.transaction = (this.transaction + 1) & 0xffff;
    const id = this.transaction;
    const header = Buffer.alloc(7);
    header.writeUInt16BE(id, 0);
    header.writeUInt16BE(0, 2);
    header.writeUInt16BE(pdu.length + 1, 4);
    header.writeUInt8(this.unitId, 6);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`PLC did not answer within ${this.timeoutMs} ms`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(Buffer.concat([header, pdu]));
    });
  }

  async readBits(fc, address, count) {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(fc, 0); pdu.writeUInt16BE(address, 1); pdu.writeUInt16BE(count, 3);
    const reply = await this.request(pdu);
    return Array.from({ length: count }, (_, i) => Boolean(reply[2 + (i >> 3)] & (1 << (i & 7))));
  }

  async readWords(fc, address, count) {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(fc, 0); pdu.writeUInt16BE(address, 1); pdu.writeUInt16BE(count, 3);
    const reply = await this.request(pdu);
    return Array.from({ length: count }, (_, i) => reply.readUInt16BE(2 + i * 2));
  }

  readCoils(address, count = 1) { return this.readBits(1, address, count); }
  readDiscreteInputs(address, count = 1) { return this.readBits(2, address, count); }
  readHoldingRegisters(address, count = 1) { return this.readWords(3, address, count); }
  readInputRegisters(address, count = 1) { return this.readWords(4, address, count); }

  async writeCoil(address, value) {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(5, 0); pdu.writeUInt16BE(address, 1); pdu.writeUInt16BE(value ? 0xff00 : 0x0000, 3);
    await this.request(pdu);
  }

  async writeRegister(address, value) {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(6, 0); pdu.writeUInt16BE(address, 1); pdu.writeUInt16BE(value & 0xffff, 3);
    await this.request(pdu);
  }
}

module.exports = { ModbusTcpClient };
