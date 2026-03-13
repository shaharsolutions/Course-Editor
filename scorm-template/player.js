document.addEventListener('DOMContentLoaded', async () => {
    let screens = [];
    let currentIndex = 0;
    let score = 0;
    let answeredCount = 0;
    let slideTimers = {}; // { slideId: totalSeconds }
    let slideStartTime = Date.now();
    let currentAudio = null;
    let selectedIndex = -1;
    let isSubmitted = false;

    const playerContainer = document.getElementById('player-container');
    const contentArea = document.getElementById('content-area');
    const progressBar = document.getElementById('progress-bar');
    const nextBtn = document.getElementById('next-btn');
    const prevBtn = document.getElementById('prev-btn');

    // --- Initialization ---
    SCORM.init();
    await loadData();
    restoreState();
    renderSlide(currentIndex);

    async function loadData() {
        try {
            const res = await fetch('data.json');
            const data = await res.json();
            screens = data.screens;
        } catch (e) {
            console.error("Data load failed:", e);
        }
    }

    function renderSlide(index) {
        // Track time for the PREVIOUS slide before switching
        if (screens[currentIndex]) {
            const timeDiff = Math.round((Date.now() - slideStartTime) / 1000);
            const slideId = screens[currentIndex].id || `slide_${currentIndex}`;
            slideTimers[slideId] = (slideTimers[slideId] || 0) + timeDiff;
        }
        
        currentIndex = index;
        slideStartTime = Date.now();
        const screen = screens[index];
        if (!screen) return;

        // Reset state for question
        selectedIndex = -1;
        isSubmitted = false;

        // Background
        if (screen.bgImage) {
            playerContainer.style.backgroundImage = `url('${encodeURI(screen.bgImage)}')`;
        }

        // Content
        let html = `<h1>${screen.title}</h1>`;
        if (screen.question) {
            html += `<p class="question-text">${screen.question.text}</p>`;
            html += `<div class="options-list">
                ${screen.question.options.map((opt, i) => `<div class="option" onclick="selectOption(${i})">${opt.text}</div>`).join('')}
            </div>`;
        } else {
            html += `<p>${screen.content || ''}</p>`;
        }
        contentArea.innerHTML = html;

        // Progress
        progressBar.style.width = `${((index + 1) / screens.length) * 100}%`;

        // Audio
        stopAudio();
        if (screen.audio) {
            currentAudio = new Audio(encodeURI(screen.audio));
            currentAudio.play().catch(e => console.warn("Audio failed", e));
        }

        // Nav
        updateNav();
        saveState();
    }

    function updateNav() {
        const screen = screens[currentIndex];
        const isQuestion = !!screen.question;

        prevBtn.style.display = currentIndex > 0 ? 'flex' : 'none';
        
        if (isQuestion && !isSubmitted) {
            nextBtn.innerHTML = 'בדוק תשובה <i class="fas fa-check"></i>';
            nextBtn.onclick = checkAnswer;
        } else {
            if (currentIndex === screens.length - 1) {
                nextBtn.innerHTML = 'סיום לומדה <i class="fas fa-flag-checkered"></i>';
                nextBtn.onclick = finishCourse;
            } else {
                nextBtn.innerHTML = 'המשך <i class="fas fa-chevron-left"></i>';
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
        const correctIdx = screen.question.options.findIndex(o => o.correct);
        
        options.forEach((el, i) => {
            if (i === correctIdx) el.classList.add('correct');
            else if (i === selectedIndex) el.classList.add('incorrect');
            el.style.cursor = 'default';
        });

        if (selectedIndex === correctIdx) {
            score++;
            showToast("נכון מאוד! כל הכבוד.");
        } else {
            showToast("לא נורא, התשובה הנכונה מסומנת בירוק.");
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

    window.hideToast = () => {
        document.getElementById('toast').style.display = 'none';
    };

    function stopAudio() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
    }

    function saveState() {
        const state = {
            index: currentIndex,
            score: score,
            answered: answeredCount,
            timers: slideTimers
        };
        SCORM.saveProgressState(screens[currentIndex].id, state);
    }

    function restoreState() {
        const state = SCORM.getSuspendData();
        if (state && state.index !== undefined) {
            currentIndex = state.index;
            score = state.score || 0;
            answeredCount = state.answered || 0;
            slideTimers = state.timers || {};
        }
    }

    function finishCourse() {
        // Track final slide time
        const timeDiff = Math.round((Date.now() - slideStartTime) / 1000);
        const slideId = screens[currentIndex].id || `slide_${currentIndex}`;
        slideTimers[slideId] = (slideTimers[slideId] || 0) + timeDiff;

        const totalQuestions = screens.filter(s => s.question).length;
        const finalScore = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 100;

        SCORM.setScore(finalScore);
        SCORM.setComplete();
        
        // Report totals to suspend data one last time
        saveState();
        
        showToast(`סיימת את הלומדה! הציון שלך הוא ${finalScore}%. החלון ייסגר כעת.`);
        setTimeout(() => {
            SCORM.finish();
            window.close();
        }, 3000);
    }

    window.prevPreviewSlide = () => {
        if (currentIndex > 0) renderSlide(currentIndex - 1);
    };
});
