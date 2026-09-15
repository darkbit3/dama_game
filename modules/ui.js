/* ═══════════════════════════════════════════════════
   MODULE: ui.js
   Handles: Loading screen, particles, bet bar,
            color picker, player list, ripple effects,
            countdown timer
═══════════════════════════════════════════════════ */

import { tgHaptic } from './telegram.js';
import { PlayerRegistry, seedDemoPlayers, fetchWithToken } from './registry.js';
import { getState, setState } from './state.js';

/* ── Loading screen ── */
export function initLoader(onDone, waitFor = null) {
  const fill    = document.getElementById('progressFill');
  const percent = document.getElementById('loaderPercent');
  const loader  = document.getElementById('loader');
  const menu    = document.getElementById('mainMenu');

  function ease(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  const duration = 2200;
  const interval = 30;
  const steps    = duration / interval;
  let step = 0;

  let progressComplete = false;
  let authSettled = false;
  let finished = false;

  function finishLoader(showMenu) {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    setTimeout(() => {
      loader.classList.add('fade-out');
      setTimeout(() => {
        loader.style.display = 'none';
        if (showMenu) {
          menu.classList.remove('hidden');
          if (typeof onDone === 'function') onDone();
        }
      }, 700);
    }, 250);
  }

  function maybeFinishLoader() {
    if (progressComplete && authSettled) finishLoader(true);
  }

  const timer = setInterval(() => {
    step++;
    const progress = Math.min(100, Math.round(ease(step / steps) * 100));
    fill.style.width    = progress + '%';
    percent.textContent = progress + '%';

    if (progress >= 100) {
      progressComplete = true;
      maybeFinishLoader();
    }
  }, interval);

  if (waitFor) {
    Promise.resolve(waitFor).then(() => {
      authSettled = true;
      maybeFinishLoader();
    }, () => {
      finishLoader(false);
    });
  } else {
    authSettled = true;
  }
}

/* ── Particles ── */
export function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const particles = Array.from({ length: 40 }, () => {
    const p = {};
    resetParticle(p, true, canvas);
    return p;
  });

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.life++;
      if (p.fadeIn) {
        p.alpha += 0.02;
        if (p.alpha >= p.ta) { p.alpha = p.ta; p.fadeIn = false; }
      }
      if (p.life > p.maxLife) {
        p.alpha -= 0.015;
        if (p.alpha <= 0) resetParticle(p, false, canvas);
      }
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle   = '#d4a017';
      ctx.shadowColor = '#f0c94a';
      ctx.shadowBlur  = 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    requestAnimationFrame(loop);
  }
  loop();
}

function resetParticle(p, init, canvas) {
  p.x      = Math.random() * canvas.width;
  p.y      = init ? Math.random() * canvas.height : canvas.height + 5;
  p.r      = Math.random() * 1.8 + 0.4;
  p.vx     = (Math.random() - 0.5) * 0.35;
  p.vy     = -(Math.random() * 0.45 + 0.15);
  p.alpha  = 0;
  p.ta     = Math.random() * 0.35 + 0.08;
  p.fadeIn = true;
  p.life   = 0;
  p.maxLife = Math.random() * 180 + 120;
}

export function getCurrentBalanceValue() {
  const rawBalance = window.DAMA_BALANCE ?? getState('damaBalance');
  if (rawBalance === null || rawBalance === undefined || rawBalance === '') return null;
  const balance = Number(rawBalance);
  return Number.isFinite(balance) ? balance : null;
}

export function getBetButtonDisabledState(amount, balance = null) {
  const currentBalance = balance ?? getCurrentBalanceValue();
  if (currentBalance === null || currentBalance === undefined) return true;
  return Number(amount) > Number(currentBalance);
}

export function updateBetBarState() {
  const balanceEl = document.getElementById('betBalanceValue');
  const balance = getCurrentBalanceValue();
  if (balanceEl) {
    balanceEl.textContent = balance === null ? '—' : Number(balance).toLocaleString();
  }

  const presets = document.querySelectorAll('.bet-preset');
  presets.forEach(btn => {
    const amount = Number(btn.dataset.amount || 0);
    const disabled = getBetButtonDisabledState(amount, balance);
    btn.disabled = disabled;
    btn.classList.toggle('disabled', disabled);
    btn.classList.toggle('active', !disabled && btn.classList.contains('active'));
  });
}

/* ── Bet bar ── */
export function initBetBar() {
  const presets = document.querySelectorAll('.bet-preset');

  // No default — player must explicitly select
  setState('currentBet', 0);
  setState('playerReady', false);

  function clearReadySelection() {
    presets.forEach(b => b.classList.remove('active'));
    setState('currentBet', 0);
    setState('playerReady', false);
    const list = PlayerRegistry.load();
    const me   = list.find(p => p.id === getState('tgUserId'));
    if (me) { me.isReady = false; PlayerRegistry.save(list); }
    if (getState('tgUserId')) {
      PlayerRegistry.clearReadyOnBackend(getState('tgUserId')).then(() => renderPlayerList());
    } else { renderPlayerList(); }
  }

  function onBetSelected(amt) {
    const currentBalance = getCurrentBalanceValue();
    if (amt > currentBalance) {
      alert('Insufficient balance for this bet.');
      clearReadySelection();
      return false;
    }

    setState('currentBet', amt);
    setState('playerReady', true);
    const list = PlayerRegistry.load();
    const me   = list.find(p => p.id === getState('tgUserId'));
    if (me) { me.bet = amt; me.isReady = true; PlayerRegistry.save(list); }
    if (getState('tgUserId')) {
      PlayerRegistry.setReadyOnBackend(getState('tgUserId'), amt).then(() => renderPlayerList());
    } else { renderPlayerList(); }
    tgHaptic('light');
    return true;
  }

  presets.forEach(btn => {
    btn.addEventListener('click', () => {
      const amt = parseInt(btn.dataset.amount, 10);
      if (Number.isNaN(amt)) return;
      presets.forEach(b => b.classList.remove('active'));
      if (!btn.disabled) {
        btn.classList.add('active');
        onBetSelected(amt);
      }
    });
  });

  window.addEventListener('dama-balance-changed', updateBetBarState);
  updateBetBarState();
}

