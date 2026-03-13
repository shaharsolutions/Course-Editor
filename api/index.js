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
const archiver = require('archiver');

// Generate proper UUID v4
function generateUUID() {
    return crypto.randomUUID();
}

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Initialize Supabase
const cleanEnv = (val) => {
    if (!val) return '';
    return val.replace(/[\r\n\t]/g, '').trim().replace(/PORT=\d+.*$/i, '').trim();
};
const supabaseUrl = cleanEnv(process.env.SUPABASE_URL);
const supabaseKey = cleanEnv(process.env.SUPABASE_ANON_KEY);
const supabase = createClient(supabaseUrl, supabaseKey);

// --- API Endpoints ---

// Health check
app.get('/api/health', async (req, res) => {
    res.json({ ok: true, supabaseUrl: !!supabaseUrl });
});

// List courses
app.get('/api/courses', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('courses')
            .select('*')
            .limit(50)
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        const mappedData = (data || []).map(item => ({
            id: item.id || item.course_id,
            name: item.name || item.title || item.id
        }));
        res.json(mappedData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Process ZIP
app.post('/api/courses/process-zip', async (req, res) => {
    const { courseId, baseName, zipPath } = req.body;
    const tempDir = path.join(os.tmpdir(), `extract_${courseId}`);
    const localZip = path.join(os.tmpdir(), `${courseId}.zip`);

    try {
        const { data: blob, error: dlError } = await supabase.storage.from('course-assets').download(zipPath);
        if (dlError) throw dlError;
        await fs.writeFile(localZip, Buffer.from(await blob.arrayBuffer()));
        
        const zip = new AdmZip(localZip);
        await fs.ensureDir(tempDir);
        zip.extractAllTo(tempDir, true);

        const dbId = generateUUID();
        let root = tempDir;
        const sub = await fs.readdir(tempDir);
        if (sub.length === 1 && (await fs.stat(path.join(tempDir, sub[0]))).isDirectory()) {
            root = path.join(tempDir, sub[0]);
        }

        const getFiles = async (dir) => {
            const items = await fs.readdir(dir, { withFileTypes: true });
            const childFiles = await Promise.all(items.map(s => {
                const p = path.resolve(dir, s.name);
                return s.isDirectory() ? getFiles(p) : p;
            }));
            return Array.prototype.concat(...childFiles);
        };

        const files = await getFiles(root);
        await Promise.all(files.map(async (f) => {
            const rel = path.relative(root, f);
            const content = await fs.readFile(f);
            await supabase.storage.from('course-assets').upload(`${dbId}/${rel}`, content, { upsert: true });
        }));

        let courseData = { screens: [] };
        const dataJsonPath = path.join(root, 'data.json');
        if (await fs.pathExists(dataJsonPath)) courseData = await fs.readJson(dataJsonPath);

        const HARDCODED_ORG_ID = "526d46ee-26ea-4b2f-9026-a579c64cccf2";
        const { error: dbError } = await supabase.from('courses').insert({
            id: dbId,
            org_id: HARDCODED_ORG_ID,
            name: baseName,
            title: baseName,
            data: courseData,
            entry_point: 'index.html',
            published: true
        });

        if (dbError) throw dbError;
        res.json({ success: true, courseId: dbId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        fs.remove(tempDir).catch(() => {});
        fs.remove(localZip).catch(() => {});
    }
});

// Course Data
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
    try {
        const courseId = req.params.id;
        const { data: course } = await supabase.from('courses').select('name, data').eq('id', courseId).single();
        const { data: storageFiles } = await supabase.storage.from('course-assets').list(courseId, { recursive: true, limit: 1000 });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${course.name || 'course'}.zip"`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);
        const exportedFiles = [];

        // 1. data.json
        archive.append(JSON.stringify(course.data, null, 2), { name: 'data.json' });
        exportedFiles.push('data.json');

        // 2. Template Files
        const templateDir = path.join(__dirname, '../scorm-template');
        if (await fs.pathExists(templateDir)) {
            const files = await fs.readdir(templateDir);
            for (const file of files) {
                if (file === 'imsmanifest.xml') continue; 
                const fullPath = path.join(templateDir, file);
                const stat = await fs.stat(fullPath);
                if (stat.isFile()) {
                    archive.file(fullPath, { name: file });
                    exportedFiles.push(file);
                } else if (file === 'assets') {
                    const assetFiles = await fs.readdir(fullPath);
                    for (const f of assetFiles) {
                        archive.file(path.join(fullPath, f), { name: `assets/${f}` });
                        exportedFiles.push(`assets/${f}`);
                    }
                }
            }
        }

        // 3. Storage Files
        const downloadFile = async (file) => {
            if (file.name === '.emptyFolderPlaceholder') return;
            const { data: fileData } = await supabase.storage.from('course-assets').download(`${courseId}/${file.name}`);
            if (fileData) {
                archive.append(Buffer.from(await fileData.arrayBuffer()), { name: file.name });
                exportedFiles.push(file.name);
            }
        };
        for (let i = 0; i < storageFiles.length; i += 10) {
            await Promise.all(storageFiles.slice(i, i + 10).map(downloadFile));
        }

        // 4. Manifest
        const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="Course_${Date.now()}" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2 imsmd_rootv1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
    <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
    <organizations default="ORG_1"><organization identifier="ORG_1"><title>${course.name}</title><item identifier="ITEM_1" identifierref="RES_1"><title>${course.name}</title></item></organization></organizations>
    <resources><resource identifier="RES_1" type="webcontent" adlcp:scormtype="sco" href="index.html">
        ${exportedFiles.map(f => `<file href="${f}"/>`).join('\n        ')}
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
