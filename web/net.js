// Networking client for the Phaser game (Phase 1).
// Owns the WebSocket + binary codec + world state, and exposes a small event API
// so the renderer (game.js) never touches the wire. State is kept in WORLD units
// (fromFixed applied here); the renderer only deals in world units + screen px.

import { encode, decode, DIRECTION, FLAG_STATUS, MATCH_STATE, fromFixed } from "/protocol.js";
export { DIRECTION, FLAG_STATUS, MATCH_STATE };

export class NetClient {
  constructor() {
    this.ws = null;
    this.myId = null;
    this.cfg = null;                 // {mapSize, circleRadius, playerRadius, interactionRadius, tickIntervalMs}
    this.matchState = null;
    this.players = new Map();        // id -> {name, prev:{x,y}, curr:{x,y}, tCurr, direction, hasFlag}
    this.flag = null;                // {x, y, status, carrierId}
    this.names = new Map();
    this.lastDir = DIRECTION.NONE;   // resent as keepalive (§22.1)
    this._keepalive = null;
    this._h = {};
  }

  on(ev, fn) { (this._h[ev] ||= []).push(fn); return this; }
  _emit(ev, ...a) { (this._h[ev] || []).forEach((f) => f(...a)); }

  connect(url, name) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => { this._emit("open"); this.send({ type: "JOIN", name }); };
    this.ws.onclose = () => { clearInterval(this._keepalive); this._keepalive = null; this._emit("close"); };
    this.ws.onerror = () => this._emit("neterror");
    this.ws.onmessage = (e) => {
      let m; try { m = decode(new Uint8Array(e.data)); } catch (err) { this._emit("log", `decode error: ${err.message}`); return; }
      this._handle(m);
    };
  }
  disconnect() { this.ws && this.ws.close(); }
  send(msg) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg)); }
  sendInput(direction) { this.lastDir = direction; if (this.myId != null) this.send({ type: "INPUT", playerId: this.myId, direction }); }
  sendInteract() { if (this.myId != null) this.send({ type: "INTERACT", playerId: this.myId }); }
  nameOf(id) { return this.names.get(id) || `P${id}`; }

  _handle(m) {
    switch (m.type) {
      case "JOIN_ACCEPTED":
        this.myId = m.playerId;
        // resend current INPUT every 2s so we're not idle-dropped (even in lobby)
        clearInterval(this._keepalive);
        this._keepalive = setInterval(() => this.send({ type: "INPUT", playerId: this.myId, direction: this.lastDir }), 2000);
        this._emit("joined", m); break;
      case "LOBBY_STATE":
        this.matchState = m.state; m.players.forEach((p) => this.names.set(p.playerId, p.name));
        this._emit("lobby", m); break;
      case "GAME_COUNTDOWN": this._emit("countdown", m.secondsRemaining); break;
      case "GAME_STARTED":
        this.cfg = {
          mapSize: fromFixed(m.mapSize), circleRadius: fromFixed(m.circleRadius),
          playerRadius: fromFixed(m.playerRadius), interactionRadius: fromFixed(m.interactionRadius),
          tickIntervalMs: m.tickIntervalMs,
        };
        m.players.forEach((p) => this.names.set(p.playerId, p.name));
        this.matchState = MATCH_STATE.RUNNING;
        this.players.clear();
        this.flag = { x: fromFixed(m.flagX), y: fromFixed(m.flagY), status: m.flagStatus, carrierId: m.flagCarrierId };
        this._emit("started", m); break;
      case "GAME_STATE": this._applyState(m); this._emit("state", m); break;
      case "FLAG_PICKED_UP": this._emit("event", `🚩 ${this.nameOf(m.playerId)} grabbed the flag`); break;
      case "FLAG_STOLEN": this._emit("event", `🥷 ${this.nameOf(m.newCarrierId)} stole from ${this.nameOf(m.previousCarrierId)}`); break;
      case "PLAYER_DISCONNECTED": this.players.delete(m.playerId); this._emit("event", `👋 ${this.nameOf(m.playerId)} left`); break;
      case "GAME_OVER": this.matchState = MATCH_STATE.FINISHED; this._emit("over", m); break;
      case "JOIN_REJECTED": this._emit("log", `join rejected (reason ${m.reason})`); break;
      case "ERROR": this._emit("log", `server ERROR code ${m.code}`); break;
      case "__UNKNOWN__": break; // tolerant reader
    }
  }

  _applyState(m) {
    const now = performance.now();
    const seen = new Set();
    for (const p of m.players) {
      seen.add(p.playerId);
      const x = fromFixed(p.x), y = fromFixed(p.y);
      let e = this.players.get(p.playerId);
      if (!e) e = this.players.set(p.playerId, { prev: { x, y }, curr: { x, y }, tCurr: now }).get(p.playerId);
      else { e.prev = { x: e.curr.x, y: e.curr.y }; e.curr = { x, y }; e.tCurr = now; }
      e.direction = p.direction; e.hasFlag = p.hasFlag; e.name = this.nameOf(p.playerId);
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
    this.flag = { x: fromFixed(m.flagX), y: fromFixed(m.flagY), status: m.flagStatus, carrierId: m.flagCarrierId };
  }

  // Interpolated positions for smooth 60fps rendering from 20 snapshots/sec.
  // Renders ~one snapshot behind (never extrapolates past the latest — §31).
  interpPlayers() {
    const now = performance.now();
    const interval = this.cfg?.tickIntervalMs || 50;
    const out = [];
    for (const [id, e] of this.players) {
      const a = Math.max(0, Math.min(1, (now - e.tCurr) / interval));
      out.push({
        id, name: e.name, direction: e.direction, hasFlag: e.hasFlag,
        x: e.prev.x + (e.curr.x - e.prev.x) * a,
        y: e.prev.y + (e.curr.y - e.prev.y) * a,
      });
    }
    return out;
  }
}
