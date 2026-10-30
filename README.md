<div align="center">

  <img src="assets/icon.png" width="110" height="110" alt="SnapTube Logo" style="border-radius: 24px; box-shadow: 0 16px 36px rgba(0,0,0,0.35);" />

  # SnapTube
  ### Universal Media Downloader &bullet; Apple HIG Edition

  **A studio-grade, lossless media extraction and downloading engine engineered with Apple Human Interface Guidelines, translucent Liquid Glass aesthetics, and an enterprise hybrid dual-stack architecture.**

  <p>
    <a href="#key-features">Key Features</a> &bull;
    <a href="#architecture">Architecture</a> &bull;
    <a href="#quick-start">Quick Start</a> &bull;
    <a href="#production-deployment">Production Deployment</a> &bull;
    <a href="#rest-api--telemetry">REST API</a> &bull;
    <a href="#git-publishing">Publishing to GitHub</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Platform-Desktop_%7C_Web_%7C_Docker-black?style=for-the-badge&logo=apple&logoColor=white" alt="Platform Support" />
    <img src="https://img.shields.io/badge/UI%2FUX-Apple_Liquid_Glass-0071e3?style=for-the-badge&logo=apple" alt="Apple HIG" />
    <img src="https://img.shields.io/badge/Node.js-18%2B_%7C_20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js Version" />
    <img src="https://img.shields.io/badge/Electron-v28-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron Version" />
    <img src="https://img.shields.io/badge/Core-yt--dlp_%2B_FFmpeg-FF0000?style=for-the-badge&logo=youtube" alt="Core Engine" />
    <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT License" />
  </p>

</div>

---

## Overview

**SnapTube** is a modern media extraction suite built for creators, power users, and developers. By combining the speed of **distributed cloud resolver clusters** with the resilience of a **hardened local yt-dlp & FFmpeg pipeline**, SnapTube downloads 4K video and lossless studio audio from virtually any online source in seconds.

Designed strictly around **Apple's Human Interface Guidelines (HIG)**, the interface features real-time backdrop blur saturation, specular glass highlights, smooth spring animations, and native system controls across both desktop (macOS & Windows) and modern web browsers.

---

## Comparison Matrix

| Feature | SnapTube (Apple HIG) | Generic Web Downloaders | Standard CLI (yt-dlp) |
| :--- | :---: | :---: | :---: |
| **Interface Quality** | **Apple Liquid Glass (SF Pro)** | Cluttered / Ads / Popups | Terminal Only |
| **Dual Deployment** | **Desktop (Electron) + Cloud Web** | Web Only | Local CLI Only |
| **Cloud CDN Acceleration** | **Zero-Bandwidth Resolver Fallback** | Limited | None |
| **DPAPI & Cookie Bypass** | **Automatic Direct Fallback** | Unstable | Manual Setup |
| **Live Telemetry** | **Real-Time SSE + Speed/ETA** | Generic Spinner | Terminal Text |
| **Multi-Threaded Merging** | **Lossless FFmpeg Remux (MP4/MP3)** | Server Re-encode | Requires Flags |
| **Privacy & Security** | **100% Zero Tracking / Self-Hostable** | Heavily Monitored | 100% Private |

---

## Key Features

### 1. Apple Liquid Glass UI & Design System
- **Authentic macOS Glassmorphism**: Multi-layered translucent panels (`backdrop-filter: blur(28px) saturate(180%)`) with specular linear gradient borders.
- **Dynamic Accent Glow**: Apple Intelligence style indigo-to-magenta fluid gradients.
- **Desktop Window Chrome**: Top-right native window controls (Minimize, Maximize/Restore, Close) with hover feedback.
- **Fluid Layout**: Responsive from compact mobile screens up to 4K Ultra-wide monitors.

### 2. Hybrid Dual-Stack Extraction Engine
- **Cloud Resolver Tier**: Instantaneous high-bitrate stream extraction via distributed public Cobalt clusters for mainstream platforms (YouTube, Instagram, TikTok, Twitter/X, Reddit, Vimeo, SoundCloud) with zero local CPU/bandwidth bottleneck.
- **Deep Extractor Core**: Embedded, pre-compiled `yt-dlp` and `FFmpeg` pipeline providing coverage across **1,000+ niche, adult, and generic streaming providers**.
- **Automated DPAPI & Cookie Resilience**: Completely immune to Windows Chromium 127+ App-Bound DPAPI decryption crashes. Automatically routes through authenticated direct headers (`age_verified=1`, `--geo-bypass`, custom desktop User-Agent, referer matching).

### 3. Real-Time Telemetry & Progress Streaming
- **Server-Sent Events (SSE)**: True streaming updates pushing live progress percentage, download speed (`MiB/s`), file size estimations, and ETA down to the millisecond.
- **Multi-Part Parallel Downloading**: Multi-fragment acceleration (`-N 4`) with automatic DASH & HLS stream assembly.
- **One-Click Retry**: Self-healing recovery mechanism for intermittent network drops.

### 4. Lossless Video & Studio Audio Presets
- **Video Resolutions**: 4K Ultra HD (2160p), 1440p Quad HD (2K), 1080p Full HD (60fps), 720p HD, 480p SD, and 360p Mobile.
- **Studio Audio Extraction**: Pristine 320 kbps High-Bitrate MP3, standard 128 kbps MP3, and native AAC / M4A audio extraction.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 SnapTube Unified Frontend                   │
│   (Apple HIG Design System • HTML5 • CSS3 Glass • JS ES6)   │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
       [Electron IPC Bridge]             [HTTP / REST / SSE]
               │                               │
