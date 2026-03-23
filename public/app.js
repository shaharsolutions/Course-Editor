console.log('[App] Version: 2.2 - Fix 500/413 Upload Errors');

// --- Configuration ---
const API_BASE = '/api';
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
const bulkWaitAudio = document.getElementById('bulk-wait-audio');
const applyBulkAudioLockBtn = document.getElementById('apply-bulk-audio-lock');
const bulkTransparency = document.getElementById('bulk-transparency');
const bulkTransparencyVal = document.getElementById('bulk-transparency-val');
const applyBulkTransparencyBtn = document.getElementById('apply-bulk-transparency');
const selectedCount = document.getElementById('selected-count');
const slideTitle = document.getElementById('slide-title');
const slideContent = document.getElementById('slide-content');
const slideBg = document.getElementById('slide-bg');
const bgUpload = document.getElementById('bg-upload');
const bgFilename = document.getElementById('bg-filename');
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

const splashItem = document.getElementById('splash-item');
const basicSlideFields = document.getElementById('basic-slide-fields');
const slideTransparency = document.getElementById('slide-transparency');
const slideTransparencyVal = document.getElementById('slide-transparency-val');

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
const logoSize = document.getElementById('logo-size');
const logoSizeVal = document.getElementById('logo-size-val');
const logoBgTransparency = document.getElementById('logo-bg-transparency');
const logoBgTransparencyVal = document.getElementById('logo-bg-transparency-val');

// Course Name
const courseNameGroup = document.getElementById('course-name-field-group');
const courseNameInput = document.getElementById('course-name-input');

// Officer
const officerCard = document.getElementById('officer-details-card');
const officerName = document.getElementById('officer-name');
const officerRole = document.getElementById('officer-role');
const officerPhone = document.getElementById('officer-phone');
const officerEmail = document.getElementById('officer-email');

// Alerts & Cards
const addAlertBtn = document.getElementById('add-alert-btn');
const alertsContainer = document.getElementById('alerts-container');
const addCardBtn = document.getElementById('add-card-btn');
const cardsContainer = document.getElementById('cards-container');

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
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server returned ${response.status}`);
        }
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
            uploadStatus.textContent = 'מעלה קובץ ZIP לענן (עקיפת הגבלת נפח)...';
            
            // Sanitize filename for storage key (avoid Hebrew/spaces in S3 keys)
            const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9_\-.]/g, '_');
            const zipPath = `temp_uploads/${Date.now()}_${sanitizedFileName}`;
            
            // Upload directly to Supabase Storage from frontend
            const { data: uploadData, error: uploadError } = await supabaseClient
                .storage
                .from('course-assets')
                .upload(zipPath, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) {
                console.error('[App] Supabase Direct Upload Error:', uploadError);
                throw new Error(`שגיאת העלאה לענן: ${uploadError.message}`);
            }

            uploadStatus.textContent = 'מעבד את הקובץ בשרת...';
            
            // Call the backend to process the ZIP already in storage
            const processResponse = await fetch(`${API_BASE}/courses/process-zip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseId: courseId, // This will be used as the new folder name
                    baseName: baseName,
                    zipPath: zipPath
                })
            });

            if (!processResponse.ok) {
                const errData = await processResponse.json().catch(() => ({}));
                throw new Error(errData.error || `Server returned ${processResponse.status}`);
            }

            const result = await processResponse.json();
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
        globalSettings.classList.add('hidden');
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

        const targetIndex = currentCourseData.screens.findIndex(s => s.title && s.title.includes('פישינג והתחזות'));
        if (targetIndex !== -1) {
            const hasPhishing = currentCourseData.screens.some(s => s.type === 'phishing-test');
            if (!hasPhishing) {
                currentCourseData.screens.splice(targetIndex, 0, {
                    id: 'phishing-auto-added',
                    type: 'phishing-test',
                    title: 'סימולציית פישינג - זיהוי באימייל',
                    content: 'לפניכם דוגמה למייל פישינג. סמנו את כל נורות האזהרה במייל באמצעות לחיצה עליהן.',
                    bgImage: 'assets/bg_content.png',
                    phishing: {
                        flags: ['sender', 'greeting', 'link']
                    }
                });
                // We'll let the user save if they want, but it's now visually in the list
                console.log('[App] Auto-inserted phishing simulation slide before "פישינג והתחזות".');
            }
        }

        console.log(`[App] Rendering ${currentCourseData.screens.length} screens`);
        renderSlidesList(currentCourseData.screens);
        
        // Initialize Splash if not exists
            currentCourseData.splash = {
                title: currentCourseData.name || currentCourseData.screens[0]?.title || 'ברוכים הבאים',
                logo: currentCourseData.screens[0]?.logo || '',
                logoBgColor: currentCourseData.screens[0]?.logoBgColor || '#38bdf8',
                bgImage: currentCourseData.screens[0]?.bgImage || 'bg_welcome.png',
                styles: { transparency: 90 }
            };
        
        selectSplash();
    } catch (err) {
        console.error('[App] Load course failed:', err);
        showToast('נכשל בטעינת נתוני הלומדה', 'error');
    }
}

