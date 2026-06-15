// --- STATE ---
let currentUser = JSON.parse(localStorage.getItem('phr_user')) || null;
let pendingUser = null; 
let currentFilterType = ''; 
let currentFilterValue = '';
let allRecords = [];

let dicomImages = [];
let currentSlice = 0;
let currentViewingRecordId = null;
let authMode = 'login'; 

window.onload = () => {
    if (currentUser) {
        updateNavUI();
        fetchAllRecords().then(() => {
            const savedView = sessionStorage.getItem('phr_active_view');
            if (savedView) {
                const { filterType, filterValue, title } = JSON.parse(savedView);
                openView(filterType, filterValue, title);
            }
        });
    } else {
        openProfileModal();
    }
};

function showHome() {
    document.getElementById('home-view').style.display = 'block';
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('search-input').value = '';
    sessionStorage.removeItem('phr_active_view'); 
    filterRecords(); 
}

function closeModals() {
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
}

// --- AUTHENTICATION LOGIC ---

function setAuthMode(mode) {
    authMode = mode;
    if (mode === 'login') {
        document.getElementById('tab-login').style.fontWeight = '700';
        document.getElementById('tab-login').style.color = 'var(--primary)';
        document.getElementById('tab-login').style.borderBottom = '2px solid var(--primary)';
        
        document.getElementById('tab-register').style.fontWeight = '500';
        document.getElementById('tab-register').style.color = 'var(--text-light)';
        document.getElementById('tab-register').style.borderBottom = 'none';
        
        document.getElementById('register-fields').style.display = 'none';
    } else {
        document.getElementById('tab-register').style.fontWeight = '700';
        document.getElementById('tab-register').style.color = 'var(--primary)';
        document.getElementById('tab-register').style.borderBottom = '2px solid var(--primary)';
        
        document.getElementById('tab-login').style.fontWeight = '500';
        document.getElementById('tab-login').style.color = 'var(--text-light)';
        document.getElementById('tab-login').style.borderBottom = 'none';
        
        document.getElementById('register-fields').style.display = 'block';
    }
}

function resetProfileModal() {
    document.getElementById('auth-section').style.display = 'block';
    document.getElementById('otp-section').style.display = 'none';
    document.getElementById('logged-in-section').style.display = 'none';
    document.getElementById('otp-input').value = '';
    
    const btn = document.getElementById('send-otp-btn');
    btn.innerText = "Send OTP";
    btn.disabled = false;
}

function openProfileModal() {
    resetProfileModal();
    
    if (currentUser) {
        document.getElementById('modal-title').innerText = "My Profile";
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('logged-in-section').style.display = 'block';
        
        // Feed the initial to the gradient circle
        document.getElementById('profile-avatar-large').innerText = currentUser.name.charAt(0).toUpperCase();
        
        document.getElementById('display-name').innerText = currentUser.name;
        document.getElementById('display-email').innerText = currentUser.email;
        document.getElementById('display-age').innerText = currentUser.age;
        document.getElementById('display-sex').innerText = currentUser.sex;
        document.getElementById('display-blood').innerText = currentUser.blood;
    } else {
        document.getElementById('modal-title').innerText = "Authentication";
        document.getElementById('auth-section').style.display = 'block';
        document.getElementById('logged-in-section').style.display = 'none';
        
        document.getElementById('user-email').value = '';
        document.getElementById('user-name').value = '';
        document.getElementById('user-age').value = '';
        document.getElementById('user-sex').value = '';
        document.getElementById('user-blood').value = '';
        
        setAuthMode('login'); 
    }
    
    document.getElementById('profile-modal').style.display = 'flex';
}
async function requestOTP() {
    const email = document.getElementById('user-email').value.trim();
    if (!email) return alert("Email is required.");
    
    let name = "", age = "", sex = "", blood = "";
    
    if (authMode === 'register') {
        name = document.getElementById('user-name').value.trim();
        age = document.getElementById('user-age').value.trim();
        sex = document.getElementById('user-sex').value;
        blood = document.getElementById('user-blood').value.trim();
        
        // Strict enforcement: All fields mandatory
        if (!name || !age || !sex || !blood) {
            return alert("All fields (Name, Age, Sex, Blood Group) are mandatory for registration.");
        }
    }

    pendingUser = { action: authMode, email, name, age, sex, blood };

    const btn = document.getElementById('send-otp-btn');
    const originalText = btn.innerText;
    btn.innerText = "⏳ Requesting...";
    btn.disabled = true;

    try {
        const res = await fetch("/api/send-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, action: authMode })
        });
        
        const data = await res.json();
        
        if (res.ok) {
            document.getElementById('auth-section').style.display = 'none';
            document.getElementById('otp-section').style.display = 'block';
        } else {
            alert(data.error);
        }
    } catch (e) {
        alert("Network error. Is the Python server running?");
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function verifyOTP() {
    const otp = document.getElementById('otp-input').value.trim();
    if (!otp) return alert("Please enter the 6-digit code.");

    const btn = document.getElementById('verify-otp-btn');
    btn.innerText = "⏳ Verifying...";
    btn.disabled = true;

    try {
        const res = await fetch("/api/verify-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...pendingUser, otp: otp })
        });

        const data = await res.json();

        if (res.ok) {
            currentUser = data.user;
            localStorage.setItem('phr_user', JSON.stringify(currentUser));
            updateNavUI();
            closeModals();
            fetchAllRecords();
            pendingUser = null; 
        } else {
            alert("Verification Failed: " + data.error);
        }
    } catch (e) {
        alert("Network error.");
    } finally {
        btn.innerText = "Verify & Login";
        btn.disabled = false;
    }
}

