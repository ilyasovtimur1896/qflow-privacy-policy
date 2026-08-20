const http = require('http');
const fs = require('fs');
const path = require('path');

const policy = fs.readFileSync(path.join(__dirname, 'privacy-policy.html'));
const port = Number(process.env.PORT || 3000);

http.createServer((request, response) => {
  if (request.url === '/' || request.url === '/privacy-policy' || request.url === '/privacy-policy/') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    });
    response.end(policy);
    return;
  }

  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}).listen(port, '0.0.0.0');
