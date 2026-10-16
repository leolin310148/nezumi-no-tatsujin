'use strict';

const $ = (s) => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const SONGS = {
  catsong: 'assets/music/catsong.mp3',
  clappy: 'assets/music/happy-clappy.mp3',
};

const store = {
  get(k, d) { try { const v = localStorage.getItem('nezumi.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nezumi.' + k, JSON.stringify(v)); } catch { /* 無痕模式之類的，忽略 */ } },
};

/* ================= 音效 ================= */
const Sound = {
  ctx: null,
  master: null,
  buffers: {},

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      ['bonk', 'click'].forEach((n) => this.load(`assets/sfx/${n}.mp3`).catch(() => {}));
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  async load(url) {
    if (this.buffers[url]) return this.buffers[url];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const ab = await res.arrayBuffer();
    const buf = await new Promise((ok, ng) => this.ctx.decodeAudioData(ab, ok, ng));
    this.buffers[url] = buf;
    return buf;
  },

  play(name, vol = 1) {
    const buf = this.buffers[`assets/sfx/${name}.mp3`];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start();
  },

  // 吱吱聲：幾段快速上下滑的高頻正弦波，貓對這個頻段很有反應
  squeak(vol = 0.25) {
    const c = this.ctx;
    let t = c.currentTime + 0.01;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const d = rand(0.05, 0.11);
      const base = rand(2300, 3600);
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * rand(1.3, 1.6), t + d * 0.35);
      o.frequency.exponentialRampToValueAtTime(base * rand(0.8, 1.0), t + d);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + d + 0.02);
      t += d + rand(0.02, 0.06);
    }
  },

  loopMusic(buf, vol) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + 1);
    src.connect(g).connect(this.master);
    src.start();
    return {
      stop() {
        g.gain.cancelScheduledValues(c.currentTime);
        g.gain.setValueAtTime(g.gain.value, c.currentTime);
        g.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.3);
        src.stop(c.currentTime + 0.35);
      },
    };
  },
};

const PAW = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="#7d8784">' +
  '<ellipse cx="32" cy="42" rx="14" ry="12"/><ellipse cx="14" cy="26" rx="6" ry="8"/>' +
  '<ellipse cx="25" cy="15" rx="6" ry="8"/><ellipse cx="39" cy="15" rx="6" ry="8"/><ellipse cx="50" cy="26" rx="6" ry="8"/></svg>');

/* ================= 一隻老鼠 ================= */
class Mouse {
  constructor(game) {
    this.game = game;
    this.el = $('#mouse-tpl').content.firstElementChild.cloneNode(true);
    game.field.appendChild(this.el);
    this.face = 1;
    this.tilt = 0;
    this.caughtUntil = 0;
    this.next('enter');
  }

  get W() { return this.game.W; }
  get H() { return this.game.H; }
  get size() { return this.game.size; }

  remove() { this.el.remove(); }

  // 隨機目標點，盡量離現在位置遠一點，動起來才像在逃
  target() {
    const m = this.size * 0.5;
    let best = null;
    for (let i = 0; i < 6; i++) {
      const p = { x: rand(m, this.W - m), y: rand(m + 40, this.H - m) };
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (!best || d > best.d) best = { ...p, d };
      if (d > Math.min(this.W, this.H) * 0.35) break;
    }
    return best;
  }

  edgePoint() {
    const pad = this.size;
    const side = Math.floor(Math.random() * 4);
    if (side === 0) return { x: -pad, y: rand(pad, this.H - pad) };
    if (side === 1) return { x: this.W + pad, y: rand(pad, this.H - pad) };
    if (side === 2) return { x: rand(pad, this.W - pad), y: -pad };
    return { x: rand(pad, this.W - pad), y: this.H + pad };
  }

  dash(to, speedMul = 1) {
    const d = Math.hypot(to.x - this.x, to.y - this.y);
    const pxPerSec = [0, 380, 720, 1250][this.game.speed] * rand(0.65, 1.35) * speedMul;
    this.seg = { type: 'move', fx: this.x, fy: this.y, tx: to.x, ty: to.y, t: 0, dur: Math.max(0.12, d / pxPerSec) };
    this.aim(to.x - this.x, to.y - this.y);
    this.el.classList.add('running');
    if (Math.random() < 0.22) this.game.squeak(0.18);
  }

  // SVG 鼻子朝左，往右跑就水平翻轉；身體跟著前進方向傾斜
  aim(dx, dy) {
    if (Math.abs(dx) > 4) this.face = dx > 0 ? -1 : 1;
    this.tilt = clamp(Math.atan2(dy, Math.abs(dx) || 1) * 180 / Math.PI, -35, 35) * (this.face === 1 ? -1 : 1);
  }

