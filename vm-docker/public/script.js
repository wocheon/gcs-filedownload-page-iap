let bucketName = '';

async function loadFiles(path = '') {
  try {
    const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
    const data = await response.json();

    if (data.error) {
      console.error('API Error:', data.error);
      document.getElementById('header-bucket-name').innerText = 'gs://error';
      return;
    }

    bucketName = data.bucketName;
    document.getElementById('header-bucket-name').innerText = `gs://${bucketName}`;
    renderBreadcrumb(path);

    const listBody = document.getElementById('file-list-body');
    listBody.innerHTML = '';
    document.getElementById('detail-side-panel').classList.remove('active');

    if (path !== '') {
      const parts = path.split('/').filter(Boolean);
      parts.pop();
      const parentPath = parts.length > 0 ? `${parts.join('/')}/` : '';

      const row = document.createElement('tr');
      row.className = 'parent-row';
      row.innerHTML = '<td colspan="3">📁 .. (상위 디렉토리로)</td>';
      row.onclick = () => loadFiles(parentPath);
      listBody.appendChild(row);
    }

    [...data.folders, ...data.files].forEach((item) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.type === 'folder' ? '📁' : '📄'} ${item.name}</td>
        <td>${item.type === 'folder' ? '폴더' : '파일'}</td>
        <td>${item.updated ? new Date(item.updated).toLocaleDateString() : '-'}</td>
      `;
      row.onclick = () => {
        if (item.type === 'folder') loadFiles(item.fullPath);
        else showFileDetail(item);
      };
      listBody.appendChild(row);
    });
  } catch (error) {
    console.error('Network Error:', error);
  }
}

function renderBreadcrumb(path) {
  const container = document.getElementById('breadcrumb-container');
  container.innerHTML = `<span onclick="loadFiles('')">gs://${bucketName}</span>`;
  if (!path) return;

  let accumulatedPath = '';
  path.split('/').filter(Boolean).forEach((segment) => {
    accumulatedPath += `${segment}/`;
    const target = accumulatedPath;
    container.innerHTML += `<span class="sep">/</span><span onclick="loadFiles('${target}')">${segment}</span>`;
  });
}

function showFileDetail(file) {
  const panel = document.getElementById('detail-side-panel');
  panel.classList.add('active');
  document.getElementById('view-name').innerText = file.name;
  document.getElementById('view-path').innerText = `gs://${bucketName}/${file.fullPath}`;
  document.getElementById('view-type').innerText = file.contentType || 'unknown';
  document.getElementById('view-size').innerText = formatBytes(file.size);
  document.getElementById('view-updated').innerText = new Date(file.updated).toLocaleString();
  document.getElementById('link-view').href = file.viewUrl;
  document.getElementById('link-download').href = file.downloadUrl;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const base = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(base));
  return `${Number.parseFloat((bytes / Math.pow(base, index)).toFixed(2))} ${sizes[index]}`;
}

document.getElementById('close-panel-btn').onclick = () => {
  document.getElementById('detail-side-panel').classList.remove('active');
};

loadFiles();