function renderSlidesList(screens) {
    slidesList.innerHTML = '';
    screens.forEach((screen, index) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.index = index;
        
        li.ondragstart = (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
            setTimeout(() => li.classList.add('dragging'), 0);
        };
        li.ondragend = () => {
            li.classList.remove('dragging');
        };
        li.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const draggingEl = slidesList.querySelector('.dragging');
            if (draggingEl && draggingEl !== li) {
                const bounding = li.getBoundingClientRect();
                const offset = e.clientY - bounding.top - (bounding.height / 2);
                if (offset < 0) {
                    slidesList.insertBefore(draggingEl, li);
                } else {
                    slidesList.insertBefore(draggingEl, li.nextSibling);
                }
            }
        };
        li.ondrop = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const draggingEl = slidesList.querySelector('.dragging');
            if (!draggingEl) return;
            
            const oldIndex = parseInt(draggingEl.dataset.index);
            const items = Array.from(slidesList.children);
            const newIndex = items.indexOf(draggingEl);
            
            if (oldIndex !== newIndex && oldIndex >= 0 && newIndex >= 0) {
                const moved = currentCourseData.screens.splice(oldIndex, 1)[0];
                currentCourseData.screens.splice(newIndex, 0, moved);
                
                if (selectedSlideIndex === oldIndex) selectedSlideIndex = newIndex;
                else if (selectedSlideIndex > oldIndex && selectedSlideIndex <= newIndex) selectedSlideIndex--;
                else if (selectedSlideIndex < oldIndex && selectedSlideIndex >= newIndex) selectedSlideIndex++;
                
                // Re-sync selectedSlidesIndices
                const newSelected = new Set();
                selectedSlidesIndices.forEach(idx => {
                    if (idx === oldIndex) newSelected.add(newIndex);
                    else if (oldIndex < newIndex && idx > oldIndex && idx <= newIndex) newSelected.add(idx - 1);
                    else if (oldIndex > newIndex && idx >= newIndex && idx < oldIndex) newSelected.add(idx + 1);
                    else newSelected.add(idx);
                });
                selectedSlidesIndices = newSelected;
                
                await saveCourse();
                renderSlidesList(currentCourseData.screens);
                selectSlide(selectedSlideIndex);
            }
        };
        
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
        let iconHtml = '';
        if (screen.type === 'phishing-test') iconHtml = '<i class="fas fa-envelope" style="color: #38bdf8; margin-left: 5px;"></i> ';
        else if (screen.question) iconHtml = '<i class="fas fa-question-circle" style="color: #a78bfa; margin-left: 5px;"></i> ';
        else iconHtml = '<i class="far fa-file-alt" style="color: var(--text-dim); margin-left: 5px;"></i> ';
        
        titleSpan.innerHTML = iconHtml + (screen.title || 'שקף ללא כותרת');
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
        if (selectedCount) selectedCount.innerText = selectedSlidesIndices.size;
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

applyBulkAudioLockBtn.onclick = async () => {
    const isLocked = bulkWaitAudio.checked;
    if (selectedSlidesIndices.size === 0) return;
    
    // Ensure data from form is captured first
    updateCurrentSlideData();

    selectedSlidesIndices.forEach(index => {
        if (currentCourseData.screens[index]) {
            currentCourseData.screens[index].waitForAudio = isLocked;
        }
    });

    const statusText = isLocked ? 'מופעל' : 'מבוטל';
    showToast(`נעילת התקדמות לפי קריינות עודכנה ל-${statusText} עבור ${selectedSlidesIndices.size} שקפים`);

    if (selectedSlidesIndices.has(selectedSlideIndex)) {
        waitForAudio.checked = isLocked;
    }

    renderSlidesList(currentCourseData.screens);
    await saveCourse();
};

if (bulkTransparency) {
    bulkTransparency.oninput = (e) => {
        bulkTransparencyVal.textContent = `${e.target.value}%`;
    };
}

