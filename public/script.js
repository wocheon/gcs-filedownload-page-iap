let bucketName = "";

async function loadFiles(path = '') {
    try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        bucketName = data.bucketName;
        
        document.getElementById('header-bucket-name').innerText = `gs://${bucketName}`;
        renderBreadcrumb(path);
        
        const listBody = document.getElementById('file-list-body');
        listBody.innerHTML = '';
        document.getElementById('detail-side-panel').classList.remove('active');

        if (path !== '') {
            const parts = path.split('/').filter(Boolean);
            parts.pop();
            const parentPath = parts.length > 0 ? parts.join('/') + '/' : '';
            
            const tr = document.createElement('tr');
            tr.className = 'parent-row';
            tr.innerHTML = `<td colspan="3">📁 .. (상위 디렉토리로)</td>`;
            tr.onclick = () => loadFiles(parentPath);
            listBody.appendChild(tr);
        }

        [...data.folders, ...data.files].forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.type === 'folder' ? '📁' : '📄'} ${item.name}</td>
                <td>${item.type === 'folder' ? '폴더' : '파일'}</td>
                <td>${item.updated ? new Date(item.updated).toLocaleDateString() : '-'}</td>
            `;
            tr.onclick = () => {
                if (item.type === 'folder') loadFiles(item.fullPath);
                else showFileDetail(item);
            };
            listBody.appendChild(tr);
        });
    } catch (error) {
        console.error('로드 실패:', error);
    }
}

function renderBreadcrumb(path) {
    const container = document.getElementById('breadcrumb-container');
    container.innerHTML = `<span onclick="loadFiles('')">gs://${bucketName}</span>`;
    if (!path) return;

    let accum = '';
    path.split('/').filter(Boolean).forEach(seg => {
        accum += seg + '/';
        const target = accum;
        container.innerHTML += `<span class="sep">/</span><span onclick="loadFiles('${target}')">${seg}</span>`;
    });
}

function showFileDetail(file) {
    const panel = document.getElementById('detail-side-panel');
    panel.classList.add('active');
    document.getElementById('view-name').innerText = file.name;
    document.getElementById('view-path').innerText = `gs://${bucketName}/${file.fullPath}`;
    document.getElementById('view-type').innerText = file.contentType || 'unknown';
    document.getElementById('view-size').innerText = (file.size / 1024).toFixed(2) + ' KB';
    document.getElementById('view-updated').innerText = new Date(file.updated).toLocaleString();
    document.getElementById('link-view').href = file.viewUrl;
    document.getElementById('link-download').href = file.downloadUrl;
}

document.getElementById('close-panel-btn').onclick = () => {
    document.getElementById('detail-side-panel').classList.remove('active');
};

loadFiles();