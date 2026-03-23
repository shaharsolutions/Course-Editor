// Safe dotenv loading (v17 may throw or behave unexpectedly on Vercel where .env doesn't exist)
try { require('dotenv').config(); } catch (e) { /* no .env on Vercel, that's fine */ }

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const crypto = require('crypto');
const archiver = require('archiver');

// Multer for local uploads (more reliable than direct client->storage for ZIPs)
const upload = multer({ dest: os.tmpdir() });

// Generate proper UUID v4
function generateUUID() {
    return crypto.randomUUID();
}

const getMimeType = (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.json': 'application/json',
        '.js': 'application/javascript',
        '.html': 'text/html',
        '.css': 'text/css'
    };
    return map[ext] || 'application/octet-stream';
};

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));
app.use('/player', express.static(path.join(__dirname, '../scorm-template')));

// --- Supabase Initialization ---
// Hardcoded defaults ensure this works even if Vercel env vars are not set
const FALLBACK_URL = 'https://iduyexkzivtnvrdsbwig.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkdXlleGt6aXZ0bnZyZHNid2lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NjYwMTYsImV4cCI6MjA4OTA0MjAxNn0.MhqZwvY7RiOBBqgBhRD-e-SqbI7NIf2vWxNuD5_6e48';

function getCleanEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    // Clean up potential whitespace, quotes, trailing comments
    const cleaned = raw.toString().split(/[\r\n]/)[0].trim().replace(/^['"]|['"]$/g, '');
    return cleaned || fallback;
}

const supabaseUrl = getCleanEnv('SUPABASE_URL', FALLBACK_URL);
const supabaseKey = getCleanEnv('SUPABASE_ANON_KEY', FALLBACK_KEY);

console.log('[Backend] Supabase URL resolved to:', supabaseUrl);
console.log('[Backend] Supabase Key resolved (first 20 chars):', supabaseKey.substring(0, 20) + '...');

let supabase;
try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Backend] Supabase client created OK');
} catch (err) {
    console.error('[Backend] FATAL: Failed to create Supabase client:', err);
}

// --- API Endpoints ---

// Diagnostic health check - tests actual DB connection
app.get('/api/health', async (req, res) => {
    const diag = {
        ok: false,
        supabaseUrl: supabaseUrl,
        supabaseKeyPrefix: supabaseKey ? supabaseKey.substring(0, 20) + '...' : 'MISSING',
        clientCreated: !!supabase,
        envSource: process.env.SUPABASE_URL ? 'env' : 'fallback',
        nodeVersion: process.version,
        platform: process.platform,
        dbTest: null
    };

    if (supabase) {
        try {
            const { data, error } = await supabase.from('courses').select('id').limit(1);
            if (error) {
                diag.dbTest = { success: false, error: error.message, code: error.code };
            } else {
                diag.dbTest = { success: true, rowCount: data ? data.length : 0 };
                diag.ok = true;
            }
        } catch (err) {
            diag.dbTest = { success: false, error: err.message, type: err.constructor.name };
        }
    }

    res.json(diag);
});

// List courses
app.get('/api/courses', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('courses')
            .select('id, title, created_at')
            .limit(50)
            .order('created_at', { ascending: false });
            
        if (error) {
            console.error('[Backend] Supabase Error (Courses List):', error);
            return res.status(500).json({ error: error.message, details: error });
        }
        
        const mappedData = (data || []).map(item => ({
            id: item.id || item.course_id,
            name: item.title || item.name || item.id
        }));
        res.json(mappedData);
    } catch (err) {
        console.error('[Backend] Express Error (GET /api/courses):', err);
        res.status(500).json({ 
            error: err.message,
            stack: err.stack,
            details: 'Initialization or runtime failure.'
        });
    }
});

// Upload ZIP and process (New more reliable endpoint)
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const { baseName } = req.body;
    const localZip = req.file.path;
    const dbId = generateUUID();
    const tempDir = path.join(os.tmpdir(), `extract_${dbId}`);

    try {
        await processLocalZip(localZip, tempDir, dbId, baseName);
        res.json({ success: true, courseId: dbId });
    } catch (err) {
        console.error('[Backend] Upload/Process Error:', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        fs.remove(tempDir).catch(() => {});
        fs.remove(localZip).catch(() => {});
    }
});

