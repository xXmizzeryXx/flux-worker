const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': '86400',
};

const FORBIDDEN_REQ_HEADERS = new Set([
    'host', 'cf-connecting-ip', 'cf-worker', 'cf-ray', 
    'cf-visitor', 'x-forwarded-for', 'x-forwarded-proto'
]);

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);

        if (url.pathname === '/') {
            return new Response('Flux Bare Transport Worker is active.', {
                status: 200,
                headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS }
            });
        }

        let targetUrlStr = request.headers.get('x-flux-url') || url.searchParams.get('url');
        
        if (!targetUrlStr) {
            return new Response('Missing target URL (x-flux-url header or ?url= param)', { 
                status: 400, 
                headers: CORS_HEADERS 
            });
        }

        let targetUrl;
        try {
            targetUrl = new URL(targetUrlStr);
        } catch {
            return new Response('Invalid target URL', { status: 400, headers: CORS_HEADERS });
        }

        const upgradeHeader = request.headers.get('Upgrade');
        if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
            return await handleWebSocket(request, targetUrl);
        }

        return await handleHttp(request, targetUrl);
    }
};

async function handleHttp(request, targetUrl) {
    const reqHeaders = new Headers();

    for (const [key, value] of request.headers.entries()) {
        if (!FORBIDDEN_REQ_HEADERS.has(key.toLowerCase()) && !key.startsWith('x-flux-')) {
            reqHeaders.set(key, value);
        }
    }

    reqHeaders.set('Host', targetUrl.host);
    reqHeaders.set('Origin', targetUrl.origin);

    try {
        const fetchOptions = {
            method: request.method,
            headers: reqHeaders,
            redirect: 'manual',
        };

        if (!['GET', 'HEAD'].includes(request.method)) {
            fetchOptions.body = await request.arrayBuffer();
        }

        const targetResponse = await fetch(targetUrl.toString(), fetchOptions);
        const resHeaders = new Headers(targetResponse.headers);

        for (const [key, value] of Object.entries(CORS_HEADERS)) {
            resHeaders.set(key, value);
        }

        resHeaders.delete('X-Frame-Options');
        resHeaders.delete('Content-Security-Policy');
        resHeaders.delete('Content-Security-Policy-Report-Only');
        resHeaders.delete('Clear-Site-Data');

        return new Response(targetResponse.body, {
            status: targetResponse.status,
            statusText: targetResponse.statusText,
            headers: resHeaders
        });

    } catch (error) {
        return new Response(`Flux HTTP Transport Error: ${error.message}`, {
            status: 502,
            headers: CORS_HEADERS
        });
    }
}

async function handleWebSocket(request, targetUrl) {
    targetUrl.protocol = targetUrl.protocol.replace('http', 'ws');

    try {
        const reqHeaders = new Headers(request.headers);
        reqHeaders.set('Host', targetUrl.host);
        reqHeaders.set('Origin', targetUrl.origin);
        reqHeaders.delete('x-flux-url');

        const wsResponse = await fetch(targetUrl.toString(), {
            headers: reqHeaders,
            upgrade: request.headers.get('Upgrade')
        });

        if (wsResponse.status !== 101) {
            return new Response(`WebSocket upgrade failed: ${wsResponse.status}`, { status: 502 });
        }

        return wsResponse;

    } catch (error) {
        return new Response(`Flux WS Transport Error: ${error.message}`, { status: 502 });
    }
}
