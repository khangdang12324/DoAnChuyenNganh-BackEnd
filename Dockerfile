# 1. Chọn nền tảng Node.js (Alpine Linux cho nhẹ)
FROM node:18-alpine

# 2. CÀI ĐẶT KHO CHỨA (Repository) để tải được C# (Mono)
RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/testing" >> /etc/apk/repositories

# 3. CÀI ĐẶT TẤT CẢ NGÔN NGỮ (QUAN TRỌNG NHẤT)
# Render sẽ chạy lệnh này để cài đặt phần mềm vào server của nó
RUN apk update && apk add --no-cache \
    bash \
    build-base \
    g++ \
    gcc \
    make \
    python3 \
    openjdk17 \
    php \
    go \
    ruby \
    mono

# 4. Thiết lập thư mục
WORKDIR /app

# 5. Cài thư viện Node
COPY package*.json ./
RUN npm install
# Cài TypeScript toàn cục để chạy lệnh 'ts-node'
RUN npm install -g ts-node typescript

# 6. Copy code server vào
COPY . .

# 7. Mở cổng
EXPOSE 3000

# 8. Chạy server
CMD ["node", "server.js"]