/* ═══════════════════════════════════════════════════
   MODULE: urlAuth.js
   Reads required URL params:  token + phone + username + balance
   If all present  → stores them, resolves
   If any missing  → shows a blocking "Invalid Token" overlay
   ═══════════════════════════════════════════════════ */

const REQUIRED_PARAMS = ['token', 'phone'];
const STORAGE_KEY     = 'dama_url_auth';

function normalizePhone(phone) {
  if (!phone) return null;
  const clean = String(phone).replace(/\D/g, '');
  if (clean.length >= 9) {
    return '251' + clean.slice(-9);
  }
  return clean;
}

/**
 * Read params from the current URL.
 * Returns an object with the four values, or null for missing ones.
 */
function readParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    token:    p.get('token')    || null,
    phone:    normalizePhone(p.get('phone')),
    username: p.get('username') || null,
    balance:  p.get('balance')  || null,
  };
}

/**
 * Check if all required params are present and non-empty.
 */
function isValid(params) {
  return REQUIRED_PARAMS.every(k => !!params[k]);
}

/**
 * Inject the blocking "Invalid Token" overlay into the DOM.
 */
function showInvalidOverlay(missing) {
  // Prevent loader from hiding this
  document.body.style.overflow = 'hidden';

  const overlay = document.createElement('div');
  overlay.id = 'urlAuthBlock';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:radial-gradient(ellipse at center,#1a0f00 0%,#0d0d0d 70%)',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'gap:18px', 'padding:32px 24px', 'text-align:center',
  ].join(';');

  overlay.innerHTML = `
    <style>
      @keyframes lockBounce {
        0%  { transform: scale(0) rotate(-20deg); opacity:0; }
        60% { transform: scale(1.15) rotate(4deg); opacity:1; }
        100%{ transform: scale(1)    rotate(0deg); opacity:1; }
      }
      @keyframes fadeUp {
        from { opacity:0; transform:translateY(14px); }
        to   { opacity:1; transform:translateY(0); }
      }
      #urlAuthBlock .lock-icon   { animation: lockBounce .55s ease both; }
      #urlAuthBlock .auth-title  { animation: fadeUp .4s .25s ease both; opacity:0; }
      #urlAuthBlock .auth-desc   { animation: fadeUp .4s .38s ease both; opacity:0; }
      #urlAuthBlock .auth-missing{ animation: fadeUp .4s .48s ease both; opacity:0; }
      #urlAuthBlock .auth-format { animation: fadeUp .4s .55s ease both; opacity:0; }
    </style>

    <div class="lock-icon" style="font-size:3.6rem;line-height:1;">🔒</div>

    <div class="auth-title" style="
      font-family:'Cinzel',serif;
      font-size:1.4rem;font-weight:900;
      background:linear-gradient(180deg,#fff 0%,#f0c94a 55%,#d4a017 100%);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;
      background-clip:text;
    ">Access Denied</div>

    <div class="auth-desc" style="
      color:rgba(245,230,200,.7);font-size:.9rem;
      max-width:300px;line-height:1.65;
    ">
      This app requires a valid access link.<br>
      Please open the correct URL provided by your administrator.
    </div>

    <div class="auth-missing" style="
      background:rgba(231,76,60,.12);
      border:1px solid rgba(231,76,60,.3);
      border-radius:10px;padding:10px 18px;
      font-size:.78rem;color:#e74c3c;line-height:1.7;
      max-width:320px;
    ">
      <strong>Missing parameters:</strong><br>
      ${missing.map(k => `<code style="background:rgba(0,0,0,.3);padding:1px 6px;border-radius:4px;">${k}</code>`).join('  ')}
    </div>

    <div class="auth-format" style="
      background:rgba(212,160,23,.07);
      border:1px solid rgba(212,160,23,.2);
      border-radius:10px;padding:12px 16px;
      font-family:'Courier New',monospace;
      font-size:.72rem;color:rgba(240,201,74,.85);
      word-break:break-all;max-width:340px;line-height:1.7;
      text-align:left;
    ">
      <span style="color:rgba(255,255,255,.4);font-family:sans-serif;font-size:.68rem;">Required URL format:</span><br>
      <span style="color:#f0c94a;">?token=</span><span style="color:#fff;">YOUR_TOKEN</span>
      <span style="color:#f0c94a;">&amp;phone=</span><span style="color:#fff;">0912345678</span>
      <span style="color:#f0c94a;">&amp;username=</span><span style="color:#fff;">Kaleab</span>
      <span style="color:#f0c94a;">&amp;balance=</span><span style="color:#fff;">500</span>
    </div>
  `;

  // Mount as early as possible — before DOMContentLoaded if needed
  const mount = () => {
    // Remove the loader so nothing is visible underneath
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    document.body.appendChild(overlay);
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
}

/**
 * updateBalanceDisplay(balance)
 * Single source of truth for updating the balance element.
 * Call this whenever the balance changes.
 */
export function updateBalanceDisplay(balance) {
  // null means "not yet known" — don't overwrite the spinner or previous value
  if (balance === null || balance === undefined) return;
  const balEl = document.getElementById('myBalance');
  if (balEl) balEl.textContent = Number(balance).toLocaleString();
  // Also keep window.DAMA_BALANCE in sync
  window.DAMA_BALANCE = balance;
  // Update registry cache for the current user
  if (window.tgUserId && window.PlayerRegistry) {
    const list = window.PlayerRegistry.load();
    const me = list.find(p => p.id === window.tgUserId);
    if (me) { me.balance = balance; window.PlayerRegistry.save(list); }
  }
}

/**
 * setBalanceLoading(bool) — show/hide spinner and disable/enable refresh btn
 */
function setBalanceLoading(loading) {
  const spinner = document.getElementById('balSpinner');
  const btn     = document.getElementById('balRefreshBtn');
  if (spinner) spinner.classList.toggle('hidden', !loading);
  if (btn) {
    btn.classList.toggle('spinning', loading);
    btn.disabled = loading;
  }
}

/**
 * Ask Dama backend to get the partner integration backend URL.
 */
async function fetchBackendUrl(token) {
  try {
    const { apiUrl } = await import('./socket.js');
    const res = await fetch(`${apiUrl}/token-backend-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.backendUrl || null;
  } catch (err) {
    console.error('fetchBackendUrl error:', err);
    return null;
  }
}

/**
 * Fetch real balance directly from the partner integration's backendUrl/dama endpoint.
 */
async function fetchRealBalanceDirect(backendUrl, phone, username) {
  try {
    const checkUrl = backendUrl.replace(/\/$/, '') + '/dama';
    const res = await fetch(checkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'get_balance',
        phone: normalizePhone(phone),
        username: username || 'Player',
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      balance: data.balance !== null && data.balance !== undefined ? Number(data.balance) : null,
      username: data.username || null,
    };
  } catch (err) {
    console.error('fetchRealBalanceDirect error:', err);
    return null;
  }
}

/**
 * Inject a fullscreen blocker if connection to partner backend fails.
 */
function showOfflineOverlay(backendUrl) {
  if (document.getElementById('backendConnBlock')) return;
  document.body.style.overflow = 'hidden';

  const overlay = document.createElement('div');
  overlay.id = 'backendConnBlock';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:radial-gradient(ellipse at center,#1e0000 0%,#0d0d0d 70%)',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'gap:18px', 'padding:32px 24px', 'text-align:center',
  ].join(';');

  overlay.innerHTML = `
    <div style="font-size:3.6rem;line-height:1;margin-bottom:8px;">⚠️</div>
    <div style="
      font-family:'Cinzel',serif;
      font-size:1.4rem;font-weight:900;
      color:#e74c3c;
    ">Connection Offline</div>
    <div style="
      color:rgba(245,230,200,.7);font-size:.9rem;
      max-width:320px;line-height:1.65;
    ">
      The partner integration backend server at:<br>
      <code style="background:rgba(0,0,0,.4);padding:4px 8px;border-radius:6px;font-size:.8rem;word-break:break-all;display:block;margin-top:8px;color:#f0c94a;">${backendUrl || 'Unknown Integration'}</code><br>
      is currently offline or unreachable. We cannot retrieve your account details.
    </div>
    <button id="connRetryBtn" style="
      background:#d4a017;color:#000;border:none;
      border-radius:8px;padding:12px 24px;font-weight:700;
      cursor:pointer;margin-top:12px;font-family:inherit;
      box-shadow:0 4px 14px rgba(212,160,23,.3);
    ">↻ Try Again</button>
  `;

  const mount = () => {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    document.body.appendChild(overlay);

    document.getElementById('connRetryBtn').addEventListener('click', () => {
      window.location.reload();
    });
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
}

/**
 * refreshBalance(silent) — fetch fresh balance directly from owner backend.
 */
export async function refreshBalance(silent = false) {
  const auth = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
  })();
  if (!auth?.token || !auth?.phone) return;

  const backendUrl = localStorage.getItem('dama_integration_backend_url');
  if (!backendUrl) return;

  if (!silent) setBalanceLoading(true);
  const data = await fetchRealBalanceDirect(backendUrl, auth.phone, auth.username);
  if (data && data.balance !== null && data.balance !== undefined) {
    updateBalanceDisplay(data.balance);
    if (data.username) {
      window.DAMA_USERNAME = data.username;
      auth.username = data.username;
      auth.balance = data.balance.toString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    }
  } else if (!silent) {
    showOfflineOverlay(backendUrl);
  }
  if (!silent) setBalanceLoading(false);
}

/**
 * initUrlAuth()
 * Call this before anything else in app.js.
 *
 * Returns a Promise that:
 *   - resolves with { token, phone, username, balance } if valid
 *   - never resolves (shows blocking overlay) if invalid
 */
export function initUrlAuth() {
  return new Promise((resolve) => {
    const params = readParams();

    if (isValid(params)) {
      // Persist to localStorage so other modules can read them
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));

      // Set API token globally so registry.js fetchWithToken() picks it up
      window.DAMA_API_TOKEN = params.token;
      localStorage.setItem('dama_api_token', params.token);

      // Expose phone as global, set default username/balance
      window.DAMA_PHONE    = params.phone;
      window.DAMA_USERNAME = params.username || 'Player';
      // Use ?? not || so that balance=0 is preserved (0 is falsy but valid)
      const _parsedBal = parseInt(params.balance, 10);
      window.DAMA_BALANCE  = !isNaN(_parsedBal) ? _parsedBal : null;

      // Show spinner while fetching real balance
      setBalanceLoading(true);

      // Step 1: Request backend to get the backendUrl of that token
      fetchBackendUrl(params.token).then(backendUrl => {
        if (!backendUrl) {
          setBalanceLoading(false);
          showOfflineOverlay('Dama Token Authorization API');
          return;
        }

        // Cache the partner's backend URL
        localStorage.setItem('dama_integration_backend_url', backendUrl);

        // Step 2: Request the partner backend directly to get username and balance
        fetchRealBalanceDirect(backendUrl, params.phone, params.username).then(data => {
          setBalanceLoading(false);
          if (!data) {
            // Step 3: Show connection offline overlay if partner URL fails
            showOfflineOverlay(backendUrl);
            return;
          }

          // Step 4: If successful, update details, local storage, and the page UI
          if (data.balance !== null && data.balance !== undefined) {
            updateBalanceDisplay(data.balance);
            params.balance = data.balance.toString();
          }
          if (data.username) {
            window.DAMA_USERNAME = data.username;
            params.username = data.username;
            const nameEl = document.getElementById('tgName');
            if (nameEl) nameEl.textContent = data.username;
          }

          // Step 5: Update the URL query params in browser history
          try {
            const url = new URL(window.location.href);
            if (data.balance !== null) url.searchParams.set('balance', data.balance.toString());
            if (data.username) url.searchParams.set('username', data.username);
            window.history.replaceState({}, '', url.toString());
          } catch (e) {
            console.error('Failed to update URL search parameters:', e);
          }

          // Save updated params to localStorage
          localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
          resolve(params);
        });
      });
    } else {
      // Find which params are missing
      const missing = REQUIRED_PARAMS.filter(k => !params[k]);
      showInvalidOverlay(missing);
      // Promise intentionally never resolves — app is blocked
    }
  });
}

/**
 * getUrlAuth()
 * Read previously validated params from localStorage (for use after page reload).
 * Returns null if not available.
 */
export function getUrlAuth() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}
