# 1. 빌드 및 실행을 위한 베이스 이미지 설정
FROM node:20-slim

# 2. 컨테이너 내 작업 디렉토리 생성
WORKDIR /usr/src/app

# 3. 의존성 파일 복사 및 설치 (캐싱 최적화를 위해 소스보다 먼저 복사)
COPY package*.json ./
RUN npm install --only=production

# 4. 소스 코드 전체 복사 (public 폴더 포함)
COPY . .

# 5. 서비스 포트 노출 (Cloud Run 기본값 8080)
EXPOSE 8080

# 6. 애플리케이션 실행
CMD [ "npm", "start" ]