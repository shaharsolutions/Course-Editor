const { createClient } = require('./node_modules/@supabase/supabase-js');
const archiver = require('archiver');
const fs = require('fs-extra');
const path = require('path');

const SUPABASE_URL = 'https://iduyexkzivtnvrdsbwig.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkdXlleGt6aXZ0bnZyZHNid2lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NjYwMTYsImV4cCI6MjA4OTA0MjAxNn0.MhqZwvY7RiOBBqgBhRD-e-SqbI7NIf2vWxNuD5_6e48';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const courseId = '0503d9f3-a90f-416e-aaee-6e96a3b03c29';
const outputPath = '/Users/shahar/Desktop/שחר פתרונות דיגיטליים/LMS files/Improve-IT/אבטחת מידע והגנת הפרטיות 2026 _ Improve-IT.zip';

async function listAllFiles(folder) {
    const { data, error } = await supabase.storage.from('course-assets').list(folder);
    if (error) return [];
    let files = [];
    for (const item of data) {
        const fullPath = folder ? `${folder}/${item.name}` : item.name;
        if (!item.metadata) {
            const sub = await listAllFiles(fullPath);
            files = files.concat(sub);
        } else {
            files.push(fullPath);
        }
    }
    return files;
}

async function runExport() {
    console.log('Querying course info...');
    const { data: course, error: fetchError } = await supabase.from('courses').select('title, data').eq('id', courseId).single();
    if (fetchError) throw fetchError;

    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const waitForClose = new Promise((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
    });
    archive.pipe(output);
    const exportedFiles = [];

    console.log('Gathering files recursively...');
    const allFiles = await listAllFiles(courseId);
    console.log('Found full collection:', allFiles.length);

    // Track which files we've already added to avoid duplicates
    const processedFiles = new Set();

    async function addFileToArchive(fullPath) {
        if (processedFiles.has(fullPath)) return;
        processedFiles.add(fullPath);

        let relPath = fullPath;
        // Strip ANY leading UUID/prefix to keep paths clean and matching data.json
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        if (uuidPattern.test(relPath)) {
            relPath = relPath.replace(uuidPattern, '').replace(/^\/+/, '');
        }

        console.log('Downloading & Appending:', relPath);
        const { data: fileData, error: dlError } = await supabase.storage.from('course-assets').download(fullPath);
        
        if (dlError) {
            console.warn(`[WARN] Could not download ${fullPath}:`, dlError.message);
            return;
        }

        if (fileData) {
            const filename = relPath.split('/').pop();
            // Filter junk
            if (filename.startsWith('.') || filename === 'Thumbs.db' || filename === '__MACOSX') return;

            archive.append(Buffer.from(await fileData.arrayBuffer()), { name: relPath });
            exportedFiles.push(relPath);
        }
    }

    // 1. Add files found in the course folder
    for (const full of allFiles) {
        await addFileToArchive(full);
    }

    // 2. Scan course data for ANY other assets that might be referenced but not in the folder
    console.log('Scanning course data for external assets...');
    const dataStr = JSON.stringify(course.data);
    const assetRegex = /(?:course-assets\/)?(?:[a-f0-9-]{36}\/)?(?:[a-zA-Z0-9._-]+\.(?:png|jpg|jpeg|gif|mp3|wav|mp4|webm|ogg))/g;
    const matches = dataStr.match(assetRegex) || [];
    const uniqueMatches = [...new Set(matches)];
    
    for (const match of uniqueMatches) {
        const cleanPath = match.replace(/^course-assets\//, '');
        const filename = cleanPath.split('/').pop();
        const systemAssets = ['maya_guide.png', 'mia_transparent_v4.png', 'bg_welcome.png', 'bg_content.png', 'bg_quiz.png', 'bg_summary.png', 'bg_canvas.png'];
        
        if (!systemAssets.includes(filename) && !processedFiles.has(cleanPath)) {
            console.log(`[Backend] Export: Found referenced asset outside main list: ${cleanPath}`);
            await addFileToArchive(cleanPath);
        }
    }

    let jsonStr = JSON.stringify(course.data, null, 2);
    // Clean up paths: Strip BOTH full Supabase URLs and the UUID prefixes
    const STORAGE_URL_BASE = `${SUPABASE_URL}/storage/v1/object/public/course-assets/`;
    jsonStr = jsonStr.replace(new RegExp(STORAGE_URL_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
    
    jsonStr = jsonStr.replace(/(?:^|["'])([a-f0-9-]{36})\//g, (match, p1) => {
        return match.replace(p1 + '/', '');
    });
    
    archive.append(jsonStr, { name: 'data.json' });
    archive.append(`window.courseData = ${jsonStr};`, { name: 'data.js' });
    exportedFiles.push('data.json', 'data.js');

    const templateDir = path.join(__dirname, 'scorm-template');
    const files = await fs.readdir(templateDir);
    for (const file of files) {
        if (file === 'imsmanifest.xml' || file === 'data.js') continue;
        const fullPath = path.join(templateDir, file);
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
            archive.file(fullPath, { name: file });
            exportedFiles.push(file);
        } else if (stat.isDirectory() && file === 'assets') {
            archive.directory(fullPath, 'assets');
            const assetFiles = await fs.readdir(fullPath);
            assetFiles.forEach(f => exportedFiles.push('assets/' + f));
        }
    }

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
    await waitForClose;
    console.log('Fixed export saved to:', outputPath);
}

runExport().catch(console.error);
