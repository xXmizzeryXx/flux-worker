const FLUX_PREFIX = '/fetch/';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin':   '*',
        'Access-Control-Allow-Methods':  'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
        'Access-Control-Allow-Headers':  '*',
        'Access-Control-Expose-Headers': '*',
    };
}

function encodeUrl(url) {
    return btoa(unescape(encodeURIComponent(url)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeUrl(encoded) {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    try {
        return decodeURIComponent(escape(atob(base64)));
    } catch {
        return decodeURIComponent(encoded);
    }
}

function rewriteUrl(url, base, workerOrigin) {
    if (!url ||
        url.startsWith('data:') ||
        url.startsWith('blob:') ||
        url.startsWith('javascript:') ||
        url.startsWith('#') ||
        url.startsWith('mailto:') ||
        url.startsWith('tel:') ||
        url.startsWith('about:')) {
        return url;
    }
    if (url.includes(FLUX_PREFIX)) return url;
    if (url.startsWith(workerOrigin)) return url;
    try {
        const abs = new URL(url, base).href;
        if (!abs.startsWith('http://') && !abs.startsWith('https://')) return url;
        return `${workerOrigin}${FLUX_PREFIX}${encodeUrl(abs)}`;
    } catch {
        return url;
    }
}

function rewriteHtml(html, base, workerOrigin) {
    html = html.replace(/<base[^>]*>/gi, '');

    html = html.replace(/(href|src|action|data-src|data-href|poster|srcset)=(["'])([^"']+)\2/gi, (match, attr, quote, val) => {
        if (attr.toLowerCase() === 'srcset') {
            const rewritten = val.split(',').map(part => {
                const trimmed = part.trim();
                const spaceIdx = trimmed.lastIndexOf(' ');
                if (spaceIdx !== -1) {
                    const u = trimmed.substring(0, spaceIdx).trim();
                    const d = trimmed.substring(spaceIdx);
                    return rewriteUrl(u, base, workerOrigin) + d;
                }
                return rewriteUrl(trimmed, base, workerOrigin);
            }).join(', ');
            return `${attr}=${quote}${rewritten}${quote}`;
        }
        return `${attr}=${quote}${rewriteUrl(val, base, workerOrigin)}${quote}`;
    });

    html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, val) => {
        return `url("${rewriteUrl(val.trim(), base, workerOrigin)}")`;
    });

    html = html.replace(/(<[^>]+\bstyle=["'])([^"']+)(["'])/gi, (match, open, style, close) => {
        const rewrittenStyle = style.replace(/url\(["']?([^"')]+)["']?\)/gi, (m, u) => {
            return `url("${rewriteUrl(u.trim(), base, workerOrigin)}")`;
        });
        return open + rewrittenStyle + close;
    });

    html = html.replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, '');

    const realOrigin    = base.origin;
    const realHost      = base.host;
    const realHref      = base.href;

    const injection = `<script>
(function() {
    const __fluxOrigin   = ${JSON.stringify(workerOrigin)};
    const __fluxPrefix   = ${JSON.stringify(FLUX_PREFIX)};
    const __realOrigin   = ${JSON.stringify(realOrigin)};
    const __realHost     = ${JSON.stringify(realHost)};
    const __realHref     = ${JSON.stringify(realHref)};

    function __encode(url) {
        try {
            return btoa(unescape(encodeURIComponent(url)))
                .replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
        } catch { return encodeURIComponent(url); }
    }

    function __decode(enc) {
        try {
            const b = enc.replace(/-/g,'+').replace(/_/g,'/');
            return decodeURIComponent(escape(atob(b)));
        } catch { return decodeURIComponent(enc); }
    }

    function __rewrite(url) {
        if (!url) return url;
        const s = String(url);
        if (s.startsWith('data:') || s.startsWith('blob:') ||
            s.startsWith('javascript:') || s.startsWith('#') ||
            s.startsWith('mailto:') || s.startsWith('about:')) return s;
        if (s.includes(__fluxPrefix)) return s;
        if (s.startsWith(__fluxOrigin)) return s;
        try {
            const abs = new URL(s, __realHref).href;
            if (!abs.startsWith('http://') && !abs.startsWith('https://')) return s;
            return __fluxOrigin + __fluxPrefix + __encode(abs);
        } catch { return s; }
    }

    function __unwrap(url) {
        if (!url) return url;
        const s = String(url);
        const idx = s.indexOf(__fluxPrefix);
        if (idx === -1) return s;
        try { return __decode(s.slice(idx + __fluxPrefix.length)); } catch { return s; }
    }

    const _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        return _xhrOpen.call(this, method, __rewrite(url), ...args);
    };

    const _fetch = window.fetch;
    window.fetch = function(input, init) {
        if (typeof input === 'string') {
            input = __rewrite(input);
        } else if (input instanceof Request) {
            input = new Request(__rewrite(input.url), input);
        }
        return _fetch.call(this, input, init);
    };

    const _wsOriginal = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        try {
            const abs  = new URL(url, __realHref).href;
            const http = abs.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
            const proxied = __fluxOrigin.replace(/^http/, abs.startsWith('wss') ? 'wss' : 'ws')
                + __fluxPrefix + __encode(http);
            url = proxied;
        } catch {}
        return protocols
            ? new _wsOriginal(url, protocols)
            : new _wsOriginal(url);
    };
    window.WebSocket.prototype = _wsOriginal.prototype;
    window.WebSocket.CONNECTING = _wsOriginal.CONNECTING;
    window.WebSocket.OPEN       = _wsOriginal.OPEN;
    window.WebSocket.CLOSING    = _wsOriginal.CLOSING;
    window.WebSocket.CLOSED     = _wsOriginal.CLOSED;

    const _Worker = window.Worker;
    window.Worker = function(url, opts) {
        if (typeof url === 'string' || url instanceof URL) {
            url = __rewrite(String(url));
        }
        return new _Worker(url, opts);
    };
    window.Worker.prototype = _Worker.prototype;

    const _open = window.open;
    window.open = function(url, ...args) {
        return _open.call(this, __rewrite(url), ...args);
    };

    Object.defineProperty(document, 'cookie', {
        get() { return ''; },
        set() {},
    });

    Object.defineProperty(navigator, 'serviceWorker', {
        get() { return undefined; },
        configurable: true,
    });

    const _assign   = location.assign.bind(location);
    const _replace  = location.replace.bind(location);
    location.assign  = (url) => _assign(__rewrite(url));
    location.replace = (url) => _replace(__rewrite(url));

    Object.defineProperty(window, 'location', {
        get() {
            return new Proxy(location, {
                get(target, prop) {
                    if (prop === 'href')     return __unwrap(target.href);
                    if (prop === 'origin')   return __realOrigin;
                    if (prop === 'host')     return __realHost;
                    if (prop === 'hostname') return __realHost.split(':')[0];
                    if (prop === 'protocol') return new URL(__realHref).protocol;
                    if (prop === 'pathname') return new URL(__unwrap(target.href)).pathname;
                    if (prop === 'search')   return new URL(__unwrap(target.href)).search;
                    if (prop === 'hash')     return target.hash;
                    if (prop === 'assign')   return (url) => _assign(__rewrite(url));
                    if (prop === 'replace')  return (url) => _replace(__rewrite(url));
                    if (prop === 'reload')   return () => target.reload();
                    const val = target[prop];
                    return typeof val === 'function' ? val.bind(target) : val;
                },
                set(target, prop, val) {
                    if (prop === 'href') { _assign(__rewrite(val)); return true; }
                    target[prop] = val;
                    return true;
                }
            });
        }
    });

    const _historyPush    = history.pushState.bind(history);
    const _historyReplace = history.replaceState.bind(history);
    history.pushState    = (state, title, url) => _historyPush(state, title, url ? __rewrite(url) : url);
    history.replaceState = (state, title, url) => _historyReplace(state, title, url ? __rewrite(url) : url);

    const _createElement = document.createElement.bind(document);
    document.createElement = function(tag, ...args) {
        const el = _createElement(tag, ...args);
        if (tag.toLowerCase() === 'script') {
            const _setSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
            if (_setSrc) {
                Object.defineProperty(el, 'src', {
                    set(val) { _setSrc.set.call(el, __rewrite(val)); },
                    get()    { return __unwrap(_setSrc.get.call(el)); },
                });
            }
        }
        if (tag.toLowerCase() === 'a' || tag.toLowerCase() === 'link') {
            const _setHref = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href')
                          || Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
            if (_setHref) {
                Object.defineProperty(el, 'href', {
                    set(val) { _setHref.set.call(el, __rewrite(val)); },
                    get()    { return __unwrap(_setHref.get.call(el)); },
                });
            }
        }
        return el;
    };

    const _postMessage = window.postMessage.bind(window);
    window.postMessage = function(data, targetOrigin, ...args) {
        if (targetOrigin && targetOrigin !== '*') targetOrigin = '*';
        return _postMessage(data, targetOrigin, ...args);
    };

    const _importScripts = typeof importScripts !== 'undefined' ? importScripts : null;
    if (_importScripts) {
        importScripts = function(...urls) {
            return _importScripts(...urls.map(__rewrite));
        };
    }

    const __origImport = (u) => import(u);
    window.__fluxDynamicImport = function(u) {
        try { u = __rewrite(String(u)); } catch {}
        return __origImport(u);
    };

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.tagName === 'SCRIPT' && node.src && !node.src.includes(__fluxPrefix)) {
                    node.src = __rewrite(node.src);
                }
                if (node.tagName === 'LINK' && node.href && !node.href.includes(__fluxPrefix)) {
                    node.href = __rewrite(node.href);
                }
                if (node.tagName === 'IMG') {
                    if (node.src  && !node.src.includes(__fluxPrefix))  node.src  = __rewrite(node.src);
                    if (node.srcset && !node.srcset.includes(__fluxPrefix)) {
                        node.srcset = node.srcset.split(',').map(p => {
                            const t = p.trim();
                            const i = t.lastIndexOf(' ');
                            return i !== -1
                                ? __rewrite(t.substring(0, i).trim()) + t.substring(i)
                                : __rewrite(t);
                        }).join(', ');
                    }
                }
            }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

})();
</script>`;

    if (/<head(\s[^>]*)?>/i.test(html)) {
        html = html.replace(/<head(\s[^>]*)?>/i, (m) => m + injection);
    } else {
        html = injection + html;
    }

    return html;
}

function rewriteJs(js, base, workerOrigin) {
    const header = `(function(){
const __fluxOrigin=${JSON.stringify(workerOrigin)};
const __fluxPrefix=${JSON.stringify(FLUX_PREFIX)};
const __fluxBase=${JSON.stringify(base.href)};
function __fluxEncode(u){try{return btoa(unescape(encodeURIComponent(u))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}catch{return encodeURIComponent(u);}}
function __fluxRewrite(u){if(!u)return u;const s=String(u);if(s.startsWith('data:')||s.startsWith('blob:')||s.startsWith('javascript:')||s.startsWith('#'))return s;if(s.includes(__fluxPrefix))return s;if(s.startsWith(__fluxOrigin))return s;try{const a=new URL(s,__fluxBase).href;if(!a.startsWith('http://')&&!a.startsWith('https://'))return s;return __fluxOrigin+__fluxPrefix+__fluxEncode(a);}catch{return s;}}
window.__fluxDynamicImport=window.__fluxDynamicImport||function(u){return import(__fluxRewrite(String(u)));};
})();\n`;

    js = js.replace(/(['"`])((?:https?:)?\/\/[^'"`\s]+)\1/g, (match, quote, url) => {
        const rewritten = rewriteUrl(url, base, workerOrigin);
        return quote + rewritten + quote;
    });

    js = js.replace(/\bimport\s*\(\s*/g, '__fluxDynamicImport(');

    js = js.replace(/(?:^|[^.\w])import\s+(?:[\w*{}\s,]+\s+from\s+)?(['"`])([^'"`]+)\1/gm, (match, quote, url) => {
        return match.replace(url, rewriteUrl(url, base, workerOrigin));
    });

    return header + js;
}

function rewriteCss(css, base, workerOrigin) {
    return css.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
        return `url("${rewriteUrl(url.trim(), base, workerOrigin)}")`;
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders() });
        }

        if (url.pathname === '/') {
            return new Response('Flux Worker is running.', {
                headers: { 'Content-Type': 'text/plain', ...corsHeaders() },
            });
        }

        if (url.pathname.startsWith(FLUX_PREFIX)) {
            return handleFetch(request, url);
        }

        return new Response('Not found', { status: 404, headers: corsHeaders() });
    },
};

