const express = require('express');
const { Storage } = require('@google-cloud/storage');
const path = require('path');

// 조회를 허용할 버킷 목록은 쉼표로 구분하여 환경변수로 지정
const bucketNames = [...new Set(
  (process.env.BUCKET_NAMES || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
)];
const allowedBuckets = new Set(bucketNames);
const app = express();
const storage = new Storage();
const publicPath = path.join(__dirname, 'public');

if (bucketNames.length === 0) {
  console.error('BUCKET_NAMES environment variable is required.');
  process.exit(1);
}

// 정적 파일 서빙
app.disable('x-powered-by');
app.use(express.static(publicPath));

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 환경변수에 명시된 허용 버킷 목록 반환
app.get('/api/buckets', (req, res) => {
  res.json({ buckets: bucketNames.map((name) => ({ name })) });
});

// API 엔드포인트: 파일 및 폴더 목록 조회
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
      prefix: prefix,
      delimiter: '/'
    });

    // 폴더 목록 추출
    const folders = (apiResponse.prefixes || []).map(p => ({
      name: p.replace(prefix, '').replace('/', ''),
      fullPath: p,
      type: 'folder'
    }));

    // 파일 목록 추출 및 Signed URL 생성
    const fileList = await Promise.all(
      files.filter(file => file.name !== prefix).map(async (file) => {
        const fileName = file.name.replace(prefix, '');

        // 1. 열기용 URL (Inline)
        const [viewUrl] = await file.getSignedUrl({
          version: 'v4',
          action: 'read',
          // 생성된 URL은 15분 간 유효 (15 X  60 X 1000ms)
          expires: Date.now() + 15 * 60 * 1000,
        });

        // 2. 다운로드용 URL (Attachment 강제)
        const [downloadUrl] = await file.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 15 * 60 * 1000,
          promptSaveAs: fileName
        });

        return {
          name: fileName,
          fullPath: file.name,
          viewUrl: viewUrl,
          downloadUrl: downloadUrl,
          type: 'file',
          size: parseInt(file.metadata.size),
          updated: file.metadata.updated,
          contentType: file.metadata.contentType
        };
      })
    );

    // 단일 응답 반환
    res.json({ 
      bucketName: bucketName, 
      currentPath: prefix, 
      folders: folders, 
      files: fileList 
    });

  } catch (error) {
    console.error("GCS API Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// SPA 대응: 나머지 모든 경로는 index.html 반환
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// [추가] Cloud Run 컨테이너 환경에서 서버를 실제로 실행하는 로직
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// 진입점 설정
exports.gcsFileApp = app;
