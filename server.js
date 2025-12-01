require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const Docker = require('dockerode');
const mongoose = require('mongoose'); // <--- THÊM
const bcrypt = require('bcryptjs');   // <--- THÊM
const jwt = require('jsonwebtoken');  // <--- THÊM

const app = express();
const PORT = process.env.PORT || 3000;

// Kết nối Docker (có bắt lỗi)
let docker;
try { docker = new Docker(); } catch (e) { console.log("Docker init error"); }

app.use(cors());
app.use(express.json());

// ============================================================
// 1. KẾT NỐI MONGODB (PHẦN THÊM MỚI)
// ============================================================
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dangkhang120304_db_user:%4017Bphuocthanh@cluster0.pse46a4.mongodb.net/ide-online?retryWrites=true&w=majority";
const JWT_SECRET = process.env.JWT_SECRET || "bi_mat_123";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Đã kết nối MongoDB thành công!"))
    .catch(err => console.error("❌ Lỗi kết nối MongoDB:", err));

// ============================================================
// 2. MODELS & AUTH (PHẦN THÊM MỚI)
// ============================================================
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.models.User || mongoose.model('User', UserSchema);

const ProjectSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    projectName: { type: String, default: 'My Project' },
    vfs: { type: Object, required: true },
    lastSaved: { type: Date, default: Date.now }
});
const Project = mongoose.models.Project || mongoose.model('Project', ProjectSchema);

// Đăng ký
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Thiếu thông tin!" });
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        res.json({ message: "Đăng ký thành công!" });
    } catch (err) { res.status(400).json({ error: "Tên đã tồn tại!" }); }
});

// Đăng nhập
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ error: "Sai tên đăng nhập!" });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Sai mật khẩu!" });
        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, username, message: "Đăng nhập thành công!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Middleware xác thực
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: "Chưa đăng nhập!" });
    try {
        const cleanToken = token.replace('Bearer ', '');
        const decoded = jwt.verify(cleanToken, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch (err) { res.status(401).json({ error: "Token lỗi!" }); }
};

// API Lưu/Tải
app.post('/save-project', verifyToken, async (req, res) => {
    try {
        const { vfs } = req.body;
        let project = await Project.findOne({ userId: req.userId });
        if (project) {
            project.vfs = vfs; project.lastSaved = Date.now(); await project.save();
        } else {
            project = new Project({ userId: req.userId, vfs }); await project.save();
        }
        res.json({ message: "Đã lưu thành công!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/get-project', verifyToken, async (req, res) => {
    try {
        const project = await Project.findOne({ userId: req.userId });
        if (!project) return res.json({ vfs: null });
        res.json({ vfs: project.vfs });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// 5. LOGIC CHẠY CODE (GIỮ NGUYÊN CỦA BẠN)
// ============================================================

const runDocker = async (language, code) => {
    let image = ''; let cmd = [];
    switch (language) {
        case 'python': image = 'python:3.10-alpine'; cmd = ['python', '-c', code]; break;
        case 'javascript': image = 'node:18-alpine'; cmd = ['node', '-e', code]; break;
        default: throw new Error(`Docker: Ngôn ngữ ${language} không được hỗ trợ.`);
    }
    if (!docker) throw new Error("Docker not init");
    const container = await docker.createContainer({
        Image: image, Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false, HostConfig: { AutoRemove: true }
    });
    await container.start();
    const steamToString = (stream) => new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', c => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').substring(8)));
        stream.on('error', reject);
    });
    const logStream = await container.logs({ stdout: true, stderr: true });
    return await steamToString(logStream);
}

const runExec = (language, code) => {
    return new Promise((resolve, reject) => {
        const tempDir = path.join(__dirname, 'temp');
        fs.ensureDirSync(tempDir);
        let extension = language === 'python' ? 'py' : 'js';
        let filePath = path.join(tempDir, `script.${extension}`);
        let command = language === 'python' ? `python3 "${filePath}"` : `node "${filePath}"`;
        fs.writeFileSync(filePath, code);
        exec(command, (error, stdout, stderr) => {
            fs.removeSync(filePath);
            if (error) return resolve(stderr || error.message);
            resolve(stdout);
        });
    });
};

const runCode = async (language, code) => {
    try {
        console.log('Chay trong Docker...');
        return await runDocker(language, code);
    } catch (err) {
        console.log('Docker khong hoat dong, chay bang exec...');
        return await runExec(language, code);
    }
};

app.post('/run', async (req, res) => {
    let { language, code } = req.body;
    if (language === 'py') language = 'python';
    if (language === 'js') language = 'javascript';
    if (!code) return res.status(400).json({ error: 'Khong co ma nguon de chay.' });
    try {
        const output = await runCode(language, code);
        res.json({ output: output, error: null });
    } catch (err) { res.json({ output: null, error: err.message }); }
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});