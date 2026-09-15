/* ═══════════════════════════════════════════════════
   MODULE: urlAuth.js
   Supports two URL formats:

   1. Secure (production):
      ?token=dama_xxx&launch=JWT_PAYLOAD
      Balance/username fetched from backend via launch-token verification.

   2. Simple (dev / direct link):
      ?token=dama_xxx&phone=09...&username=Name&balance=1000
      Balance and username come directly from the URL params.
      No external system-backend needed.

   Format 2 is auto-detected when `phone` + `username` are present
   instead of `launch`.
═══════════════════════════════════════════════════ */

import { showAuthError, hideAuthError } from './authError.js';

const STORAGE_KEY              = 'dama_url_auth';
const BALANCE_FETCH_TIMEOUT_MS = 25000;
const WAKEUP_UI_DELAY_MS       = 5000;
const LOADER_SUBTITLE_SELECTOR = '.loader-subtitle';

let _authGate = null;

// ── Auth gate (promise that blocks app boot) ──────────────────
export function createAuthGate() {
  let settled = false;
  let resolveFn, rejectFn;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn  = reject;
  });
  return {
    promise,
    resolve(value) { if (!settled) { settled = true; resolveFn(value); } },
    reject(reason) { if (!settled) { settled = true; rejectFn(reason);  } },
  };
}

export function getAuthGate()   { if (!_authGate) _authGate = createAuthGate(); return _authGate; }
export function resetAuthGate() { _authGate = createAuthGate(); return _authGate; }

// ── Read all possible params from URL ────────────────────────
function readParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    token:    p.get('token')    || null,
    launch:   p.get('launch')   || null,
    phone:    p.get('phone')    || null,
    username: p.get('username') || null,
    balance:  p.get('balance')  || null,
  };
}

// ── Detect which auth mode we're in ──────────────────────────
function detectMode(params) {
  if (params.token && params.launch)                        return 'launch';   // secure mode
  if (params.token && params.phone && params.username)      return 'direct';   // simple mode
  return 'invalid';
}

function getMissingParams(params) {
  const mode = detectMode(params);
  if (mode !== 'invalid') return [];
  // Show what's missing for the simpler direct format
  const needed = ['token', 'phone', 'username'];
  return needed.filter(k => !params[k]);
}

