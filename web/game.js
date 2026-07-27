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
  flag: 0xf59e0b, flagDropped: 0x9ca3af, pole: 0x8b6b3d,
  ring: 0x22c55e,
};
// One fixed color per player, picked from id so it stays stable across the match
// (ids are assigned once, from 1, never reused — see server.js).
const PLAYER_PALETTE = [
  0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x14b8a6,
  0x3b82f6, 0x8b5cf6, 0xec4899, 0x84cc16, 0x06b6d4,
];
const playerColor = (id) => PLAYER_PALETTE[id % PLAYER_PALETTE.length];
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

  // Draws a pole + waving cloth, anchored at (x, y) = the base of the pole.
  drawFlag(g, x, y, clothColor, { poleH = 26, poleW = 3, clothW = 16, clothH = 11 } = {}) {
    const topY = y - poleH;
    g.fillStyle(COLORS.pole, 1).fillRect(x - poleW / 2, topY, poleW, poleH);
    g.fillStyle(clothColor, 1).fillTriangle(
      x + poleW / 2, topY,
      x + poleW / 2, topY + clothH,
      x + poleW / 2 + clothW, topY + clothH / 2,
    );
  }

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
      this.drawFlag(this.gDyn, this.tx(cfg, f.x), this.ty(cfg, f.y) + 13, col);
    }

    // players
    const seen = new Set();
    const pr = Math.max(6, this.s(cfg, cfg.playerRadius));
    for (const p of this.net.interpPlayers()) {
      seen.add(p.id);
      const x = this.tx(cfg, p.x), y = this.ty(cfg, p.y);
      const isYou = p.id === this.net.myId;
      this.gDyn.fillStyle(playerColor(p.id), 1).fillCircle(x, y, pr);
      if (isYou) this.gDyn.lineStyle(2, COLORS.ring, 1).strokeCircle(x, y, pr + 4);
      if (p.hasFlag) this.drawFlag(this.gDyn, x + pr, y - pr, COLORS.flag, { poleH: 16, poleW: 2, clothW: 10, clothH: 7 }); // carried flag marker

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