async function processLocalZip(zipPath, tempDir, dbId, baseName) {
    const zip = new AdmZip(zipPath);
    await fs.ensureDir(tempDir);
    zip.extractAllTo(tempDir, true);

    let root = tempDir;
    const sub = await fs.readdir(tempDir);
    // Find content root (handle nested folder in ZIP)
    if (sub.length === 1 && (await fs.stat(path.join(tempDir, sub[0]))).isDirectory()) {
        root = path.join(tempDir, sub[0]);
    }

    const getFiles = async (dir) => {
        const items = await fs.readdir(dir, { withFileTypes: true });
        let allFiles = [];
        for (const s of items) {
            const p = path.join(dir, s.name);
            if (s.isDirectory()) {
                const children = await getFiles(p);
                allFiles = allFiles.concat(children);
            } else {
                allFiles.push(p);
            }
        }
        return allFiles;
    };

    const files = await getFiles(root);
    console.log(`[Backend] Uploading ${files.length} assets for course ${dbId}...`);
    
    // Batch uploads to Supabase Storage
    for (let i = 0; i < files.length; i += 5) {
        const batch = files.slice(i, i + 5);
        await Promise.all(batch.map(async (f) => {
            const rel = path.relative(root, f);
            if (rel.includes('.DS_Store') || rel.includes('__MACOSX')) return;
            
            try {
                const content = await fs.readFile(f);
                const contentType = getMimeType(f);
                
                // Supabase upload with explicit content type
                const { error: upError } = await supabase.storage.from('course-assets').upload(`${dbId}/${rel}`, content, { 
                    upsert: true,
                    contentType: contentType
                });
                
                if (upError) {
                    console.error(`[Backend] Asset upload fail ${rel}:`, upError.message);
                } else {
                    console.log(`[Backend] Asset uploaded: ${rel} (${contentType})`);
                }
            } catch (err) {
                console.error(`[Backend] Error processing file ${rel}:`, err.message);
            }
        }));
    }

    let courseData = { screens: [] };
    const dataJsonPath = path.join(root, 'data.json');
    if (await fs.pathExists(dataJsonPath)) courseData = await fs.readJson(dataJsonPath);

    const HARDCODED_ORG_ID = "526d46ee-26ea-4b2f-9026-a579c64cccf2";
    const { error: dbError } = await supabase.from('courses').insert({
        id: dbId,
        org_id: HARDCODED_ORG_ID,
        title: baseName,
        data: courseData,
        published: true
    });

    if (dbError) throw dbError;
}

// Deprecated but maintained for compatibility: Process ZIP already in Storage
app.post('/api/courses/process-zip', async (req, res) => {
    const { courseId, baseName, zipPath } = req.body;
    const tempDir = path.join(os.tmpdir(), `extract_${courseId}`);
    const localZip = path.join(os.tmpdir(), `${courseId}.zip`);

    try {
        if (!supabase) throw new Error('Supabase client not initialized');
        
        console.log(`[Backend] Processing ZIP from storage: ${zipPath}`);
        const { data: blob, error: dlError } = await supabase.storage.from('course-assets').download(zipPath);
        if (dlError) throw dlError;
        
        const arrayBuffer = await blob.arrayBuffer();
        await fs.writeFile(localZip, Buffer.from(arrayBuffer));
        
        const dbId = generateUUID();
        await processLocalZip(localZip, tempDir, dbId, baseName);
        res.json({ success: true, courseId: dbId });
    } catch (err) {
        console.error('[Backend] Express Error (POST /api/courses/process-zip):', err);
        res.status(500).json({ error: err.message, details: err });
    } finally {
        fs.remove(tempDir).catch(() => {});
        fs.remove(localZip).catch(() => {});
        // Cleanup the temp ZIP from Supabase Storage if it was uploaded there
        if (zipPath && zipPath.startsWith('temp_uploads/')) {
            supabase.storage.from('course-assets').remove([zipPath])
                .then(() => console.log(`[Backend] Cleaned up temp ZIP: ${zipPath}`))
                .catch(err => console.error(`[Backend] Fail to clean up temp ZIP ${zipPath}:`, err.message));
        }
    }
});

