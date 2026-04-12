const FLUX_PREFIX = '/fetch/';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin':      '*',
        'Access-Control-Allow-Methods':     'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
        'Access-Control-Allow-Headers':     '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Expose-Headers':    '*',
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
        try {
            return decodeURIComponent(encoded);
        } catch {
            return null;
        }
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

function rewriteSrcset(val, base, workerOrigin) {
    return val.split(',').map(part => {
        const trimmed = part.trim();
        const spaceIdx = trimmed.lastIndexOf(' ');
        if (spaceIdx !== -1) {
            const u = trimmed.substring(0, spaceIdx).trim();
            const d = trimmed.substring(spaceIdx);
            return rewriteUrl(u, base, workerOrigin) + d;
        }
        return rewriteUrl(trimmed, base, workerOrigin);
    }).join(', ');
}

function rewriteCssText(css, base, workerOrigin) {
    // Rewrite url() references
    css = css.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, u) => {
        return `url("${rewriteUrl(u.trim(), base, workerOrigin)}")`;
    });
    // Rewrite @import "..." and @import '...'
    css = css.replace(/@import\s+(["'])([^"']+)\1/gi, (match, quote, u) => {
        return `@import ${quote}${rewriteUrl(u.trim(), base, workerOrigin)}${quote}`;
    });
    // Rewrite @import url(...) (already handled above but be explicit)
    css = css.replace(/@import\s+url\(["']?([^"')]+)["']?\)/gi, (match, u) => {
        return `@import url("${rewriteUrl(u.trim(), base, workerOrigin)}")`;
    });
    return css;
}

