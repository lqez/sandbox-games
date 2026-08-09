// 방송 그래픽 — 스코어버그, 로어서드(발췌 자막), 해설 티커, 리플레이 와이프, 판정 스코어카드.
// 3D 위에 얹히는 DOM 레이어. 폰트/줄바꿈은 브라우저에 맡기는 게 캔버스보다 훨씬 낫다.

import { deriveStats } from './books.js';
import { drawCover } from './cover.js';
import { ROUND_SECONDS } from './match.js';

const $ = (sel, root = document) => root.querySelector(sel);

function fmtClock(s) {
  const m = Math.floor(Math.max(0, s) / 60);
  const sec = Math.floor(Math.max(0, s) % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export class Hud {
  constructor() {
    this.el = {
      screens: {
        setup: $('#screen-setup'),
        tape: $('#screen-tape'),
        result: $('#screen-result'),
      },
      scorebug: $('#scorebug'),
      redName: $('#red-name'),
      blueName: $('#blue-name'),
      redSub: $('#red-sub'),
      blueSub: $('#blue-sub'),
      redHp: $('#red-hp'),
      blueHp: $('#blue-hp'),
      redSt: $('#red-st'),
      blueSt: $('#blue-st'),
      redKd: $('#red-kd'),
      blueKd: $('#blue-kd'),
      clock: $('#clock'),
      lower: $('#lower-third'),
      lowerBar: $('#lt-bar'),
      lowerMove: $('#lt-move'),
      lowerQuote: $('#lt-quote'),
      lowerSource: $('#lt-source'),
      banner: $('#banner'),
      bannerMain: $('#banner-main'),
      bannerSub: $('#banner-sub'),
      ticker: $('#ticker'),
      replay: $('#replay-flag'),
      roster: $('#roster'),
      seedInput: $('#seed-input'),
      tapeBody: $('#tape-body'),
      resultBody: $('#result-body'),
      pickRed: $('#pick-red'),
      pickBlue: $('#pick-blue'),
      slowmo: $('#slowmo-flag'),
      flash: $('#flash'),
      debate: $('#debate'),
      rowTaunt: $('#drow-taunt'),
      rowReply: $('#drow-reply'),
      dtCover: $('#dt-cover'),
      dtWho: $('#dt-who'),
      dtTag: $('#dt-tag'),
      dtLine: $('#dt-line'),
      drCover: $('#dr-cover'),
      drWho: $('#dr-who'),
      drVerdict: $('#dr-verdict'),
      drLine: $('#dr-line'),
    };
    this.coverCache = new Map();
    this.tickerLines = [];
  }

  coverURL(book) {
    if (!this.coverCache.has(book.id)) {
      this.coverCache.set(book.id, drawCover(book).toDataURL('image/webp', 0.82));
    }
    return this.coverCache.get(book.id);
  }

  showScreen(name) {
    for (const [k, el] of Object.entries(this.el.screens)) {
      el.classList.toggle('on', k === name);
    }
    document.body.classList.toggle('in-fight', name === 'fight');
    this.el.scorebug.classList.toggle('on', name === 'fight');
  }

  // ── 파이터 선택 ─────────────────────────────────────────
  buildRoster(books, state, onChange) {
    const r = this.el.roster;
    r.innerHTML = '';
    for (const b of books) {
      const d = deriveStats(b);
      const card = document.createElement('button');
      card.className = 'fcard';
      card.dataset.id = b.id;
      card.innerHTML = `
        <img class="fcover" alt="${b.title} 표지" src="${this.coverURL(b)}">
        <div class="fmeta">
          <div class="ftitle">${b.title}</div>
          <div class="fauthor">${b.author}</div>
          <div class="fbadges">
            <span class="badge" style="--c:${d.weight.color}">${d.weight.name}</span>
            <span class="badge ghost">${b.pages}쪽</span>
          </div>
        </div>
        <span class="corner-tag red">RED</span>
        <span class="corner-tag blue">BLUE</span>`;
      card.addEventListener('click', () => onChange(b.id));
      r.appendChild(card);
    }
    this.syncRoster(state);
  }

  syncRoster(state) {
    for (const card of this.el.roster.children) {
      card.classList.toggle('sel-red', card.dataset.id === state.red);
      card.classList.toggle('sel-blue', card.dataset.id === state.blue);
    }
  }

  setPickLabels(redBook, blueBook) {
    const line = (b, corner) =>
      b
        ? `<img src="${this.coverURL(b)}" alt=""><div><b>${b.title}</b><small>${b.author} · ${b.pages}쪽</small></div>`
        : `<div class="empty">${corner} 코너 — 책을 고르세요</div>`;
    this.el.pickRed.innerHTML = line(redBook, '레드');
    this.el.pickBlue.innerHTML = line(blueBook, '블루');
  }

  // ── 계체량 / 전력 비교표 ────────────────────────────────
  renderTape(a, b, seed, rivalry, cond) {
    const da = deriveStats(a);
    const db = deriveStats(b);
    const rows = [
      ['분량', `${a.pages}쪽`, `${b.pages}쪽`, a.pages, b.pages],
      ['계체량', `${da.weighIn}kg`, `${db.weighIn}kg`, a.pages, b.pages],
      ['체급', da.weight.name, db.weight.name, 0, 0],
      ['출간', a.yearLabel || `${a.year}년`, b.yearLabel || `${b.year}년`, 0, 0],
      ['국적', a.nation, b.nation, 0, 0],
      ['장르', a.genre, b.genre, 0, 0],
      ['체력', da.hpMax, db.hpMax, da.hpMax, db.hpMax],
      ['논지', da.logic, db.logic, da.logic, db.logic],
      ['문체', da.style, db.style, da.style, db.style],
      ['관록', da.legacy, db.legacy, da.legacy, db.legacy],
      ['광기', da.chaos, db.chaos, da.chaos, db.chaos],
      ['뚝심', da.grit, db.grit, da.grit, db.grit],
      ['기동', da.speed, db.speed, da.speed, db.speed],
    ];
    const condRow = cond
      ? `<div class="tape-row cond">
           <div class="tv left ${cond.red > cond.blue ? 'win' : ''}">${(cond.red * 100 - 100).toFixed(1)}%</div>
           <div class="tl">시드 컨디션</div>
           <div class="tv right ${cond.blue > cond.red ? 'win' : ''}">${(cond.blue * 100 - 100).toFixed(1)}%</div>
         </div>`
      : '';

    this.el.tapeBody.innerHTML = `
      <div class="tape-head">
        <div class="th red">
          <img src="${this.coverURL(a)}" alt="">
          <div class="tn">${a.title}</div>
          <div class="tnick">"${a.nickname}"</div>
          <div class="tauth">${a.author}</div>
        </div>
        <div class="th-mid">
          <div class="vs">VS</div>
          <div class="seedline">SEED <b>${seed}</b></div>
          <div class="roundline">1 RD · 5:00 · 단판</div>
        </div>
        <div class="th blue">
          <img src="${this.coverURL(b)}" alt="">
          <div class="tn">${b.title}</div>
          <div class="tnick">"${b.nickname}"</div>
          <div class="tauth">${b.author}</div>
        </div>
      </div>
      ${rivalry ? `<div class="rivalry">⚔ ${rivalry.why}</div>` : ''}
      <div class="tape-rows">
        ${rows
          .map(([label, va, vb, na, nb]) => {
            const wa = na > nb ? 'win' : '';
            const wb = nb > na ? 'win' : '';
            return `<div class="tape-row">
              <div class="tv left ${wa}">${va}</div>
              <div class="tl">${label}</div>
              <div class="tv right ${wb}">${vb}</div>
            </div>`;
          })
          .join('')}
        ${condRow}
      </div>
      <div class="traits">
        <div class="trait red"><b>${a.authorTrait.name}</b><span>${a.authorTrait.desc}</span></div>
        <div class="trait blue"><b>${b.authorTrait.name}</b><span>${b.authorTrait.desc}</span></div>
      </div>`;
  }

  // ── 스코어버그 ─────────────────────────────────────────
  setFighters(a, b) {
    this.el.redName.textContent = a.title;
    this.el.blueName.textContent = b.title;
    const da = deriveStats(a);
    const db = deriveStats(b);
    this.el.redSub.textContent = `${a.author} · ${a.pages}쪽 · ${da.weight.name}`;
    this.el.blueSub.textContent = `${b.author} · ${b.pages}쪽 · ${db.weight.name}`;
    this.max = { red: da.hpMax, blue: db.hpMax, redSt: da.stMax, blueSt: db.stMax };
    this.el.redKd.textContent = '';
    this.el.blueKd.textContent = '';
  }

  updateBars(hp, st) {
    const set = (el, v, max) => {
      const p = Math.max(0, Math.min(1, v / max));
      el.style.width = (p * 100).toFixed(1) + '%';
      el.classList.toggle('low', p < 0.3);
      el.classList.toggle('crit', p < 0.14);
    };
    set(this.el.redHp, hp.red, this.max.red);
    set(this.el.blueHp, hp.blue, this.max.blue);
    if (st) {
      set(this.el.redSt, st.red, this.max.redSt);
      set(this.el.blueSt, st.blue, this.max.blueSt);
    }
  }

  setKnockdowns(corner, n) {
    const el = corner === 'red' ? this.el.redKd : this.el.blueKd;
    el.textContent = n > 0 ? '● '.repeat(n).trim() : '';
  }

  setClock(sec) {
    this.el.clock.textContent = fmtClock(sec);
    this.el.clock.classList.toggle('urgent', sec <= 60);
  }

  // ── 설전 패널 ───────────────────────────────────────────
  // 도발과 반박을 같은 화면에 남겨둔다. 한쪽씩 사라지면 언쟁이 아니라 독백으로 읽힌다.
  showTaunt(ev, book) {
    const r = this.el.rowTaunt;
    this.el.rowReply.classList.remove('on');
    this.el.dtCover.src = this.coverURL(book);
    this.el.dtWho.textContent = ev.speaker;
    this.el.dtTag.textContent = '#' + ev.tag + (ev.rival ? ' · 지목' : '');
    this.el.dtLine.textContent = '「' + ev.line + '」';
    r.className = 'drow on ' + ev.by;
  }

  showReply(ev, book) {
    const r = this.el.rowReply;
    this.el.rowTaunt.classList.add('dim'); // 방금 한 말은 남기되 흐리게
    this.el.drCover.src = this.coverURL(book);
    this.el.drWho.textContent = ev.speaker;
    this.el.drVerdict.textContent = ev.rebutted ? '논파' : '되받지 못함';
    this.el.drVerdict.className = 'dverdict ' + (ev.rebutted ? 'win' : 'lose');
    this.el.drLine.textContent = '「' + ev.line + '」';
    r.className = 'drow on ' + ev.by;
  }

  clearDebate() {
    this.el.rowTaunt.className = 'drow';
    this.el.rowReply.className = 'drow';
  }

  // ── 발췌 자막(로어서드) ─────────────────────────────────
  showQuote(ev, book) {
    const el = this.el.lower;
    el.classList.remove('on');
    // 리플로우 강제 — 연속 타격에서 애니메이션이 다시 걸리게
    void el.offsetWidth;
    el.classList.add('on');
    el.dataset.corner = ev.by;
    this.el.lowerBar.style.background = book.cover.accent;
    const label = ev.finisherName ? `피니시 · ${ev.finisherName}` : `${ev.moveLabel} · ${ev.moveKr}`;
    this.el.lowerMove.textContent = label;
    this.el.lowerMove.className = 'lt-move ' + (ev.crit ? 'crit' : '') + (ev.move === 'finisher' ? ' fin' : '');
    this.el.lowerQuote.textContent = `「${ev.quote}」`;
    this.el.lowerSource.textContent = `— ${book.title}, ${book.author}`;
    clearTimeout(this._ltTimer);
    this._ltTimer = setTimeout(() => el.classList.remove('on'), ev.move === 'finisher' ? 4200 : 3000);
  }

  hideQuote() {
    this.el.lower.classList.remove('on');
  }

  // ── 큰 배너 ────────────────────────────────────────────
  banner(main, sub, kind = '', ms = 1600) {
    const el = this.el.banner;
    el.className = 'banner on ' + kind;
    this.el.bannerMain.textContent = main;
    this.el.bannerSub.textContent = sub || '';
    clearTimeout(this._bTimer);
    if (ms > 0) this._bTimer = setTimeout(() => el.classList.remove('on'), ms);
  }
  hideBanner() {
    this.el.banner.classList.remove('on');
  }

  // ── 해설 티커 ──────────────────────────────────────────
  commentary(text, tone = 'calm') {
    this.tickerLines.unshift({ text, tone });
    if (this.tickerLines.length > 3) this.tickerLines.pop();
    this.el.ticker.innerHTML = this.tickerLines
      .map((l, i) => `<div class="tline ${l.tone} ${i === 0 ? 'fresh' : ''}">${l.text}</div>`)
      .join('');
  }
  clearTicker() {
    this.tickerLines = [];
    this.el.ticker.innerHTML = '';
  }

  setReplay(on) {
    this.el.replay.classList.toggle('on', on);
  }
  setSlowmo(on) {
    this.el.slowmo.classList.toggle('on', on);
  }

  flash(strength = 1) {
    const f = this.el.flash;
    f.style.transition = 'none';
    f.style.opacity = String(Math.min(0.55, strength * 0.4));
    requestAnimationFrame(() => {
      f.style.transition = 'opacity .32s ease-out';
      f.style.opacity = '0';
    });
  }

  damagePop(corner, dmg, crit) {
    const host = corner === 'red' ? this.el.redHp.parentElement : this.el.blueHp.parentElement;
    const p = document.createElement('span');
    p.className = 'dmg-pop' + (crit ? ' crit' : '');
    p.textContent = `-${dmg}`;
    host.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }

  // ── 결과 ───────────────────────────────────────────────
  showResult(match) {
    const w = match.result.winner;
    const winBook = w === 'red' ? match.a : match.b;
    const loseBook = w === 'red' ? match.b : match.a;
    const dec = match.events.find((e) => e.type === 'decision');

    const statRow = (label, va, vb) => `
      <div class="rs-row"><div class="rv ${va >= vb ? 'win' : ''}">${va}</div><div class="rl">${label}</div><div class="rv ${vb >= va ? 'win' : ''}">${vb}</div></div>`;

    const red = match.fighters.red;
    const blue = match.fighters.blue;

    this.el.resultBody.innerHTML = `
      <div class="winner-wrap ${w}">
        <img class="wcover" src="${this.coverURL(winBook)}" alt="">
        <div class="wtext">
          <div class="wlabel">${w === 'red' ? 'RED' : 'BLUE'} 코너 · 승리</div>
          <h2>${winBook.title}</h2>
          <div class="wauth">${winBook.author} · ${winBook.pages}쪽</div>
          <div class="wmethod">${match.result.method}</div>
          ${match.result.detail ? `<div class="wdetail">${match.result.detail}</div>` : ''}
        </div>
      </div>
      ${
        dec
          ? `<div class="cards">
              ${dec.cards
                .map(
                  (c) =>
                    `<div class="jcard"><span>${c.judge}</span><b class="${c.red > c.blue ? 'w' : ''}">${c.red}</b>–<b class="${c.blue > c.red ? 'w' : ''}">${c.blue}</b></div>`
                )
                .join('')}
             </div>`
          : ''
      }
      <div class="rs-head"><span>${match.a.title}</span><span class="rs-vs">기록</span><span>${match.b.title}</span></div>
      <div class="rs">
        ${statRow('유효타', red.stats.landed, blue.stats.landed)}
        ${statRow('시도', red.stats.thrown, blue.stats.thrown)}
        ${statRow('명중률', pct(red.stats), pct(blue.stats))}
        ${statRow('누적 피해', red.stats.dmg, blue.stats.dmg)}
        ${statRow('치명타', red.stats.crit, blue.stats.crit)}
        ${statRow('회피', red.stats.evaded, blue.stats.evaded)}
        ${statRow('다운', red.knockdowns, blue.knockdowns)}
        ${statRow('남은 체력', `${red.hpEnd}/${red.hpMax}`, `${blue.hpEnd}/${blue.hpMax}`)}
      </div>
      <div class="loser-line">패: <b>${loseBook.title}</b> — ${loseBook.author}</div>
      <div class="seed-note">SEED <b>${match.seed}</b> · 같은 시드는 언제나 같은 경기가 나옵니다. 시드를 바꾸면 승자도 바뀔 수 있습니다.</div>`;

    function pct(s) {
      return s.thrown ? Math.round((s.landed / s.thrown) * 100) + '%' : '0%';
    }
  }
}

export { ROUND_SECONDS };
