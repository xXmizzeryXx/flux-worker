# Flux

A Cloudflare Worker-based web proxy that rewrites and tunnels HTTP traffic through a single worker endpoint. Designed to proxy full websites including HTML, JavaScript, CSS, WebSockets, and Web Workers.

## How It Works

All requests are routed through a single Cloudflare Worker. Target URLs are base64-encoded and appended to the `/fetch/` prefix. The worker fetches the target, rewrites all URLs in the response to point back through itself, and injects a runtime script into HTML pages that intercepts browser-level navigation, fetch, XHR, WebSocket, and Worker calls.

```
Browser → /fetch/<base64-encoded-url> → Worker → Target Server
                                       ↓
                              Rewritten response
```

## Structure

```
index.js       Cloudflare Worker — proxies and rewrites responses
flux-sw.js     Service Worker — intercepts /proxy/* requests on the client
index.html     Frontend UI for Recursion (browser runtime built on Flux)
```

## Deployment

### Prerequisites

- A Cloudflare account
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed

### Deploy the Worker

```bash
npm install -g wrangler
wrangler login
wrangler deploy index.js
```

### Configure the Frontend

Update `WORKER_URL` in both `flux-sw.js` and `index.html` to point to your deployed worker:

```js
const WORKER_URL = 'https://your-worker.your-subdomain.workers.dev';
```

## URL Encoding

Target URLs are encoded using URL-safe base64:

```js
btoa(unescape(encodeURIComponent(url)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
```

To proxy a URL manually:

```
https://your-worker.workers.dev/fetch/<encoded-url>
```

## What Gets Rewritten

| Content Type | Rewriting |
|---|---|
| HTML | `src`, `href`, `action`, `srcset`, inline `url()`, injected runtime script |
| JavaScript | String literals containing URLs, `import()`, static `import` statements |
| CSS | `url()` references |
| WebSocket | `ws://` / `wss://` connections rerouted through worker |
| Web Workers | `new Worker(url)` URL rewritten before construction |
| Dynamic imports | `import(url)` replaced with proxied equivalent |

## Injected Runtime

Every proxied HTML page receives an injected `<script>` at the top of `<head>` that intercepts:

- `fetch()` and `XMLHttpRequest`
- `WebSocket` constructor
- `Worker` constructor
- `window.open`, `location.assign`, `location.replace`
- `history.pushState` / `replaceState`
- `document.createElement` for `<script>`, `<a>`, and `<link>` tags
- DOM mutations via `MutationObserver`
- `navigator.serviceWorker` (blocked to prevent conflicts)

It also spoofs `window.location`, `location.origin`, `location.host`, and `location.href` to return the real target's values rather than the worker's origin.

## Response Headers

The worker strips security headers that would block embedding or cross-origin access:

- `Content-Security-Policy`
- `X-Frame-Options`
- `Strict-Transport-Security`
- `Cross-Origin-Embedder-Policy`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`
- `Permissions-Policy`

It then sets permissive CORS headers and adds `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to enable `SharedArrayBuffer` support for applications that need it (e.g. games using threading).

## Known Limitations

- **YouTube** — uses encrypted signatures and its own service worker; basic page loads work but video playback is unreliable
- **Google** — detects proxy environments via navigator fingerprinting
- **Sites using `document.domain`** — not currently intercepted
- **Canvas fingerprinting** — not spoofed

## License

MIT
