require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const AdmZip = require('adm-zip');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3030;

// Initialize Supabase - Using defensive check
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log('[Supabase] Client initialized');
    } catch (e) {
        console.error('[Supabase] Failed to initialize client:', e.message);
    }
} else {
    console.error('[Supabase] Missing credentials in environment variables');
}

// Multer in-memory storage for Vercel
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Global log middleware for Vercel debugging
app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    next();
});

// Health / Diagnostics
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        supabaseConfigured: !!supabase,
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseKey,
        nodeEnv: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
    });
});

// API: List courses
app.get('/api/courses', async (req, res) => {
    try {
        if (!supabase) {
            return res.status(503).json({ error: 'Supabase is not configured. Check environment variables in Vercel.' });
        }

        const { data, error } = await supabase
            .from('courses')
            .select('id, name')
            .order('created_at', { ascending: false });
            
        if (error) {
            console.error('[Supabase Error]', error);
            return res.status(500).json({ error: 'Database error', details: error.message });
        }
        res.json(data || []);
    } catch (err) {
        console.error('[Internal Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// Helper: Get Content Type
function getContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimes = {
        '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.xml': 'text/xml', '.mp4': 'video/mp4'
    };
    return mimes[ext] || 'application/octet-stream';
}

// Helper: Recursively find files
async function getFilesRecursive(dir) {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(dirents.map((dirent) => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory() ? getFilesRecursive(res) : res;
    }));
    return Array.prototype.concat(...files);
}

// API: Upload course ZIP
app.post('/api/courses/upload', upload.single('courseZip'), async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    
    const tempDir = path.join(os.tmpdir(), `course_${Date.now()}`);
    
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        
        console.log(`[Upload] Processing ZIP: ${req.file.originalname}`);
        
        const zip = new AdmZip(req.file.buffer);
        const baseName = path.parse(req.file.originalname).name.replace(/[^a-z0-9_\-\u0590-\u05FF]/gi, '_');
        const courseId = `${baseName}_${Date.now()}`;
        
        await fs.ensureDir(tempDir);
        zip.extractAllTo(tempDir, true);
        
        // Flatten nested folder if exists
        let pathToUpload = tempDir;
        const entries = await fs.readdir(tempDir);
        const subdirs = entries.filter(e => fs.statSync(path.join(tempDir, e)).isDirectory());
        
        // If there's only one folder and no files at root, use that folder
        const filesAtRoot = entries.filter(e => !fs.statSync(path.join(tempDir, e)).isDirectory());
        if (subdirs.length === 1 && filesAtRoot.length === 0) {
            pathToUpload = path.join(tempDir, subdirs[0]);
        }

        // Upload files to Supabase Storage
        const files = await getFilesRecursive(pathToUpload);
        console.log(`[Upload] Uploading ${files.length} files to Storage...`);
        
        // Upload in parallel with a limit to avoid rate limiting
        const uploadPromises = files.map(async (file) => {
            const relativePath = path.relative(pathToUpload, file);
            const fileBuffer = await fs.readFile(file);
            const { error: uploadError } = await supabase.storage
                .from('course-assets')
                .upload(`${courseId}/${relativePath}`, fileBuffer, {
                    upsert: true,
                    contentType: getContentType(file)
                });
            if (uploadError) console.error(`[Upload Error] ${relativePath}:`, uploadError.message);
        });
        
        await Promise.all(uploadPromises);

        // Extract metadata
        let courseData = { screens: [] };
        const dataPath = path.join(pathToUpload, 'data.json');
        if (await fs.pathExists(dataPath)) {
            courseData = await fs.readJson(dataPath);
        }

        // Create Database entry
        const { error: dbError } = await supabase
            .from('courses')
            .insert({ id: courseId, name: baseName, data: courseData });

        if (dbError) throw dbError;

        res.json({ success: true, courseId });
    } catch (err) {
        console.error('[Upload API Failure]', err);
        res.status(500).json({ error: 'Failed to process course upload', details: err.message });
    } finally {
        await fs.remove(tempDir).catch(() => {});
    }
});

// API: Get course data
app.get('/api/course/:courseId', async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
        
        const { data, error } = await supabase
            .from('courses')
            .select('data')
            .eq('id', req.params.courseId)
            .single();
            
        if (error) throw error;
        res.json(data.data || { screens: [] });
    } catch (err) {
        console.error('[Course Data API Failure]', err);
        res.status(500).json({ error: err.message });
    }
});

// API: Save course data
app.post('/api/course/:courseId', async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
        
        const { error } = await supabase
            .from('courses')
            .update({ data: req.body })
            .eq('id', req.params.courseId);
        if (error) throw error;
        
        // Background update of data.json in storage
        await supabase.storage
            .from('course-assets')
            .upload(`${req.params.courseId}/data.json`, JSON.stringify(req.body, null, 4), {
                upsert: true,
                contentType: 'application/json'
            });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Upload audio
app.post('/api/course/:courseId/upload-audio', upload.single('audio'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
        
        const { courseId } = req.params;
        const safeName = `audio_${Date.now()}${path.extname(req.file.originalname) || '.wav'}`;
        const supabasePath = `${courseId}/assets/audio/${safeName}`;
        
        const { error } = await supabase.storage
            .from('course-assets')
            .upload(supabasePath, req.file.buffer, {
                upsert: true,
                contentType: req.file.mimetype
            });
        if (error) throw error;
        
        const { data: { publicUrl } } = supabase.storage.from('course-assets').getPublicUrl(supabasePath);
        res.json({ filename: safeName, path: publicUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Export to SCORM (ZIP)
app.get('/api/course/:courseId/export', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    
    const courseId = req.params.courseId;
    const tempDir = path.join(os.tmpdir(), `export_${courseId}_${Date.now()}`);
    
    try {
        await fs.ensureDir(tempDir);
        
        // 1. Get file list from Storage
        const { data: files, error } = await supabase.storage.from('course-assets').list(courseId, { recursive: true });
        if (error) throw error;
        
        // 2. Download all files to temp
        for (const file of files) {
            const { data: blob, error: dlError } = await supabase.storage.from('course-assets').download(`${courseId}/${file.name}`);
            if (dlError) {
                console.error(`[Export Error] Failed to download ${file.name}:`, dlError.message);
                continue;
            }
            
            const target = path.join(tempDir, file.name);
            await fs.ensureDir(path.dirname(target));
            await fs.writeFile(target, Buffer.from(await blob.arrayBuffer()));
        }

        // 3. Zip
        const zipPath = path.join(os.tmpdir(), `${courseId}_out.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        await new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            archive.directory(tempDir, false);
            archive.finalize();
        });

        // 4. Upload ZIP to exports (for sharing)
        const zipBuffer = await fs.readFile(zipPath);
        const zipName = `${courseId}_scorm_${Date.now()}.zip`;
        const { error: upError } = await supabase.storage.from('course-assets').upload(`exports/${zipName}`, zipBuffer);
        if (upError) throw upError;

        const { data: { publicUrl } } = supabase.storage.from('course-assets').getPublicUrl(`exports/${zipName}`);
        
        // Cleanup
        await Promise.all([fs.remove(tempDir), fs.remove(zipPath)]);
        
        res.json({ success: true, downloadUrl: publicUrl });
    } catch (err) {
        console.error('[Export Failure]', err);
        res.status(500).json({ error: 'Export failed', details: err.message });
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server running local on http://localhost:${PORT}`));
}

module.exports = app;
