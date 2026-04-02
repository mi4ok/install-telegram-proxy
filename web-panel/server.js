/* eslint-disable */
const express = require('express');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PANEL_PORT || 9090;
const PANEL_USER = process.env.PANEL_USER || 'admin';
const PANEL_PASS = process.env.PANEL_PASS || '';

const NGINX_CONF = '/etc/nginx/sites-available/telegram-proxy.conf';
const NGINX_ACCESS_LOG = '/var/log/nginx/access.log';
const NGINX_ERROR_LOG = '/var/log/nginx/error.log';
const CERT_FILE = '/etc/nginx/ssl/telegram-proxy.pem';
const INSTALL_SCRIPT = path.resolve(__dirname, '..', 'install-telegram-proxy.sh');

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
function authMiddleware(req, res, next) {
  if (!PANEL_PASS) return next();

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Telegram Proxy Panel"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const [user, pass] = decoded.split(':');
  if (user === PANEL_USER && pass === PANEL_PASS) return next();

  res.set('WWW-Authenticate', 'Basic realm="Telegram Proxy Panel"');
  return res.status(401).json({ error: 'Invalid credentials' });
}

app.use('/api', authMiddleware);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getServerIP() {
  try {
    return execSync("hostname -I 2>/dev/null | awk '{print $1}'").toString().trim();
  } catch {
    return '127.0.0.1';
  }
}

function parseStands() {
  try {
    const conf = fs.readFileSync(NGINX_CONF, 'utf-8');
    const stands = [];
    const re = /# --- Stand: (\S+) ---\s*\n\s*location \/webhook\/(\S+?)\/ \{\s*\n\s*proxy_pass\s+(\S+?)\/;/g;
    let m;
    while ((m = re.exec(conf)) !== null) {
      stands.push({ name: m[1], location: `/webhook/${m[2]}/`, url: m[3] });
    }
    return stands;
  } catch (err) {
    return [];
  }
}

function parsePorts() {
  try {
    const conf = fs.readFileSync(NGINX_CONF, 'utf-8');
    const httpMatch = conf.match(/listen\s+(\d+);/);
    const httpsMatch = conf.match(/listen\s+(\d+)\s+ssl;/);
    return {
      http: httpMatch ? httpMatch[1] : '8080',
      https: httpsMatch ? httpsMatch[1] : '8443',
    };
  } catch {
    return { http: '8080', https: '8443' };
  }
}

function telegramRequest(urlPath) {
  const ports = parsePorts();
  const proxyUrl = `http://127.0.0.1:${ports.http}${urlPath}`;

  return new Promise((resolve, reject) => {
    http.get(proxyUrl, (resp) => {
      let data = '';
      resp.on('data', (c) => (data += c));
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ ok: false, description: data }); }
      });
    }).on('error', (e) => reject(e));
  });
}

function telegramPost(urlPath, body) {
  const ports = parsePorts();
  const postData = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: parseInt(ports.http),
      path: urlPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    }, (resp) => {
      let data = '';
      resp.on('data', (c) => (data += c));
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ ok: false, description: data }); }
      });
    });
    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

function readLogTail(logFile, lines, filter) {
  try {
    let cmd = `tail -n ${lines} ${logFile}`;
    if (filter) cmd += ` | grep -i '${filter.replace(/'/g, "'\\''")}'`;
    return execSync(cmd, { timeout: 5000 }).toString();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// API: Server info
// ---------------------------------------------------------------------------
app.get('/api/info', (req, res) => {
  const ports = parsePorts();
  const ip = getServerIP();
  const certExists = fs.existsSync(CERT_FILE);
  res.json({ ip, ports, certExists, certPath: CERT_FILE });
});

// ---------------------------------------------------------------------------
// API: Stands
// ---------------------------------------------------------------------------
app.get('/api/stands', (req, res) => {
  res.json(parseStands());
});

app.post('/api/stands', (req, res) => {
  const { url, name } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const ports = parsePorts();
  let cmd = `sudo bash ${INSTALL_SCRIPT} ${ports.http} ${ports.https} ${url}`;
  if (name) cmd += ` ${name}`;

  try {
    const output = execSync(cmd, { timeout: 30000 }).toString();
    res.json({ ok: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message, output: err.stdout?.toString() });
  }
});

app.delete('/api/stands/:name', (req, res) => {
  const standName = req.params.name;
  try {
    let conf = fs.readFileSync(NGINX_CONF, 'utf-8');
    const pattern = new RegExp(
      `\\s*# --- Stand: ${standName} ---[\\s\\S]*?location /webhook/${standName}/[\\s\\S]*?\\}\\s*\\n`,
      'g'
    );
    if (!pattern.test(conf)) {
      return res.status(404).json({ error: `Stand '${standName}' not found` });
    }
    conf = conf.replace(pattern, '\n');
    fs.writeFileSync(NGINX_CONF, conf);
    execSync('sudo nginx -t && sudo systemctl reload nginx', { timeout: 10000 });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// API: Bot operations
// ---------------------------------------------------------------------------
app.post('/api/bot/getMe', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  try {
    const result = await telegramRequest(`/bot${token}/getMe`);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/bot/getWebhookInfo', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  try {
    const result = await telegramRequest(`/bot${token}/getWebhookInfo`);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/bot/setWebhook', (req, res) => {
  const { token, stand, app: appType, actionPath } = req.body;
  if (!token || !stand) return res.status(400).json({ error: 'token and stand are required' });

  const ports = parsePorts();
  const ip = getServerIP();

  const appSlug = appType === 'vcsm' ? 'vcsm_vcsm' : 'itsm_itsm';
  const modulePath = appType === 'vcsm' ? 'vcsm_telegram_bot' : 'telegram_bot';
  const action = actionPath || (appType === 'vcsm' ? 'vcsm_endpoint' : 'endpoint');
  const webhookUrl = `https://${ip}:${ports.https}/webhook/${stand}/v1/api/${appSlug}/${modulePath}/v1/${action}`;

  const cmd = [
    'curl', '-s',
    '-F', `url=${webhookUrl}`,
    '-F', `certificate=@${CERT_FILE}`,
    `https://api.telegram.org/bot${token}/setWebhook`,
  ].join(' ');

  try {
    const output = execSync(cmd, { timeout: 15000 }).toString();
    const result = JSON.parse(output);
    res.json({ ...result, webhookUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot/deleteWebhook', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  try {
    const result = await telegramRequest(`/bot${token}/deleteWebhook`);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// API: Logs
// ---------------------------------------------------------------------------
app.get('/api/logs', (req, res) => {
  const type = req.query.type === 'error' ? 'error' : 'access';
  const lines = Math.min(parseInt(req.query.lines) || 100, 1000);
  const filter = req.query.filter || '';
  const logFile = type === 'error' ? NGINX_ERROR_LOG : NGINX_ACCESS_LOG;
  const output = readLogTail(logFile, lines, filter);
  res.json({ type, lines, filter, output });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Telegram Proxy Panel running on http://0.0.0.0:${PORT}`);
  if (!PANEL_PASS) {
    console.log('WARNING: No password set. Set PANEL_PASS env variable for security.');
  }
});
