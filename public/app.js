console.log('[App] Version: 2.1 - Fix ReferenceError');

// --- Configuration ---
const API_BASE = window.location.origin.includes('localhost') ? 'http://localhost:3030/api' : '/api';
const SUPABASE_URL = 'https://czfjbmkjnodonmtjvwep.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6ZmpibWtqbm9kb25tdGp2d2VwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NjA5MzQsImV4cCI6MjA4ODUzNjkzNH0.R8syO-AS9CcIrP3tYBFO9PTs388UG7rs6SCoVx1Sb4A';
const baseUrl = '/';

// --- Global State ---
let currentCourse = null;
let currentCourseData = { screens: [] };
let selectedSlideIndex = -1;
let selectedSlidesIndices = new Set();
let supabaseClient = null;

// Initialize Supabase Client (Frontend)
if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[App] Supabase Frontend initialized');
}

// --- DOM Elements ---
const courseSelector = document.getElementById('course-selector');
const slidesList = document.getElementById('slides-list');
const editorForm = document.getElementById('editor-form');
const noSelection = document.getElementById('no-selection');
const saveBtn = document.getElementById('save-btn');
const previewCourseBtn = document.getElementById('preview-course-btn');
const toast = document.getElementById('toast');
const selectAllSlides = document.getElementById('select-all-slides');
const bulkActions = document.getElementById('bulk-actions');
const bulkMinDelay = document.getElementById('bulk-min-delay');
const applyBulkDelayBtn = document.getElementById('apply-bulk-delay');
const slideTitle = document.getElementById('slide-title');
const slideContent = document.getElementById('slide-content');
const slideBg = document.getElementById('slide-bg');
const audioUpload = document.getElementById('audio-upload');
const audioFilename = document.getElementById('audio-filename');
const audioPath = document.getElementById('audio-path');
const waitForAudio = document.getElementById('wait-for-audio');
const minDelay = document.getElementById('min-delay');
const isQuestion = document.getElementById('is-question');
const questionText = document.getElementById('question-text');
const questionFields = document.getElementById('question-fields');
const questionFeedback = document.getElementById('question-feedback');
const optionsContainer = document.getElementById('options-container');
const addOptionBtn = document.getElementById('add-option-btn');
const uploadCourseBtn = document.getElementById('upload-course-btn');
const deleteCourseBtn = document.getElementById('delete-course-btn');
const courseFileInput = document.getElementById('course-file-input');

// Confirm Modal
const confirmModal = document.getElementById('confirm-modal');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const confirmOk = document.getElementById('confirm-ok');
const confirmCancel = document.getElementById('confirm-cancel');

// --- Initialization ---
async function init() {
    console.log('[App] Initializing Course Editor...');
    try {
        const response = await fetch(`${API_BASE}/courses`);
        if (!response.ok) throw new Error('Failed to fetch courses');
        const courses = await response.json();
        
        if (courseSelector) {
            while (courseSelector.options.length > 1) courseSelector.remove(1);
            courses.forEach(course => {
                const option = document.createElement('option');
                option.value = course.id;
                option.textContent = course.name;
                courseSelector.appendChild(option);
            });
        }
    } catch (err) {
        console.error('[App] Init Error:', err);
        showToast('נכשל בטעינת רשימת הלומדות מהשרת', 'error');
    }
}

// Course Upload Logic (Direct to Supabase to bypass Vercel 4.5MB limit)
if (uploadCourseBtn) {
    uploadCourseBtn.onclick = () => courseFileInput.click();
}

