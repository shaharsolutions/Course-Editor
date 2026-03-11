/**
 * Modern Core Logic for LMS Modules
 * Supports dynamic JSON data, audio narration, and SCORM Resume/Bookmark.
 */

document.addEventListener('DOMContentLoaded', async () => {
    let screens = [];
    let currentScreenIndex = 0;
    let score = 0;
    let answeredQuestions = 0;
    let currentAudio = null;

    const appContainer = document.getElementById('app-container');
    const contentArea = document.getElementById('content-area');
    const progressBar = document.getElementById('progress-bar');
    const progressContainer = document.getElementById('progress-container');
    const nextBtn = document.getElementById('next-btn');
    const prevBtn = document.getElementById('prev-btn');
    const navContainer = document.getElementById('nav-container');

    // --- SCORM Initialization ---
    if (window.SCORM) {
        SCORM.init();
    }

    // --- Data Loading ---
    async function loadCourseData() {
        try {
            const response = await fetch('data.json');
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            screens = data.screens;
            return true;
        } catch (err) {
            console.error('Failed to load course data:', err);
            
            // Handle CORS / Local File error display
            if (window.location.protocol === 'file:') {
                contentArea.innerHTML = `
                    <div style="padding: 30px; background: rgba(255,0,0,0.05); border-radius: 12px; border: 1px solid rgba(255,0,0,0.3); margin: 20px; text-align: center; font-family: Assistant, sans-serif;">
                        <h2 style="color: #d32f2f;">שגיאת דפדפן: הרצה מקומית חסומה</h2>
                        <p style="font-size: 1.1rem; line-height: 1.6;">דפדפנים מודרניים חוסמים טעינת נתונים מסיבות אבטחה כאשר פותחים לומדה ישירות מהמחשב (file://).</p>
                        <p style="font-weight: 700; color: #388e3c; font-size: 1.2rem; margin: 15px 0;">אל דאגה! הלומדה תעבוד בצורה תקינה לחלוטין ברגע שתעלה אותה ל-LMS.</p>
                        <p>כדי לבדוק את הלומדה כרגע, השתמש בכפתור ה-"תצוגה מקדימה" בתוך ממשק העריכה.</p>
                        <hr style="margin: 20px 0; opacity: 0.2;">
                        <p style="font-size: 0.9rem; opacity: 0.7;">שגיאה טכנית: ${err.message}</p>
                    </div>
                `;
            } else {
                contentArea.innerHTML = `
                    <div style="padding: 20px; text-align: center;">
                        <p>שגיאה בטעינת נתוני הלומדה. וודא שקובץ <strong>data.json</strong> קיים ותקין בתיקיית הלומדה.</p>
                    </div>
                `;
            }
            return false;
        }
    }

    // --- Audio & Delay Control ---
    function stopAudio() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
    }

    function playNarration(audioPath, waitForEnd, minDelay) {
        stopAudio();
        
        let audioFinished = !waitForEnd;
        let timeFinished = minDelay <= 0;

        const checkUnlock = () => {
            if (audioFinished && timeFinished) {
                nextBtn.disabled = false;
                nextBtn.style.opacity = '1';
            }
        };

        if (minDelay > 0 || waitForEnd) {
            nextBtn.disabled = true;
            nextBtn.style.opacity = '0.5';
        }

        if (audioPath) {
            // encodeURI is crucial for Hebrew/Non-ASCII filenames in the browser
            currentAudio = new Audio(encodeURI(audioPath));
            currentAudio.play().catch(e => {
                console.warn('Audio play blocked or file not found:', e);
                // Auto-unlock if audio fails to play
                audioFinished = true;
                checkUnlock();
            });
            
            if (waitForEnd) {
                currentAudio.onended = () => {
                   audioFinished = true;
                   checkUnlock();
                };
            }
        }

        if (minDelay > 0) {
            setTimeout(() => {
                timeFinished = true;
                checkUnlock();
            }, minDelay * 1000);
        }
        
        checkUnlock();
    }

    // --- State & Resume ---
    function saveState() {
        if (window.SCORM && SCORM.connected) {
            const state = { 
                currentScreenIndex, 
                score, 
                answeredQuestions 
            };
            const location = screens[currentScreenIndex].id;
            SCORM.saveProgressState(location, state);
        }
    }

    function restoreState() {
        if (!window.SCORM || !SCORM.connected) return;

        const suspendData = SCORM.getSuspendData();
        const bookmark = SCORM.getBookmark();

        if (suspendData && typeof suspendData === 'object') {
            currentScreenIndex = suspendData.currentScreenIndex || 0;
            score = suspendData.score || 0;
            answeredQuestions = suspendData.answeredQuestions || 0;
        } else if (bookmark) {
            const foundIndex = screens.findIndex(s => s.id === bookmark);
            if (foundIndex !== -1) currentScreenIndex = foundIndex;
        }
    }

    // --- Rendering ---
    function updateProgress() {
        const progress = ((currentScreenIndex + 1) / screens.length) * 100;
        if (progressBar) progressBar.style.width = `${progress}%`;
        
        if (window.SCORM && SCORM.connected) {
            const decimalProgress = (currentScreenIndex + 1) / screens.length;
            SCORM.set("cmi.core.progress_measure", decimalProgress.toFixed(2));
        }
    }

    function renderScreen(index) {
        currentScreenIndex = index;
        const screen = screens[index];
        contentArea.innerHTML = '';
        updateProgress();

        if (screen.bgImage) {
            // Support Hebrew/Non-ASCII characters in background image paths
            appContainer.style.backgroundImage = `url('${encodeURI(screen.bgImage)}')`;
        }

        const screenDiv = document.createElement('div');
        screenDiv.className = 'screen active';
        screenDiv.innerHTML = `<h1>${screen.title}</h1>`;

        if (screen.content) {
            const p = document.createElement('p');
            p.textContent = screen.content;
            screenDiv.appendChild(p);
        }

        if (screen.question) {
            const qDiv = document.createElement('div');
            qDiv.className = 'question-card';
            qDiv.innerHTML = `<p style="font-weight:600">${screen.question.text}</p>`;
            
            screen.question.options.forEach((opt, i) => {
                const btn = document.createElement('button');
                btn.className = 'option-btn';
                btn.textContent = opt.text;
                btn.onclick = () => handleAnswer(btn, opt, screen.question.feedback);
                qDiv.appendChild(btn);
            });
            screenDiv.appendChild(qDiv);
            nextBtn.style.display = 'none';
        } else {
            nextBtn.style.display = 'block';
            playNarration(screen.audio, !!screen.waitForAudio, screen.minDelay || 0);
        }

        if (screen.id === 'summary' || index === screens.length - 1) {
            const totalQuestions = screens.filter(s => s.question).length;
            const finalScore = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 100;
            
            if (totalQuestions > 0) {
                const scoreP = document.createElement('p');
                scoreP.style.cssText = 'font-size:1.5rem; font-weight:700; color:var(--primary-color); text-align:center';
                scoreP.textContent = `הציון הסופי שלך: ${finalScore}%`;
                screenDiv.appendChild(scoreP);
            }
            
            nextBtn.textContent = 'סיום ויציאה';
            nextBtn.onclick = () => { 
                if(window.SCORM) {
                    SCORM.setScore(finalScore);
                    SCORM.setComplete();
                    SCORM.finish();
                } 
                window.close(); 
            };
        } else {
            nextBtn.textContent = 'המשך';
            nextBtn.onclick = () => {
                if (currentScreenIndex < screens.length - 1) {
                    renderScreen(currentScreenIndex + 1);
                    saveState();
                }
            };
        }

        contentArea.appendChild(screenDiv);
        prevBtn.style.display = index === 0 ? 'none' : 'block';
    }

    function handleAnswer(clickedBtn, option, feedback) {
        const btns = clickedBtn.parentElement.querySelectorAll('.option-btn');
        btns.forEach(b => b.disabled = true);

        if (option.correct) {
            clickedBtn.classList.add('correct');
            score++;
        } else {
            clickedBtn.classList.add('incorrect');
            const correctOpt = screens[currentScreenIndex].question.options.find(o => o.correct);
            btns.forEach((b, i) => {
                if (screens[currentScreenIndex].question.options[i].correct) b.classList.add('correct');
            });
        }

        nextBtn.style.display = 'block';
        nextBtn.disabled = false;
        nextBtn.style.opacity = '1';
        
        answeredQuestions++;
        saveState();
    }

    prevBtn.onclick = () => {
        if (currentScreenIndex > 0) {
            renderScreen(currentScreenIndex - 1);
            saveState();
        }
    };

    // --- Start ---
    const loaded = await loadCourseData();
    if (loaded) {
        restoreState();
        const ld = document.getElementById('loader');
        if (ld) ld.remove();
        navContainer.classList.remove('hidden');
        progressContainer.classList.remove('hidden');
        renderScreen(currentScreenIndex);
    }
});
