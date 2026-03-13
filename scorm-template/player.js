document.addEventListener('DOMContentLoaded', async () => {
    let screens = [];
    let currentIndex = 0;
    let score = 0;
    let answeredCount = 0;
    let slideTimers = {};
    let slideStartTime = Date.now();
    let currentAudio = null;
    let selectedIndex = -1;
    let isSubmitted = false;

    console.log('[Player] Startup sequence initiated');

    const playerContainer = document.getElementById('player-container');
    const contentArea = document.getElementById('content-area');
    const progressBar = document.getElementById('progress-bar');
    const nextBtn = document.getElementById('next-btn');
    const prevBtn = document.getElementById('prev-btn');

    // --- Loading State ---
    contentArea.innerHTML = '<div style="text-align:center; padding:50px;"><i class="fas fa-spinner fa-spin" style="font-size:3rem; color:var(--primary);"></i><p style="margin-top:20px;">טוען נתוני לומדה...</p></div>';

    // --- SCORM Init ---
    try {
        SCORM.init();
    } catch (e) {
        console.warn('[Player] SCORM init failed, running standalone');
    }

    // --- Load Data ---
    await loadData();
    restoreState();
    
    if (screens.length > 0) {
        renderSlide(currentIndex);
    } else {
        contentArea.innerHTML = '<div style="text-align:center; padding:50px;"><h3>לא נמצאו שקפים בלומדה זו.</h3></div>';
    }

    async function loadData() {
        try {
            console.log('[Player] Attempting to load data.json');
            const res = await fetch('data.json?v=' + Date.now());
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            screens = data.screens || [];
            console.log(`[Player] Success: Loaded ${screens.length} screens.`, screens);
        } catch (e) {
            console.error("[Player] CRITICAL: data.json load failed", e);
            contentArea.innerHTML = `<div style="color:white; padding:40px; text-align:center; background:rgba(239,68,68,0.1); border:1px solid var(--error); border-radius:15px;">
                <h2 style="color:var(--error); margin-bottom:15px;">שגיאה בטעינת הקורס</h2>
                <p>לא ניתן היה לטעון את נתוני הקורס. אנא וודא שקובץ data.json קיים בתיקיית המקור.</p>
                <code style="display:block; margin-top:15px; background:rgba(0,0,0,0.3); padding:10px;">${e.message}</code>
            </div>`;
        }
    }

    function renderSlide(index) {
        if (!screens[index]) {
            console.error(`[Player] Slide index ${index} out of bounds`);
            return;
        }

        console.log(`[Player] Rendering slide ${index + 1}/${screens.length}`);

        // Track time for previous slide
        const now = Date.now();
        const timeDiff = Math.round((now - slideStartTime) / 1000);
        if (screens[currentIndex]) {
            const prevId = screens[currentIndex].id || `slide_${currentIndex}`;
            slideTimers[prevId] = (slideTimers[prevId] || 0) + timeDiff;
        }
        
        currentIndex = index;
        slideStartTime = now;
        const screen = screens[index];

        selectedIndex = -1;
        isSubmitted = false;

        // Background - Use absolute paths logic for CSS
        if (screen.bgImage) {
            const bgUrl = screen.bgImage;
            playerContainer.style.backgroundImage = `url('${encodeURI(bgUrl)}')`;
        } else {
            playerContainer.style.backgroundImage = 'none';
        }

        // Character Logic - Dynamic assignment
        const titleText = (screen.title || '').toLowerCase();
        const contentText = (screen.content || '').toLowerCase();
        const combined = titleText + contentText;
        
        const isInfoSec = combined.includes('אבטחה') || combined.includes('מידע') || combined.includes('סיסמה') || combined.includes('סייבר');
        const isHarassment = combined.includes('הטרדה') || combined.includes('מינית') || combined.includes('מוגן');
        
        const charImg = isInfoSec ? 'maya_guide.png' : 'mia_transparent_v4.png';
        const charLabel = isHarassment 
            ? 'מונה - הממונה על מניעת הטרדה מינית' 
            : (isInfoSec ? 'מיה - הממונה על אבטחת מידע' : 'מיה - המדריכה שלך');
        
        const ciElem = document.getElementById('player-char-img');
        const clElem = document.getElementById('player-char-label');
        if (ciElem) ciElem.src = `assets/${charImg}`;
        if (clElem) clElem.textContent = charLabel;

        // Content Area
        let mainHtml = `<h1>${screen.title || ''}</h1>`;
        if (screen.question) {
            mainHtml += `<p class="question-text">${screen.question.text || ''}</p>`;
            mainHtml += `<div class="options-list" style="margin-top:25px;">
                ${(screen.question.options || []).map((opt, i) => `<div class="option" onclick="selectOption(${i})">${opt.text || ''}</div>`).join('')}
            </div>`;
        } else {
            mainHtml += `<p>${screen.content || ''}</p>`;
        }
        contentArea.innerHTML = mainHtml;

        // Progress & Nav
        progressBar.style.width = `${((index + 1) / screens.length) * 100}%`;
        updateNav();

        // Audio
        stopAudio();
        if (screen.audio) {
            currentAudio = new Audio(encodeURI(screen.audio));
            currentAudio.play().catch(e => console.warn("[Player] Audio blocked or missing:", screen.audio));
        }

        saveState();
    }

    function updateNav() {
        const screen = screens[currentIndex];
        const isQ = !!(screen && screen.question);
        prevBtn.style.display = currentIndex > 0 ? 'flex' : 'none';
        
        if (isQ && !isSubmitted) {
            nextBtn.innerHTML = 'בדוק תשובה <i class="fas fa-check" style="margin-right:8px;"></i>';
            nextBtn.onclick = checkAnswer;
        } else {
            if (currentIndex === screens.length - 1) {
                nextBtn.innerHTML = 'סיום ויציאה <i class="fas fa-flag-checkered" style="margin-right:8px;"></i>';
                nextBtn.onclick = finishCourse;
            } else {
                nextBtn.innerHTML = 'המשך <i class="fas fa-chevron-left" style="margin-right:8px;"></i>';
                nextBtn.onclick = () => renderSlide(currentIndex + 1);
            }
        }
    }

    window.selectOption = (idx) => {
        if (isSubmitted) return;
        selectedIndex = idx;
        document.querySelectorAll('.option').forEach((el, i) => {
            el.classList.toggle('selected', i === idx);
        });
    };

    function checkAnswer() {
        if (selectedIndex === -1) return;
        isSubmitted = true;
        const screen = screens[currentIndex];
        const options = document.querySelectorAll('.option');
        const opts = screen.question.options || [];
        const correctIdx = opts.findIndex(o => o.correct);
        
        options.forEach((el, i) => {
            if (i === correctIdx) el.classList.add('correct');
            else if (i === selectedIndex) el.classList.add('incorrect');
            el.style.cursor = 'default';
        });

        if (selectedIndex === correctIdx) {
            score++;
            showToast("נכון מאוד! כל הכבוד.");
        } else {
            showToast(screen.question.feedback || "לא נורא, התשובה הנכונה מסומנת בירוק.");
        }
        answeredCount++;
        updateNav();
        saveState();
    }

    function showToast(msg) {
        const t = document.getElementById('toast');
        t.innerHTML = `<h3>פידבק</h3><p>${msg}</p><button class="btn btn-primary" style="margin-top:20px; width:100%" onclick="hideToast()">המשך</button>`;
        t.style.display = 'block';
    }
    window.hideToast = () => document.getElementById('toast').style.display = 'none';

    function stopAudio() {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    }

    function saveState() {
        if (!screens[currentIndex] || !SCORM.connected) return;
        const slideId = screens[currentIndex].id || `slide_${currentIndex}`;
        const state = {
            index: currentIndex,
            score: score,
            answered: answeredCount,
            timers: slideTimers
        };
        SCORM.saveProgressState(slideId, state);
        
        const progressRaw = (currentIndex + 1) / screens.length;
        SCORM.set("cmi.core.progress_measure", progressRaw.toFixed(2));
    }

    function restoreState() {
        const state = SCORM.getSuspendData();
        if (state && typeof state === 'object' && state.index !== undefined) {
            currentIndex = state.index;
            score = state.score || 0;
            answeredCount = state.answered || 0;
            slideTimers = state.timers || {};
            console.log(`[Player] Restored progress to slide ${currentIndex + 1}`);
        } else {
            const bookmark = SCORM.getBookmark();
            if (bookmark) {
                const foundIndex = screens.findIndex(s => s.id === bookmark);
                if (foundIndex !== -1) currentIndex = foundIndex;
            }
        }
    }

    function finishCourse() {
        const now = Date.now();
        const timeDiff = Math.round((now - slideStartTime) / 1000);
        const slideId = screens[currentIndex]?.id || 'final';
        slideTimers[slideId] = (slideTimers[slideId] || 0) + timeDiff;

        const totalQuestions = screens.filter(s => s.question).length;
        const finalScore = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 100;

        SCORM.setScore(finalScore);
        SCORM.setComplete();
        saveState();
        
        showToast(`סיימת את הלומדה! הציון שלך הוא ${finalScore}%. הלומדה תיסגר כעת.`);
        setTimeout(() => {
            SCORM.finish();
            window.close();
        }, 3000);
    }
});
