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

    function stopAllAudio() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio = null;
        }
    }

    let typeTimer = null;
    function typeEffect(element, text, speed = 20) {
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
        // Strip leading GUID/ UUID prefix if present
        if (clean.includes('/')) {
            const parts = clean.split('/');
            if (parts[0].length > 15 && parts[0].includes('-')) {
                clean = parts.slice(1).join('/');
            }
        }
        
        // --- Preview Mode Logic ---
        // If we have a courseId in session storage, we're in the editor's preview.
        // Files that are NOT system assets should be fetched from Supabase Storage.
        const previewCourseId = sessionStorage.getItem('previewCourseId');
        const systemAssets = ['maya_guide.png', 'mia_transparent_v4.png', 'bg_welcome.png', 'bg_content.png', 'bg_quiz.png', 'bg_summary.png'];
        
        if (previewCourseId && !systemAssets.includes(clean)) {
            const SUPABASE_URL = 'https://iduyexkzivtnvrdsbwig.supabase.co';
            return `${SUPABASE_URL}/storage/v1/object/public/course-assets/${previewCourseId}/${clean.replace(/\/+/g, '/').replace(/^\//, '')}`;
        }
        
        // Normal published mode OR system asset
        if (!clean.includes('/')) {
            clean = 'assets/' + clean;
        }
        
        return clean.replace(/\/+/g, '/');
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const playerContainer = document.getElementById('player-container');
        const contentArea = document.getElementById('content-area');
        const progressBar = document.getElementById('progress-bar');
        const nextBtn = document.getElementById('next-btn');
        const prevBtn = document.getElementById('prev-btn');

        // Initial Loading View
        contentArea.innerHTML = `
            <div style="text-align:center; padding:50px;" class="animate-in">
                <div class="loader-pulse" style="margin: 0 auto;"></div>
                <p style="margin-top:20px; color:#94a3b8;" class="cyber-glitch">מכין את מרחב הלמידה...</p>
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
        window.toggleCard = (el) => {
            el.classList.toggle('flipped');
            if (el.classList.contains('flipped')) {
                el.classList.add('was-flipped');
                // Signal that an activity occurred (like flipping a card)
                if (window.onSlideActivity) window.onSlideActivity();
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
        'sender': '<strong>זיהוי מעולה של כתובת מזויפת!</strong><br>שימו לב לכתובת המייל (paypa1 במקום paypal). נוכלים מרבים להשתמש באותיות דומות או החלפת L ב-1 כדי להטעות את העין במבט ראשון.',
        'greeting': '<strong>פנייה כללית מחשידה!</strong><br>אימייל לגיטימי ורשמי ממוסד המכיר אתכם תמיד יפנה אליכם בשמכם הפרטי או המלא, ולא בכינוי גנרי כמו "לקוח יקר".',
        'link': '<strong>זהירות מלינקים במסווה!</strong><br>הכפתור מעוצב כמו מערכת רשמית אך תמיד יש לרחף עם העכבר כדי לראות את כתובת ה-URL השלמה ולוודא שהיא לא הונאה.'
    };
    
    const feedbackArea = document.getElementById('phishing-feedback-area');
    if (feedbackArea) {
        feedbackArea.classList.remove('animate-in');
        void feedbackArea.offsetWidth; // trigger reflow
        feedbackArea.classList.add('animate-in');
        
        feedbackArea.innerHTML = `
            <div style="background: rgba(254,242,242,0.9); border-right: 4px solid #ef4444; padding: 10px 15px; border-radius: 8px; color: #1e293b; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-bottom: 5px;">
                <i class="fas fa-exclamation-triangle" style="color: #ef4444; float: right; margin-left: 12px; font-size: 1.2rem; margin-top: 2px;"></i>
                <div style="margin-right: 30px; line-height: 1.4; font-size: 0.9rem;">${msgs[id] || 'זיהית סימן מחשיד'}</div>
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
        
        const feedbackArea = document.getElementById('phishing-feedback-area');
        if (feedbackArea && lastFeedbackHtml) {
            // Displays both the specific feedback AND the success message
            feedbackArea.innerHTML = `
                <div class="animate-in" style="background: rgba(254,242,242,0.9); border-right: 4px solid #ef4444; padding: 8px 12px; border-radius: 8px; color: #1e293b; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-bottom: 8px;">
                    <i class="fas fa-exclamation-triangle" style="color: #ef4444; float: right; margin-left: 12px; font-size: 1.1rem; margin-top: 2px;"></i>
                    <div style="margin-right: 30px; line-height: 1.4; font-size: 0.85rem;">${lastFeedbackHtml}</div>
                </div>
                <div class="animate-in delay-1" style="background: rgba(34,197,94,0.15); border-right: 4px solid #22c55e; padding: 8px 12px; border-radius: 8px; color: #166534; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px dashed #22c55e;">
                    <i class="fas fa-check-circle" style="color: #22c55e; float: right; margin-left: 12px; font-size: 1.1rem; margin-top: 2px;"></i>
                    <div style="margin-right: 30px; line-height: 1.4; font-size: 0.9rem;"><strong>כל הכבוד!</strong> מצאת את הכל. כעת <strong>דווח למערכת</strong> להשלמת המשימה.</div>
                </div>
            `;
        }
    }
};