function getFallbackBalance(params) {
  const raw = params?.balance;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function shouldTreatBalanceFetchAsNonBlocking(reason) {
  if (typeof reason === 'number') return [401, 403].includes(reason);
  const text = String(reason || '').toLowerCase();
  return [401, 403].some(code => text.includes(String(code)))
    || /unauthorized|forbidden|invalid launch|invalid or inactive token/i.test(text);
}

// ── Blocking "Access Denied" overlay ─────────────────────────
function showInvalidOverlay(missing = [], options = {}) {
  document.body.style.overflow = 'hidden';
  const title       = options.title       || 'Access Denied';
  const description = options.description || 'This app requires a valid access link.<br>Please open the correct URL provided by your administrator.';

  const existing = document.getElementById('urlAuthBlock');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'urlAuthBlock';
  overlay.style.cssText = [
    'position:fixed','inset:0','z-index:99999',
    'background:radial-gradient(ellipse at center,#1a0f00 0%,#0d0d0d 70%)',
    'display:flex','flex-direction:column',
    'align-items:center','justify-content:center',
    'gap:18px','padding:32px 24px','text-align:center',
  ].join(';');

  const missingHtml = missing.length
    ? `<div style="background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.3);
        border-radius:10px;padding:10px 18px;font-size:.78rem;color:#e74c3c;
        line-height:1.7;max-width:320px;">
        <strong>Missing parameters:</strong><br>
        ${missing.map(k => `<code style="background:rgba(0,0,0,.3);padding:1px 6px;border-radius:4px;">${k}</code>`).join('  ')}
       </div>`
    : '';

  overlay.innerHTML = `
    <style>
      @keyframes lockBounce{0%{transform:scale(0) rotate(-20deg);opacity:0}60%{transform:scale(1.15) rotate(4deg);opacity:1}100%{transform:scale(1) rotate(0);opacity:1}}
      @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      #urlAuthBlock .lock-icon  { animation:lockBounce .55s ease both }
      #urlAuthBlock .auth-title { animation:fadeUp .4s .25s ease both;opacity:0 }
      #urlAuthBlock .auth-desc  { animation:fadeUp .4s .38s ease both;opacity:0 }
      #urlAuthBlock .auth-miss  { animation:fadeUp .4s .48s ease both;opacity:0 }
      #urlAuthBlock .auth-fmt   { animation:fadeUp .4s .55s ease both;opacity:0 }
    </style>
    <div class="lock-icon" style="font-size:3.6rem;line-height:1;">🔒</div>
    <div class="auth-title" style="font-family:'Cinzel',serif;font-size:1.4rem;font-weight:900;
      background:linear-gradient(180deg,#fff 0%,#f0c94a 55%,#d4a017 100%);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
      ${title}
    </div>
    <div class="auth-desc" style="color:rgba(245,230,200,.7);font-size:.9rem;max-width:300px;line-height:1.65;">
      ${description}
    </div>
    <div class="auth-miss">${missingHtml}</div>
    <div class="auth-fmt" style="background:rgba(212,160,23,.07);border:1px solid rgba(212,160,23,.2);
      border-radius:10px;padding:12px 16px;font-family:'Courier New',monospace;
      font-size:.72rem;color:rgba(240,201,74,.85);word-break:break-all;
      max-width:340px;line-height:1.7;text-align:left;">
      <span style="color:rgba(255,255,255,.4);font-family:sans-serif;font-size:.68rem;">Required URL format:</span><br>
      <span style="color:#f0c94a;">?token=</span><span style="color:#fff;">YOUR_TOKEN</span>
      <span style="color:#f0c94a;">&amp;phone=</span><span style="color:#fff;">0912345678</span>
      <span style="color:#f0c94a;">&amp;username=</span><span style="color:#fff;">Name</span>
      <span style="color:#f0c94a;">&amp;balance=</span><span style="color:#fff;">1000</span>
    </div>`;

  const mount = () => {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    document.body.appendChild(overlay);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
}

function showAccountLoadFailureOverlay(onRetry) {
  showAuthError(
    "We couldn't verify your account. Please contact the admin or try again.",
    onRetry
  );
}

// ── Balance display helpers ───────────────────────────────────
export function updateBalanceDisplay(balance) {
  if (balance === null || balance === undefined) { hideAuthError(); return; }
  const balEl = document.getElementById('myBalance');
  if (balEl) balEl.textContent = Number(balance).toLocaleString();
  window.DAMA_BALANCE = balance;
  window.dispatchEvent(new CustomEvent('dama-balance-changed', { detail: balance }));
  if (window.tgUserId && window.PlayerRegistry) {
    const list = window.PlayerRegistry.load();
    const me   = list.find(p => p.id === window.tgUserId);
    if (me) { me.balance = balance; window.PlayerRegistry.save(list); }
  }
}

function setBalanceLoading(loading) {
  const spinner = document.getElementById('balSpinner');
  const btn     = document.getElementById('balRefreshBtn');
  if (spinner) spinner.classList.toggle('hidden', !loading);
  if (btn)     { btn.classList.toggle('spinning', loading); btn.disabled = loading; }
}

function showWakingUpMessage(show) {
  const subtitle = document.querySelector(LOADER_SUBTITLE_SELECTOR);
  if (!subtitle) return;
  subtitle.textContent = show ? 'Waking up the server, this may take a moment...' : 'Ethiopian Checkers';
}

// ── Fetch balance via launch-token (secure mode) ──────────────
async function fetchPlayerBalanceLaunch(token, launch) {
  const { apiUrl } = await import('./socket.js');
  const res = await fetch(`${apiUrl}/player-balance`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ token, launch }),
    signal:  AbortSignal.timeout(BALANCE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const data = json?.data ?? json;
  return {
    balance:  data.balance  !== undefined ? Number(data.balance)  : null,
    username: data.username || null,
  };
}

// ── refreshBalance — called periodically ─────────────────────
export async function refreshBalance(silent = false) {
  const auth = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
  })();
  if (!auth?.token) return;

  if (!silent) setBalanceLoading(true);

  try {
    // Direct mode: just use locally stored balance/username — no server call needed
    if (auth.mode === 'direct') {
      if (auth.balance !== null && auth.balance !== undefined) {
        updateBalanceDisplay(auth.balance);
      }
      if (auth.username) window.DAMA_USERNAME = auth.username;
      return;
    }

    // Launch mode: hit backend for live balance
    if (auth.launch) {
      const data = await fetchPlayerBalanceLaunch(auth.token, auth.launch);
      if (data.balance !== null && data.username !== null) {
        updateBalanceDisplay(data.balance);
        window.DAMA_USERNAME = data.username;
      }
    }
  } catch (err) {
    if (shouldTreatBalanceFetchAsNonBlocking(err)) return;
    console.warn('[urlAuth] refreshBalance failed:', err.message);
    if (!silent) showAuthError(
      "We couldn't connect to the game server. Please try again.",
      () => refreshBalance(false)
    );
  } finally {
    if (!silent) setBalanceLoading(false);
  }
}