async function deleteAccount() {
    if (!confirm("CRITICAL WARNING:\n\nAre you sure you want to permanently delete your account? This will instantly destroy all your medical records, PDFs, and MRIs from our servers. This CANNOT be undone.")) {
        return;
    }

    try {
        const response = await fetch(`/api/delete-account/${currentUser.email}`, { method: 'DELETE' });
        if (response.ok) {
            alert("Your account and all associated data have been permanently deleted.");
            logout(); // This clears local storage and resets the UI
        } else {
            const data = await response.json();
            alert("Failed to delete account: " + data.error);
        }
    } catch (e) {
        alert("Network error: " + e.message);
    }
}

function updateNavUI() {
    document.getElementById('nav-username').innerText = currentUser.name;
    document.getElementById('nav-avatar').innerText = currentUser.name.charAt(0).toUpperCase();
    
    document.getElementById('stat-blood').innerText = currentUser.blood || '--';
    document.getElementById('stat-age').innerText = currentUser.age || '--';
    document.getElementById('stat-sex').innerText = currentUser.sex || '--';
}

function logout() {
    localStorage.removeItem('phr_user');
    currentUser = null;
    document.getElementById('nav-username').innerText = "Sign In";
    document.getElementById('nav-avatar').innerText = "U";
    
    allRecords = [];
    document.getElementById('stat-total').innerText = '0';
    document.getElementById('stat-blood').innerText = '--';
    document.getElementById('stat-age').innerText = '--';
    document.getElementById('stat-sex').innerText = '--';
    document.getElementById('recent-activity-container').style.display = 'none';
    
    closeModals();
    showHome();
}

// --- FILE & DATA LOGIC ---

function openView(filterType, filterValue, title) {
    if (!currentUser) return openProfileModal();
    
    sessionStorage.setItem('phr_active_view', JSON.stringify({filterType, filterValue, title}));
    
    currentFilterType = filterType;
    currentFilterValue = filterValue;

    document.getElementById('home-view').style.display = 'none';
    document.getElementById('detail-view').style.display = 'flex';
    document.getElementById('cat-title').innerText = title;
    document.getElementById('upload-container').style.display = 'flex';
    
    if (filterType === 'category') {
        document.getElementById('doc-category').value = filterValue;
        document.getElementById('category-selector').style.display = 'none';
        document.getElementById('type-selector').style.display = 'flex';
    } else if (filterType === 'type') {
        document.getElementById('doc-type').value = filterValue;
        document.getElementById('type-selector').style.display = 'none';
        document.getElementById('category-selector').style.display = 'flex';
        document.getElementById('doc-category').value = 'general'; 
    }

    updateAcceptTypes();
    renderFilteredTable();
}

