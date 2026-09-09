let selectedBucket = '';

const bucketView = document.getElementById('bucket-view');
const objectView = document.getElementById('object-view');
const bucketListBody = document.getElementById('bucket-list-body');
const fileListBody = document.getElementById('file-list-body');
const detailPanel = document.getElementById('detail-side-panel');
const headerBucketName = document.getElementById('header-bucket-name');
const errorMessage = document.getElementById('error-message');

function setError(message = '') {
  errorMessage.textContent = message;
  errorMessage.hidden = message === '';
}

async function requestJson(url) {
  const response = await fetch(url);
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('로그인이 필요합니다.');
  }
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || `요청에 실패했습니다. (HTTP ${response.status})`);
  }

  return data;
}

async function loadBuckets() {
  try {
    setError();
    const data = await requestJson('/api/buckets');
    bucketListBody.replaceChildren();

    if (data.buckets.length === 0) {
      setError('표시할 버킷이 없습니다.');
      return;
    }

    data.buckets.forEach((bucket) => {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'bucket-link';
      button.textContent = `🪣 ${bucket.name}`;
      button.addEventListener('click', () => selectBucket(bucket.name));

      cell.appendChild(button);
      row.appendChild(cell);
      bucketListBody.appendChild(row);
    });
  } catch (error) {
    setError(error.message);
  }
}

function selectBucket(bucketName) {
  selectedBucket = bucketName;
  headerBucketName.textContent = `gs://${selectedBucket}`;
  bucketView.hidden = true;
  objectView.hidden = false;
  detailPanel.classList.remove('active');
  loadFiles();
}

function showBucketList() {
  selectedBucket = '';
  headerBucketName.textContent = '버킷 선택';
  objectView.hidden = true;
  bucketView.hidden = false;
  detailPanel.classList.remove('active');
  setError();
}

async function loadFiles(path = '') {
  try {
    setError();
    const params = new URLSearchParams({
      bucket: selectedBucket,
      path
    });
    const data = await requestJson(`/api/files?${params.toString()}`);

    fileListBody.replaceChildren();
    detailPanel.classList.remove('active');
    renderBreadcrumb(path);

    if (path !== '') {
      const parts = path.split('/').filter(Boolean);
      parts.pop();
      const parentPath = parts.length > 0 ? `${parts.join('/')}/` : '';
      appendFileRow('📁 .. (상위 디렉터리로)', '폴더', '-', () => loadFiles(parentPath), 'parent-row');
    }

    data.folders.forEach((folder) => {
      appendFileRow(
        `📁 ${folder.name}`,
        '폴더',
        '-',
        () => loadFiles(folder.fullPath)
      );
    });

    data.files.forEach((file) => {
      appendFileRow(
        `📄 ${file.name}`,
        '파일',
        file.updated ? new Date(file.updated).toLocaleDateString() : '-',
        () => showFileDetail(file)
      );
    });
  } catch (error) {
    fileListBody.replaceChildren();
    setError(error.message);
  }
}

function appendFileRow(name, type, updated, onClick, className = '') {
  const row = document.createElement('tr');
  if (className) row.className = className;

  [name, type, updated].forEach((value) => {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.appendChild(cell);
  });

  row.addEventListener('click', onClick);
  fileListBody.appendChild(row);
}

function renderBreadcrumb(path) {
  const container = document.getElementById('breadcrumb-container');
  container.replaceChildren();

  const rootButton = document.createElement('button');
  rootButton.type = 'button';
  rootButton.textContent = `gs://${selectedBucket}`;
  rootButton.addEventListener('click', () => loadFiles());
  container.appendChild(rootButton);

  let accumulatedPath = '';
  path.split('/').filter(Boolean).forEach((segment) => {
    accumulatedPath += `${segment}/`;
    const targetPath = accumulatedPath;

    const separator = document.createElement('span');
    separator.className = 'sep';
    separator.textContent = '/';

    const pathButton = document.createElement('button');
    pathButton.type = 'button';
    pathButton.textContent = segment;
    pathButton.addEventListener('click', () => loadFiles(targetPath));

    container.append(separator, pathButton);
  });
}

function showFileDetail(file) {
  detailPanel.classList.add('active');
  document.getElementById('view-name').textContent = file.name;
  document.getElementById('view-path').textContent = `gs://${selectedBucket}/${file.fullPath}`;
  document.getElementById('view-type').textContent = file.contentType || 'unknown';
  document.getElementById('view-size').textContent = formatBytes(file.size);
  document.getElementById('view-updated').textContent = new Date(file.updated).toLocaleString();
  document.getElementById('link-view').href = file.viewUrl;
  document.getElementById('link-download').href = file.downloadUrl;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';
  const base = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(base)), sizes.length - 1);
  return `${Number.parseFloat((bytes / Math.pow(base, index)).toFixed(2))} ${sizes[index]}`;
}

document.getElementById('back-to-buckets-btn').addEventListener('click', showBucketList);
document.getElementById('close-panel-btn').addEventListener('click', () => {
  detailPanel.classList.remove('active');
});

loadBuckets();