/* ── Piece / Ball colour themes (15 colors, some premium) ── */
export const PIECE_THEMES = [
  { id:'classic', name:'Classic',  free:true,  c1:'#8a8a8a', c2:'#3a3a3a', c3:'#111',    border:'rgba(255,255,255,.1)',  shadow:'rgba(255,255,255,.22)' },
  { id:'fire',    name:'Fire',     free:true,  c1:'#ff6b35', c2:'#c0392b', c3:'#7b0000', border:'rgba(255,200,0,.3)',    shadow:'rgba(255,200,0,.5)' },
  { id:'ocean',   name:'Ocean',    free:true,  c1:'#29b6f6', c2:'#0277bd', c3:'#01579b', border:'rgba(100,200,255,.3)',  shadow:'rgba(100,220,255,.5)' },
  { id:'forest',  name:'Forest',   free:true,  c1:'#66bb6a', c2:'#2e7d32', c3:'#0a2e0d', border:'rgba(100,220,100,.3)',  shadow:'rgba(150,255,150,.4)' },
  { id:'royal',   name:'Royal',    free:true,  c1:'#ab47bc', c2:'#6a1b9a', c3:'#1a0030', border:'rgba(200,100,255,.3)',  shadow:'rgba(220,150,255,.4)' },
  { id:'gold',    name:'Gold',     free:true,  c1:'#ffd54f', c2:'#f9a825', c3:'#5d4400', border:'rgba(240,200,70,.4)',   shadow:'rgba(255,240,100,.6)' },
  { id:'rose',    name:'Rose',     free:true,  c1:'#f48fb1', c2:'#c2185b', c3:'#6a0033', border:'rgba(255,150,180,.3)',  shadow:'rgba(255,180,200,.5)' },
  { id:'ice',     name:'Ice',      free:true,  c1:'#e0f7fa', c2:'#80deea', c3:'#00838f', border:'rgba(200,240,255,.5)',  shadow:'rgba(220,250,255,.7)' },
  { id:'lava',    name:'Lava',     free:false, price:50,  c1:'#ffcc02', c2:'#ff6600', c3:'#1a0000', border:'rgba(255,120,0,.5)',    shadow:'rgba(255,80,0,.7)' },
  { id:'mint',    name:'Mint',     free:false, price:50,  c1:'#a5d6a7', c2:'#00897b', c3:'#00251a', border:'rgba(100,220,180,.3)',  shadow:'rgba(150,255,220,.4)' },
  { id:'dusk',    name:'Dusk',     free:false, price:50,  c1:'#b0bec5', c2:'#546e7a', c3:'#102027', border:'rgba(180,200,210,.2)',  shadow:'rgba(200,220,230,.3)' },
  { id:'ruby',    name:'Ruby',     free:false, price:100, c1:'#ef9a9a', c2:'#b71c1c', c3:'#3b0000', border:'rgba(255,100,100,.4)',  shadow:'rgba(255,80,80,.55)' },
  { id:'cosmic',  name:'Cosmic',   free:false, price:100, c1:'#7986cb', c2:'#283593', c3:'#000033', border:'rgba(130,150,255,.4)',  shadow:'rgba(150,160,255,.5)' },
  { id:'copper',  name:'Copper',   free:false, price:150, c1:'#ffab76', c2:'#bf360c', c3:'#3e0000', border:'rgba(220,120,60,.4)',   shadow:'rgba(255,150,80,.5)' },
  { id:'venom',   name:'Venom',    free:false, price:200, c1:'#aeea00', c2:'#33691e', c3:'#000a00', border:'rgba(180,255,0,.4)',    shadow:'rgba(200,255,50,.55)' },
];

/* ── Ball style types (8, each with shape + finish, some premium) ── */
export const BALL_STYLES = [
  { id:'solid',   name:'Solid',   desc:'Classic disc',    free:true,  shape:'gp-shape-disc',
    modify: t => ({ ...t }) },
  { id:'dome',    name:'Dome',    desc:'Raised dome',     free:true,  shape:'gp-shape-dome',
    modify: t => ({ ...t, c1: blend(t.c1,'#fff',.25), shadow: blend(t.shadow||t.c1,'#fff',.2) }) },
  { id:'neon',    name:'Neon',    desc:'Glowing ring',    free:true,  shape:'gp-shape-neon',
    modify: t => ({ ...t, border: t.c1, shadow: t.c1, c3:'#000' }) },
  { id:'metal',   name:'Metal',   desc:'Brushed chrome',  free:false, price:80,  shape:'gp-shape-metal',
    modify: t => ({ ...t, c1: blend(t.c1,'#fff',.5), c2: blend(t.c2,'#aaa',.3), c3:'#0a0a0a',
      border:'rgba(255,255,255,.3)', shadow:'rgba(255,255,255,.65)' }) },
  { id:'wood',    name:'Wood',    desc:'Carved wood',     free:false, price:80,  shape:'gp-shape-wood',
    modify: t => ({ ...t, c1: blend(t.c1,'#d4a017',.45), c2: blend(t.c2,'#7b4f12',.5),
      c3:'#2b1500', border:'rgba(180,120,40,.4)', shadow:'rgba(220,160,60,.5)' }) },
  { id:'crystal', name:'Crystal', desc:'Glass crystal',   free:false, price:120, shape:'gp-shape-crystal',
    modify: t => ({ ...t, c1: blend(t.c1,'#fff',.6), c2: blend(t.c2,'#fff',.3),
      border: blend(t.c1,'#fff',.3)+'bb', shadow:'rgba(255,255,255,.8)' }) },
  { id:'shadow',  name:'Shadow',  desc:'Dark phantom',    free:false, price:120, shape:'gp-shape-shadow',
    modify: t => ({ ...t, c1: blend(t.c1,'#000',.55), c2: blend(t.c2,'#000',.65), c3:'#000',
      border:'rgba(0,0,0,.6)', shadow: t.c1+'66' }) },
  { id:'marble',  name:'Marble',  desc:'Stone marble',    free:false, price:150, shape:'gp-shape-marble',
    modify: t => ({ ...t, c2: blend(t.c2,'#d0c8b8',.4),
      border: t.border, shadow:'rgba(255,255,255,.5)' }) },
  { id:'pawn',    name:'Pawn',    desc:'Chess pawn',      free:false, price:200, shape:'gp-shape-pawn',
    modify: t => ({ ...t }) },
  { id:'hex',     name:'Hex',     desc:'Hexagon tile',    free:false, price:200, shape:'gp-shape-hex',
    modify: t => ({ ...t }) },
  { id:'star',    name:'Star',    desc:'Star shape',      free:false, price:250, shape:'gp-shape-star',
    modify: t => ({ ...t }) },
  { id:'diamond', name:'Diamond', desc:'Diamond cut',     free:false, price:250, shape:'gp-shape-diamond',
    modify: t => ({ ...t, c1: blend(t.c1,'#fff',.45), shadow:'rgba(255,255,255,.9)' }) },
];

let _pendingTheme = null;
let _pendingStyle = 'solid';

