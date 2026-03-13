(function() {
    let screens = [];
    let currentIndex = 0;
    let score = 0;
    let answeredCount = 0;
    let slideTimers = {};
    let slideStartTime = Date.now();
    let currentAudio = null;
    let selectedIndex = -1;
    let isSubmitted = false;

    console.log('[StudioPlayer] Initialization started');

    document.addEventListener('DOMContentLoaded', async () => {
        const playerContainer = document.getElementById('player-container');
        const contentArea = document.getElementById('content-area');
        const progressBar = document.getElementById('progress-bar');
        const nextBtn = document.getElementById('next-btn');
        const prevBtn = document.getElementById('prev-btn');

        // Initial Loading View
        contentArea.innerHTML = `
            <div style="text-align:center; padding:50px;">
                <i class="fas fa-spinner fa-spin" style="font-size:3rem; color:#38bdf8;"></i>
                <p style="margin-top:20px; color:#94a3b8;">טוען נתונים...</p>
            </div>`;

        // SCORM Init
        try {
            if (window.SCORM) {
                SCORM.init();
            }
        } catch (e) {
            console.warn('[StudioPlayer] SCORM error:', e);
        }

        async function loadData() {
            try {
                // Try to find the correct path for data.json
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

                if (!data) throw new Error('Could not find data.json');
                
                screens = data.screens || [];
                console.log(`[StudioPlayer] Success: Loaded ${screens.length} screens`);
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

        function renderSlide(index) {
            if (!screens[index]) return;

            // Track time
            const now = Date.now();
            if (screens[currentIndex]) {
                const diff = Math.round((now - slideStartTime) / 1000);
                const pid = screens[currentIndex].id || `s${currentIndex}`;
                slideTimers[pid] = (slideTimers[pid] || 0) + diff;
            }
            
            currentIndex = index;
            slideStartTime = now;
            const screen = screens[index];
            selectedIndex = -1;
            isSubmitted = false;

            // UI
            if (screen.bgImage) {
                playerContainer.style.backgroundImage = `url('${encodeURI(screen.bgImage)}')`;
            } else {
                playerContainer.style.backgroundImage = 'none';
            }

            // Character
            const combined = ((screen.title || '') + (screen.content || '')).toLowerCase();
            const isInfoSec = combined.includes('אבטחה') || combined.includes('מידע') || combined.includes('סיסמה') || combined.includes('סייבר');
            const isHarassment = combined.includes('הטרדה') || combined.includes('מינית');
            const charImg = isInfoSec ? 'maya_guide.png' : 'mia_transparent_v4.png';
            const charLabel = isHarassment ? 'מונה - הממונה על מניעת הטרדה מינית' : (isInfoSec ? 'מיה - הממונה על אבטחת מידע' : 'מיה - המדריכה שלך');
            
            const ci = document.getElementById('player-char-img');
            const cl = document.getElementById('player-char-label');
            if (ci) ci.src = `assets/${charImg}`;
            if (cl) cl.textContent = charLabel;

            // Main Content
            let html = `<h1>${screen.title || ''}</h1>`;
            if (screen.question) {
                html += `<p class="question-text">${screen.question.text || ''}</p>`;
                html += `<div class="options-list" style="margin-top:25px;">
                    ${(screen.question.options || []).map((opt, i) => `<div class="option" data-idx="${i}">${opt.text || ''}</div>`).join('')}
                </div>`;
            } else {
                html += `<p>${screen.content || ''}</p>`;
            }
            contentArea.innerHTML = html;

            // Attach listeners to options
            if (screen.question) {
                document.querySelectorAll('.option').forEach(el => {
                    el.onclick = () => selectOption(parseInt(el.dataset.idx));
                });
            }

            progressBar.style.width = `${((index + 1) / screens.length) * 100}%`;
            updateNav();

            // Audio
            if (currentAudio) { currentAudio.pause(); currentAudio = null; }
            if (screen.audio) {
                currentAudio = new Audio(encodeURI(screen.audio));
                currentAudio.play().catch(() => {});
            }

            saveState();
        }

        function selectOption(idx) {
            if (isSubmitted) return;
            selectedIndex = idx;
            document.querySelectorAll('.option').forEach((el, i) => {
                el.classList.toggle('selected', i === idx);
            });
        }

        function checkAnswer() {
            if (selectedIndex === -1) return;
            isSubmitted = true;
            const screen = screens[currentIndex];
            const opts = screen.question.options || [];
            const correctIdx = opts.findIndex(o => o.correct);
            
            document.querySelectorAll('.option').forEach((el, i) => {
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
            t.innerHTML = `<h3>פידבק</h3><p>${msg}</p><button class="btn btn-primary" style="margin-top:20px; width:100%" id="toast-close">המשך</button>`;
            t.style.display = 'block';
            document.getElementById('toast-close').onclick = () => t.style.display = 'none';
        }

        function saveState() {
            if (!screens[currentIndex] || !window.SCORM || !SCORM.connected) return;
            const state = { index: currentIndex, score, answered: answeredCount, timers: slideTimers };
            SCORM.saveProgressState(screens[currentIndex].id || `s${currentIndex}`, state);
            SCORM.set("cmi.core.progress_measure", ((currentIndex + 1) / screens.length).toFixed(2));
        }

        function restoreState() {
            if (!window.SCORM) return;
            const state = SCORM.getSuspendData();
            if (state && state.index !== undefined) {
                currentIndex = state.index;
                score = state.score || 0;
                answeredCount = state.answered || 0;
                slideTimers = state.timers || {};
            }
        }

        function finishCourse() {
            const totalQ = screens.filter(s => s.question).length;
            const finalScore = totalQ > 0 ? Math.round((score / totalQ) * 100) : 100;
            SCORM.setScore(finalScore);
            SCORM.setComplete();
            saveState();
            showToast(`סיימת את הלומדה! הציון שלך הוא ${finalScore}%. הלומדה תיסגר כעת.`);
            setTimeout(() => { SCORM.finish(); window.close(); }, 3000);
        }

        // --- Start Execution ---
        const success = await loadData();
        if (success) {
            restoreState();
            renderSlide(currentIndex);
            prevBtn.onclick = () => { if (currentIndex > 0) renderSlide(currentIndex - 1); };
        }
    });
})();