function updateAcceptTypes() {
    const type = document.getElementById('doc-type').value;
    const input = document.getElementById('upload-file');
    if (type === 'lab') { input.accept = '.pdf'; input.multiple = false; }
    else if (type === 'prescription') { input.accept = 'image/*'; input.multiple = false; }
    else { input.accept = '.dcm, image/jpeg, image/png'; input.multiple = true; } 
}

async function fetchAllRecords() {
    try {
        const res = await fetch(`/api/records/${currentUser.email}`);
        const data = await res.json();
        allRecords = data.records || [];
        
        document.getElementById('stat-total').innerText = allRecords.length;
        
        if (document.getElementById('home-view').style.display !== 'none' && document.getElementById('search-input').value === '') {
            if (allRecords.length > 0) {
                populateRecentActivity(allRecords.slice(0, 5), false); 
            } else {
                document.getElementById('recent-activity-container').style.display = 'none';
            }
        }

        if (document.getElementById('detail-view').style.display === 'flex') {
            renderFilteredTable();
        }
    } catch (e) {
        console.error("Failed to fetch records");
    }
}

function populateRecentActivity(records, isSearch) {
    const container = document.getElementById('recent-activity-container');
    const tbody = document.getElementById('recent-table-body');
    
    if (records.length === 0 && isSearch) {
        container.style.display = 'block';
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#A3AED0; padding:30px;">No files match your search.</td></tr>';
        return;
    } else if (records.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    tbody.innerHTML = '';

    records.forEach(rec => {
        const uploadDate = new Date(rec.timestamp).toLocaleDateString();
        const docDate = rec.document_date ? new Date(rec.document_date).toLocaleDateString() : 'Required';
        const aiBtnText = rec.has_summary ? "View Summary" : "AI";
        const badgeClass = rec.record_type;
        
        tbody.innerHTML += `
            <tr class="record-row" onclick="viewDocument('${rec.record_id}')">
                <td style="font-weight: 500;">${docDate}</td>
                <td style="color: var(--text-light); font-size: 13px;">${uploadDate}</td>
                <td><span class="badge ${badgeClass}">${rec.record_type}</span></td>
                <td style="font-weight: 600; color: var(--text);">${rec.title}</td>
                <td style="text-transform: capitalize; color: var(--text-light);">${rec.category}</td>
                <td>
                    <div class="action-group">
                        <button class="action-btn ai" title="AI Insight" onclick="event.stopPropagation(); analyzeRecordFromTable('${rec.record_id}')">✨ ${aiBtnText}</button>
                        <button class="action-btn download" title="Download Source" onclick="event.stopPropagation(); downloadRecord('${rec.record_id}')">⬇️</button>
                        <button class="action-btn delete" title="Delete" onclick="event.stopPropagation(); deleteScan('${rec.record_id}')">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    });
}

function filterRecords() {
    const query = document.getElementById('search-input').value.toLowerCase();
    
    document.querySelectorAll('.cat-card, .highlight-card').forEach(card => {
        if (card.innerText.toLowerCase().includes(query) || query === '') {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });

    if (query === '') {
        if (document.getElementById('home-view').style.display === 'block') {
            document.getElementById('recent-activity-title').innerText = "Recent Activity";
            populateRecentActivity(allRecords.slice(0, 5), false);
        } else {
            renderFilteredTable();
        }
        return;
    }
    
    const filtered = allRecords.filter(r => 
        r.title.toLowerCase().includes(query) || 
        r.category.toLowerCase().includes(query) || 
        r.record_type.toLowerCase().includes(query)
    );

    if (document.getElementById('home-view').style.display === 'block') {
        document.getElementById('recent-activity-title').innerText = "Search Results (Files)";
        populateRecentActivity(filtered, true);
    } else {
        renderTable(filtered);
    }
}

function renderFilteredTable() {
    const filtered = allRecords.filter(r => {
        if (currentFilterType === 'category') return r.category === currentFilterValue;
        if (currentFilterType === 'type') return r.record_type === currentFilterValue;
        return true;
    });
    renderTable(filtered);
}

function renderTable(records) {
    const docsTbody = document.getElementById('docs-table');
    const scansTbody = document.getElementById('scans-table');
    
    docsTbody.innerHTML = '';
    scansTbody.innerHTML = '';

    const docs = records.filter(r => ['prescription', 'lab'].includes(r.record_type));
    const scans = records.filter(r => ['mri', 'ct', 'xray', 'ultrasound'].includes(r.record_type));

    if (docs.length === 0) docsTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#A3AED0; padding:20px;">No prescriptions or reports.</td></tr>';
    if (scans.length === 0) scansTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#A3AED0; padding:20px;">No scans found.</td></tr>';

    const rowHTML = (rec) => {
        const docDate = rec.document_date ? new Date(rec.document_date).toLocaleDateString() : 'Required';
        const aiBtnText = rec.has_summary ? "View Summary" : "AI";
        return `
            <tr class="record-row" onclick="viewDocument('${rec.record_id}')">
                <td style="font-weight: 500; font-size:13px;">${docDate}</td>
                <td><span class="badge ${rec.record_type}">${rec.record_type}</span></td>
                <td style="font-weight: 600; color: var(--text);">${rec.title}</td>
                <td style="text-transform: capitalize; color: var(--text-light); font-size:13px;">${rec.category}</td>
                <td>
                    <div class="action-group">
                        <button class="action-btn ai" title="AI Insight" onclick="event.stopPropagation(); analyzeRecordFromTable('${rec.record_id}')">✨ ${aiBtnText}</button>
                        <button class="action-btn download" title="Download Source" onclick="event.stopPropagation(); downloadRecord('${rec.record_id}')">⬇️</button>
                        <button class="action-btn delete" title="Delete" onclick="event.stopPropagation(); deleteScan('${rec.record_id}')">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    };

    docs.forEach(rec => docsTbody.innerHTML += rowHTML(rec));
    scans.forEach(rec => scansTbody.innerHTML += rowHTML(rec));
}

async function uploadFiles() {
    const titleInput = document.getElementById('upload-title');
    const dateInput = document.getElementById('doc-date');
    const fileInput = document.getElementById('upload-file');
    
    if (!titleInput.value || !dateInput.value || fileInput.files.length === 0) {
        return alert("Title, Date Produced, and File are all required.");
    }
    
    const type = document.getElementById('doc-type').value;
    const category = document.getElementById('doc-category').value;
    
    if (['mri', 'ct'].includes(type) && fileInput.files.length > 200) {
        return alert("Academic Limit: Please select 200 DICOM slices or fewer to ensure stability.");
    }

    const btn = document.getElementById('upload-btn');
    btn.innerText = "Uploading...";
    btn.disabled = true;

    const formData = new FormData();
    formData.append("recordCategory", category);
    
    let actualType = type;
    if (['mri', 'ct', 'xray', 'ultrasound'].includes(type) && fileInput.files[0].type === 'application/pdf') {
        actualType = 'lab'; 
    }
    
    formData.append("recordType", actualType);
    formData.append("recordTitle", titleInput.value);
    formData.append("documentDate", dateInput.value); 
    formData.append("userEmail", currentUser.email);
    formData.append("userName", currentUser.name);
    formData.append("bloodGroup", currentUser.blood || 'Unknown');
    
    for (let i = 0; i < fileInput.files.length; i++) formData.append("files", fileInput.files[i]);

    try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.ok) throw new Error("Upload failed");
        
        titleInput.value = '';
        dateInput.value = '';
        fileInput.value = '';
        
        await fetchAllRecords(); 
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerText = "Upload Record";
        btn.disabled = false;
    }
}

