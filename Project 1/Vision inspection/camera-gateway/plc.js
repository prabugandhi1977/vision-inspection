/*
 * PLC inspection handshake over Modbus TCP.
 *
 *   PLC  → vision : trigger (rising edge starts an inspection), reset, recipe no., part no.
 *   vision → PLC  : ready, busy, complete, pass, fail, error, heartbeat, result code, count
 *
 * Sequence:  trigger↑ → busy=1, results cleared → station inspects → pass/fail/error + result
 * code written → complete=1, busy=0 → PLC reads result and drops trigger → complete=0.
 * No station online, a station timeout, or a lost connection always ends in ERROR — the
 * gateway never reports PASS on its own.
 *
 * Every signal is { area: coil | discrete | holding | input, address, bit? } so it can map to
 * coils or to single bits inside a holding register (e.g. Siemens MB_SERVER data blocks).
 */

const { EventEmitter } = require('events');
const { ModbusTcpClient } = require('./modbus');

const RESULT_CODE = { PASS: 1, FAIL: 2, ERROR: 3 };
const INPUTS = ['trigger', 'reset'];
const OUTPUTS = ['ready', 'busy', 'complete', 'pass', 'fail', 'error', 'heartbeat'];
const DEFAULT_MAP = {
  trigger: { area: 'coil', address: 0 },
  reset: { area: 'coil', address: 1 },
  ready: { area: 'coil', address: 10 },
  busy: { area: 'coil', address: 11 },
  complete: { area: 'coil', address: 12 },
  pass: { area: 'coil', address: 13 },
  fail: { area: 'coil', address: 14 },
  error: { area: 'coil', address: 15 },
  heartbeat: { area: 'coil', address: 16 },
  recipe: { area: 'holding', address: 0 },
  partNumber: { area: 'holding', address: 1 },
  resultCode: { area: 'holding', address: 10 },
  count: { area: 'holding', address: 11 },
};

class PlcHandshake extends EventEmitter {
  constructor(config) {
    super();
    this.config = { pollMs: 20, resultTimeoutMs: 3000, heartbeatMs: 1000, port: 502, unitId: 1, ...config };
    this.map = { ...DEFAULT_MAP, ...(config.map || {}) };
    this.validateMap();
    this.client = new ModbusTcpClient({ host: this.config.host, port: this.config.port, unitId: this.config.unitId, timeoutMs: this.config.requestTimeoutMs || 1000 });
    this.state = 'disconnected';
    this.stationOnline = false;
    this.outputs = {};
    this.lastInputs = { trigger: false, reset: false };
    this.triggerId = 0;
    this.current = null;
    this.count = 0;
    this.lastResult = null;
    this.lastError = null;
    this.heartbeat = false;
    this.writeChain = Promise.resolve();
    this.client.on('connect', () => this.onConnect());
    this.client.on('disconnect', (error) => this.onDisconnect(error));
  }

  validateMap() {
    for (const name of OUTPUTS.concat(['resultCode', 'count'])) {
      const signal = this.map[name];
      if (signal && (signal.area === 'discrete' || signal.area === 'input')) throw new Error(`PLC signal “${name}” must be writable (coil or holding), not ${signal.area}`);
    }
  }

  start() {
    this.client.connect();
    this.pollTimer = setInterval(() => this.poll(), this.config.pollMs);
    this.heartbeatTimer = setInterval(() => {
      if (!this.client.connected) return;
      this.heartbeat = !this.heartbeat;
      this.write('heartbeat', this.heartbeat).catch(() => {});
    }, this.config.heartbeatMs);
  }

  stop() {
    clearInterval(this.pollTimer);
    clearInterval(this.heartbeatTimer);
    this.client.close();
  }

  status() {
    return {
      configured: true,
      host: `${this.config.host}:${this.config.port}`,
      connected: this.client.connected,
      state: this.state,
      ready: Boolean(this.outputs.ready),
      stationOnline: this.stationOnline,
      count: this.count,
      current: this.current && { id: this.current.id, recipe: this.current.recipe, partNumber: this.current.partNumber },
      lastResult: this.lastResult,
      lastError: this.lastError,
    };
  }

  setStatus(patch) {
    Object.assign(this, patch);
    this.emit('status', this.status());
  }

  /* ---------- Signal access ---------- */

  async read(name) {
    const s = this.map[name];
    if (!s) return undefined;
    if (s.area === 'coil') return (await this.client.readCoils(s.address, 1))[0];
    if (s.area === 'discrete') return (await this.client.readDiscreteInputs(s.address, 1))[0];
    const word = s.area === 'holding' ? (await this.client.readHoldingRegisters(s.address, 1))[0] : (await this.client.readInputRegisters(s.address, 1))[0];
    return s.bit === undefined ? word : Boolean(word & (1 << s.bit));
  }

  // Writes are serialised so read-modify-write of bits inside one register cannot interleave.
  write(name, value) {
    const s = this.map[name];
    if (!s) return Promise.resolve();
    const run = async () => {
      if (s.area === 'coil') await this.client.writeCoil(s.address, value);
      else if (s.bit === undefined) await this.client.writeRegister(s.address, Number(value));
      else {
        const word = (await this.client.readHoldingRegisters(s.address, 1))[0];
        await this.client.writeRegister(s.address, value ? word | (1 << s.bit) : word & ~(1 << s.bit));
      }
      if (OUTPUTS.includes(name)) this.outputs[name] = Boolean(value);
    };
    this.writeChain = this.writeChain.catch(() => {}).then(run);
    return this.writeChain;
  }

