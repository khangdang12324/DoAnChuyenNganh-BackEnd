# 1. Chọn hệ điều hành nền là Node.js (Alpine Linux cho nhẹ)
FROM node:18-alpine

# 2. CÀI ĐẶT CÁC NGÔN NGỮ (QUAN TRỌNG NHẤT)
# Đây là bước cài Java, Python, C++, PHP... cho máy chủ Render
# (Giống như lúc nãy bạn cài thủ công trên Windows, nhưng đây là tự động)
RUN apk update && apk add --no-cache \
    python3 \
    py3-pip \
    g++ \
    gcc \
    make \
    openjdk17 \
    php \
    go \
    ruby \
    bash

# 3. Thiết lập thư mục làm việc
WORKDIR /app

# 4. Copy file package.json vào trước để cài thư viện
COPY package*.json ./

# 5. Cài đặt các thư viện Node.js (Express, Mongoose...)
RUN npm install

# 6. Cài thêm TypeScript và ts-node toàn cục
RUN npm install -g ts-node typescript

# 7. Copy toàn bộ code backend vào
COPY . .

# 8. Mở cổng 3000
EXPOSE 3000

# 9. Lệnh chạy server
CMD ["node", "server.js"]