applyBulkTransparencyBtn.onclick = async () => {
    const val = parseInt(bulkTransparency.value);
    if (selectedSlidesIndices.size === 0) return;
    
    // Ensure data from form is captured first
    updateCurrentSlideData();

    selectedSlidesIndices.forEach(index => {
        if (currentCourseData.screens[index]) {
            currentCourseData.screens[index].styles = currentCourseData.screens[index].styles || {};
            currentCourseData.screens[index].styles.transparency = val;
        }
    });

    showToast(`שקיפות תיבת הטקסט עודכנה ל-${val}% עבור ${selectedSlidesIndices.size} שקפים`);

    if (selectedSlidesIndices.has(selectedSlideIndex)) {
        slideTransparency.value = val;
        slideTransparencyVal.textContent = `${val}%`;
    }

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
    bgFilename.textContent = screen.bgImage ? screen.bgImage.split('/').pop() : 'לא נבחרה תמונה';
    
    // Transparency
    const tr = (screen.styles && screen.styles.transparency !== undefined) ? screen.styles.transparency : 90;
    slideTransparency.value = tr;
    slideTransparencyVal.textContent = `${tr}%`;
    
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
    renderAlerts(screen.alerts || []);
    renderCards(screen.cards || []);
    window.toggleQuestionFields();

    // Restore fields
    basicSlideFields.classList.remove('hidden');
    logoFieldGroup.classList.add('hidden');
    if (courseNameGroup) courseNameGroup.classList.add('hidden');
    
    // De-select splash item
    splashItem.classList.remove('active');
    splashItem.style.background = 'rgba(56, 189, 248, 0.05)';
    splashItem.style.borderColor = 'rgba(56, 189, 248, 0.1)';

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

function selectSplash() {
    selectedSlideIndex = -100;
    const splash = currentCourseData.splash || { title: '', content: '', styles: { transparency: 90 } };
    
    // Update active state in UI
    Array.from(slidesList.children).forEach(li => li.classList.remove('active'));
    splashItem.classList.add('active');
    splashItem.style.background = 'rgba(56, 189, 248, 0.15)';
    splashItem.style.borderColor = 'rgba(56, 189, 248, 0.3)';
    
    // Show form
    noSelection.classList.add('hidden');
    editorForm.classList.remove('hidden');
    
    // Fill fields
    document.getElementById('current-slide-id-display').textContent = `עריכת מסך פתיחה (Splash)`;
    slideTitle.value = splash.title || currentCourseData.name || '';
    slideContent.value = ''; // We don't use content on splash
    slideBg.value = splash.bgImage || '';
    bgFilename.textContent = splash.bgImage ? splash.bgImage.split('/').pop() : 'לא נבחרה תמונה';
    
    // Transparency
    const tr = (splash.styles && splash.styles.transparency !== undefined) ? splash.styles.transparency : 90;
    slideTransparency.value = tr;
    slideTransparencyVal.textContent = `${tr}%`;
    
    // Audio (Minimal for splash or none)
    audioPath.value = splash.audio || '';
    audioFilename.textContent = splash.audio ? splash.audio.split('/').pop() : 'לא נבחר קובץ';
    waitForAudio.checked = false;
    minDelay.value = 0;
    
    // Hide question/features fields
    isQuestion.checked = false;
    window.toggleQuestionFields();
    officerCard.classList.add('hidden');
    basicSlideFields.classList.add('hidden');
    
    // Show splash-specific fields
    logoFieldGroup.classList.remove('hidden');
    if (courseNameGroup) {
        courseNameGroup.classList.remove('hidden');
        courseNameInput.value = currentCourseData.name || '';
    }
    logoPath.value = splash.logo || '';
    logoFilename.textContent = splash.logo ? splash.logo.split('/').pop() : 'לא נבחר לוגו';
    logoBgColor.value = splash.logoBgColor || '#38bdf8';
    logoBgColorHex.textContent = logoBgColor.value;
    
    // Logo Size
    const sz = splash.logoSize || 150;
    logoSize.value = sz;
    logoSizeVal.textContent = `${sz}px`;
    
    // Logo Transparency
    const alpha = (splash.logoBgTransparency !== undefined) ? splash.logoBgTransparency : 100;
    logoBgTransparency.value = alpha;
    logoBgTransparencyVal.textContent = `${alpha}%`;
    
    updateLogoPreview();
}

splashItem.onclick = selectSplash;

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

function renderAlerts(alerts = []) {
    alertsContainer.innerHTML = '';
    alerts.forEach((alert, idx) => {
        const div = document.createElement('div');
        div.className = 'option-item-vertical glass-card';
        div.style.marginBottom = '15px';
        div.innerHTML = `
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <select style="width: 80px;" onchange="currentCourseData.screens[selectedSlideIndex].alerts[${idx}].type = this.value">
                    <option value="info" ${alert.type === 'info' ? 'selected' : ''}>מידע</option>
                    <option value="warning" ${alert.type === 'warning' ? 'selected' : ''}>אזהרה</option>
                    <option value="danger" ${alert.type === 'danger' ? 'selected' : ''}>סכנה</option>
                </select>
                <input type="text" value="${alert.title || ''}" placeholder="כותרת ההתראה..." oninput="currentCourseData.screens[selectedSlideIndex].alerts[${idx}].title = this.value" style="flex: 1;">
                <button type="button" class="upload-btn" style="padding: 8px; background: transparent;" title="מחק התראה" onclick="currentCourseData.screens[selectedSlideIndex].alerts.splice(${idx}, 1); renderAlerts(currentCourseData.screens[selectedSlideIndex].alerts)"><i class="fas fa-times"></i></button>
            </div>
            <textarea placeholder="תוכן ההתראה..." oninput="currentCourseData.screens[selectedSlideIndex].alerts[${idx}].text = this.value" style="width: 100%; min-height: 50px; margin-bottom: 8px; font-size: 0.85rem;">${alert.text || ''}</textarea>
            
            <div style="display: flex; gap: 15px; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <label style="font-size: 0.7rem; color: var(--text-dim); white-space: nowrap;">השהייה (ש')</label>
                    <input type="number" step="0.5" min="0" value="${alert.delay || 0}" oninput="currentCourseData.screens[selectedSlideIndex].alerts[${idx}].delay = parseFloat(this.value) || 0" style="width: 50px; padding: 4px; font-size: 0.8rem;">
                </div>
                <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                    <label style="font-size: 0.7rem; color: var(--text-dim); white-space: nowrap;">אנימציה</label>
                    <select onchange="currentCourseData.screens[selectedSlideIndex].alerts[${idx}].animation = this.value" style="flex: 1; padding: 4px; font-size: 0.8rem;">
                        <option value="fade" ${alert.animation === 'fade' ? 'selected' : ''}>עמעום (Fade)</option>
                        <option value="slide-right" ${alert.animation === 'slide-right' ? 'selected' : ''}>החלקה מימין</option>
                        <option value="pop" ${alert.animation === 'pop' ? 'selected' : ''}>קפיצה (Pop)</option>
                        <option value="bounce" ${alert.animation === 'bounce' ? 'selected' : ''}>הקפצה (Bounce)</option>
                    </select>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.05);">
                <input type="checkbox" id="alert-wait-typing-${idx}" ${alert.waitForTyping ? 'checked' : ''} onchange="currentCourseData.screens[selectedSlideIndex].alerts[${idx}].waitForTyping = this.checked">
                <label for="alert-wait-typing-${idx}" style="font-size: 0.8rem; color: #e2e8f0; cursor: pointer;">הצג רק בסיום הכתיבה</label>
            </div>
        `;
        alertsContainer.appendChild(div);
    });
}

addAlertBtn.onclick = () => {
    if (selectedSlideIndex === -1) return;
    const screen = currentCourseData.screens[selectedSlideIndex];
    screen.alerts = screen.alerts || [];
    screen.alerts.push({ type: 'info', title: '', text: '', delay: 0, animation: 'slide-right' });
    renderAlerts(screen.alerts);
};

function renderCards(cards = []) {
    cardsContainer.innerHTML = '';
    cards.forEach((card, idx) => {
        const div = document.createElement('div');
        div.className = 'option-item-vertical glass-card';
        div.style.marginBottom = '15px';
        div.innerHTML = `
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <input type="text" value="${card.title || ''}" placeholder="כותרת הכרטיסייה..." oninput="currentCourseData.screens[selectedSlideIndex].cards[${idx}].title = this.value" style="flex: 1;">
                <button type="button" class="upload-btn" style="padding: 8px; background: transparent;" onclick="currentCourseData.screens[selectedSlideIndex].cards.splice(${idx}, 1); renderCards(currentCourseData.screens[selectedSlideIndex].cards)"><i class="fas fa-times"></i></button>
            </div>
            <textarea placeholder="תוכן הצד האחורי..." oninput="currentCourseData.screens[selectedSlideIndex].cards[${idx}].text = this.value" style="width: 100%; min-height: 50px;">${card.text || ''}</textarea>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
                <label style="font-size: 0.7rem;">אייקון FontAwesome (למשל fas fa-shield-alt)</label>
                <input type="text" value="${card.icon || 'fas fa-shield-alt'}" oninput="currentCourseData.screens[selectedSlideIndex].cards[${idx}].icon = this.value" style="width: 150px; font-size: 0.8rem;">
            </div>
        `;
        cardsContainer.appendChild(div);
    });
}

addCardBtn.onclick = () => {
    if (selectedSlideIndex === -1) return;
    const screen = currentCourseData.screens[selectedSlideIndex];
    screen.cards = screen.cards || [];
    screen.cards.push({ title: '', text: '', icon: 'fas fa-shield-alt' });
    renderCards(screen.cards);
};

window.toggleQuestionFields = function() {
    if (isQuestion.checked) {
        questionFields.classList.remove('hidden');
    } else {
        questionFields.classList.add('hidden');
    }
};

function updateCurrentSlideData() {
    if (selectedSlideIndex === -1) return;
    
    if (selectedSlideIndex === -100) {
        const splash = currentCourseData.splash = currentCourseData.splash || {};
        splash.title = slideTitle.value;
        splash.content = slideContent.value;
        splash.bgImage = slideBg.value;
        splash.logo = logoPath.value;
        splash.logoBgColor = logoBgColor.value;
        splash.logoSize = parseInt(logoSize.value);
        splash.logoBgTransparency = parseInt(logoBgTransparency.value);
        splash.styles = splash.styles || {};
        splash.styles.transparency = parseInt(slideTransparency.value);
        
        if (courseNameInput) {
            currentCourseData.name = courseNameInput.value;
        }
        return;
    }

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

    // Preserve screen.type if it's already a 'phishing-test'
    // Do not touch screen.phishing state either to avoid bugs

    // Alerts and Cards work in-place via the direct assignments in renderAlerts/renderCards
    // so no explicit sync needed here unless we rebuild the arrays.

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

    // Capture styles
    screen.styles = screen.styles || {};
    screen.styles.transparency = parseInt(slideTransparency.value);
}

// Transparency Event
if (slideTransparency) {
    slideTransparency.oninput = (e) => {
        const val = e.target.value;
        slideTransparencyVal.textContent = `${val}%`;
        
        const screen = (selectedSlideIndex === -100) ? currentCourseData.splash : currentCourseData.screens[selectedSlideIndex];
        if (screen) {
            screen.styles = screen.styles || {};
            screen.styles.transparency = parseInt(val);
            
            // Live Update Mockup
            const mockupContentArea = document.querySelector('.content-area-mockup');
            if (mockupContentArea) {
                mockupContentArea.style.setProperty('background', `rgba(15, 23, 42, ${val / 100})`, 'important');
            }
        }
    };
    
    slideTransparency.onchange = () => {
        saveCourse();
    };
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
            updateBreadcrumb();
            // Refresh selector text
            if (courseSelector && currentCourse) {
                const opt = Array.from(courseSelector.options).find(o => o.value === currentCourse);
                if (opt) opt.textContent = currentCourseData.name;
            }
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

    // Use a hidden anchor to trigger download instead of window.location.href 
    // to bypass certain origin/frame security blocks in some browsers.
    const downloadUrl = `${API_BASE}/course/${currentCourse}/export`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    // Don't set 'download' attribute here as the server sends it via headers 
    // and setting it on cross-origin might be ignored anyway.
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// --- Assets Helper ---
function getAssetUrl(pth) {
    if (!pth || !currentCourse) return pth;
    if (pth.startsWith('http') || pth.startsWith('blob:') || pth.startsWith('data:')) return pth;

    // Check if it's a local system asset
    const systemAssets = ['maya_guide.png', 'mia_transparent_v4.png', 'bg_welcome.png', 'bg_content.png', 'bg_quiz.png', 'bg_summary.png'];
    let clean = pth.split('/').pop();
    if (systemAssets.includes(clean)) {
        return 'assets/' + clean;
    }

    const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/course-assets/${currentCourse}/`;
    
    // Strip leading course ID if it exists and duplicated
    clean = pth;
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

window.toggleMockupCard = (el) => {
    el.classList.toggle('flipped');
};

window.showSlidePreview = async (index, isFull = false) => {
    // Strict audio stopping on slide change
    if (previewAudio) {
        previewAudio.pause();
        previewAudio.currentTime = 0;
        previewAudio = null;
    }

    if (index === -100) {
        const splash = currentCourseData.splash || {};
        previewSlideIdx = -100;
        isFullPreview = false;
        
        const title = splash.title || currentCourseData.name || 'ברוכים הבאים';
        const bg = splash.bgImage || '';
        const bgUrl = getAssetUrl(bg) || (baseUrl + 'assets/bg_welcome.png');
        const logoUrl = getAssetUrl(splash.logo || '');
        const logoBgColorHex = splash.logoBgColor || '#38bdf8';
        const logoAlpha = (splash.logoBgTransparency !== undefined ? splash.logoBgTransparency : 100) / 100;
        const logoBgColorVal = hexToRgba(logoBgColorHex, logoAlpha);
        const logoSz = splash.logoSize || 150;
        const transparencyVal = parseInt(slideTransparency.value) || 90;

        previewFrame.innerHTML = `
            <div class="course-mockup" style="background-image: url('${bgUrl}')">
                <div class="background-overlay"></div>
                <div class="content-area-mockup splash-mode" 
                     style="background: rgba(15, 23, 42, ${transparencyVal / 100}) !important; width: 75% !important; max-width: 900px !important; left: 50% !important; top: 50% !important; transform: translate(-50%, -50%) !important; text-align: center !important;">
                    <div class="splash-view-mockup" style="text-align: center; direction: rtl;">
                        ${logoUrl ? `
                            <div class="logo-circle-mockup" style="width: ${logoSz}px; height: ${logoSz}px; margin: 0 auto 30px; background: ${logoBgColorVal}; border-radius: 50%; border: ${4 * logoAlpha}px solid rgba(255,255,255,${0.2 * logoAlpha}); display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 0 ${30 * logoAlpha}px rgba(0,0,0,${0.3 * logoAlpha});">
                                <img src="${logoUrl}" style="max-width: 80%; max-height: 80%; object-fit: contain;">
                            </div>
                        ` : `
                            <div class="logo-circle-mockup" style="width: ${logoSz}px; height: ${logoSz}px; margin: 0 auto 30px; background: ${logoBgColorVal}; border-radius: 50%; border: ${4 * logoAlpha}px solid rgba(255,255,255,${0.2 * logoAlpha}); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 ${30 * logoAlpha}px rgba(0,0,0,${0.3 * logoAlpha});">
                                <i class="fas fa-shield-halved" style="font-size: ${logoSz/4}px; color: white;"></i>
                            </div>
                        `}
                        <h1 class="cyber-glitch" style="font-size: 2.5rem; color: ${logoBgColorVal}; text-shadow: 0 0 15px rgba(56, 189, 248, 0.4);">${title}</h1>
                    </div>
                </div>
                <div class="mockup-nav-bar" style="justify-content: center;">
                    <button class="mockup-btn btn-primary" onclick="previewModal.classList.add('hidden')">סגור תצוגה מקדימה</button>
                </div>
            </div>
        `;
        previewModal.classList.remove('hidden');
        return;
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

    let bgUrl = getAssetUrl(bg);
    if (!bgUrl || bgUrl === 'none') {
        let fallbackBg = 'bg_content.png';
        if (index === 0) fallbackBg = 'bg_welcome.png';
        else if (isQ) fallbackBg = 'bg_quiz.png';
        else if (index === currentCourseData.screens.length - 1) fallbackBg = 'bg_summary.png';
        bgUrl = baseUrl + 'assets/' + fallbackBg;
    }
    const audioUrl = getAssetUrl(audio);
    const logoRelPath = isEditingThisSlide ? logoPath.value : (screen.logo || '');
    const logoUrl = getAssetUrl(logoRelPath);
    const logoBgColorVal = isEditingThisSlide ? logoBgColor.value : (screen.logoBgColor || '#38bdf8');
    const transparencyVal = isEditingThisSlide ? parseInt(slideTransparency.value) : (screen.styles?.transparency || 90);

    const optionsHtml = (isQ && screen.question && screen.question.options) 
        ? `<div class="mockup-options" id="mockup-options-list">
            ${screen.question.options.map((opt, i) => `<div class="mockup-option" onclick="selectMockupOption(${i})">${opt.text || 'אפשרות ריקה'}</div>`).join('')}
          </div>` 
        : '';

    const alertsHtml = (screen.alerts && screen.alerts.length > 0)
        ? `<div class="alerts-container-mockup" style="margin-top: 15px;">
            ${screen.alerts.map(alert => `
                <div class="alert-box ${alert.type || 'info'}" style="margin-bottom: 10px; padding: 12px; border-radius: 10px; border-right: 4px solid; background: rgba(0,0,0,0.2); font-size: 0.85rem;">
                    <div class="alert-content">
                        <strong style="display: block; margin-bottom: 4px;"><i class="${alert.type === 'danger' ? 'fas fa-exclamation-triangle' : (alert.type === 'warning' ? 'fas fa-exclamation-circle' : 'fas fa-info-circle')}"></i> ${alert.title || ''}</strong>
                        <span>${alert.text || ''}</span>
                    </div>
                </div>
            `).join('')}
          </div>`
        : '';

    const cardsHtml = (screen.cards && screen.cards.length > 0)
        ? `<div class="info-cards-container">
            ${screen.cards.map(card => `
                <div class="info-card" onclick="toggleMockupCard(this)">
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
    } else if (screen.type === 'phishing-test') {
        const totalFlagsMock = 3;
        contentHtml = `
            <div class="screen active" style="text-align: right; direction: rtl; display: flex; flex-direction: column; height: 100%; flex: 1; min-height: 0; overflow: hidden;">
                <div style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px;">
                    <p style="margin: 0; font-size: 1.15rem; font-weight: 600; color: #e2e8f0; line-height: 1.4;">${content}</p>
                    <div class="phishing-counter" style="align-self: flex-start; margin: 0; padding: 6px 16px; background: rgba(56, 189, 248, 0.1); border: 1px solid #38bdf8; border-radius: 20px; color: #38bdf8; font-size: 0.95rem; white-space: nowrap;">
                        מצא תקלות אבטחה: <strong id="phishing-counter-text" style="color: white; margin-right: 5px;">0 מתוך ${totalFlagsMock}</strong>
                    </div>
                </div>
                
                <!-- Feedback placeholder matching the real implementation -->
                <div id="phishing-feedback-area" style="max-height: 25vh; overflow-y: auto; margin-bottom: 10px; flex-shrink: 0;"></div>
                
                <div class="email-mockup" style="font-size: 0.85rem; overflow-y: auto; color: #1e293b; background: #ffffff; flex: 1; min-height: 0; display: flex; flex-direction: column;">
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
                        <div style="display: flex; gap: 15px; direction: rtl;">
                            <div style="color: #64748b; opacity: 0.6;"><i class="fas fa-reply" style="margin-left: 5px;"></i>השב</div>
                            <div style="color: #64748b; opacity: 0.6;"><i class="fas fa-reply-all" style="margin-left: 5px;"></i>השב לכולם</div>
                            <div style="color: #64748b; opacity: 0.6;"><i class="fas fa-share" style="margin-left: 5px;"></i>העבר</div>
                            <div style="color: #64748b; opacity: 0.6;"><i class="fas fa-trash" style="margin-left: 5px;"></i>מחק</div>
                        </div>
                        <button class="btn-report locked" style="background: #ef4444; color: white; padding: 6px 15px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-family: Assistant; opacity: 0.5; box-shadow: 0 4px 10px rgba(239,68,68,0.3); font-size: 0.85rem;">
                            <i class="fas fa-exclamation-triangle" style="margin-left: 5px;"></i>דווח פישינג
                        </button>
                    </div>
                    
                    <div class="email-header" style="flex-shrink: 0; background: #ffffff; padding: 15px 20px;">
                        <div class="email-header-row" style="margin-bottom: 8px;">
                            <div class="email-header-label" style="width: 50px;">מאת:</div>
                            <div class="sender-pill" style="padding: 2px 10px 2px 12px;">
                                <div class="sender-icon" style="width: 20px; height: 20px; font-size: 0.6rem;"><i class="fas fa-user"></i></div>
                                <span style="font-size: 0.9rem;">שירות לקוחות</span>
                                <span style="margin-right: 6px; color: #2563eb; direction: ltr; padding-right: 6px; font-size: 0.9rem;">&lt;service@paypa1.co.il&gt;</span>
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
                    <div class="email-body" style="flex: 1; overflow-y: auto; padding: 12px 20px; line-height: 1.5; color: #334155; pointer-events: auto;">
                        <p style="margin-bottom: 12px; color: #334155;">שלום <span style="color:#ef4444; border-bottom:1px dashed #ef4444; padding: 2px 4px; border-radius: 4px;">לקוח יקר</span>,</p>
                        <p style="margin-bottom: 12px; color: #334155;">זיהינו פעילות חריגה בחשבון שלך ממכשיר לא מזוהה. מטעמי אבטחה, החשבון שלך הוגבל באופן זמני.</p>
                        <p style="margin-bottom: 18px; color: #334155;">אנא הקלק על הקישור הבא לאימות זהותך. יש לבצע את הפעולה תוך 24 שעות, אחרת חשבונך יינעל לצמיתות:</p>
                        
                        <div style="text-align: center; margin: 20px 0; position: relative;">
                            <span class="phishing-action-btn" style="box-shadow: 0 4px 6px rgba(0,0,0,0.1); font-size: 0.95rem; padding: 10px 25px; display: inline-block;">התחברות לאימות מהיר</span>
                        </div>
                        
                        <p style="margin-bottom: 3px; color: #334155;">בברכה,</p>
                        <p style="color: #6b7280; font-size: 0.85rem; margin-bottom: 0;">צוות התמיכה והאבטחה</p>
                    </div>
                </div>
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
                    ${alertsHtml}
                    ${cardsHtml}
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

            <div class="content-area-mockup ${isQ ? 'question-mode' : ''} ${isSplash ? 'splash-mode' : ''} ${screen.type === 'phishing-test' ? 'phishing-mode' : ''}" 
                 style="background: rgba(15, 23, 42, ${transparencyVal / 100}) !important; ${isSplash ? 'width: 75% !important; max-width: 900px !important; left: 50% !important; top: 50% !important; transform: translate(-50%, -50%) !important; text-align: center !important;' : ''}">
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

    // Ensure we show the mockup frame and hide the full iframe when doing slide preview
    const fullIframe = document.getElementById('preview-iframe-full');
    const mockupDiv = document.getElementById('preview-frame');
    if (fullIframe) fullIframe.classList.add('hidden');
    if (mockupDiv) mockupDiv.classList.remove('hidden');

    previewModal.classList.remove('hidden');
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
        showMockupFeedback(questionText, `<span class="feedback-status correct">תשובה נכונה</span><br><br>כל הכבוד! נכון מאוד.`, () => nextPreviewSlide());
    } else {
        const feedback = screen.question.feedback || 'לא נורא, התשובה הנכונה מסומנת בירוק.';
        showMockupFeedback(questionText, `<span class="feedback-status incorrect">תשובה לא נכונה</span><br><br>${feedback}`, () => nextPreviewSlide());
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
    
    // Ensure latest data from the editor is available
    updateCurrentSlideData();

    // Set up session storage for the player to read
    sessionStorage.setItem('previewCourseData', JSON.stringify(currentCourseData));
    sessionStorage.setItem('previewCourseId', currentCourse);

    const fullIframe = document.getElementById('preview-iframe-full');
    const mockupDiv = document.getElementById('preview-frame');
    
    // Show Iframe, hide Mockup elements
    if (fullIframe) {
        fullIframe.src = `player/index.html?preview=true&t=${Date.now()}`;
        fullIframe.classList.remove('hidden');
    }
    if (mockupDiv) mockupDiv.classList.add('hidden');

    previewModal.classList.remove('hidden');
};

const closePreview = () => {
    previewModal.classList.add('hidden');
    
    const fullIframe = document.getElementById('preview-iframe-full');
    const mockupDiv = document.getElementById('preview-frame');
    
    if (fullIframe) {
        fullIframe.classList.add('hidden');
        fullIframe.src = 'about:blank';
    }
    if (mockupDiv) {
        mockupDiv.classList.remove('hidden');
    }

    if (previewAudio) {
        previewAudio.pause();
        previewAudio = null;
    }
    
    // Cleanup preview storage
    sessionStorage.removeItem('previewCourseData');
    sessionStorage.removeItem('previewCourseId');
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
        const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9_\-.]/g, '_');
        const filePath = `${currentCourse}/audio/${Date.now()}_${sanitizedFileName}`;
        const { data, error } = await supabaseClient.storage
            .from('course-assets')
            .upload(filePath, file);
        
        if (error) throw error;
        
        audioPath.value = filePath;
        audioFilename.textContent = file.name;
        
        // Save immediately
        if (selectedSlideIndex !== -1 && selectedSlideIndex !== -100) {
            currentCourseData.screens[selectedSlideIndex].audio = filePath;
        } else if (selectedSlideIndex === -100) {
            currentCourseData.splash.audio = filePath;
        }
        await saveCourse();
        
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
        const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9_\-.]/g, '_');
        const filePath = `${currentCourse}/logos/${Date.now()}_${sanitizedFileName}`;
        const { data, error } = await supabaseClient.storage
            .from('course-assets')
            .upload(filePath, file);
        
        if (error) throw error;
        
        logoPath.value = filePath;
        logoFilename.textContent = file.name;
        updateLogoPreview();
        
        // Save immediately so Export gets the latest
        if (selectedSlideIndex === -100) {
            currentCourseData.splash.logo = filePath;
        }
        await saveCourse();
        
        showToast('הלוגו הועלה בהצלחה!');
    } catch (err) {
        console.error('[App] Logo upload failed:', err);
        showToast('שגיאה בהעלאת הלוגו', 'error');
    }
};

