/* ═══════════════════════════════════════════════════
   app.js  — Main entry point (Menu & Bootstrap)
   Imports: telegram | ui | registry | engine
═══════════════════════════════════════════════════ */

import { initTelegram, populateTelegramUser, tgHaptic, showScreen, initBackButton } from './modules/telegram.js';
import { initLoader, initParticles, initBetBar, initColorPicker, initCountdown, renderPlayerList, ripple, injectRippleStyle, PIECE_THEMES } from './modules/ui.js';
import { PlayerRegistry } from './modules/registry.js';
import { startGame, G, executeMove, endGame } from './modules/engine.js';
import { Socket } from './modules/socket.js';
import { initErrorBoundary } from './modules/errorBoundary.js';
import { initConnectionMonitor } from './modules/connection.js';
import { initAutoLogout, resetIdle } from './modules/autoLogout.js';
import { initUrlAuth, updateBalanceDisplay, refreshBalance } from './modules/urlAuth.js';

/* ── 0. URL Auth gate — MUST run before anything else ── */
const urlAuth = await initUrlAuth();
// If we reach here, token + phone + username + balance are all valid.

/* ── 1. Telegram init (runs immediately) ── */
initTelegram();
initErrorBoundary();
initConnectionMonitor();
initAutoLogout();   // starts idle timer + ensures home screen on load

/* Set defaults */
window.pieceTheme = PIECE_THEMES[0];

/* ── 2. Expose globals needed by engine.js / ui.js ── */
window.showScreen       = showScreen;
window.renderPlayerList = renderPlayerList;
window.PlayerRegistry   = PlayerRegistry;
window.PIECE_THEMES     = PIECE_THEMES;

// Expose engine ref for autoLogout resign-on-timeout
window._engineRef = { G, endGame, WHITE: 2, BLACK: 1 };
window.resetIdle  = resetIdle;
// Expose socket apiUrl for engine.js finish-local calls
window._socketRef = { apiUrl: Socket.apiUrl };

window.startGame = function(mode, opponent) {
  startGame(mode, opponent);
};

window.startGameVsPlayer = function(opponent) {
  if (opponent && opponent.id && !opponent.id.startsWith('demo_')) {
    const betAmount = parseInt(document.getElementById('betInput')?.value || '100', 10);
    const me = PlayerRegistry.load().find(p => p.isMe);
    if (me && me.balance < betAmount) {
      alert(`Insufficient balance! You only have ${me.balance} ETB.`);
      return;
    }

    const waitingModal = document.getElementById('waitingModal');
    const waitingSub = document.getElementById('waitingSub');
    if (waitingSub) waitingSub.textContent = `Challenging ${opponent.name} for ${betAmount} ETB...`;
    if (waitingModal) {
      waitingModal.classList.remove('hidden');
      setTimeout(() => waitingModal.classList.add('modal-show'), 10);
    }

    window.activeChallenge = { opponentId: opponent.id, betAmount };

    Socket.send('challenge_send', {
      challengerId: window.tgUserId,
      opponentId: opponent.id,
      betAmount
    });
  } else {
    window._opponent = opponent;
    startGame('pvp', opponent);
  }
};

/* ── 3. Loading screen → menu ── */
initLoader(() => {
  populateTelegramUser(() => {
    // Load saved theme for this user and restore it
    const saved = localStorage.getItem('dama_piece_theme');
    const savedTheme = PIECE_THEMES.find(t => t.id === saved) || PIECE_THEMES[0];
    window.pieceTheme = savedTheme;

    // Register user, syncing their current piece theme
    PlayerRegistry.register({
      id:           window.tgUserId,
      name:         window.tgUserName,
      photo:        window.tgUserPhoto,
      isMe:         true,
      bet:          window.currentBet || 100,
      pieceThemeId: savedTheme.id,
    });

    // Connect WebSocket
    Socket.connect(window.tgUserId);

    // Clear any stale ready state on login
    window.playerReady = false;
    window.currentBet  = 0;
    PlayerRegistry.clearReadyOnBackend(window.tgUserId).catch(() => {});

    // Initial fetch of player list and setup periodic refresh
    PlayerRegistry.fetchPlayers();
    setInterval(() => PlayerRegistry.fetchPlayers(), 10000);
    // Refresh ready player list every 8 seconds
    setInterval(() => {
      if (window.playerReady && window.currentBet > 0) renderPlayerList();
    }, 8000);

    // Update balance display — prefer window.DAMA_BALANCE (from owner backend)
    const balEl = document.getElementById('myBalance');
    if (balEl) {
      const me = PlayerRegistry.load().find(p => p.id === window.tgUserId);
      const bal = window.DAMA_BALANCE ?? me?.balance ?? 500;
      balEl.textContent = Number(bal).toLocaleString();
    }

    renderPlayerList();
  });

  initParticles();
  initCountdown();
  initBetBar();
  initColorPicker();
});