if (courseFileInput) {
    courseFileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file || !supabaseClient) return;

        const baseName = file.name.replace('.zip', '').replace(/[^a-z0-9_\-\u0590-\u05FF]/gi, '_');
        const courseId = `${baseName}_${Date.now()}`;
        const toastMsg = showPersistentToast('מעלה קובץ ZIP ישירות לענן...', 'info');

        try {
            const { data, error } = await supabaseClient.storage
                .from('course-assets')
                .upload(`temp_zips/${courseId}.zip`, file);

            if (error) throw error;

            console.log('[App] ZIP uploaded, requesting extraction...');
            const processResponse = await fetch(`${API_BASE}/courses/process-zip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseId, baseName, zipPath: `temp_zips/${courseId}.zip` })
            });

            const result = await processResponse.json();
            if (result.success) {
                showToast('הקורס הועלה וטופל בהצלחה!');
                await init();
                if (courseSelector) {
                    courseSelector.value = courseId;
                    courseSelector.dispatchEvent(new Event('change'));
                }
            } else {
                showToast(result.error || 'שגיאה בעיבוד הקורס', 'error');
            }
        } catch (err) {
            console.error('[App] Upload failed:', err);
            showToast(`שגיאת העלאה: ${err.message}`, 'error');
        } finally {
            hidePersistentToast(toastMsg);
            courseFileInput.value = '';
        }
    };
}

if (deleteCourseBtn) {
    deleteCourseBtn.onclick = async () => {
        if (!currentCourse) {
            showToast('בחר לומדה למחיקה', 'info');
            return;
        }

        const courseName = courseSelector.options[courseSelector.selectedIndex].text;
        const confirmed = await showConfirm(
            'מחיקת לומדה',
            `האם אתה בטוח שברצונך למחוק את הלומדה "${courseName}"? כל הקבצים והשקפים יימחקו לצמיתות.`
        );
        if (!confirmed) return;

        const toastMsg = showPersistentToast('מוחק לומדה...', 'info');
        try {
            const response = await fetch(`${API_BASE}/course/${currentCourse}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                showToast('הלומדה נמחקה בהצלחה');
                currentCourse = null;
                currentCourseData = { screens: [] };
                renderSlidesList([]);
                noSelection.classList.remove('hidden');
                editorForm.classList.add('hidden');
                await init();
            } else {
                const result = await response.json();
                showToast(result.error || 'שגיאה במחיקת הלומדה', 'error');
            }
        } catch (err) {
            console.error('[App] Delete failed:', err);
            showToast(`שגיאת מחיקה: ${err.message}`, 'error');
        } finally {
            hidePersistentToast(toastMsg);
        }
    };
}
courseSelector.addEventListener('change', async (e) => {
    const courseId = e.target.value;
    if (!courseId) {
        currentCourse = null;
        renderSlidesList([]);
        return;
    }
    
    currentCourse = courseId;
    selectedSlidesIndices.clear();
    loadCourse(courseId);
});

async function loadCourse(courseId) {
    try {
        console.log('[App] Loading course:', courseId);
        const response = await fetch(`${API_BASE}/course/${courseId}`);
        const data = await response.json();
        console.log('[App] Course data received:', data);
        
        if (data.wasLegacy) {
            showToast('הלומדה הומרה מפורמט ישן. לחץ על שמירה כדי לקבע את השינויים.', 'info');
            currentCourseData = { screens: data.screens };
        } else if (data.legacy) {
            const confirmed = await showConfirm(
                'המרה לפורמט חדש',
                'הלומדה משתמשת בפורמט ישן. האם להמיר אותה לפורמט הניתן לעריכה?'
            );
            if (confirmed) {
                currentCourseData = { 
                    screens: [{ id: 'welcome', title: 'שקף חדש', content: 'תוכן כאן', bgImage: 'assets/scene_welcome.png' }] 
                };
            } else {
                return;
            }
        } else {
            currentCourseData = data;
        }
        
        if (!currentCourseData.screens) {
            console.warn('[App] No screens found in course data, initializing empty array');
            currentCourseData.screens = [];
        }

        console.log(`[App] Rendering ${currentCourseData.screens.length} screens`);
        renderSlidesList(currentCourseData.screens);
        if (currentCourseData.screens.length > 0) selectSlide(0);
        else {
            slidesList.innerHTML = '<li class="empty-list">אין שקופיות בלומדה זו</li>';
        }
    } catch (err) {
        console.error('[App] Load course failed:', err);
        showToast('נכשל בטעינת נתוני הלומדה', 'error');
    }
}

function renderSlidesList(screens) {
    slidesList.innerHTML = '';
    screens.forEach((screen, index) => {
        const li = document.createElement('li');
        
        const leftSide = document.createElement('div');
        leftSide.className = 'slide-item-left';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'slide-checkbox';
        checkbox.checked = selectedSlidesIndices.has(index);
        checkbox.onclick = (e) => {
            e.stopPropagation();
            toggleSlideSelection(index);
        };
        leftSide.appendChild(checkbox);

        const titleSpan = document.createElement('span');
        titleSpan.textContent = `${index + 1}. ${screen.title || 'שקף ללא כותרת'}`;
        leftSide.appendChild(titleSpan);
        
        li.appendChild(leftSide);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.className = 'delete-slide-btn';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteSlide(index);
        };
        li.appendChild(deleteBtn);

        li.onclick = () => selectSlide(index);
        if (selectedSlideIndex === index) li.classList.add('active');
        slidesList.appendChild(li);
    });
    
    updateBulkActionsVisibility();
    updateSelectAllCheckboxState();
}

