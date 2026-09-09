const express = require('express');
const { Storage } = require('@google-cloud/storage');
const crypto = require('crypto');
const path = require('path');

const port = Number(process.env.PORT || 8080);
const loginUsername = process.env.LOGIN_USERNAME || 'admin';
const loginPassword = process.env.LOGIN_PASSWORD || '#cloud01';
const sessionTtlHours = Number(process.env.SESSION_TTL_HOURS || 8);
const sessionTtlMs = Number.isFinite(sessionTtlHours) && sessionTtlHours > 0
  ? sessionTtlHours * 60 * 60 * 1000
  : 8 * 60 * 60 * 1000;
const bucketNames = [...new Set(
  (process.env.BUCKET_NAMES || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
)];
const allowedBuckets = new Set(bucketNames);

if (bucketNames.length === 0) {
  console.error('BUCKET_NAMES environment variable is required.');
  process.exit(1);
}

const app = express();
const storage = new Storage();
const publicPath = path.join(__dirname, 'public');
const sessions = new Map();
const failedLogins = new Map();
const sessionCookieName = 'gcs_session';
const maxLoginFailures = 5;
const loginWindowMs = 5 * 60 * 1000;
const loginLockMs = 15 * 60 * 1000;

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  next();
});

app.use(express.urlencoded({ extended: false, limit: '2kb' }));

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader.split(';').flatMap((item) => {
      const separatorIndex = item.indexOf('=');
      if (separatorIndex < 0) return [];

      const key = item.slice(0, separatorIndex).trim();
      const value = item.slice(separatorIndex + 1).trim();
      if (!key) return [];

      try {
        return [[key, decodeURIComponent(value)]];
      } catch {
        return [];
      }
    })
  );
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie)[sessionCookieName];
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = sessions.get(tokenHash);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(tokenHash);
    return null;
  }

  return { tokenHash, ...session };
}

function isEqual(value, expected) {
  const valueBuffer = Buffer.from(String(value));
  const expectedBuffer = Buffer.from(String(expected));
  return valueBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: sessionTtlMs,
    path: '/'
  };
}

app.get('/login', (req, res) => {
  if (getSession(req)) return res.redirect(303, '/');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(publicPath, 'login.html'));
});

app.post('/login', (req, res) => {
  const now = Date.now();
  const clientKey = req.ip;
  const attempt = failedLogins.get(clientKey);

  if (attempt?.lockedUntil > now) {
    return res.redirect(303, '/login?error=locked');
  }

  const validLogin = isEqual(req.body.username || '', loginUsername)
    && isEqual(req.body.password || '', loginPassword);

  if (!validLogin) {
    const withinWindow = attempt && now - attempt.firstFailureAt <= loginWindowMs;
    const failures = withinWindow ? attempt.failures + 1 : 1;
    const firstFailureAt = withinWindow ? attempt.firstFailureAt : now;
    const lockedUntil = failures >= maxLoginFailures ? now + loginLockMs : 0;

    failedLogins.set(clientKey, { failures, firstFailureAt, lockedUntil });
    return res.redirect(303, lockedUntil ? '/login?error=locked' : '/login?error=invalid');
  }

  failedLogins.delete(clientKey);
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(hashToken(token), {
    username: loginUsername,
    expiresAt: now + sessionTtlMs
  });
  res.cookie(sessionCookieName, token, sessionCookieOptions(req));
  return res.redirect(303, '/');
});

app.get('/login.css', (req, res) => {
  res.sendFile(path.join(publicPath, 'login.css'));
});

app.get('/login.js', (req, res) => {
  res.sendFile(path.join(publicPath, 'login.js'));
});

app.get('/favicon.png', (req, res) => {
  res.sendFile(path.join(publicPath, 'favicon.png'));
});

function requireLogin(req, res, next) {
  if (getSession(req)) {
    res.set('Cache-Control', 'no-store');
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  return res.redirect(303, '/login');
}

app.post('/logout', requireLogin, (req, res) => {
  const session = getSession(req);
  if (session) sessions.delete(session.tokenHash);

  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    path: '/'
  });
  res.redirect(303, '/login');
});

app.use(requireLogin);
app.use(express.static(publicPath, { index: false }));

app.get('/api/buckets', (req, res) => {
  res.json({ buckets: bucketNames.map((name) => ({ name })) });
});

app.get('/api/files', async (req, res) => {
  try {
    const bucketName = req.query.bucket;
    if (typeof bucketName !== 'string' || !allowedBuckets.has(bucketName)) {
      return res.status(400).json({ error: '허용된 버킷을 선택해야 합니다.' });
    }

    const prefix = req.query.path || '';
    if (typeof prefix !== 'string') {
      return res.status(400).json({ error: '잘못된 객체 경로입니다.' });
    }

    const [files, , apiResponse] = await storage.bucket(bucketName).getFiles({
      prefix,
      delimiter: '/'
    });

    const folders = (apiResponse.prefixes || []).map((folderPrefix) => ({
      name: folderPrefix.replace(prefix, '').replace('/', ''),
      fullPath: folderPrefix,
      type: 'folder'
    }));

    const fileList = await Promise.all(
      files
        .filter((file) => file.name !== prefix)
        .map(async (file) => {
          const fileName = file.name.replace(prefix, '');
          const expires = Date.now() + 15 * 60 * 1000;

          const [viewUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires
          });

          const [downloadUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires,
            promptSaveAs: fileName
          });

          return {
            name: fileName,
            fullPath: file.name,
            viewUrl,
            downloadUrl,
            type: 'file',
            size: Number.parseInt(file.metadata.size, 10),
            updated: file.metadata.updated,
            contentType: file.metadata.contentType
          };
        })
    );

    res.json({
      bucketName,
      currentPath: prefix,
      folders,
      files: fileList
    });
  } catch (error) {
    console.error('GCS API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [tokenHash, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(tokenHash);
  }
  for (const [clientKey, attempt] of failedLogins) {
    if (attempt.lockedUntil <= now && now - attempt.firstFailureAt > loginWindowMs) {
      failedLogins.delete(clientKey);
    }
  }
}, 10 * 60 * 1000);
cleanupTimer.unref();

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Shutting down.`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