/* ── 4. Button wiring ── */
function initApp() {
  if (window._appInitialized) return;
  window._appInitialized = true;
  injectRippleStyle();

  const playBtn = document.getElementById('playNowBtn');
  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      tgHaptic('light');
      ripple(playBtn, e);
      openAiModal();
    });
  }

  // Cancel button for AI modal
  document.getElementById('aiModalCloseBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('aiModal');
    if (modal) {
      modal.classList.remove('modal-show');
      setTimeout(() => modal.classList.add('hidden'), 300);
    }
  });

  // ── Balance refresh button ───────────────────────────────────
  document.getElementById('balRefreshBtn')?.addEventListener('click', () => {
    tgHaptic('light');
    refreshBalance();
  });

  // ── How to Play ──────────────────────────────────────────────
  document.getElementById('howToPlayBtn')?.addEventListener('click', () => {
    tgHaptic('light');
    const modal = document.getElementById('howToPlayModal');
    if (modal) {
      modal.classList.remove('hidden');
      setTimeout(() => modal.classList.add('modal-show'), 10);
    }
  });
  document.getElementById('howToPlayClose')?.addEventListener('click', () => {
    const modal = document.getElementById('howToPlayModal');
    if (modal) {
      modal.classList.remove('modal-show');
      setTimeout(() => modal.classList.add('hidden'), 300);
    }
  });
  document.getElementById('howToPlayModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'howToPlayModal') {
      const modal = document.getElementById('howToPlayModal');
      modal.classList.remove('modal-show');
      setTimeout(() => modal.classList.add('hidden'), 300);
    }
  });

  // ── History ──────────────────────────────────────────────────
  document.getElementById('historyBtn')?.addEventListener('click', () => {
    tgHaptic('light');
    const modal = document.getElementById('historyModal');
    if (modal) {
      modal.classList.remove('hidden');
      setTimeout(() => modal.classList.add('modal-show'), 10);
    }
    loadHistory();
  });
  document.getElementById('historyClose')?.addEventListener('click', () => {
    const modal = document.getElementById('historyModal');
    if (modal) {
      modal.classList.remove('modal-show');
      setTimeout(() => modal.classList.add('hidden'), 300);
    }
  });
  document.getElementById('historyModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'historyModal') {
      const modal = document.getElementById('historyModal');
      modal.classList.remove('modal-show');
      setTimeout(() => modal.classList.add('hidden'), 300);
    }
  });

  // Click on modal backdrop to close it too
  document.getElementById('aiModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'aiModal') {
      const modal = document.getElementById('aiModal');
      modal.classList.remove('modal-show');
      setTimeout(() => modal.classList.add('hidden'), 300);
    }
  });

  // Challenge accept / decline / cancel buttons
  document.getElementById('challengeAcceptBtn')?.addEventListener('click', () => {
    const invite = window.incomingChallenge;
    if (invite) {
      Socket.send('challenge_accept', {
        challengerId: invite.challenger.id,
        opponentId: window.tgUserId,
        betAmount: invite.betAmount
      });
    }
    document.getElementById('challengeModal')?.classList.add('hidden');
    document.getElementById('challengeModal')?.classList.remove('modal-show');
  });

  document.getElementById('challengeDeclineBtn')?.addEventListener('click', () => {
    const invite = window.incomingChallenge;
    if (invite) {
      Socket.send('challenge_decline', {
        challengerId: invite.challenger.id,
        opponentId: window.tgUserId
      });
    }
    document.getElementById('challengeModal')?.classList.add('hidden');
    document.getElementById('challengeModal')?.classList.remove('modal-show');
    window.incomingChallenge = null;
  });

  document.getElementById('waitingCancelBtn')?.addEventListener('click', () => {
    const challenge = window.activeChallenge;
    if (challenge) {
      Socket.send('challenge_decline', {
        challengerId: window.tgUserId,
        opponentId: challenge.opponentId
      });
    }
    document.getElementById('waitingModal')?.classList.add('hidden');
    document.getElementById('waitingModal')?.classList.remove('modal-show');
    window.activeChallenge = null;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

/* ── 5. Sync piece theme to registry whenever user changes it ── */
window.onPieceThemeChanged = function(theme) {
  if (!window.tgUserId) return;
  const list = PlayerRegistry.load();
  const me = list.find(p => p.id === window.tgUserId);
  if (me) { me.pieceThemeId = theme.id; PlayerRegistry.save(list); }
};

/* ── 6. Telegram hardware back button ── */
initBackButton(() => {
  if (!G.gameOver && G.mode === 'pvp' && G.isOnlinePvP && G.gameId) {
    window.Socket?.send('resign', { gameId: G.gameId, playerId: window.tgUserId });
    endGame(G.myColor === 'black' ? 2 : 1, 'You quit the game', true);
  }
  if (G.timerInterval) clearInterval(G.timerInterval);
  showScreen('mainMenu');
});

/* ── 7. WebSocket Event Handlers ── */
window.Socket = Socket;

Socket.on('challenge_receive', (msg) => {
  const modal = document.getElementById('challengeModal');
  const title = document.getElementById('challengeTitle');
  const sub = document.getElementById('challengeSub');
  const betVal = document.getElementById('challengeBet');

  if (title) title.textContent = `Match Challenge!`;
  if (sub) sub.textContent = `${msg.challenger.name} challenges you to a game.`;
  if (betVal) betVal.textContent = msg.betAmount;

  window.incomingChallenge = msg;

  if (modal) {
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('modal-show'), 10);
  }
});

Socket.on('challenge_declined', (msg) => {
  const modal = document.getElementById('waitingModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('modal-show');
  }
  window.activeChallenge = null;
  alert('Opponent declined your challenge.');
});

Socket.on('game_start', (msg) => {
  document.getElementById('challengeModal')?.classList.add('hidden');
  document.getElementById('challengeModal')?.classList.remove('modal-show');
  document.getElementById('waitingModal')?.classList.add('hidden');
  document.getElementById('waitingModal')?.classList.remove('modal-show');

  // Clear ready state — player is now in-game
  window.playerReady = false;
  if (window.tgUserId) PlayerRegistry.clearReadyOnBackend(window.tgUserId).catch(() => {});

  window.activeOnlineGame = {
    gameId: msg.gameId,
    myColor: msg.myColor,
    turn: msg.turn,
    betAmount: msg.betAmount,
    history: msg.history || []
  };

  startGame('pvp', msg.opponent);
});

Socket.on('move_made', (msg) => {
  executeMove(msg.from, msg.move, true);
});

Socket.on('game_over', (msg) => {
  let winnerColor = null;
  if (msg.winnerId) {
    if (msg.winnerId === window.tgUserId) {
      winnerColor = window.activeOnlineGame.myColor === 'black' ? 1 : 2; // BLACK=1, WHITE=2
    } else {
      winnerColor = window.activeOnlineGame.myColor === 'black' ? 2 : 1;
    }
  }
  endGame(winnerColor, msg.reason, true);
});

// Update local cache and re-render when any player's data changes (balance, wins, etc.)
Socket.on('player_updated', (msg) => {
  if (msg.player) {
    // Update this player in local registry cache
    const list = PlayerRegistry.load();
    const idx  = list.findIndex(p => p.id === msg.player.id);
    if (idx !== -1) {
      list[idx] = {
        ...list[idx],
        balance:     msg.player.balance,
        wins:        msg.player.wins,
        losses:      msg.player.losses,
        draws:       msg.player.draws,
        online:      msg.player.online === 1,
        isReady:     msg.player.is_ready === 1,
        readyBet:    msg.player.ready_bet || 0,
        lastSeen:    (msg.player.last_seen || 0) * 1000,
      };
      PlayerRegistry.save(list);
    }
    // If it's the current user, refresh balance from owner backend
    if (msg.player.id === window.tgUserId) {
      // Don't use Dama DB balance — fetch real balance from owner backend
      refreshBalance();
    }
  }
  // Refresh ready list if applicable
  if (window.playerReady && window.currentBet > 0) {
    renderPlayerList();
  }
});

Socket.on('opponent_left', (msg) => {
  const statusBar = document.getElementById('gameStatus');
  if (statusBar) {
    statusBar.innerHTML = `<span style="color:var(--accent);">⚠️ Opponent disconnected! Reconnecting...</span>`;
  }
});

Socket.on('opponent_rejoined', (msg) => {
  const statusBar = document.getElementById('gameStatus');
  if (statusBar) {
    statusBar.innerHTML = `<span style="color:var(--success);">✓ Opponent reconnected!</span>`;
  }
});

Socket.on('kicked', (msg) => {
  const modal = document.getElementById('kickedModal');
  const reasonEl = document.getElementById('kickedReason');
  if (reasonEl) reasonEl.textContent = msg.reason || 'You have been logged in on another device or tab.';
  if (modal) {
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('modal-show'), 10);
  }
});