  next(kind) {
    this.hidden = false;
    this.el.style.visibility = '';
    if (kind === 'pause') {
      this.el.classList.remove('running');
      this.tilt *= 0.3;
      this.seg = { type: 'pause', t: 0, dur: rand(0.25, this.game.speed === 3 ? 1.0 : 1.9), twitch: 0 };
    } else if (kind === 'dash') {
      this.dash(this.target());
    } else if (kind === 'sneak') {
      const a = rand(0, Math.PI * 2);
      const r = rand(30, 110);
      const m = this.size * 0.5;
      this.dash({ x: clamp(this.x + Math.cos(a) * r, m, this.W - m), y: clamp(this.y + Math.sin(a) * r, m + 40, this.H - m) }, 0.25);
    } else if (kind === 'exit') {
      this.dash(this.edgePoint(), 1.2);
      this.seg.then = 'hide';
    } else if (kind === 'hide') {
      this.hidden = true;
      this.el.style.visibility = 'hidden';
      this.seg = { type: 'hide', t: 0, dur: rand(0.6, 2.2) };
    } else if (kind === 'enter') {
      const p = this.edgePoint();
      this.x = p.x;
      this.y = p.y;
      this.dash(this.target(), 1.1);
    }
  }

  advance() {
    const s = this.seg;
    if (s.then) return this.next(s.then);
    if (s.type === 'hide') return this.next('enter');
    if (s.type === 'move') return this.next(Math.random() < 0.68 ? 'pause' : 'dash');
    const r = Math.random();
    this.next(r < 0.62 ? 'dash' : r < 0.9 ? 'sneak' : 'exit');
  }

  tick(dt) {
    const s = this.seg;
    s.t += dt;
    if (s.type === 'move') {
      const p = Math.min(1, s.t / s.dur);
      // 起跑很猛、收尾急煞，比 easeInOut 更像老鼠
      const e = 1 - Math.pow(1 - p, 2.4);
      this.x = s.fx + (s.tx - s.fx) * e;
      this.y = s.fy + (s.ty - s.fy) * e;
    } else if (s.type === 'pause') {
      s.twitch -= dt;
      if (s.twitch <= 0) {
        s.twitch = rand(0.12, 0.4);
        this.x += rand(-6, 6);
        this.y += rand(-4, 4);
        if (Math.random() < 0.15) this.face *= -1;
      }
    }
    if (s.t >= s.dur) this.advance();
  }

  follow(pointer, dt) {
    if (!pointer) return;
    this.hidden = false;
    this.el.style.visibility = '';
    const dx = pointer.x - this.x;
    const dy = pointer.y - this.y;
    const d = Math.hypot(dx, dy);
    const step = Math.min(d, (400 + d * 6) * dt);
    if (d > 1) {
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
    }
    if (d > 20) this.aim(dx, dy);
    else this.tilt *= 0.9;
    this.el.classList.toggle('running', d > 20);
  }

  render(now) {
    const { w, h } = this.game;
    const squash = this.caughtUntil > now ? ' scale(1.15, .55)' : '';
    this.el.style.transform =
      `translate(${this.x - w / 2}px, ${this.y - h / 2}px) rotate(${this.tilt}deg) scaleX(${this.face})${squash}`;
  }

  // 貓掌不精準，判定給寬一點
  hitTest(x, y) {
    if (this.hidden) return false;
    const dx = (x - this.x) / (this.game.w * 0.62);
    const dy = (y - this.y) / (this.game.h * 0.85);
    return dx * dx + dy * dy <= 1;
  }

  caught(manual) {
    this.caughtUntil = performance.now() + 220;
    // 被拍到就落荒而逃，過一下再從邊邊冒出來
    if (!manual) this.seg = { type: 'pause', t: 0, dur: 0.22, then: 'exit' };
  }
}

