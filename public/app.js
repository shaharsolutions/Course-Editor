const API_BASE = 'http://localhost:3030/api';
let currentCourse = null;
let currentCourseData = { screens: [] };
let selectedSlideIndex = -1;

// --- Elements ---
const courseSelector = document.getElementById('course-selector');
const slidesList = document.getElementById('slides-list');
const editorForm = document.getElementById('editor-form');
const noSelection = document.getElementById('no-selection');
const saveBtn = document.getElementById('save-btn');
const previewCourseBtn = document.getElementById('preview-course-btn');
const toast = document.getElementById('toast');

// Form Fields
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

// --- Initialization ---
async function init() {
    try {
        const response = await fetch(`${API_BASE}/courses`);
        const courses = await response.json();
        
        courses.forEach(course => {
            const option = document.createElement('option');
            option.value = course.id;
            option.textContent = course.name;
            courseSelector.appendChild(option);
        });
    } catch (err) {
        showToast('נכשל בטעינת רשימת הלומדות', 'error');
    }
}

courseSelector.addEventListener('change', async (e) => {
    const courseId = e.target.value;
    if (!courseId) {
        currentCourse = null;
        renderSlidesList([]);
        return;
    }
    
    currentCourse = courseId;
    loadCourse(courseId);
});

async function loadCourse(courseId) {
    try {
        const response = await fetch(`${API_BASE}/course/${courseId}`);
        const data = await response.json();
        
        if (data.wasLegacy) {
            showToast('הלומדה הומרה מפורמט ישן. לחץ על שמירה כדי לקבע את השינויים.', 'info');
            currentCourseData = { screens: data.screens };
        } else if (data.legacy) {
            if(confirm('הלומדה משתמשת בפורמט ישן. האם להמיר אותה לפורמט הניתן לעריכה?')) {
                currentCourseData = { 
                    screens: [{ id: 'welcome', title: 'שקף חדש', content: 'תוכן כאן', bgImage: 'assets/scene_welcome.png' }] 
                };
                // Don't auto-save, let the user preview and click save
            } else {
                return;
            }
        } else {
            currentCourseData = data;
        }
        
        renderSlidesList(currentCourseData.screens);
        if (currentCourseData.screens.length > 0) selectSlide(0);
    } catch (err) {
        showToast('נכשל בטעינת נתוני הלומדה', 'error');
    }
}

function renderSlidesList(screens) {
    slidesList.innerHTML = '';
    screens.forEach((screen, index) => {
        const li = document.createElement('li');
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = `${index + 1}. ${screen.title || 'שקף ללא כותרת'}`;
        li.appendChild(titleSpan);
        
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
}

async function deleteSlide(index) {
    if (!confirm('האם אתה בטוח שברצונך למחוק את השקף?')) return;
    
    currentCourseData.screens.splice(index, 1);
    
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
    toggleQuestionFields();
}

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
            window.location.href = `${API_BASE.replace('/api', '')}${result.downloadUrl}`;
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
    
    // Construct URLs
    const baseUrl = API_BASE.replace('/api', '') + '/exports/' + courseId + '/';
    const bgUrl = bg ? (bg.startsWith('http') ? bg : baseUrl + bg) : '';
    const audioUrl = audio ? (audio.startsWith('http') ? audio : baseUrl + audio) : '';
    
    const characterImg = courseId.toLowerCase().includes('infosec') ? 'maya_guide.png' : 'mia.png';
    const characterLabel = courseId.toLowerCase().includes('infosec') ? 'מיה - הממונה על אבטחת מידע' : 'מיה - המלווה שלכם';
    
    // Inject HTML
    previewFrame.innerHTML = `
        <div class="course-mockup" style="background-image: url('${bgUrl}')">
            <div class="background-overlay"></div>
            <div class="mockup-progress-container"><div class="mockup-progress-bar"></div></div>
            <div class="content-area-mockup">
                <div class="screen active">
                    <h1>${title}</h1>
                    <p>${content}</p>
                </div>
            </div>
            <div class="mockup-nav"><button class="mockup-btn">המשך</button></div>
            <div class="mockup-character">
                <div class="mockup-avatar" style="background-image: url('${baseUrl}assets/${characterImg}')"></div>
                <div class="mockup-label">${characterLabel}</div>
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
    
    // Save current changes first to ensure data.json is up to date
    if (selectedSlideIndex !== -1) {
        updateCurrentSlideData();
    }
    
    showToast('שומר נתונים ופותח תצוגה מקדימה...', 'info');
    await saveCourse();
    
    // Open the actual course index.html in a centered popup window
    const baseUrl = API_BASE.replace('/api', '') + '/exports/' + currentCourse + '/index.html';
    const width = 1280;
    const height = 720;
    const left = (window.screen.width / 2) - (width / 2);
    const top = (window.screen.height / 2) - (height / 2);
    
    window.open(baseUrl, 'CoursePreview', 
        `width=${width},height=${height},left=${left},top=${top},scrollbars=no,resizable=yes,status=no,location=no,toolbar=no,menubar=no`);
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
};

// --- Audio Upload ---
audioUpload.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('audio', file);
    
    showToast('מעלה קובץ...', 'info');
    
    try {
        const response = await fetch(`${API_BASE}/course/${currentCourse}/upload-audio`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        
        audioPath.value = result.path;
        audioFilename.textContent = result.filename;
        showToast('הקובץ הועלה בהצלחה!');
    } catch (err) {
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

init();
