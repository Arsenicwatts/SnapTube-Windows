/**
 * SnapTube Core Engine — Production-grade Media Extraction & Downloader
 * Enterprise-grade multi-platform engine: Fast Cloud API + yt-dlp + FFmpeg
 * Supports mainstream platforms (YouTube, Instagram, TikTok, X, Reddit) & 1,000+ niche/adult sites
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const os = require('os');

// ─── Binary Path Resolution ───────────────────────────────────────────────────

let cachedYtDlpPath = null;
let cachedFfmpegPath = null;

function getYtDlpPath() {
  if (cachedYtDlpPath && fs.existsSync(cachedYtDlpPath)) return cachedYtDlpPath;

  const candidates = [
    // 1. Direct project bin folder (self-contained)
    path.join(__dirname, 'bin', 'yt-dlp.exe'),
    path.join(__dirname, 'bin', 'yt-dlp'),
    // 2. Electron AppData location
    path.join(process.env.APPDATA || '', 'snaptube-desktop', 'tools', 'yt-dlp.exe'),
    // 3. Local root
    path.join(__dirname, 'yt-dlp.exe'),
    path.join(__dirname, 'yt-dlp'),
    // 4. Packaged resources
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'yt-dlp.exe') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'tools', 'yt-dlp.exe') : null
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedYtDlpPath = c;
      return cachedYtDlpPath;
    }
  }

  // 5. System PATH lookup
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32' ? 'where.exe yt-dlp' : 'which yt-dlp';
    const out = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) {
      cachedYtDlpPath = out;
      return cachedYtDlpPath;
    }
  } catch (e) {}

  return null;
}

function getFfmpegPath() {
  if (cachedFfmpegPath && fs.existsSync(cachedFfmpegPath)) return cachedFfmpegPath;

  // 1. npm module ffmpeg-static
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      cachedFfmpegPath = ffmpegStatic;
      return cachedFfmpegPath;
    }
  } catch (e) {}

  // 2. Local node_modules
  const localModule = path.join(__dirname, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
  if (fs.existsSync(localModule)) {
    cachedFfmpegPath = localModule;
    return cachedFfmpegPath;
  }

  // 3. Project bin folder
  const localBin = path.join(__dirname, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(localBin)) {
    cachedFfmpegPath = localBin;
    return cachedFfmpegPath;
  }

  // 4. System PATH lookup
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32' ? 'where.exe ffmpeg' : 'which ffmpeg';
    const out = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) {
      cachedFfmpegPath = out;
      return cachedFfmpegPath;
    }
  } catch (e) {}

  return null;
}

function getCleanEnv() {
  const env = { ...process.env };
  // Strip stale or closed proxy environment variables so VPN adapter takes priority
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.http_proxy;
  delete env.https_proxy;
  delete env.ALL_PROXY;
  delete env.all_proxy;
  return env;
}

function getYtDlpRunner(userArgs, customProxy = '') {
  const binary = getYtDlpPath();
  const finalArgs = [...userArgs];

  if (customProxy) {
    finalArgs.unshift('--proxy', customProxy);
  } else {
    // Explicitly bypass dead local loopback proxies
    finalArgs.unshift('--proxy', '');
  }

  if (binary) {
    return { cmd: binary, args: finalArgs, env: getCleanEnv() };
  }
  return { cmd: 'python', args: ['-m', 'yt_dlp', ...finalArgs], env: getCleanEnv() };
}

// ─── Fast Cloud Resolver (Public API Integration) ─────────────────────────────

const COBALT_INSTANCES = [
  'https://api.cobalt.tools/api/json',
  'https://cobalt.api.redstream.online/api/json',
  'https://api.wuk.sh/api/json'
];

const COBALT_SUPPORTED_DOMAINS = [
  'youtube.com', 'youtu.be',
  'tiktok.com',
  'instagram.com',
  'twitter.com', 'x.com',
  'reddit.com',
  'soundcloud.com',
  'vimeo.com',
  'tumblr.com',
  'pinterest.com', 'pin.it',
  'vk.com',
  'dailymotion.com',
  'twitch.tv',
  'rutube.ru',
  'streamable.com',
  'threads.net',
  'bilibili.com'
];

function isCobaltSupported(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return COBALT_SUPPORTED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

async function tryCobaltResolver(videoUrl, isAudioOnly = false, quality = '1080') {
  // Only invoke Cobalt on supported platforms; skip immediately for niche / adult / generic sites
  if (!isCobaltSupported(videoUrl)) {
    return { success: false };
  }

  for (const instance of COBALT_INSTANCES) {
    try {
      const payload = JSON.stringify({
        url: videoUrl,
        videoQuality: quality === '2160' ? 'max' : (quality || '1080'),
        isAudioOnly: !!isAudioOnly,
        audioFormat: 'mp3',
        downloadMode: 'auto'
      });

      const parsedUrl = new URL(instance);
      const res = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 4500
        }, (resp) => {
          let data = '';
          resp.on('data', c => { data += c; });
          resp.on('end', () => {
            try { resolve({ status: resp.statusCode, body: JSON.parse(data) }); }
            catch { resolve({ status: resp.statusCode, body: null }); }
          });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(payload);
        req.end();
      });

      if (res.status === 200 && res.body) {
        if (res.body.url) {
          return {
            success: true,
            streamUrl: res.body.url,
            filename: res.body.filename || 'media',
            provider: 'cobalt'
          };
        }
      }
    } catch {}
  }
  return { success: false };
}

// ─── Smart Error Parser ───────────────────────────────────────────────────────

function parseExtractorError(stderr, stdout, code) {
  const combined = ((stderr || '') + ' ' + (stdout || '')).trim();

  if (/Failed to decrypt with DPAPI|DPAPI|App-Bound/i.test(combined)) {
    return 'Browser cookies could not be decrypted due to Windows security protection. Switched to direct extraction.';
  }
  if (/WinError 10049|WinError 10013|bind.*failed/i.test(combined)) {
    return 'Network connection conflict. Check network or VPN connection.';
  }
  if (/curl:\s*\(28\)|Connection timed out|timed out after|WinError 10060/i.test(combined)) {
    return 'Connection timed out. If this site is restricted by your ISP, please enable your VPN.';
  }
  if (/Sign in to confirm you(?:'|’)?re not a bot|bot check/i.test(combined)) {
    return 'This video requires account verification or temporary bot check.';
  }
  if (/HTTP Error 403|Forbidden/i.test(combined)) {
    return 'Access Forbidden (HTTP 403). The website is blocking access in this region or requires VPN.';
  }
  if (/HTTP Error 404|Video unavailable|does not exist|removed/i.test(combined)) {
    return 'Video not found or was removed from the source platform.';
  }
  if (/Unsupported URL/i.test(combined)) {
    return 'Unsupported video link format. Please check the URL.';
  }

  const lines = combined.split('\n').map(l => l.trim()).filter(l => l.startsWith('ERROR:'));
  if (lines.length > 0) {
    return lines[0].replace(/^ERROR:\s*/, '');
  }

  return combined || 'Failed to extract video details.';
}