async function deleteScan(recordId) {
    if (!confirm("Are you sure you want to permanently delete this record? This action cannot be undone.")) return;
    
    try {
        const response = await fetch(`/api/delete_scan/${recordId}`, { method: 'DELETE' });
        if (response.ok) {
            await fetchAllRecords(); 
        } else {
            alert("Failed to delete record.");
        }
    } catch (e) {
        alert("Error: " + e.message);
    }
}

// --- VIEWER & AI LOGIC ---

async function viewDocument(recordId) {
    currentViewingRecordId = recordId;
    const rec = allRecords.find(r => r.record_id === recordId);
    
    document.getElementById('viewer-title').innerText = rec ? rec.title : "Document Viewer";
    document.getElementById('viewer-modal').style.display = 'flex';
    document.getElementById('viewer-loading').style.display = 'block';
    
    document.getElementById('pdf-viewer').style.display = 'none';
    document.getElementById('img-viewer').style.display = 'none';
    document.getElementById('dicom-tools').style.display = 'none';
    document.getElementById('img-viewer').src = "";
    document.getElementById('pdf-viewer').src = "";
    document.getElementById('download-report-btn').style.display = 'none';
    
    document.getElementById('ai-controls').style.display = 'block';
    document.getElementById('ai-loading').style.display = 'none';
    document.getElementById('ai-report').style.display = 'none';

    try {
        const res = await fetch(`/api/load_file/${recordId}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        document.getElementById('viewer-loading').style.display = 'none';

        if (data.type === 'pdf') {
            document.getElementById('pdf-viewer').src = data.data;
            document.getElementById('pdf-viewer').style.display = 'block';
        } 
        else if (data.type === 'image') {
            document.getElementById('img-viewer').src = data.data;
            document.getElementById('img-viewer').style.display = 'block';
        }
        else if (data.type === 'dicom') {
            dicomImages = data.images;
            currentSlice = 0;
            const slider = document.getElementById('slice-slider');
            slider.max = dicomImages.length - 1;
            slider.value = 0;
            
            document.getElementById('img-viewer').style.display = 'block';
            if (dicomImages.length > 1) {
                document.getElementById('dicom-tools').style.display = 'flex';
                document.getElementById('slice-counter').innerText = `1 / ${dicomImages.length}`;
            }
            updateDicomSlice();
        }
    } catch (e) {
        document.getElementById('viewer-loading').innerText = "Error loading document.";
    }
}

function updateDicomSlice() {
    currentSlice = parseInt(document.getElementById('slice-slider').value);
    document.getElementById('img-viewer').src = dicomImages[currentSlice];
    
    document.getElementById('slice-counter').innerText = `${currentSlice + 1} / ${dicomImages.length}`;
    
    document.getElementById('ai-report').style.display = 'none';
    document.getElementById('download-report-btn').style.display = 'none';
    document.getElementById('ai-controls').style.display = 'block';
}

function analyzeRecordFromTable(recordId) {
    viewDocument(recordId);
    setTimeout(() => {
        if (document.getElementById('ai-controls').style.display !== 'none') {
            analyzeCurrentRecord();
        }
    }, 500);
}

async function analyzeCurrentRecord() {
    if (!currentViewingRecordId) return;
    
    document.getElementById('ai-controls').style.display = 'none';
    document.getElementById('ai-loading').style.display = 'block';
    document.getElementById('ai-report').style.display = 'none';
    document.getElementById('download-report-btn').style.display = 'none';

    try {
        const res = await fetch(`/api/analyze/${currentViewingRecordId}`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slice_index: currentSlice })
        });
        
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        document.getElementById('ai-loading').style.display = 'none';
        document.getElementById('ai-report').innerHTML = marked.parse(data.report);
        
        document.getElementById('ai-report').style.display = 'block';
        document.getElementById('download-report-btn').style.display = 'block';
        
        fetchAllRecords(); 
    } catch (e) {
        document.getElementById('ai-loading').innerText = "❌ " + e.message;
        setTimeout(() => {
            if (document.getElementById('ai-controls')) {
                document.getElementById('ai-controls').style.display = 'block';
                document.getElementById('ai-loading').style.display = 'none';
                document.getElementById('ai-loading').innerText = "Analyzing medical document...";
            }
        }, 5000);
    }
}

function downloadReport() {
    const reportElement = document.getElementById('ai-report');
    const recordTitle = document.getElementById('viewer-title').innerText;
    
    if (!reportElement.innerText) return;
    
    const safeTitle = recordTitle.replace(/\s+/g, '_');
    const filename = `AI_Summary_${safeTitle}.pdf`;

    const pdfOptions = {
        margin:       0.5,
        filename:     filename,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    const downloadBtn = document.getElementById('download-report-btn');
    const originalText = downloadBtn.innerText;
    downloadBtn.innerText = "⏳ Generating PDF...";
    downloadBtn.disabled = true;

    html2pdf().set(pdfOptions).from(reportElement).save().then(() => {
        downloadBtn.innerText = originalText;
        downloadBtn.disabled = false;
    });
}

function downloadRecord(recordId) {
    window.open(`/api/download/${recordId}`, '_blank');
}