┌──────────────▼──────────────┐ ┌──────────────▼──────────────┐
│  Desktop Controller (main)  │ │   Production Web Server     │
│   • Native Window Chrome    │ │   • REST API Routing        │
│   • OS File Explorer Open   │ │   • SSE Telemetry Stream    │
│   • Local Path Persistence  │ │   • Static File CDN Engine  │
└──────────────┬──────────────┘ └──────────────┬──────────────┘
               │                               │
               └───────────────┬───────────────┘
                               │
                ┌──────────────▼──────────────┐
                │   SnapTube Engine Pipeline  │
                │         (engine.js)         │
                └──────────────┬──────────────┘
                               │
        ┌──────────────────────┴──────────────────────┐
        ▼                                             ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│    Cloud Stream Resolver    │ │     Local Deep Core         │
│   • Public Cobalt Clusters  │ │   • yt-dlp Executable       │
│   • 0ms Mainstream Parsing  │ │   • ffmpeg-static Multiplex │
│   • Zero Bandwidth Cost     │ │   • DPAPI Resilient Fallback│
└─────────────────────────────┘ └─────────────────────────────┘
```

---

## Quick Start

### Prerequisites
- **Node.js**: v18.0.0 or higher ([Download Node.js](https://nodejs.org/))
- **Operating System**: Windows 10/11, macOS (Ventura or newer), or modern Linux

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Arsenicwatts/SnapTube-Windows.git
cd "SnapTube Windows"

# 2. Install dependencies
npm install
```

---

### Running the Application

#### Option A: Run as Desktop App (Electron)
Double-click `run.bat` on Windows, or execute:
```bash
npm run desktop
```

#### Option B: Run as Web Server (Browser)
Double-click `start-web.bat` on Windows, or execute:
```bash
npm start
```
Then navigate to **`http://localhost:3000`** in any browser (Chrome, Safari, Firefox, Edge, Brave, Mobile).

---

## Production Deployment

SnapTube is designed as a cloud-native Twelve-Factor web application. You can host it on any cloud provider with zero extra configuration.

### 1. Deploy with Docker (Recommended)

Build and run the self-contained container:

```bash
# Build the Docker image
docker build -t snaptube .

# Run the container on port 3000
docker run -d -p 3000:3000 --name snaptube-app --restart always snaptube
```

#### Production `Dockerfile`:
```dockerfile
FROM node:20-slim

# Install system dependencies: ffmpeg, python3, and curl
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install latest standalone yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
```

### 2. Deploy to Railway / Render / Fly.io

1. Connect your GitHub repository to [Railway](https://railway.app/) or [Render](https://render.com/).
2. Set the configuration:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
3. SnapTube automatically reads `process.env.PORT` assigned by the hosting environment.

### 3. Production Process Management (PM2)

```bash
npm install -g pm2
pm2 start server.js --name "snaptube" -i max
pm2 save
pm2 startup
```

---

## REST API & Telemetry

Developers can use SnapTube as a headless media extraction and downloading microservice:

### Endpoints

| Method | Endpoint | Description | Payload / Query |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Service health status & binary verification | None |
| `GET` | `/api/search` | Fast search across online video platforms | `?q=query` |
| `GET` | `/api/suggest` | Search query suggestions & auto-complete | `?q=prefix` |
| `POST` | `/api/info` | Extract title, formats, duration & presets | `{ "url": "https://..." }` |
| `POST` | `/api/download` | Initiate background extraction & conversion | `{ "url": "...", "preset": {...} }` |
| `GET` | `/api/progress/:id`| Real-time Server-Sent Events (SSE) telemetry | Stream connection |
| `GET` | `/api/file/:id` | Download the finalized media file | Binary stream |

---

## Project Structure

```text
├── assets/                     # Branding, vector icons & favicon
│   ├── favicon.svg             # Web browser favicon
│   └── icon.png                # macOS & Windows application icon
├── bin/                        # Pre-bundled runtime binaries
│   └── yt-dlp.exe              # Embedded Windows yt-dlp engine
├── engine.js                   # Enterprise extraction pipeline & resolvers
├── server.js                   # Node.js HTTP server, REST API & SSE streaming
├── main.js                     # Electron main process & IPC window manager
├── preload.js                  # Electron context-bridge security barrier
├── index.html                  # Apple HIG frontend application layout
├── styles.css                  # Apple Liquid Glass design tokens & styles
├── renderer.js                 # Dual-mode state controller (Desktop + Web)
├── package.json                # Project dependencies & execution scripts
├── run.bat                     # Windows desktop one-click runner
├── start-web.bat               # Windows web server one-click runner
├── .gitignore                  # Production Git ignore filter
└── README.md                   # Project documentation
```

---

## Git Publishing

Ready to publish this project to your GitHub account? Run the following commands in your terminal:

```bash
# 1. Initialize a new Git repository
git init

# 2. Stage all organized files
git add .

# 3. Commit with a clean semantic message
git commit -m "feat: initial release of SnapTube v1.0.0 (Apple HIG Edition)"

# 4. Set default branch to main
git branch -M main

# 5. Add your remote repository
git remote add origin https://github.com/Arsenicwatts/SnapTube-Windows.git

# 6. Push to GitHub
git push -u origin main
```

---

## Contributing

Contributions make the open-source community an inspiring place to learn, create, and build:

1. **Fork** the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a **Pull Request**

---

## Disclaimer & Legal Notice

SnapTube is an open-source software project designed strictly for personal archiving, educational research, and offline viewing of freely available or Creative Commons media. Please respect copyright laws and the terms of service of each respective platform.

---

<div align="center">
  <sub>Engineered with precision &bull; Built with Apple Human Interface Guidelines standards &bull; Licensed under the <b>MIT License</b></sub>
</div>