// ─── Search Functionality ─────────────────────────────────────────────────────

async function searchVideos(query, maxResults = 18) {
  return new Promise((resolve, reject) => {
    const raw = (query || '').trim();
    if (!raw) return resolve([]);

    // Direct link detection
    if (/^(https?:\/\/|www\.)/i.test(raw)) {
      return getVideoInfo(raw)
        .then(info => resolve([{
          id: info.id,
          title: info.title,
          url: info.webpage_url || raw,
          thumbnail: info.thumbnail,
          duration: info.duration,
          channel: info.channel,
          view_count: info.view_count,
          upload_date: info.upload_date
        }]))
        .catch(err => reject(err));
    }

    const args = [
      `ytsearch${maxResults}:${raw}`,
      '--flat-playlist',
      '--dump-json',
      '--no-warnings',
      '--no-check-certificates',
      '--socket-timeout', '20',
      '--retries', '3',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      '--js-runtimes', 'node'
    ];

    let output = '';
    let stderr = '';
    const runner = getYtDlpRunner(args);
    const proc = spawn(runner.cmd, runner.args, { windowsHide: true, env: runner.env });

    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      try {
        const results = output.trim().split('\n')
          .filter(l => l.trim().startsWith('{'))
          .map(line => {
            try { return JSON.parse(line); }
            catch { return null; }
          })
          .filter(Boolean)
          .map(item => ({
            id: item.id,
            title: item.title,
            url: item.url || item.webpage_url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : ''),
            thumbnail: item.thumbnail ||
                       (item.thumbnails && item.thumbnails.length > 0 ? item.thumbnails[item.thumbnails.length - 1].url : '') ||
                       (item.id ? `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg` : ''),
            duration: item.duration,
            channel: item.channel || item.uploader || item.playlist_uploader || 'Creator',
            view_count: item.view_count,
            upload_date: item.upload_date
          }));

        if (results.length > 0 || code === 0) {
          resolve(results);
        } else {
          reject(new Error(parseExtractorError(stderr, output, code)));
        }
      } catch (e) {
        if (code !== 0) {
          reject(new Error(parseExtractorError(stderr, output, code)));
        } else {
          resolve([]);
        }
      }
    });

    proc.on('error', (err) => {
      reject(new Error(parseExtractorError(err.message, '', 1)));
    });
  });
}

