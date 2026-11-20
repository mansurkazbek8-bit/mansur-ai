// Mansur AI — a tiny load balancer for publishing from this PC.
// PHP's built-in server answers one request at a time, and a neural network can think for 20+ seconds,
// so several `php artisan serve` workers run side by side and each request goes to the least busy one.
// Usage: node proxy.js <listen-port> <backend-port> [<backend-port> ...]
const http = require('http');

const [listen, ...ports] = process.argv.slice(2).map(Number);
if (!listen || !ports.length) {
  console.error('usage: node proxy.js 8080 8001 8002 8003 8004');
  process.exit(1);
}
const backends = ports.map(port => ({ port, active: 0, down: 0 }));

function pick() {
  const now = Date.now();
  const alive = backends.filter(b => b.down < now);
  const pool = alive.length ? alive : backends;
  return pool.reduce((a, b) => (b.active < a.active ? b : a));
}

const server = http.createServer((req, res) => {
  const b = pick();
  b.active++;
  let done = false;
  const finish = () => { if (!done) { done = true; b.active--; } };

  const headers = { ...req.headers };
  const ip = req.socket.remoteAddress || '';
  headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${ip}` : ip;
  // The public tunnel speaks HTTPS; tell Laravel so links and cookies are https.
  if (!headers['x-forwarded-proto']) headers['x-forwarded-proto'] = 'https';
  if (!headers['x-forwarded-host'] && headers.host) headers['x-forwarded-host'] = headers.host;

  const up = http.request({ host: '127.0.0.1', port: b.port, method: req.method, path: req.url, headers }, upRes => {
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res);
    upRes.on('end', finish);
  });
  up.setTimeout(330000, () => up.destroy(new Error('timeout')));
  up.on('error', err => {
    finish();
    b.down = Date.now() + 5000; // skip this worker for a few seconds
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: 'Сервер перезапускается, повторите через несколько секунд' }));
    } else res.destroy();
    console.error(new Date().toISOString(), 'worker', b.port, err.message);
  });
  res.on('close', finish);
  req.pipe(up);
});
server.keepAliveTimeout = 65000;
server.listen(listen, '127.0.0.1', () => console.log(`Mansur AI proxy: http://127.0.0.1:${listen} -> ${ports.join(', ')}`));