function toggleSlideSelection(index) {
    if (selectedSlidesIndices.has(index)) {
        selectedSlidesIndices.delete(index);
    } else {
        selectedSlidesIndices.add(index);
    }
    updateBulkActionsVisibility();
    updateSelectAllCheckboxState();
}

function updateBulkActionsVisibility() {
    if (selectedSlidesIndices.size > 1) {
        bulkActions.classList.remove('hidden');
    } else {
        bulkActions.classList.add('hidden');
    }
}

function updateSelectAllCheckboxState() {
    if (currentCourseData.screens.length === 0) {
        selectAllSlides.checked = false;
        selectAllSlides.indeterminate = false;
        return;
    }
    
    const allSelected = selectedSlidesIndices.size === currentCourseData.screens.length;
    const noneSelected = selectedSlidesIndices.size === 0;
    
    selectAllSlides.checked = allSelected;
    selectAllSlides.indeterminate = !allSelected && !noneSelected;
}

selectAllSlides.onchange = (e) => {
    if (e.target.checked) {
        currentCourseData.screens.forEach((_, index) => selectedSlidesIndices.add(index));
    } else {
        selectedSlidesIndices.clear();
    }
    renderSlidesList(currentCourseData.screens);
};

applyBulkDelayBtn.onclick = async () => {
    const delay = parseInt(bulkMinDelay.value) || 0;
    if (selectedSlidesIndices.size === 0) return;
    
    selectedSlidesIndices.forEach(index => {
        if (currentCourseData.screens[index]) {
            currentCourseData.screens[index].minDelay = delay;
        }
    });
    
    showToast(`זמן השהייה עודכן ל-${delay} שניות עבור ${selectedSlidesIndices.size} שקפים`);
    
    // If one of the selected slides is the currently edited one, update the form
    if (selectedSlidesIndices.has(selectedSlideIndex)) {
        minDelay.value = delay;
    }
    
    await saveCourse();
};

async function deleteSlide(index) {
    const confirmed = await showConfirm(
        'מחיקת שקף',
        'האם אתה בטוח שברצונך למחוק את השקף הנוכחי?'
    );
    if (!confirmed) return;
    
    currentCourseData.screens.splice(index, 1);
    
    // Remove from selection if it was selected
    if (selectedSlidesIndices.has(index)) {
        selectedSlidesIndices.delete(index);
    }
    
    // Shift indices of selected slides that come after the deleted one
    const newSelected = new Set();
    selectedSlidesIndices.forEach(idx => {
        if (idx < index) newSelected.add(idx);
        else if (idx > index) newSelected.add(idx - 1);
    });
    selectedSlidesIndices = newSelected;
    
    // Save to server
    await saveCourse();
    
    renderSlidesList(currentCourseData.screens);
    if (selectedSlideIndex >= currentCourseData.screens.length) {
        selectSlide(currentCourseData.screens.length - 1);
    } else {
        selectSlide(selectedSlideIndex);
    }
}

function selectSlide(index) {
    if (index < 0) {
        noSelection.classList.remove('hidden');
        editorForm.classList.add('hidden');
        selectedSlideIndex = -1;
        return;
    }
    
    selectedSlideIndex = index;
    const screen = currentCourseData.screens[index];
    
    if (!screen) return;
    
    // Update active class in list
    Array.from(slidesList.children).forEach((li, i) => {
        li.classList.toggle('active', i === index);
    });
    
    // Show form
    noSelection.classList.add('hidden');
    editorForm.classList.remove('hidden');
    
    // Fill fields
    document.getElementById('current-slide-id-display').textContent = `עריכת שקף: ${screen.id || (index+1)}`;
    slideTitle.value = screen.title || '';
    slideContent.value = screen.content || '';
    slideBg.value = screen.bgImage || '';
    
    // Audio/Delay
    audioPath.value = screen.audio || '';
    audioFilename.textContent = screen.audio ? screen.audio.split('/').pop() : 'לא נבחר קובץ';
    waitForAudio.checked = !!screen.waitForAudio;
    minDelay.value = screen.minDelay || 0;
    
    // Question
    isQuestion.checked = !!screen.question;
    questionText.value = screen.question ? screen.question.text : '';
    questionFeedback.value = (screen.question && screen.question.feedback) ? screen.question.feedback : '';
    renderOptions(screen.question ? screen.question.options : []);
    toggleQuestionFields();
}