function blend(hex, target, amt) {
  const toRgb = h => {
    if (h.startsWith('rgb')) {
      const m = h.match(/\d+/g);
      return m ? [+m[0],+m[1],+m[2]] : [128,128,128];
    }
    const c = h.replace('#','');
    if (c.length < 6) return [128,128,128];
    return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
  };
  const tMap = {'#fff':[255,255,255],'#ffffff':[255,255,255],'#000':[0,0,0],'#000000':[0,0,0],
    '#aaa':[170,170,170],'#888':[136,136,136]};
  const t = tMap[target] || toRgb(target);
  try {
    const s = toRgb(hex);
    const r = Math.round(s[0]+(t[0]-s[0])*amt);
    const g = Math.round(s[1]+(t[1]-s[1])*amt);
    const b = Math.round(s[2]+(t[2]-s[2])*amt);
    return `rgb(${r},${g},${b})`;
  } catch { return hex; }
}

/* ── Ownership helpers ── */
async function fetchOwnedFromBackend() {
  if (!getState('tgUserId')) return;
  try {
    const { apiUrl } = await import('./socket.js');
    const res = await fetchWithToken(`${apiUrl}/players/${getState('tgUserId')}/owned`);
    if (res.ok) {
      const data = await res.json();
      const items = data.data || [];
      // Merge with existing localStorage owned list
      const existing = JSON.parse(localStorage.getItem('dama_owned') || '[]');
      const merged = [...new Set([...existing, ...items])];
      localStorage.setItem('dama_owned', JSON.stringify(merged));
    }
  } catch { /* silent */ }
}

function isOwned(item) {
  if (item.free) return true;
  const owned = JSON.parse(localStorage.getItem('dama_owned') || '[]');
  return owned.includes(item.id);
}

function showPurchaseToast(item) {
  document.getElementById('cpPurchaseToast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'cpPurchaseToast';
  toast.className = 'cp-purchase-toast';
  toast.innerHTML = `
    <div class="cpt-info">
      <span class="cpt-lock">🔒</span>
      <div>
        <div class="cpt-name">${item.name}</div>
        <div class="cpt-price">⏳ Coming Soon</div>
      </div>
    </div>
  `;
  const box = document.querySelector('.cp-modal-box');
  if (box) box.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('cpt-show'));
  setTimeout(() => { toast?.remove(); }, 3000);
}

export function getStyleShape(styleId) {
  return (BALL_STYLES.find(s => s.id === styleId) || BALL_STYLES[0]).shape;
}

export function applyStyleToTheme(theme, styleId) {
  const style = BALL_STYLES.find(s => s.id === styleId) || BALL_STYLES[0];
  const t = style.modify(theme);
  t._shape = style.shape;   // carry shape through
  return t;
}

function ballInlineStyle(t) {
  return `background:radial-gradient(circle at 35% 30%,${t.c1},${t.c2} 55%,${t.c3});` +
         `border:1.5px solid ${t.border};` +
         `box-shadow:inset 0 1px 6px ${t.shadow},0 3px 10px rgba(0,0,0,.6);`;
}

function updateTriggerBall(theme) {
  const ball = document.getElementById('cpTriggerBall');
  if (ball) ball.style.cssText = ballInlineStyle(theme);
}

export function initColorPicker() {
  // Sync owned items from backend (async, non-blocking)
  fetchOwnedFromBackend().then(() => {
    buildColorGrid(); buildStyleGrid();
    refreshColorGrid(); refreshStyleGrid();
  });

  // Restore saved theme + style
  const savedThemeId = localStorage.getItem('dama_piece_theme') || 'classic';
  const savedStyleId = localStorage.getItem('dama_piece_style') || 'solid';
  const baseTheme = PIECE_THEMES.find(t => t.id === savedThemeId) || PIECE_THEMES[0];
  const composed = applyStyleToTheme(baseTheme, savedStyleId);
  _pendingTheme = baseTheme;
  _pendingStyle = savedStyleId;
  setState('pieceTheme',    composed);
  setState('pieceThemeId',  savedThemeId);
  setState('pieceStyleId',  savedStyleId);
  applyPieceTheme(composed);
  updateTriggerBall(composed);

  // ── Trigger button (3-dot) ──
  const trigger = document.getElementById('cpTrigger');
  const modal   = document.getElementById('cpModal');
  if (!trigger || !modal) return;

  trigger.addEventListener('click', () => {
    tgHaptic('light');
    _pendingTheme = PIECE_THEMES.find(t => t.id === getState('pieceThemeId')) || PIECE_THEMES[0];
    _pendingStyle = getState('pieceStyleId') || 'solid';
    openCpModal();
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeCpModal();
  });

  document.getElementById('cpModalClose')?.addEventListener('click', closeCpModal);

  // Tabs
  document.querySelectorAll('.cp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cp-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const panel = tab.dataset.tab;
      document.getElementById('cpPanelColors').classList.toggle('hidden', panel !== 'colors');
      document.getElementById('cpPanelStyle').classList.toggle('hidden',  panel !== 'style');
      tgHaptic('light');
    });
  });

  // Set button
  document.getElementById('cpSetBtn')?.addEventListener('click', () => {
    // Guard: ensure pending theme & style are owned
    if (!isOwned(_pendingTheme)) { showPurchaseToast(_pendingTheme); tgHaptic('warning'); return; }
    const pendingStyleObj = BALL_STYLES.find(s => s.id === _pendingStyle) || BALL_STYLES[0];
    if (!isOwned(pendingStyleObj)) { showPurchaseToast(pendingStyleObj); tgHaptic('warning'); return; }

    const composed = applyStyleToTheme(_pendingTheme, _pendingStyle);
    setState('pieceTheme',    composed);
    setState('pieceThemeId',  _pendingTheme.id);
    setState('pieceStyleId',  _pendingStyle);
    localStorage.setItem('dama_piece_theme', _pendingTheme.id);
    localStorage.setItem('dama_piece_style', _pendingStyle);
    applyPieceTheme(composed);
    updateTriggerBall(composed);
    updateCurrentStyleLabel();
    // notify app.js listener via state (bridge keeps window.onPieceThemeChanged in sync)
    if (typeof window.onPieceThemeChanged === 'function') window.onPieceThemeChanged(composed);
    renderPlayerList();
    tgHaptic('success');
    closeCpModal();
  });

  buildColorGrid();
  buildStyleGrid();
}

