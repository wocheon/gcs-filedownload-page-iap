# VM Docker deployment

이 디렉터리 하나만 VM에 복사하여 GCS 파일 탐색 애플리케이션을 Docker 컨테이너로 빌드하고 실행할 수 있습니다.

## 구성

- `Dockerfile`: 프로덕션 의존성만 설치하고 비루트 `node` 사용자로 실행합니다.
- `docker-compose.yaml`: 재시작 정책, 상태 확인, 로그 순환, 읽기 전용 파일 시스템을 적용합니다.
- `.env.example`: 버킷, 호스트 포트, 바인딩 주소 예시입니다.
- `index.js`, `package.json`, `public/`: 컨테이너에서 실행하는 애플리케이션 전체 소스입니다.

Docker 빌드 컨텍스트는 현재 디렉터리(`.`)입니다. 상위 디렉터리 파일, Cloud Build, Artifact Registry를 사용하지 않습니다.

## 서비스 계정 키 준비

VM에 기본으로 연결된 서비스 계정 대신 별도의 서비스 계정 JSON 키를 사용합니다. 서비스 계정에는 대상 버킷의 `roles/storage.objectViewer` 역할이 필요합니다.

키 파일은 프로젝트 외부의 전용 디렉터리에 저장합니다. 아래 예시는 컨테이너의 `node` 사용자 UID/GID인 `1000:1000`만 키를 읽을 수 있게 설정합니다.

```bash
sudo install -d -m 0700 -o 1000 -g 1000 /opt/gcs-filedownload-page/secrets
sudo install -m 0400 -o 1000 -g 1000 /path/to/downloaded-key.json \
  /opt/gcs-filedownload-page/secrets/service-account.json
```

Compose는 키를 이미지에 복사하지 않고 `/run/secrets/gcp-service-account.json`에 읽기 전용으로 마운트합니다. 애플리케이션은 `GOOGLE_APPLICATION_CREDENTIALS`를 통해 이 키를 사용합니다. 개인 키로 Signed URL을 로컬 서명하므로 메타데이터 서버를 사용하는 경우와 달리 서비스 계정의 Token Creator 역할은 필요하지 않습니다.

## VM에서 빌드 후 실행

`vm-docker/` 디렉터리만 VM에 복사한 다음 실행합니다.

```bash
cd vm-docker
cp .env.example .env
```

`.env`에서 다음 값을 실제 환경에 맞게 변경합니다.

```dotenv
BUCKET_NAME=your-bucket-name
GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH=/opt/gcs-filedownload-page/secrets/service-account.json
```

그다음 실행합니다.

```bash
docker-compose up -d --build
docker-compose ps
docker-compose logs -f gcs-filedownload-page
```

기본값은 보안을 위해 VM의 `127.0.0.1:8080`에만 바인딩됩니다.

```bash
curl http://127.0.0.1:8080
```

Nginx 또는 다른 리버스 프록시가 같은 VM에서 HTTPS를 종료하도록 구성할 때 이 기본값을 그대로 사용합니다. 클라이언트가 VM 포트에 직접 접근해야 한다면 `.env`에서 다음과 같이 바꾸고, 방화벽의 소스 범위를 필요한 네트워크로 제한합니다.

```dotenv
BIND_ADDRESS=0.0.0.0
```

## 운영 명령

```bash
# 상태와 health 확인
docker-compose ps
docker inspect --format='{{.State.Health.Status}}' gcs-filedownload-page

# 소스 변경 후 이미지 재빌드 및 컨테이너 교체
docker-compose up -d --build

# 중지 및 컨테이너 제거(이미지와 데이터는 유지)
docker-compose down
```

## 주의사항

- 서비스 계정 키 파일을 프로젝트 디렉터리에 복사하거나 Docker 이미지에 포함하지 않습니다.
- `.env`에는 키 자체가 아니라 VM에 있는 키 파일의 절대 경로만 기록합니다.
- 키 파일은 `0400` 권한으로 제한하고 정기적으로 교체합니다.
- 기존 Cloud Run 앞단의 IAP 보호는 VM에 자동 적용되지 않습니다. 외부 공개 시 HTTPS 리버스 프록시와 별도의 인증/인가를 구성해야 합니다.
- GCS 조회 또는 Signed URL 접근이 실패하면 JSON 키의 서비스 계정이 대상 버킷에 `roles/storage.objectViewer` 역할을 가지고 있는지 확인합니다.
