// 진행 담당 — 시뮬레이션 결과(타임라인)를 3D + 방송 그래픽으로 "재생"한다.
// 규칙 계산은 match.js가 이미 끝냈다. 여기서는 승패에 영향을 주는 판단을 절대 하지 않는다.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BOOKS, getBook, rivalryFor } from './books.js';
import { simulate, seedSweep, ROUND_SECONDS } from './match.js';
import { Arena } from './arena.js';
import { BookFighter, QuoteSlip } from './fighter.js';
import { Director } from './director.js';
import { Hud } from './hud.js';
import { randomSeed, Rng } from './rng.js';

// 180도 선을 어느 쪽에 그을지 — 시드로 정해 경기 내내 고정한다
const rng180 = (seed) => (new Rng('line' + seed).next() < 0.5 ? 1 : -1);
import * as Audio from './audio.js';

const RED_Z = 1.5;
const BLUE_Z = -1.5;

class Game {
  constructor() {
    this.hud = new Hud();
    this.initThree();
    this.arena = new Arena(this.scene);
    this.director = new Director(this.camera, this.arena);
    this.slip = new QuoteSlip(this.scene);

    this.fighters = { red: null, blue: null };
    this.match = null;
    this.playing = false;
    this.playT = 0;
    this.cursor = 0;
    this.speed = 1;
    this.timeScale = 1;
    this.hold = 0; // 리플레이 중 타임라인 정지
    this.hitstop = 0;
    this.scheduled = [];
    this.lastStrike = null;
    this.excitement = 0;
    this.displayClock = ROUND_SECONDS;

    this.readParams();
    this.bindUI();
    this.hud.buildRoster(BOOKS, this.sel, (id) => this.pick(id));
    this.refreshPicks();
    this.hud.showScreen('setup');
    this.idleCamera();

    document.getElementById('loading').classList.add('gone');
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());

