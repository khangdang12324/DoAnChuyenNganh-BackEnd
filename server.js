require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// Docker Init
let docker;
try { docker = new Docker(); } catch (e) { console.log("Docker error (using Exec fallback)."); }

app.use(cors());
app.use(express.json());

// --- KẾT NỐI DB ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dangkhang120304_db_user:%4017Bphuocthanh@cluster0.pse46a4.mongodb.net/ide-online?retryWrites=true&w=majority";
const JWT_SECRET = process.env.JWT_SECRET || "bi_mat_123";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ DB Connected!"))
    .catch(err => console.error("❌ DB Error:", err));

// --- MODELS ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.models.User || mongoose.model('User', UserSchema);

const ProjectSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true }, // Tên dự án
    vfs: { type: Object, default: { 'main.py': { type: 'file', content: "print('New Project')" } } },
    lastSaved: { type: Date, default: Date.now }
});
const Project = mongoose.models.Project || mongoose.model('Project', ProjectSchema);

// --- AUTH APIs ---
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        res.json({ message: "Đăng ký thành công!" });
    } catch (err) { res.status(400).json({ error: "Tên đã tồn tại!" }); }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user || !await bcrypt.compare(password, user.password)) 
            return res.status(400).json({ error: "Sai tài khoản/mật khẩu!" });
        
        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, username, message: "Login OK" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Middleware Auth
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch (err) { res.status(401).json({ error: "Token Invalid" }); }
};

// --- PROJECT APIs (QUAN TRỌNG MỚI) ---

// 1. Lấy danh sách tất cả dự án của User
app.get('/projects', verifyToken, async (req, res) => {
    try {
        // Chỉ lấy _id và name (không lấy nội dung code cho nhẹ)
        const projects = await Project.find({ userId: req.userId }).select('_id name lastSaved').sort({ lastSaved: -1 });
        res.json(projects);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Tạo dự án mới
app.post('/projects', verifyToken, async (req, res) => {
    try {
        const { name } = req.body;
        const newProject = new Project({ userId: req.userId, name });
        await newProject.save();
        res.json(newProject);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Lấy chi tiết 1 dự án (để mở)
app.get('/projects/:id', verifyToken, async (req, res) => {
    try {
        const project = await Project.findOne({ _id: req.params.id, userId: req.userId });
        if (!project) return res.status(404).json({ error: "Không tìm thấy dự án" });
        res.json(project);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Lưu code vào dự án (Update)
app.put('/projects/:id', verifyToken, async (req, res) => {
    try {
        const { vfs } = req.body;
        await Project.findOneAndUpdate(
            { _id: req.params.id, userId: req.userId },
            { vfs, lastSaved: Date.now() }
        );
        res.json({ message: "Đã lưu!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// --- RUN CODE (HYBRID) ---
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
    const { language, code } = req.body;
    try {
        const output = await runCode(language, code);
        res.json({ output, error: null });
    } catch (e) { res.json({ output: null, error: e.message }); }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));

// Xóa dự án
app.delete('/projects/:id', verifyToken, async (req, res) => {
    try {
        const result = await Project.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        if (!result) return res.status(404).json({ error: "Không tìm thấy dự án" });
        res.json({ message: "Đã xóa dự án!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});