// --- Background Upload ---
bgUpload.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!currentCourse) {
        showToast('בחר לומדה תחילה', 'info');
        return;
    }
    
    showToast('מעלה תמונת רקע...', 'info');
    
    try {
        const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9_\-.]/g, '_');
        const filePath = `${currentCourse}/assets/${Date.now()}_${sanitizedFileName}`;
        const { data, error } = await supabaseClient.storage
            .from('course-assets')
            .upload(filePath, file);
        
        if (error) throw error;
        
        slideBg.value = filePath;
        bgFilename.textContent = file.name;
        
        // Auto-save the change to the current screen object
        if (selectedSlideIndex === -100) {
            currentCourseData.splash.bgImage = filePath;
        } else if (selectedSlideIndex !== -1) {
            currentCourseData.screens[selectedSlideIndex].bgImage = filePath;
        }
        await saveCourse();
        
        showToast('תמונת הרקע הועלתה בהצלחה!');
    } catch (err) {
        console.error('[App] Background upload failed:', err);
        showToast('שגיאה בהעלאת התמונה', 'error');
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
            direction: rtl; font-family: inherit; max-height: 90%; overflow-y: auto;
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
            <h4 style="color:#38bdf8; margin-bottom:5px; font-size: 1rem;">${question === "שימו לב" ? "" : "השאלה:"}</h4>
            <p style="font-size: 1.1rem; color: #f1f5f9;">${question}</p>
        </div>
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
        if (selectedSlideIndex === -100) {
            currentCourseData.splash.logoBgColor = e.target.value;
        }
        updateLogoPreview();
    });

    logoSize.addEventListener('input', (e) => {
        const sz = e.target.value;
        logoSizeVal.textContent = `${sz}px`;
        if (selectedSlideIndex === -100) {
            currentCourseData.splash.logoSize = parseInt(sz);
        }
    });

    logoBgTransparency.addEventListener('input', (e) => {
        const tr = e.target.value;
        logoBgTransparencyVal.textContent = `${tr}%`;
        if (selectedSlideIndex === -100) {
            currentCourseData.splash.logoBgTransparency = parseInt(tr);
        }
        updateLogoPreview();
    });
}

function hexToRgba(hex, alpha = 1) {
    if (!hex || !hex.startsWith('#')) return `rgba(56, 189, 248, ${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