function openCpModal() {
  const modal = document.getElementById('cpModal');
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.classList.add('cp-modal-open'));
  refreshPreview();
  refreshColorGrid();
  refreshStyleGrid();
  // Reset to colors tab
  document.querySelectorAll('.cp-tab').forEach((t,i) => t.classList.toggle('active', i===0));
  updateCurrentStyleLabel();
  document.getElementById('cpPanelColors').classList.remove('hidden');
  document.getElementById('cpPanelStyle').classList.add('hidden');
}

function closeCpModal() {
  const modal = document.getElementById('cpModal');
  modal.classList.remove('cp-modal-open');
  setTimeout(() => modal.classList.add('hidden'), 280);
}

function refreshPreview() {
  const composed = applyStyleToTheme(_pendingTheme, _pendingStyle);
  const ball = document.getElementById('cpPreviewBall');
  const name = document.getElementById('cpPreviewName');
  const styleLbl = document.getElementById('cpPreviewStyle');
  if (ball) {
    ball.style.cssText = ballInlineStyle(composed);
    // update shape classes
    BALL_STYLES.forEach(s => ball.classList.remove(s.shape));
    ball.classList.add(composed._shape || 'gp-shape-disc');
  }
  if (name) name.textContent = _pendingTheme.name;
  if (styleLbl) styleLbl.textContent = (BALL_STYLES.find(s => s.id === _pendingStyle)||BALL_STYLES[0]).name;
  updateCurrentStyleLabel();
}

// Update the displayed current style label in the Colors tab
function updateCurrentStyleLabel() {
  const labelEl = document.getElementById('cpCurrentStyleLabel');
  if (labelEl) {
    const styleName = (BALL_STYLES.find(s => s.id === _pendingStyle) || BALL_STYLES[0]).name;
    labelEl.textContent = `Style: ${styleName}`;
  }
}

function buildColorGrid() {
  const grid = document.getElementById('cpColorGrid');
  if (!grid) return;
  grid.innerHTML = '';
  PIECE_THEMES.forEach(theme => {
    const owned = isOwned(theme);
    const item  = document.createElement('div');
    item.className = 'cp-grid-item' + (owned ? '' : ' cp-item-locked');
    item.dataset.id = theme.id;
    const composed = applyStyleToTheme(theme, _pendingStyle);
    item.innerHTML = `
      <span class="cp-grid-ball" style="${ballInlineStyle(composed)}"></span>
      <span class="cp-grid-name">${theme.name}</span>
      ${owned
        ? '<span class="cp-grid-check">✔</span>'
        : `<span class="cp-lock-badge">🔒 <span class="cp-lock-price">Soon</span></span>`}
    `;
    item.addEventListener('click', () => {
      if (!isOwned(theme)) { showPurchaseToast(theme); tgHaptic('warning'); return; }
      _pendingTheme = theme;
      tgHaptic('light');
      refreshPreview(); refreshColorGrid(); refreshStyleGrid();
    });
    grid.appendChild(item);
  });
}

function refreshColorGrid() {
  document.querySelectorAll('.cp-grid-item').forEach(item => {
    const owned  = !item.classList.contains('cp-item-locked');
    const active = item.dataset.id === _pendingTheme.id && owned;
    item.classList.toggle('cp-grid-item-active', active);
    const theme = PIECE_THEMES.find(t => t.id === item.dataset.id);
    if (theme) {
      const ball = item.querySelector('.cp-grid-ball');
      if (ball) ball.style.cssText = ballInlineStyle(applyStyleToTheme(theme, _pendingStyle));
    }
  });
}

/* Build an SVG/CSS shape preview element for the style grid */
function buildShapePreview(style, composed) {
  const el = document.createElement('span');
  el.className = 'cp-grid-ball ' + style.shape;

  // Special shapes: SVG-based
  if (style.id === 'pawn') {
    el.innerHTML = buildPawnSVG(composed.c1, composed.c2, composed.border);
    el.style.cssText = 'background:none;border:none;box-shadow:none;width:38px;height:48px;border-radius:0;';
    return el;
  }
  if (style.id === 'hex') {
    el.style.cssText = `
      width:38px;height:44px;border-radius:0;
      background:linear-gradient(160deg,${composed.c1},${composed.c2});
      clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
      box-shadow:0 3px 10px rgba(0,0,0,.6);`;
    return el;
  }
  if (style.id === 'star') {
    el.style.cssText = `
      width:38px;height:38px;border-radius:0;
      background:linear-gradient(135deg,${composed.c1},${composed.c2});
      clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);
      box-shadow:0 3px 10px rgba(0,0,0,.6);`;
    return el;
  }
  if (style.id === 'diamond') {
    el.style.cssText = `
      width:34px;height:34px;border-radius:0;
      background:linear-gradient(135deg,${composed.c1},${composed.c2},${composed.c3});
      clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);
      box-shadow:0 3px 10px rgba(0,0,0,.6);`;
    return el;
  }
  // Standard ball shapes
  el.style.cssText = ballInlineStyle(composed);
  return el;
}

function buildPawnSVG(c1, c2, border) {
  return `<svg viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg" width="38" height="48">
    <defs>
      <radialGradient id="pg" cx="40%" cy="30%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </radialGradient>
    </defs>
    <!-- Base -->
    <rect x="7" y="44" width="26" height="6" rx="3" fill="url(#pg)" stroke="${border}" stroke-width="1"/>
    <!-- Neck stem -->
    <rect x="16" y="30" width="8" height="14" rx="3" fill="url(#pg)" stroke="${border}" stroke-width="1"/>
    <!-- Head -->
    <circle cx="20" cy="22" r="11" fill="url(#pg)" stroke="${border}" stroke-width="1.5"/>
    <!-- Shine -->
    <ellipse cx="16" cy="17" rx="5" ry="3" fill="rgba(255,255,255,.3)" transform="rotate(-20,16,17)"/>
  </svg>`;
}

function buildStyleGrid() {
  const grid = document.getElementById('cpStyleGrid');
  if (!grid) return;
  grid.innerHTML = '';
  BALL_STYLES.forEach(style => {
    const owned = isOwned(style);
    const item  = document.createElement('div');
    item.className = 'cp-style-item' + (owned ? '' : ' cp-item-locked');
    item.dataset.id = style.id;
    const composed = applyStyleToTheme(_pendingTheme, style.id);
    const ballEl = buildShapePreview(style, composed);
    item.appendChild(ballEl);
    const nameEl = document.createElement('span');
    nameEl.className = 'cp-grid-name'; nameEl.textContent = style.name;
    const descEl = document.createElement('span');
    descEl.className = 'cp-style-desc'; descEl.textContent = style.desc;
    item.appendChild(nameEl); item.appendChild(descEl);
    if (owned) {
      const chk = document.createElement('span');
      chk.className = 'cp-grid-check'; chk.textContent = '✔';
      item.appendChild(chk);
    } else {
      const lk = document.createElement('span');
      lk.className = 'cp-lock-badge';
      lk.innerHTML = `🔒 <span class="cp-lock-price">Soon</span>`;
      item.appendChild(lk);
    }
    item.addEventListener('click', () => {
      if (!isOwned(style)) { showPurchaseToast(style); tgHaptic('warning'); return; }
      _pendingStyle = style.id;
      tgHaptic('light');
      refreshPreview(); refreshColorGrid(); refreshStyleGrid();
      showStylePreviewPopup(style);
    });
    grid.appendChild(item);
  });
}

