const express = require('express');
const { Storage } = require('@google-cloud/storage');
const path = require('path');

const port = Number(process.env.PORT || 8080);
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

app.disable('x-powered-by');
app.use(express.static(publicPath));

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

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

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Shutting down.`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
