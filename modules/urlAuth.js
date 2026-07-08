/* ═══════════════════════════════════════════════════
   MODULE: urlAuth.js
   Reads required URL params:  token + phone + username + balance
   If all present  → stores them, resolves
   If any missing  → shows a blocking "Invalid Token" overlay
   ═══════════════════════════════════════════════════ */

const REQUIRED_PARAMS = ['token', 'phone', 'username', 'balance'];
const STORAGE_KEY     = 'dama_url_auth';

/**
 * Read params from the current URL.
 * Returns an object with the four values, or null for missing ones.
 */
function readParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    token:    p.get('token')    || null,
    phone:    p.get('phone')    || null,
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

      // Expose phone + username + balance as globals for telegram.js override
      window.DAMA_PHONE    = params.phone;
      window.DAMA_USERNAME = params.username;
      window.DAMA_BALANCE  = parseInt(params.balance, 10) || 500;

      resolve(params);
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
