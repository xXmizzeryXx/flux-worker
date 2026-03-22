export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    if (url.pathname === '/') {
      return new Response('Flux Worker is running.', {
        headers: { 'Content-Type': 'text/plain', ...corsHeaders() },
      });
    }

    if (url.pathname.startsWith('/fetch/')) {
      return handleFetch(request, url);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders() });
  },
};

async function handleFetch(request, workerUrl) {
  const encodedTarget = workerUrl.pathname.slice('/fetch/'.length);
  if (!encodedTarget) {
    return new Response('Missing target URL', { status: 400, headers: corsHeaders() });
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(encodedTarget);
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }
    new URL(targetUrl);
  } catch (e) {
    return new Response('Invalid target URL', { status: 400, headers: corsHeaders() });
  }

  const searchParams = workerUrl.search;
  if (searchParams) {
    targetUrl += searchParams;
  }

  const reqHeaders = new Headers();
  const skipHeaders = new Set([
    'host', 'origin', 'referer', 'cf-ray', 'cf-connecting-ip',
    'x-forwarded-for', 'x-real-ip', 'x-forwarded-proto',
  ]);

  for (const [key, val] of request.headers.entries()) {
    if (!skipHeaders.has(key.toLowerCase())) {
      reqHeaders.set(key, val);
    }
  }

  reqHeaders.set('Host', new URL(targetUrl).host);

  let body = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer();
  }

  let targetRes;
  try {
    targetRes = await fetch(targetUrl, {
      method: request.method,
      headers: reqHeaders,
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
  ]);

  for (const [key, val] of targetRes.headers.entries()) {
    if (!skipResHeaders.has(key.toLowerCase())) {
      resHeaders.set(key, val);
    }
  }

  Object.entries(corsHeaders()).forEach(([k, v]) => resHeaders.set(k, v));

  const contentType = targetRes.headers.get('content-type') || '';
  const url2 = new URL(targetUrl);
  const ext = url2.pathname.split('.').pop().toLowerCase();

  const mimeByExt = {
    js: 'application/javascript', mjs: 'application/javascript',
    cjs: 'application/javascript', css: 'text/css',
    json: 'application/json', html: 'text/html', htm: 'text/html',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
    ico: 'image/x-icon', mp4: 'video/mp4', webm: 'video/webm',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
    wasm: 'application/wasm', xml: 'application/xml', txt: 'text/plain',
  };

  const detectedMime = mimeByExt[ext];
  if (detectedMime && !contentType.includes(detectedMime)) {
    resHeaders.set('content-type', detectedMime);
  }

  const finalContentType = resHeaders.get('content-type') || contentType;

  if (finalContentType.includes('text/html')) {
    let html = await targetRes.text();
    const base = new URL(targetUrl);
    html = rewriteHtml(html, base, workerUrl.origin);
    resHeaders.set('content-type', 'text/html; charset=utf-8');
    resHeaders.delete('content-encoding');
    return new Response(html, {
      status: targetRes.status,
      headers: resHeaders,
    });
  }

  if (finalContentType.includes('javascript') || ext === 'js' || ext === 'mjs') {
    let js = await targetRes.text();
    js = rewriteJs(js, new URL(targetUrl), workerUrl.origin);
    resHeaders.set('content-type', 'application/javascript');
    resHeaders.delete('content-encoding');
    return new Response(js, { status: targetRes.status, headers: resHeaders });
  }

  return new Response(targetRes.body, {
    status: targetRes.status,
    headers: resHeaders,
  });
}

function rewriteHtml(html, base, workerOrigin) {
  html = html.replace(/<base[^>]*>/gi, '');

  html = html.replace(/(href|src|action)=["']([^"']+)["']/gi, (match, attr, val) => {
    const rewritten = rewriteUrl(val, base, workerOrigin);
    return `${attr}="${rewritten}"`;
  });

  html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, val) => {
    const rewritten = rewriteUrl(val, base, workerOrigin);
    return `url("${rewritten}")`;
  });

  const injection = `<script>
    (function() {
      const _open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...args) {
        try {
          const abs = new URL(url, location.href).href;
          if (!abs.includes('/fetch/')) {
            url = '${workerOrigin}/fetch/' + encodeURIComponent(abs);
          }
        } catch(e) {}
        return _open.call(this, method, url, ...args);
      };
      const _fetch = window.fetch;
      window.fetch = function(input, init) {
        try {
          let url = typeof input === 'string' ? input : input.url;
          const abs = new URL(url, location.href).href;
          if (!abs.includes('/fetch/')) {
            url = '${workerOrigin}/fetch/' + encodeURIComponent(abs);
            input = typeof input === 'string' ? url : new Request(url, input);
          }
        } catch(e) {}
        return _fetch.call(this, input, init);
      };
      history.pushState = new Proxy(history.pushState, {
        apply(target, thisArg, args) {
          return Reflect.apply(target, thisArg, args);
        }
      });
    })();
  </script>`;

  html = html.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
  if (!html.includes(injection)) {
    html = injection + html;
  }

  return html;
}

function rewriteJs(js, base, workerOrigin) {
  js = js.replace(/(?:import|from)\s+["']([^"']+)["']/g, (match, url) => {
    const rewritten = rewriteUrl(url, base, workerOrigin);
    return match.replace(url, rewritten);
  });
  js = js.replace(/(?:fetch|import)\s*\(\s*["']([^"']+)["']/g, (match, url) => {
    const rewritten = rewriteUrl(url, base, workerOrigin);
    return match.replace(url, rewritten);
  });
  return js;
}

function rewriteUrl(url, base, workerOrigin) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:') ||
      url.startsWith('javascript:') || url.startsWith('#') ||
      url.startsWith('mailto:') || url.startsWith('tel:')) {
    return url;
  }
  if (url.includes('/fetch/')) return url;
  try {
    const abs = new URL(url, base).href;
    return `${workerOrigin}/fetch/${encodeURIComponent(abs)}`;
  } catch (e) {
    return url;
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
  };
}
