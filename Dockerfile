# 1. Đổi sang dùng Debian (Bullseye) thay vì Alpine
# Debian hỗ trợ Mono (C#) và các ngôn ngữ khác tốt hơn nhiều
FROM node:18-bullseye

# 2. CẬP NHẬT VÀ CÀI ĐẶT CÁC NGÔN NGỮ
# Lưu ý: Tên gói trên Debian khác Alpine một chút
RUN apt-get update && apt-get install -y \
    python3 \
    g++ \
    gcc \
    make \
    openjdk-17-jdk \
    php \
    golang-go \
    ruby \
    mono-complete \
    bash

# 3. Thiết lập thư mục làm việc
WORKDIR /app

# 4. Copy và cài thư viện Node.js
COPY package*.json ./
RUN npm install
# Cài TypeScript toàn cục
RUN npm install -g ts-node typescript

# 5. Copy toàn bộ code backend
COPY . .

# 6. Mở cổng
EXPOSE 3000

# 7. Chạy server
CMD ["node", "server.js"]