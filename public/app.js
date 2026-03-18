console.log('[App] Version: 2.1 - Fix ReferenceError');

// --- Configuration ---
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
    ? `http://${window.location.hostname}:3030/api` 
    : '/api';
const SUPABASE_URL = 'https://iduyexkzivtnvrdsbwig.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkdXlleGt6aXZ0bnZyZHNid2lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NjYwMTYsImV4cCI6MjA4OTA0MjAxNn0.MhqZwvY7RiOBBqgBhRD-e-SqbI7NIf2vWxNuD5_6e48';
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

// Logo
const logoFieldGroup = document.getElementById('logo-field-group');
const logoUpload = document.getElementById('logo-upload');
const logoFilename = document.getElementById('logo-filename');
const logoPath = document.getElementById('logo-path');
const logoBgColor = document.getElementById('logo-bg-color');
const logoBgColorHex = document.getElementById('logo-bg-color-hex');
const logoPreviewCircle = document.getElementById('logo-preview-circle');
const logoPreviewImg = document.getElementById('logo-preview-img');
const logoPreviewPlaceholder = document.getElementById('logo-preview-placeholder');

// Officer
const officerCard = document.getElementById('officer-details-card');
const officerName = document.getElementById('officer-name');
const officerRole = document.getElementById('officer-role');
const officerPhone = document.getElementById('officer-phone');
const officerEmail = document.getElementById('officer-email');

// Confirm Modal
const confirmModal = document.getElementById('confirm-modal');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const confirmOk = document.getElementById('confirm-ok');
const confirmCancel = document.getElementById('confirm-cancel');

// Upload Modal Elements
const uploadModal = document.getElementById('upload-modal');
const uploadLoadingState = document.getElementById('upload-loading-state');
const uploadSuccessState = document.getElementById('upload-success-state');
const uploadStatus = document.getElementById('upload-status');
const openNewCourseBtn = document.getElementById('open-new-course-btn');

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

