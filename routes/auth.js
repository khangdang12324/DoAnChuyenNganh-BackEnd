const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 1. TẠO MODEL USER (Khuôn đúc tài khoản)
// (Thường thì cái này để file riêng, nhưng mình để đây cho bạn tiện)
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

// Kiểm tra xem Model đã tồn tại chưa để tránh lỗi nạp lại
const User = mongoose.models.User || mongoose.model('User', UserSchema);

// 2. API ĐĂNG KÝ (POST /auth/register)
router.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Thiếu thông tin!" });

        // Mã hóa mật khẩu
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const user = new User({ username, password: hashedPassword });
        await user.save();
        
        res.json({ message: "Đăng ký thành công!" });
    } catch (err) {
        res.status(400).json({ error: "Tên đăng nhập đã tồn tại!" });
    }
});

// 3. API ĐĂNG NHẬP (POST /auth/login)
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user) return res.status(400).json({ error: "Sai tên đăng nhập!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Sai mật khẩu!" });

        // Lấy bí mật từ biến môi trường hoặc dùng mặc định
        const JWT_SECRET = process.env.JWT_SECRET || "bi_mat_khong_duoc_tiet_lo_123456";

        // Tạo vé (Token)
        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ token, username, message: "Đăng nhập thành công!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Xuất cái router này ra để server.js dùng
module.exports = router;