// ─── Video Info & Format Extraction ───────────────────────────────────────────

async function getVideoInfo(url, cookiesBrowser = null) {
  const isYouTube = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url);
  const clientStrategies = isYouTube ? ['default', 'ios', 'android'] : ['default'];

  const executeInfo = (clientArg, activeBrowser = cookiesBrowser) => {
    return new Promise((resolve, reject) => {
      const args = [
        url,
        '--dump-json',
        '--no-download',
        '--no-warnings',
        '--no-check-certificates',
        '--no-playlist',
        '--geo-bypass',
        '--socket-timeout', '25',
        '--retries', '3',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        '--add-header', 'Accept-Language:en-US,en;q=0.9',
        '--add-header', 'Sec-Fetch-Mode:navigate',
        '--add-header', 'Sec-Fetch-Dest:document',
        '--add-header', 'Cookie:age_verified=1; mature_content=1; over18=1',
        '--referer', url,
        '--js-runtimes', 'node'
      ];

      if (activeBrowser && activeBrowser !== 'none') {
        args.push('--cookies-from-browser', activeBrowser);
      }

      if (isYouTube && clientArg !== 'default') {
        args.push('--extractor-args', `youtube:player_client=${clientArg}`);
      }

      let output = '';
      let stderr = '';
      const runner = getYtDlpRunner(args);
      const proc = spawn(runner.cmd, runner.args, { windowsHide: true, env: runner.env });

      proc.stdout.on('data', d => { output += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('close', (code) => {
        try {
          // If activeBrowser was passed and yt-dlp failed with DPAPI or cookie database error, signal cookie failure
          if (code !== 0 && activeBrowser && activeBrowser !== 'none' && /DPAPI|cookie|database|decrypt/i.test(stderr)) {
            const cookieError = new Error('COOKIE_DECRYPT_FAILED: ' + parseExtractorError(stderr, output, code));
            cookieError.isCookieError = true;
            return reject(cookieError);
          }

          const firstBrace = output.indexOf('{');
          const lastBrace = output.lastIndexOf('}');
          if (firstBrace === -1 || lastBrace === -1) {
            throw new Error(parseExtractorError(stderr, output, code));
          }
          const jsonStr = output.slice(firstBrace, lastBrace + 1);
          const info = JSON.parse(jsonStr);

          // Enhanced format parsing: accommodates adult and niche platforms with missing codec metadata
          const formats = (info.formats || []).map(f => ({
            format_id: f.format_id,
            ext: f.ext,
            resolution: f.resolution || (f.height ? `${f.width || '?'}x${f.height}` : null),
            width: f.width,
            height: f.height,
            filesize: f.filesize || f.filesize_approx,
            vcodec: f.vcodec,
            acodec: f.acodec,
            fps: f.fps,
            tbr: f.tbr,
            format_note: f.format_note,
            has_video: f.vcodec !== 'none' && (f.vcodec || f.height || f.width || f.ext === 'mp4' || f.format_note || !f.acodec),
            has_audio: f.acodec !== 'none' && (f.acodec || f.ext === 'mp3' || f.ext === 'm4a' || !f.vcodec)
          }));

          // Fallback if formats array was empty but root dictionary has a direct stream url
          if (formats.length === 0 && info.url) {
            formats.push({
              format_id: 'direct',
              ext: info.ext || 'mp4',
              resolution: info.height ? `${info.width || '?'}x${info.height}` : '720p HD',
              width: info.width || 1280,
              height: info.height || 720,
              filesize: info.filesize || info.filesize_approx,
              vcodec: 'h264',
              acodec: 'aac',
              has_video: true,
              has_audio: true
            });
          }

          const presets = buildQualityPresets(formats, info);

          resolve({
            id: info.id,
            title: info.title || 'Untitled Media',
            thumbnail: info.thumbnail ||
                       (info.thumbnails && info.thumbnails.length > 0 ? info.thumbnails[info.thumbnails.length - 1].url : '') ||
                       (info.id ? `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg` : ''),
            duration: info.duration,
            channel: info.channel || info.uploader || 'Creator',
            description: info.description ? info.description.substring(0, 500) : '',
            view_count: info.view_count,
            upload_date: info.upload_date,
            webpage_url: info.webpage_url || url,
            formats,
            presets,
            extractor: info.extractor || 'media'
          });
        } catch (e) {
          reject(e.message || String(e));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(parseExtractorError(err.message, '', 1)));
      });
    });
  };

  const runStrategies = async (browserChoice) => {
    let lastErr = null;
    for (const clientStrat of clientStrategies) {
      try {
        return await executeInfo(clientStrat, browserChoice);
      } catch (err) {
        lastErr = err;
        // If cookie decryption failed (e.g. DPAPI), break immediately so we don't spam broken attempts
        if (err.isCookieError || /DPAPI|cookie|database|decrypt/i.test(String(err.message || err))) {
          throw err;
        }
        if (!isYouTube) break;
      }
    }
    throw new Error(lastErr ? String(lastErr.message || lastErr) : 'Failed to extract video information.');
  };

  // 1. If user configured browser cookies, try with them first
  if (cookiesBrowser && cookiesBrowser !== 'none') {
    try {
      return await runStrategies(cookiesBrowser);
    } catch (cookieErr) {
      // Automatic transparent fallback: if browser cookies fail with DPAPI or db locks, extract cleanly without cookies
      console.warn(`[Engine] Browser cookie extraction failed (${cookieErr.message || cookieErr}). Falling back to clean direct extraction...`);
      try {
        return await runStrategies(null);
      } catch (directErr) {
        throw directErr;
      }
    }
  }

  // 2. Direct clean extraction (no cookies)
  return await runStrategies(null);
}

// ─── Quality Preset Builder (Multi-Platform / IYKYK Optimized) ────────────────

function buildQualityPresets(formats, info) {
  const presets = [];
  const duration = info?.duration || 210;

  const videoFormats = (formats || []).filter(f => f.has_video && (f.height || f.width || f.ext === 'mp4'));
  const formatHeights = videoFormats.map(f => {
    if (f.height && f.width) return Math.min(f.height, f.width);
    return f.height || 0;
  }).filter(h => h > 0);

  const maxHeight = formatHeights.length > 0
    ? Math.max(...formatHeights)
    : (info?.height ? Math.min(info.height, info.width || info.height) : 720);

  const standardResolutions = [
    { label: '4K Ultra HD (2160p)', height: 2160, bytePerSec: 1000000 },
    { label: '1440p Quad HD (2K)', height: 1440, bytePerSec: 600000 },
    { label: '1080p Full HD', height: 1080, bytePerSec: 320000 },
    { label: '720p HD', height: 720, bytePerSec: 160000 },
    { label: '480p SD', height: 480, bytePerSec: 90000 },
    { label: '360p Mobile', height: 360, bytePerSec: 60000 }
  ];

  let videoResolutions = [];
  if (maxHeight > 0) {
    videoResolutions = standardResolutions.filter(r => r.height <= maxHeight || (r.height * 0.9 <= maxHeight));
    if (videoResolutions.length === 0) {
      videoResolutions.unshift({
        label: `${maxHeight}p (Max Quality)`,
        height: maxHeight,
        bytePerSec: Math.round(maxHeight * 300)
      });
    }
  } else {
    videoResolutions = standardResolutions.filter(r => r.height <= 1080 && r.height >= 360);
  }

  const bestAudio = (formats || [])
    .filter(f => f.has_audio && !f.has_video)
    .sort((a, b) => (b.filesize || b.tbr || 0) - (a.filesize || a.tbr || 0))[0];

  for (const res of videoResolutions) {
    const matching = formats.filter(f => {
      if (!f.has_video) return false;
      const h = (f.height && f.width) ? Math.min(f.height, f.width) : (f.height || 0);
      return h === res.height || f.height === res.height || (h <= res.height && h >= res.height * 0.85);
    });

    let estSize = null;
    let best = null;
    if (matching.length > 0) {
      best = matching.sort((a, b) => (b.filesize || b.tbr || 0) - (a.filesize || a.tbr || 0))[0];
      const audioSize = best.has_audio ? 0 : (bestAudio?.filesize || 0);
      estSize = (best.filesize || 0) + audioSize;
    }
    if (!estSize) {
      estSize = Math.round(duration * res.bytePerSec);
    }

    // Dynamic format candidate chain: uses direct format_id first, then falls back to resilient selectors
    const formatCandidates = [];
    if (best && best.format_id) {
      if (bestAudio && !best.has_audio) {
        formatCandidates.push(`${best.format_id}+${bestAudio.format_id}`);
        formatCandidates.push(`${best.format_id}+bestaudio`);
      }
      formatCandidates.push(best.format_id);
    }
    formatCandidates.push(`bestvideo[height<=?${res.height}]+bestaudio`);
    formatCandidates.push(`best[height<=?${res.height}]`);
    formatCandidates.push('bestvideo+bestaudio');
    formatCandidates.push('best');

    presets.push({
      type: 'video',
      label: res.label,
      format: formatCandidates.join('/'),
      formatSort: `res:${res.height}`,
      ext: 'mp4',
      height: res.height,
      filesize: estSize,
      format_id: best ? best.format_id : null
    });
  }

  // Safety: guarantee at least one video preset if custom scraper had non-standard tags
  if (presets.filter(p => p.type === 'video').length === 0) {
    presets.push({
      type: 'video',
      label: 'Best Quality (MP4)',
      format: 'bestvideo+bestaudio/best',
      formatSort: 'res:720',
      ext: 'mp4',
      height: 720,
      filesize: Math.round(duration * 160000)
    });
  }

  // Audio presets
  const audio320Size = Math.round(duration * 40000);
  const audio128Size = Math.round(duration * 16000);

  presets.push({
    type: 'audio',
    label: 'MP3 High Quality (320 kbps)',
    format: 'bestaudio/best',
    ext: 'mp3',
    filesize: audio320Size,
    postprocess: ['-x', '--audio-format', 'mp3', '--audio-quality', '0']
  });

  presets.push({
    type: 'audio',
    label: 'MP3 Standard (128 kbps)',
    format: 'bestaudio/best',
    ext: 'mp3',
    filesize: audio128Size,
    postprocess: ['-x', '--audio-format', 'mp3', '--audio-quality', '5']
  });

  presets.push({
    type: 'audio',
    label: 'M4A / AAC Audio',
    format: 'bestaudio[ext=m4a]/bestaudio/best',
    ext: 'm4a',
    filesize: audio128Size,
    postprocess: ['-x', '--audio-format', 'm4a']
  });

  return presets;
}

// ─── High-Reliability Download Process ─────────────────────────────────────────

function startDownload({ url, preset, targetDir, cookiesBrowser, onProgress, onComplete, onError }) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const ffmpeg = getFfmpegPath();

  const args = [
    url,
    '-f', preset.format || 'bestvideo+bestaudio/best',
    '-o', path.join(targetDir, '%(title)s.%(ext)s'),
    '--windows-filenames',
    '--no-warnings',
    '--no-check-certificates',
    '--no-playlist',
    '--geo-bypass',
    '--newline',
    '--progress',
    // Progress template: deterministic output across all yt-dlp versions
    '--progress-template', 'download:%(progress._percent_str)s:%(progress._total_bytes_estimate_str|progress._total_bytes_str)s:%(progress._speed_str)s:%(progress._eta_str)s',
    '--socket-timeout', '30',
    '--retries', '5',
    '--fragment-retries', '10',
    '-N', '4',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    '--add-header', 'Accept-Language:en-US,en;q=0.9',
    '--add-header', 'Sec-Fetch-Mode:navigate',
    '--add-header', 'Sec-Fetch-Dest:document',
    '--add-header', 'Cookie:age_verified=1; mature_content=1; over18=1',
    '--referer', url,
    '--js-runtimes', 'node'
  ];

  if (cookiesBrowser && cookiesBrowser !== 'none') {
    args.push('--cookies-from-browser', cookiesBrowser);
  }

  if (preset.formatSort) {
    args.push('-S', preset.formatSort);
  }

  if (preset.ext === 'mp4' && preset.type === 'video') {
    args.push('--merge-output-format', 'mp4');
  }

  if (preset.postprocess && Array.isArray(preset.postprocess)) {
    args.push(...preset.postprocess);
  }

  if (ffmpeg) {
    args.push('--ffmpeg-location', ffmpeg);
  }

  const runner = getYtDlpRunner(args);
  const proc = spawn(runner.cmd, runner.args, { windowsHide: true, env: runner.env });

  const startTime = Date.now();
  let downloadedFilePath = null;
  let dlStderr = '';

  const parseLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    // 1. Destination match
    const destMatch = line.match(/(?:Destination:|Merging formats into|has already been downloaded|\[ExtractAudio\] Destination:)\s*["']?([^"'\n\r]+)/i);
    if (destMatch && destMatch[1]) {
      downloadedFilePath = destMatch[1].trim().replace(/^["']|["']$/g, '');
    }

    // 2. Template progress: download:  15.2%:  24.50MiB:  1.20MiB/s: 00:15
    const tmplMatch = line.match(/^download:\s*([\d.]+)%:\s*([^:]+):\s*([^:]+):\s*(\S+)/i);
    if (tmplMatch) {
      onProgress?.({
        percent: Math.min(Math.max(parseFloat(tmplMatch[1]), 1), 100),
        totalSize: tmplMatch[2].trim() || 'Calculating...',
        speed: tmplMatch[3].trim() || 'Downloading...',
        eta: tmplMatch[4].trim() || '--:--'
      });
      return;
    }

    // 3. Fallback regex supporting DASH and fragmented "~  24.50MiB"
    const fallbackMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+(?:~\s*)?([^\s]+)(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+([^\s]+))?/i);
    if (fallbackMatch) {
      onProgress?.({
        percent: Math.min(Math.max(parseFloat(fallbackMatch[1]), 1), 100),
        totalSize: fallbackMatch[2].trim() || 'Calculating...',
        speed: fallbackMatch[3] ? fallbackMatch[3].trim() : 'Downloading...',
        eta: fallbackMatch[4] ? fallbackMatch[4].trim() : '--:--'
      });
      return;
    }

    // 4. Completed state
    if (line.includes('100%') || line.includes('has already been downloaded')) {
      onProgress?.({
        percent: 100,
        totalSize: 'Complete',
        speed: 'Done',
        eta: '00:00'
      });
    }
  };

  const handleChunk = (chunk) => {
    const text = chunk.toString();
    // Split by carriage return OR newline so \r updates are caught immediately
    const lines = text.split(/[\r\n]+/);
    for (const l of lines) parseLine(l);
  };

  proc.stdout.on('data', handleChunk);
  proc.stderr.on('data', (d) => {
    dlStderr += d.toString();
    handleChunk(d);
  });

  proc.on('close', (code) => {
    if (code === 0) {
      if (downloadedFilePath && !path.isAbsolute(downloadedFilePath)) {
        downloadedFilePath = path.resolve(targetDir, downloadedFilePath);
      }
      if (!downloadedFilePath || !fs.existsSync(downloadedFilePath)) {
        try {
          const files = fs.readdirSync(targetDir).map(f => {
            const full = path.join(targetDir, f);
            const stat = fs.statSync(full);
            return { full, mtime: stat.mtimeMs };
          }).filter(f => f.mtime >= startTime - 5000);
          files.sort((a, b) => b.mtime - a.mtime);
          if (files.length > 0) {
            downloadedFilePath = files[0].full;
          }
        } catch (e) {}
      }

      onComplete?.({
        success: true,
        outputDir: targetDir,
        filePath: downloadedFilePath,
        error: null
      });
    } else {
      // Check if failure was caused by Windows DPAPI or browser cookie database lock
      if (cookiesBrowser && cookiesBrowser !== 'none' && /DPAPI|cookie|database|decrypt/i.test(dlStderr)) {
        console.warn('[Download] Browser cookie error encountered (DPAPI). Retrying automatically in direct mode...');
        onProgress?.({
          percent: 1,
          totalSize: 'Direct Fallback',
          speed: 'Reconnecting...',
          eta: '--:--'
        });
        return startDownload({
          url,
          preset,
          targetDir,
          cookiesBrowser: null,
          onProgress,
          onComplete,
          onError
        });
      }

      const parsedErr = parseExtractorError(dlStderr, '', code);
      onComplete?.({
        success: false,
        outputDir: targetDir,
        filePath: downloadedFilePath,
        error: parsedErr
      });
    }
  });

  proc.on('error', (err) => {
    onError?.(parseExtractorError(err.message, '', 1));
  });

  return proc;
}

// ─── Auto-Complete Suggestions ────────────────────────────────────────────────

function getSuggestions(query) {
  return new Promise((resolve) => {
    if (!query || query.trim().length === 0) return resolve([]);
    const url = `https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&q=${encodeURIComponent(query)}&ds=yt&gl=us&hl=en`;

    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const match = data.match(/\((\[.*\])\)/s);
          if (match) {
            const parsed = JSON.parse(match[1]);
            const suggestions = parsed[1].map(s => s[0]);
            resolve(suggestions.slice(0, 8));
          } else {
            resolve([]);
          }
        } catch {
          resolve([]);
        }
      });
    }).on('error', () => resolve([])).on('timeout', () => resolve([]));
  });
}

module.exports = {
  getYtDlpPath,
  getFfmpegPath,
  searchVideos,
  getVideoInfo,
  startDownload,
  tryCobaltResolver,
  getSuggestions,
  parseExtractorError,
  buildQualityPresets
};
