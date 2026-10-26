// ============================================================
// Version checker
// Compares the last commit time of index.html on GitHub with the
// time the current page was loaded. If a newer version exists,
// it shows a small "refresh" button.
// ============================================================

const VERSION_CHECK = (() => {
  // --- Config -------------------------------------------------
  const REPO_OWNER = 'expire-vip';
  const REPO_NAME  = 'expire.vip';
  const FILE_PATH  = 'index.html';

  // Only flag "outdated" if the new commit landed at least this
  // many minutes AFTER the page was loaded. Prevents false positives
  // when a commit lands while the page is loading.
  const COMMIT_DELAY_MINUTES = 3;

  // Check at most once every N minutes when auto-checking.
  const AUTO_CHECK_INTERVAL_MINUTES = 10;

  // ------------------------------------------------------------

  const STORAGE_KEY = 'expire_version_page_loaded_at';
  const LAST_CHECK_KEY = 'expire_version_last_check';

  // Record the page load time once per tab session.
  function recordPageLoad() {
    if (!sessionStorage.getItem(STORAGE_KEY)) {
      // navigationStart is the moment the navigation began, which is
      // a more accurate "page loaded" timestamp than Date.now().
      const loadedAt =
        window.performance?.timing?.navigationStart ||
        window.performance?.timeOrigin ||
        Date.now();
      sessionStorage.setItem(STORAGE_KEY, String(loadedAt));
    }
    return Number(sessionStorage.getItem(STORAGE_KEY));
  }

  // Fetch the most recent commit time for index.html.
  async function fetchLatestCommitTime() {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?path=${encodeURIComponent(FILE_PATH)}&per_page=1`;
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github.v3+json' }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const commits = await response.json();
    if (!Array.isArray(commits) || commits.length === 0) {
      throw new Error('No commits found for ' + FILE_PATH);
    }

    const commit = commits[0];
    // committer.date is the time the commit was applied to the repo.
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
      const pageLoadedAt = recordPageLoad();
      const latest = await fetchLatestCommitTime();

      const delayMs = COMMIT_DELAY_MINUTES * 60 * 1000;
      const isOutdated = latest.timestamp > (pageLoadedAt + delayMs);

      sessionStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

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

  // Auto-check once on load, then every N minutes while the tab is open.
  function startAutoCheck(onOutdated) {
    // Initial check after a short delay so we don't compete with
    // the app's own Google Drive / Calendar calls on startup.
    setTimeout(async () => {
      const result = await checkForUpdate();
      if (result.isOutdated) onOutdated(result);
    }, 5000);

    setInterval(async () => {
      // Don't burn API quota if the tab is hidden.
      if (document.visibilityState !== 'visible') return;
      const lastCheck = Number(sessionStorage.getItem(LAST_CHECK_KEY) || 0);
      if (Date.now() - lastCheck < AUTO_CHECK_INTERVAL_MINUTES * 60 * 1000) return;

      const result = await checkForUpdate();
      if (result.isOutdated) onOutdated(result);
    }, 60 * 1000); // poll every minute, but gated by the interval above
  }

  // Expose a manual trigger for a debug button or console use.
  return { checkForUpdate, startAutoCheck, recordPageLoad };
})();

// ---------- Wiring it into your UI ----------

// Record load time immediately on script parse.
VERSION_CHECK.recordPageLoad();

// Show a small refresh banner when an update is detected.
function showUpdateBanner(info) {
  // Don't show twice.
  if (document.getElementById('appUpdateBanner')) return;

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

// Start auto-checking. Only runs when the app screen is visible.
VERSION_CHECK.startAutoCheck((info) => {
  console.log('[VersionCheck] Outdated:', info);
  showUpdateBanner(info);
});
