// Mini serveur HTTP sans dépendance (routes à paramètres, JSON, fichiers statiques).
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

function createApp() {
  const routes = [];
  let staticDir = null;
  let onError = (err, req, res) => res.status(err.status || 500).json({ error: err.message });

  const add = method => (pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, re, keys, handler });
  };

  function decorate(res) {
    res.status = code => { res.statusCode = code; return res; };
    res.json = obj => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(obj));
    };
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', c => { data += c; if (data.length > 1e6) reject(Object.assign(new Error('Corps trop volumineux'), { status: 413 })); });
      req.on('end', () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); } catch { reject(Object.assign(new Error('JSON invalide'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    decorate(res);
    const url = new URL(req.url, 'http://localhost');
    req.query = Object.fromEntries(url.searchParams);
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        req.body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        return await r.handler(req, res);
      }
      if (url.pathname.startsWith('/api/')) return res.status(404).json({ error: 'Route inconnue' });
      if (staticDir && req.method === 'GET') {
        const rel = url.pathname === '/' ? '/index.html' : url.pathname;
        const file = path.normalize(path.join(staticDir, rel));
        if (file.startsWith(staticDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
          return fs.createReadStream(file).pipe(res);
        }
      }
      res.status(404).json({ error: 'Introuvable' });
    } catch (err) {
      onError(err, req, res);
    }
  });

  return {
    get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'),
    static(dir) { staticDir = path.resolve(dir); },
    onError(fn) { onError = fn; },
    listen(port, cb) { return server.listen(port, cb); },
  };
}

module.exports = createApp;
