/**
 * SnapTube Web Server — Production-ready HTTP Server & REST API
 * Hybrid Architecture: High-speed Cloud Resolver + Core Engine (yt-dlp) + SSE Live Progress
 */

const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const engine = require('./engine');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = __dirname;
const WEB_DOWNLOADS_DIR = path.join(os.tmpdir(), 'snaptube-web-downloads');

if (!fs.existsSync(WEB_DOWNLOADS_DIR)) {
  try { fs.mkdirSync(WEB_DOWNLOADS_DIR, { recursive: true }); } catch (e) {}
}

// In-memory active web downloads map: id -> downloadState
const webDownloads = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // ─── Health / Diagnostics ──────────────────────────────────────────────────
  if (pathname === '/api/status' || pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'ready',
      version: '1.0.0',
      ytdlp: engine.getYtDlpPath() ? 'available' : 'fallback-python',
      ffmpeg: engine.getFfmpegPath() ? 'available' : 'missing',
      platform: process.platform,
      time: new Date().toISOString()
    });
  }

  // ─── Suggestions API ───────────────────────────────────────────────────────
  if (pathname === '/api/suggestions' && req.method === 'GET') {
    const q = parsedUrl.query.q || '';
    try {
      const suggestions = await engine.getSuggestions(q);
      return sendJson(res, 200, { suggestions });
    } catch {
      return sendJson(res, 200, { suggestions: [] });
    }
  }

  // ─── Search API ────────────────────────────────────────────────────────────
  if (pathname === '/api/search' && req.method === 'GET') {
    const q = parsedUrl.query.q || '';
    if (!q.trim()) {
      return sendJson(res, 400, { error: 'Query parameter "q" is required' });
    }
    try {
      const results = await engine.searchVideos(q);
      return sendJson(res, 200, { results });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || String(err) });
    }
  }

  // ─── Video Info & Format Extraction API ────────────────────────────────────
  if (pathname === '/api/info' && (req.method === 'POST' || req.method === 'GET')) {
    let targetUrl = parsedUrl.query.url;
    let cookiesBrowser = parsedUrl.query.browser || null;
    if (req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        targetUrl = body.url || targetUrl;
        cookiesBrowser = body.cookiesBrowser || cookiesBrowser;
      } catch {
        return sendJson(res, 400, { error: 'Invalid request body' });
      }
    }

    if (!targetUrl || !targetUrl.trim()) {
      return sendJson(res, 400, { error: 'URL parameter is required' });
    }

    try {
      const info = await engine.getVideoInfo(targetUrl.trim(), cookiesBrowser);
      return sendJson(res, 200, info);
    } catch (err) {
      return sendJson(res, 500, { error: err.message || String(err) });
    }
  }

  // ─── Fast Cloud Resolver API (High-speed CDN extraction) ───────────────────
  if (pathname === '/api/resolve-fast' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { url: videoUrl, isAudioOnly, quality } = body;
      const cloudResult = await engine.tryCobaltResolver(videoUrl, isAudioOnly, quality);
      return sendJson(res, 200, cloudResult);
    } catch {
      return sendJson(res, 200, { success: false });
    }
  }

  // ─── Start Download Job ────────────────────────────────────────────────────
  if (pathname === '/api/download' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { id, url: videoUrl, preset, title, cookiesBrowser } = body;

      if (!id || !videoUrl || !preset) {
        return sendJson(res, 400, { error: 'id, url, and preset are required' });
      }

      // Check if fast cloud stream can handle this first
      const isAudio = preset.type === 'audio';
      const cloudRes = await engine.tryCobaltResolver(videoUrl, isAudio, String(preset.height || '1080'));
      if (cloudRes.success && cloudRes.streamUrl) {
        // Fast cloud direct download: ready instantly!
        const downloadItem = {
          id,
          url: videoUrl,
          preset,
          title: title || 'media',
          percent: 100,
          speed: 'Direct CDN',
          eta: '00:00',
          totalSize: 'High Speed',
          status: 'completed',
          filePath: null,
          directUrl: cloudRes.streamUrl,
          error: null,
          listeners: new Set()
        };
        webDownloads.set(id, downloadItem);
        return sendJson(res, 200, {
          success: true,
          id,
          fastStream: true,
          downloadUrl: cloudRes.streamUrl
        });
      }

      // Fallback to core engine (yt-dlp + FFmpeg)
      const downloadItem = {
        id,
        url: videoUrl,
        preset,
        title: title || 'media',
        percent: 2,
        speed: 'Connecting...',
        eta: '--:--',
        totalSize: 'Calculating...',
        status: 'downloading',
        filePath: null,
        directUrl: null,
        error: null,
        listeners: new Set()
      };

      webDownloads.set(id, downloadItem);

      downloadItem.process = engine.startDownload({
        url: videoUrl,
        preset,
        targetDir: WEB_DOWNLOADS_DIR,
        cookiesBrowser: cookiesBrowser || null,
        onProgress: (progress) => {
          downloadItem.percent = Math.min(Math.max(progress.percent, 2), 99);
          downloadItem.speed = progress.speed;
          downloadItem.eta = progress.eta;
          downloadItem.totalSize = progress.totalSize;
          downloadItem.status = 'downloading';

          const payload = JSON.stringify({
            id,
            percent: downloadItem.percent,
            speed: downloadItem.speed,
            eta: downloadItem.eta,
            totalSize: downloadItem.totalSize,
            status: downloadItem.status,
            ready: false
          });

          for (const sendEvent of downloadItem.listeners) {
            sendEvent(payload);
          }
        },
        onComplete: (result) => {
          downloadItem.status = result.success ? 'completed' : 'error';
          downloadItem.percent = result.success ? 100 : downloadItem.percent;
          downloadItem.filePath = result.filePath;
          downloadItem.error = result.error;

          const payload = JSON.stringify({
            id,
            percent: downloadItem.percent,
            speed: 'Done',
            eta: '00:00',
            status: downloadItem.status,
            ready: result.success,
            downloadUrl: result.success ? `/api/download-file?id=${id}` : null,
            error: result.error
          });

          for (const sendEvent of downloadItem.listeners) {
            sendEvent(payload);
          }

          // Clean up file after 20 minutes
          if (result.filePath) {
            setTimeout(() => {
              try { if (fs.existsSync(result.filePath)) fs.unlinkSync(result.filePath); } catch (e) {}
              webDownloads.delete(id);
            }, 20 * 60 * 1000);
          }
        },
        onError: (errMsg) => {
          downloadItem.status = 'error';
          downloadItem.error = errMsg;

          const payload = JSON.stringify({
            id,
            percent: downloadItem.percent,
            status: 'error',
            ready: false,
            error: errMsg
          });

          for (const sendEvent of downloadItem.listeners) {
            sendEvent(payload);
          }
        }
      });

      return sendJson(res, 200, { success: true, id, fastStream: false });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || String(err) });
    }
  }

  // ─── Cancel Download Job ───────────────────────────────────────────────────
  if (pathname === '/api/cancel' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { id } = body;
      const downloadItem = webDownloads.get(id);
      if (downloadItem) {
        if (downloadItem.process && !downloadItem.process.killed) {
          try { downloadItem.process.kill('SIGTERM'); } catch (e) {}
        }
        downloadItem.status = 'error';
        downloadItem.error = 'Cancelled by user';
        const payload = JSON.stringify({
          id,
          percent: downloadItem.percent,
          status: 'error',
          ready: false,
          error: 'Cancelled by user'
        });
        for (const sendEvent of downloadItem.listeners) {
          sendEvent(payload);
        }
      }
      return sendJson(res, 200, { success: true });
    } catch {
      return sendJson(res, 200, { success: false });
    }
  }

  // ─── Polling Status API (Guaranteed Progress for All Clients) ───────────────
  if (pathname === '/api/download-status' && req.method === 'GET') {
    const id = parsedUrl.query.id;
    const downloadItem = webDownloads.get(id);

    if (!downloadItem) {
      return sendJson(res, 404, { error: 'Download not found', status: 'error' });
    }

    return sendJson(res, 200, {
      id,
      percent: downloadItem.percent,
      speed: downloadItem.speed,
      eta: downloadItem.eta,
      totalSize: downloadItem.totalSize,
      status: downloadItem.status,
      ready: downloadItem.status === 'completed',
      downloadUrl: downloadItem.directUrl || (downloadItem.filePath ? `/api/download-file?id=${id}` : null),
      error: downloadItem.error
    });
  }

  // ─── SSE Progress Stream ───────────────────────────────────────────────────
  if (pathname === '/api/download-progress' && req.method === 'GET') {
    const id = parsedUrl.query.id;
    const downloadItem = webDownloads.get(id);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    if (!downloadItem) {
      res.write(`data: ${JSON.stringify({ error: 'Download not found', status: 'error' })}\n\n`);
      return res.end();
    }

    // Immediately push current live status to client
    res.write(`data: ${JSON.stringify({
      id,
      percent: downloadItem.percent,
      speed: downloadItem.speed,
      eta: downloadItem.eta,
      totalSize: downloadItem.totalSize,
      status: downloadItem.status,
      ready: downloadItem.status === 'completed',
      downloadUrl: downloadItem.directUrl || (downloadItem.filePath ? `/api/download-file?id=${id}` : null),
      error: downloadItem.error
    })}\n\n`);

    const listener = (payload) => {
      try { res.write(`data: ${payload}\n\n`); } catch (e) {}
    };

    downloadItem.listeners.add(listener);

    req.on('close', () => {
      downloadItem.listeners.delete(listener);
    });

    return;
  }

  // ─── Download Completed Media File ─────────────────────────────────────────
  if (pathname === '/api/download-file' && req.method === 'GET') {
    const id = parsedUrl.query.id;
    const downloadItem = webDownloads.get(id);

    if (!downloadItem) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('File not found or expired.');
    }

    // Direct cloud stream redirect if available
    if (downloadItem.directUrl) {
      res.writeHead(302, { 'Location': downloadItem.directUrl });
      return res.end();
    }

    if (!downloadItem.filePath || !fs.existsSync(downloadItem.filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('File not found or expired.');
    }

    const ext = path.extname(downloadItem.filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const filename = path.basename(downloadItem.filePath);
    const stat = fs.statSync(downloadItem.filePath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-cache'
    });

    fs.createReadStream(downloadItem.filePath).pipe(res);
    return;
  }

  // ─── Static File Serving ───────────────────────────────────────────────────
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Access denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404);
          return res.end('404 Not Found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`  SnapTube Web & Desktop Server Running!`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`  Production ready for internet deployment & desktop.`);
  console.log(`======================================================\n`);
});

module.exports = server;
