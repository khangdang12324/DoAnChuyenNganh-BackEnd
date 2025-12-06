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

// --- KẾT NỐI DB ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dangkhang120304_db_user:%4017Bphuocthanh@cluster0.pse46a4.mongodb.net/ide-online?retryWrites=true&w=majority";
const JWT_SECRET = process.env.JWT_SECRET || "code_spark_secret";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ DB Connected!"))
    .catch(err => console.log("❌ DB Error:", err));

// --- MODELS & AUTH (Giữ nguyên cho gọn) ---
const User = mongoose.model('User', new mongoose.Schema({ username: {type:String, unique:true}, password: {type:String} }));
const Project = mongoose.model('Project', new mongoose.Schema({ userId: mongoose.Schema.Types.ObjectId, name: String, vfs: Object, lastSaved: {type:Date, default:Date.now} }));

app.post('/register', async (req, res) => { /* Code đăng ký cũ */ res.json({message:"OK"}); });
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user || !await bcrypt.compare(password, user.password)) return res.status(400).json({ error: "Sai thông tin!" });
        const token = jwt.sign({ id: user._id }, JWT_SECRET);
        res.json({ token, username });
    } catch(e) { res.status(500).json({error: e.message}); }
});

const verifyToken = (req, res, next) => {
    try { req.userId = jwt.verify(req.headers['authorization']?.split(' ')[1], JWT_SECRET).id; next(); } 
    catch { res.status(401).json({ error: "Unauthorized" }); }
};

// --- PROJECT APIs ---
app.get('/projects', verifyToken, async (req, res) => res.json(await Project.find({ userId: req.userId }).select('_id name lastSaved').sort({lastSaved:-1})));
app.post('/projects', verifyToken, async (req, res) => res.json(await new Project({ userId: req.userId, name: req.body.name }).save()));
app.get('/projects/:id', verifyToken, async (req, res) => res.json(await Project.findOne({_id:req.params.id, userId:req.userId})));
app.put('/projects/:id', verifyToken, async (req, res) => { await Project.findByIdAndUpdate(req.params.id, req.body); res.json({message:"Saved"}); });
app.delete('/projects/:id', verifyToken, async (req, res) => { await Project.findByIdAndDelete(req.params.id); res.json({message:"Deleted"}); });

// --- EXECUTION ENGINE (ĐA NGÔN NGỮ - FIX LỖI TS & C++) ---
const runWithExec = (language, code) => {
    return new Promise((resolve, reject) => {
        const tempDir = path.join(__dirname, 'temp');
        fs.ensureDirSync(tempDir);
        const jobId = Date.now();
        const isWin = process.platform === "win32"; // Check Windows vs Linux
        let cmd = ''; 
        let fileName = ''; 
        let filePath = '';

        switch (language) {
            // --- C / C++ (Linux dùng ./file.out) ---
            case 'c':
            case 'cpp':
                const ext = language === 'c' ? 'c' : 'cpp';
                const compiler = language === 'c' ? 'gcc' : 'g++';
                fileName = `job_${jobId}.${ext}`;
                filePath = path.join(tempDir, fileName);
                const outName = `job_${jobId}${isWin ? '.exe' : '.out'}`;
                
                fs.writeFileSync(filePath, code);
                // Lệnh chuẩn cho cả Windows và Linux
                const runCmd = isWin ? `"${outName}"` : `./"${outName}"`;
                cmd = `cd "${tempDir}" && ${compiler} "${fileName}" -o "${outName}" && ${runCmd}`;
                break;

            // --- PYTHON (Linux Render dùng python3) ---
            case 'py':
            case 'python':
                fileName = `job_${jobId}.py`;
                filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, code);
                // Trên Render (Linux) là python3, trên Windows có thể là python
                cmd = `${isWin ? 'python' : 'python3'} "${filePath}"`;
                break;

            // --- JAVASCRIPT ---
            case 'js':
            case 'javascript':
                fileName = `job_${jobId}.js`;
                filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, code);
                cmd = `node "${filePath}"`;
                break;

            // --- TYPESCRIPT (FIX LỖI NÀY) ---
            case 'ts':
            case 'typescript':
                fileName = `job_${jobId}.ts`;
                filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, code);
                // Trên Render đã cài global (-g), gọi thẳng ts-node
                // Trên Windows thì dùng npx cho an toàn
                cmd = `${isWin ? 'npx ts-node' : 'ts-node'} "${filePath}"`;
                break;

            // --- JAVA ---
            case 'java':
                const javaDir = path.join(tempDir, `java_${jobId}`);
                fs.ensureDirSync(javaDir);
                fileName = 'Main.java';
                filePath = path.join(javaDir, fileName);
                fs.writeFileSync(filePath, code);
                cmd = `cd "${javaDir}" && javac Main.java && java Main`;
                break;

            // --- PHP ---
            case 'php':
                fileName = `job_${jobId}.php`;
                filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, code);
                cmd = `php "${filePath}"`;
                break;

            // --- GO ---
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
                fileName = `job_${jobId}.cs`;
                const exeC = `job_${jobId}.exe`;
                filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, code);
                
                if (isWin) {
                    // Windows
                    cmd = `cd "${tempDir}" && csc /nologo /out:"${exeC}" "${fileName}" && "${exeC}"`;
                } else {
                    // Linux (Debian/Render) dùng 'mcs' để biên dịch và 'mono' để chạy
                    cmd = `cd "${tempDir}" && mcs -out:"${exeC}" "${fileName}" && mono "${exeC}"`;
                }
                break;

            default:
                return resolve({ output: `[INFO] Ngôn ngữ .${language} không hỗ trợ chạy (chỉ hiển thị).` });
        }

        exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
            // Clean up files (optional)
            setTimeout(() => { try { /* fs.remove... */ } catch(e){} }, 2000);

            if (error) return resolve({ error: stderr || error.message });
            resolve({ output: stdout });
        });
    });
};

app.post('/run', async (req, res) => {
    const { language, code } = req.body;
    if(!code) return res.json({error: "Code trống!"});
    try {
        const result = await runWithExec(language, code);
        res.json(result);
    } catch (e) { res.json({ output: null, error: e.toString() }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));