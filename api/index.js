require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Static files - Vercel serves from /public by default, but we help it
app.use(express.static(path.join(__dirname, '../public')));

// Initialize Supabase safely with aggressive cleaning
const cleanEnv = (val) => (val || '').replace(/[\r\n\t]/g, '').trim();
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
            return res.status(503).json({ error: 'Supabase credentials missing on server' });
        }
        
        const { data, error } = await supabase
            .from('courses')
            .select('id, name')
            .order('created_at', { ascending: false });
            
        if (error) {
            console.error('[Supabase Error] courses:', error);
            throw error;
        }
        res.json(data || []);
    } catch (err) {
        console.error('[Error] GET /api/courses:', err.message);
        res.status(500).json({ error: 'Database query failed', details: err.message });
    }
});

// API: Process ZIP
app.post('/api/courses/process-zip', async (req, res) => {
    const { courseId, baseName, zipPath } = req.body;
    const tempDir = path.join(os.tmpdir(), `extract_${courseId}`);
    const localZip = path.join(os.tmpdir(), `${courseId}.zip`);

    try {
        console.log(`[Process] Downloading ZIP: ${zipPath}`);
        const { data: blob, error: dlError } = await supabase.storage
            .from('course-assets')
            .download(zipPath);
        
        if (dlError) throw dlError;

        await fs.writeFile(localZip, Buffer.from(await blob.arrayBuffer()));
        
        const zip = new AdmZip(localZip);
        await fs.ensureDir(tempDir);
        zip.extractAllTo(tempDir, true);

        // Find root folder
        let root = tempDir;
        const sub = await fs.readdir(tempDir);
        if (sub.length === 1 && (await fs.stat(path.join(tempDir, sub[0]))).isDirectory()) {
            root = path.join(tempDir, sub[0]);
        }

        // Upload files
        const files = await getFiles(root);
        for (const f of files) {
            const rel = path.relative(root, f);
            const content = await fs.readFile(f);
            await supabase.storage.from('course-assets').upload(`${courseId}/${rel}`, content, { upsert: true });
        }

        // DB
        let courseData = { screens: [] };
        if (await fs.pathExists(path.join(root, 'data.json'))) {
            courseData = await fs.readJson(path.join(root, 'data.json'));
        }

        await supabase.from('courses').insert({ id: courseId, name: baseName, data: courseData });
        
        // Cleanup
        await fs.remove(tempDir);
        await fs.remove(localZip);
        await supabase.storage.from('course-assets').remove([zipPath]);

        res.json({ success: true });
    } catch (err) {
        console.error('[Error] process-zip:', err.message);
        res.status(500).json({ error: err.message });
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