/* ── 8. AI Opponent Modal population & render ── */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Fetch bots fresh from DB every time — no localStorage
async function fetchBotsFromDB() {
  const apiToken = window.DAMA_API_TOKEN || localStorage.getItem('dama_api_token') || '';
  const base = Socket.apiUrl;
  const res = await fetch(`${base}/ai/bots/public`, {
    headers: { 'Content-Type': 'application/json', ...(apiToken ? { 'X-API-Token': apiToken } : {}) }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
}

function openAiModal() {
  const modal = document.getElementById('aiModal');
  const container = document.getElementById('aiBotList');
  if (!modal || !container) return;

  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('modal-show'), 10);
  container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);">Loading bots…</div>`;

  fetchBotsFromDB()
    .then(bots => renderBotsList(bots, container, modal))
    .catch(() => {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red);">Failed to load bots. Please try again.</div>`;
    });
}

function pctToTier(pct) {
  if (pct <= 20) return { label: 'Very Easy', cls: 'bot-diff-veryeasy', color: '#4cde80' }
  if (pct <= 40) return { label: 'Easy',      cls: 'bot-diff-easy',    color: '#7ded9a' }
  if (pct <= 60) return { label: 'Normal',    cls: 'bot-diff-medium',  color: '#f0c94a' }
  if (pct <= 80) return { label: 'Hard',      cls: 'bot-diff-hard',    color: '#f39c12' }
  return               { label: 'Very Hard',  cls: 'bot-diff-veryhard', color: '#e74c3c' }
}