// Update the breadcrumb
function updateBreadcrumb() {
    const breadcrumb = document.getElementById('course-name-breadcrumb');
    if (breadcrumb && currentCourse) {
        const name = courseSelector.options[courseSelector.selectedIndex]?.text || currentCourse;
        breadcrumb.textContent = `עורך לומדה: ${name}`;
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
        
        // Setup UI
        uploadStatus.textContent = 'מתחיל העלאה לענן...';
        uploadLoadingState.classList.remove('hidden');
        uploadSuccessState.classList.add('hidden');
        uploadModal.classList.remove('hidden');

        try {
            uploadStatus.textContent = 'מעלה קובץ ZIP לשרת לעיבוד (עקיפת שגיאות ענן)...';
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('baseName', baseName);

            const uploadResponse = await fetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: formData
            });

            if (!uploadResponse.ok) {
                const errData = await uploadResponse.json().catch(() => ({}));
                throw new Error(errData.error || `Server returned ${uploadResponse.status}`);
            }

            const result = await uploadResponse.json();
            if (result.success) {
                // Show success state
                const newCourseId = result.courseId;
                uploadLoadingState.classList.add('hidden');
                uploadSuccessState.classList.remove('hidden');
                
                openNewCourseBtn.onclick = async () => {
                    uploadModal.classList.add('hidden');
                    await init(); // Refresh course list
                    courseSelector.value = newCourseId;
                    courseSelector.dispatchEvent(new Event('change'));
                };
            } else {
                throw new Error(result.error || 'שגיאה בעיבוד הקורס');
            }
        } catch (err) {
            console.error('[App] Upload failed:', err);
            showToast(`שגיאת העלאה: ${err.message}`, 'error');
            uploadModal.classList.add('hidden');
        } finally {
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
    updateBreadcrumb();
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
        titleSpan.className = 'slide-title-text';
        titleSpan.textContent = screen.title || 'שקף ללא כותרת';
        leftSide.appendChild(titleSpan);
        
        li.appendChild(leftSide);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="far fa-trash-alt"></i>';
        deleteBtn.className = 'delete-slide-btn';
        deleteBtn.title = 'מחק שקף';
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
    
    // Ensure data from form is captured first
    updateCurrentSlideData();

    selectedSlidesIndices.forEach(index => {
        if (currentCourseData.screens[index]) {
            currentCourseData.screens[index].minDelay = delay;
        }
    });
    
    showToast(`זמן השהייה עודכן ל-${delay} שניות עבור ${selectedSlidesIndices.size} שקפים`);
    
    // If one of the selected slides is the currently edited one, update the form field visually
    if (selectedSlidesIndices.has(selectedSlideIndex)) {
        minDelay.value = delay;
    }
    
    // Refresh the list to reflect any changes if needed (though delays are not shown in list)
    renderSlidesList(currentCourseData.screens);
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

    // Show/Hide special fields
    if (index === 0) {
        logoFieldGroup.classList.remove('hidden');
        logoPath.value = screen.logo || '';
        logoFilename.textContent = screen.logo ? screen.logo.split('/').pop() : 'לא נבחר לוגו';
        
        const currentLogoColor = screen.logoBgColor || '#38bdf8';
        logoBgColor.value = currentLogoColor;
        logoBgColorHex.textContent = currentLogoColor;
        
        updateLogoPreview();
    } else {
        logoFieldGroup.classList.add('hidden');
    }

    if (screen.id === 'officer_details') {
        officerCard.classList.remove('hidden');
        officerName.value = screen.officer?.name || '';
        officerRole.value = screen.officer?.role || '';
        officerPhone.value = screen.officer?.phone || '';
        officerEmail.value = screen.officer?.email || '';
    } else {
        officerCard.classList.add('hidden');
    }
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
        input.placeholder = `הכנס אפשרות ${idx + 1}...`;
        input.oninput = (e) => { opt.text = e.target.value; };
        
        const label = document.createElement('label');
        label.className = `correct-toggle ${opt.correct ? 'is-correct' : ''}`;
        label.innerHTML = `<i class="fas ${opt.correct ? 'fa-check-circle' : 'fa-circle'}"></i> <span>תשובה נכונה</span>`;
        label.onclick = (e) => {
            opt.correct = !opt.correct;
            label.classList.toggle('is-correct', opt.correct);
            label.querySelector('i').className = `fas ${opt.correct ? 'fa-check-circle' : 'fa-circle'}`;
        };
        
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
        deleteBtn.className = 'upload-btn';
        deleteBtn.style.padding = '8px';
        deleteBtn.style.background = 'transparent';
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

    // Logo (only for first slide)
    if (selectedSlideIndex === 0) {
        screen.logo = logoPath.value;
        screen.logoBgColor = logoBgColor.value;
    }

    // Officer Details
    if (screen.id === 'officer_details') {
        screen.officer = {
            name: officerName.value,
            role: officerRole.value,
            phone: officerPhone.value,
            email: officerEmail.value
        };
    }
}

// --- Saving ---

saveBtn.onclick = async () => {
    if (selectedSlideIndex === -1) return;
    
    saveBtn.disabled = true;
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';
    
    try {
        updateCurrentSlideData();
        renderSlidesList(currentCourseData.screens);
        await saveCourse();
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
    }
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
document.getElementById('export-btn').onclick = function() {
    if (!currentCourse) {
        showToast('בחר לומדה תחילה', 'info');
        return;
    }
    
    const btn = this;
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> מכין הורדה...';
    
    showToast('מכין חבילת SCORM להורדה...', 'info');
    
    // We use a link to trigger the download, but the timeout is to reset the button
    setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }, 5000);

    window.location.href = `${API_BASE}/course/${currentCourse}/export`;
};