function refreshStyleGrid() {
  document.querySelectorAll('.cp-style-item').forEach(item => {
    const active = item.dataset.id === _pendingStyle && isOwned(BALL_STYLES.find(s=>s.id===item.dataset.id)||{free:false});
    item.classList.toggle('cp-grid-item-active', active);
    const style = BALL_STYLES.find(s => s.id === item.dataset.id);
    if (style) {
      const ball = item.querySelector('.cp-grid-ball');
      if (ball) {
        const composed = applyStyleToTheme(_pendingTheme, style.id);
        // Rebuild shape preview in-place for non-special shapes
        if (!['pawn','hex','star','diamond'].includes(style.id)) {
          ball.style.cssText = ballInlineStyle(composed);
          BALL_STYLES.forEach(s => ball.classList.remove(s.shape));
          ball.classList.add(style.shape);
        }
      }
    }
  });
}

// ── Style Preview Popup — shows normal piece + king side by side ──────────────
function buildKingPreviewSVG(composed, styleId = 'solid') {
  const gold = '#f0c94a';
  const shine = 'rgba(255,255,255,.22)';
  const c1 = composed.c1 || '#555';

  if (['neon', 'lava'].includes(styleId) || composed.id === 'fire' || composed.id === 'lava') {
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;">
      <defs><radialGradient id="ppfkg" cx="50%" cy="80%"><stop offset="0%" stop-color="#ff6b35"/><stop offset="100%" stop-color="#7b0000"/></radialGradient></defs>
      <path d="M20,4 C22,8 26,6 25,2 C28,5 30,10 27,14 C32,10 33,4 30,1 C34,6 36,14 32,18" fill="#ff6b35" opacity=".9"/>
      <path d="M20,4 C18,8 14,6 15,2 C12,5 10,10 13,14 C8,10 7,4 10,1 C6,6 4,14 8,18" fill="${gold}" opacity=".8"/>
      <rect x="8" y="26" width="24" height="5" rx="2.5" fill="url(#ppfkg)" opacity=".98"/>
      <polygon points="9,26 13,14 17,23" fill="#e74c3c" opacity=".95"/>
      <polygon points="17,23 20,10 23,23" fill="#ff6b35"/>
      <polygon points="23,23 27,14 31,26" fill="#e74c3c" opacity=".95"/>
      <circle cx="11" cy="27" r="2" fill="${gold}" opacity=".9"/>
      <circle cx="20" cy="25" r="2.5" fill="${gold}" opacity=".95"/>
      <circle cx="29" cy="27" r="2" fill="${gold}" opacity=".9"/>
      <ellipse cx="17" cy="19" rx="5" ry="3" fill="${shine}" transform="rotate(-20,17,19)"/>
    </svg>`;
  }
  if (['diamond', 'crystal', 'metal'].includes(styleId)) {
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;">
      <defs><linearGradient id="ppdkg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#b0e0ff"/><stop offset="50%" stop-color="#fff"/><stop offset="100%" stop-color="#6ab0e0"/></linearGradient></defs>
      <circle cx="20" cy="20" r="17" fill="none" stroke="#b0e0ff" stroke-width="1.2" opacity=".7"/>
      <rect x="8" y="26" width="24" height="5" rx="2.5" fill="url(#ppdkg)" opacity=".95"/>
      <polygon points="9,26 14,12 18,24" fill="#b0e0ff" opacity=".9"/>
      <polygon points="16,24 20,7 24,24" fill="#fff" opacity=".95"/>
      <polygon points="22,24 26,12 31,26" fill="#b0e0ff" opacity=".9"/>
      <polygon points="20,14 23,19 20,24 17,19" fill="#b0e0ff" opacity=".9"/>
      <ellipse cx="16" cy="16" rx="4" ry="2.5" fill="rgba(255,255,255,.55)" transform="rotate(-20,16,16)"/>
    </svg>`;
  }
  if (['star', 'shadow', 'hex'].includes(styleId)) {
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;">
      <defs><radialGradient id="ppskg" cx="50%" cy="50%"><stop offset="0%" stop-color="${gold}"/><stop offset="100%" stop-color="#d4a017"/></radialGradient></defs>
      <circle cx="20" cy="20" r="17" fill="none" stroke="${gold}" stroke-width="1" stroke-dasharray="3 2" opacity=".6"/>
      <polygon points="20,6 22,14 28,8 23,15 31,17 23,19 29,25 22,21 21,29 20,22 19,29 18,21 11,25 17,19 9,17 17,15 12,8 18,14" fill="url(#ppskg)" opacity=".9"/>
      <circle cx="20" cy="20" r="4.5" fill="${gold}" opacity=".95"/>
      <circle cx="20" cy="20" r="2.5" fill="#1a0a00" opacity=".85"/>
      <ellipse cx="17" cy="15" rx="4" ry="2.5" fill="${shine}" transform="rotate(-20,17,15)"/>
    </svg>`;
  }
  if (['wood', 'marble', 'dome'].includes(styleId)) {
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;">
      <defs><radialGradient id="pplkg" cx="40%" cy="30%"><stop offset="0%" stop-color="${gold}"/><stop offset="100%" stop-color="#b07d10"/></radialGradient></defs>
      <circle cx="20" cy="18" r="13" fill="none" stroke="${gold}" stroke-width="2.5" opacity=".6"/>
      <g fill="${gold}" opacity=".75">
        <ellipse cx="20" cy="5"  rx="2.2" ry="4"/>
        <ellipse cx="28" cy="8"  rx="2.2" ry="4" transform="rotate(45,28,8)"/>
        <ellipse cx="33" cy="16" rx="2.2" ry="4" transform="rotate(90,33,16)"/>
        <ellipse cx="12" cy="8"  rx="2.2" ry="4" transform="rotate(-45,12,8)"/>
        <ellipse cx="7"  cy="16" rx="2.2" ry="4" transform="rotate(-90,7,16)"/>
      </g>
      <circle cx="20" cy="18" r="9" fill="url(#pplkg)" opacity=".95"/>
      <ellipse cx="16.5" cy="16" rx="2" ry="1.8" fill="#1a0a00"/>
      <ellipse cx="23.5" cy="16" rx="2" ry="1.8" fill="#1a0a00"/>
      <circle cx="16.8" cy="15.5" r=".7" fill="#fff" opacity=".8"/>
      <circle cx="23.8" cy="15.5" r=".7" fill="#fff" opacity=".8"/>
      <ellipse cx="20" cy="19.5" rx="1.5" ry="1" fill="#1a0a00" opacity=".7"/>
      <rect x="14" y="7" width="12" height="3" rx="1.5" fill="${gold}" opacity=".95"/>
      <polygon points="15,7 17,3 19,7" fill="${gold}" opacity=".9"/>
      <polygon points="19,7 20,4 21,7" fill="${gold}"/>
      <polygon points="21,7 23,3 25,7" fill="${gold}" opacity=".9"/>
      <ellipse cx="17" cy="15" rx="3.5" ry="2" fill="${shine}" transform="rotate(-15,17,15)"/>
    </svg>`;
  }
  if (styleId === 'pawn') {
    return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;">
      <circle cx="20" cy="20" r="17" fill="none" stroke="${gold}" stroke-width="1.2" opacity=".55"/>
      <rect x="18.5" y="7" width="3" height="11" rx="1.5" fill="${gold}" opacity=".95"/>
      <rect x="14" y="9.5" width="12" height="3" rx="1.5" fill="${gold}" opacity=".95"/>
      <path d="M13,20 Q11,26 14,30 L26,30 Q29,26 27,20 Z" fill="#888" opacity=".9"/>
      <rect x="13" y="25" width="14" height="2.5" rx="1.2" fill="${gold}" opacity=".8"/>
      <circle cx="16" cy="21" r="1.2" fill="${gold}" opacity=".85"/>
      <circle cx="20" cy="20.5" r="1.4" fill="${gold}" opacity=".9"/>
      <circle cx="24" cy="21" r="1.2" fill="${gold}" opacity=".85"/>
      <ellipse cx="17" cy="22" rx="4" ry="2.5" fill="${shine}" transform="rotate(-15,17,22)"/>
    </svg>`;
  }
  // Default crown
  return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;">
    <defs><radialGradient id="ppckg" cx="50%" cy="30%"><stop offset="0%" stop-color="#ffe566"/><stop offset="100%" stop-color="#b07d10"/></radialGradient></defs>
    <circle cx="20" cy="20" r="17" fill="none" stroke="${gold}" stroke-width="1.5" opacity=".7"/>
    <rect x="7" y="25" width="26" height="5.5" rx="2.8" fill="url(#ppckg)" opacity=".98"/>
    <polygon points="8,25 12,12 16.5,22" fill="${gold}" opacity=".95"/>
    <polygon points="16.5,22 20,8 23.5,22" fill="${gold}"/>
    <polygon points="23.5,22 28,12 32,25" fill="${gold}" opacity=".95"/>
    <circle cx="10.5" cy="27" r="2.2" fill="#e74c3c" opacity=".9"/>
    <circle cx="20"   cy="26" r="2.8" fill="#b0e0ff" opacity=".9"/>
    <circle cx="29.5" cy="27" r="2.2" fill="#4cde80" opacity=".9"/>
    <ellipse cx="17" cy="16" rx="5" ry="3" fill="${shine}" transform="rotate(-20,17,16)"/>
  </svg>`;
}

function buildStylePreviewPiece(style, composed, isKing) {
  const wrap = document.createElement('div');
  wrap.className = 'spp-piece-wrap';

  if (isKing) {
    const disc = document.createElement('div');
    disc.className = 'spp-piece gp-shape-disc spp-king';
    disc.style.cssText = ballInlineStyle(composed);
    disc.innerHTML = buildKingPreviewSVG(composed, style.id);
    wrap.appendChild(disc);
    const lbl = document.createElement('span');
    lbl.className = 'spp-label'; lbl.textContent = 'King (Dama)';
    wrap.appendChild(lbl);
    return wrap;
  }

  // Normal piece — use shape-specific rendering
  if (style.id === 'pawn') {
    const el = document.createElement('div');
    el.className = 'spp-piece spp-pawn';
    el.innerHTML = `<svg viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg"
      style="width:100%;height:100%;display:block;">
      <defs><radialGradient id="sppg" cx="38%" cy="30%">
        <stop offset="0%" stop-color="${composed.c1}"/>
        <stop offset="100%" stop-color="${composed.c2}"/>
      </radialGradient></defs>
      <rect x="7" y="44" width="26" height="6" rx="3" fill="url(#sppg)" stroke="${composed.border}" stroke-width="1.2"/>
      <rect x="15" y="30" width="10" height="15" rx="4" fill="url(#sppg)" stroke="${composed.border}" stroke-width="1"/>
      <circle cx="20" cy="20" r="11" fill="url(#sppg)" stroke="${composed.border}" stroke-width="1.5"/>
      <ellipse cx="16" cy="16" rx="5" ry="3" fill="rgba(255,255,255,.28)" transform="rotate(-20,16,16)"/>
    </svg>`;
    wrap.appendChild(el);
  } else if (style.id === 'hex') {
    const el = document.createElement('div');
    el.className = 'spp-piece';
    el.style.cssText = `width:52px;height:60px;border-radius:0;
      background:linear-gradient(160deg,${composed.c1},${composed.c2});
      clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
      box-shadow:0 4px 14px rgba(0,0,0,.6);`;
    wrap.appendChild(el);
  } else if (style.id === 'star') {
    const el = document.createElement('div');
    el.className = 'spp-piece';
    el.style.cssText = `width:56px;height:56px;border-radius:0;
      background:linear-gradient(135deg,${composed.c1},${composed.c2});
      clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);
      box-shadow:0 4px 14px rgba(0,0,0,.6);`;
    wrap.appendChild(el);
  } else if (style.id === 'diamond') {
    const el = document.createElement('div');
    el.className = 'spp-piece';
    el.style.cssText = `width:52px;height:52px;border-radius:0;
      background:linear-gradient(135deg,${composed.c1},${composed.c2},${composed.c3});
      clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);
      box-shadow:0 4px 14px rgba(0,0,0,.6);`;
    wrap.appendChild(el);
  } else {
    // All standard disc-based styles
    const el = document.createElement('div');
    el.className = 'spp-piece ' + style.shape;
    el.style.cssText = ballInlineStyle(composed);
    wrap.appendChild(el);
  }

  const lbl = document.createElement('span');
  lbl.className = 'spp-label'; lbl.textContent = 'Piece';
  wrap.appendChild(lbl);
  return wrap;
}

function showStylePreviewPopup(style) {
  // Remove any existing popup
  document.getElementById('stylePreviewPopup')?.remove();

  const composed = applyStyleToTheme(_pendingTheme, style.id);

  const popup = document.createElement('div');
  popup.id = 'stylePreviewPopup';
  popup.className = 'spp-overlay';

  popup.innerHTML = `
    <div class="spp-box">
      <div class="spp-header">
        <span class="spp-title">✦ ${style.name} Style</span>
        <button class="spp-close" id="sppClose">✕</button>
      </div>
      <p class="spp-desc">${style.desc} — preview of both piece types</p>
      <div class="spp-pieces-row" id="sppPiecesRow"></div>
      <button class="spp-apply-btn" id="sppApply">✔ Apply This Style</button>
    </div>`;

  document.querySelector('.cp-modal-box')?.appendChild(popup);

  // Build the two piece previews
  const row = popup.querySelector('#sppPiecesRow');
  row.appendChild(buildStylePreviewPiece(style, composed, false));

  // Separator
  const sep = document.createElement('div');
  sep.className = 'spp-sep'; sep.textContent = '👑';
  row.appendChild(sep);

  row.appendChild(buildStylePreviewPiece(style, composed, true));

  // Animate in
  requestAnimationFrame(() => popup.classList.add('spp-show'));

  // Close on ✕
  popup.querySelector('#sppClose').addEventListener('click', () => {
    popup.classList.remove('spp-show');
    setTimeout(() => popup.remove(), 220);
  });

  // Apply button — set the style and close the cp modal
  popup.querySelector('#sppApply').addEventListener('click', () => {
    const pendingStyleObj = BALL_STYLES.find(s => s.id === style.id) || BALL_STYLES[0];
    if (!isOwned(pendingStyleObj)) { showPurchaseToast(pendingStyleObj); return; }

    const finalComposed = applyStyleToTheme(_pendingTheme, style.id);
    setState('pieceTheme',    finalComposed);
    setState('pieceThemeId',  _pendingTheme.id);
    setState('pieceStyleId',  style.id);
    localStorage.setItem('dama_piece_theme', _pendingTheme.id);
    localStorage.setItem('dama_piece_style', style.id);
    applyPieceTheme(finalComposed);
    updateTriggerBall(finalComposed);
    if (typeof window.onPieceThemeChanged === 'function') window.onPieceThemeChanged(finalComposed);
    renderPlayerList();
    tgHaptic('success');

    popup.classList.remove('spp-show');
    setTimeout(() => popup.remove(), 220);
    closeCpModal();
  });

  // Click backdrop to dismiss
  popup.addEventListener('click', e => {
    if (e.target === popup) {
      popup.classList.remove('spp-show');
      setTimeout(() => popup.remove(), 220);
    }
  });
}

export function applyPieceTheme(theme) {
  const root = document.documentElement;
  root.style.setProperty('--piece-b1', theme.c1);
  root.style.setProperty('--piece-b2', theme.c2);
  root.style.setProperty('--piece-b3', theme.c3);
  root.style.setProperty('--piece-bBorder', theme.border);
  root.style.setProperty('--piece-bShadow', theme.shadow);
  root.style.setProperty('--piece-w1', '#ffffff');
  root.style.setProperty('--piece-w2', '#e0e0e0');
  root.style.setProperty('--piece-w3', '#b0b0b0');
  root.style.setProperty('--piece-wBorder', 'rgba(0,0,0,.08)');
  root.style.setProperty('--piece-wShadow', 'rgba(255,255,255,.95)');
  // Store current shape for engine.js renderBoard
  setState('pieceShapeClass', theme._shape || 'gp-shape-disc');
  if (typeof renderBoard === 'function') {
    const gs = document.getElementById('gameScreen');
    if (gs && !gs.classList.contains('hidden')) renderBoard();
  }
}

/* ── Countdown timer — removed ── */
export function initCountdown() {
  // Countdown has been removed from the UI.
}

/* ── Player list ── */
export function renderPlayerList() {
  const container = document.getElementById('playersList');
  const countEl   = document.getElementById('onlineCount');
  if (!container) return;

  const allPlayers = PlayerRegistry.getAll();
  const me      = allPlayers.find(p => p.id === getState('tgUserId') || p.isMe);
  const myBet   = getState('currentBet') || 0;
  const isReady = getState('playerReady') === true;

  // Update my stats sidebar — wins/losses/draws from Dama DB, balance from owner backend
  if (me) {
    const wEl  = document.getElementById('myWins');
    const lEl  = document.getElementById('myLosses');
    const dEl  = document.getElementById('myDraws');
    const balEl = document.getElementById('myBalance');
    if (wEl)  wEl.textContent  = me.wins    || 0;
    if (lEl)  lEl.textContent  = me.losses  || 0;
    if (dEl)  dEl.textContent  = me.draws   || 0;
    if (balEl) {
      const balance = getCurrentBalanceValue() ?? me.balance;
      balEl.textContent = balance === null || balance === undefined ? '—' : Number(balance).toLocaleString();
    }
  }

  function ballStyle(t) {
    return `background:radial-gradient(circle at 35% 30%,${t.c1},${t.c2} 55%,${t.c3});` +
           `border:1.5px solid ${t.border};` +
           `box-shadow:inset 0 1px 4px ${t.shadow},0 2px 6px rgba(0,0,0,.55);`;
  }

  function buildOwnRow() {
    if (!me) return null;
    const myTheme = getState('pieceTheme') || PIECE_THEMES[0];
    const myRow   = document.createElement('div');
    myRow.className = 'player-row player-row-me' + (me.online ? ' is-online' : '');
    myRow.innerHTML = `
      <div class="pr-avatar">
        ${me.photo ? `<img src="${escHtml(me.photo)}" alt="${escHtml(me.name)}">` : escHtml(initials(me.name))}
        ${me.online ? '<div class="pr-online-badge"></div>' : ''}
      </div>
      <div class="pr-info">
        <div class="pr-name">${escHtml(me.name)} <span class="pr-you-tag">YOU</span>
          <span class="pr-online-label ${me.online ? 'pr-status-online' : 'pr-status-offline'}">
            ${me.online ? '🟢 Online' : '⚫ Offline'}
          </span>
        </div>
        <div class="pr-row2">
          <div class="pr-stats">
            <span class="pr-stat win">✔ ${me.wins || 0}</span>
            <span class="pr-stat loss">✖ ${me.losses || 0}</span>
            <span class="pr-stat draw">◆ ${me.draws || 0}</span>
          </div>
          ${myBet > 0
            ? `<span class="pr-bet ${isReady ? 'pr-bet-ready' : ''}">
                ${isReady ? '✅ Ready · ' : '💰 '}${myBet} ETB
               </span>`
            : `<span class="pr-bet pr-bet-none">No bet set</span>`}
        </div>
        <div class="pr-balance-row">
          💳 Balance: <strong>${Number(getState('damaBalance') ?? me.balance ?? 500).toLocaleString()} ETB</strong>
        </div>
      </div>
      <div class="pr-balls">
        <span class="pr-piece-ball pr-piece-ball-me" style="${ballStyle(myTheme)}"></span>
      </div>
    `;
    return myRow;
  }

  function buildOtherRow(player) {
    const bet        = player.ready_bet || player.bet || 100;
    const oppThemeId = player.piece_theme || player.pieceThemeId || 'classic';
    const oppTheme   = PIECE_THEMES.find(t => t.id === oppThemeId) || PIECE_THEMES[0];
    const myTheme    = getState('pieceTheme') || PIECE_THEMES[0];
    const sameTheme  = oppTheme.id === myTheme.id;

    const row = document.createElement('div');
    row.className = 'player-row is-online';
    row.innerHTML = `
      <div class="pr-avatar">
        ${player.photo ? `<img src="${escHtml(player.photo)}" alt="${escHtml(player.name)}">` : escHtml(initials(player.name))}
        <div class="pr-online-badge"></div>
      </div>
      <div class="pr-info">
        <div class="pr-name">
          ${escHtml(player.name)}
          <span class="pr-ready-tag">READY</span>
        </div>
        <div class="pr-row2">
          <div class="pr-stats">
            <span class="pr-stat win">✔ ${player.wins || 0}</span>
            <span class="pr-stat loss">✖ ${player.losses || 0}</span>
            <span class="pr-stat draw">◆ ${player.draws || 0}</span>
          </div>
          <span class="pr-bet pr-bet-ready">✅ ${bet} ETB</span>
        </div>
      </div>
      <div class="pr-balls">
        <span class="pr-piece-ball${sameTheme ? ' pr-ball-labeled' : ''}"
          title="${escHtml(oppTheme.name)}" style="${ballStyle(oppTheme)}">
          ${sameTheme ? '<span class="pr-ball-tag">P2</span>' : ''}
        </span>
        <span class="pr-balls-vs">vs</span>
        <span class="pr-piece-ball pr-piece-ball-me${sameTheme ? ' pr-ball-labeled' : ''}"
          title="${escHtml(myTheme.name)}" style="${ballStyle(myTheme)}">
          ${sameTheme ? '<span class="pr-ball-tag">P1</span>' : ''}
        </span>
      </div>
      <button class="pr-play-btn" title="Challenge ${escHtml(player.name)}">▶</button>
    `;
    row.querySelector('.pr-play-btn').addEventListener('click', e => {
      e.stopPropagation();
      tgHaptic('medium');
      // Map DB player to local player format
      const localPlayer = {
        id:          player.id,
        name:        player.name,
        photo:       player.photo,
        pieceThemeId: oppThemeId,
        bet:         bet,
        wins:        player.wins,
        losses:      player.losses,
        draws:       player.draws,
        balance:     player.balance,
        online:      true,
      };
      window.startGameVsPlayer(localPlayer);
    });
    row.addEventListener('click', () => {
      tgHaptic('light');
      const localPlayer = {
        id:          player.id,
        name:        player.name,
        photo:       player.photo,
        pieceThemeId: oppThemeId,
        bet:         bet,
        wins:        player.wins,
        losses:      player.losses,
        draws:       player.draws,
        balance:     player.balance,
        online:      true,
      };
      window.startGameVsPlayer(localPlayer);
    });
    return row;
  }

  // Render own row immediately (don't wait for backend)
  container.innerHTML = '';
  const myRow = buildOwnRow();
  if (myRow) container.appendChild(myRow);

  // If bet selected → fetch matching ready players from backend
  if (myBet > 0 && isReady && getState('tgUserId')) {
    const divider = document.createElement('div');
    divider.className = 'pl-divider';
    divider.textContent = 'Ready Players — ' + myBet + ' ETB';
    container.appendChild(divider);

    const loadingEl = document.createElement('div');
    loadingEl.className = 'pl-empty';
    loadingEl.innerHTML = '<span class="pl-empty-icon" style="font-size:1.2rem;opacity:.4;">⏳</span> Looking for players…';
    container.appendChild(loadingEl);

    PlayerRegistry.fetchReadyPlayers(myBet, getState('tgUserId')).then(readyPlayers => {
      loadingEl.remove();

      if (readyPlayers.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'pl-empty';
        empty.innerHTML = `<span class="pl-empty-icon">👥</span>No players ready at ${myBet} ETB yet.<br>Share your link to invite others!`;
        container.appendChild(empty);
        if (countEl) countEl.textContent = '0 ready';
        return;
      }

      if (countEl) countEl.textContent = readyPlayers.length + ' ready';
      readyPlayers.forEach(player => {
        container.appendChild(buildOtherRow(player));
      });
    });

  } else {
    // Not ready yet — show guidance
    const divider = document.createElement('div');
    divider.className = 'pl-divider';
    divider.textContent = 'Set a bet above to see available players';
    container.appendChild(divider);
    if (countEl) countEl.textContent = '—';
  }
}

/* ── Ripple button effect ── */
export function ripple(btn, e) {
  const span = document.createElement('span');
  span.style.cssText = `position:absolute;border-radius:50%;background:rgba(255,255,255,.3);
    pointer-events:none;transform:scale(0);animation:rippleAnim .55s ease forwards;`;
  const rect = btn.getBoundingClientRect();
  const sz   = Math.max(rect.width, rect.height);
  span.style.width  = sz + 'px';
  span.style.height = sz + 'px';
  span.style.left   = (e.clientX - rect.left - sz / 2) + 'px';
  span.style.top    = (e.clientY - rect.top  - sz / 2) + 'px';
  btn.appendChild(span);
  setTimeout(() => span.remove(), 600);
}

export function injectRippleStyle() {
  if (!document.getElementById('rippleKF')) {
    const s = document.createElement('style');
    s.id = 'rippleKF';
    s.textContent = `@keyframes rippleAnim{to{transform:scale(2.5);opacity:0}}`;
    document.head.appendChild(s);
  }
}

/* ── Shared helpers ── */
function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