function renderOptions(options = []) {
    optionsContainer.innerHTML = '';
    
    // Fallback if options is not an array (e.g. from older data)
    if (!Array.isArray(options)) options = [];
    
    options.forEach((opt, idx) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'option-item';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = opt.text || '';
        input.placeholder = `אפשרות ${idx + 1}`;
        input.oninput = (e) => { opt.text = e.target.value; };
        
        const label = document.createElement('label');
        label.className = `correct-toggle ${opt.correct ? 'is-correct' : ''}`;
        label.innerHTML = `<input type="checkbox" ${opt.correct ? 'checked' : ''}> נכון`;
        label.querySelector('input').onchange = (e) => {
            opt.correct = e.target.checked;
            label.classList.toggle('is-correct', opt.correct);
        };
        
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
        deleteBtn.className = 'remove-option-btn';
        deleteBtn.onclick = () => {
            const screen = currentCourseData.screens[selectedSlideIndex];
            if (screen.question && screen.question.options) {
                screen.question.options.splice(idx, 1);
                renderOptions(screen.question.options);
            }
        };
        
        optionDiv.appendChild(input);
        optionDiv.appendChild(label);
        optionDiv.appendChild(deleteBtn);
        optionsContainer.appendChild(optionDiv);
    });
}

addOptionBtn.onclick = () => {
    if (selectedSlideIndex === -1) return;
    const screen = currentCourseData.screens[selectedSlideIndex];
    screen.question = screen.question || { text: '', options: [], feedback: '' };
    screen.question.options = screen.question.options || [];
    screen.question.options.push({ text: '', correct: false });
    renderOptions(screen.question.options);
};

function toggleQuestionFields() {
    if (isQuestion.checked) {
        questionFields.classList.remove('hidden');
    } else {
        questionFields.classList.add('hidden');
    }
}

function updateCurrentSlideData() {
    if (selectedSlideIndex === -1) return;
    
    const screen = currentCourseData.screens[selectedSlideIndex];
    screen.title = slideTitle.value;
    screen.content = slideContent.value;
    screen.bgImage = slideBg.value;
    screen.audio = audioPath.value;
    screen.waitForAudio = waitForAudio.checked;
    screen.minDelay = parseInt(minDelay.value) || 0;
    
    if (isQuestion.checked) {
        screen.question = screen.question || { text: '', options: [], feedback: '' };
        screen.question.text = questionText.value;
        screen.question.feedback = questionFeedback.value;
        // options are updated in-place during input
    } else {
        delete screen.question;
    }
}

// --- Saving ---

saveBtn.onclick = async () => {
    if (selectedSlideIndex === -1) return;
    
    updateCurrentSlideData();
    
    // Refresh list display
    renderSlidesList(currentCourseData.screens);
    
    // Send to server
    await saveCourse();
};

