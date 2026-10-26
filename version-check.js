// ============================================================
// Version checker
// Compares the last commit time of index.html on GitHub with the
// time the current page was loaded. If a newer version exists,
// it shows a small "refresh" button.
//
// Note: the page-load time is read directly from performance.timeOrigin
// (or navigationStart as a fallback) on every check — it is NOT stored
// in sessionStorage, because sessionStorage survives reloads and would
// make the banner show forever once a commit lands.
// ============================================================

const VERSION_CHECK = (() => {
  // --- Config -------------------------------------------------
  const REPO_OWNER = 'expire-vip';
  const REPO_NAME  = 'expire.vip';
  const FILE_PATH  = 'index.html';

  // Only flag "outdated" if the new commit landed at least this
  // many minutes AFTER the page was loaded. Prevents false positives
  // when a commit lands while the page is loading or racing the deploy.
  const COMMIT_DELAY_MINUTES = 3;

  // Check at most once every N minutes when auto-checking.
  const AUTO_CHECK_INTERVAL_MINUTES = 10;

  // NEW: never check until the tab has been open for at least this long.
  // Prevents the banner from appearing right after a normal reload —
  // when you just loaded the page you already have the latest version.
  const MIN_TAB_AGE_MINUTES = 20;

  // ------------------------------------------------------------

  const LAST_CHECK_KEY = 'expire_version_last_check';

  // One-time cleanup: earlier versions of this file cached the load
  // time in sessionStorage, which caused the banner to show forever.
  // The key isn't read anymore, but we remove it so stale values from
  // old sessions cannot confuse future debugging.
  try { sessionStorage.removeItem('expire_version_page_loaded_at'); } catch (_) {}

  // Read the current page's load time. These values are epoch ms,
  // stable for the lifetime of the current page load, and reset
  // automatically on every reload — no storage needed.
  function getCurrentPageLoadTime() {
    if (window.performance?.timeOrigin) return window.performance.timeOrigin;
    const navStart = window.performance?.timing?.navigationStart;
    if (navStart && navStart > 0) return navStart;
    return Date.now();
  }

  // Fetch the most recent commit time for index.html.
  async function fetchLatestCommitTime() {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?path=${encodeURIComponent(FILE_PATH)}&per_page=1`;
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      // Never serve from the browser cache — we need to see new commits.
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const commits = await response.json();
    if (!Array.isArray(commits) || commits.length === 0) {
      throw new Error('No commits found for ' + FILE_PATH);
    }

    const commit = commits[0];
    return {
      timestamp: new Date(commit.commit.committer.date).getTime(),
      sha: commit.sha,
      message: commit.commit.message.split('\n')[0],
      htmlUrl: commit.html_url
    };
  }

  // Core check.
  async function checkForUpdate() {
    try {
      const pageLoadedAt = getCurrentPageLoadTime();
      const latest = await fetchLatestCommitTime();

      const delayMs = COMMIT_DELAY_MINUTES * 60 * 1000;
      const isOutdated = latest.timestamp > (pageLoadedAt + delayMs);

      try { sessionStorage.setItem(LAST_CHECK_KEY, String(Date.now())); } catch (_) {}

      return {
        isOutdated,
        latestCommitTime: latest.timestamp,
        pageLoadedAt,
        delayMinutes: COMMIT_DELAY_MINUTES,
        commit: latest
      };
    } catch (error) {
      console.warn('[VersionCheck] Check failed:', error);
      return { isOutdated: false, error };
    }
  }

  // Auto-check only once the tab has been open a while. Never on first load.
  function startAutoCheck(onOutdated) {
    let lastHiddenAt = null;

    async function maybeCheck() {
      // Gate 1: tab must have been open long enough. Just-loaded pages
      // are already current, so a post-reload check would only nag.
      const pageAgeMs = Date.now() - getCurrentPageLoadTime();
      if (pageAgeMs < MIN_TAB_AGE_MINUTES * 60 * 1000) return;

      // Gate 2: don't hammer the GitHub API — at most one check per
      // AUTO_CHECK_INTERVAL_MINUTES, shared with any manual checks.
      let lastCheck = 0;
      try { lastCheck = Number(sessionStorage.getItem(LAST_CHECK_KEY) || 0); } catch (_) {}
      if (Date.now() - lastCheck < AUTO_CHECK_INTERVAL_MINUTES * 60 * 1000) return;

      const result = await checkForUpdate();
      if (result.isOutdated) onOutdated(result);
    }

    // Trigger 1: user comes back to the tab after having it in the background.
    // This is the most useful signal — they may have been away for hours.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        lastHiddenAt = Date.now();
      } else if (document.visibilityState === 'visible') {
        // Only bother if the tab was actually hidden for a meaningful time.
        // A quick tab-switch shouldn't trigger a network call.
        if (lastHiddenAt && (Date.now() - lastHiddenAt) >= 60 * 1000) {
          maybeCheck();
        }
        lastHiddenAt = null;
      }
    });

    // Trigger 2: long-lived session where the tab never went hidden.
    // Polls every 5 minutes, but maybeCheck() applies both gates above.
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      maybeCheck();
    }, 5 * 60 * 1000);
  }

  return { checkForUpdate, startAutoCheck };
})();

// ---------- Wiring it into your UI ----------

// Show a small refresh banner when an update is detected.
function showUpdateBanner(info) {
  if (document.getElementById('appUpdateBanner')) return; // don't show twice

  const banner = document.createElement('div');
  banner.id = 'appUpdateBanner';
  banner.style.cssText = [
    'position:fixed',
    'left:50%',
    'transform:translateX(-50%)',
    'bottom:calc(90px + env(safe-area-inset-bottom))',
    'z-index:99999',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'padding:10px 16px',
    'border-radius:14px',
    'background:#1e1b4b',
    'color:#e0e7ff',
    'font-size:13px',
    'font-weight:600',
    'box-shadow:0 10px 30px rgba(0,0,0,.35)',
    'border:1px solid #4338ca'
  ].join(';');
  banner.innerHTML = `
    <span>🚀 A new version is available</span>
    <button id="appUpdateReloadBtn" style="
      background:#4f46e5;color:#fff;border:0;border-radius:10px;
      padding:6px 12px;font-weight:700;cursor:pointer;font-size:13px
    ">Refresh</button>
    <button id="appUpdateDismissBtn" style="
      background:transparent;color:#a5b4fc;border:0;
      font-size:18px;cursor:pointer;padding:0 4px
    " aria-label="Dismiss">×</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('appUpdateReloadBtn').onclick = () => location.reload();
  document.getElementById('appUpdateDismissBtn').onclick = () => banner.remove();
}

VERSION_CHECK.startAutoCheck((info) => {
  console.log('[VersionCheck] Outdated:', info);
  showUpdateBanner(info);
});