function renderBotsList(bots, container, modal) {
  container.innerHTML = '';
  if (!bots || bots.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);">No AI bots found.</div>`;
    return;
  }

  // Sort easiest → hardest by pct
  const sorted = [...bots].sort((a, b) => (a.pct ?? 50) - (b.pct ?? 50));

  sorted.forEach(bot => {
    // ai_bots table returns: id, name, depth, pct, wins, losses, draws
    const pct  = bot.pct  ?? 50;
    const tier = pctToTier(pct);
    const row  = document.createElement('div');
    row.className = 'bot-select-row';

    row.innerHTML = `
      <div class="bot-select-avatar">🤖</div>
      <div class="bot-select-info">
        <div class="bot-select-name">${escHtml(bot.name)}</div>
        <div class="bot-select-meta">
          <span class="bot-diff-badge ${tier.cls}">${tier.label}</span>
          <div class="bot-diff-bar-wrap">
            <div class="bot-diff-bar-track">
              <div class="bot-diff-bar-fill" style="width:${pct}%;background:${tier.color};"></div>
            </div>
            <span class="bot-diff-pct" style="color:${tier.color};">${pct}%</span>
          </div>
          <div class="bot-select-stats">
            <span style="color:#4cde80;">✔ ${bot.wins || 0}W</span>
            <span style="color:#e74c3c;margin-left:5px;">✖ ${bot.losses || 0}L</span>
          </div>
        </div>
      </div>
      <div class="bot-select-play">▶</div>
    `;

    row.addEventListener('click', () => {
      tgHaptic('medium');
      modal.classList.remove('modal-show');
      setTimeout(() => modal.classList.add('hidden'), 300);
      // Pass bot with aiPct so engine.js picks up the right difficulty
      startGame('ai', { ...bot, aiPct: pct });
    });

    container.appendChild(row);
  });
}