// --- Assets Helper ---
function getAssetUrl(pth) {
    if (!pth || !currentCourse) return pth;
    if (pth.startsWith('http') || pth.startsWith('blob:') || pth.startsWith('data:')) return pth;

    const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/course-assets/${currentCourse}/`;
    
    // Strip leading course ID if it exists and duplicated
    let clean = pth;
    if (currentCourse && clean.startsWith(currentCourse + '/')) {
        clean = clean.substring(currentCourse.length + 1);
    }
    
    // Final slash-cleaning and encoding
    clean = clean.replace(/\/+/g, '/').replace(/^\//, '');
    return storageUrl + encodeURI(clean);
}

// --- Preview Modal ---
const previewModal = document.getElementById('preview-modal');
const previewFrame = document.getElementById('preview-frame');
const closeModal = document.querySelector('.close-modal');
let previewAudio = null;

// --- Preview Logic ---
let previewSlideIdx = 0;
let isFullPreview = false;
let selectedMockupIndex = -1;
let hasSubmittedAnswer = false;
let previewQuestionStates = {};

window.showSlidePreview = async (index, isFull = false) => {
    // Strict audio stopping on slide change
    if (previewAudio) {
        previewAudio.pause();
        previewAudio.currentTime = 0;
        previewAudio = null;
    }

    if (!currentCourseData.screens[index]) return;
    previewSlideIdx = index;
    isFullPreview = isFull;
    
    const screen = currentCourseData.screens[index];
    const isSplash = index === 0 && !screen.content && !screen.question;
    const isEditingThisSlide = !isFull && index === selectedSlideIndex;

    // Restore persistent state for this slide in preview
    const slideId = screen.id || `s${index}`;
    const savedState = previewQuestionStates[slideId];
    if (savedState) {
        selectedMockupIndex = savedState.selectedIndex;
        hasSubmittedAnswer = savedState.hasSubmitted;
    } else {
        selectedMockupIndex = -1;
        hasSubmittedAnswer = false;
    }

    // Use current input values ONLY if it's a single slide preview for the currently selected slide
    const title = isEditingThisSlide ? slideTitle.value : (screen.title || '');
    const content = isEditingThisSlide ? slideContent.value : (screen.content || '');
    const bg = isEditingThisSlide ? slideBg.value : (screen.bgImage || '');
    const audio = isEditingThisSlide ? audioPath.value : (screen.audio || '');
    const isQ = isEditingThisSlide ? isQuestion.checked : !!(screen.question && screen.question.text);
    const qText = isEditingThisSlide ? questionText.value : (screen.question ? screen.question.text : '');

    const bgUrl = getAssetUrl(bg);
    const audioUrl = getAssetUrl(audio);
    const logoRelPath = isEditingThisSlide ? logoPath.value : (screen.logo || '');
    const logoUrl = getAssetUrl(logoRelPath);
    const logoBgColorVal = isEditingThisSlide ? logoBgColor.value : (screen.logoBgColor || '#38bdf8');

    const optionsHtml = (isQ && screen.question && screen.question.options) 
        ? `<div class="mockup-options" id="mockup-options-list">
            ${screen.question.options.map((opt, i) => `<div class="mockup-option" onclick="selectMockupOption(${i})">${opt.text || 'אפשרות ריקה'}</div>`).join('')}
          </div>` 
        : '';

    const courseTitle = courseSelector.options[courseSelector.selectedIndex].text.toLowerCase();
    const isHarassment = courseTitle.includes('הטרדה') || courseTitle.includes('מינית') || currentCourse.toLowerCase().includes('harass') || courseTitle.includes('harass');
    const isInfoSec = courseTitle.includes('אבטחת') || courseTitle.includes('מידע') || courseTitle.includes('פרטיות') || currentCourse.toLowerCase().includes('infosec') || courseTitle.includes('infosec');
    
    const charImg = 'maya_guide.png';
    const charLabel = 'מיה - הממונה על אבטחת מידע';

    const showPrev = isFull && index > 0;
    const showNext = isFull && index < currentCourseData.screens.length - 1;
    const isLast = isFull && index === currentCourseData.screens.length - 1;
    const progress = ((index + 1) / currentCourseData.screens.length) * 100;

    // Splash logic: ONLY if it's the first slide AND has NO content AND NO question.
    // If it has content, it's a content slide with a character, even if it's index 0.
    // (Already calculated as isSplash above)
    // Removed duplicate logoRelPath and logoUrl calculation here since it's done above now.

    let contentHtml = '';
    if (isSplash) {
        contentHtml = `
            <div class="splash-view-mockup" style="text-align: center; direction: rtl;">
                ${logoUrl ? `
                    <div class="logo-circle-mockup" style="width: 120px; height: 120px; margin: 0 auto 20px; background: ${logoBgColorVal}; border-radius: 50%; border: 4px solid rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 0 30px rgba(0,0,0,0.3);">
                        <img src="${logoUrl}" style="max-width: 80%; max-height: 80%; object-fit: contain;">
                    </div>
                ` : `
                    <div class="logo-circle-mockup" style="width: 120px; height: 120px; margin: 0 auto 20px; background: ${logoBgColorVal}; border-radius: 50%; border: 4px solid rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 30px rgba(0,0,0,0.3);">
                        <i class="fas fa-shield-halved" style="font-size: 3rem; color: white;"></i>
                    </div>
                `}
                <h1 style="font-size: 1.8rem; margin-bottom: 15px; color: ${logoBgColorVal};">${title}</h1>
                <p style="font-size: 1rem; line-height: 1.5; color: var(--text-main);">${content}</p>
            </div>
        `;
    } else {
        contentHtml = `
            <div class="screen active">
                <h1>${title}</h1>
                ${isQ ? `<p class="question-text">${qText}</p>` : ''}
                <div class="content-body">
                    ${isQ ? '' : `<p>${content}</p>`}
                    ${(screen.id === 'officer_details') ? `
                        <div class="officer-card-mockup" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(56,189,248,0.2); border-radius: 12px; padding: 15px; margin-top: 10px; font-size: 0.9rem;">
                            <p style="margin-bottom: 5px;"><strong>שם:</strong> ${isEditingThisSlide ? officerName.value : (screen.officer?.name || '')}</p>
                            <p style="margin-bottom: 5px;"><strong>תפקיד:</strong> ${isEditingThisSlide ? officerRole.value : (screen.officer?.role || '')}</p>
                            <p style="margin-bottom: 5px;"><strong>טלפון:</strong> ${isEditingThisSlide ? officerPhone.value : (screen.officer?.phone || '')}</p>
                            <p style="margin-bottom: 0;"><strong>אימייל:</strong> ${isEditingThisSlide ? officerEmail.value : (screen.officer?.email || '')}</p>
                        </div>
                    ` : ''}
                    ${optionsHtml}
                </div>
            </div>
        `;
    }

    const nextBtnText = isSplash ? 'התחל למידה <i class="fas fa-play" style="margin-right:8px;"></i>' : (isLast ? 'סיום לומדה' : 'המשך');

    previewFrame.innerHTML = `
        <div class="course-mockup" style="background-image: url('${bgUrl}')">
            <div class="background-overlay"></div>
            <div class="mockup-progress-container"><div class="mockup-progress-bar" style="width: ${progress}%"></div></div>
            
            <div class="mockup-character-section ${isSplash ? 'splash-char' : ''}" 
                 style="${isSplash ? 'display: none;' : ''}">
                <div class="mockup-character-circle">
                    <img src="${baseUrl}assets/${charImg}" class="mockup-character-img">
                </div>
                <div class="mockup-label">${charLabel}</div>
            </div>

            <div class="content-area-mockup ${isQ ? 'question-mode' : ''} ${isSplash ? 'splash-mode' : ''}" 
                 style="${isSplash ? 'width: 55%; max-width: 700px; left: 50%; top: 45%; transform: translate(-50%, -50%); text-align: center;' : ''}">
                ${contentHtml}
            </div>
            
            <div class="mockup-nav-bar">
                ${showPrev && !isSplash ? '<button class="mockup-btn mockup-btn-prev" onclick="prevPreviewSlide()">הקודם</button>' : ''}
                ${isQ && !hasSubmittedAnswer 
                    ? '<button class="mockup-btn" onclick="checkMockupAnswer()">בדוק תשובה</button>'
                    : (isFull || isSplash
                        ? '<button class="mockup-btn btn-primary" onclick="nextPreviewSlide()">' + nextBtnText + '</button>'
                        : '<button class="mockup-btn" onclick="nextPreviewSlide()">סגור תצוגה</button>')
                }
            </div>
        </div>
    `;

    // Re-apply states if already submitted
    if (isQ && hasSubmittedAnswer) {
        setTimeout(() => {
            const options = document.querySelectorAll('.mockup-option');
            options.forEach((optElem, i) => {
                const optData = screen.question.options[i];
                if (optData.correct) optElem.classList.add('correct');
                else if (i === selectedMockupIndex) optElem.classList.add('incorrect');
                optElem.style.cursor = 'default';
            });

            // Auto-show feedback on re-entry to an answered question
            const correctIdx = (screen.question.options || []).findIndex(o => o.correct);
            const isCorrect = selectedMockupIndex === correctIdx;
            const status = isCorrect ? 'תשובה נכונה' : 'תשובה לא נכונה';
            const feedbackText = screen.question.feedback || (isCorrect ? 'כל הכבוד!' : 'לא נורא, התשובה הנכונה מסומנת בירוק.');
            showMockupFeedback(screen.question.text || "", `${status}<br><br>${feedbackText}`, (isFullPreview || isSplash) ? () => nextPreviewSlide() : null);
        }, 100);
    } else if (isQ && selectedMockupIndex !== -1) {
        setTimeout(() => {
            const options = document.querySelectorAll('.mockup-option');
            if (options[selectedMockupIndex]) options[selectedMockupIndex].classList.add('selected');
        }, 10);
    }

    previewModal.classList.remove('hidden');

    // --- Locking Logic (minDelay & waitForAudio) ---
    const activeNextBtn = previewFrame.querySelector('.mockup-btn.btn-primary') || previewFrame.querySelector('.mockup-btn:not(.mockup-btn-prev)');
    if (activeNextBtn) {
        const mDelay = isEditingThisSlide ? parseInt(minDelay.value) : (screen.minDelay || 0);
        const wAudio = isEditingThisSlide ? waitForAudio.checked : !!screen.waitForAudio;
        
        let aFinished = !wAudio || !audio;
        let tFinished = mDelay <= 0;

        const checkUnlockMockup = () => {
            if (aFinished && tFinished) {
                activeNextBtn.disabled = false;
                activeNextBtn.style.opacity = '1';
                activeNextBtn.style.pointerEvents = 'auto';
            }
        };

        if ((mDelay > 0 || (wAudio && audio)) && !hasSubmittedAnswer && !isQ) {
            activeNextBtn.disabled = true;
            activeNextBtn.style.opacity = '0.5';
            activeNextBtn.style.pointerEvents = 'none';
        }

        if (audioUrl && audioUrl.includes(SUPABASE_URL)) {
            previewAudio = new Audio(audioUrl);
            
            if (wAudio && !hasSubmittedAnswer) {
                previewAudio.onended = () => {
                    aFinished = true;
                    checkUnlockMockup();
                };
            }

            previewAudio.play().catch(e => {
                console.log('Audio play failed:', e);
                aFinished = true;
                checkUnlockMockup();
            });
        }

        if (mDelay > 0 && !hasSubmittedAnswer) {
            setTimeout(() => {
                tFinished = true;
                checkUnlockMockup();
            }, mDelay * 1000);
        }
    } else if (audioUrl && audioUrl.includes(SUPABASE_URL)) {
        previewAudio = new Audio(audioUrl);
        previewAudio.play().catch(e => console.log('Audio play failed:', e));
    }
}

window.nextPreviewSlide = () => {
    if (!isFullPreview) {
        closePreview();
        return;
    }
    
    if (previewSlideIdx < currentCourseData.screens.length - 1) {
        showSlidePreview(previewSlideIdx + 1, true);
    } else {
        showToast('כל הכבוד! סיימת את הלומדה.', 'success');
        closePreview();
    }
};

window.prevPreviewSlide = () => {
    if (previewSlideIdx > 0) {
        showSlidePreview(previewSlideIdx - 1, true);
    }
};

window.selectMockupOption = (index) => {
    if (hasSubmittedAnswer) return;
    
    selectedMockupIndex = index;
    const options = document.querySelectorAll('.mockup-option');
    options.forEach((opt, i) => {
        opt.classList.toggle('selected', i === index);
    });
};

window.checkMockupAnswer = () => {
    if (selectedMockupIndex === -1) {
        showToast('בחר תשובה תחילה', 'info');
        return;
    }
    
    const screen = currentCourseData.screens[previewSlideIdx];
    if (!screen || !screen.question || !screen.question.options) return;
    
    hasSubmittedAnswer = true;
    
    // Save to preview persistent state
    const slideId = screen.id || `s${previewSlideIdx}`;
    previewQuestionStates[slideId] = { selectedIndex: selectedMockupIndex, hasSubmitted: true };
    const selectedOpt = screen.question.options[selectedMockupIndex];
    const isCorrect = selectedOpt && selectedOpt.correct;
    
    const options = document.querySelectorAll('.mockup-option');
    options.forEach((optElem, i) => {
        const optData = screen.question.options[i];
        if (optData.correct) {
            optElem.classList.add('correct');
        } else if (i === selectedMockupIndex) {
            optElem.classList.add('incorrect');
        }
        optElem.style.cursor = 'default';
    });
    
    const questionText = screen.question.text || "";
    if (isCorrect) {
        showMockupFeedback(questionText, 'תשובה נכונה<br><br>כל הכבוד! נכון מאוד.', () => nextPreviewSlide());
    } else {
        const feedback = screen.question.feedback || 'לא נורא, התשובה הנכונה מסומנת בירוק.';
        showMockupFeedback(questionText, `תשובה לא נכונה<br><br>${feedback}`, () => nextPreviewSlide());
    }
    
    // Refresh the nav bar to show "Continue" instead of "Check"
    showSlidePreview(previewSlideIdx, isFullPreview);
};

document.getElementById('preview-btn').onclick = async () => {
    if (selectedSlideIndex === -1) {
        showToast('בחר שקף לתצוגה', 'info');
        return;
    }
    const screen = currentCourseData.screens[selectedSlideIndex];
    if (!screen) return;
    
    const toLoad = [];
    if (screen.bgImage) toLoad.push(getAssetUrl(screen.bgImage));
    if (screen.audio) toLoad.push(getAssetUrl(screen.audio));
    if (selectedSlideIndex === 0 && screen.logo) toLoad.push(getAssetUrl(screen.logo));
    
    await preloadMockupMedia(toLoad.filter(u => u));
    showSlidePreview(selectedSlideIndex, false);
};

previewCourseBtn.onclick = async () => {
    if (!currentCourse) {
        showToast('בחר לומדה תחילה', 'info');
        return;
    }
    
    const toLoad = [];
    currentCourseData.screens.forEach(s => {
        if (s.bgImage) toLoad.push(getAssetUrl(s.bgImage));
        if (s.audio) toLoad.push(getAssetUrl(s.audio));
        if (s.logo) toLoad.push(getAssetUrl(s.logo));
    });
    
    await preloadMockupMedia(toLoad.filter(u => u));
    showSlidePreview(0, true);
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

// --- Logo Upload ---
logoUpload.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!currentCourse) {
        showToast('בחר לומדה תחילה', 'info');
        return;
    }
    
    showToast('מעלה לוגו...', 'info');
    
    try {
        const filePath = `${currentCourse}/logos/${Date.now()}_${file.name}`;
        const { data, error } = await supabaseClient.storage
            .from('course-assets')
            .upload(filePath, file);
        
        if (error) throw error;
        
        logoPath.value = filePath;
        logoFilename.textContent = file.name;
        updateLogoPreview();
        showToast('הלוגו הועלה בהצלחה!');
    } catch (err) {
        console.error('[App] Logo upload failed:', err);
        showToast('שגיאה בהעלאת הלוגו', 'error');
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

function showMockupFeedback(question, message, onContinue = null) {
    const mockup = document.querySelector('.course-mockup');
    if (!mockup) return;

    let modal = document.getElementById('mockup-feedback-modal');
    let backdrop = document.getElementById('mockup-feedback-backdrop');
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'mockup-feedback-modal';
        modal.style.cssText = `
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: #0f172a; padding: 30px; border-radius: 20px; border: 1px solid #38bdf8;
            text-align: center; z-index: 1000; box-shadow: 0 0 50px rgba(0,0,0,0.5); color: white; width: 85%; max-width: 450px;
            direction: rtl; font-family: inherit;
        `;
        mockup.appendChild(modal);
        
        backdrop = document.createElement('div');
        backdrop.id = 'mockup-feedback-backdrop';
        backdrop.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:999; backdrop-filter:blur(3px); border-radius:inherit;';
        mockup.appendChild(backdrop);
    }
    
    backdrop.style.display = 'block';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div style="border-bottom: 2px solid #38bdf8; padding-bottom: 12px; margin-bottom: 15px; text-align: right;">
            <h4 style="color:#38bdf8; margin-bottom:5px; font-size: 1rem;">השאלה:</h4>
            <p style="font-size: 1.1rem; color: #f1f5f9;">${question}</p>
        </div>
        <h3 style="color:#38bdf8; margin-bottom:12px; font-size: 1.3rem;">פידבק</h3>
        <p style="margin-bottom:25px; line-height: 1.4; color: #cbd5e1;">${message}</p>
        <button class="mockup-btn btn-primary" style="width:100%; padding: 12px; border-radius: 50px; background: #38bdf8; color: white; border: none; cursor: pointer; font-weight: bold; font-family: inherit;">המשך ללמידה</button>
    `;
    
    modal.querySelector('button').onclick = () => {
        modal.style.display = 'none';
        backdrop.style.display = 'none';
        if (onContinue) onContinue();
    };
}

