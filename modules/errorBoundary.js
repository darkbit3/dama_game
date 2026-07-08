// Global error handling for the frontend
export const initErrorBoundary = () => {
  window.addEventListener('error', (e) => {
    console.error('Global error caught:', e.error);
    // Show a simple overlay
    const overlay = document.createElement('div');
    overlay.className = 'error-fallback';
    overlay.style.position = 'fixed';
    overlay.style.top = 0;
    overlay.style.left = 0;
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0,0,0,0.8)';
    overlay.style.color = '#fff';
    overlay.style.zIndex = 10000;
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.innerHTML = `
      <h2>Oops! Something went wrong.</h2>
      <p>Please refresh the page.</p>
      <button id="errorRetryBtn">Refresh</button>
    `;
    document.body.appendChild(overlay);
    document.getElementById('errorRetryBtn').onclick = () => location.reload();
  });
};