async function saveCourse() {
    try {
        const response = await fetch(`${API_BASE}/course/${currentCourse}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentCourseData)
        });
        
        if (response.ok) {
            showToast('השינויים נשמרו בהצלחה!');
        } else {
            showToast('שגיאה בשמירת הנתונים', 'error');
        }
    } catch (err) {
        showToast('שגיאה בחיבור לשרת', 'error');
    }
}

// --- Export ---
document.getElementById('export-btn').onclick = async () => {
    if (!currentCourse) return;
    
    showToast('מכין חבילת SCORM...', 'info');
    
    try {
        const response = await fetch(`${API_BASE}/course/${currentCourse}/export`);
        const result = await response.json();
        
        if (result.success) {
            showToast('הייצוא בוצע בהצלחה! מוריד כעת...');
            window.location.href = result.downloadUrl; // result.downloadUrl is already full URL
        } else {
            showToast('שגיאה בייצוא', 'error');
        }
    } catch (err) {
        showToast('שגיאה בחיבור לשרת', 'error');
    }
};

// --- Preview ---
const previewModal = document.getElementById('preview-modal');
const previewFrame = document.getElementById('preview-frame');
const closeModal = document.querySelector('.close-modal');
let previewAudio = null;

document.getElementById('preview-btn').onclick = () => {
    if (selectedSlideIndex === -1) return;
    
    const courseId = currentCourse;
    const title = slideTitle.value;
    const content = slideContent.value;
    const bg = slideBg.value;
    const audio = audioPath.value;
    const storageUrl = `https://czfjbmkjnodonmtjvwep.supabase.co/storage/v1/object/public/course-assets/${courseId}/`;
    const bgUrl = bg ? (bg.startsWith('http') ? bg : storageUrl + bg) : '';
    const audioUrl = audio ? (audio.startsWith('http') ? audio : storageUrl + audio) : '';
    const isQ = isQuestion.checked;
    const qText = questionText.value;
    const screenData = currentCourseData.screens[selectedSlideIndex];
    const optionsHtml = (isQ && screenData.question && screenData.question.options) 
        ? `<div class="mockup-options">
            ${screenData.question.options.map(opt => `<div class="mockup-option">${opt.text || 'אפשרות ריקה'}</div>`).join('')}
          </div>` 
        : '';

    // Inject HTML
    // Use a more robust check for character based on course name or ID
    const courseTitle = courseSelector.options[courseSelector.selectedIndex].text;
    const isInfoSec = (courseTitle.includes('אבטחת מידע') || courseId.toLowerCase().includes('infosec'));
    const charImg = isInfoSec ? 'maya_guide.png' : 'mia_transparent_v4.png';
    const charLabel = isInfoSec ? 'מיה - הממונה על אבטחת מידע' : 'מונה - הממונה על מניעת הטרדה מינית';

    previewFrame.innerHTML = `
        <div class="course-mockup" style="background-image: url('${bgUrl}')">
            <div class="background-overlay"></div>
            <div class="mockup-progress-container"><div class="mockup-progress-bar"></div></div>
            
            <div class="mockup-character-container">
                <img src="${baseUrl}assets/${charImg}" class="mockup-character-img">
                <div class="mockup-label">${charLabel}</div>
            </div>

            <div class="content-area-mockup">
                <div class="screen active">
                    <h1>${isQ ? qText : title}</h1>
                    <div class="content-body">
                        <p>${isQ ? '' : content}</p>
                        ${optionsHtml}
                    </div>
                </div>
                <div class="mockup-nav-internal">
                    <button class="mockup-btn">${isQ ? 'בדוק תשובה' : 'המשך'}</button>
                </div>
            </div>
        </div>
    `;
    
    // Play Audio
    if (audioUrl) {
        if (previewAudio) previewAudio.pause();
        previewAudio = new Audio(audioUrl);
        previewAudio.play().catch(e => console.log('Audio play failed:', e));
    }
    
    previewModal.classList.remove('hidden');
};

    previewCourseBtn.onclick = async () => {
        if (!currentCourse) return;
        window.open(`${API_BASE}/course/${currentCourse}/export`, '_blank');
        showToast('מכין הורדה...', 'info');
    };

const closePreview = () => {
    previewModal.classList.add('hidden');
    if (previewAudio) {
        previewAudio.pause();
        previewAudio = null;
    }
};

closeModal.onclick = closePreview;
window.onclick = (e) => {
    if (e.target === previewModal) closePreview();
    if (e.target === confirmModal) hideConfirm(false);
};

// Custom Confirm Helper
function showConfirm(title, message) {
    return new Promise((resolve) => {
        confirmTitle.textContent = title;
        confirmMessage.textContent = message;
        confirmModal.classList.remove('hidden');
        
        confirmOk.onclick = () => {
            confirmModal.classList.add('hidden');
            resolve(true);
        };
        
        confirmCancel.onclick = () => {
            confirmModal.classList.add('hidden');
            resolve(false);
        };
    });
}

function hideConfirm(value) {
    confirmModal.classList.add('hidden');
}

// --- Audio Upload ---
audioUpload.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!currentCourse) {
        showToast('בחר לומדה תחילה', 'info');
        return;
    }
    
    // For now, let's keep it simple and upload to course-assets bucket using supabaseClient
    showToast('מעלה קובץ...', 'info');
    
    try {
        const filePath = `${currentCourse}/audio/${Date.now()}_${file.name}`;
        const { data, error } = await supabaseClient.storage
            .from('course-assets')
            .upload(filePath, file);
        
        if (error) throw error;
        
        audioPath.value = filePath;
        audioFilename.textContent = file.name;
        showToast('הקובץ הועלה בהצלחה!');
    } catch (err) {
        console.error('[App] Audio upload failed:', err);
        showToast('שגיאה בהעלאת הקובץ', 'error');
    }
};

document.getElementById('add-slide-btn').onclick = () => {
    if (!currentCourse) {
        showToast('בחר לומדה תחילה', 'info');
        return;
    }
    
    const newId = `screen-${currentCourseData.screens.length + 1}`;
    currentCourseData.screens.push({
        id: newId,
        title: 'שקף חדש',
        content: 'הכנס תוכן כאן...',
        bgImage: 'assets/scene_explanation.png'
    });
    
    renderSlidesList(currentCourseData.screens);
    selectSlide(currentCourseData.screens.length - 1);
};

// --- Utils ---
function showToast(message, type = 'success') {
    toast.textContent = message;
    toast.className = type;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

function showPersistentToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = type;
    toast.classList.remove('hidden');
    return message; // Simple way to track
}

function hidePersistentToast(id) {
    toast.classList.add('hidden');
}

init();
