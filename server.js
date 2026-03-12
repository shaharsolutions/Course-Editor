const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const archiver = require('archiver');
const AdmZip = require('adm-zip');

const app = express();
const PORT = 3030;
const LMS_FILES_DIR = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
fs.ensureDirSync(UPLOADS_DIR);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure storage for audio files
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const { courseId } = req.params;
        const dest = path.join(LMS_FILES_DIR, courseId, 'assets', 'audio');
        fs.ensureDirSync(dest);
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        // We use a safe filename to avoid issues with Cloud Storage (Supabase/S3) 
        // which often fail on Hebrew characters in URLs.
        const ext = path.extname(file.originalname) || '.wav';
        const safeName = `audio_${Date.now()}${ext}`;
        cb(null, safeName);
    }
});
const upload = multer({ storage });

// API: List courses
app.get('/api/courses', async (req, res) => {
    try {
        const files = await fs.readdir(LMS_FILES_DIR);
        const courses = [];
        for (const file of files) {
            const fullPath = path.join(LMS_FILES_DIR, file);
            const stats = await fs.stat(fullPath);
            if (stats.isDirectory() && file !== 'Course Editor') {
                const mainJsPath = path.join(fullPath, 'scripts', 'main.js');
                if (await fs.pathExists(mainJsPath)) {
                    courses.push({ id: file, name: file });
                }
            }
        }
        res.json(courses);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Configure storage for ZIP uploads
const zipUpload = multer({ dest: UPLOADS_DIR });

// API: Upload course ZIP
app.post('/api/courses/upload', zipUpload.single('courseZip'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const zip = new AdmZip(req.file.path);
        
        // Determine folder name from ZIP name
        let folderName = path.parse(req.file.originalname).name.replace(/[^a-z0-9_\-\u0590-\u05FF]/gi, '_');
        let targetPath = path.join(LMS_FILES_DIR, folderName);
        
        // Ensure folder name is unique
        let counter = 1;
        while (await fs.pathExists(targetPath)) {
            targetPath = path.join(LMS_FILES_DIR, `${folderName}_${counter}`);
            counter++;
        }
        
        folderName = path.basename(targetPath);
        
        console.log(`[Server] Extracting course to: ${targetPath}`);
        
        try {
            // Extract directly to target folder
            zip.extractAllTo(targetPath, true);
        } catch (extractErr) {
            console.error('[Server] Extraction error:', extractErr);
            await fs.remove(targetPath); // Cleanup failed folder
            return res.status(500).json({ error: 'Failed to extract ZIP file. It may be corrupted.' });
        }
        
        // Cleanup temp file
        await fs.remove(req.file.path);
        
        // Verify it looks like a course we can handle
        const mainJsPath = path.join(targetPath, 'scripts', 'main.js');
        if (!(await fs.pathExists(mainJsPath))) {
             // Maybe it was wrapped in a subfolder inside the zip?
             const entries = await fs.readdir(targetPath);
             const subdirs = [];
             for(const entry of entries) {
                 if((await fs.stat(path.join(targetPath, entry))).isDirectory()) {
                     subdirs.push(entry);
                 }
             }

             if(subdirs.length === 1) {
                 const subDirPath = path.join(targetPath, subdirs[0]);
                 if(await fs.pathExists(path.join(subDirPath, 'scripts', 'main.js'))) {
                     console.log(`[Server] Detected nested folder structure, flattening...`);
                     const tempMove = path.join(UPLOADS_DIR, `temp_${Date.now()}`);
                     await fs.move(subDirPath, tempMove);
                     await fs.remove(targetPath);
                     await fs.move(tempMove, targetPath);
                 }
             }
        }

        res.json({ success: true, courseId: folderName });
    } catch (err) {
        console.error('[Server] Upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// API: Get course data
app.get('/api/course/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const dataPath = path.join(LMS_FILES_DIR, courseId, 'data.json');
        
        if (await fs.pathExists(dataPath)) {
            const data = await fs.readJson(dataPath);
            res.json(data);
        } else {
            const mainJsPath = path.join(LMS_FILES_DIR, courseId, 'scripts', 'main.js');
            if (await fs.pathExists(mainJsPath)) {
                const mainJs = await fs.readFile(mainJsPath, 'utf8');
                
                // Enhanced regex to find the screens array and try to parse objects
                const match = mainJs.match(/const screens = (\[[\s\S]*?\]);/);
                if (match) {
                    try {
                        let rawContent = match[1];
                        
                        // Heuristic cleaning: Remove function callbacks entirely (onEnter etc)
                        // This handles both arrow functions, traditional functions, and variable references
                        // We also need to be careful with commas.
                        let cleaned = rawContent
                            .replace(/\/\/.*$/gm, '') // Remove single-line comments
                            .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
                            // Remove onEnter: any code up to a comma or closing brace
                            .replace(/onEnter:\s*((\(\)\s*=>\s*[^,}]+)|(function\s*\(\)\s*\{[\s\S]*?\}|[^,}]+))/g, '')
                            // Remove trailing commas before closing braces/brackets
                            .replace(/,\s*([\]}])/g, '$1')
                            // Handle cases where comma was already there and we removed the field
                            .replace(/\{(\s*),/g, '{') 
                            .replace(/,(\s*),/g, ',');

                        // Try to parse using a Function constructor but provide a safe environment
                        // We define it as a variable so the 'return' works correctly.
                        const parsedScreens = new Function(`
                            try {
                                return ${cleaned};
                            } catch(e) {
                                return [];
                            }
                        `)();
                        
                        if (!parsedScreens || parsedScreens.length === 0) {
                            throw new Error('Parsed screens are empty');
                        }

                        // Normalize screens to ensure they have IDs and basic fields
                        const normalized = parsedScreens.map((s, i) => ({
                            id: s.id || `screen-${i + 1}`,
                            title: s.title || '',
                            content: s.content || '',
                            bgImage: s.bgImage || '',
                            audio: s.audio || '',
                            waitForAudio: s.waitForAudio || false,
                            minDelay: s.minDelay || 0,
                            question: s.question || null
                        }));
                        
                        res.json({ screens: normalized, wasLegacy: true });
                    } catch (e) {
                        console.error('Parser error:', e);
                        res.json({ screens: [], legacy: true, raw: match[1] });
                    }
                } else {
                    res.status(404).json({ error: 'Screens not found in main.js' });
                }
            } else {
                res.status(404).json({ error: 'Course files not found' });
            }
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Save course data
app.post('/api/course/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const data = req.body;
        const coursePath = path.join(LMS_FILES_DIR, courseId);
        const dataPath = path.join(coursePath, 'data.json');
        
        console.log(`[Server] Saving course data for: ${courseId}`);
        
        // 1. Save the data.json (UTF-8)
        await fs.writeJson(dataPath, data, { spaces: 4 });
        
        // 2. Forced/Strong Upgrade Check
        const scriptsDir = path.join(coursePath, 'scripts');
        const mainJsPath = path.join(scriptsDir, 'main.js');
        
        if (await fs.pathExists(mainJsPath)) {
            const currentMainJs = await fs.readFile(mainJsPath, 'utf8');
            
            // Check if it's the old version (doesn't have loadCourseData)
            if (!currentMainJs.includes('loadCourseData')) {
                console.log(`[Upgrade] Legacy main.js detected for ${courseId}. Upgrading...`);
                
                const templatePath = path.join(__dirname, 'template-main.js');
                if (await fs.pathExists(templatePath)) {
                    const templateContent = await fs.readFile(templatePath, 'utf8');
                    
                    // Backup old main.js
                    const backupPath = path.join(scriptsDir, `main.js.bak_${Date.now()}`);
                    await fs.copy(mainJsPath, backupPath);
                    console.log(`[Upgrade] Backup created at: ${backupPath}`);
                    
                    // Write new version
                    await fs.writeFile(mainJsPath, templateContent, 'utf8');
                    console.log(`[Upgrade] Success: main.js updated for ${courseId}`);
                } else {
                    console.error(`[Upgrade] Error: template-main.js not found at ${templatePath}`);
                }
            } else {
                console.log(`[Server] main.js for ${courseId} is already modern.`);
            }
        } else {
            // If main.js missing but we are saving, maybe it's in a different spot?
            // Usually it's in scripts/main.js
            console.warn(`[Server] main.js not found at ${mainJsPath} - skipping script upgrade.`);
        }
        
        res.json({ success: true, upgraded: true });
    } catch (err) {
        console.error(`[Server] Error saving course ${req.params.courseId}:`, err);
        res.status(500).json({ error: err.message });
    }
});

// API: Upload audio
app.post('/api/course/:courseId/upload-audio', upload.single('audio'), (req, res) => {
    res.json({ filename: req.file.filename, path: `assets/audio/${req.file.filename}` });
});

// API: Delete Slide
app.delete('/api/course/:courseId/slide/:slideIndex', async (req, res) => {
    try {
        const { courseId, slideIndex } = req.params;
        const dataPath = path.join(LMS_FILES_DIR, courseId, 'data.json');
        
        if (await fs.pathExists(dataPath)) {
            const data = await fs.readJson(dataPath);
            data.screens.splice(parseInt(slideIndex), 1);
            await fs.writeJson(dataPath, data, { spaces: 4 });
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Course data not found. Please save once first.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Export to SCORM (ZIP)
app.get('/api/course/:courseId/export', async (req, res) => {
    try {
        const { courseId } = req.params;
        const coursePath = path.join(LMS_FILES_DIR, courseId);
        const zipName = `${courseId}_updated.zip`;
        const zipPath = path.join(LMS_FILES_DIR, zipName);

        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            res.json({ success: true, downloadUrl: `/exports/${zipName}` });
        });

        archive.on('error', (err) => { throw err; });
        archive.pipe(output);

        // Add the entire course directory to the zip
        // Exclude backup files and temporary data
        archive.glob('**/*', {
            cwd: coursePath,
            ignore: ['**/main.js.bak_*', '**/Thumbs.db', '**/.DS_Store']
        });
        await archive.finalize();

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve exported zips
app.use('/exports', express.static(LMS_FILES_DIR));

app.listen(PORT, () => {
    console.log(`Course Editor Server running at http://localhost:${PORT}`);
});