window.finishPhishing = () => {
    showToast("סימולציה הושלמה", "זיהית בהצלחה את כל סימני האזהרה באימייל! זכור: תמיד בדוק את זהות השולח ואת הלינקים לפני הלחיצה.", () => {
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

            updateStatus('טוען גרפיקה וסאונד...');
            
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
                updateStatus(`טוען משאבי לומדה (${Math.round((Math.min(i + batchSize, total) / total) * 100)}%)...`);
            }
            
            updateStatus('הטעינה הושלמה!');
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
            
            // Remove splash-mode by default
            contentArea.classList.remove('splash-mode');
            
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
            if (screen.bgImage) {
                const bgUrl = resolveAssetPath(screen.bgImage);
                playerContainer.style.backgroundImage = `url('${encodeURI(bgUrl)}')`;
                console.log(`[StudioPlayer] Setting background: ${bgUrl}`);
            } else {
                // Fallback to high-quality system backgrounds
                let fallbackBg = 'bg_content.png';
                if (index === -1 || index === 0) fallbackBg = 'bg_welcome.png';
                else if (screen.question) fallbackBg = 'bg_quiz.png';
                else if (index === screens.length - 1) fallbackBg = 'bg_summary.png';
                
                const bgUrl = resolveAssetPath(fallbackBg);
                playerContainer.style.backgroundImage = `url('${encodeURI(bgUrl)}')`;
                console.log(`[StudioPlayer] Using fallback background: ${fallbackBg}`);
            }

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
                    <div class="phishing-container animate-in delay-2" style="text-align: right; direction: rtl; max-width: 800px; margin: 0 auto; display: flex; flex-direction: column;">
                        <div style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px;">
                            <p style="margin: 0; font-size: 1.15rem; font-weight: 600; color: #e2e8f0; line-height: 1.4;">${screen.content || 'זהה את כל נורות האזהרה באימייל הבא:'}</p>
                            <div class="phishing-counter" style="align-self: flex-start; margin: 0; padding: 6px 16px; background: rgba(56, 189, 248, 0.1); border: 1px solid #38bdf8; border-radius: 20px; color: #38bdf8; font-size: 0.95rem; white-space: nowrap;">
                                מצא תקלות אבטחה: <strong id="phishing-counter-text" style="color: white; margin-right: 5px;">0 מתוך ${window.totalFlags}</strong>
                            </div>
                        </div>
                        
                        <!-- Visual Feedback Area - compact and potentially absolute or semi-absolute -->
                        <div id="phishing-feedback-area" style="min-height: 5px; margin-bottom: 10px; flex-shrink: 0;"></div>
                        
                        <div class="email-mockup delay-3" style="font-size: 0.85rem; max-height: 48vh; overflow-y: auto; color: #1e293b; background: #ffffff; flex-grow: 1;">
                            <div class="email-os-header" style="padding: 8px 15px;">
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
                            
                            <div class="email-header" style="background: #ffffff; padding: 15px 20px;">
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
                            <div class="email-body" style="padding: 12px 20px; line-height: 1.5; color: #334155; pointer-events: auto;">
                                <p style="margin-bottom: 12px; color: #334155;">שלום <span class="phishing-flag text-flag" onclick="window.handleFlagClick(this, 'greeting')" style="padding: 2px 4px; border-radius: 4px;">לקוח יקר</span>,</p>
                                <p style="margin-bottom: 12px; color: #334155;">זיהינו פעילות חריגה בחשבון שלך ממכשיר לא מזוהה. מטעמי אבטחה, החשבון שלך הוגבל באופן זמני.</p>
                                <p style="margin-bottom: 18px; color: #334155;">אנא הקלק על הקישור הבא לאימות זהותך. יש לבצע את הפעולה תוך 24 שעות, אחרת חשבונך יינעל לצמיתות:</p>
                                
                                <div style="text-align: center; margin: 20px 0; position: relative;" title="http://paypa1-security-check.com/login-action.php">
                                    <span class="phishing-flag phishing-action-btn" onclick="window.handleFlagClick(this, 'link')" style="box-shadow: 0 4px 6px rgba(0,0,0,0.1); font-size: 0.95rem; padding: 10px 25px; display: inline-block;">התחברות לאימות מהיר</span>
                                </div>
                                
                                <p style="margin-bottom: 3px; color: #334155;">בברכה,</p>
                                <p style="color: #6b7280; font-size: 0.85rem; margin-bottom: 0;">צוות התמיכה והאבטחה - מאובטח</p>
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
                            const animClass = alert.animation ? `anim-${alert.animation}` : `animate-in delay-${Math.min(i+2, 4)}`;
                            const customDelay = alert.delay !== undefined ? `animation-delay: ${alert.delay}s;` : '';
                            return `
                                <div class="alert-box ${alert.type || 'info'} ${animClass}" style="${customDelay}">
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
                            <div class="info-card animate-in delay-${Math.min(i+2, 4)}" onclick="window.toggleCard(this)">
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
                typeEffect(typingEl, screen.content);
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

            // Audio
            if (screen.audio) {
                const audioUrl = resolveAssetPath(screen.audio);
                currentAudio = new Audio(audioUrl);
                
                if (waitForAudio && !isSubmitted) {
                    currentAudio.onended = () => {
                        audioFinished = true;
                        checkUnlock();
                    };
                }

                currentAudio.play().catch(e => {
                    console.warn('[StudioPlayer] Auto-play blocked or failed:', e);
                    audioFinished = true;
                    checkUnlock();
                });
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
                    const status = `<span class="feedback-status info">כבר ענית על שאלה זו</span>`;
                    const feedback = screen.question.feedback || "התשובה הנכונה מסומנת בירוק.";
                    const selOpt = screen.question.options[selectedIndex];
                    const selText = selOpt ? selOpt.text : "";
                    showToast(screen.question.text || "", `${status}<br><br>${feedback}`, () => renderSlide(currentIndex + 1), null, selText);
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
                showToast(questionText, `<span class="feedback-status correct">תשובה נכונה</span><br><br>כל הכבוד! נכון מאוד.`, () => renderSlide(currentIndex + 1), null, selText);
                document.getElementById('toast').classList.add('pulse-correct');
            } else {
                const feedback = screen.question.feedback || "לא נורא, התשובה הנכונה מסומנת בירוק.";
                showToast(questionText, `<span class="feedback-status incorrect">תשובה לא נכונה</span><br><br>${feedback}`, () => renderSlide(currentIndex + 1), null, selText);
                document.getElementById('toast').classList.add('pulse-incorrect');
            }
            answeredCount++;
            
            // Save to persistent question states
            const slideId = screen.id || `s${currentIndex}`;
            questionStates[slideId] = { selectedIndex, isSubmitted: true };
            
            updateNav();
            saveState();
        }

        function showToast(title, msg, onContinue = null, btnText = null, selectedAnswer = null) {
            const t = document.getElementById('toast');
            const isFinish = (title === "סיום לומדה" || title === "סיום הלומדה" || title === "סיכום לומדה");
            t.classList.toggle('finish-toast', isFinish);
            
            t.innerHTML = `
                <div style="border-bottom: 2px solid var(--primary); padding-bottom: 15px; margin-bottom: 20px; text-align: right;">
                    <h3 style="color: var(--primary); font-size: 1.2rem; margin-bottom: 10px;">${isFinish ? "סיכום לומדה" : (title === "שימו לב" ? "" : "השאלה:")}</h3>
                    <p style="font-weight: 500; font-size: 1.1rem; margin-bottom: 0;">${title}</p>
                    
                    ${selectedAnswer ? `
                        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px dashed rgba(255,255,255,0.1);">
                            <span style="color: var(--primary); font-weight: 700; font-size: 0.9rem; display: block; margin-bottom: 5px;">התשובה שבחרת:</span>
                            <p style="font-weight: 700; font-size: 1.1rem; color: #fff; margin: 0;">${selectedAnswer}</p>
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
            SCORM.set("cmi.core.progress_measure", ((currentIndex + 1) / screens.length).toFixed(2));
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
        const success = await loadData();
        if (success) {
            await preloadMedia();
            
            // Hide loading screen and show player
            document.getElementById('loading-screen').style.display = 'none';
            document.getElementById('player-container').style.display = 'block';
            fitPlayer();

            restoreState();
            restoreState();
            // Start course
            if (splashData && !SCORM.getSuspendData()?.index) {
                renderSlide(-1);
            } else {
                renderSlide(currentIndex || 0);
            }
            prevBtn.onclick = () => { if (currentIndex > 0) renderSlide(currentIndex - 1); };
        }

    });
})();
