require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken'); // Vẫn cần cái này để xác thực lúc lưu

const app = express();
const PORT = process.env.PORT || 3000;
const docker = new Docker();

app.use(cors());
app.use(express.json());

// --- 1. GỌI FILE ROUTE (QUAN TRỌNG) ---
// Dòng này sẽ nạp cái file auth.js bạn vừa sửa
const authRoute = require('./routes/auth');

// Kích hoạt route. Địa chỉ sẽ là: /auth/login, /auth/register
app.use('/auth', authRoute); 

// --- 2. KẾT NỐI MONGODB ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dangkhang120304_db_user:%4017Bphuocthanh@cluster0.pse46a4.mongodb.net/ide-online?retryWrites=true&w=majority";
const JWT_SECRET = process.env.JWT_SECRET || "bi_mat_khong_duoc_tiet_lo_123456";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Đã kết nối MongoDB thành công!"))
    .catch(err => console.error("❌ Lỗi kết nối MongoDB:", err));


// --- 3. MODEL PROJECT & MIDDLEWARE (Để lưu file) ---
// (Phải khai báo lại User để tham chiếu, nhưng dùng cái đã có)
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({})); 

const ProjectSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    projectName: { type: String, default: 'My Project' },
    vfs: { type: Object, required: true },
    lastSaved: { type: Date, default: Date.now }
});
const Project = mongoose.model('Project', ProjectSchema);

const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: "Chưa đăng nhập!" });
    try {
        const cleanToken = token.replace('Bearer ', '');
        const decoded = jwt.verify(cleanToken, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch (err) {
        res.status(401).json({ error: "Token lỗi!" });
    }
};

// API Lưu/Tải (Giữ nguyên)
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

// --- 4. LOGIC CHẠY CODE (HYBRID) ---
const runWithDocker = async (language, code) => {
    let image = ''; let cmd = [];
    switch (language) {
        case 'python': image = 'python:3.10-alpine'; cmd = ['python', '-c', code]; break;
        case 'javascript': image = 'node:18-alpine'; cmd = ['node', '-e', code]; break;
        default: throw new Error(`Docker: Ngôn ngữ ${language} chưa hỗ trợ.`);
    }
    const container = await docker.createContainer({
        Image: image, Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false, HostConfig: { AutoRemove: true }
    });
    await container.start();
    const streamToString = (stream) => new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', c => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').substring(8)));
        stream.on('error', reject);
    });
    const logStream = await container.logs({ stdout: true, stderr: true });
    return await streamToString(logStream);
};

const runWithExec = (language, code) => {
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
    try { return await runWithDocker(language, code); } 
    catch (err) { return await runWithExec(language, code); }
};

app.post('/run', async (req, res) => {
    let { language, code } = req.body;
    if (language === 'py') language = 'python';
    if (language === 'js') language = 'javascript';
    if (!code) return res.status(400).json({ error: 'Thiếu code.' });
    try {
        const output = await runCode(language, code);
        res.json({ output: output, error: null });
    } catch (err) { res.json({ output: null, error: err.message }); }
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại cổng ${PORT}`);
});