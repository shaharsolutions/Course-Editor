require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const crypto = require('crypto');

// Generate proper UUID v4
function generateUUID() {
    return crypto.randomUUID();
}

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Static files - Vercel serves from /public by default, but we help it
app.use(express.static(path.join(__dirname, '../public')));

// Initialize Supabase safely with aggressive cleaning
const cleanEnv = (val) => {
    if (!val) return '';
    let cleaned = val.replace(/[\r\n\t]/g, '').trim();
    // Fix common copy-paste error where PORT=3030 is appended
    cleaned = cleaned.replace(/PORT=\d+.*$/i, '').trim();
    return cleaned;
};
const supabaseUrl = cleanEnv(process.env.SUPABASE_URL);
const supabaseKey = cleanEnv(process.env.SUPABASE_ANON_KEY);

if (!supabaseUrl || !supabaseKey) {
    console.error('[CRITICAL] Missing Supabase environment variables!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Diagnostics
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        env: process.env.NODE_ENV,
        supabaseUrl: !!supabaseUrl,
        supabaseKey: !!supabaseKey,
        keyLength: supabaseKey ? supabaseKey.length : 0,
        keyStart: supabaseKey ? supabaseKey.substring(0, 10) : 'EMPTY',
        keyEnd: supabaseKey ? supabaseKey.substring(supabaseKey.length - 10) : 'EMPTY',
        urlValue: supabaseUrl || 'EMPTY'
    });
});

// API: List courses
app.get('/api/courses', async (req, res) => {
    try {
        if (!supabaseUrl || !supabaseKey) {
            return res.status(503).json({ error: 'Supabase credentials missing' });
        }
        
        // Try to be smart: first try id, name. If it fails, try to get anything.
        const { data, error } = await supabase
            .from('courses')
            .select('*') // Select all to see what we have
            .limit(50)
            .order('created_at', { ascending: false });
            
        if (error) {
            console.error('[Supabase Error] courses:', error);
            // If the table is missing or columns are wrong
            return res.status(500).json({ 
                error: 'Database query failed', 
                message: error.message,
                hint: 'Check if table "courses" exists and has columns id, name, data' 
            });
        }

        // Map the results to ensure we have id and name
        const mappedData = (data || []).map(item => ({
            id: item.id || item.course_id || item.ID,
            name: item.name || item.title || item.CourseName || item.id
        }));

        res.json(mappedData);
    } catch (err) {
        console.error('[Error] GET /api/courses:', err.message);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

// API: Process ZIP
app.post('/api/courses/process-zip', async (req, res) => {
    const { courseId, baseName, zipPath } = req.body;
    const tempDir = path.join(os.tmpdir(), `extract_${courseId}`);
    const localZip = path.join(os.tmpdir(), `${courseId}.zip`);

    try {
        console.log(`[Process] Starting extraction for ${courseId}...`);
        
        // 1. Download
        const { data: blob, error: dlError } = await supabase.storage
            .from('course-assets')
            .download(zipPath);
        if (dlError) throw new Error(`Download failed: ${dlError.message}`);
        console.log('[Process] Downloaded ZIP from storage.');

        await fs.writeFile(localZip, Buffer.from(await blob.arrayBuffer()));
        
        // 2. Extract
        const zip = new AdmZip(localZip);
        await fs.ensureDir(tempDir);
        zip.extractAllTo(tempDir, true);
        console.log('[Process] Extracted files to temp directory.');

        // 3. Find root folder
        let root = tempDir;
        const sub = await fs.readdir(tempDir);
        if (sub.length === 1 && (await fs.stat(path.join(tempDir, sub[0]))).isDirectory()) {
            root = path.join(tempDir, sub[0]);
        }

        // 4. Upload files (Parallel to save time)
        const files = await getFiles(root);
        console.log(`[Process] Uploading ${files.length} files...`);
        
        await Promise.all(files.map(async (f) => {
            const rel = path.relative(root, f);
            const content = await fs.readFile(f);
            const { error: upErr } = await supabase.storage
                .from('course-assets')
                .upload(`${courseId}/${rel}`, content, { upsert: true });
            if (upErr) console.warn(`[Process] Warning: failed to upload ${rel}:`, upErr.message);
        }));
        console.log('[Process] Finished uploading assets.');

        // 5. Extract metadata
        let courseData = { screens: [] };
        const dataJsonPath = path.join(root, 'data.json');
        if (await fs.pathExists(dataJsonPath)) {
            courseData = await fs.readJson(dataJsonPath);
        }

        // 6. DB Insert - Handle org_id for multi-tenant LMS tables
        const dbId = generateUUID();
        
        // Try to get an existing org_id from other courses to satisfy the NOT NULL constraint
        let orgId = null;
        const { data: existingCourses } = await supabase.from('courses').select('org_id').limit(1);
        if (existingCourses && existingCourses.length > 0) {
            orgId = existingCourses[0].org_id;
        }

        console.log(`[Process] Attempting DB insert with UUID: ${dbId} and OrgID: ${orgId}`);
        
        const insertData = { 
            id: dbId, 
            name: baseName, 
            title: baseName,
            description: baseName,
            category: 'כללי',
            entry_file: 'index.html',
            is_active: true,
            data: courseData
        };
        
        // Add org_id if we found one
        if (orgId) insertData.org_id = orgId;

        const { error: dbError } = await supabase
            .from('courses')
            .insert(insertData);

        if (dbError) {
            console.error('[Supabase DB Error Detailed]', dbError);
            throw new Error(`DB Error: ${dbError.message} | Details: ${dbError.details} | Hint: ${dbError.hint}`);
        }
        console.log('[Process] Database updated successfully.');
        
        // Cleanup
        await Promise.all([
            fs.remove(tempDir).catch(() => {}),
            fs.remove(localZip).catch(() => {}),
            supabase.storage.from('course-assets').remove([zipPath]).catch(() => {})
        ]);

        res.json({ success: true, courseId });
    } catch (err) {
        console.error('[Error] process-zip failed:', err.message);
        res.status(500).json({ error: 'Processing failed', details: err.message });
    }
});

async function getFiles(dir) {
    const sub = await fs.readdir(dir, { withFileTypes: true });
    const res = await Promise.all(sub.map((s) => {
        const p = path.resolve(dir, s.name);
        return s.isDirectory() ? getFiles(p) : p;
    }));
    return Array.prototype.concat(...res);
}

// Course Data (GET/POST)
app.get('/api/course/:id', async (req, res) => {
    const { data, error } = await supabase.from('courses').select('data').eq('id', req.params.id).single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data.data);
});

app.post('/api/course/:id', async (req, res) => {
    const { error } = await supabase.from('courses').update({ data: req.body }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

module.exports = app;