async function handleFetch(request, workerUrl) {
    const encoded = workerUrl.pathname.slice(FLUX_PREFIX.length);
    if (!encoded) {
        return new Response('Missing target URL', { status: 400, headers: corsHeaders() });
    }

    let targetUrl;
    try {
        targetUrl = decodeUrl(encoded);
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }
        new URL(targetUrl);
    } catch {
        return new Response('Invalid target URL', { status: 400, headers: corsHeaders() });
    }

    if (workerUrl.search) {
        targetUrl += workerUrl.search;
    }

    const reqHeaders = new Headers();
    const skipReqHeaders = new Set([
        'host', 'origin', 'referer', 'cf-ray', 'cf-connecting-ip',
        'x-forwarded-for', 'x-real-ip', 'x-forwarded-proto',
    ]);

    for (const [key, val] of request.headers.entries()) {
        if (!skipReqHeaders.has(key.toLowerCase())) {
            reqHeaders.set(key, val);
        }
    }

    const parsedTarget = new URL(targetUrl);
    reqHeaders.set('Host',                    parsedTarget.host);
    reqHeaders.set('Origin',                  parsedTarget.origin);
    reqHeaders.set('Referer',                 parsedTarget.origin + '/');
    reqHeaders.set('User-Agent',              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    reqHeaders.set('Accept',                  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
    reqHeaders.set('Accept-Language',         'en-US,en;q=0.9');
    reqHeaders.set('Sec-Fetch-Dest',          'document');
    reqHeaders.set('Sec-Fetch-Mode',          'navigate');
    reqHeaders.set('Sec-Fetch-Site',          'none');
    reqHeaders.set('Upgrade-Insecure-Requests', '1');

    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.arrayBuffer();
    }

    let targetRes;
    try {
        targetRes = await fetch(targetUrl, {
            method:   request.method,
            headers:  reqHeaders,
            body,
            redirect: 'follow',
        });
    } catch (e) {
        return new Response(`Flux fetch error: ${e.message}`, {
            status: 502,
            headers: corsHeaders(),
        });
    }

    const resHeaders = new Headers();
    const skipResHeaders = new Set([
        'content-security-policy',
        'content-security-policy-report-only',
        'x-frame-options',
        'x-content-type-options',
        'strict-transport-security',
        'x-xss-protection',
        'permissions-policy',
        'cross-origin-embedder-policy',
        'cross-origin-opener-policy',
        'cross-origin-resource-policy',
        'expect-ct',
        'nel',
        'report-to',
    ]);

    for (const [key, val] of targetRes.headers.entries()) {
        if (!skipResHeaders.has(key.toLowerCase())) {
            resHeaders.set(key, val);
        }
    }

    for (const [k, v] of Object.entries(corsHeaders())) {
        resHeaders.set(k, v);
    }

    resHeaders.set('Cross-Origin-Opener-Policy',   'same-origin');
    resHeaders.set('Cross-Origin-Embedder-Policy',  'require-corp');

    const contentType = resHeaders.get('content-type') || targetRes.headers.get('content-type') || '';
    const ext         = parsedTarget.pathname.split('.').pop().toLowerCase();

    const mimeByExt = {
        js:    'application/javascript', mjs:  'application/javascript',
        cjs:   'application/javascript', css:  'text/css',
        json:  'application/json',       html: 'text/html',
        htm:   'text/html',              svg:  'image/svg+xml',
        png:   'image/png',              jpg:  'image/jpeg',
        jpeg:  'image/jpeg',             gif:  'image/gif',
        webp:  'image/webp',             woff: 'font/woff',
        woff2: 'font/woff2',             ttf:  'font/ttf',
        ico:   'image/x-icon',           mp4:  'video/mp4',
        webm:  'video/webm',             mp3:  'audio/mpeg',
        ogg:   'audio/ogg',              wav:  'audio/wav',
        wasm:  'application/wasm',       xml:  'application/xml',
        txt:   'text/plain',
    };

    const detectedMime = mimeByExt[ext];
    if (detectedMime && !contentType.includes(detectedMime)) {
        resHeaders.set('content-type', detectedMime);
    }

    const finalContentType = resHeaders.get('content-type') || contentType;
    const base             = new URL(targetUrl);
    const workerOrigin     = new URL(workerUrl).origin;

    if (finalContentType.includes('text/html')) {
        let html = await targetRes.text();
        html = rewriteHtml(html, base, workerOrigin);
        resHeaders.set('content-type', 'text/html; charset=utf-8');
        resHeaders.delete('content-encoding');
        return new Response(html, { status: targetRes.status, headers: resHeaders });
    }

    if (finalContentType.includes('javascript') || ext === 'js' || ext === 'mjs' || ext === 'cjs') {
        let js = await targetRes.text();
        js = rewriteJs(js, base, workerOrigin);
        resHeaders.set('content-type', 'application/javascript');
        resHeaders.delete('content-encoding');
        return new Response(js, { status: targetRes.status, headers: resHeaders });
    }

    if (finalContentType.includes('text/css') || ext === 'css') {
        let css = await targetRes.text();
        css = rewriteCss(css, base, workerOrigin);
        resHeaders.set('content-type', 'text/css');
        resHeaders.delete('content-encoding');
        return new Response(css, { status: targetRes.status, headers: resHeaders });
    }

    return new Response(targetRes.body, { status: targetRes.status, headers: resHeaders });
}
