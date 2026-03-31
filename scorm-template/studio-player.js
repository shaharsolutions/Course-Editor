(function() {
    let screens = [];
    let splashData = null;
    let currentIndex = 0;
    let score = 0;
    let answeredCount = 0;
    let slideTimers = {};
    let slideStartTime = Date.now();
    let currentAudio = null;
    let selectedIndex = -1;
    let isSubmitted = false;
    let questionStates = {}; // Persistent answers: { slideId: { selectedIndex, isSubmitted } }

    console.log('[StudioPlayer] Initialization started');

    let currentNarrationAudio = null;

    function stopAllAudio() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio = null;
        }
        if (currentNarrationAudio) {
            currentNarrationAudio.pause();
            currentNarrationAudio.currentTime = 0;
            currentNarrationAudio = null;
        }
    }

    function playNarration(audioPath, behavior = 'interrupt') {
        if (!audioPath) return;
        const url = resolveAssetPath(audioPath);
        
        const startNow = () => {
            if (currentNarrationAudio) {
                currentNarrationAudio.pause();
                currentNarrationAudio.currentTime = 0;
                currentNarrationAudio = null;
            }
            const na = new Audio(url);
            currentNarrationAudio = na;
            na.play().catch(e => {
                console.warn('[Narration] Play blocked:', e);
                const resume = () => {
                    na.play().catch(() => {});
                    document.removeEventListener('mousedown', resume);
                    document.removeEventListener('keydown', resume);
                };
                document.addEventListener('mousedown', resume);
                document.addEventListener('keydown', resume);
            });
        };

        if (behavior === 'wait' && currentAudio && !currentAudio.paused && !currentAudio.ended) {
            console.log('[Narration] Waiting for slide audio to finish...');
            currentAudio.addEventListener('ended', startNow, { once: true });
        } else {
            if (behavior === 'interrupt' && currentAudio && !currentAudio.paused) {
                console.log('[Narration] Interrupting slide audio...');
                currentAudio.pause();
                // We don't necessarily reset slide audio time, just pause it.
            }
            startNow();
        }
    }

    let typeTimer = null;
    function typeEffect(element, text, speed = 20, onComplete = null) {
        if (typeTimer) clearInterval(typeTimer);
        element.innerHTML = '';
        let i = 0;
        // Strip HTML for the typing effect but keep structure if needed
        // For now, we'll just treat it as text and allow simple <br> if we handle it
        typeTimer = setInterval(() => {
            if (i < text.length) {
                element.innerHTML += text.charAt(i);
                i++;
                element.scrollTop = element.scrollHeight;
            } else {
                clearInterval(typeTimer);
                typeTimer = null;
                if (onComplete) onComplete();
            }
        }, speed);
    }

    function fitPlayer() {
        const container = document.getElementById('player-container');
        if (!container) return;
        
        const windowW = window.innerWidth;
        const windowH = window.innerHeight;
        const targetW = 1280;
        const targetH = 720;
        const ratio = targetW / targetH;
        const screenRatio = windowW / windowH;

        let finalW, finalH;
        if (screenRatio > ratio) {
            finalH = Math.min(windowH, targetH);
            finalW = finalH * ratio;
        } else {
            finalW = Math.min(windowW, targetW);
            finalH = finalW / ratio;
        }

        container.style.width = Math.floor(finalW) + 'px';
        container.style.height = Math.floor(finalH) + 'px';
    }

    window.addEventListener('resize', fitPlayer);
    window.addEventListener('orientationchange', () => setTimeout(fitPlayer, 200));

    // Ensure SCORM session is finished on close/refresh
    window.addEventListener('beforeunload', () => {
        if (window.SCORM && SCORM.connected) {
            SCORM.finish();
        }
    });

    function hexToRgba(hex, alpha = 1) {
        if (!hex || !hex.startsWith('#')) return `rgba(56, 189, 248, ${alpha})`;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * Centralized path resolution for all assets (images, audio, logos).
     * Strips GUID prefixes and ensures relative paths are correctly mapped.
     */
    function resolveAssetPath(path) {
        if (!path || path.startsWith('http') || path.startsWith('blob:') || path.startsWith('data:')) return path;
        
        let clean = path;

        // --- NEW: Aggressive Prefix Cleaning ---
        // Strip Supabase bucket name if present (e.g. 'course-assets/')
        if (clean.startsWith('course-assets/')) clean = clean.substring(14);

        // Strip leading GUID/ UUID prefix if present (36 characters + slash)
        // This handles cases like '0503d9f3-.../logos/logo.png' -> 'logos/logo.png'
        if (clean.includes('/')) {
            const parts = clean.split('/');
            // Pattern for UUID: 8-4-4-4-12 hex chars
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidPattern.test(parts[0])) {
                clean = parts.slice(1).join('/');
            }
        }
        
        // --- Preview Mode Logic ---
        const previewCourseId = sessionStorage.getItem('previewCourseId');
        const systemAssets = ['maya_guide.png', 'mia_transparent_v4.png', 'bg_welcome.png', 'bg_content.png', 'bg_quiz.png', 'bg_summary.png', 'bg_canvas.png'];
        const filename = clean.split('/').pop();
        
        const legacyMap = {
            'new_scene_welcome.png': 'bg_welcome.png',
            'scene_welcome.png': 'bg_welcome.png',
            'new_scene_explanation.png': 'bg_content.png',
            'scene_content.png': 'bg_content.png',
            'new_scene_quiz.png': 'bg_quiz.png',
            'scene_quiz.png': 'bg_quiz.png',
            'new_scene_question.png': 'bg_quiz.png',
            'new_scene_summary.png': 'bg_summary.png',
            'new_scene_congrats.png': 'bg_summary.png'
        };
        const cleanName = legacyMap[filename] || filename;

        if (previewCourseId && !systemAssets.includes(cleanName)) {
            const SUPABASE_URL = 'https://iduyexkzivtnvrdsbwig.supabase.co';
            // In preview, we always go back to the source storage
            return `${SUPABASE_URL}/storage/v1/object/public/course-assets/${previewCourseId}/${clean.replace(/^\/+/, '')}`;
        }
        
        // Published mode
        if (systemAssets.includes(cleanName)) {
            return 'assets/' + cleanName;
        }
        
        // Ensure no leading slash and normalize slashes
        const relPath = clean.replace(/^\/+/, '').replace(/\/+/g, '/');
        
        console.log(`[StudioPlayer] Resolved asset path: ${path} -> ${relPath}`);
        return relPath;
    }

    const initPlayer = async () => {
        const playerContainer = document.getElementById('player-container');
        const contentArea = document.getElementById('content-area');
        const progressBar = document.getElementById('progress-bar');
        const nextBtn = document.getElementById('next-btn');
        const prevBtn = document.getElementById('prev-btn');

        // Initial Loading View
        contentArea.innerHTML = `
            <div style="text-align:center; padding:50px;" class="animate-in">
                <div class="loader-pulse" style="margin: 0 auto;"></div>
                <p style="margin-top:20px; color:#94a3b8;" class="cyber-glitch">מסדרים לך את מרחב הלמידה...</p>
            </div>`;

        // SCORM Init
        try {
            if (window.SCORM) {
                SCORM.init();
            }
        } catch (e) {
            console.warn('[StudioPlayer] SCORM error:', e);
        }

        // Global helper for flip cards
    window.toggleCard = (el, audioPath, behavior = 'interrupt') => {
        el.classList.toggle('flipped');
        if (el.classList.contains('flipped')) {
            el.classList.add('was-flipped');
            // Signal that an activity occurred (like flipping a card)
            if (window.onSlideActivity) window.onSlideActivity();

            if (audioPath) {
                playNarration(audioPath, behavior);
            }
        }
    };

        // Global helpers
window.foundFlags = new Set();
window.totalFlags = 0;

window.handleFlagClick = (el, id) => {
    if (window.foundFlags.has(id)) return;
    window.foundFlags.add(id);
    el.classList.add('found');
    
    const msgs = {
        'sender': '<strong>שיחקת אותה! זיהית שכתובת השולח מזויפת.</strong><br>שימו לב לכתובת המייל (paypa1 במקום paypal). נוכלים משתמשים המון באותיות דומות כדי לעבוד עלינו במבט ראשון.',
        'greeting': '<strong>חשד בריא! פנייה כללית היא נורת אזהרה קלאסית.</strong><br>גופים רשמיים שמכירים אתכם תמיד יפנו אליכם בשמכם המלא, ולא בכינוי גנרי כמו "לקוח יקר".',
        'link': '<strong>בול! הכפתור הזה הוא מלכודת.</strong><br>הוא נראה רשמי, אבל תמיד כדאי לרחף עם העכבר מעל לינקים כדי לראות לאן הם באמת מובילים.'
    };
    
    const feedbackArea = document.getElementById('phishing-feedback-area');
    if (feedbackArea) {
        feedbackArea.classList.remove('animate-in');
        void feedbackArea.offsetWidth; // trigger reflow
        feedbackArea.classList.add('animate-in');
        
        feedbackArea.innerHTML = `
            <div class="animate-in" style="background: rgba(15, 23, 42, 0.9); border-right: 4px solid #ef4444; padding: 10px 14px; border-radius: 10px; color: #f8fafc; box-shadow: 0 4px 15px rgba(0,0,0,0.3); margin-bottom: 8px;">
                <i class="fas fa-exclamation-triangle" style="color: #f87171; float: right; margin-left: 12px; font-size: 1.1rem; margin-top: 2px;"></i>
                <div style="margin-right: 32px; line-height: 1.4; font-size: 0.9rem;">${msgs[id] || 'זיהית סימן מחשיד'}</div>
            </div>
        `;
    }
    
    updatePhishingCounter(msgs[id]);
};

window.updatePhishingCounter = (lastFeedbackHtml) => {
    const counter = document.getElementById('phishing-counter-text');
    if (counter) {
        counter.innerHTML = `<span style="font-size: 1.5rem; color: #ef4444; margin-left: 5px;">${window.foundFlags.size}</span> מתוך ${window.totalFlags}`;
    }
    
    const feedbackArea = document.getElementById('phishing-feedback-area');
    if (!feedbackArea) return;

    // Hint Logic
    let clueHtml = '';
    if (window.foundFlags.size === 2 && window.foundFlags.has('sender') && window.foundFlags.has('greeting')) {
        clueHtml = `
            <div class="animate-in" style="background: rgba(56,189,248,0.15); border-right: 4px solid #38bdf8; padding: 10px 14px; border-radius: 10px; color: #e0f2fe; margin-top: 8px; font-size: 0.9rem; display: flex; align-items: center; gap: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                <i class="fas fa-arrow-down-long" style="color: #38bdf8; font-size: 1.3rem; animation: bounceY 1s infinite;"></i>
                <span>נראה שיש פה עוד משהו... <strong>בואו נגלול קצת מטה</strong> להמשך המייל.</span>
            </div>
        `;
    }

    // Unlock if all found
    const reportBtn = document.getElementById('report-simulation-btn');
    if (window.foundFlags.size >= window.totalFlags) {
        if (reportBtn) {
            reportBtn.classList.remove('locked');
            reportBtn.style.opacity = '1';
            reportBtn.style.pointerEvents = 'auto';
            reportBtn.style.animation = 'pulseRed 1.5s infinite';
            const icon = reportBtn.querySelector('i');
            if(icon) icon.className = 'fas fa-shield-check';
            reportBtn.innerHTML = '<i class="fas fa-shield-alt" style="margin-left: 6px;"></i> דווח למערכת';
        }
        
        if (lastFeedbackHtml) {
            feedbackArea.innerHTML = `
                <div class="animate-in" style="background: rgba(15, 23, 42, 0.9); border-right: 4px solid #ef4444; padding: 10px 14px; border-radius: 10px; color: #f8fafc; box-shadow: 0 4px 15px rgba(0,0,0,0.3); margin-bottom: 10px;">
                    <i class="fas fa-exclamation-triangle" style="color: #f87171; float: right; margin-left: 12px; font-size: 1.1rem; margin-top: 2px;"></i>
                    <div style="margin-right: 32px; line-height: 1.4; font-size: 0.9rem;">${lastFeedbackHtml}</div>
                </div>
                <div class="animate-in delay-1" style="background: rgba(34,197,94,0.15); border-right: 4px solid #22c55e; padding: 10px 14px; border-radius: 10px; color: #f8fafc; box-shadow: 0 4px 15px rgba(0,0,0,0.2); border: 1px dashed #22c55e; margin-bottom: 10px;">
                    <i class="fas fa-check-circle" style="color: #4ade80; float: right; margin-left: 12px; font-size: 1.1rem; margin-top: 2px;"></i>
                    <div style="margin-right: 32px; line-height: 1.4; font-size: 0.9rem;"><strong>כל הכבוד!</strong> מצאת את הכל.</div>
                </div>
                <div class="animate-in delay-2" style="background: rgba(15, 23, 42, 0.8); border-right: 4px solid #22c55e; padding: 10px 14px; border-radius: 10px; color: #f8fafc; margin-top: 8px; font-size: 0.95rem; display: flex; align-items: center; gap: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                    <i class="fas fa-arrow-up-long" style="color: #4ade80; font-size: 1.3rem; animation: bounceYRev 1s infinite;"></i>
                    <span>עכשיו רק נשאר <strong>לגלול חזרה למעלה</strong> ולדווח.</span>
                </div>
            `;
        }
    } else if (clueHtml) {
        // Just add the clue if we have it and haven't finished
        feedbackArea.innerHTML += clueHtml;
    }
};

window.finishPhishing = () => {
    showToast("כל הכבוד!", "זיהית בהצלחה את כל סימני האזהרה במייל! זכרו: תמיד כדאי לוודא מי השולח ולאן הלינקים מובילים לפני שלוחצים.", () => {
        nextSlide();
    });
};

        function nextSlide() {
            if (currentIndex < screens.length - 1) {
                renderSlide(currentIndex + 1);
            } else {
                finishCourse();
            }
        }

        async function loadData() {
            try {
                // Priority 0: Check if we have data injected via session storage from the editor (Live Preview)
                const previewData = sessionStorage.getItem('previewCourseData');
                if (previewData) {
                    try {
                        const parsed = JSON.parse(previewData);
                        screens = parsed.screens || [];
                        splashData = parsed.splash || null;
                        console.log(`[StudioPlayer] Success: Loaded ${screens.length} screens from session storage (Preview Mode)`);
                        return true;
                    } catch (e) {
                        console.warn('[StudioPlayer] Failed to parse preview data from session storage:', e);
                    }
                }

                // Priority 1: Check if data was loaded via script tag (data.js) - works offline/local
                if (window.courseData) {
                    screens = window.courseData.screens || [];
                    splashData = window.courseData.splash || null;
                    console.log(`[StudioPlayer] Success: Loaded ${screens.length} screens from global variable`);
                    return true;
                }

                // Priority 2: Fallback to fetch (works via http/server)
                const pathVariants = ['data.json', './data.json'];
                let data = null;
                
                for (const p of pathVariants) {
                    try {
                        const res = await fetch(p + '?v=' + Date.now());
                        if (res.ok) {
                            data = await res.json();
                            break;
                        }
                    } catch (e) { continue; }
                }

                if (!data) throw new Error('Could not find data.json and no global courseData found');
                
                screens = data.screens || [];
                splashData = data.splash || null;
                console.log(`[StudioPlayer] Success: Loaded ${screens.length} screens via fetch`);
                return true;
            } catch (e) {
                console.error("[StudioPlayer] Data load failed:", e);
                contentArea.innerHTML = `
                    <div style="color:#ef4444; padding:40px; text-align:center; background:rgba(239,68,68,0.1); border:1px solid #ef4444; border-radius:15px;">
                        <h3>שגיאה בטעינת הקורס</h3>
                        <p>לא ניתן היה למצוא את קובץ הנתונים (data.json).</p>
                        <code style="display:block; margin-top:10px; font-size:0.8rem;">${e.message}</code>
                    </div>`;
                return false;
            }
        }

        function updateNav() {
            const screen = (currentIndex === -1) ? splashData : screens[currentIndex];
            const isQ = !!(screen && screen.question);
            const isSplash = (currentIndex === -1);

            // Per User Request: If submitted (already answered), 
            // the Check Answer button should NEVER show. Next/Prev are allowed.
            if (isSubmitted && isQ) {
                prevBtn.style.display = (currentIndex > 0) ? 'flex' : 'none';
                nextBtn.style.display = 'flex';
                nextBtn.innerHTML = (currentIndex === screens.length - 1) ? 'סיום ויציאה' : 'המשך <i class="fas fa-chevron-left" style="margin-right:8px;"></i>';
                nextBtn.onclick = nextSlide;
                return;
            }

            // Normal Navigation Logic
            prevBtn.style.display = (currentIndex > 0 && !isSplash) ? 'flex' : 'none';
            
            if (isSplash) {
                nextBtn.innerHTML = 'התחל למידה <i class="fas fa-play" style="margin-right:8px;"></i>';
                nextBtn.onclick = () => {
                    if (currentIndex === -1) renderSlide(0);
                    else nextSlide();
                };
            } else if (isQ) {
                nextBtn.innerHTML = 'בדוק תשובה <i class="fas fa-check" style="margin-right:8px;"></i>';
                nextBtn.onclick = checkAnswer;
            } else {
                if (currentIndex === screens.length - 1) {
                    nextBtn.innerHTML = 'סיום ויציאה <i class="fas fa-flag-checkered" style="margin-right:8px;"></i>';
                    nextBtn.onclick = finishCourse;
                } else {
                    nextBtn.innerHTML = 'המשך <i class="fas fa-chevron-left" style="margin-right:8px;"></i>';
                    nextBtn.onclick = nextSlide;
                }
            }
        }

        async function preloadMedia() {
            const status = document.getElementById('loading-status');
            const assets = [];
            
            const updateStatus = (msg) => {
                if (status) status.innerText = msg;
            };

            const loadImg = (url) => new Promise((res) => {
                if (!url) return res();
                const timeout = setTimeout(() => {
                    console.warn('[StudioPlayer] Image load timeout:', url);
                    res();
                }, 5000);
                const img = new Image();
                img.onload = img.onerror = () => {
                    clearTimeout(timeout);
                    res();
                };
                img.src = url;
            });

            const loadAudio = (url) => new Promise((res) => {
                if (!url) return res();
                // Most mobile browsers block audio preloading. 
                // We'll set a short timeout and also listen for initial load events.
                const timeout = setTimeout(() => {
                    console.warn('[StudioPlayer] Audio load timeout (expected on mobile):', url);
                    res();
                }, 2000);
                
                const audio = new Audio();
                // On mobile, 'onloadstart' or 'onloadedmetadata' might fire, 
                // but 'oncanplaythrough' often won't until user gesture.
                audio.onloadedmetadata = audio.onloadstart = audio.onerror = () => {
                    clearTimeout(timeout);
                    res();
                };
                audio.src = url;
                audio.load(); // Explicitly trigger load
            });

            updateStatus('נערכים עם הגרפיקה והסאונד...');
            
            screens.forEach(s => {
                if (s.bgImage) assets.push(loadImg(resolveAssetPath(s.bgImage)));
                if (s.audio) assets.push(loadAudio(resolveAssetPath(s.audio)));
                if (s.logo) assets.push(loadImg(resolveAssetPath(s.logo)));
            });
            assets.push(loadImg(resolveAssetPath('maya_guide.png')));

            // Split into batches to avoid overloading, but don't let it block forever
            const batchSize = 10;
            const total = assets.length;
            for (let i = 0; i < assets.length; i += batchSize) {
                const batch = assets.slice(i, i + batchSize);
                try {
                    await Promise.all(batch);
                } catch (e) {
                    console.warn('[StudioPlayer] Batch load error:', e);
                }
                updateStatus(`מסדרים את כל הדברים היפים (${Math.round((Math.min(i + batchSize, total) / total) * 100)}%)...`);
            }
            
            updateStatus('אנחנו מוכנים!');
            await new Promise(r => setTimeout(r, 500));
        }

        function renderSlide(index) {
            stopAllAudio();
            
            // Handle Splash Screen (index -1)
            let screen;
            if (index === -1 && splashData) {
                screen = splashData;
            } else {
                screen = screens[index];
            }
            
            if (!screen) return;
            
            // Remove special modes by default
            contentArea.classList.remove('splash-mode');
            contentArea.classList.remove('phishing-mode');
            if (screen.type === 'phishing-test') {
                contentArea.classList.add('phishing-mode');
            }
            
            // Apply per-slide transparency
            const transparency = (screen.styles && screen.styles.transparency !== undefined) ? screen.styles.transparency : 90;
            contentArea.style.setProperty('background', `rgba(15, 23, 42, ${transparency / 100})`, 'important');

            // Track time
            const now = Date.now();
            if (screens[currentIndex]) {
                const diff = Math.round((now - slideStartTime) / 1000);
                const pid = screens[currentIndex].id || `s${currentIndex}`;
                slideTimers[pid] = (slideTimers[pid] || 0) + diff;
            }
            
            currentIndex = index;
            slideStartTime = now;
            const slideId = (index === -1) ? 'splash' : (screen.id || `s${index}`);
            
            // Restore persistent state for this slide
            const qState = questionStates[slideId];
            if (qState) {
                selectedIndex = qState.selectedIndex;
                isSubmitted = qState.isSubmitted;
            } else {
                selectedIndex = -1;
                isSubmitted = false;
            }

            // --- Aggressive Reset & Early Locking ---
            // We disable the button immediately if there's any reason it might need to be locked.
            // This prevents it from being enabled for even a single frame during re-render.
            const hasRequirement = (screen.minDelay > 0 || screen.waitForAudio || screen.cards || screen.type === 'phishing-test');
            if (hasRequirement && !isSubmitted && !screen.question) {
                nextBtn.disabled = true;
                nextBtn.style.opacity = '0.5';
                nextBtn.style.pointerEvents = 'none';
            } else {
                nextBtn.disabled = false;
                nextBtn.style.opacity = '1';
                nextBtn.style.pointerEvents = 'auto';
            }

            // UI
            // Update UI - Background
            const lowerTitle = (screen.title || '').toLowerCase();
            const lowerContent = (screen.content || '').toLowerCase();
            const isQ = screen.question || screen.type === 'phishing-test' || 
                        lowerTitle.includes('בוחן') || lowerTitle.includes('בדק') || 
                        lowerTitle.includes('בדוק') || lowerTitle.includes('בדיק') ||
                        lowerTitle.includes('שאלה') || lowerTitle.includes('מבחן') || 
                        lowerTitle.includes('תרגיל') || lowerTitle.includes('תרגול') || 
                        lowerTitle.includes('משימה') || lowerContent.includes('שאלות') || 
                        lowerContent.includes('סיכום');

            const overlay = playerContainer.querySelector('.overlay');
            const bgUrlRaw = (screen.bgImage && screen.bgImage !== 'none' && screen.bgImage !== '') ? resolveAssetPath(screen.bgImage) : null;
            
            let bgUrl = bgUrlRaw;
            let isFallback = false;
            if (!bgUrl) {
                isFallback = true;
                let fallbackBg = 'bg_content.png';
                if (index === -1 || index === 0) fallbackBg = 'bg_welcome.png';
                else if (isQ) fallbackBg = 'bg_quiz.png';
                else if (index === (screens.length - 1)) fallbackBg = 'bg_summary.png';
                bgUrl = resolveAssetPath(fallbackBg);
            }

            // Dual application for maximum reliability
            const bgStyle = `url("${bgUrl}")`;
            if (overlay) {
                overlay.style.backgroundImage = bgStyle;
                console.log(`[StudioPlayer] Setting background ${isFallback ? '(fallback)' : ''} to: ${bgUrl} (overlay: ${overlay !== null})`);
            }
            playerContainer.style.backgroundImage = bgStyle;
            playerContainer.style.backgroundSize = 'cover';
            playerContainer.style.backgroundPosition = 'center';
            playerContainer.style.backgroundRepeat = 'no-repeat';

            // Ensure Splash mode is applied correctly
            if (index === -1) {
                contentArea.classList.add('splash-mode');
            } else {
                contentArea.classList.remove('splash-mode');
            }

            // Diagnostic check for background
            const currentBg = playerContainer.style.backgroundImage;
            if (currentBg && currentBg !== 'none') {
                const urlMatch = currentBg.match(/url\("?(.+?)"?\)/);
                if (urlMatch) {
                    const testImg = new Image();
                    testImg.onerror = () => console.warn(`[StudioPlayer] Background IMAGE NOT FOUND: ${urlMatch[1]}`);
                    testImg.src = urlMatch[1];
                }
            }

            // Character
            const combined = ((screen.title || '') + (screen.content || '')).toLowerCase();
            const isInfoSec = combined.includes('אבטחה') || combined.includes('מידע') || combined.includes('סיסמה') || 
                              combined.includes('סייבר') || combined.includes('פרטיות') || combined.includes('תקיפה') ||
                              combined.includes('הגנה');
            
            const isHarassment = combined.includes('הטרדה') || combined.includes('מינית');
            let charImg = 'maya_guide.png';
            const charLabel = 'מיה - הממונה על אבטחת מידע';
            const ci = document.getElementById('player-char-img');
            const cl = document.getElementById('player-char-label');
            const cSection = document.getElementById('character-section');
            if (ci) {
                ci.src = resolveAssetPath(charImg);
                console.log(`[StudioPlayer] Setting character: ${charLabel} (asset: ${charImg})`);
            }
            if (cl) cl.textContent = charLabel;

            // Ensure character section is visible (SplashScreen hides it)
            if (cSection) {
                cSection.style.display = (index === -1) ? 'none' : 'flex';
            }

            // Main Content
            let html = '';
            if (index === -1) {
                const splashLogo = resolveAssetPath(screen.logo || '');
                const logoColorHex = screen.logoBgColor || '#38bdf8';
                const logoAlpha = (screen.logoBgTransparency !== undefined ? screen.logoBgTransparency : 100) / 100;
                const logoColor = hexToRgba(logoColorHex, logoAlpha);
                const sz = screen.logoSize || 150;
                const logoHtml = splashLogo ? `
                    <div class="logo-placeholder" style="background: ${logoColor}; border: ${4 * logoAlpha}px solid rgba(255,255,255,${0.2 * logoAlpha}); border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 0 ${30 * logoAlpha}px rgba(0,0,0,${0.3 * logoAlpha}); margin: 0 auto 20px; width: ${sz}px; height: ${sz}px;">
                        <img src="${encodeURI(splashLogo)}" style="max-width: 80%; max-height: 80%; object-fit: contain;">
                    </div>
                ` : `
                    <div class="logo-placeholder" style="background: ${logoColor}; border: ${4 * logoAlpha}px solid rgba(255,255,255,${0.2 * logoAlpha}); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 ${30 * logoAlpha}px rgba(0,0,0,${0.3 * logoAlpha}); margin: 0 auto 20px; width: ${sz}px; height: ${sz}px;">
                        <i class="fas fa-shield-halved" style="font-size: ${sz/4}px; color: white;"></i>
                    </div>
                `;
                const title = screen.title || "ברוכים הבאים";
                html = `
                    <div class="splash-view animate-in" style="text-align: center;">
                        ${logoHtml}
                        <h1 class="cyber-glitch" style="color: ${logoColor}; font-size: 2.5rem; margin-top: 20px; text-shadow: 0 0 15px rgba(56, 189, 248, 0.3);">${title}</h1>
                    </div>
                `;
            } else {
                html = screen.title ? `<h1 class="cyber-glitch animate-in">${screen.title}</h1>` : '';
            }
            if (screen.question) {
                if (screen.question.text) {
                    html += `<p class="question-text animate-in delay-1">${screen.question.text}</p>`;
                }
                html += `<div class="options-list" style="margin-top:25px; ${isSubmitted ? 'pointer-events: none;' : ''}">
                    ${(screen.question.options || []).map((opt, i) => {
                        let cls = 'option animate-in';
                        cls += ` delay-${Math.min(i + 2, 4)}`;
                        
                        if (isSubmitted) {
                            const correctIdx = (screen.question.options || []).findIndex(o => o.correct);
                            if (i === correctIdx) cls += ' correct';
                            else if (i === selectedIndex) cls += ' incorrect';
                        } else if (i === selectedIndex) {
                            cls += ' selected';
                        }
                        return `<div class="${cls}" data-idx="${i}">${opt.text || ''}</div>`;
                    }).join('')}
                </div>`;
            } else if (screen.type === 'phishing-test') {
                window.foundFlags = new Set();
                window.totalFlags = 3;
                html += `
                    <div class="phishing-container animate-in delay-2" style="text-align: right; direction: rtl; width: 100%; margin: 0 auto; display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
                        <div style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px;">
                            <p style="margin: 0; font-size: 1.15rem; font-weight: 600; color: #e2e8f0; line-height: 1.4;">${screen.content || 'זהה את כל נורות האזהרה באימייל הבא:'}</p>
                            <div class="phishing-counter" style="align-self: flex-start; margin: 0; padding: 6px 16px; background: rgba(56, 189, 248, 0.1); border: 1px solid #38bdf8; border-radius: 20px; color: #38bdf8; font-size: 0.95rem; white-space: nowrap;">
                                מצא תקלות אבטחה: <strong id="phishing-counter-text" style="color: white; margin-right: 5px;">0 מתוך ${window.totalFlags}</strong>
                            </div>
                        </div>
                        
                        <!-- Visual Feedback Area - compact and potentially absolute or semi-absolute -->
                        <div id="phishing-feedback-area" style="max-height: 35%; overflow-y: auto; margin-bottom: 8px; flex-shrink: 0;"></div>
                        
                        <div class="email-mockup delay-3" style="font-size: 0.85rem; overflow-y: auto; color: #1e293b; background: #ffffff; flex: 1; min-height: 0; border: 1px solid #d1d5db; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border-radius: 10px; display: flex; flex-direction: column;">
                            <div class="email-os-header" style="flex-shrink: 0; padding: 8px 15px;">
                                <div>דואר נכנס - Outlook</div>
                                <div class="email-os-controls">
                                    <div class="os-min"></div>
                                    <div class="os-max"></div>
                                    <div class="os-close"></div>
                                </div>
                            </div>
                            
                            <!-- Email Toolbar -->
                            <div style="background: #f1f5f9; border-bottom: 1px solid #e2e8f0; padding: 8px 15px; display: flex; gap: 15px; align-items: center; justify-content: space-between;">
                                <div style="display: flex; gap: 15px;">
                                    <div style="color: #64748b; cursor: not-allowed; opacity: 0.6;"><i class="fas fa-reply" style="margin-left: 5px;"></i>השב</div>
                                    <div style="color: #64748b; cursor: not-allowed; opacity: 0.6;"><i class="fas fa-reply-all" style="margin-left: 5px;"></i>השב לכולם</div>
                                    <div style="color: #64748b; cursor: not-allowed; opacity: 0.6;"><i class="fas fa-share" style="margin-left: 5px;"></i>העבר</div>
                                    <div style="color: #64748b; cursor: not-allowed; opacity: 0.6;"><i class="fas fa-trash" style="margin-left: 5px;"></i>מחק</div>
                                </div>
                                <button id="report-simulation-btn" class="btn-report locked" onclick="window.finishPhishing()" style="background: #ef4444; color: white; padding: 6px 15px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-family: Assistant; opacity: 0.5; pointer-events: none; transition: all 0.3s; box-shadow: 0 4px 10px rgba(239,68,68,0.3); font-size: 0.85rem;">
                                    <i class="fas fa-exclamation-triangle" style="margin-left: 5px;"></i>דווח פישינג
                                </button>
                            </div>
                            
                            <div class="email-header" style="flex-shrink: 0; background: #ffffff; padding: 15px 20px;">
                                <div class="email-header-row" style="margin-bottom: 8px;">
                                    <div class="email-header-label" style="width: 50px;">מאת:</div>
                                    <div class="sender-pill" style="padding: 2px 10px 2px 12px;">
                                        <div class="sender-icon" style="width: 20px; height: 20px; font-size: 0.6rem;"><i class="fas fa-user"></i></div>
                                        <span style="font-size: 0.9rem;">שירות לקוחות</span>
                                        <span class="phishing-flag text-flag" title="http://paypa1-security-check.com/" onclick="window.handleFlagClick(this, 'sender')" style="margin-right: 6px; color: #2563eb; direction: ltr; padding-right: 6px; font-size: 0.9rem;">&lt;service@paypa1.co.il&gt;</span>
                                    </div>
                                </div>
                                <div class="email-header-row" style="font-size: 0.85rem; margin-bottom: 8px;">
                                    <div class="email-header-label" style="width: 50px;">אל:</div>
                                    <div style="direction: ltr;">user@company.co.il</div>
                                </div>
                                <div style="display: flex; align-items: center; font-size: 0.9rem;">
                                    <div class="email-header-label" style="width: 50px;">נושא:</div>
                                    <div style="font-weight: 700; font-size: 1rem; flex-grow: 1;">דחוף: פעילות חריגה בחשבונך</div>
                                    <div style="color: #9ca3af; font-size: 0.8rem;">היום, 09:14</div>
                                </div>
                            </div>
                            <div class="email-body" style="padding: 12px 20px; line-height: 1.5; color: #000000; pointer-events: auto;">
                                <p style="margin-bottom: 12px; color: #000000;">שלום <span class="phishing-flag text-flag" onclick="window.handleFlagClick(this, 'greeting')" style="padding: 2px 4px; border-radius: 4px;">לקוח יקר</span>,</p>
                                <p style="margin-bottom: 12px; color: #000000;">זיהינו פעילות חריגה בחשבון שלך ממכשיר לא מזוהה. מטעמי אבטחה, החשבון שלך הוגבל באופן זמני.</p>
                                <p style="margin-bottom: 18px; color: #000000;">אנא הקלק על הקישור הבא לאימות זהותך. יש לבצע את הפעולה תוך 24 שעות, אחרת חשבונך יינעל לצמיתות:</p>
                                
                                <div style="text-align: center; margin: 20px 0; position: relative;" title="http://paypa1-security-check.com/login-action.php">
                                    <span class="phishing-flag phishing-action-btn" onclick="window.handleFlagClick(this, 'link')" style="box-shadow: 0 4px 6px rgba(0,0,0,0.1); font-size: 0.95rem; padding: 10px 25px; display: inline-block;">התחברות לאימות מהיר</span>
                                </div>
                                
                                <p style="margin-bottom: 3px; color: #000000;">בברכה,</p>
                                <p style="color: #6b7280; font-size: 0.85rem; margin-bottom: 0;">צוות התמיכה והאבטחה</p>
                            </div>
                        </div>
                    </div>
                `;
            } else if (screen.content || screen.cards || screen.alerts) {
                if (screen.content) {
                    html += `<div class="content-text animate-in delay-1" id="typing-content"></div>`;
                }
                
                if (screen.alerts) {
                    html += `<div class="alerts-container">
                        ${(screen.alerts || []).map((alert, i) => {
                            const isWaiting = alert.waitForTyping;
                            const animClass = alert.animation ? `anim-${alert.animation}` : `animate-in delay-${Math.min(i+2, 4)}`;
                            const classes = `alert-box ${alert.type || 'info'} ${isWaiting ? 'waiting-for-typing' : animClass}`;
                            const dataAnim = isWaiting ? `data-anim="${animClass}"` : '';
                            const dataAudio = (isWaiting && alert.audio) ? `data-audio="${alert.audio}" data-audio-behavior="${alert.audioBehavior || 'interrupt'}"` : '';
                            const customDelay = alert.delay !== undefined ? `animation-delay: ${alert.delay}s;` : '';
                            return `
                                <div class="${classes}" ${dataAnim} ${dataAudio} style="${customDelay}">
                                    <i class="${alert.icon || 'fas fa-info-circle'}"></i>
                                    <div class="alert-content">
                                        <h4>${alert.title || ''}</h4>
                                        <p>${alert.text || ''}</p>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>`;
                }

                if (screen.cards) {
                    html += `<div class="info-cards-container">
                        ${(screen.cards || []).map((card, i) => `
                            <div class="info-card animate-in delay-${Math.min(i+2, 4)}" onclick="window.toggleCard(this, '${card.audio || ''}', '${card.audioBehavior || 'interrupt'}')">
                                <div class="card-inner">
                                    <div class="card-front">
                                        <i class="${card.icon || 'fas fa-shield-alt'}"></i>
                                        <h3>${card.title || ''}</h3>
                                    </div>
                                    <div class="card-back">
                                        <p>${card.text || ''}</p>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>`;
                }
            }

            if (screen.id === 'officer_details' && screen.officer) {
                html += `
                    <div class="officer-card animate-in delay-3" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(14, 165, 233, 0.2); border-radius: 20px; padding: 25px; margin-top: 20px;">
                        <div class="officer-info" style="display: flex; flex-direction: column; gap: 12px;">
                            <div class="officer-field" style="font-size: 1.1rem; color: #e2e8f0;"><strong>שם:</strong> <span>${screen.officer.name}</span></div>
                            <div class="officer-field" style="font-size: 1.1rem; color: #e2e8f0;"><strong>תפקיד:</strong> <span>${screen.officer.role}</span></div>
                            <div class="officer-field" style="font-size: 1.1rem; color: #e2e8f0;"><strong>טלפון:</strong> <a href="tel:${screen.officer.phone}" style="color: #818cf8;">${screen.officer.phone}</a></div>
                            <div class="officer-field" style="font-size: 1.1rem; color: #e2e8f0;"><strong>אימייל:</strong> <a href="mailto:${screen.officer.email}" style="color: #818cf8;">${screen.officer.email}</a></div>
                        </div>
                    </div>
                `;
            }
            contentArea.innerHTML = html;

            // Trigger typing effect if content exists
            const typingEl = document.getElementById('typing-content');
            if (typingEl && screen.content) {
                // If it was already visited, maybe skip typing? 
                // For now, always type for engagement.
                typeEffect(typingEl, screen.content, 20, () => {
                    document.querySelectorAll('.waiting-for-typing').forEach(el => {
                        el.classList.remove('waiting-for-typing');
                        if (el.dataset.anim) {
                            const anims = el.dataset.anim.split(' ');
                            anims.forEach(cls => el.classList.add(cls));
                        }
                        if (el.dataset.audio) {
                            playNarration(el.dataset.audio, el.dataset.audioBehavior || 'interrupt');
                        }
                    });
                });
            } else {
                // If there's no content to type, but alerts are waiting, trigger them immediately
                document.querySelectorAll('.waiting-for-typing').forEach(el => {
                    el.classList.remove('waiting-for-typing');
                    if (el.dataset.anim) {
                        const anims = el.dataset.anim.split(' ');
                        anims.forEach(cls => el.classList.add(cls));
                    }
                    if (el.dataset.audio) {
                        playNarration(el.dataset.audio, el.dataset.audioBehavior || 'interrupt');
                    }
                });
            }

            // Attach listeners to options
            if (screen.question) {
                document.querySelectorAll('.option').forEach(el => {
                    el.onclick = () => selectOption(parseInt(el.dataset.idx));
                });
            }

            progressBar.style.width = `${((index + 1) / screens.length) * 100}%`;
            if (index === -1) progressBar.style.width = '0%';
            updateNav();

            // --- Alert Audio Timers ---
            if (screen.alerts) {
                screen.alerts.forEach(alert => {
                    if (alert.audio && !alert.waitForTyping) {
                        const delayMilli = (alert.delay || 0) * 1000;
                        setTimeout(() => {
                            // Check if still on the same slide
                            if (currentIndex === index) {
                                playNarration(alert.audio, alert.audioBehavior || 'interrupt');
                            }
                        }, delayMilli);
                    }
                });
            }

            // --- Locking Logic (minDelay & waitForAudio) ---
            const minDelay = screen.minDelay || 0;
            const waitForAudio = !!screen.waitForAudio;
            
            let audioFinished = !waitForAudio || !screen.audio;
            let timerFinished = minDelay <= 0;

            const checkUnlock = () => {
                // Safeguard: Ensure this check only applies to the slide that is currently visible
                if (index !== currentIndex) return;

                // Dynamically determine completion based on actual DOM elements
                // This is safer than relying on the screen.cards data length alone
                const allCards = contentArea.querySelectorAll('.info-card');
                const flippedCards = contentArea.querySelectorAll('.info-card.was-flipped');
                const cardsDone = allCards.length === 0 || flippedCards.length >= allCards.length;

                if (audioFinished && timerFinished && cardsDone) {
                    nextBtn.disabled = false;
                    nextBtn.style.opacity = '1';
                    nextBtn.style.pointerEvents = 'auto';

                    // Persist that the slide's requirements are met
                    const slideId = screen.id || `s${index}`;
                    if (!questionStates[slideId]) questionStates[slideId] = {};
                    questionStates[slideId].isSubmitted = true;
                    saveState();
                }
            };

            // Hook for external activities (like flipping cards)
            window.onSlideActivity = () => {
                checkUnlock();
            };

            // Initial lock check is now done at the start of renderSlide for responsiveness,
            // but we re-verify here in case logic changed during rendering.
            if ((minDelay > 0 || (waitForAudio && screen.audio) || contentArea.querySelector('.info-card')) && !isSubmitted && !screen.question) {
                nextBtn.disabled = true;
                nextBtn.style.opacity = '0.5';
                nextBtn.style.pointerEvents = 'none';
            }

            // Audio - Robust Initialization
            if (screen.audio) {
                const audioUrl = resolveAssetPath(screen.audio);
                const audio = new Audio();
                currentAudio = audio; // Track globally for stopAllAudio
                
                const startTime = screen.startTime || 0;
                const endTime = screen.endTime || 0;
                const deletedRanges = screen.deletedRanges || [];
                
                let startPos = startTime || 0;
                // Pre-calculate start position based on deleted ranges
                for (const range of deletedRanges) {
                    if (startPos >= range.start && startPos < range.end) {
                        startPos = range.end;
                    }
                }

                console.log(`[Audio] Initializing for screen: ${screen.id || index}. Target startPos: ${startPos}`);

                audio.src = audioUrl;
                audio.load();

                audio.addEventListener('loadedmetadata', () => {
                    if (startPos > 0) {
                        console.log(`[Audio] Setting initial currentTime to ${startPos}`);
                        audio.currentTime = startPos;
                    }
                }, { once: true });

                const playAudio = () => {
                    audio.play().then(() => {
                        console.log(`[Audio] Playing. current: ${audio.currentTime}`);
                    }).catch(e => {
                        console.warn('[StudioPlayer] Play blocked or failed:', e);
                        
                        // Add one-time listener to resume on interaction
                        const resume = () => {
                            audio.play().catch(() => {});
                            document.removeEventListener('mousedown', resume);
                            document.removeEventListener('keydown', resume);
                            const hint = document.getElementById('autoplay-hint');
                            if (hint) hint.remove();
                        };
                        document.addEventListener('mousedown', resume);
                        document.addEventListener('keydown', resume);

                        // Show a temporary hint if it's the first slide
                        if (index === -1 && !document.getElementById('autoplay-hint')) {
                            const hint = document.createElement('div');
                            hint.id = 'autoplay-hint';
                            hint.style.cssText = 'position:fixed; bottom:80px; left:50%; transform:translateX(-50%); background:rgba(15,23,42,0.9); color:#38bdf8; padding:12px 24px; border-radius:50px; border:1px solid #38bdf8; z-index:10000; font-weight:bold; cursor:pointer; box-shadow:0 0 20px rgba(56,189,248,0.3);';
                            hint.innerHTML = '<i class="fas fa-volume-up" style="margin-left:8px;"></i> לחצו כאן להפעלת סאונד';
                            hint.onclick = resume;
                            document.body.appendChild(hint);
                        }

                        if (waitForAudio && !isSubmitted) {
                             audioFinished = true;
                             checkUnlock();
                        }
                    });
                };

                // Better to wait for canplay
                audio.addEventListener('canplay', playAudio, { once: true });

                audio.ontimeupdate = () => {
                    const currentTime = audio.currentTime;
                    
                    // 1. Check end time
                    if (endTime > 0 && currentTime >= endTime) {
                        audio.pause();
                        audio.currentTime = endTime;
                        if (waitForAudio && !isSubmitted && !audioFinished) {
                            audioFinished = true;
                            checkUnlock();
                        }
                        return;
                    }

                    // 2. Check deleted ranges (skipping logic)
                    for (const range of deletedRanges) {
                        if (currentTime >= range.start && currentTime < range.end) {
                            console.log(`[Audio] Skipping deleted range: ${range.start}-${range.end}`);
                            audio.currentTime = range.end;
                            break;
                        }
                    }
                };

                if (waitForAudio && !isSubmitted) {
                    audio.onended = () => {
                        if (!audioFinished) {
                            audioFinished = true;
                            checkUnlock();
                        }
                    };
                }
            }

            if (minDelay > 0 && !isSubmitted) {
                setTimeout(() => {
                    timerFinished = true;
                    checkUnlock();
                }, minDelay * 1000);
            }

            saveState();

            // Return feedback toast if already submitted
            if (isSubmitted && screen.question) {
                setTimeout(() => {
                    const status = `<span class="feedback-status info">כבר היינו בשאלה הזו</span>`;
                    const feedback = screen.question.feedback || "התשובה הנכונה מסומנת בירוק.";
                    const feedbackAudio = screen.question.feedbackAudio || null;
                    const feedbackBehavior = screen.question.feedbackAudioBehavior || 'interrupt';
                    const selOpt = screen.question.options[selectedIndex];
                    const selText = selOpt ? selOpt.text : "";
                    showToast(screen.question.text || "", `${status}<br><br>${feedback}`, () => renderSlide(currentIndex + 1), null, selText, feedbackAudio, feedbackBehavior);
                }, 300);
            }
        }

        function selectOption(idx) {
            if (isSubmitted) return;
            selectedIndex = idx;
            document.querySelectorAll('.option').forEach((el, i) => {
                el.classList.toggle('selected', i === idx);
            });
        }

        function checkAnswer() {
            if (selectedIndex === -1) {
                showToast("שימו לב", "יש לסמן תשובה לפני הבדיקה.", null, "חזור לבחירה");
                return;
            }
            isSubmitted = true;
            const screen = screens[currentIndex];
            const opts = screen.question.options || [];
            const correctIdx = opts.findIndex(o => o.correct);
            
            document.querySelectorAll('.option').forEach((el, i) => {
                if (i === correctIdx) el.classList.add('correct');
                else if (i === selectedIndex) el.classList.add('incorrect');
                el.style.cursor = 'default';
            });

            const questionText = screen.question.text || "";
            const selText = opts[selectedIndex] ? opts[selectedIndex].text : "";

            if (selectedIndex === correctIdx) {
                score++;
                showToast(questionText, `<span class="feedback-status correct">תשובה נכונה</span><br><br>כל הכבוד! נכון מאוד.`, () => renderSlide(currentIndex + 1), null, selText, screen.question.feedbackAudio, screen.question.feedbackAudioBehavior);
                document.getElementById('toast').classList.add('pulse-correct');
            } else {
                const feedback = screen.question.feedback || "לא נורא, התשובה הנכונה מסומנת בירוק.";
                showToast(questionText, `<span class="feedback-status incorrect">תשובה לא נכונה</span><br><br>${feedback}`, () => renderSlide(currentIndex + 1), null, selText, screen.question.feedbackAudio, screen.question.feedbackAudioBehavior);
                document.getElementById('toast').classList.add('pulse-incorrect');
            }
            answeredCount++;
            
            // Save to persistent question states
            const slideId = screen.id || `s${currentIndex}`;
            questionStates[slideId] = { selectedIndex, isSubmitted: true };
            
            updateNav();
            saveState();
        }

        function showToast(title, msg, onContinue = null, btnText = null, selectedAnswer = null, audioPath = null, behavior = 'interrupt') {
            const t = document.getElementById('toast');
            
            // Play feedback audio if provided
            if (audioPath) {
                playNarration(audioPath, behavior);
            }
            const isFinish = (title === "סיום לומדה" || title === "סיום הלומדה" || title === "סיכום לומדה");
            t.classList.toggle('finish-toast', isFinish);
            
            t.innerHTML = `
                <div style="border-bottom: 2px solid var(--primary); padding-bottom: 15px; margin-bottom: 20px; text-align: right;">
                    <h3 style="color: var(--primary); font-size: 1.2rem; margin-bottom: 10px;">${isFinish ? "סיכום לומדה" : (title === "שימו לב" ? "" : "השאלה:")}</h3>
                    <p style="font-weight: 500; font-size: 1.1rem; margin-bottom: 0;">${title}</p>
                    
                    ${selectedAnswer ? `
                        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px dashed rgba(255,255,255,0.1);">
                            <span style="color: var(--primary); font-weight: 700; font-size: 0.9rem; display: block; margin-bottom: 5px;">התשובה שבחרת:</span>
                            <p style="font-weight: 400; font-size: 1.1rem; color: #fff; margin: 0;">${selectedAnswer}</p>
                        </div>
                    ` : ''}
                </div>
                ${isFinish ? '<h3>תוצאות</h3>' : ''}
                <div class="animate-in delay-1">
                    <p>${msg}</p>
                </div>
                <button class="btn btn-primary animate-in delay-2" style="margin-top:20px; width:100%" id="toast-close">${btnText || (isFinish ? "סגור לומדה" : "המשך ללמידה")}</button>
            `;
            t.style.display = 'block';
            t.classList.remove('pulse-correct', 'pulse-incorrect'); // Reset classes

            // Disable all other interactions by adding a modal backdrop
            let overlay = document.getElementById('toast-backdrop');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'toast-backdrop';
                overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:999; backdrop-filter:blur(4px);';
                document.body.appendChild(overlay);
            }
            overlay.style.display = 'block';
            t.style.zIndex = '1000';

            document.getElementById('toast-close').onclick = () => {
                t.style.display = 'none';
                overlay.style.display = 'none';
                if (onContinue && typeof onContinue === 'function') {
                    onContinue();
                }
            };
        }

        function saveState() {
            if (!screens[currentIndex] || !window.SCORM || !SCORM.connected) return;
            const state = { index: currentIndex, score, answered: answeredCount, timers: slideTimers, questions: questionStates };
            SCORM.saveProgressState(screens[currentIndex].id || `s${currentIndex}`, state);
        }

        function restoreState() {
            if (!window.SCORM) return;
            const state = SCORM.getSuspendData();
            if (state && state.index !== undefined) {
                // If bookmarked index > 0, we still want to show it, 
                // but the user might want a "splash" screen anyway if it's a fresh launch.
                // For now, we follow the bookmark as standard SCORM behavior.
                currentIndex = state.index;
                score = state.score || 0;
                answeredCount = state.answered || 0;
                slideTimers = state.timers || {};
                questionStates = state.questions || {};
            }
        }

        function finishCourse() {
            const totalQ = screens.filter(s => s.question).length;
            const finalScore = totalQ > 0 ? Math.round((score / totalQ) * 100) : 100;
            SCORM.setScore(finalScore);
            SCORM.setComplete();
            saveState();
            showToast("סיום לומדה", `סיימת את הלומדה!<br><br>הציון שלך הוא:<br><span class="final-score">${finalScore}</span><br><br>הלומדה תיסגר כעת.`);
            setTimeout(() => { SCORM.finish(); window.close(); }, 3000);
        }

        // --- Start Execution ---
        try {
            console.log('[StudioPlayer] Running main start loop');
            const success = await loadData();
            
            // Add a failsafe timeout to hide the loading screen if preloading hangs
            const loadingTimeout = setTimeout(() => {
                const loadingScreen = document.getElementById('loading-screen');
                if (loadingScreen && loadingScreen.style.display !== 'none') {
                    console.warn('[StudioPlayer] Preloading taking too long, forcing show');
                    loadingScreen.style.display = 'none';
                    const playerContainer = document.getElementById('player-container');
                    if (playerContainer) playerContainer.style.display = 'block';
                    fitPlayer();
                }
            }, 8000);

            if (success) {
                await preloadMedia();
                clearTimeout(loadingTimeout);
                
                // Hide loading screen and show player
                const loadingScreen = document.getElementById('loading-screen');
                if (loadingScreen) loadingScreen.style.display = 'none';
                const playerContainer = document.getElementById('player-container');
                if (playerContainer) playerContainer.style.display = 'block';
                fitPlayer();

                restoreState();
                // Start course
                const suspend = SCORM.getSuspendData ? SCORM.getSuspendData() : null;
                if (splashData && (!suspend || suspend.index === undefined || suspend.index === -1)) {
                    renderSlide(-1);
                } else {
                    renderSlide(currentIndex || 0);
                }
                if (prevBtn) prevBtn.onclick = () => { if (currentIndex > 0) renderSlide(currentIndex - 1); };
            } else {
                console.error('[StudioPlayer] Course data could not be loaded');
                const loadingScreen = document.getElementById('loading-screen');
                if (loadingScreen) loadingScreen.style.display = 'none';
                const playerContainer = document.getElementById('player-container');
                if (playerContainer) playerContainer.style.display = 'block';
                fitPlayer();
            }
        } catch (err) {
            console.error('[StudioPlayer] Fatal error in start loop:', err);
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) loadingScreen.style.display = 'none';
            const playerContainer = document.getElementById('player-container');
            if (playerContainer) playerContainer.style.display = 'block';
            if (contentArea) {
                contentArea.innerHTML = `
                    <div style="color:#ef4444; padding:40px; text-align:center;">
                        <h3>שגיאה פנימית בלומדה</h3>
                        <p>אירעה תקלה בעת הפעלת המערכת.</p>
                        <code style="display:block; margin-top:10px; font-size:0.8rem;">${err.message}</code>
                    </div>`;
            }
        }
    };

    // --- Start Execution ---
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initPlayer();
    } else {
        document.addEventListener('DOMContentLoaded', initPlayer);
    }
})();
