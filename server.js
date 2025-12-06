require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- 1. KẾT NỐI MONGODB ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dangkhang120304_db_user:%4017Bphuocthanh@cluster0.pse46a4.mongodb.net/ide-online?retryWrites=true&w=majority";
const JWT_SECRET = process.env.JWT_SECRET || "code_spark_secret";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ DB Connected!"))
    .catch(err => console.error("❌ DB Error:", err));

// --- 2. MODELS ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.models.User || mongoose.model('User', UserSchema);

const ProjectSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    vfs: { type: Object, default: {} }, 
    lastSaved: { type: Date, default: Date.now }
});
const Project = mongoose.models.Project || mongoose.model('Project', ProjectSchema);

// --- 3. AUTH APIs ---
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        res.json({ message: "Đăng ký thành công!" });
    } catch (err) { res.status(400).json({ error: "Tên tài khoản đã tồn tại!" }); }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user || !await bcrypt.compare(password, user.password)) 
            return res.status(400).json({ error: "Sai thông tin đăng nhập!" });
        
        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, username, message: "Login thành công" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch (err) { res.status(401).json({ error: "Token không hợp lệ" }); }
};

// --- 4. PROJECT APIs ---
app.get('/projects', verifyToken, async (req, res) => {
    try {
        const projects = await Project.find({ userId: req.userId }).select('_id name lastSaved').sort({ lastSaved: -1 });
        res.json(projects);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/projects', verifyToken, async (req, res) => {
    try {
        const { name } = req.body;
        const newProject = new Project({ userId: req.userId, name });
        await newProject.save();
        res.json(newProject);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/projects/:id', verifyToken, async (req, res) => {
    try {
        const project = await Project.findOne({ _id: req.params.id, userId: req.userId });
        if (!project) return res.status(404).json({ error: "Dự án không tồn tại" });
        res.json(project);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/projects/:id', verifyToken, async (req, res) => {
    try {
        const { vfs, name } = req.body;
        const updateData = { lastSaved: Date.now() };
        if (vfs) updateData.vfs = vfs;
        if (name) updateData.name = name;
        await Project.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, updateData);
        res.json({ message: "Đã lưu!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/projects/:id', verifyToken, async (req, res) => {
    try {
        await Project.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        res.json({ message: "Đã xóa dự án!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 5. HỆ THỐNG BIÊN DỊCH & CHẠY CODE (EXEC ENGINE) ---

const runWithExec = (language, code) => {
    return new Promise((resolve, reject) => {
        const tempDir = path.join(__dirname, 'temp');
        fs.ensureDirSync(tempDir);

        const jobId = Date.now(); 
        const isWin = process.platform === "win32"; 
        let cmd = '';
        let fileName = '';
        let filePath = '';

        switch (language) {
            // --- C / C++ ---
            case 'c':
            case 'cpp':
                const ext = language === 'c' ? 'c' : 'cpp';
                const compiler = language === 'c' ? 'gcc' : 'g++';
                fileName = `job_${jobId}.${ext}`;
                filePath = path.join(tempDir, fileName);
                const outPath = path.join(tempDir, `job_${jobId}.exe`); 
                
                fs.writeFileSync(filePath, code);
                const runC = isWin ? `"${outPath}"` : `./"${path.basename(outPath)}"`;
                cmd = `cd "${tempDir}" && ${compiler} "${fileName}" -o "${path.basename(outPath)}" && ${runC}`;
                break;

       // --- PYTHON (Code thông minh: Tự chọn lệnh) ---
            case 'py':
            case 'python':
                fileName = `job_${jobId}.py`;
                filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, code);
                
                // Kiểm tra hệ điều hành để chọn lệnh phù hợp
                const isWin = process.platform === "win32";
                const pyCmd = isWin ? "python" : "python3"; 
                
                cmd = `${pyCmd} "${filePath}"`; 
                break;
            // --- JAVASCRIPT / TYPESCRIPT ---
            case 'js':
            case 'javascript':
                fileName = `job_${jobId}.js`;
                filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, code);
                cmd = `node "${filePath}"`;
                break;
            
            case 'ts':
           case 'ts':
            case 'typescript':
                fileName = `job_${jobId}.ts`;
                filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, code);
                cmd = `npx ts-node "${filePath}"`; 
                break;

            // --- JAVA (Phức tạp nhất vì tên file phải trùng tên Class) ---
            case 'java':
                // Tạo thư mục riêng cho Java để tránh xung đột
                const javaDir = path.join(tempDir, `java_${jobId}`);
                fs.ensureDirSync(javaDir);
                // Mặc định tên file là Main.java (Người dùng phải đặt class là Main)
                fileName = 'Main.java';
                filePath = path.join(javaDir, fileName);
                fs.writeFileSync(filePath, code);
                // Lệnh: javac Main.java && java Main
                cmd = `cd "${javaDir}" && javac Main.java && java Main`;
                break;

            // --- PHP ---
            case 'php':
                fileName = `job_${jobId}.php`;
                filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, code);
                cmd = `php "${filePath}"`;
                break;

            // --- GO (GOLANG) ---
            case 'go':
            case 'golang':
                fileName = `job_${jobId}.go`;
                filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, code);
                cmd = `go run "${filePath}"`;
                break;

            // --- RUBY ---
            case 'rb':
            case 'ruby':
                fileName = `job_${jobId}.rb`;
                filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, code);
                cmd = `ruby "${filePath}"`;
                break;

            // --- C# (CSHARP) ---
            case 'cs':
            case 'csharp':
                // Yêu cầu Mono (Linux/Mac) hoặc .NET (Windows)
                // Đây là ví dụ dùng csc (C# Compiler) trên Windows
                fileName = `job_${jobId}.cs`;
                filePath = path.join(tempDir, fileName);
                const exePath = path.join(tempDir, `job_${jobId}.exe`);
                fs.writeFileSync(filePath, code);
                
                if (isWin) {
                    // Dùng csc có sẵn trong .NET Framework
                    cmd = `cd "${tempDir}" && csc /out:"${path.basename(exePath)}" "${fileName}" && "${path.basename(exePath)}"`;
                } else {
                    // Dùng mcs (Mono) trên Linux
                    cmd = `cd "${tempDir}" && mcs -out:"${path.basename(exePath)}" "${fileName}" && mono "${path.basename(exePath)}"`;
                }
                break;

            // --- CÁC NGÔN NGỮ KHÔNG THỰC THI (Markup/Data) ---
            case 'html':
            case 'css':
            case 'json':
            case 'xml':
            case 'md':
            case 'txt':
            case 'sql':
                return resolve({ 
                    output: `[INFO] Đây là ngôn ngữ ${language.toUpperCase()}.\nKhông thể chạy trên Server Console.\nVui lòng xem hiển thị tại trình duyệt hoặc Database Client.` 
                });

            default:
                return reject(`Backend chưa hỗ trợ ngôn ngữ: ${language}`);
        }

        // --- CHẠY LỆNH (EXECUTE) ---
        exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
            // Dọn dẹp file tạm (Xóa sau 5s để debug nếu cần)
            setTimeout(() => {
               // fs.remove(filePath).catch(() => {});
               // if (language === 'java') fs.remove(path.dirname(filePath)).catch(() => {});
            }, 5000);

            if (error) {
                // Trả về lỗi (stderr) nếu có
                return resolve({ error: stderr || error.message });
            }
            // Trả về kết quả (stdout)
            resolve({ output: stdout });
        });
    });
};

// API Run Code
app.post('/run', async (req, res) => {
    const { language, code } = req.body;
    
    if (!code) return res.json({ error: "Code trống!" });

    try {
        const result = await runWithExec(language, code);
        res.json(result);
    } catch (e) {
        res.json({ output: null, error: e.toString() });
    }
});

app.listen(PORT, () => console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`));