/* ================= 逗貓畫面 ================= */
const Game = {
  field: $('#cat'),
  hud: $('.cat-hud'),
  mice: [],
  manual: false,
  sound: true,
  speed: 2,
  count: 0,
  pointer: null,
  raf: 0,
  idleTimer: 0,
  music: null,
  wakeLock: null,
  running: false,

  start() {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'cat'));
    this.running = true;
    this.count = 0;
    $('#cat-count').textContent = '0';
    this.speed = Number($('#opt-speed').value);
    this.sound = $('#opt-squeak').checked;
    this.manual = false;
    this.resize();
    this.mice = Array.from({ length: Number($('#opt-count').value) }, () => new Mouse(this));
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.tick(t));
    this.bump();
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    navigator.wakeLock?.request('screen').then((l) => { this.wakeLock = l; }).catch(() => {});

    const song = SONGS[$('#opt-song').value];
    if (song) {
      Sound.load(song).then((buf) => {
        if (this.running && !this.music) this.music = Sound.loopMusic(buf, 0.45);
      }).catch(() => this.toast('音樂載入失敗'));
    }

    this.onDown = (e) => this.down(e);
    this.onMove = (e) => { this.pointer = { x: e.clientX, y: e.clientY }; this.bump(); };
    this.onKey = (e) => this.key(e);
    this.onResize = () => this.resize();
    this.field.addEventListener('pointerdown', this.onDown);
    this.field.addEventListener('pointermove', this.onMove);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
  },

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.field.removeEventListener('pointerdown', this.onDown);
    this.field.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    this.music?.stop();
    this.music = null;
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    this.mice.forEach((m) => m.remove());
    this.mice = [];
    this.field.querySelectorAll('.paw, .boom').forEach((n) => n.remove());
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'menu'));
  },

  resize() {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.size = clamp(Math.min(this.W, this.H) * 0.3, 130, 320);
    this.field.style.setProperty('--size', this.size + 'px');
    this.w = this.size;
    this.h = this.size * 0.55;
  },

  squeak(vol) {
    if (this.sound) Sound.squeak(vol);
  },

  bump() {
    this.hud.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.hud.classList.add('idle'), 3000);
  },

  toast(msg) {
    const t = $('#cat-toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  },

  key(e) {
    const k = e.key.toLowerCase();
    if (k === 'escape') return this.stop();
    if (k === 'f') {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (k === 'm') {
      this.manual = !this.manual;
      this.toast(this.manual ? '手動遛鼠：老鼠跟著游標走' : '自動模式：老鼠自己亂跑');
      if (!this.manual) this.mice[0].next('pause');
    } else if (k === 's') {
      this.sound = !this.sound;
      this.toast(this.sound ? '吱吱聲：開' : '吱吱聲：關');
    } else if (['1', '2', '3'].includes(k)) {
      this.speed = Number(k);
      this.toast(['', '速度：悠哉', '速度：正常', '速度：閃電'][this.speed]);
    } else return;
    this.bump();
  },

  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.mice.forEach((m, i) => {
      if (this.manual && i === 0) m.follow(this.pointer, dt);
      else m.tick(dt);
      m.render(now);
    });
    this.raf = requestAnimationFrame((t) => this.tick(t));
  },

  down(e) {
    this.bump();
    const paw = document.createElement('img');
    paw.src = PAW;
    paw.className = 'paw';
    paw.style.left = e.clientX + 'px';
    paw.style.top = e.clientY + 'px';
    paw.style.rotate = rand(-25, 25) + 'deg';
    this.field.appendChild(paw);
    setTimeout(() => paw.remove(), 1500);

    const idx = this.mice.findIndex((m) => m.hitTest(e.clientX, e.clientY));
    if (idx < 0) return;
    const m = this.mice[idx];
    this.count++;
    $('#cat-count').textContent = this.count;
    if (this.sound) { Sound.play('bonk', 0.9); Sound.squeak(0.3); }
    const boom = document.createElement('div');
    boom.className = 'boom';
    boom.textContent = pick(['抓到了！', '喵嗚！', '吱——！', '神之一爪', '好球！', '太鼠達人！']);
    boom.style.left = m.x + 'px';
    boom.style.top = (m.y - this.h * 0.4) + 'px';
    this.field.appendChild(boom);
    setTimeout(() => boom.remove(), 950);
    m.caught(this.manual && idx === 0);
  },
};

/* ================= 首頁 ================= */
for (const [id, key] of [['#opt-speed', 'speed'], ['#opt-count', 'count'], ['#opt-song', 'song']]) {
  const el = $(id);
  el.value = store.get(key, el.value);
  el.addEventListener('change', () => store.set(key, el.value));
}
$('#opt-squeak').checked = store.get('squeak', true);
$('#opt-squeak').addEventListener('change', (e) => store.set('squeak', e.target.checked));

$('#start').addEventListener('click', () => {
  Sound.ensure();
  Sound.play('click');
  Game.start();
});
document.addEventListener('fullscreenchange', () => {
  if (Game.running) setTimeout(() => Game.resize(), 50);
});