// Course Data
app.get('/api/course/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('courses').select('data, title').eq('id', req.params.id).single();
        if (error) {
            console.error(`[Backend] Course fetch error (${req.params.id}):`, error.message);
            return res.status(500).json({ error: error.message });
        }
        if (!data) return res.status(404).json({ error: 'Course not found' });
        
        const courseData = data.data || { screens: [] };
        courseData.name = data.title || courseData.name;
        res.json(courseData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/course/:id', async (req, res) => {
    try {
        const updateData = { data: req.body };
        if (req.body.name) {
            updateData.title = req.body.name;
        }
        const { error } = await supabase.from('courses').update(updateData).eq('id', req.params.id);
        if (error) {
            console.error(`[Backend] Course update error (${req.params.id}):`, error.message);
            return res.status(500).json({ error: error.message });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Course
app.delete('/api/course/:id', async (req, res) => {
    const { data: files } = await supabase.storage.from('course-assets').list(req.params.id, { recursive: true });
    if (files && files.length > 0) {
        await supabase.storage.from('course-assets').remove(files.map(f => `${req.params.id}/${f.name}`));
    }
    await supabase.from('courses').delete().eq('id', req.params.id);
    res.json({ success: true });
});

// Export SCORM (Dynamic Manifest)
app.get('/api/course/:id/export', async (req, res) => {
    console.log(`[Backend] Export requested for course: ${req.params.id}`);
    try {
        const courseId = req.params.id;
        const { data: course, error: fetchError } = await supabase.from('courses').select('title, data').eq('id', courseId).single();
        
        if (fetchError || !course) {
            console.error(`[Backend] Export: Course not found or error:`, fetchError);
            return res.status(404).send('Course not found');
        }

        const { data: storageFiles } = await supabase.storage.from('course-assets').list(courseId, { recursive: true, limit: 1000 });

        const safeTitle = (course.title || 'course').replace(/[^a-zA-Z0-9א-ת\s\-_]/g, '_');
        const encodedTitle = encodeURIComponent(safeTitle);
        
        res.setHeader('Content-Type', 'application/zip');
        // Use RFC 6266 format for non-ASCII filenames (Hebrew support)
        res.setHeader('Content-Disposition', `attachment; filename="${encodedTitle}.zip"; filename*=UTF-8''${encodedTitle}.zip`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        
        // Handle archive errors
        archive.on('error', (err) => {
            console.error('[Backend] Archiver error:', err);
            // We can't change status if headers sent, but we can end the response
            if (!res.headersSent) res.status(500).send('Archiver failed');
            else res.end();
        });

        archive.pipe(res);
        const exportedFiles = [];
        const coreFiles = ['index.html', 'data.json', 'data.js', 'scorm_api.js', 'studio-player.js', 'studio-style.css', 'imsmanifest.xml'];

        // 1. Storage Files Gathering (Using the flat recursive list from earlier)
        const allPaths = (storageFiles || [])
            .filter(item => item.id && item.name !== '.emptyFolderPlaceholder')
            .map(item => item.name);
        
        const exportLog = [];
        exportLog.push(`[Export Log] Course ID: ${courseId}`);
        exportLog.push(`[Export Log] Found ${allPaths.length} items in storage.`);

        const downloadFile = async (filePath) => {
            if (!filePath || filePath.endsWith('/')) return;
            // Skip core files
            if (coreFiles.includes(filePath.split('/').pop())) return;

            try {
                const { data: fileData, error } = await supabase.storage.from('course-assets').download(`${courseId}/${filePath}`);
                if (error) {
                    exportLog.push(`[ERROR] Fail download ${filePath}: ${error.message}`);
                    console.warn(`[Backend] Export fail ${filePath}:`, error.message);
                    return;
                }
                if (fileData) {
                    // Flatten all uploaded assets into the 'assets/' directory in the ZIP 
                    // to prevent path resolution issues with subdirectories like 'logos/'.
                    const filename = filePath.split('/').pop();
                    const zipPath = `assets/${filename}`;
                    archive.append(Buffer.from(await fileData.arrayBuffer()), { name: zipPath });
                    exportedFiles.push(zipPath);
                }
            } catch (err) {
                exportLog.push(`[ERROR] Error ${filePath}: ${err.message}`);
            }
        };

        // Download assets in batches
        for (let i = 0; i < allPaths.length; i += 10) {
            await Promise.all(allPaths.slice(i, i + 10).map(downloadFile));
        }
        
        archive.append(exportLog.join('\n'), { name: 'export-log.txt' });

        // 2. data.json & data.js (Generated from database)
        let jsonStr = JSON.stringify(course.data, null, 2);
        // Clean up paths: strip the course ID prefix (e.g. "GUID/logos/..." -> "logos/...")
        const courseIdEscaped = courseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const guidRegex = new RegExp(`${courseIdEscaped}/`, 'g');
        jsonStr = jsonStr.replace(guidRegex, '');
        
        archive.append(jsonStr, { name: 'data.json' });
        archive.append(`window.courseData = ${jsonStr};`, { name: 'data.js' });
        exportedFiles.push('data.json', 'data.js');

        // 3. Template Files (Add these LAST so they overwrite any stray files from storage)
        const templateDir = path.join(__dirname, '../scorm-template');
        if (await fs.pathExists(templateDir)) {
            const files = await fs.readdir(templateDir);
            for (const file of files) {
                if (file === 'imsmanifest.xml' || file === 'data.js') continue; 
                const fullPath = path.join(templateDir, file);
                const stat = await fs.stat(fullPath);
                if (stat.isFile()) {
                    archive.file(fullPath, { name: file });
                    exportedFiles.push(file);
                } else if (stat.isDirectory() && file === 'assets') {
                    // Recursive add assets
                    archive.directory(fullPath, 'assets');
                    const assetFiles = await fs.readdir(fullPath);
                    assetFiles.forEach(f => exportedFiles.push(`assets/${f}`));
                }
            }
        }

        // 4. Manifest
        const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="Course_${Date.now()}" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2 imsmd_rootv1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
    <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
    <organizations default="ORG_1"><organization identifier="ORG_1"><title>${course.title}</title><item identifier="ITEM_1" identifierref="RES_1"><title>${course.title}</title></item></organization></organizations>
    <resources><resource identifier="RES_1" type="webcontent" adlcp:scormtype="sco" href="index.html">
        ${[...new Set(exportedFiles)].map(f => `<file href="${f}"/>`).join('\n        ')}
    </resource></resources>
</manifest>`;
        archive.append(manifest, { name: 'imsmanifest.xml' });
        await archive.finalize();
    } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(500).send('Export failed');
    }
});

module.exports = app;
if (require.main === module) {
    app.listen(process.env.PORT || 3030, () => console.log('Server running'));
}