  async writeAll(values) {
    for (const [name, value] of Object.entries(values)) await this.write(name, value);
  }

  /* ---------- Connection ---------- */

  async onConnect() {
    this.lastError = null;
    try {
      await this.writeAll({ busy: false, complete: false, pass: false, fail: false, error: false });
      this.lastInputs.trigger = Boolean(await this.read('trigger'));
      this.setStatus({ state: 'idle' });
      await this.updateReady();
      this.emit('log', `PLC connected ${this.config.host}:${this.config.port}`);
    } catch (error) {
      this.setStatus({ lastError: error.message });
    }
  }

  onDisconnect(error) {
    if (this.current) this.finishCurrent('ERROR', 'PLC connection lost', { skipWrite: true });
    this.outputs = {};
    this.setStatus({ state: 'disconnected', lastError: error ? `PLC connection lost (${error.code || error.message})` : 'PLC connection closed' });
  }

  setStationOnline(online) {
    if (this.stationOnline === online) return;
    this.stationOnline = online;
    this.emit('status', this.status());
    this.updateReady().catch(() => {});
  }

  async updateReady() {
    const ready = this.client.connected && this.stationOnline && this.state === 'idle';
    if (this.outputs.ready !== ready && this.client.connected) {
      await this.write('ready', ready);
      this.emit('status', this.status()); // announce once the PLC has the new Ready value
    }
  }

  /* ---------- Handshake ---------- */

  async poll() {
    if (!this.client.connected || this.polling) return;
    this.polling = true;
    try {
      const trigger = Boolean(await this.read('trigger'));
      const reset = this.map.reset ? Boolean(await this.read('reset')) : false;
      if (reset && !this.lastInputs.reset) await this.onReset();
      if (trigger && !this.lastInputs.trigger && this.state === 'idle') await this.onTrigger();
      if (!trigger && this.lastInputs.trigger) await this.onTriggerFall();
      this.lastInputs = { trigger, reset };
    } catch (error) {
      if (this.lastError !== error.message) this.setStatus({ lastError: error.message });
    } finally {
      this.polling = false;
    }
  }

  async onTrigger() {
    const id = ++this.triggerId;
    const recipe = this.map.recipe ? await this.read('recipe') : null;
    const partNumber = this.map.partNumber ? await this.read('partNumber') : null;
    await this.writeAll({ ready: false, complete: false, pass: false, fail: false, error: false, busy: true });
    this.current = { id, recipe, partNumber, started: Date.now() };
    this.setStatus({ state: 'busy' });
    if (!this.stationOnline) {
      await this.finishCurrent('ERROR', 'No inspection station is connected');
      return;
    }
    this.current.timer = setTimeout(() => {
      if (this.current?.id === id) this.finishCurrent('ERROR', `Station did not return a result within ${this.config.resultTimeoutMs} ms`);
    }, this.config.resultTimeoutMs);
    this.emit('trigger', { id, recipe, partNumber, time: new Date().toISOString() });
  }

  async finishCurrent(result, reason, { skipWrite = false } = {}) {
    const current = this.current;
    if (!current) return;
    clearTimeout(current.timer);
    this.current = null;
    this.count = (this.count + 1) & 0xffff;
    const cycleMs = Date.now() - current.started;
    this.lastResult = { id: current.id, result, reason: reason || null, partNumber: current.partNumber, cycleMs, time: new Date().toISOString() };
    if (!skipWrite && this.client.connected) {
      // Results first, then Complete, then Busy off: the PLC reads the result on Complete↑.
      await this.writeAll({ pass: result === 'PASS', fail: result === 'FAIL', error: result === 'ERROR', resultCode: RESULT_CODE[result], count: this.count });
      await this.write('complete', true);
      await this.write('busy', false);
      this.setStatus({ state: 'complete' });
    }
    if (reason) this.lastError = reason;
    this.emit('result', this.lastResult);
    this.emit('status', this.status());
  }

  async onTriggerFall() {
    if (this.state === 'complete') {
      await this.write('complete', false);
      this.setStatus({ state: 'idle' });
      await this.updateReady();
    } else if (this.state === 'busy') {
      // PLC withdrew the trigger before a result: abort with ERROR so nothing passes silently.
      await this.finishCurrent('ERROR', 'Trigger withdrawn by the PLC before the result');
      await this.write('complete', false);
      this.setStatus({ state: 'idle' });
      await this.updateReady();
    }
  }

  async onReset() {
    if (this.current) { clearTimeout(this.current.timer); this.current = null; }
    await this.writeAll({ busy: false, complete: false, pass: false, fail: false, error: false, resultCode: 0 });
    this.setStatus({ state: 'idle', lastError: null });
    await this.updateReady();
    this.emit('log', 'PLC reset');
  }

  // Called by the station with its result for trigger `id`.
  async submitResult(id, result) {
    if (!RESULT_CODE[result]) throw new Error(`Result must be PASS, FAIL or ERROR, not ${result}`);
    if (!this.current || this.current.id !== id) throw new Error(`Trigger ${id} is not waiting for a result (it may have timed out)`);
    await this.finishCurrent(result, result === 'ERROR' ? 'Station reported ERROR' : null);
    return this.lastResult;
  }
}

module.exports = { PlcHandshake, DEFAULT_MAP };