    // 콘솔에서 시드 분포를 직접 확인할 수 있게 열어둔다
    window.BOOKFIGHT = { simulate, seedSweep, BOOKS, game: this };
  }

  initThree() {
    const app = document.getElementById('app');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    app.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 200);
    this.camera.position.set(9, 3.4, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = false;
    this.controls.target.set(0, 2.0, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 26;

    addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  readParams() {
    const p = new URLSearchParams(location.search);
    const seed = p.get('seed') || randomSeed();
    this.sel = {
      red: BOOKS.some((b) => b.id === p.get('red')) ? p.get('red') : 'mobydick',
      blue: BOOKS.some((b) => b.id === p.get('blue')) ? p.get('blue') : 'artofwar',
    };
    this.hud.el.seedInput.value = seed;
    this.autostart = p.get('auto') === '1';
  }

  bindUI() {
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
    on('btn-reseed', () => {
      this.hud.el.seedInput.value = randomSeed();
    });
    on('btn-random-match', () => {
      const shuffled = BOOKS.slice().sort(() => Math.random() - 0.5);
      this.sel.red = shuffled[0].id;
      this.sel.blue = shuffled[1].id;
      this.refreshPicks();
    });
    on('btn-tape', () => this.showTape());
    on('btn-back', () => this.hud.showScreen('setup'));
    on('btn-fight', () => this.start());
    on('btn-rematch', () => {
      this.hud.el.seedInput.value = randomSeed();
      this.start();
    });
    on('btn-same', () => this.start());
    on('btn-newmatch', () => {
      this.teardown();
      this.hud.showScreen('setup');
      this.idleCamera();
    });
    on('btn-speed', () => {
      const steps = [1, 1.5, 2, 0.5];
      this.speed = steps[(steps.indexOf(this.speed) + 1) % steps.length];
      document.getElementById('btn-speed').textContent = this.speed.toFixed(1) + '×';
    });
    on('btn-free', () => {
      const free = !this.director.free;
      this.director.setFree(free);
      this.controls.enabled = free;
      if (free) {
        this.controls.target.set(0, 2.0, 0);
        this.camera.position.set(8, 3.6, 4);
      }
      document.getElementById('btn-free').classList.toggle('on', free);
    });
    on('btn-skip', () => this.skipToEnd());

    this.hud.el.seedInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^\w-]/g, '').slice(0, 16);
    });
  }

  pick(id) {
    // 레드 → 블루 → 레드 순으로 채운다. 이미 반대편에 있으면 자리를 바꾼다.
    if (this.sel.red === id) {
      this.sel.red = this.sel.blue;
      this.sel.blue = id;
    } else if (this.sel.blue === id) {
      this.sel.blue = this.sel.red;
      this.sel.red = id;
    } else if (this.nextSlot !== 'blue') {
      this.sel.red = id;
      this.nextSlot = 'blue';
    } else {
      this.sel.blue = id;
      this.nextSlot = 'red';
    }
    if (this.sel.red === this.sel.blue) {
      const other = BOOKS.find((b) => b.id !== id);
      if (this.nextSlot === 'blue') this.sel.blue = other.id;
      else this.sel.red = other.id;
    }
    this.refreshPicks();
  }

  refreshPicks() {
    this.hud.syncRoster(this.sel);
    this.hud.setPickLabels(getBook(this.sel.red), getBook(this.sel.blue));
    document.getElementById('btn-tape').disabled = !(this.sel.red && this.sel.blue);
  }

  showTape() {
    const a = getBook(this.sel.red);
    const b = getBook(this.sel.blue);
    const seed = this.hud.el.seedInput.value || randomSeed();
    // 시드가 만드는 컨디션 편차를 미리 보여준다 — 시드가 승부에 개입한다는 걸 눈으로 알리려고
    const preview = simulate(a, b, seed);
    this.hud.renderTape(a, b, seed, rivalryFor(a.id, b.id), {
      red: preview.fighters.red.cond,
      blue: preview.fighters.blue.cond,
    });
    this.hud.showScreen('tape');
  }

  // ── 경기 시작 ─────────────────────────────────────────
  start() {
    Audio.initAudio();
    Audio.resume();
    this.teardown();

    const a = getBook(this.sel.red);
    const b = getBook(this.sel.blue);
    const seed = this.hud.el.seedInput.value || randomSeed();
    this.match = simulate(a, b, seed);

    history.replaceState(null, '', `?seed=${encodeURIComponent(seed)}&red=${a.id}&blue=${b.id}`);

    this.fighters.red = new BookFighter(a, 'red', { facing: -1 }).addTo(this.scene);
    this.fighters.red.setPosition(0, RED_Z);
    this.fighters.red.lookAt(0, BLUE_Z);
    this.fighters.blue = new BookFighter(b, 'blue', { facing: 1 }).addTo(this.scene);
    this.fighters.blue.setPosition(0, BLUE_Z);
    this.fighters.blue.lookAt(0, RED_Z);

    this.hud.setFighters(a, b);
    this.hud.clearTicker();
    this.hud.clearDebate();
    this.hud.hideQuote();
    this.hud.hideBanner();
    this.hud.setReplay(false);
    this.hud.setSlowmo(false);
    this.hud.updateBars({ red: this.match.fighters.red.hpMax, blue: this.match.fighters.blue.hpMax }, null);
    this.hud.setKnockdowns('red', 0);
    this.hud.setKnockdowns('blue', 0);
    this.hud.setClock(ROUND_SECONDS);
    this.hud.showScreen('fight');

    this.playT = 0;
    this.cursor = 0;
    this.hold = 0;
    this.hitstop = 0;
    this.timeScale = 1;
    this.scheduled = [];
    this.lastStrike = null;
    this.displayClock = ROUND_SECONDS;
    this.excitement = 0.2;
    this.playing = true;
    this.ended = false;

    this.director.free = false;
    this.controls.enabled = false;
    document.getElementById('btn-free').classList.remove('on');
    this.director.lineSide = rng180(seed);
    this.director.cut('staredown', { dur: 2.6 });
    Audio.crowdBase(0.09);
  }

  teardown() {
    for (const c of ['red', 'blue']) {
      if (this.fighters[c]) {
        this.fighters[c].dispose(this.scene);
        this.fighters[c] = null;
      }
    }
    this.scheduled = [];
    this.lastStrike = null;
    this.playing = false;
  }

  idleCamera() {
    this.match = null;
    this.director.free = false;
    this.controls.enabled = false;
    document.getElementById('btn-free').classList.remove('on');
  }

  // 스케줄 — 리플레이/힛스톱에 맞춰 같이 느려져야 하므로 자체 시계를 쓴다
  schedule(delay, fn) {
    this.scheduled.push({ t: delay, fn });
  }

  // ── 이벤트 적용 ───────────────────────────────────────
  apply(ev) {
    const F = this.fighters;
    switch (ev.type) {
      case 'intro': {
        this.hud.banner('BOOKFIGHT', `${this.match.a.title}  vs  ${this.match.b.title}`, 'bell', 2200);
        this.director.cut('intro', { focus: 'red', dur: 2.2 });
        break;
      }
      case 'bell': {
        Audio.bell(3);
        Audio.roar(0.8);
        this.hud.banner(ev.text.includes('종료') ? '종료' : '1 ROUND', ev.text, 'bell', 1800);
        this.director.cut('staredown', { dur: 2.4 });
        this.excitement = 0.7;
        break;
      }
      case 'punch': {
        // 권투 층 — 짧고 빠르게. 자막도 카메라 컷도 건드리지 않는다(리듬이 끊기므로).
        const atk = F[ev.by];
        const def = F[ev.by === 'red' ? 'blue' : 'red'];
        if (!atk || !def) break;
        this.director.onEvent(ev);
        atk.attack(ev.punch, () => {
          if (ev.result === 'slip') {
            def.evade();
            Audio.paper(0.35);
            return;
          }
          const maxHp = ev.by === 'red' ? this.match.fighters.blue.hpMax : this.match.fighters.red.hpMax;
          const ratio = ev.dmg / maxHp;
          if (ev.result === 'block') {
            def.block();
            Audio.impact(0.45);
            this.director.punch(0.25);
          } else {
            def.hit(ratio, ev.crit);
            const strength = Math.min(1, 0.3 + ratio * 4 + (ev.crit ? 0.3 : 0));
            this.director.punch(strength * 0.5);
            this.arena.punchFlash(def.chestPoint(), strength * 0.6);
            Audio.impact(strength * 0.8);
            this.hitstop = Math.min(0.07, 0.015 + strength * 0.04);
          }
          this.hud.damagePop(ev.by === 'red' ? 'blue' : 'red', ev.dmg, ev.crit);
          this.excitement = Math.min(1, this.excitement + 0.05);
        });
        break;
      }

      case 'taunt': {
        const f = F[ev.by];
        const book = ev.by === 'red' ? this.match.a : this.match.b;
        this.hud.showTaunt(ev, book);
        this.director.onEvent(ev);
        if (f) f.speak(ev.hold * 0.82);
        break;
      }

      case 'reply': {
        const f = F[ev.by];
        const other = F[ev.by === 'red' ? 'blue' : 'red'];
        const book = ev.by === 'red' ? this.match.a : this.match.b;
        this.hud.showReply(ev, book);
        this.director.onEvent(ev);
        if (f) f.speak(ev.hold * 0.82);
        // 논파당한 쪽은 말문이 막힌다 — 맞은 건 아니라서 따로 모션을 둔다
        if (ev.rebutted && other) this.schedule(ev.hold * 0.6, () => other.flinch());
        break;
      }

      case 'commentary':
        this.hud.commentary(ev.text, ev.tone);
        if (ev.tone === 'shout') Audio.roar(0.7);
        break;

      case 'breathe':
        this.hud.commentary(ev.text, 'calm');
        this.director.onEvent(ev);
        break;

      case 'strike': {
        const atk = F[ev.by];
        const def = F[ev.by === 'red' ? 'blue' : 'red'];
        if (!atk || !def) break;
        const book = ev.by === 'red' ? this.match.a : this.match.b;
        this.lastStrike = { ev, atk, def, book };
        // 로어서드는 이제 피니시의 대표 문장 전용 — 평타까지 자막을 띄우면 설전 패널과 겹쳐 읽을 수 없다
        if (ev.move === 'finisher') this.hud.showQuote(ev, book);
        this.director.onEvent(ev);

        atk.attack(ev.move === 'counter' ? 'jab' : ev.move, () => {
          Audio.whoosh();
          this.slip.launch(
            ev.quote,
            ev.source,
            book.cover.accent,
            atk.chestPoint(),
            def.chestPoint(),
            ev.move === 'finisher' ? 0.5 : 0.36,
            ev.move === 'finisher' || ev.crit
          );
          const travel = ev.move === 'finisher' ? 0.5 : 0.36;
          this.schedule(travel, () => this.landStrike(ev, atk, def));
        });
        break;
      }

      case 'recoil': {
        const f = F[ev.by];
        if (f) {
          f.hit(0.08, false);
          Audio.impact(0.5);
        }
        this.hud.commentary(ev.text, 'shout');
        this.hud.damagePop(ev.by, ev.dmg, false);
        if (ev.hp) this.hud.updateBars(ev.hp, null);
        break;
      }

      case 'dot': {
        const f = F[ev.who];
        if (f) f.burstPages(3, 0.3);
        this.hud.damagePop(ev.who, ev.dmg, false);
        this.hud.commentary(ev.text, 'calm');
        if (ev.hp) this.hud.updateBars(ev.hp, null);
        Audio.paper(0.5);
        break;
      }

      case 'stagger': {
        const f = F[ev.who];
        if (f) f.stagger();
        this.hud.banner('휘청!', '', 'crit', 900);
        this.director.onEvent(ev);
        this.excitement = Math.min(1, this.excitement + 0.25);
        break;
      }

      case 'knockdown': {
        const f = F[ev.who];
        if (f) f.knockdown();
        this.hud.banner('다 운 !', `${ev.count}번째 다운`, 'down', 2000);
        this.hud.setKnockdowns(ev.who, ev.count);
        this.hud.flash(0.7);
        this.director.punch(1.3);
        this.director.onEvent(ev);
        Audio.impact(1.5);
        Audio.roar(1);
        Audio.paper(1.4);
        this.excitement = 1;
        break;
      }

      case 'replay': {
        this.startReplay(ev);
        break;
      }

      case 'finish': {
        const loser = ev.winner === 'red' ? 'blue' : 'red';
        if (F[loser]) F[loser].ko();
        if (F[ev.winner]) F[ev.winner].celebrate();
        this.hud.hideQuote();
        this.hud.banner(
          ev.method === 'TKO' ? 'T K O' : 'K O',
          `${ev.winner === 'red' ? this.match.a.title : this.match.b.title} 승 · ${ev.detail || ''}`,
          'ko',
          4200
        );
        this.hud.flash(1);
        this.director.punch(1.4);
        this.director.onEvent(ev);
        Audio.impact(2);
        Audio.roar(1.4);
        Audio.bell(3);
        this.timeScale = 0.42;
        this.hud.setSlowmo(true);
        this.schedule(1.6, () => {
          this.timeScale = 1;
          this.hud.setSlowmo(false);
        });
        this.excitement = 1;
        break;
      }

      case 'decision': {
        const winBook = ev.winner === 'red' ? this.match.a : this.match.b;
        if (this.fighters[ev.winner]) this.fighters[ev.winner].celebrate();
        this.hud.banner('판 정', `${ev.method} — ${winBook.title}`, 'down', 4000);
        this.director.onEvent(ev);
        Audio.roar(1.1);
        Audio.bell(2);
        break;
      }

      case 'end':
        this.finishMatch();
        break;
    }

    if (ev.hp) this.hud.updateBars(ev.hp, ev.st);
  }

  landStrike(ev, atk, def) {
    if (ev.evaded) {
      def.evade();
      Audio.paper(0.4);
      return;
    }
    const ratio = ev.dmg / (ev.by === 'red' ? this.match.fighters.blue.hpMax : this.match.fighters.red.hpMax);
    def.hit(ratio, ev.crit);
    const strength = Math.min(1.6, 0.4 + ratio * 4 + (ev.crit ? 0.5 : 0) + (ev.move === 'finisher' ? 0.6 : 0));
    this.director.punch(strength * 0.75);
    this.arena.punchFlash(def.chestPoint(), strength);
    Audio.impact(strength);
    Audio.paper(strength * 0.7);
    this.hitstop = Math.min(0.13, 0.03 + strength * 0.055);
    this.hud.damagePop(ev.by === 'red' ? 'blue' : 'red', ev.dmg, ev.crit);
    if (ev.crit || ev.move === 'finisher') {
      this.hud.flash(ev.move === 'finisher' ? 0.9 : 0.5);
      Audio.roar(ev.move === 'finisher' ? 1 : 0.55);
      this.excitement = Math.min(1, this.excitement + 0.4);
    }
    if (ev.healed) {
      this.hud.commentary(`${ev.source}, 피해를 그대로 흡수합니다 (+${ev.healed})`, 'hype');
    }
    if (ev.traits && ev.traits.length) {
      this.hud.banner(ev.traits[0], '저자 특성 발동', 'crit', 1100);
    }
    this.excitement = Math.min(1, this.excitement + 0.12);
  }

  // 다운 장면을 다른 각도에서 슬로모로 다시 보여준다
  startReplay(ev) {
    const s = this.lastStrike;
    if (!s) return;
    this.hold = 3.1; // 타임라인 정지(실시간 기준)
    this.timeScale = 0.34;
    this.hud.setReplay(true);
    this.hud.setSlowmo(true);
    this.hud.hideQuote();
    this.hud.hideBanner();
    this.director.onEvent(ev);
    Audio.crowdBase(0.03);

    // 그 타격을 처음부터 다시 — 이번엔 오빗 카메라로.
    // 다운 모션을 끊고 들어가므로 down 플래그를 직접 되돌린다(onDone이 안 불린다).
    s.atk.anims = [];
    s.def.anims = [];
    s.atk.down = false;
    s.def.down = false;
    s.atk.attack(s.ev.move === 'counter' ? 'jab' : s.ev.move, () => {
      this.slip.launch(s.ev.quote, s.ev.source, s.book.cover.accent, s.atk.chestPoint(), s.def.chestPoint(), 0.4, true);
      this.schedule(0.4, () => {
        s.def.hit(0.3, true);
        this.arena.punchFlash(s.def.chestPoint(), 1.2);
        this.director.punch(0.8);
        Audio.impact(1.1);
      });
    });
  }

  endReplay() {
    this.hud.setReplay(false);
    this.hud.setSlowmo(false);
    this.timeScale = 1;
    Audio.crowdBase(0.06);
    // 다운 자세로 되돌려 놓는다 — 리플레이가 상태를 건드렸으니
    const s = this.lastStrike;
    if (s && s.def && !s.def.koed) s.def.stagger();
    this.director.cut('wide');
  }

  skipToEnd() {
    if (!this.match || this.ended) return;
    // 남은 이벤트를 화면 갱신만 하고 전부 소화한다
    const evs = this.match.events;
    for (let i = this.cursor; i < evs.length; i++) {
      const ev = evs[i];
      if (ev.hp) this.hud.updateBars(ev.hp, ev.st);
      if (ev.type === 'knockdown') this.hud.setKnockdowns(ev.who, ev.count);
    }
    this.cursor = evs.length;
    this.finishMatch();
  }

  finishMatch() {
    if (this.ended) return;
    this.ended = true;
    this.playing = false;
    this.hud.hideQuote();
    this.hud.hideBanner();
    this.hud.setReplay(false);
    this.hud.setSlowmo(false);
    this.timeScale = 1;
    this.hud.showResult(this.match);
    this.hud.showScreen('result');
    Audio.crowdBase(0.05);
  }

  // ── 프레임 ───────────────────────────────────────────
  frame() {
    // 시계는 두 개다.
    //   real  — 벽시계. 타임라인/카메라/관중이 쓴다. 프레임이 떨어져도 중계는 제 속도로 간다.
    //   show  — real × 연출 배속(슬로모·힛스톱). 파이터 모션과 예약 콜백이 쓴다.
    // 애니메이션은 전부 duration 기반(적분이 아니라)이라 큰 dt에도 안전하다.
    // 하나의 dt를 0.05로 묶어버리면 20fps 아래에서 경기 전체가 슬로모가 된다 — 그게 아니라 프레임만 떨어져야 한다.
    const real = Math.min(0.25, this.clock.getDelta());
    const time = this.clock.elapsedTime;

    let scale = this.timeScale;
    if (this.hitstop > 0) {
      this.hitstop -= real;
      scale *= 0.06; // 타격 순간을 아주 잠깐 얼린다
    }
    const show = real * scale;

    // 예약된 콜백(발췌문 도착, 슬로모 해제 등) — 연출 시간을 따른다
    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      const s = this.scheduled[i];
      s.t -= show;
      if (s.t <= 0) {
        this.scheduled.splice(i, 1);
        s.fn();
      }
    }

    // 리플레이 중에는 타임라인을 멈춘다(실시간으로 카운트)
    if (this.hold > 0) {
      this.hold -= real;
      if (this.hold <= 0) this.endReplay();
    } else if (this.playing && this.match) {
      this.playT += real * this.speed * (this.hitstop > 0 ? 0.06 : 1);
      const evs = this.match.events;
      while (this.cursor < evs.length && evs[this.cursor].t <= this.playT) {
        this.apply(evs[this.cursor]);
        this.cursor++;
        if (this.hold > 0) break; // 리플레이가 걸리면 나머지는 다음 프레임에
      }
      this.updateClock();
    }

    // 흥분도는 서서히 가라앉는다 — 관중과 조명이 여기에 반응한다
    this.excitement = Math.max(0, this.excitement - real * 0.22);
    this.autoQuality(real);

    const hasFighters = this.fighters.red && this.fighters.blue;
    if (!hasFighters) {
      // 선택 화면 — 빈 옥타곤을 천천히 돈다
      const a = time * 0.16;
      this.camera.position.set(Math.cos(a) * 11, 4.4 + Math.sin(a * 0.6) * 0.9, Math.sin(a) * 11);
      this.camera.lookAt(0, 1.6, 0);
    } else if (this.director.free) {
      this.controls.update();
    } else {
      this.director.update(real, this.fighters);
    }

    if (this.fighters.red) this.fighters.red.update(show, time);
    if (this.fighters.blue) this.fighters.blue.update(show, time);
    this.slip.update(show, this.camera);
    this.arena.update(real, time, this.excitement, this.camera);

    this.renderer.render(this.scene, this.camera);
  }

  // 느린 기기에서는 해상도를 먼저 내준다 — 연출은 그대로 두고 픽셀만 줄인다
  autoQuality(real) {
    this.fpsAvg = this.fpsAvg ? this.fpsAvg * 0.94 + (1 / Math.max(0.001, real)) * 0.06 : 60;
    this.qCooldown = (this.qCooldown || 0) - real;
    if (this.qCooldown > 0) return;
    const cur = this.renderer.getPixelRatio();
    if (this.fpsAvg < 24 && cur > 0.65) {
      this.renderer.setPixelRatio(Math.max(0.65, cur - 0.35));
      this.qCooldown = 3;
    } else if (this.fpsAvg > 55 && cur < Math.min(devicePixelRatio, 2) - 0.01) {
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2, cur + 0.35));
      this.qCooldown = 5;
    }
  }

  updateClock() {
    const evs = this.match.events;
    // 직전/다음 이벤트의 경기 시계를 재생 위치로 보간한다
    let prev = null;
    let next = null;
    for (let i = Math.max(0, this.cursor - 1); i >= 0; i--) {
      if (evs[i].clock !== undefined) {
        prev = evs[i];
        break;
      }
    }
    for (let i = this.cursor; i < evs.length; i++) {
      if (evs[i].clock !== undefined) {
        next = evs[i];
        break;
      }
    }
    let c = this.displayClock;
    if (prev && next && next.t > prev.t) {
      const u = Math.min(1, Math.max(0, (this.playT - prev.t) / (next.t - prev.t)));
      c = prev.clock + (next.clock - prev.clock) * u;
    } else if (prev) {
      c = prev.clock;
    }
    this.displayClock = c;
    this.hud.setClock(c);
  }
}

const game = new Game();
if (game.autostart) game.start();