async function preloadMockupMedia(urls) {
    const mockup = document.querySelector('.course-mockup');
    // Using a global overlay for preloading
    let loader = document.getElementById('mockup-global-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'mockup-global-loader';
        loader.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: #0f172a; z-index: 10000; display: flex; flex-direction: column;
            justify-content: center; align-items: center; color: white; direction: rtl;
        `;
        document.body.appendChild(loader);
    }
    
    loader.innerHTML = `
        <div class="loader-pulse"></div>
        <h3 style="margin-top: 30px; font-size: 1.4rem;">טוען את הלומדה...</h3>
        <p id="mockup-load-status" style="margin-top: 10px; color: #38bdf8;">מכין קבצי מדיה (0%)...</p>
    `;
    loader.classList.remove('hidden');

    const statusText = loader.querySelector('#mockup-load-status');
    const total = urls.length;
    let count = 0;

    const loaders = urls.map(url => {
        return new Promise(res => {
            const isAudio = url.match(/\.(mp3|wav|m4a|ogg)$/) || url.includes('audio');
            
            const timeout = setTimeout(() => {
                console.warn('[Mockup] Preload timeout:', url);
                count++;
                if(statusText) statusText.innerText = `מכין קבצי מדיה (${Math.round((count/total)*100)}%)...`;
                res();
            }, isAudio ? 2000 : 5000);

            const done = () => {
                clearTimeout(timeout);
                count++;
                if(statusText) statusText.innerText = `מכין קבצי מדיה (${Math.round((count/total)*100)}%)...`;
                res();
            };

            if (isAudio) {
                const a = new Audio();
                a.onloadedmetadata = a.onloadstart = a.onerror = done;
                a.src = url;
                a.load();
            } else {
                const img = new Image();
                img.onload = img.onerror = done;
                img.src = url;
            }
        });
    });

    if (total > 0) {
        // Load in batches
        for (let i = 0; i < loaders.length; i += 10) {
            try {
                await Promise.all(loaders.slice(i, i + 10));
            } catch (e) {
                console.warn('[Mockup] Batch error:', e);
            }
        }
    }
    
    statusText.innerText = 'הטעינה הושלמה!';
    await new Promise(r => setTimeout(r, 600));
    loader.classList.add('hidden');
}

// Helper to convert HEX to RGB with alpha
function hexToRgb(hex, alpha = 1) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Handle Color Picker Change
if (logoBgColor) {
    logoBgColor.addEventListener('input', (e) => {
        logoBgColorHex.textContent = e.target.value;
        updateLogoPreview();
    });
}

function updateLogoPreview() {
    if (!logoPreviewCircle) return;
    
    const color = logoBgColor ? logoBgColor.value : '#38bdf8';
    
    logoPreviewCircle.style.borderColor = 'rgba(255,255,255,0.2)';
    logoPreviewCircle.style.backgroundColor = color;
    logoPreviewCircle.style.boxShadow = `0 0 15px rgba(0,0,0,0.3)`;
    
    if (logoPath && logoPath.value) {
        logoPreviewImg.src = getAssetUrl(logoPath.value);
        logoPreviewImg.style.display = 'block';
        logoPreviewPlaceholder.style.display = 'none';
    } else {
        logoPreviewImg.style.display = 'none';
        logoPreviewPlaceholder.style.display = 'block';
        logoPreviewPlaceholder.style.color = 'white';
    }
}

function hidePersistentToast(id) {
    toast.classList.add('hidden');
}

init();
