<div align="center">
  <img src="assets/icon.png" width="96" height="96" alt="SnapTube app icon" />

  # SnapTube

  A desktop and web app for downloading online media.

  <p>
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Web-444" alt="Windows and web" />
    <img src="https://img.shields.io/badge/Runtime-Node.js-339933?logo=node.js&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Desktop-Electron-47848F?logo=electron&logoColor=white" alt="Electron" />
    <img src="https://img.shields.io/badge/Media-yt--dlp%20%7C%20FFmpeg-red" alt="yt-dlp and FFmpeg" />
    <img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License" />
  </p>
</div>

---

## About

SnapTube is a small media downloader built with Node.js. It provides a browser-based interface and an Electron desktop version, with `yt-dlp` and FFmpeg handling media extraction and processing.

The aim is to make common download tasks easier to manage: paste a link, inspect the available formats, choose a quality or audio option, and follow the download progress from the app.

Supported sites and available formats depend on the capabilities of the bundled `yt-dlp` version and the source website. Some sites may change how their media is served, so a format or download that works today may need an extractor update later.

## Features

- **Desktop and browser modes** — use the Electron app or run the web interface locally.
- **Media information** — retrieve a video's title, duration, and available formats before downloading.
- **Video and audio options** — select from the formats and presets returned by the media extractor.
- **Download progress** — view progress, transfer speed, and estimated time remaining where the source provides enough information.
- **FFmpeg support** — merge separate audio and video streams or convert media when required.
- **Download management** — retry a failed download and open the output location from the desktop app.
- **Responsive interface** — use the app on a desktop browser or a smaller screen.

## Tech stack

| Part | Technology |
| --- | --- |
| Interface | HTML, CSS, JavaScript |
| Desktop wrapper | Electron |
| Server | Node.js |
| Media extraction | yt-dlp |
| Media processing | FFmpeg |
| Progress updates | Server-Sent Events (SSE) |

## How it works

The interface sends requests to the Node.js server in web mode. In desktop mode, Electron provides the native window and desktop integrations, while the renderer communicates with the main process through the preload bridge.

The server passes extraction and download work to the media engine. The engine uses `yt-dlp` to inspect and retrieve media and FFmpeg when streams need to be merged or processed. Progress is sent back to the interface through an SSE connection.

```text
             Web browser
                  |
                  | HTTP / SSE
                  v
          +---------------+
          |  Node server  |
          +---------------+
                  |
                  v
          +---------------+
          |  Media engine |
          +---------------+
             |         |
             v         v
          yt-dlp     FFmpeg


          Electron desktop
                  |
             Renderer UI
                  |
              IPC bridge
                  |
             Main process
                  |
             Node server
```

## Requirements

- Windows 10 or later for the desktop app
- Node.js 18 or later
- npm (included with Node.js)
- FFmpeg available to the application

The repository includes a Windows `yt-dlp` binary in `bin/`. If you are running the project on another operating system, make sure the appropriate `yt-dlp` executable is available and configured.

## Getting started

### 1. Clone the repository

```bash
git clone https://github.com/Arsenicwatts/SnapTube-Windows.git
cd SnapTube-Windows
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the app

**Desktop app (Electron)**

```bash
npm run desktop
```

On Windows, you can also use:

```text
run.bat
```

**Web app**

```bash
npm start
```

On Windows, you can use `start-web.bat`.

Once the server has started, open [http://localhost:3000](http://localhost:3000) in your browser.

## Configuration and deployment

The server uses the `PORT` environment variable when it is set, and otherwise runs on port `3000`.

For local use, the commands above should be enough once the dependencies and media tools are installed. For a hosted deployment, check that the host allows the application to run external processes and has enough disk space for downloaded files. Some hosting providers restrict long-running downloads, temporary file storage, or outbound requests.

### Docker

A basic Docker image can be built with:

```bash
docker build -t snaptube .
```

Run it with:

```bash
docker run --rm -p 3000:3000 --name snaptube snaptube
```

The container needs Node.js, FFmpeg, and a compatible `yt-dlp` executable. Review the repository's `Dockerfile` and adjust it to match the current project files before deploying.

### Process manager

For a long-running Node.js server, you can use PM2:

```bash
npm install -g pm2
pm2 start server.js --name snaptube
pm2 save
```

## API

The server exposes the following endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check server status and media-tool availability |
| `GET` | `/api/search?q=query` | Search for media |
| `GET` | `/api/suggest?q=prefix` | Get search suggestions |
| `POST` | `/api/info` | Retrieve information and available formats for a URL |
| `POST` | `/api/download` | Start a download |
| `GET` | `/api/progress/:id` | Subscribe to download progress using SSE |
| `GET` | `/api/file/:id` | Retrieve a completed file |

Example request for media information:

```bash
curl -X POST http://localhost:3000/api/info \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/video"}'
```

The exact request fields and response format are defined by the server implementation. Refer to `server.js` and `engine.js` if you are integrating the API into another application.

## Project structure

```text
.
├── assets/
│   ├── favicon.svg
│   └── icon.png
├── bin/
│   └── yt-dlp.exe
├── engine.js
├── server.js
├── main.js
├── preload.js
├── index.html
├── styles.css
├── renderer.js
├── package.json
├── run.bat
├── start-web.bat
├── .gitignore
└── README.md
```

| File | Description |
| --- | --- |
| `engine.js` | Handles media extraction and download operations |
| `server.js` | Starts the Node.js server and exposes the API |
| `main.js` | Electron main process and desktop window setup |
| `preload.js` | Exposes the desktop APIs to the renderer |
| `renderer.js` | Handles interface behaviour |
| `index.html` | Main application markup |
| `styles.css` | Application styles |

## Troubleshooting

**The download does not start**

- Check that the URL is supported by the installed `yt-dlp` version.
- Update `yt-dlp` if the source website has changed.
- Check the terminal output for the underlying extractor error.

**Audio or video is missing after download**

- Confirm that FFmpeg is installed and accessible to the application.
- Some sources provide audio and video as separate streams. These need to be merged after download.

**The app cannot find `yt-dlp` or FFmpeg**

- Check that the executable exists in the expected location.
- Make sure the process has permission to run it.
- If you are using a different operating system, configure the matching executable.

**The web page does not open**

- Make sure the server started successfully.
- Check whether another process is already using port `3000`.
- If your hosting provider assigns a port, confirm that the app reads `process.env.PORT`.

## Contributing

Issues and pull requests are welcome.

1. Fork the repository.
2. Create a branch for your change.
3. Make and test your changes.
4. Commit with a clear message.
5. Open a pull request describing what changed.

## Legal

Use SnapTube only for media you own, have permission to download, or are otherwise legally allowed to access and save. You are responsible for following the copyright laws and terms that apply to the content and services you use.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
