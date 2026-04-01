const FLUX_PREFIX = '/fetch/';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin':   '*',
        'Access-Control-Allow-Methods':  'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
        'Access-Control-Allow-Headers':  '*',
        'Access-Control-Allow-Credentials': 'true',
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
        try { return decodeURIComponent(encoded); } catch { return encoded; }
    }
}

function rewriteUrl(url, base, workerOrigin) {
    if (!url) return url;
    const s = String(url).trim();
    if (!s ||
        s.startsWith('data:') ||
        s.startsWith('blob:') ||
        s.startsWith('javascript:') ||
        s.startsWith('#') ||
        s.startsWith('mailto:') ||
        s.startsWith('tel:') ||
        s.startsWith('about:') ||
        s.startsWith('chrome-extension:') ||
        s.startsWith('moz-extension:')) {
        return s;
    }
    if (s.includes(FLUX_PREFIX)) return s;
    if (s.startsWith(workerOrigin)) return s;
    try {
        const abs = new URL(s, base).href;
        if (!abs.startsWith('http://') && !abs.startsWith('https://')) return s;
        return `${workerOrigin}${FLUX_PREFIX}${encodeUrl(abs)}`;
    } catch {
        return s;
    }
}

function rewriteHtml(html, base, workerOrigin) {
    html = html.replace(/<base[^>]*>/gi, '');

    html = html.replace(
        /(href|src|action|data-src|data-href|poster|srcset|data-url|content)=(["'])([^"']+)\2/gi,
        (match, attr, quote, val) => {
            const lattr = attr.toLowerCase();

            if (lattr === 'content') {
                if (/(url=)(https?:\/\/[^\s"']+)/i.test(val)) {
                    return match;
                }
                return match;
            }

            if (lattr === 'srcset') {
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
        }
    );

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

    const realOrigin = base.origin;
    const realHost   = base.host;
    const realHref   = base.href;

    const injection = `<script>(function(){
'use strict';
var __fo=${JSON.stringify(workerOrigin)};
var __fp=${JSON.stringify(FLUX_PREFIX)};
var __ro=${JSON.stringify(realOrigin)};
var __rh=${JSON.stringify(realHost)};
var __rhr=${JSON.stringify(realHref)};

function __enc(u){try{return btoa(unescape(encodeURIComponent(u))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}catch(e){return encodeURIComponent(u);}}
function __dec(e){try{var b=e.replace(/-/g,'+').replace(/_/g,'/');return decodeURIComponent(escape(atob(b)));}catch(e){try{return decodeURIComponent(e);}catch(e2){return e;}}}

function __rw(u){
    if(!u)return u;
    var s=String(u);
    if(!s||s.startsWith('data:')||s.startsWith('blob:')||s.startsWith('javascript:')||s.startsWith('#')||s.startsWith('mailto:')||s.startsWith('tel:')||s.startsWith('about:'))return s;
    if(s.includes(__fp))return s;
    if(s.startsWith(__fo))return s;
    try{var a=new URL(s,__rhr).href;if(!a.startsWith('http://')&&!a.startsWith('https://'))return s;return __fo+__fp+__enc(a);}catch(e){return s;}
}

function __unwrap(u){
    if(!u)return u;
    var s=String(u);
    var idx=s.indexOf(__fp);
    if(idx===-1)return s;
    try{return __dec(s.slice(idx+__fp.length));}catch(e){return s;}
}

var _xhrOpen=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){
    var args=Array.prototype.slice.call(arguments);
    args[1]=__rw(u);
    return _xhrOpen.apply(this,args);
};

var _fetch=window.fetch;
window.fetch=function(input,init){
    if(typeof input==='string'){input=__rw(input);}
    else if(input&&typeof Request!=='undefined'&&input instanceof Request){
        var newInit=init||{};
        if(!newInit.headers&&input.headers)newInit.headers=input.headers;
        if(!newInit.method)newInit.method=input.method;
        if(!newInit.body&&input.body)newInit.body=input.body;
        if(!newInit.credentials)newInit.credentials=input.credentials;
        if(!newInit.mode)newInit.mode='cors';
        input=new Request(__rw(input.url),newInit);
    }
    if(init)delete init.credentials;
    return _fetch.call(this,input,init);
};

var _WS=window.WebSocket;
if(_WS){
    window.WebSocket=function(url,protocols){
        try{
            var abs=new URL(url,__rhr).href;
            var http=abs.replace(/^wss?:/,function(m){return m==='wss:'?'https:':'http:';});
            var scheme=abs.startsWith('wss:')?'wss:':'ws:';
            var proxied=__fo.replace(/^https?:/,scheme)+__fp+__enc(http);
            url=proxied;
        }catch(e){}
        return protocols?new _WS(url,protocols):new _WS(url);
    };
    window.WebSocket.prototype=_WS.prototype;
    window.WebSocket.CONNECTING=_WS.CONNECTING;
    window.WebSocket.OPEN=_WS.OPEN;
    window.WebSocket.CLOSING=_WS.CLOSING;
    window.WebSocket.CLOSED=_WS.CLOSED;
}

var _Worker=window.Worker;
if(_Worker){
    window.Worker=function(url,opts){
        if(typeof url==='string'||url instanceof URL)url=__rw(String(url));
        return new _Worker(url,opts);
    };
    window.Worker.prototype=_Worker.prototype;
}

var _open=window.open;
window.open=function(url){
    var args=Array.prototype.slice.call(arguments);
    args[0]=__rw(url);
    return _open.apply(this,args);
};

try{
    if(navigator.serviceWorker){
        navigator.serviceWorker.register=function(){return Promise.reject(new Error('SW blocked by proxy'));};
    }
}catch(e){}

var _assign=location.assign.bind(location);
var _replace=location.replace.bind(location);
location.assign=function(u){return _assign(__rw(u));};
location.replace=function(u){return _replace(__rw(u));};

try{
Object.defineProperty(window,'location',{
    get:function(){
        return new Proxy(location,{
            get:function(t,p){
                if(p==='href')return __unwrap(t.href);
                if(p==='origin')return __ro;
                if(p==='host')return __rh;
                if(p==='hostname')return __rh.split(':')[0];
                if(p==='protocol')return new URL(__rhr).protocol;
                if(p==='pathname')try{return new URL(__unwrap(t.href)).pathname;}catch(e){return t.pathname;}
                if(p==='search')try{return new URL(__unwrap(t.href)).search;}catch(e){return t.search;}
                if(p==='hash')return t.hash;
                if(p==='assign')return function(u){_assign(__rw(u));};
                if(p==='replace')return function(u){_replace(__rw(u));};
                if(p==='reload')return function(){t.reload();};
                if(p==='toString')return function(){return __unwrap(t.href);};
                var v=t[p];return typeof v==='function'?v.bind(t):v;
            },
            set:function(t,p,v){
                if(p==='href'){_assign(__rw(v));return true;}
                try{t[p]=v;}catch(e){}return true;
            }
        });
    }
});
}catch(e){}

try{
    Object.defineProperty(document,'domain',{
        get:function(){return __rh.split(':')[0];},
        set:function(){},
        configurable:true
    });
}catch(e){}

var _hPush=history.pushState.bind(history);
var _hReplace=history.replaceState.bind(history);
history.pushState=function(s,t,u){return _hPush(s,t,u?__rw(u):u);};
history.replaceState=function(s,t,u){return _hReplace(s,t,u?__rw(u):u);};

var _pm=window.postMessage.bind(window);
window.postMessage=function(data,targetOrigin){
    var args=Array.prototype.slice.call(arguments);
    if(!targetOrigin)args[1]='*';
    return _pm.apply(this,args);
};

var _ce=document.createElement.bind(document);
document.createElement=function(tag){
    var args=Array.prototype.slice.call(arguments);
    var el=_ce.apply(document,args);
    var t=(tag||'').toLowerCase();
    if(t==='script'){
        try{
            var sd=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');
            if(sd){Object.defineProperty(el,'src',{set:function(v){sd.set.call(el,__rw(v));},get:function(){return __unwrap(sd.get.call(el));},configurable:true});}
        }catch(e){}
    }
    if(t==='a'){
        try{
            var ad=Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype,'href');
            if(ad){Object.defineProperty(el,'href',{set:function(v){ad.set.call(el,__rw(v));},get:function(){return __unwrap(ad.get.call(el));},configurable:true});}
        }catch(e){}
    }
    if(t==='link'){
        try{
            var ld=Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype,'href');
            if(ld){Object.defineProperty(el,'href',{set:function(v){ld.set.call(el,__rw(v));},get:function(){return __unwrap(ld.get.call(el));},configurable:true});}
        }catch(e){}
    }
    if(t==='iframe'){
        try{
            var ifd=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src');
            if(ifd){Object.defineProperty(el,'src',{set:function(v){ifd.set.call(el,__rw(v));},get:function(){return __unwrap(ifd.get.call(el));},configurable:true});}
        }catch(e){}
    }
    return el;
};

if(typeof importScripts!=='undefined'){
    var _is=importScripts;
    importScripts=function(){
        var urls=Array.prototype.slice.call(arguments).map(__rw);
        return _is.apply(this,urls);
    };
}

var __origImport=function(u){return import(u);};
window.__fluxDynamicImport=function(u){try{u=__rw(String(u));}catch(e){}return __origImport(u);};

try{
var _mo=new MutationObserver(function(mutations){
    for(var i=0;i<mutations.length;i++){
        var nodes=mutations[i].addedNodes;
        for(var j=0;j<nodes.length;j++){
            var node=nodes[j];
            if(!node||node.nodeType!==1)continue;
            var nt=node.tagName||'';
            if(nt==='SCRIPT'&&node.src&&!node.src.includes(__fp))node.src=__rw(node.src);
            if(nt==='LINK'&&node.href&&!node.href.includes(__fp))node.href=__rw(node.href);
            if(nt==='IFRAME'&&node.src&&!node.src.includes(__fp))node.src=__rw(node.src);
            if(nt==='IMG'){
                if(node.src&&!node.src.includes(__fp))node.src=__rw(node.src);
                if(node.srcset&&!node.srcset.includes(__fp)){
                    node.srcset=node.srcset.split(',').map(function(p){
                        var t=p.trim();var i=t.lastIndexOf(' ');
                        return i!==-1?__rw(t.substring(0,i).trim())+t.substring(i):__rw(t);
                    }).join(', ');
                }
            }
            if(nt==='SOURCE'){
                if(node.src&&!node.src.includes(__fp))node.src=__rw(node.src);
                if(node.srcset&&!node.srcset.includes(__fp))node.srcset=__rw(node.srcset);
            }
        }
    }
});
_mo.observe(document.documentElement,{childList:true,subtree:true});
}catch(e){}

})();<\/script>`;

    if (/<head(\s[^>]*)?>/i.test(html)) {
        html = html.replace(/<head(\s[^>]*)?>/i, (m) => m + injection);
    } else if (/<html(\s[^>]*)?>/i.test(html)) {
        html = html.replace(/<html(\s[^>]*)?>/i, (m) => m + injection);
    } else {
        html = injection + html;
    }

    return html;
}

function rewriteJs(js, base, workerOrigin) {
    const header = `(function(){
var __fo=${JSON.stringify(workerOrigin)};
var __fp=${JSON.stringify(FLUX_PREFIX)};
var __fb=${JSON.stringify(base.href)};
function __fe(u){try{return btoa(unescape(encodeURIComponent(u))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}catch(e){return encodeURIComponent(u);}}
function __rw(u){if(!u)return u;var s=String(u);if(s.startsWith('data:')||s.startsWith('blob:')||s.startsWith('javascript:')||s.startsWith('#'))return s;if(s.includes(__fp))return s;if(s.startsWith(__fo))return s;try{var a=new URL(s,__fb).href;if(!a.startsWith('http://')&&!a.startsWith('https://'))return s;return __fo+__fp+__fe(a);}catch(e){return s;}}
window.__fluxDynamicImport=window.__fluxDynamicImport||function(u){return import(__rw(String(u)));};
})();\n`;

    js = js.replace(/\bimport\s*\(\s*/g, 'window.__fluxDynamicImport(');

    js = js.replace(
        /(?:^|[^.\w$])import\s+([\w*{}\s,]+\s+from\s+)?(['"`])([^'"`\s]+)\2/gm,
        (match, fromPart, quote, url) => {
            const rewritten = rewriteUrl(url, base, workerOrigin);
            return match.replace(url, rewritten);
        }
    );

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
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        if (url.pathname === '/' || url.pathname === '') {
            return new Response('Flux Proxy is running.', {
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

    const parsedTarget = new URL(targetUrl);

    if (workerUrl.search) {
        const existing = parsedTarget.search;
        parsedTarget.search = workerUrl.search;
        if (existing && existing !== workerUrl.search) {
            const merged = new URLSearchParams(existing.slice(1));
            const incoming = new URLSearchParams(workerUrl.search.slice(1));
            for (const [k, v] of incoming) merged.set(k, v);
            parsedTarget.search = '?' + merged.toString();
        }
        targetUrl = parsedTarget.href;
    }

    const reqHeaders = new Headers();
    const skipReqHeaders = new Set([
        'host', 'cf-ray', 'cf-connecting-ip',
        'x-forwarded-for', 'x-real-ip', 'x-forwarded-proto',
        'cf-ipcountry', 'cf-visitor',
    ]);

    for (const [key, val] of request.headers.entries()) {
        if (!skipReqHeaders.has(key.toLowerCase())) {
            reqHeaders.set(key, val);
        }
    }

    reqHeaders.set('Host',    parsedTarget.host);
    reqHeaders.set('Origin',  parsedTarget.origin);
    reqHeaders.set('Referer', parsedTarget.origin + '/');

    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    reqHeaders.set('User-Agent',               ua);
    reqHeaders.set('Accept',                   'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
    reqHeaders.set('Accept-Language',          'en-US,en;q=0.9');
    reqHeaders.set('Accept-Encoding',          'gzip, deflate, br');
    reqHeaders.set('Sec-CH-UA',                '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"');
    reqHeaders.set('Sec-CH-UA-Mobile',         '?0');
    reqHeaders.set('Sec-CH-UA-Platform',       '"Windows"');
    reqHeaders.set('Sec-Fetch-Dest',           'document');
    reqHeaders.set('Sec-Fetch-Mode',           'navigate');
    reqHeaders.set('Sec-Fetch-Site',           'none');
    reqHeaders.set('Sec-Fetch-User',           '?1');
    reqHeaders.set('Upgrade-Insecure-Requests','1');
    reqHeaders.set('DNT',                      '1');

    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.arrayBuffer();
    }

    let targetRes;
    try {
        targetRes = await fetch(targetUrl, {
            method:  request.method,
            headers: reqHeaders,
            body,
            redirect: 'manual',
        });
    } catch (e) {
        return new Response(`Flux fetch error: ${e.message}`, {
            status: 502,
            headers: { 'Content-Type': 'text/plain', ...corsHeaders() },
        });
    }

    if (targetRes.status >= 300 && targetRes.status < 400) {
        const loc = targetRes.headers.get('location');
        if (loc) {
            const workerOrigin = new URL(workerUrl).origin;
            const abs = new URL(loc, targetUrl).href;
            const newLoc = `${workerOrigin}${FLUX_PREFIX}${encodeUrl(abs)}`;
            const rHeaders = new Headers(corsHeaders());
            rHeaders.set('Location', newLoc);
            const setCookie = targetRes.headers.get('set-cookie');
            if (setCookie) rHeaders.set('Set-Cookie', setCookie);
            return new Response(null, { status: targetRes.status, headers: rHeaders });
        }
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
        'link',
    ]);

    for (const [key, val] of targetRes.headers.entries()) {
        if (!skipResHeaders.has(key.toLowerCase())) {
            resHeaders.set(key, val);
        }
    }

    for (const [k, v] of Object.entries(corsHeaders())) {
        resHeaders.set(k, v);
    }

    resHeaders.set('Cross-Origin-Opener-Policy',  'unsafe-none');
    resHeaders.set('Cross-Origin-Embedder-Policy', 'unsafe-none');
    resHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');

    const contentType = resHeaders.get('content-type') || targetRes.headers.get('content-type') || '';
    const ext         = (parsedTarget.pathname.split('.').pop() || '').toLowerCase();

    const mimeByExt = {
        js:'application/javascript',mjs:'application/javascript',cjs:'application/javascript',
        css:'text/css',json:'application/json',html:'text/html',htm:'text/html',
        svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',
        gif:'image/gif',webp:'image/webp',woff:'font/woff',woff2:'font/woff2',
        ttf:'font/ttf',ico:'image/x-icon',mp4:'video/mp4',webm:'video/webm',
        mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',
        wasm:'application/wasm',xml:'application/xml',txt:'text/plain',
    };

    const detectedMime = mimeByExt[ext];
    if (detectedMime && !contentType.includes(detectedMime)) {
        resHeaders.set('content-type', detectedMime);
    }

    const finalContentType = resHeaders.get('content-type') || contentType;
    const base             = parsedTarget;
    const workerOrigin     = new URL(workerUrl).origin;

    if (finalContentType.includes('text/html')) {
        let html = await targetRes.text();
        html = rewriteHtml(html, base, workerOrigin);
        resHeaders.set('content-type', 'text/html; charset=utf-8');
        resHeaders.delete('content-encoding');
        resHeaders.delete('content-length');
        return new Response(html, { status: targetRes.status, headers: resHeaders });
    }

    if (
        finalContentType.includes('javascript') ||
        ext === 'js' || ext === 'mjs' || ext === 'cjs'
    ) {
        let js = await targetRes.text();
        js = rewriteJs(js, base, workerOrigin);
        resHeaders.set('content-type', 'application/javascript; charset=utf-8');
        resHeaders.delete('content-encoding');
        resHeaders.delete('content-length');
        return new Response(js, { status: targetRes.status, headers: resHeaders });
    }

    if (finalContentType.includes('text/css') || ext === 'css') {
        let css = await targetRes.text();
        css = rewriteCss(css, base, workerOrigin);
        resHeaders.set('content-type', 'text/css; charset=utf-8');
        resHeaders.delete('content-encoding');
        resHeaders.delete('content-length');
        return new Response(css, { status: targetRes.status, headers: resHeaders });
    }

    resHeaders.delete('content-length');
    return new Response(targetRes.body, { status: targetRes.status, headers: resHeaders });
}
