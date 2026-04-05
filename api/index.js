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
const supabaseAnonKey = getCleanEnv('SUPABASE_ANON_KEY', FALLBACK_KEY);
const supabaseServiceKey = getCleanEnv('SUPABASE_SERVICE_ROLE_KEY', '');

// Favor Service Role Key for backend operations if provided
const supabaseKey = supabaseServiceKey || supabaseAnonKey;

console.log('[Backend] Supabase URL resolved to:', supabaseUrl);
console.log('[Backend] Supabase Key resolved (first 20 chars):', supabaseKey.substring(0, 20) + '...');
console.log('[Backend] Using Service Role Key:', !!supabaseServiceKey);

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
    const subRaw = await fs.readdir(tempDir);
    const sub = subRaw.filter(name => !name.includes('__MACOSX') && name !== '.DS_Store');
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
                
                // Sanitize rel path: ensure it doesn't have leading slashes and use forward slashes
                // Also handle non-ASCII characters by letting Supabase handle them or encoding them
                const storagePath = `${dbId}/${rel.replace(/\\/g, '/')}`;
                
                // Supabase upload with explicit content type
                const { error: upError } = await supabase.storage.from('course-assets').upload(storagePath, content, { 
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
    if (await fs.pathExists(dataJsonPath)) {
        try {
            courseData = await fs.readJson(dataJsonPath);
            if (!courseData || !Array.isArray(courseData.screens)) {
                courseData = { screens: [] };
            }
        } catch (e) {
            console.error('[Backend] Failed to parse data.json, using empty template:', e);
            courseData = { screens: [] };
        }
    }

    const HARDCODED_ORG_ID = "70814869-cc75-4801-8c29-2417fc1fc983"; // Updated valid Org ID
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

        // 1. Storage Files Gathering (List ALL files in the course folder RECURSIVELY)
        const listAllFiles = async (folder) => {
            const { data, error } = await supabase.storage.from('course-assets').list(folder);
            if (error) {
                console.error(`[Backend] Export: List error for ${folder}:`, error.message);
                return [];
            }
            
            let files = [];
            for (const item of data) {
                const fullPath = folder ? `${folder}/${item.name}` : item.name;
                // item.id is usually null for folders, or we can check item.metadata
                // A better way in Supabase: items without metadata are usually folders
                if (!item.metadata) {
                    const subFiles = await listAllFiles(fullPath);
                    files = files.concat(subFiles);
                } else {
                    files.push(fullPath);
                }
            }
            return files;
        };

        const allStorageFiles = await listAllFiles(courseId);
        const exportLog = [];
        exportLog.push(`[Export Log] Course ID: ${courseId}`);

        // Set to track added files
        const processedFiles = new Set();
        
        const downloadAndAddFile = async (fullPath) => {
            if (processedFiles.has(fullPath)) return;
            processedFiles.add(fullPath);

            let relPath = fullPath;
            // Strip ANY leading UUID/prefix to keep paths clean and matching data.json
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
            if (uuidPattern.test(relPath)) {
                relPath = relPath.replace(uuidPattern, '').replace(/^\/+/, '');
            }
            
            try {
                const { data: fileData, error } = await supabase.storage.from('course-assets').download(fullPath);
                if (error) {
                    exportLog.push(`[ERROR] Fail download ${relPath} (from ${fullPath}): ${error.message}`);
                    console.error(`[Backend] Export: Fail download ${relPath}:`, error.message);
                    return;
                }
                if (fileData) {
                    // Filter out system files from ZIP and manifest
                    const filename = relPath.split('/').pop();
                    if (filename.startsWith('.') || filename === 'Thumbs.db' || filename === '__MACOSX') return;
                    
                    archive.append(Buffer.from(await fileData.arrayBuffer()), { name: relPath });
                    exportedFiles.push(relPath);
                    console.log(`[Backend] Export: Added to ZIP: ${relPath}`);
                }
            } catch (err) {
                exportLog.push(`[ERROR] Error processing ${relPath}: ${err.message}`);
                console.error(`[Backend] Export: Error processing ${relPath}:`, err.message);
            }
        };

        // 1. Add all files physically in the course folder
        if (allStorageFiles && allStorageFiles.length > 0) {
            console.log(`[Backend] Export: Found ${allStorageFiles.length} files in folder for course ${courseId}`);
            for (let i = 0; i < allStorageFiles.length; i += 10) {
                await Promise.all(allStorageFiles.slice(i, i + 10).map(downloadAndAddFile));
            }
        }

        // 2. Scan course data for any OTHER assets that might be global or in different folders
        console.log('[Backend] Export: Scanning JSON for additional assets...');
        const dataStr = JSON.stringify(course.data);
        const assetRegex = /([a-zA-Z0-9._\-\/]+\.(?:png|jpg|jpeg|gif|mp3|wav|mp4|webm|ogg|json|js|css))/g;
        const matches = dataStr.match(assetRegex) || [];
        const uniqueMatches = [...new Set(matches)];

        for (const match of uniqueMatches) {
            // Clean match from 'course-assets/' prefix to get storage path
            const cleanPath = match.replace(/^course-assets\//, '');
            const filename = cleanPath.split('/').pop();
            const systemAssets = ['maya_guide.png', 'mia_transparent_v4.png', 'bg_welcome.png', 'bg_content.png', 'bg_quiz.png', 'bg_summary.png', 'bg_canvas.png'];
            
            if (!systemAssets.includes(filename) && !processedFiles.has(cleanPath)) {
                console.log(`[Backend] Export: Found referenced asset outside main list: ${cleanPath}`);
                await downloadAndAddFile(cleanPath);
            }
        }
        
        archive.append(exportLog.join('\n'), { name: 'export-log.txt' });

        // 2. data.json & data.js (Generated from database)
        let jsonStr = JSON.stringify(course.data, null, 2);
        
        // Clean up paths: Strip BOTH full Supabase URLs and the UUID prefixes
        const STORAGE_URL_BASE = `${supabaseUrl}/storage/v1/object/public/course-assets/`;
        // Strip the full storage URL base (with or without course ID)
        jsonStr = jsonStr.replace(new RegExp(STORAGE_URL_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
        
        // Strip UUIDs from the beginning of paths (including trailing slash)
        // This handles both course-specific and global asset references
        jsonStr = jsonStr.replace(/(?:^|["'])([a-f0-9-]{36})\//g, (match, p1) => {
            return match.replace(p1 + '/', '');
        });
        
        archive.append(jsonStr, { name: 'data.json' });
        archive.append(`window.courseData = ${jsonStr};`, { name: 'data.js' });
        exportedFiles.push('data.json', 'data.js');

        // 3. Template Files (Add these LAST so they overwrite any stray files from storage)
        const templateDir = path.join(__dirname, '../scorm-template');
        console.log(`[Backend] Export: Using template from: ${templateDir}`);
        if (await fs.pathExists(templateDir)) {
            const files = await fs.readdir(templateDir);
            for (const file of files) {
                // Filter junk and already handled files
                if (file.startsWith('.') || file === 'imsmanifest.xml' || file === 'data.js' || file === 'data.json') continue; 
                const fullPath = path.join(templateDir, file);
                const stat = await fs.stat(fullPath);
                if (stat.isFile()) {
                    archive.file(fullPath, { name: file });
                    exportedFiles.push(file);
                } else if (stat.isDirectory() && file === 'assets') {
                    // Recursive add assets
                    const assets = await fs.readdir(fullPath);
                    for (const f of assets) {
                        if (f.startsWith('.')) continue;
                        archive.file(path.join(fullPath, f), { name: `assets/${f}` });
                        exportedFiles.push(`assets/${f}`);
                    }
                }
            }
        }

        // 4. Manifest (SCORM 1.2 Standard)
        const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="Course_${courseId}" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2 imsmd_rootv1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
    <metadata>
        <schema>ADL SCORM</schema>
        <schemaversion>1.2</schemaversion>
    </metadata>
    <organizations default="ORG_1">
        <organization identifier="ORG_1">
            <title>${(course.title || 'Course').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
            <item identifier="ITEM_1" identifierref="RES_1">
                <title>${(course.title || 'Course').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
            </item>
        </organization>
    </organizations>
    <resources>
        <resource identifier="RES_1" type="webcontent" adlcp:scormtype="sco" href="index.html">
            ${[...new Set(exportedFiles)].filter(f => !f.startsWith('.')).map(f => `<file href="${f}"/>`).join('\n            ')}
        </resource>
    </resources>
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
