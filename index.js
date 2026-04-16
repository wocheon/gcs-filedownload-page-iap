const express = require('express');
const { Storage } = require('@google-cloud/storage');
const path = require('path');

// Bucket명은 환경변수로 지정
const bucketName = process.env.BUCKET_NAME;
const app = express();
const storage = new Storage();
const publicPath = path.join(__dirname, 'public');

// 정적 파일 서빙
app.use(express.static(publicPath));

// API 엔드포인트: 파일 및 폴더 목록 조회
app.get('/api/files', async (req, res) => {
  try {
    const prefix = req.query.path || '';
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
          extensionHeaders: {
            'response-content-disposition': `attachment; filename="${encodeURIComponent(fileName)}"`
          }
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