function rewriteHtml(html, base, workerOrigin) {
    // Strip base tags
    html = html.replace(/<base[^>]*>/gi, '');

    // Strip meta refresh
    html = html.replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, '');

    // Strip CSP meta tags (they block our injected script)
    html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');

    // Strip integrity and crossorigin attributes (SRI breaks rewritten content)
    html = html.replace(/\s+integrity=["'][^"']*["']/gi, '');
    html = html.replace(/\s+crossorigin=["'][^"']*["']/gi, '');

    // Rewrite standard URL attributes
    html = html.replace(
        /(href|src|action|data-src|data-href|poster|data-url)=(["'])([^"']*)\2/gi,
        (match, attr, quote, val) => {
            return `${attr}=${quote}${rewriteUrl(val, base, workerOrigin)}${quote}`;
        }
    );

    // Rewrite srcset attributes
    html = html.replace(
        /srcset=(["'])([^"']*)\1/gi,
        (match, quote, val) => {
            return `srcset=${quote}${rewriteSrcset(val, base, workerOrigin)}${quote}`;
        }
    );

    // Rewrite preload / modulepreload link hrefs
    html = html.replace(
        /(<link[^>]+rel=["']?(?:preload|modulepreload|stylesheet|icon|shortcut icon|apple-touch-icon)[^>]*?\s)href=(["'])([^"']+)\2/gi,
        (match, prefix, quote, val) => {
            return `${prefix}href=${quote}${rewriteUrl(val, base, workerOrigin)}${quote}`;
        }
    );

    // Rewrite inline style attributes
    html = html.replace(
        /(<[^>]+\bstyle=["'])([^"']+)(["'])/gi,
        (match, open, style, close) => {
            return open + rewriteCssText(style, base, workerOrigin) + close;
        }
    );

    // Rewrite <style> blocks
    html = html.replace(
        /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
        (match, open, css, close) => {
            return open + rewriteCssText(css, base, workerOrigin) + close;
        }
    );

    // Rewrite inline <script> blocks (handle import statements and fetch/XHR URLs)
    html = html.replace(
        /(<script(?:[^>](?!src=))*>)([\s\S]*?)(<\/script>)/gi,
        (match, open, js, close) => {
            if (!js.trim()) return match;
            return open + rewriteInlineJs(js, base, workerOrigin) + close;
        }
    );

    // Rewrite url() in any remaining text nodes (SVG use, etc.)
    html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, u) => {
        return `url("${rewriteUrl(u.trim(), base, workerOrigin)}")`;
    });

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

// Navigator spoofing
var __navOverrides={
    webdriver:undefined,platform:'Win32',vendor:'Google Inc.',appName:'Netscape',
    appVersion:'5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    languages:['en-US','en'],hardwareConcurrency:8,deviceMemory:8,maxTouchPoints:0,
    cookieEnabled:true,onLine:true
};
for(var __k in __navOverrides){
    try{Object.defineProperty(navigator,__k,{get:function(__v){return function(){return __v;};}(__navOverrides[__k]),configurable:true});}catch(e){}
}

try{
    var __plFake=[{filename:'internal/default/internal_delegate_composite.so'},{filename:'internal/default/libpepflashplayer.so'}];
    Object.defineProperty(navigator,'plugins',{get:function(){return __plFake;},configurable:true});
    Object.defineProperty(navigator,'mimeTypes',{get:function(){return [];},configurable:true});
}catch(e){}

try{
    if(!window.chrome){Object.defineProperty(window,'chrome',{value:{runtime:{},loadTimes:function(){},csi:function(){},app:{}},writable:false,configurable:true});}
}catch(e){}

try{
    var __permQuery=navigator.permissions&&navigator.permissions.query.bind(navigator.permissions);
    if(__permQuery){navigator.permissions.query=function(desc){if(desc&&desc.name==='notifications'){return Promise.resolve({state:Notification.permission==='default'?'prompt':Notification.permission});}return __permQuery(desc);};}
}catch(e){}

try{Object.defineProperty(window,'outerWidth',{get:function(){return window.innerWidth;},configurable:true});}catch(e){}
try{Object.defineProperty(window,'outerHeight',{get:function(){return window.innerHeight+80;},configurable:true});}catch(e){}
var __screenProps={width:1920,height:1080,availWidth:1920,availHeight:1040,colorDepth:24,pixelDepth:24};
for(var __sk in __screenProps){try{Object.defineProperty(screen,__sk,{get:function(__v){return function(){return __v;};}(__screenProps[__sk]),configurable:true});}catch(e){}}
try{if(window.name&&window.name.includes(__fo))window.name='';}catch(e){}

// WebRTC leak prevention — strip ICE servers so local IP is never exposed
try{
    var _RTC=window.RTCPeerConnection;
    if(_RTC){
        window.RTCPeerConnection=function(cfg,opts){
            if(cfg&&cfg.iceServers)cfg.iceServers=[];
            return new _RTC(cfg,opts);
        };
        window.RTCPeerConnection.prototype=_RTC.prototype;
        window.RTCPeerConnection.HAVE_LOCAL_OFFER=_RTC.HAVE_LOCAL_OFFER;
        window.RTCPeerConnection.HAVE_REMOTE_OFFER=_RTC.HAVE_REMOTE_OFFER;
    }
}catch(e){}

// XHR proxy
var _xhrOpen=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){
    var args=Array.prototype.slice.call(arguments);
    args[1]=__rw(u);
    return _xhrOpen.apply(this,args);
};

// Fetch proxy
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

// WebSocket proxy
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

// Worker proxy
var _Worker=window.Worker;
if(_Worker){
    window.Worker=function(url,opts){
        if(typeof url==='string'||url instanceof URL){
            try{url=__fo+__fp+__enc(new URL(String(url),__rhr).href);}catch(e){}
        }
        return new _Worker(url,opts);
    };
    window.Worker.prototype=_Worker.prototype;
}

// window.open proxy
var _open=window.open;
window.open=function(url){
    var args=Array.prototype.slice.call(arguments);
    if(args[0])args[0]=__rw(args[0]);
    return _open.apply(this,args);
};

// Service worker: rewrite registration URL through proxy instead of blocking
try{
    if(navigator.serviceWorker){
        var _swReg=navigator.serviceWorker.register.bind(navigator.serviceWorker);
        navigator.serviceWorker.register=function(url,opts){
            try{url=__fo+__fp+__enc(new URL(String(url),__rhr).href);}catch(e){}
            return _swReg(url,opts);
        };
    }
}catch(e){}

// Blob URL interception — rewrite JS/HTML blobs before they escape
try{
    var _createObjectURL=URL.createObjectURL.bind(URL);
    var _revokeObjectURL=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=function(obj){
        if(obj instanceof Blob&&obj.type&&(obj.type.includes('javascript')||obj.type.includes('html'))){
            // Async rewrite: return a placeholder and swap after read
            // For synchronous callers we fall through to original
            try{
                var reader=new FileReaderSync();
                var text=reader.readAsText(obj);
                var rewritten=text.replace(/url\(["']?([^"')]+)["']?\)/gi,function(m,u){return 'url("'+__rw(u.trim())+'")';});
                rewritten=rewritten.replace(/(?:import|from)\s+(["'])([^"']+)\1/g,function(m,q,u){return m.replace(u,__rw(u));});
                return _createObjectURL(new Blob([rewritten],{type:obj.type}));
            }catch(e){
                // FileReaderSync not available in main thread; fall through
            }
        }
        return _createObjectURL(obj);
    };
}catch(e){}

// postMessage origin spoofing — rewrite event.origin so site message handlers accept messages
try{
    var _aEL=EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener=function(type,handler,opts){
        if(type==='message'&&typeof handler==='function'){
            var _wrapped=function(e){
                try{
                    var src=e.source;
                    // Only spoof if message came from our proxy frame
                    if(e.origin&&e.origin===__fo){
                        Object.defineProperty(e,'origin',{value:__ro,configurable:true});
                    }
                }catch(_){}
                return handler.call(this,e);
            };
            // Store ref so removeEventListener still works
            handler.__fluxWrapped=_wrapped;
            return _aEL.call(this,type,_wrapped,opts);
        }
        return _aEL.call(this,type,handler,opts);
    };
    var _rEL=EventTarget.prototype.removeEventListener;
    EventTarget.prototype.removeEventListener=function(type,handler,opts){
        if(type==='message'&&handler&&handler.__fluxWrapped){
            return _rEL.call(this,type,handler.__fluxWrapped,opts);
        }
        return _rEL.call(this,type,handler,opts);
    };
}catch(e){}

// document.cookie domain spoofing — strip domain from set, return as-is on get
try{
    var _cookieDesc=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');
    if(_cookieDesc){
        Object.defineProperty(document,'cookie',{
            get:function(){return _cookieDesc.get.call(document);},
            set:function(v){
                if(typeof v==='string'){
                    v=v.replace(/;\s*domain=[^;]*/gi,'');
                    v=v.replace(/;\s*samesite=[^;]*/gi,'; SameSite=None');
                }
                _cookieDesc.set.call(document,v);
            },
            configurable:true
        });
    }
}catch(e){}

// eval() and new Function() rewriting — catch dynamically generated code with hardcoded URLs
try{
    var _eval=window.eval;
    window.eval=function(code){
        if(typeof code==='string'){
            code=code.replace(/\bimport\s*\(\s*/g,'window.__fluxDynamicImport(');
        }
        return _eval.call(this,code);
    };
    var _Function=window.Function;
    window.Function=function(){
        var args=Array.prototype.slice.call(arguments);
        var body=args.pop();
        if(typeof body==='string'){
            body=body.replace(/\bimport\s*\(\s*/g,'window.__fluxDynamicImport(');
        }
        args.push(body);
        return _Function.apply(this,args);
    };
    window.Function.prototype=_Function.prototype;
}catch(e){}

// location proxy
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
                if(p==='protocol')try{return new URL(__rhr).protocol;}catch(e){return t.protocol;}
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

// History proxy
var _hPush=history.pushState.bind(history);
var _hReplace=history.replaceState.bind(history);
history.pushState=function(s,t,u){return _hPush(s,t,u?__rw(u):u);};
history.replaceState=function(s,t,u){return _hReplace(s,t,u?__rw(u):u);};

var _pm=window.postMessage.bind(window);
window.postMessage=function(data,targetOrigin){
    var args=Array.prototype.slice.call(arguments);
    if(!targetOrigin||targetOrigin===__fo)args[1]='*';
    return _pm.apply(this,args);
};

// createElement proxy
var _ce=document.createElement.bind(document);
document.createElement=function(tag){
    var el=_ce.apply(document,Array.prototype.slice.call(arguments));
    var t=(tag||'').toLowerCase();
    var urlProps={script:'src',a:'href',link:'href',iframe:'src',img:'src',source:'src',audio:'src',video:'src',track:'src'};
    var prop=urlProps[t];
    if(prop){
        try{
            var proto=el.constructor&&el.constructor.prototype;
            var desc=proto&&Object.getOwnPropertyDescriptor(proto,prop);
            if(desc){
                Object.defineProperty(el,prop,{
                    set:function(v){desc.set.call(el,__rw(v));},
                    get:function(){return __unwrap(desc.get.call(el));},
                    configurable:true
                });
            }
        }catch(e){}
    }
    // Strip integrity on created elements
    if(t==='script'||t==='link'){
        try{Object.defineProperty(el,'integrity',{set:function(){},get:function(){return '';},configurable:true});}catch(e){}
    }
    return el;
};

// importScripts (workers)
if(typeof importScripts!=='undefined'){
    var _is=importScripts;
    importScripts=function(){
        var urls=Array.prototype.slice.call(arguments).map(__rw);
        return _is.apply(this,urls);
    };
}

// Dynamic import()
window.__fluxDynamicImport=function(u){
    try{u=__rw(String(u));}catch(e){}
    return import(u);
};

// MutationObserver - disconnect after document ready to avoid perf drain on SPAs
var __moActive=true;
var _mo=new MutationObserver(function(mutations){
    if(!__moActive)return;
    for(var i=0;i<mutations.length;i++){
        var nodes=mutations[i].addedNodes;
        for(var j=0;j<nodes.length;j++){
            var node=nodes[j];
            if(!node||node.nodeType!==1)continue;
            var nt=node.tagName||'';
            if((nt==='SCRIPT'||nt==='IFRAME'||nt==='AUDIO'||nt==='VIDEO'||nt==='TRACK')&&node.src&&!node.src.includes(__fp))node.src=__rw(node.src);
            if((nt==='LINK'||nt==='A')&&node.href&&!node.href.includes(__fp))node.href=__rw(node.href);
            if(nt==='IMG'){
                if(node.src&&!node.src.includes(__fp))node.src=__rw(node.src);
                if(node.srcset&&!node.srcset.includes(__fp)){
                    node.srcset=node.srcset.split(',').map(function(p){
                        var tr=p.trim();var i=tr.lastIndexOf(' ');
                        return i!==-1?__rw(tr.substring(0,i).trim())+tr.substring(i):__rw(tr);
                    }).join(', ');
                }
            }
            if(nt==='SOURCE'){
                if(node.src&&!node.src.includes(__fp))node.src=__rw(node.src);
                if(node.srcset&&!node.srcset.includes(__fp))node.srcset=__rw(node.srcset);
            }
            // Strip integrity/crossorigin on dynamically added elements
            if(node.integrity!==undefined)try{node.integrity='';}catch(e){}
            if(node.crossOrigin!==undefined)try{node.crossOrigin=null;}catch(e){}
        }
    }
});
_mo.observe(document.documentElement,{childList:true,subtree:true});

if(document.readyState==='complete'){
    setTimeout(function(){__moActive=false;},2000);
}else{
    window.addEventListener('load',function(){setTimeout(function(){__moActive=false;},2000);},{once:true});
}
window.addEventListener('popstate',function(){__moActive=true;setTimeout(function(){__moActive=false;},2000);});

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

function rewriteInlineJs(js, base, workerOrigin) {
    return rewriteJs(js, base, workerOrigin, true);
}

function rewriteJs(js, base, workerOrigin, inline = false) {
    const header = `(function(){
var __fo=${JSON.stringify(workerOrigin)};
var __fp=${JSON.stringify(FLUX_PREFIX)};
var __fb=${JSON.stringify(base.href)};
function __fe(u){try{return btoa(unescape(encodeURIComponent(u))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}catch(e){return encodeURIComponent(u);}}
function __rw(u){if(!u)return u;var s=String(u);if(s.startsWith('data:')||s.startsWith('blob:')||s.startsWith('javascript:')||s.startsWith('#'))return s;if(s.includes(__fp))return s;if(s.startsWith(__fo))return s;try{var a=new URL(s,__fb).href;if(!a.startsWith('http://')&&!a.startsWith('https://'))return s;return __fo+__fp+__fe(a);}catch(e){return s;}}
window.__fluxDynamicImport=window.__fluxDynamicImport||function(u){return import(__rw(String(u)));};
})();\n`;

    // Rewrite dynamic import() calls
    js = js.replace(/\bimport\s*\(\s*/g, 'window.__fluxDynamicImport(');

    // Rewrite static import/export from declarations
    js = js.replace(
        /^(\s*(?:import|export)\s+(?:[\w*{}\s,]+\s+from\s+)?)(["'`])([^"'`\s]+)\2/gm,
        (match, prefix, quote, url) => {
            const rewritten = rewriteUrl(url, base, workerOrigin);
            return `${prefix}${quote}${rewritten}${quote}`;
        }
    );

    if (inline) return js;
    return header + js;
}

function rewriteCss(css, base, workerOrigin) {
    return rewriteCssText(css, base, workerOrigin);
}

function rewriteCookieHeader(cookieHeader, targetHost) {
    if (!cookieHeader) return cookieHeader;
    return cookieHeader
        .replace(/;\s*domain=[^;]*/gi, '')
        .replace(/;\s*samesite=[^;]*/gi, '; SameSite=None')
        .replace(/;\s*secure/gi, '')
        + '; Secure';
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

    const targetUrlRaw = decodeUrl(encoded);
    if (!targetUrlRaw) {
        return new Response('Invalid encoded URL', { status: 400, headers: corsHeaders() });
    }

    let targetUrl;
    try {
        if (!targetUrlRaw.startsWith('http://') && !targetUrlRaw.startsWith('https://')) {
            targetUrl = 'https://' + targetUrlRaw;
        } else {
            targetUrl = targetUrlRaw;
        }
        new URL(targetUrl);
    } catch {
        return new Response('Invalid target URL', { status: 400, headers: corsHeaders() });
    }

    const parsedTarget = new URL(targetUrl);

    // Forward query string from the proxy request onto the target, without
    // leaking internal proxy params. Only merge if target has no search already.
    if (workerUrl.search && !parsedTarget.search) {
        parsedTarget.search = workerUrl.search;
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
    reqHeaders.set('User-Agent',                ua);
    reqHeaders.set('Accept',                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
    reqHeaders.set('Accept-Language',           'en-US,en;q=0.9');
    reqHeaders.set('Accept-Encoding',           'gzip, deflate, br');
    reqHeaders.set('Sec-CH-UA',                 '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"');
    reqHeaders.set('Sec-CH-UA-Mobile',          '?0');
    reqHeaders.set('Sec-CH-UA-Platform',        '"Windows"');
    reqHeaders.set('Sec-Fetch-Dest',            'document');
    reqHeaders.set('Sec-Fetch-Mode',            'navigate');
    reqHeaders.set('Sec-Fetch-Site',            'none');
    reqHeaders.set('Sec-Fetch-User',            '?1');
    reqHeaders.set('Upgrade-Insecure-Requests', '1');
    reqHeaders.set('DNT',                       '1');

    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = request.body;
    }

    let targetRes;
    try {
        targetRes = await fetch(targetUrl, {
            method:  request.method,
            headers: reqHeaders,
            body,
            redirect: 'manual',
            duplex: 'half',
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
            const abs    = new URL(loc, targetUrl).href;
            const newLoc = `${workerOrigin}${FLUX_PREFIX}${encodeUrl(abs)}`;
            const rHeaders = new Headers(corsHeaders());
            rHeaders.set('Location', newLoc);

            // Forward ALL set-cookie headers on redirects
            const cookies = targetRes.headers.getAll
                ? targetRes.headers.getAll('set-cookie')
                : [targetRes.headers.get('set-cookie')].filter(Boolean);
            cookies.forEach(c => {
                rHeaders.append('Set-Cookie', rewriteCookieHeader(c, parsedTarget.host));
            });

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

    // Forward ALL set-cookie headers on regular responses
    const cookies = targetRes.headers.getAll
        ? targetRes.headers.getAll('set-cookie')
        : [targetRes.headers.get('set-cookie')].filter(Boolean);
    cookies.forEach(c => {
        resHeaders.append('Set-Cookie', rewriteCookieHeader(c, parsedTarget.host));
    });

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

    if (finalContentType.includes('javascript') || ext === 'js' || ext === 'mjs' || ext === 'cjs') {
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

    // Everything else streams directly — no buffering
    resHeaders.delete('content-length');
    return new Response(targetRes.body, { status: targetRes.status, headers: resHeaders });
}
