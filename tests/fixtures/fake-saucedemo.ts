/**
 * A tiny local stand-in for saucedemo.com with the same data-test attributes,
 * so the run pipeline can be tested without internet access or a live site.
 * The login page also logs to the console and makes a failing request on purpose,
 * so console.log capture has something to record.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const LOGIN_PAGE = `<!doctype html><html><head><title>Swag Labs</title></head><body>
<input data-test="username" id="u"><input data-test="password" id="p" type="password">
<input type="button" data-test="login-button" id="b" value="Login">
<div data-test="error" id="e"></div>
<script>
  console.log('login page ready');
  console.error('fake console error from the login page');
  fetch('/api/ping');
  document.getElementById('b').addEventListener('click', () => {
    const u = document.getElementById('u').value, p = document.getElementById('p').value, e = document.getElementById('e');
    if (!u) e.textContent = 'Epic sadface: Username is required';
    else if (u === 'locked_out_user') e.textContent = 'Epic sadface: Sorry, this user has been locked out.';
    else if (u === 'standard_user' && p === 'secret_sauce') location.href = '/inventory.html';
    else e.textContent = 'Epic sadface: Username and password do not match any user in this service';
  });
</script></body></html>`;

const INVENTORY_PAGE = `<!doctype html><html><head><title>Swag Labs</title></head><body>
${Array.from({ length: 6 }, (_, i) => `<div data-test="inventory-item">Item ${i + 1}</div>`).join('')}
</body></html>`;

export interface FakeSite {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startFakeSauceDemo(): Promise<FakeSite> {
  const server: Server = createServer((req, res) => {
    if (req.url === '/api/ping') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"ping failed on purpose"}');
    } else if (req.url === '/inventory.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(INVENTORY_PAGE);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(LOGIN_PAGE);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