// ── initUrlAuth — called once at startup ──────────────────────
export function initUrlAuth() {
  const gate = resetAuthGate();
  window.DAMA_AUTH_READY = gate.promise;

  return new Promise((resolve) => {
    const params = readParams();
    const mode   = detectMode(params);

    // ── INVALID: show access denied ───────────────────────────
    if (mode === 'invalid') {
      showInvalidOverlay(getMissingParams(params));
      gate.reject(new Error('Missing auth parameters'));
      return; // stays blocked
    }

    // ── Persist to localStorage ───────────────────────────────
    const stored = { token: params.token, mode };
    if (mode === 'launch') {
      stored.launch = params.launch;
    } else {
      stored.phone    = params.phone;
      stored.username = params.username;
      stored.balance  = getFallbackBalance(params);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    // Expose token globally
    window.DAMA_API_TOKEN = params.token;
    localStorage.setItem('dama_api_token', params.token);

    // ── DIRECT MODE: phone + username + balance in URL ────────
    if (mode === 'direct') {
      const balance  = getFallbackBalance(params) ?? 0;
      const username = params.username;
      const phone    = params.phone;

      // Set globals that telegram.js / state.js read
      window.DAMA_USERNAME = username;
      window.DAMA_PHONE    = phone;
      window.DAMA_BALANCE  = balance;

      updateBalanceDisplay(balance);

      const nameEl = document.getElementById('tgName');
      if (nameEl) nameEl.textContent = username;

      gate.resolve(true);

      // Clean URL — keep only what's needed
      try {
        const url   = new URL(window.location.href);
        const clean = new URLSearchParams();
        clean.set('token',    params.token);
        clean.set('phone',    phone);
        clean.set('username', username);
        clean.set('balance',  String(balance));
        window.history.replaceState({}, '', `${url.pathname}?${clean.toString()}`);
      } catch (_) {}

      resolve(params);
      return;
    }

    // ── LAUNCH MODE: fetch balance from backend ───────────────
    window.DAMA_USERNAME = 'Player';
    window.DAMA_BALANCE  = null;

    setBalanceLoading(true);
    const wakeTimer = setTimeout(() => showWakingUpMessage(true), WAKEUP_UI_DELAY_MS);

    fetchPlayerBalanceLaunch(params.token, params.launch)
      .then(data => {
        clearTimeout(wakeTimer);
        showWakingUpMessage(false);
        setBalanceLoading(false);

        if (data.balance === null || data.username === null) {
          gate.reject(new Error('Could not load account data.'));
          showAccountLoadFailureOverlay(() => initUrlAuth());
          resolve(params);
          return;
        }

        updateBalanceDisplay(data.balance);
        window.DAMA_USERNAME = data.username;
        const nameEl = document.getElementById('tgName');
        if (nameEl) nameEl.textContent = data.username;

        gate.resolve(true);

        try {
          const url   = new URL(window.location.href);
          const clean = new URLSearchParams();
          clean.set('token',  params.token);
          clean.set('launch', params.launch);
          window.history.replaceState({}, '', `${url.pathname}?${clean.toString()}`);
        } catch (_) {}

        resolve(params);
      })
      .catch(err => {
        clearTimeout(wakeTimer);
        showWakingUpMessage(false);
        setBalanceLoading(false);

        gate.reject(err);

        if (shouldTreatBalanceFetchAsNonBlocking(err)) {
          const fb = getFallbackBalance(params);
          if (fb !== null) updateBalanceDisplay(fb);
          showInvalidOverlay(['token', 'launch'], {
            title:       'Access Denied',
            description: 'This access link is invalid or expired.<br>Please request a fresh link from your administrator.',
          });
          resolve(params);
          return;
        }

        showAccountLoadFailureOverlay(() => initUrlAuth());
        resolve(params);
      });
  });
}

export function getUrlAuth() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); }
  catch { return null; }
}
