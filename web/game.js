// Phaser renderer for the CTF game (Phase 1).
// Reads world state from the NetClient and draws it; sends INPUT/INTERACT from
// the keyboard. Pure presentation — no wire logic here.
//
// World: origin at center, y grows DOWN, coords in world units (±mapSize/2).
// Screen: canvas SIZE px; scale = SIZE / mapSize; center maps to canvas center.

import { DIRECTION, FLAG_STATUS } from "/net.js";

const SIZE = 700;
const COLORS = {
  bg: 0x0f1420, bounds: 0x2a3550, circle: 0x3b82f6, circleFill: 0x14203a,
  flag: 0xf59e0b, flagDropped: 0x9ca3af, you: 0x22c55e, carrier: 0xf59e0b, other: 0x60a5fa,
  ring: 0x22c55e,
};
const DIR_KEYS = {
  [DIRECTION.UP]: ["UP", "W"], [DIRECTION.DOWN]: ["DOWN", "S"],
  [DIRECTION.LEFT]: ["LEFT", "A"], [DIRECTION.RIGHT]: ["RIGHT", "D"],
};

class PlayScene extends Phaser.Scene {
  constructor(net) { super("play"); this.net = net; }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.gWorld = this.add.graphics();      // static-ish: bounds + circle
    this.gDyn = this.add.graphics();        // players + flag, redrawn each frame
    this.labels = new Map();                // id -> Phaser.Text

    this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,E");
    this.input.keyboard.addCapture("SPACE,UP,DOWN,LEFT,RIGHT"); // don't scroll the page
    this.activeDir = DIRECTION.NONE;
    this.input.keyboard.on("keydown-SPACE", () => this.net.sendInteract());
    this.input.keyboard.on("keydown-E", () => this.net.sendInteract());
  }

  // world -> screen
  tx(cfg, wx) { return SIZE / 2 + wx * (SIZE / cfg.mapSize); }
  ty(cfg, wy) { return SIZE / 2 + wy * (SIZE / cfg.mapSize); }
  s(cfg, v) { return v * (SIZE / cfg.mapSize); }

  keyHeld(dir) { return DIR_KEYS[dir].some((k) => this.keys[k] && this.keys[k].isDown); }

  pollInput() {
    const down = [DIRECTION.UP, DIRECTION.DOWN, DIRECTION.LEFT, DIRECTION.RIGHT].filter((d) => this.keyHeld(d));
    // keep current direction if still held (stable), else pick one, else stop
    let next = down.includes(this.activeDir) ? this.activeDir : (down[0] ?? DIRECTION.NONE);
    if (next !== this.activeDir) { this.activeDir = next; this.net.sendInput(next); }
  }

  update() {
    const cfg = this.net.cfg;
    this.pollInput();
    this.gDyn.clear();
    if (!cfg) return;

    // static layer (redraw is cheap at this scale)
    this.gWorld.clear();
    this.gWorld.lineStyle(1, COLORS.bounds, 1).strokeRect(0, 0, SIZE, SIZE);
    const cx = this.tx(cfg, 0), cy = this.ty(cfg, 0), cr = this.s(cfg, cfg.circleRadius);
    this.gWorld.fillStyle(COLORS.circleFill, 1).fillCircle(cx, cy, cr);
    this.gWorld.lineStyle(2, COLORS.circle, 0.8).strokeCircle(cx, cy, cr);

    // flag
    const f = this.net.flag;
    if (f && f.status !== FLAG_STATUS.CARRIED) {
      const col = f.status === FLAG_STATUS.DROPPED ? COLORS.flagDropped : COLORS.flag;
      this.gDyn.fillStyle(col, 1).fillRect(this.tx(cfg, f.x) - 5, this.ty(cfg, f.y) - 5, 10, 10);
    }

    // players
    const seen = new Set();
    const pr = Math.max(6, this.s(cfg, cfg.playerRadius));
    for (const p of this.net.interpPlayers()) {
      seen.add(p.id);
      const x = this.tx(cfg, p.x), y = this.ty(cfg, p.y);
      const isYou = p.id === this.net.myId;
      const col = isYou ? COLORS.you : p.hasFlag ? COLORS.carrier : COLORS.other;
      this.gDyn.fillStyle(col, 1).fillCircle(x, y, pr);
      if (isYou) this.gDyn.lineStyle(2, COLORS.ring, 1).strokeCircle(x, y, pr + 4);
      if (p.hasFlag) this.gDyn.fillStyle(COLORS.flag, 1).fillRect(x + pr, y - pr - 8, 8, 8); // carried flag marker

      let t = this.labels.get(p.id);
      const text = `${p.name}${isYou ? " (you)" : ""}`;
      if (!t) { t = this.add.text(0, 0, "", { fontFamily: "monospace", fontSize: "11px", color: "#cbd5e1" }).setOrigin(0.5, 1); this.labels.set(p.id, t); }
      t.setText(text).setPosition(x, y - pr - 4).setVisible(true);
    }
    for (const [id, t] of this.labels) if (!seen.has(id)) { t.destroy(); this.labels.delete(id); }
  }
}

export function startGame(net) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: SIZE, height: SIZE,
    parent: "game",
    backgroundColor: "#0f1420",
    scene: new PlayScene(net),
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
  });
  return game;
}
