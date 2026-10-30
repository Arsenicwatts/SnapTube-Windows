/**
 * SnapTube Desktop & Web — Client Application Logic
 * Grounded in Apple Human Interface Guidelines
 * Dual-Mode Engine: Seamlessly powers both Electron Desktop & Web Browser Deployments
 */

document.addEventListener('DOMContentLoaded', async () => {
  // ─── Environment Detection ──────────────────────────────────────────────────
  const isElectron = typeof window !== 'undefined' && typeof window.api !== 'undefined';

  // ─── Universal Client API Adapter (Desktop IPC + Web REST API) ──────────────
  const AppAPI = {
    searchVideos: async (query) => {
      if (isElectron) return await window.api.searchVideos(query);
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to search videos');
      return data.results || [];
    },

    getVideoInfo: async (url) => {
      if (isElectron) return await window.api.getVideoInfo(url);
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, cookiesBrowser: state.browserCookies })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to retrieve video details');
      return data;
    },

    getSuggestions: async (query) => {
      if (isElectron) return await window.api.getSuggestions(query);
      try {
        const res = await fetch(`/api/suggestions?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        return data.suggestions || [];
      } catch {
        return [];
      }
    },

    getDefaultDownloadPath: async () => {
      if (isElectron) return await window.api.getDefaultDownloadPath();
      return 'Browser Default (Downloads Folder)';
    },

    selectDownloadFolder: async () => {
      if (isElectron) return await window.api.selectDownloadFolder();
      return null;
    },

    startDownload: async (options) => {
      if (isElectron) {
        return await window.api.startDownload(options);
      }

      const downloadId = options.id;

      // 1. Kick off download job on server
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: downloadId,
          url: options.url,
          preset: options.preset,
          title: options.title,
          cookiesBrowser: state.browserCookies
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to start download');
      }

      const startData = await res.json().catch(() => ({}));

      // Fast cloud direct CDN stream (e.g. Cobalt API resolution)
      if (startData.fastStream && startData.downloadUrl) {
        const dl = state.downloads.get(downloadId);
        if (dl) {
          dl.percent = 100;
          dl.status = 'completed';
          dl.speed = 'Direct CDN';
          dl.downloadUrl = startData.downloadUrl;
          updateDownloadItemUI(dl);
          updateDownloadBadge();

          // Auto-trigger browser file download
          const a = document.createElement('a');
          a.href = startData.downloadUrl;
          a.download = `${(dl.title || 'media').replace(/[\\/:*?"<>|]/g, '_')}.${dl.preset.ext || 'mp4'}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          showToast(`Fast download ready: "${dl.title}"`, 'success');
        }
        return downloadId;
      }

      // 2. Set up SSE stream + Polling fallback for guaranteed real-time progress updates
      let isDone = false;
      let pollTimer = null;

      const handleUpdate = (data) => {
        if (!data || isDone) return;
        const dl = state.downloads.get(downloadId);
        if (!dl) return;

        if (typeof data.percent === 'number') dl.percent = Math.min(Math.max(data.percent, dl.percent), 100);
        if (data.speed) dl.speed = data.speed;
        if (data.eta) dl.eta = data.eta;
        if (data.totalSize) dl.totalSize = data.totalSize;
        if (data.downloadUrl) dl.downloadUrl = data.downloadUrl;

        if (data.status === 'completed' || (data.ready && data.downloadUrl)) {
          isDone = true;
          cleanup();
          dl.status = 'completed';
          dl.percent = 100;
          updateDownloadItemUI(dl);
          updateDownloadBadge();

          const targetUrl = data.downloadUrl || dl.downloadUrl;
          if (targetUrl) {
            const a = document.createElement('a');
            a.href = targetUrl;
            a.download = `${(dl.title || 'media').replace(/[\\/:*?"<>|]/g, '_')}.${dl.preset.ext || 'mp4'}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
          showToast(`Download complete: "${dl.title}"`, 'success');
        } else if (data.status === 'error') {
          isDone = true;
          cleanup();
          dl.status = 'error';
          dl.error = data.error;
          updateDownloadItemUI(dl);
          updateDownloadBadge();
          showToast(`Download failed: ${data.error || 'Extraction error'}`, 'error');
        } else {
          dl.status = 'downloading';
          updateDownloadItemUI(dl);
        }
      };

      const cleanup = () => {
        try { sse.close(); } catch (e) {}
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };

      const sse = new EventSource(`/api/download-progress?id=${downloadId}`);
      sse.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleUpdate(data);
        } catch (e) {}
      };
      sse.onerror = () => {
        // SSE disconnected; polling fallback continues uninterrupted
      };

      // Periodic status poll (every 750ms) ensures updates never stall or freeze on 0%
      pollTimer = setInterval(async () => {
        if (isDone) return;
        try {
          const pRes = await fetch(`/api/download-status?id=${downloadId}`);
          if (pRes.ok) {
            const pData = await pRes.json();
            handleUpdate(pData);
          }
        } catch (e) {}
      }, 750);

      return downloadId;
    },

    cancelDownload: async (id) => {
      if (isElectron) return await window.api.cancelDownload(id);
      try {
        await fetch('/api/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
      } catch (e) {}
      return true;
    },

    openFolder: async (path) => {
      if (isElectron) return await window.api.openFolder(path);
      showToast('Files are saved into your device Downloads folder', 'info');
      return true;
    },

    openFile: async (path) => {
      if (isElectron) return await window.api.openFile(path);
      showToast('Open the downloaded file from your Downloads folder', 'info');
      return true;
    },

    showInFolder: async (path) => {
      if (isElectron) return await window.api.showInFolder(path);
      showToast('Check your browser Downloads folder', 'info');
      return true;
    },

    getSettings: async () => {
      if (isElectron) return await window.api.getSettings();
      let local = {};
      try { local = JSON.parse(localStorage.getItem('snaptube_settings') || '{}'); } catch (e) {}
      return { downloadPath: 'Browser Downloads Folder', browserCookies: local.browserCookies || 'none' };
    },

    saveSettings: async (settings) => {
      if (isElectron) return await window.api.saveSettings(settings);
      try {
        const prev = JSON.parse(localStorage.getItem('snaptube_settings') || '{}');
        const merged = { ...prev, ...settings };
        localStorage.setItem('snaptube_settings', JSON.stringify(merged));
      } catch (e) {}
      return settings;
    },

    checkYtDlp: async () => {
      if (isElectron) return await window.api.checkYtDlp();
      const res = await fetch('/api/status');
      const data = await res.json();
      return {
        available: true,
        ytdlpPath: `Web Engine (${data.ytdlp})`,
        ffmpegPath: `FFmpeg (${data.ffmpeg})`
      };
    },

    updateYtDlp: async () => {
      if (isElectron) return await window.api.updateYtDlp();
      return 'Web engine is managed continuously by server.';
    },

    minimize: () => isElectron && window.api.minimize(),
    maximize: () => isElectron && window.api.maximize(),
    close: () => isElectron && window.api.close()
  };

  // ─── Application State ──────────────────────────────────────────────────────
  const state = {
    currentPage: 'home',
    downloadPath: '',
    browserCookies: 'none',
    downloads: new Map(),
    activeModalVideo: null,
    selectedPreset: null,
    modalActiveTab: 'video', // 'video' | 'audio'
    searchDebounceTimer: null,
    focusedSuggestionIdx: -1
  };

  // ─── DOM Elements ───────────────────────────────────────────────────────────
  const elements = {
    // Window Chrome
    btnClose: document.getElementById('btn-close'),
    btnMinimize: document.getElementById('btn-minimize'),
    btnMaximize: document.getElementById('btn-maximize'),

    // Navigation
    navItems: document.querySelectorAll('.nav-item[data-page]'),
    pages: document.querySelectorAll('.page'),
    downloadBadge: document.getElementById('download-badge'),

    // Home
    heroSearch: document.getElementById('hero-search'),
    heroSearchBtn: document.getElementById('hero-search-btn'),
    heroSearchBox: document.getElementById('hero-search-box'),
    suggestionsDropdown: document.getElementById('suggestions-dropdown'),
    chipPasteTrigger: document.getElementById('chip-paste-trigger'),
    chipItems: document.querySelectorAll('.chip-item[data-query]'),
    qaPaste: document.getElementById('qa-paste'),
    qaBatch: document.getElementById('qa-batch'),
    qaMp3: document.getElementById('qa-mp3'),

    // Search Page
    pageSearch: document.getElementById('page-search'),
    searchQueryLabel: document.getElementById('search-query-label'),
    searchResults: document.getElementById('search-results'),

    // Paste Page
    pasteUrlInput: document.getElementById('paste-url-input'),
    pasteFetchBtn: document.getElementById('paste-fetch-btn'),
    pasteResult: document.getElementById('paste-result'),

    // Downloads Page
    downloadList: document.getElementById('download-list'),
    openDlFolderBtn: document.getElementById('open-dl-folder'),
    clearFinishedBtn: document.getElementById('clear-finished-btn'),

    // Settings Page
    settingsDlPath: document.getElementById('settings-dl-path'),
    settingsChangePath: document.getElementById('settings-change-path'),
    ytdlpStatus: document.getElementById('ytdlp-status'),
    settingsUpdateYtdlp: document.getElementById('settings-update-ytdlp'),
    settingsCookiesBrowser: document.getElementById('settings-cookies-browser'),

    // Modal Sheet
    videoModal: document.getElementById('video-modal'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalBody: document.getElementById('modal-body'),

    // Overlays
    loadingOverlay: document.getElementById('loading-overlay'),
    toastContainer: document.getElementById('toast-container')
  };

  // ─── Initialization ─────────────────────────────────────────────────────────
  try {
    state.downloadPath = await AppAPI.getDefaultDownloadPath();
    if (elements.settingsDlPath) {
      elements.settingsDlPath.value = state.downloadPath;
    }
  } catch (err) {
    console.warn('Initial path fetch notice:', err);
  }

  initWindowControls();
  initNavigation();
  initSearch();
  initPastePage();
  initDownloads();
  initSettings();
  initKeyboardShortcuts();
  checkEngineStatus();

  // ─── Window Controls (Apple Controls on the Right) ─────────────────────────
  function initWindowControls() {
    elements.btnMinimize?.addEventListener('click', () => {
      if (isElectron) AppAPI.minimize();
      else showToast('Minimize via your browser tab or window controls', 'info');
    });

    elements.btnMaximize?.addEventListener('click', () => {
      if (isElectron) {
        AppAPI.maximize();
      } else {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      }
    });

    elements.btnClose?.addEventListener('click', () => {
      if (isElectron) AppAPI.close();
      else showToast('Close or switch tabs directly in your browser', 'info');
    });
  }

  // ─── Navigation ─────────────────────────────────────────────────────────────
  function initNavigation() {
    elements.navItems.forEach(item => {
      item.addEventListener('click', () => {
        const pageName = item.getAttribute('data-page');
        navigateTo(pageName);
      });
    });

    // Quick Action Cards on Home
    elements.qaPaste?.addEventListener('click', () => {
      navigateTo('paste');
      elements.pasteUrlInput?.focus();
      readClipboardAndPaste();
    });

    elements.qaBatch?.addEventListener('click', () => {
      navigateTo('home');
      elements.heroSearch?.focus();
      showToast('Enter keywords or paste video URL in the search capsule', 'info');
    });

    elements.qaMp3?.addEventListener('click', () => {
      navigateTo('paste');
      elements.pasteUrlInput.placeholder = 'Paste video URL to extract 320kbps MP3 audio...';
      elements.pasteUrlInput?.focus();
      readClipboardAndPaste();
    });

    elements.chipPasteTrigger?.addEventListener('click', () => {
      readClipboardAndPaste();
    });

    elements.chipItems.forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.getAttribute('data-query');
        if (q) {
          elements.heroSearch.value = q;
          handleSearchOrUrl(q);
        }
      });
    });
  }

  function navigateTo(pageName) {
    state.currentPage = pageName;

    elements.navItems.forEach(item => {
      if (item.getAttribute('data-page') === pageName) {
        item.classList.add('active');
        item.setAttribute('aria-current', 'page');
      } else {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
      }
    });

    elements.pages.forEach(page => {
      if (page.id === `page-${pageName}`) {
        page.classList.add('active');
      } else {
        page.classList.remove('active');
      }
    });

    if (pageName === 'downloads') {
      renderDownloadList();
    } else if (pageName === 'settings') {
      checkEngineStatus();
    }
  }

  async function readClipboardAndPaste() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = (await navigator.clipboard.readText()).trim();
        if (text && isUrl(text)) {
          if (state.currentPage === 'paste' && elements.pasteUrlInput) {
            elements.pasteUrlInput.value = text;
            fetchVideoFromPaste();
          } else {
            handleSearchOrUrl(text);
          }
          showToast('Pasted link from clipboard', 'info');
        }
      }
    } catch {}
  }

  // ─── Search & Auto-complete ─────────────────────────────────────────────────
  function initSearch() {
    elements.heroSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        hideSuggestions();
        handleSearchOrUrl(elements.heroSearch.value);
      } else if (e.key === 'Escape') {
        hideSuggestions();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        handleSuggestionArrowNav(e.key);
      }
    });

    elements.heroSearchBtn?.addEventListener('click', () => {
      hideSuggestions();
      handleSearchOrUrl(elements.heroSearch.value);
    });

    elements.heroSearch?.addEventListener('input', () => {
      const q = elements.heroSearch.value.trim();
      clearTimeout(state.searchDebounceTimer);

      if (q.length < 2 || isUrl(q)) {
        hideSuggestions();
        return;
      }

      state.searchDebounceTimer = setTimeout(async () => {
        try {
          const suggestions = await AppAPI.getSuggestions(q);
          renderSuggestions(suggestions);
        } catch {
          hideSuggestions();
        }
      }, 180);
    });

    document.addEventListener('click', (e) => {
      if (!elements.heroSearchBox?.contains(e.target)) {
        hideSuggestions();
      }
    });
  }

  function renderSuggestions(suggestions) {
    if (!suggestions || suggestions.length === 0) {
      hideSuggestions();
      return;
    }

    state.focusedSuggestionIdx = -1;
    elements.suggestionsDropdown.innerHTML = suggestions.map((s, idx) => `
      <div class="suggestion-row" data-query="${escapeHtml(s)}" data-index="${idx}" role="option">
        <svg class="suggestion-glyph" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span>${escapeHtml(s)}</span>
      </div>
    `).join('');

    elements.suggestionsDropdown.classList.remove('hidden');

    elements.suggestionsDropdown.querySelectorAll('.suggestion-row').forEach(row => {
      row.addEventListener('click', () => {
        const query = row.getAttribute('data-query');
        elements.heroSearch.value = query;
        hideSuggestions();
        handleSearchOrUrl(query);
      });
    });
  }

  function handleSuggestionArrowNav(key) {
    const rows = elements.suggestionsDropdown?.querySelectorAll('.suggestion-row');
    if (!rows || rows.length === 0) return;

    if (key === 'ArrowDown') {
      state.focusedSuggestionIdx = Math.min(state.focusedSuggestionIdx + 1, rows.length - 1);
    } else {
      state.focusedSuggestionIdx = Math.max(state.focusedSuggestionIdx - 1, 0);
    }

    rows.forEach((r, i) => {
      if (i === state.focusedSuggestionIdx) {
        r.classList.add('focused');
        elements.heroSearch.value = r.getAttribute('data-query') || '';
      } else {
        r.classList.remove('focused');
      }
    });
  }

  function hideSuggestions() {
    elements.suggestionsDropdown?.classList.add('hidden');
    state.focusedSuggestionIdx = -1;
  }

  async function handleSearchOrUrl(input) {
    let raw = (input || '').trim();
    if (!raw) return;

    if (isUrl(raw)) {
      if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
      navigateTo('paste');
      elements.pasteUrlInput.value = raw;
      await fetchVideoFromPaste();
    } else {
      navigateTo('search');
      executeSearch(raw);
    }
  }

  async function executeSearch(query) {
    if (elements.searchQueryLabel) {
      elements.searchQueryLabel.textContent = `"${query}"`;
    }

    elements.searchResults.innerHTML = `
      <div class="empty-glass-state">
        <div class="apple-spinner">
          <div class="spinner-blade"></div>
          <div class="spinner-blade"></div>
          <div class="spinner-blade"></div>
          <div class="spinner-blade"></div>
          <div class="spinner-blade"></div>
          <div class="spinner-blade"></div>
          <div class="spinner-blade"></div>
          <div class="spinner-blade"></div>
        </div>
        <p class="state-title" style="margin-top: 14px;">Searching across platforms...</p>
      </div>
    `;

    try {
      const results = await AppAPI.searchVideos(query);
      renderSearchResults(results, query);
    } catch (err) {
      elements.searchResults.innerHTML = `
        <div class="empty-glass-state">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#FF453A" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p class="state-title" style="color: #FF453A;">Search Interrupted</p>
          <p class="state-caption">${escapeHtml(err.message || String(err))}</p>
          <button class="apple-btn apple-btn-secondary" id="retry-search-btn" style="margin-top: 10px;">Retry</button>
        </div>
      `;
      document.getElementById('retry-search-btn')?.addEventListener('click', () => executeSearch(query));
    }
  }

  function renderSearchResults(videos, query) {
    if (!videos || videos.length === 0) {
      elements.searchResults.innerHTML = `
        <div class="empty-glass-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--label-tertiary)" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <p class="state-title">No Matching Media</p>
          <p class="state-caption">No results found for "${escapeHtml(query)}". Try different keywords or a direct link.</p>
        </div>
      `;
      return;
    }

    elements.searchResults.innerHTML = videos.map((video, idx) => `
      <div class="video-tile" data-index="${idx}" tabindex="0">
        <div class="tile-media">
          <img class="tile-thumb" src="${escapeHtml(video.thumbnail)}" alt="${escapeHtml(video.title)}" loading="lazy" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'320\\' height=\\'180\\' fill=\\'%2316161a\\'><rect width=\\'100%\\' height=\\'100%\\'/></svg>'">
          ${video.duration ? `<span class="tile-duration">${formatDuration(video.duration)}</span>` : ''}
          <div class="tile-overlay-play">
            <div class="play-glyph-circle">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>
            </div>
          </div>
        </div>
        <div class="tile-meta">
          <h3 class="tile-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</h3>
          <div class="tile-channel">
            <span>${escapeHtml(video.channel || 'Creator')}</span>
            ${video.view_count ? `<span>&bull; ${formatNumber(video.view_count)} views</span>` : ''}
          </div>
        </div>
      </div>
    `).join('');

    elements.searchResults.querySelectorAll('.video-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const idx = parseInt(tile.getAttribute('data-index'), 10);
        const video = videos[idx];
        if (video && video.url) {
          openVideoDetails(video.url);
        }
      });
    });
  }

  // ─── Paste URL Flow ─────────────────────────────────────────────────────────
  function initPastePage() {
    elements.pasteFetchBtn?.addEventListener('click', () => fetchVideoFromPaste());
    elements.pasteUrlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        fetchVideoFromPaste();
      }
    });
  }

  async function fetchVideoFromPaste() {
    let url = elements.pasteUrlInput?.value.trim();
    if (!url) {
      showToast('Please enter or paste a video link', 'error');
      return;
    }

    if (!/^https?:\/\//i.test(url) && isUrl(url)) {
      url = 'https://' + url;
      elements.pasteUrlInput.value = url;
    }

    if (!isUrl(url)) {
      showToast('Please enter a valid URL (e.g. YouTube, Instagram, TikTok)', 'error');
      return;
    }

    showLoading('Analyzing video streams & available qualities...');
    elements.pasteResult.classList.add('hidden');

    try {
      const info = await AppAPI.getVideoInfo(url);
      hideLoading();
      renderPasteResult(info);
      openVideoModal(info);
    } catch (err) {
      hideLoading();
      const rawMsg = err.message || String(err);
      const cleanMsg = rawMsg.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '');
      showToast(cleanMsg, 'error', 4500);
      elements.pasteResult.innerHTML = `
        <div class="glass-card" style="border-color: rgba(255, 69, 58, 0.35);">
          <div class="card-title" style="color: #FF453A;">Extraction Notice</div>
          <div class="card-desc">${escapeHtml(cleanMsg)}</div>
          <div style="font-size: 11.5px; color: var(--apple-blue); margin-top: 4px;">
            Tip: If this website is restricted in your region, ensure your VPN connection is active.
          </div>
        </div>
      `;
      elements.pasteResult.classList.remove('hidden');
    }
  }

  function renderPasteResult(info) {
    elements.pasteResult.innerHTML = `
      <div class="glass-card" style="flex-direction: row; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 14px;">
          <img src="${escapeHtml(info.thumbnail)}" style="width: 72px; height: 44px; object-fit: cover; border-radius: 6px;" onerror="this.style.display='none'">
          <div>
            <div style="font-weight: 600; font-size: 14px;">${escapeHtml(info.title)}</div>
            <div style="font-size: 12px; color: var(--label-secondary);">${escapeHtml(info.channel)} &bull; ${info.presets.length} Formats Available</div>
          </div>
        </div>
        <button class="apple-btn apple-btn-primary" id="paste-pick-quality-btn">
          <span>Choose Format</span>
        </button>
      </div>
    `;
    elements.pasteResult.classList.remove('hidden');

    document.getElementById('paste-pick-quality-btn')?.addEventListener('click', () => {
      openVideoModal(info);
    });
  }

  // ─── Apple Sheet Modal (Quality Selector) ──────────────────────────────────
  async function openVideoDetails(url) {
    showLoading('Fetching stream metadata...');
    try {
      const info = await AppAPI.getVideoInfo(url);
      hideLoading();
      openVideoModal(info);
    } catch (err) {
      hideLoading();
      showToast(`Error: ${err.message || err}`, 'error');
    }
  }

  function openVideoModal(info) {
    state.activeModalVideo = info;
    state.modalActiveTab = 'video';
    const videoPresets = info.presets.filter(p => p.type === 'video');
    const audioPresets = info.presets.filter(p => p.type === 'audio');
    state.selectedPreset = videoPresets[0] || info.presets[0];

    renderModalContent();
    elements.videoModal.classList.remove('hidden');
  }

  function renderModalContent() {
    const info = state.activeModalVideo;
    if (!info) return;

    const videoPresets = info.presets.filter(p => p.type === 'video');
    const audioPresets = info.presets.filter(p => p.type === 'audio');
    const activeList = state.modalActiveTab === 'video' ? videoPresets : audioPresets;

    elements.modalBody.innerHTML = `
      <img class="sheet-hero-thumb" src="${escapeHtml(info.thumbnail)}" alt="${escapeHtml(info.title)}" onerror="this.style.display='none'">
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <h2 class="sheet-title" id="modal-video-title">${escapeHtml(info.title)}</h2>
        <div class="sheet-meta-pills">
          <span>${escapeHtml(info.channel || 'Creator')}</span>
          ${info.duration ? `<span>&bull; ${formatDuration(info.duration)}</span>` : ''}
          ${info.view_count ? `<span>&bull; ${formatNumber(info.view_count)} views</span>` : ''}
        </div>
      </div>

      <!-- Segmented Control for Video / Audio -->
      <div class="segmented-control" role="tablist">
        <button class="segment-btn ${state.modalActiveTab === 'video' ? 'active' : ''}" id="tab-opt-video" role="tab" aria-selected="${state.modalActiveTab === 'video'}">
          Video (MP4)
        </button>
        <button class="segment-btn ${state.modalActiveTab === 'audio' ? 'active' : ''}" id="tab-opt-audio" role="tab" aria-selected="${state.modalActiveTab === 'audio'}">
          Audio (MP3 / M4A)
        </button>
      </div>

      <!-- Quality Options List -->
      <div class="quality-options-list" id="modal-quality-list" role="radiogroup">
        ${activeList.map((preset) => {
          const isSelected = state.selectedPreset === preset;
          return `
            <div class="quality-card ${isSelected ? 'selected' : ''}" data-format="${escapeHtml(preset.format)}" role="radio" aria-checked="${isSelected}" tabindex="0">
              <div style="display: flex; align-items: center;">
                <span class="quality-tag ${preset.type === 'audio' ? 'audio' : (preset.height >= 720 ? 'hd' : 'sd')}">
                  ${preset.type === 'audio' ? preset.ext.toUpperCase() : (preset.height >= 2160 ? '4K' : (preset.height ? `${preset.height}P` : 'MP4'))}
                </span>
                <span class="quality-title">${escapeHtml(preset.label)}</span>
              </div>
              <span class="quality-size-text">${preset.filesize ? formatBytes(preset.filesize) : 'Direct Stream'}</span>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Prominent Primary Download Action -->
      <button class="apple-btn apple-btn-primary" id="modal-download-btn" style="height: 40px; font-size: 14px; margin-top: 8px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>Download Media</span>
      </button>
    `;

    // Tab buttons
    document.getElementById('tab-opt-video')?.addEventListener('click', () => {
      state.modalActiveTab = 'video';
      state.selectedPreset = videoPresets[0] || state.selectedPreset;
      renderModalContent();
    });

    document.getElementById('tab-opt-audio')?.addEventListener('click', () => {
      state.modalActiveTab = 'audio';
      state.selectedPreset = audioPresets[0] || state.selectedPreset;
      renderModalContent();
    });

    // Preset items click
    elements.modalBody.querySelectorAll('.quality-card').forEach((card, idx) => {
      card.addEventListener('click', () => {
        elements.modalBody.querySelectorAll('.quality-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        state.selectedPreset = activeList[idx];
      });
    });

    // Download action
    document.getElementById('modal-download-btn')?.addEventListener('click', () => {
      const selected = state.selectedPreset || activeList[0];
      closeModal();
      triggerDownload(info, selected);
    });
  }

  function closeModal() {
    elements.videoModal?.classList.add('hidden');
    state.activeModalVideo = null;
  }

  elements.modalCloseBtn?.addEventListener('click', closeModal);
  elements.videoModal?.addEventListener('click', (e) => {
    if (e.target === elements.videoModal) closeModal();
  });

  // ─── Download Execution & Queue Management ──────────────────────────────────
  function initDownloads() {
    elements.openDlFolderBtn?.addEventListener('click', () => {
      AppAPI.openFolder(state.downloadPath);
    });

    elements.clearFinishedBtn?.addEventListener('click', () => {
      for (const [id, dl] of state.downloads.entries()) {
        if (dl.status === 'completed' || dl.status === 'error') {
          state.downloads.delete(id);
        }
      }
      renderDownloadList();
      updateDownloadBadge();
      showToast('Cleared finished downloads', 'info');
    });

    if (isElectron) {
      window.api.onDownloadProgress((data) => {
        const dl = state.downloads.get(data.id);
        if (dl) {
          dl.percent = data.percent;
          dl.speed = data.speed;
          dl.eta = data.eta;
          dl.totalSize = data.totalSize;
          dl.status = data.percent >= 100 ? 'completing' : 'downloading';
          updateDownloadItemUI(dl);
        }
      });

      window.api.onDownloadComplete((data) => {
        const dl = state.downloads.get(data.id);
        if (dl) {
          dl.status = data.success ? 'completed' : 'error';
          dl.percent = data.success ? 100 : dl.percent;
          dl.filePath = data.filePath;
          dl.outputDir = data.outputDir;
          updateDownloadItemUI(dl);
          updateDownloadBadge();
          if (data.success) {
            showToast(`Downloaded: "${dl.title}"`, 'success');
          } else {
            showToast(`Download failed: "${dl.title}"`, 'error');
          }
        }
      });

      window.api.onDownloadError((data) => {
        const dl = state.downloads.get(data.id);
        if (dl) {
          dl.status = 'error';
          dl.error = data.error;
          updateDownloadItemUI(dl);
          updateDownloadBadge();
          showToast(`Error: ${data.error}`, 'error');
        }
      });
    }
  }

  async function triggerDownload(video, preset) {
    const downloadId = (isElectron ? 'el-' : 'web-') + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

    const dlItem = {
      id: downloadId,
      url: video.webpage_url || video.url,
      title: video.title || 'media',
      channel: video.channel || 'Media',
      thumbnail: video.thumbnail || '',
      preset,
      percent: 2,
      speed: 'Connecting...',
      eta: '--:--',
      totalSize: 'Calculating...',
      status: 'downloading',
      outputDir: state.downloadPath,
      filePath: null,
      downloadUrl: null,
      startTime: Date.now()
    };

    // Pre-register item in state BEFORE invoking download API to avoid any race condition
    state.downloads.set(downloadId, dlItem);
    updateDownloadBadge();
    renderDownloadList();
    navigateTo('downloads');
    showToast(`Starting download: ${dlItem.title} (${preset.label})`, 'info');

    try {
      await AppAPI.startDownload({
        id: downloadId,
        url: dlItem.url,
        preset,
        title: dlItem.title,
        outputDir: state.downloadPath
      });
    } catch (err) {
      const dl = state.downloads.get(downloadId);
      if (dl) {
        dl.status = 'error';
        dl.error = err.message || String(err);
        updateDownloadItemUI(dl);
        updateDownloadBadge();
      }
      showToast(`Failed to initiate download: ${err.message || err}`, 'error');
    }
  }

  function renderDownloadList() {
    if (!elements.downloadList) return;

    if (state.downloads.size === 0) {
      elements.downloadList.innerHTML = `
        <div class="empty-glass-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--label-tertiary)" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <p class="state-title">No Active Downloads</p>
          <p class="state-caption">Download media from Home, Search, or Paste URL to manage progress here.</p>
        </div>
      `;
      return;
    }

    elements.downloadList.innerHTML = Array.from(state.downloads.values()).reverse().map(dl => createDownloadItemHtml(dl)).join('');
    attachDownloadActions();
  }

  function createDownloadItemHtml(dl) {
    const isCompleted = dl.status === 'completed';
    const isError = dl.status === 'error';

    return `
      <div class="download-row" id="dl-item-${dl.id}">
        <div class="dl-thumb-wrap">
          <img class="dl-thumb-img" src="${escapeHtml(dl.thumbnail)}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'80\\' height=\\'48\\' fill=\\'%2316161a\\'><rect width=\\'100%\\' height=\\'100%\\'/></svg>'">
        </div>
        <div class="dl-info-col">
          <div class="dl-title-text" title="${escapeHtml(dl.title)}">${escapeHtml(dl.title)}</div>
          <div class="dl-meta-row">
            <span>${escapeHtml(dl.preset.label)}</span>
            <span>&bull;</span>
            <span id="dl-statustext-${dl.id}">
              ${isCompleted ? 'Finished' : (isError ? 'Failed' : `${dl.percent.toFixed(1)}% &bull; ${dl.speed} &bull; ETA ${dl.eta}`)}
            </span>
          </div>
          <div class="apple-progress-track">
            <div class="apple-progress-bar ${isCompleted ? 'completed' : (isError ? 'error' : '')}" id="dl-progress-${dl.id}" style="width: ${dl.percent}%;"></div>
          </div>
        </div>
        <div class="dl-actions-col" id="dl-actions-${dl.id}">
          ${isCompleted ? `
            <button class="apple-btn apple-btn-secondary dl-btn-open" data-id="${dl.id}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              <span>${isElectron ? 'Open' : 'Save'}</span>
            </button>
            ${isElectron ? `
              <button class="btn-icon-round dl-btn-show" data-id="${dl.id}" title="Show in folder">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </button>
            ` : ''}
          ` : (isError ? `
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #FF453A; font-weight: 600; font-size: 11.5px;">Failed</span>
              <button class="apple-btn apple-btn-secondary dl-btn-retry" data-id="${dl.id}" style="padding: 4px 10px; font-size: 11px;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                <span>Retry</span>
              </button>
            </div>
          ` : `
            <button class="btn-icon-round dl-btn-cancel" data-id="${dl.id}" title="Cancel download">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          `)}
        </div>
      </div>
    `;
  }

  function updateDownloadItemUI(dl) {
    const el = document.getElementById(`dl-item-${dl.id}`);
    if (!el) {
      if (state.currentPage === 'downloads') renderDownloadList();
      return;
    }

    const progressFill = document.getElementById(`dl-progress-${dl.id}`);
    const statusText = document.getElementById(`dl-statustext-${dl.id}`);
    const actionsCol = document.getElementById(`dl-actions-${dl.id}`);

    if (progressFill) {
      progressFill.style.width = `${dl.percent}%`;
      if (dl.status === 'completed') progressFill.className = 'apple-progress-bar completed';
      if (dl.status === 'error') progressFill.className = 'apple-progress-bar error';
    }

    if (statusText) {
      statusText.innerHTML = dl.status === 'completed'
        ? 'Finished'
        : (dl.status === 'error' ? `Failed: ${escapeHtml(dl.error || 'Network error')}` : `${dl.percent.toFixed(1)}% &bull; ${dl.speed} &bull; ETA ${dl.eta}`);
    }

    if (dl.status === 'completed' || dl.status === 'error') {
      if (actionsCol) {
        if (dl.status === 'completed') {
          actionsCol.innerHTML = `
            <button class="apple-btn apple-btn-secondary dl-btn-open" data-id="${dl.id}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              <span>${isElectron ? 'Open' : 'Save'}</span>
            </button>
            ${isElectron ? `
              <button class="btn-icon-round dl-btn-show" data-id="${dl.id}" title="Show in folder">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </button>
            ` : ''}
          `;
          attachDownloadActions();
        } else {
          actionsCol.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #FF453A; font-weight: 600; font-size: 11.5px;">Failed</span>
              <button class="apple-btn apple-btn-secondary dl-btn-retry" data-id="${dl.id}" style="padding: 4px 10px; font-size: 11px;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                <span>Retry</span>
              </button>
            </div>
          `;
          attachDownloadActions();
        }
      }
    }
  }

  function attachDownloadActions() {
    elements.downloadList?.querySelectorAll('.dl-btn-cancel').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-id');
        await AppAPI.cancelDownload(id);
        const dl = state.downloads.get(id);
        if (dl) {
          dl.status = 'error';
          updateDownloadItemUI(dl);
          updateDownloadBadge();
          showToast('Download cancelled', 'info');
        }
      };
    });

    elements.downloadList?.querySelectorAll('.dl-btn-retry').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-id');
        const dl = state.downloads.get(id);
        if (dl) {
          dl.status = 'downloading';
          dl.percent = 2;
          dl.speed = 'Retrying...';
          dl.error = null;
          updateDownloadItemUI(dl);
          updateDownloadBadge();
          showToast(`Retrying: "${dl.title}"`, 'info');

          try {
            await AppAPI.startDownload({
              id: dl.id,
              url: dl.url,
              preset: dl.preset,
              title: dl.title,
              outputDir: dl.outputDir
            });
          } catch (err) {
            dl.status = 'error';
            dl.error = err.message || String(err);
            updateDownloadItemUI(dl);
            updateDownloadBadge();
          }
        }
      };
    });

    elements.downloadList?.querySelectorAll('.dl-btn-open').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const dl = state.downloads.get(id);
        if (dl) {
          if (isElectron) {
            if (dl.filePath) AppAPI.openFile(dl.filePath);
            else AppAPI.openFolder(dl.outputDir);
          } else if (dl.downloadUrl) {
            const a = document.createElement('a');
            a.href = dl.downloadUrl;
            a.download = `${dl.title}.${dl.preset.ext || 'mp4'}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
        }
      };
    });

    elements.downloadList?.querySelectorAll('.dl-btn-show').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const dl = state.downloads.get(id);
        if (dl) {
          if (dl.filePath) AppAPI.showInFolder(dl.filePath);
          else AppAPI.openFolder(dl.outputDir);
        }
      };
    });
  }

  function updateDownloadBadge() {
    const active = Array.from(state.downloads.values()).filter(d => d.status === 'downloading' || d.status === 'completing').length;
    if (elements.downloadBadge) {
      if (active > 0) {
        elements.downloadBadge.textContent = active;
        elements.downloadBadge.classList.remove('hidden');
      } else {
        elements.downloadBadge.classList.add('hidden');
      }
    }
  }

  // ─── Settings Page ──────────────────────────────────────────────────────────
  async function initSettings() {
    try {
      const saved = await AppAPI.getSettings();
      if (saved && saved.browserCookies) {
        state.browserCookies = ['none', 'firefox'].includes(saved.browserCookies) ? saved.browserCookies : 'none';
        if (elements.settingsCookiesBrowser) elements.settingsCookiesBrowser.value = state.browserCookies;
      }
    } catch (e) {}

    elements.settingsCookiesBrowser?.addEventListener('change', async (e) => {
      state.browserCookies = e.target.value;
      await AppAPI.saveSettings({ browserCookies: state.browserCookies });
      showToast(`Cookies updated: ${e.target.options[e.target.selectedIndex].text}`, 'info');
    });

    elements.settingsChangePath?.addEventListener('click', async () => {
      const selected = await AppAPI.selectDownloadFolder();
      if (selected) {
        state.downloadPath = selected;
        if (elements.settingsDlPath) elements.settingsDlPath.value = selected;
        showToast('Download location updated', 'success');
      }
    });

    elements.settingsUpdateYtdlp?.addEventListener('click', async () => {
      showLoading('Checking extraction engine status...');
      try {
        const msg = await AppAPI.updateYtDlp();
        hideLoading();
        showToast(msg || 'Engine is up to date', 'success');
        checkEngineStatus();
      } catch (err) {
        hideLoading();
        showToast(`Update notice: ${err.message || err}`, 'info');
      }
    });
  }

  async function checkEngineStatus() {
    if (!elements.ytdlpStatus) return;
    try {
      const status = await AppAPI.checkYtDlp();
      if (status.available) {
        elements.ytdlpStatus.innerHTML = `<span style="color: var(--apple-green);">● Active</span> &bull; <small style="color: var(--label-secondary);">${status.ytdlpPath}</small>`;
      } else {
        elements.ytdlpStatus.textContent = 'Initializing engine...';
      }
    } catch {
      elements.ytdlpStatus.textContent = 'Engine Ready';
    }
  }

  // ─── Keyboard Shortcuts (Apple Conventions) ─────────────────────────────────
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigateTo('home');
        elements.heroSearch?.focus();
        elements.heroSearch?.select();
      }

      if (e.key === 'Escape') {
        if (!elements.videoModal.classList.contains('hidden')) {
          closeModal();
        } else if (!elements.suggestionsDropdown.classList.contains('hidden')) {
          hideSuggestions();
        }
      }
    });
  }

  // ─── UI Helpers ─────────────────────────────────────────────────────────────
  function isUrl(str) {
    if (!str) return false;
    const trimmed = str.trim();
    return /^(https?:\/\/)?(www\.)?[a-zA-Z0-9][-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)$/i.test(trimmed) ||
           /^(https?:\/\/)?(?:www\.)?(youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.watch|tiktok\.com|twitter\.com|x\.com|vimeo\.com|dailymotion\.com|reddit\.com|twitch\.tv)/i.test(trimmed);
  }

  function showLoading(text = 'Processing...') {
    if (elements.loadingOverlay) {
      const label = elements.loadingOverlay.querySelector('.spinner-text');
      if (label) label.textContent = text;
      elements.loadingOverlay.classList.remove('hidden');
    }
  }

  function hideLoading() {
    elements.loadingOverlay?.classList.add('hidden');
  }

  function showToast(message, type = 'info', duration = 3500) {
    if (!elements.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `apple-toast`;

    let glyph = '';
    if (type === 'success') {
      glyph = `<svg class="toast-glyph" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#30D158" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else if (type === 'error') {
      glyph = `<svg class="toast-glyph" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF453A" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    } else {
      glyph = `<svg class="toast-glyph" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A84FF" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }

    toast.innerHTML = `${glyph}<span>${escapeHtml(message)}</span>`;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px) scale(0.95)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function formatNumber(num) {
    if (!num || isNaN(num)) return '0';
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
  }

  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
});
