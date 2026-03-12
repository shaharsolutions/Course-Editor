require('dotenv').config();
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const { createClient } = require('@supabase/supabase-js');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3030;

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// We'll use /tmp for all temporary operations (Vercel friendly)
const TEMP_DIR = os.tmpdir();
const UPLOADS_DIR = path.join(TEMP_DIR, 'lms-uploads');
fs.ensureDirSync(UPLOADS_DIR);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure storage for audio files (Local temp before Supabase upload)
const audioStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = path.join(TEMP_DIR, 'audio-temp');
        fs.ensureDirSync(dest);
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.wav';
        const safeName = `audio_${Date.now()}${ext}`;
        cb(null, safeName);
    }
});
const uploadAudioMulter = multer({ storage: audioStorage });

// API: List courses
app.get('/api/courses', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('courses')
            .select('id, name')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Configure storage for ZIP uploads
const zipUpload = multer({ dest: UPLOADS_DIR });

// Helper: Recursively upload folder to Supabase Storage
async function uploadFolderToSupabase(localPath, supabaseBasePath) {
    const entries = await fs.readdir(localPath, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullLocalPath = path.join(localPath, entry.name);
        const supabasePath = `${supabaseBasePath}/${entry.name}`;
        
        if (entry.isDirectory()) {
            await uploadFolderToSupabase(fullLocalPath, supabasePath);
        } else {
            const fileBuffer = await fs.readFile(fullLocalPath);
            const { error } = await supabase.storage
                .from('course-assets')
                .upload(supabasePath, fileBuffer, {
                    upsert: true,
                    contentType: getContentType(entry.name)
                });
            if (error) console.error(`Error uploading ${supabasePath}:`, error);
        }
    }
}

function getContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav'
    };
    return mimes[ext] || 'application/octet-stream';
}

// API: Upload course ZIP
app.post('/api/courses/upload', zipUpload.single('courseZip'), async (req, res) => {
    let targetPath = '';
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const zip = new AdmZip(req.file.path);
        const baseName = path.parse(req.file.originalname).name.replace(/[^a-z0-9_\-\u0590-\u05FF]/gi, '_');
        const courseId = `${baseName}_${Date.now()}`;
        targetPath = path.join(TEMP_DIR, courseId);
        
        // Extract directly to temp folder
        zip.extractAllTo(targetPath, true);
        
        // Check for nested structure and flatten if needed
        let pathToUpload = targetPath;
        const entries = await fs.readdir(targetPath);
        if (entries.length === 1 && (await fs.stat(path.join(targetPath, entries[0]))).isDirectory()) {
            pathToUpload = path.join(targetPath, entries[0]);
        }

        // 1. Upload assets to Supabase Storage
        console.log(`[Supabase] Uploading assets for ${courseId}...`);
        await uploadFolderToSupabase(pathToUpload, courseId);

        // 2. Try to extract data.json or main.js for initial data
        let courseData = { screens: [] };
        const dataPath = path.join(pathToUpload, 'data.json');
        if (await fs.pathExists(dataPath)) {
            courseData = await fs.readJson(dataPath);
        }

        // 3. Create entry in Database
        const { error: dbError } = await supabase
            .from('courses')
            .insert({
                id: courseId,
                name: baseName,
                data: courseData
            });

        if (dbError) throw dbError;

        // Cleanup
        await fs.remove(req.file.path);
        await fs.remove(targetPath);

        res.json({ success: true, courseId });
    } catch (err) {
        console.error('[Server] Upload error:', err);
        if (targetPath) await fs.remove(targetPath);
        res.status(500).json({ error: err.message });
    }
});

// API: Get course data
app.get('/api/course/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const { data, error } = await supabase
            .from('courses')
            .select('data')
            .eq('id', courseId)
            .single();
            
        if (error) throw error;
        res.json(data ? data.data : { screens: [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Save course data
app.post('/api/course/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const data = req.body;
        
        const { error } = await supabase
            .from('courses')
            .update({ data })
            .eq('id', courseId);
            
        if (error) throw error;
        
        // Also update data.json in storage for consistency if export is needed
        await supabase.storage
            .from('course-assets')
            .upload(`${courseId}/data.json`, JSON.stringify(data, null, 4), {
                upsert: true,
                contentType: 'application/json'
            });

        res.json({ success: true });
    } catch (err) {
        console.error(`[Server] Error saving course ${req.params.courseId}:`, err);
        res.status(500).json({ error: err.message });
    }
});

// API: Upload audio
app.post('/api/course/:courseId/upload-audio', uploadAudioMulter.single('audio'), async (req, res) => {
    try {
        const { courseId } = req.params;
        const fileContent = await fs.readFile(req.file.path);
        const supabasePath = `${courseId}/assets/audio/${req.file.filename}`;
        
        const { error } = await supabase.storage
            .from('course-assets')
            .upload(supabasePath, fileContent, {
                upsert: true,
                contentType: req.file.mimetype
            });
            
        if (error) throw error;
        
        await fs.remove(req.file.path);
        
        // Return URL from Supabase Storage
        const { data: { publicUrl } } = supabase.storage
            .from('course-assets')
            .getPublicUrl(supabasePath);
            
        res.json({ filename: req.file.filename, path: publicUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Export to SCORM (ZIP)
app.get('/api/course/:courseId/export', async (req, res) => {
    const { courseId } = req.params;
    const tempExportDir = path.join(TEMP_DIR, `export_${courseId}_${Date.now()}`);
    
    try {
        await fs.ensureDir(tempExportDir);
        
        // 1. List all files for this course in Supabase Storage
        const { data: files, error } = await supabase.storage
            .from('course-assets')
            .list(courseId, { recursive: true });
            
        if (error) throw error;
        
        // 2. Download all files
        for (const file of files) {
            if (file.id) { // its a file
                const { data: blob, error: dlError } = await supabase.storage
                    .from('course-assets')
                    .download(`${courseId}/${file.name}`);
                    
                if (dlError) {
                    console.error(`Error downloading ${file.name}:`, dlError);
                    continue;
                }
                
                const targetFile = path.join(tempExportDir, file.name);
                await fs.ensureDir(path.dirname(targetFile));
                await fs.writeFile(targetFile, Buffer.from(await blob.arrayBuffer()));
            }
        }

        // 3. Zip it up
        const zipName = `${courseId}_scorm.zip`;
        const zipPath = path.join(TEMP_DIR, zipName);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        return new Promise((resolve, reject) => {
            output.on('close', async () => {
                // Upload the ZIP to storage so we can provide a link (Since Vercel won't serve local temp files easily)
                const zipBuffer = await fs.readFile(zipPath);
                const { error: uploadError } = await supabase.storage
                    .from('course-assets')
                    .upload(`exports/${zipName}`, zipBuffer, { upsert: true });
                
                if (uploadError) reject(uploadError);
                
                const { data: { publicUrl } } = supabase.storage
                    .from('course-assets')
                    .getPublicUrl(`exports/${zipName}`);
                
                // Cleanup temp
                await fs.remove(tempExportDir);
                await fs.remove(zipPath);
                
                res.json({ success: true, downloadUrl: publicUrl });
                resolve();
            });

            archive.on('error', (err) => { reject(err); });
            archive.pipe(output);
            archive.directory(tempExportDir, false);
            archive.finalize();
        });

    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: err.message });
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Course Editor Server running at http://localhost:${PORT}`);
    });
}

module.exports = app;