/* ── 9. History loader ── */
async function loadHistory() {
  const body = document.getElementById('historyBody');
  if (!body) return;
  body.innerHTML = '<div class="hist-loading">Loading…</div>';

  try {
    const apiToken = window.DAMA_API_TOKEN || localStorage.getItem('dama_api_token') || '';
    const base = Socket.apiUrl;
    const playerId = window.tgUserId;
    if (!playerId) {
      body.innerHTML = '<div class="hist-empty"><div class="hist-empty-icon">📜</div>Log in to see your history.</div>';
      return;
    }

    const res = await fetch(`${base}/games?playerId=${encodeURIComponent(playerId)}&limit=50`, {
      headers: { 'Content-Type': 'application/json', ...(apiToken ? { 'X-API-Token': apiToken } : {}) }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const games = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);

    if (games.length === 0) {
      body.innerHTML = '<div class="hist-empty"><div class="hist-empty-icon">📜</div>No games played yet.</div>';
      return;
    }

    body.innerHTML = '';
    games.forEach(game => {
      const isPlayer1  = game.player1_id === playerId;
      const won        = game.winner_id === playerId;
      const draw       = game.status === 'finished' && !game.winner_id;
      const result     = draw ? 'draw' : won ? 'win' : 'loss';
      const badge      = result === 'win' ? 'WIN' : result === 'loss' ? 'LOSS' : 'DRAW';

      // Use server-resolved names (joined from players / ai_bots tables)
      const myName     = isPlayer1
        ? (game.player1_name || game.player1_id)
        : (game.player2_name || game.player2_id);
      const oppName    = isPlayer1
        ? (game.player2_name || (game.mode === 'ai' ? '🤖 AI Bot' : game.player2_id || 'Unknown'))
        : (game.player1_name || game.player1_id || 'Unknown');
      const winnerName = game.winner_name || (draw ? null : (won ? myName : oppName));

      const shortId = game.id ? game.id.slice(0, 8).toUpperCase() : '—';

      const date = game.finished_at
        ? new Date(game.finished_at * 1000).toLocaleString(undefined, {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })
        : game.created_at
          ? new Date(game.created_at * 1000).toLocaleString(undefined, {
              month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit'
            })
          : '—';

      const duration = game.duration_sec && game.duration_sec > 0
        ? `${Math.floor(game.duration_sec / 60)}m ${game.duration_sec % 60}s`
        : null;

      const betAmt    = game.bet_amount || 0;
      const betDisplay = betAmt > 0
        ? `${result === 'win' ? '+' : result === 'loss' ? '−' : '±'}${betAmt} ETB`
        : game.mode === 'ai' ? 'Practice' : 'No bet';
      const betClass  = result === 'win'  && betAmt > 0 ? 'win-amount'
                      : result === 'loss' && betAmt > 0 ? 'loss-amount' : '';

      const row = document.createElement('div');
      row.className = 'hist-item';
      row.innerHTML = `
        <div class="hist-result-badge ${result}">${badge}</div>
        <div class="hist-info">
          <div class="hist-matchup">
            <span class="hist-p1">${escHtml(isPlayer1 ? myName : oppName)}</span>
            <span class="hist-vs">vs</span>
            <span class="hist-p2">${escHtml(isPlayer1 ? oppName : myName)}</span>
          </div>
          <div class="hist-meta">
            <span class="hist-gameid" title="Game ID: ${escHtml(game.id || '')}">🎮 #${shortId}</span>
            <span>${date}</span>
            ${duration ? `<span>⏱ ${duration}</span>` : ''}
            ${game.move_count ? `<span>♟ ${game.move_count} moves</span>` : ''}
          </div>
          ${winnerName ? `<div class="hist-winner">👑 Winner: ${escHtml(winnerName)}</div>` : draw ? '<div class="hist-winner draw">🤝 Draw</div>' : ''}
        </div>
        <div class="hist-right">
          <div class="hist-mode">${game.mode === 'ai' ? '🤖 AI' : '👥 PvP'}</div>
          <div class="hist-bet ${betClass}">${betDisplay}</div>
        </div>
      `;
      body.appendChild(row);
    });
  } catch (err) {
    body.innerHTML = `<div class="hist-empty"><div class="hist-empty-icon">⚠️</div>Failed to load history.</div>`;
    console.error('History load error:', err);
  }
}
