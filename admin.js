/**
 * admin.js
 * ------------------------------------------------------------------
 * Powers admin.html: the dashboard ONLY (exam management, slot
 * management, applicants list, reports, security). There is no
 * login form on this page - admin-login.html is the sole entry
 * point for authentication. This file's very first job is to check
 * for a valid admin session and redirect away immediately if there
 * isn't one, before anything sensitive is rendered.
 * ------------------------------------------------------------------
 */

const authGate = document.getElementById('authGate');
const dashboardView = document.getElementById('dashboardView');

/* In-memory caches, refreshed whenever a tab is opened. Keeps the UI
   snappy without re-reading IndexedDB on every keystroke of a filter.
   Cleared on logout so nothing lingers in memory after signing out. */
let _exams = [];
let _slots = [];
let _applicants = [];
let _applications = [];
let _loginLogs = [];
let _currentAdmin = null; /* full record for the signed-in admin */

/* ------------------------------ Bootstrapping ------------------------------ */

async function boot() {
  await DB.init();

  // Gate on the session FIRST, before any dashboard data is fetched or
  // rendered. A predictable URL (admin.html) is not treated as protection
  // by itself - only a verified session unlocks anything below.
  const session = ensureAdminSession();
  if (!session) return;

  await showDashboard(session);
}

/**
 * Verifies there's a valid admin session. If not, redirects to
 * admin-login.html and returns null. Every mutating action in this file
 * calls this first, in addition to the check at page load, so a session
 * that times out mid-visit can't be used to keep editing data.
 */
function ensureAdminSession() {
  const session = Auth.requireRole('admin', 'admin-login.html');
  return session;
}

async function showDashboard(session) {
  authGate.style.display = 'none';
  dashboardView.style.display = 'flex';
  document.getElementById('whoAmI').textContent = 'Signed in as ' + session.name;

  _currentAdmin = await DB.get(DB.STORES.ADMINS, session.userId);

  await refreshAllData();
  renderDashboardTab();
  renderExamsTab();
  renderSlotsTab();
  renderApplicantsTab();
  renderReportsTab();
  populateSecurityQuestionSelects();
  await renderSecurityTab();
}

/* ---------------------------------- Logout ------------------------------------ */

document.getElementById('logoutBtn').addEventListener('click', () => {
  Auth.logout();
  // Drop cached data so nothing sensitive lingers in memory post-logout,
  // and do a full navigation (not an in-page view swap) to admin-login.html
  // so there's no dashboard state left in this document at all.
  _exams = []; _slots = []; _applicants = []; _applications = []; _loginLogs = []; _currentAdmin = null;
  window.location.href = 'admin-login.html';
});

/* Guard against the browser's back/forward cache restoring a rendered
   dashboard after logout or after the session has expired. Any time this
   page is shown from bfcache, re-verify the session from scratch. */
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    dashboardView.style.display = 'none';
    authGate.style.display = 'flex';
    boot();
  }
});

/* --------------------------------- Tabs -------------------------------------- */

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!ensureAdminSession()) return;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tabpanel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ------------------------------- Data refresh --------------------------------- */

async function refreshAllData() {
  [_exams, _slots, _applicants, _applications] = await Promise.all([
    DB.getAll(DB.STORES.EXAMS),
    DB.getAll(DB.STORES.SLOTS),
    DB.getAll(DB.STORES.APPLICANTS),
    DB.getAll(DB.STORES.APPLICATIONS)
  ]);
}

function examById(id) { return _exams.find((e) => e.id === id); }
function slotById(id) { return _slots.find((s) => s.id === id); }
function applicantById(id) { return _applicants.find((a) => a.id === id); }

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/* =========================== Dashboard tab =========================== */

async function renderDashboardTab() {
  await refreshAllData();

  document.getElementById('statTotalExams').textContent = _exams.length;
  document.getElementById('statActiveExams').textContent = _exams.filter((e) => e.status === 'active').length;
  document.getElementById('statTotalApplicants').textContent = _applicants.length;
  document.getElementById('statTotalBookings').textContent = _applications.length;

  const availableSeats = _slots.reduce((sum, s) => sum + Math.max(0, s.capacity - s.booked), 0);
  document.getElementById('statAvailableSeats').textContent = availableSeats;

  const recent = [..._applications]
    .sort((a, b) => new Date(b.bookedAt) - new Date(a.bookedAt))
    .slice(0, 8);

  const tbody = document.querySelector('#recentBookingsTable tbody');
  tbody.innerHTML = '';

  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No bookings yet.</td></tr>';
    return;
  }

  recent.forEach((app) => {
    const applicant = applicantById(app.applicantId);
    const exam = examById(app.examId);
    const slot = slotById(app.slotId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${app.hallTicketNumber}</td>
      <td>${applicant ? applicant.fullName : 'Unknown'}</td>
      <td>${exam ? exam.examName : 'Unknown'}</td>
      <td>${slot ? `${slot.location}, ${formatDate(slot.date)}` : 'Unknown'}</td>
      <td>${new Date(app.bookedAt).toLocaleString()}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* =========================== Exams tab =========================== */

const examModalBackdrop = document.getElementById('examModalBackdrop');
const examForm = document.getElementById('examForm');

function openExamModal(exam = null) {
  document.getElementById('examModalAlert').classList.remove('visible');
  examForm.reset();
  document.getElementById('examModalTitle').textContent = exam ? 'Edit Exam' : 'New Exam';
  document.getElementById('examId').value = exam ? exam.id : '';
  document.getElementById('examName').value = exam ? exam.examName : '';
  document.getElementById('examCode').value = exam ? exam.examCode : '';
  document.getElementById('examDescription').value = exam ? exam.description : '';
  document.getElementById('examStatus').value = exam ? exam.status : 'active';
  examModalBackdrop.classList.add('visible');
}

function closeExamModal() { examModalBackdrop.classList.remove('visible'); }

document.getElementById('newExamBtn').addEventListener('click', () => openExamModal());
document.getElementById('examModalClose').addEventListener('click', closeExamModal);

examForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ensureAdminSession()) return;
  const alertBox = document.getElementById('examModalAlert');
  alertBox.classList.remove('visible');

  const id = document.getElementById('examId').value;
  const examName = document.getElementById('examName').value.trim();
  const examCode = document.getElementById('examCode').value.trim().toUpperCase();
  const description = document.getElementById('examDescription').value.trim();
  const status = document.getElementById('examStatus').value;

  if (!examName || !examCode) {
    alertBox.textContent = 'Exam name and exam code are required.';
    alertBox.classList.add('visible');
    return;
  }

  // Enforce a unique exam code (aside from the record being edited).
  const duplicate = _exams.find((e) => e.examCode === examCode && String(e.id) !== id);
  if (duplicate) {
    alertBox.textContent = 'That exam code is already in use.';
    alertBox.classList.add('visible');
    return;
  }

  const record = { examName, examCode, description, status };
  if (id) record.id = Number(id);

  try {
    await DB.put(DB.STORES.EXAMS, record);
    closeExamModal();
    await refreshAllData();
    renderExamsTab();
    renderDashboardTab();
  } catch (err) {
    alertBox.textContent = 'Could not save the exam. ' + (err.message || '');
    alertBox.classList.add('visible');
  }
});

function renderExamsTab() {
  const tbody = document.querySelector('#examsTable tbody');
  tbody.innerHTML = '';

  if (_exams.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No exams yet. Create one to get started.</td></tr>';
    return;
  }

  _exams.forEach((exam) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${exam.examCode}</td>
      <td>${exam.examName}</td>
      <td class="muted">${exam.description || '—'}</td>
      <td><span class="badge badge-${exam.status === 'active' ? 'active' : 'inactive'}">${exam.status}</span></td>
      <td class="row">
        <button class="btn btn-outline btn-sm" data-action="edit">Edit</button>
        <button class="btn btn-outline btn-sm" data-action="toggle">${exam.status === 'active' ? 'Deactivate' : 'Activate'}</button>
      </td>
    `;
    tr.querySelector('[data-action="edit"]').addEventListener('click', () => openExamModal(exam));
    tr.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
      if (!ensureAdminSession()) return;
      exam.status = exam.status === 'active' ? 'inactive' : 'active';
      await DB.put(DB.STORES.EXAMS, exam);
      await refreshAllData();
      renderExamsTab();
      renderDashboardTab();
    });
    tbody.appendChild(tr);
  });

  // Keep the exam <select> dropdowns (slot form, slot filter, report filter) in sync.
  const options = _exams.map((e) => `<option value="${e.id}">${e.examName} (${e.examCode})</option>`).join('');
  document.getElementById('slotExam').innerHTML = options;
  document.getElementById('slotExamFilter').innerHTML = '<option value="">All exams</option>' + options;
  document.getElementById('reportExamFilter').innerHTML = '<option value="">All exams</option>' + options;
}

/* =========================== Slots tab =========================== */

const slotModalBackdrop = document.getElementById('slotModalBackdrop');
const slotForm = document.getElementById('slotForm');

function openSlotModal(slot = null) {
  document.getElementById('slotModalAlert').classList.remove('visible');
  slotForm.reset();
  document.getElementById('slotModalTitle').textContent = slot ? 'Edit Slot' : 'New Slot';
  document.getElementById('slotId').value = slot ? slot.id : '';
  document.getElementById('slotExam').value = slot ? slot.examId : (_exams[0] ? _exams[0].id : '');
  document.getElementById('slotLocation').value = slot ? slot.location : '';
  document.getElementById('slotLocationCode').value = slot ? slot.locationCode : '';
  document.getElementById('slotDate').value = slot ? slot.date : '';
  document.getElementById('slotStartTime').value = slot ? slot.startTime : '';
  document.getElementById('slotEndTime').value = slot ? slot.endTime : '';
  document.getElementById('slotCapacity').value = slot ? slot.capacity : '';
  slotModalBackdrop.classList.add('visible');
}

function closeSlotModal() { slotModalBackdrop.classList.remove('visible'); }

document.getElementById('newSlotBtn').addEventListener('click', () => {
  if (_exams.length === 0) {
    alert('Create an exam first before adding slots.');
    return;
  }
  openSlotModal();
});
document.getElementById('slotModalClose').addEventListener('click', closeSlotModal);

slotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ensureAdminSession()) return;
  const alertBox = document.getElementById('slotModalAlert');
  alertBox.classList.remove('visible');

  const id = document.getElementById('slotId').value;
  const examId = Number(document.getElementById('slotExam').value);
  const location = document.getElementById('slotLocation').value.trim();
  const locationCode = document.getElementById('slotLocationCode').value.trim().toUpperCase();
  const date = document.getElementById('slotDate').value;
  const startTime = document.getElementById('slotStartTime').value;
  const endTime = document.getElementById('slotEndTime').value;
  const capacity = Number(document.getElementById('slotCapacity').value);

  if (!examId || !location || !locationCode || !date || !startTime || !endTime || !capacity || capacity < 1) {
    alertBox.textContent = 'Please fill in every field with a valid value.';
    alertBox.classList.add('visible');
    return;
  }
  if (endTime <= startTime) {
    alertBox.textContent = 'End time must be after start time.';
    alertBox.classList.add('visible');
    return;
  }

  let record;
  if (id) {
    const existing = slotById(Number(id));
    if (capacity < existing.booked) {
      alertBox.textContent = `Capacity cannot be lower than the ${existing.booked} seat(s) already booked.`;
      alertBox.classList.add('visible');
      return;
    }
    record = { ...existing, examId, location, locationCode, date, startTime, endTime, capacity };
  } else {
    record = { examId, location, locationCode, date, startTime, endTime, capacity, booked: 0, lastSerial: 0 };
  }

  try {
    await DB.put(DB.STORES.SLOTS, record);
    closeSlotModal();
    await refreshAllData();
    renderSlotsTab();
    renderDashboardTab();
  } catch (err) {
    alertBox.textContent = 'Could not save the slot. ' + (err.message || '');
    alertBox.classList.add('visible');
  }
});

document.getElementById('slotExamFilter').addEventListener('change', renderSlotsTab);

function renderSlotsTab() {
  const tbody = document.querySelector('#slotsTable tbody');
  tbody.innerHTML = '';

  const filterExamId = document.getElementById('slotExamFilter').value;
  let rows = _slots.slice().sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  if (filterExamId) rows = rows.filter((s) => String(s.examId) === filterExamId);

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No slots match this filter.</td></tr>';
    return;
  }

  rows.forEach((slot) => {
    const exam = examById(slot.examId);
    const available = Math.max(0, slot.capacity - slot.booked);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${exam ? `${exam.examName} <span class="muted mono">(${exam.examCode})</span>` : 'Unknown'}</td>
      <td>${slot.location} <span class="muted mono">(${slot.locationCode})</span></td>
      <td>${formatDate(slot.date)}</td>
      <td>${formatTime(slot.startTime)} &ndash; ${formatTime(slot.endTime)}</td>
      <td>${slot.capacity}</td>
      <td>${slot.booked}</td>
      <td>${available === 0 ? '<span class="badge badge-full">Full</span>' : available}</td>
      <td><button class="btn btn-outline btn-sm" data-action="edit">Edit</button></td>
    `;
    tr.querySelector('[data-action="edit"]').addEventListener('click', () => openSlotModal(slot));
    tbody.appendChild(tr);
  });
}

/* =========================== Applicants tab =========================== */

document.getElementById('applicantSearch').addEventListener('input', renderApplicantsTab);

function renderApplicantsTab() {
  const tbody = document.querySelector('#applicantsTable tbody');
  tbody.innerHTML = '';

  const query = document.getElementById('applicantSearch').value.trim().toLowerCase();
  let rows = _applicants.slice();
  if (query) {
    rows = rows.filter((a) => a.fullName.toLowerCase().includes(query) || a.email.toLowerCase().includes(query));
  }

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No applicants match this search.</td></tr>';
    return;
  }

  rows.forEach((applicant) => {
    const bookingCount = _applications.filter((a) => a.applicantId === applicant.id).length;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${applicant.fullName}</td>
      <td>${applicant.email}</td>
      <td>${applicant.mobile}</td>
      <td>${new Date(applicant.createdAt).toLocaleDateString()}</td>
      <td>${bookingCount}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* =========================== Reports tab =========================== */

['reportSearch', 'reportExamFilter', 'reportLocationFilter', 'reportDateFilter'].forEach((id) => {
  document.getElementById(id).addEventListener('input', renderReportsTab);
  document.getElementById(id).addEventListener('change', renderReportsTab);
});

function getFilteredReportRows() {
  const query = document.getElementById('reportSearch').value.trim().toLowerCase();
  const examId = document.getElementById('reportExamFilter').value;
  const location = document.getElementById('reportLocationFilter').value;
  const date = document.getElementById('reportDateFilter').value;

  return _applications
    .map((app) => ({
      app,
      applicant: applicantById(app.applicantId),
      exam: examById(app.examId),
      slot: slotById(app.slotId)
    }))
    .filter(({ applicant, exam, slot }) => {
      if (!applicant || !exam || !slot) return false;
      if (query && !applicant.fullName.toLowerCase().includes(query) && !applicant.email.toLowerCase().includes(query)) return false;
      if (examId && String(exam.id) !== examId) return false;
      if (location && slot.location !== location) return false;
      if (date && slot.date !== date) return false;
      return true;
    });
}

function renderReportsTab() {
  const locationSelect = document.getElementById('reportLocationFilter');
  const currentLocation = locationSelect.value;
  const uniqueLocations = [...new Set(_slots.map((s) => s.location))].sort();
  locationSelect.innerHTML = '<option value="">All locations</option>' + uniqueLocations.map((l) => `<option value="${l}">${l}</option>`).join('');
  locationSelect.value = currentLocation;

  const rows = getFilteredReportRows();
  const tbody = document.querySelector('#reportsTable tbody');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No bookings match this filter.</td></tr>';
    return;
  }

  rows.forEach(({ app, applicant, exam, slot }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${app.hallTicketNumber}</td>
      <td>${app.serialNumber}</td>
      <td>${applicant.fullName}</td>
      <td>${applicant.email}</td>
      <td>${exam.examName}</td>
      <td>${slot.location}</td>
      <td>${formatDate(slot.date)}</td>
      <td>${formatTime(slot.startTime)}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('printReportBtn').addEventListener('click', () => {
  if (!ensureAdminSession()) return;
  window.print();
});

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  if (!ensureAdminSession()) return;
  const rows = getFilteredReportRows();
  const header = ['Hall Ticket Number', 'Serial', 'Applicant Name', 'Email', 'Mobile', 'Exam', 'Exam Code', 'Location', 'Date', 'Start Time', 'End Time'];
  const csvRows = [header.join(',')];

  rows.forEach(({ app, applicant, exam, slot }) => {
    const line = [
      app.hallTicketNumber,
      app.serialNumber,
      applicant.fullName,
      applicant.email,
      applicant.mobile,
      exam.examName,
      exam.examCode,
      slot.location,
      slot.date,
      slot.startTime,
      slot.endTime
    ].map((val) => `"${String(val).replace(/"/g, '""')}"`);
    csvRows.push(line.join(','));
  });

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'exam-bookings-report.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

/* =========================== Security tab =========================== */

function populateSecurityQuestionSelects() {
  const options = Auth.SECURITY_QUESTIONS.map((q) => `<option value="${q}">${q}</option>`).join('');
  document.getElementById('adminSecurityQuestion').innerHTML = options;

  if (_currentAdmin && _currentAdmin.securityQuestion) {
    document.getElementById('adminSecurityQuestion').value = _currentAdmin.securityQuestion;
  }
}

/* ---- Change my password (self-service, requires current password) ---- */

document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ensureAdminSession()) return;
  const alertBox = document.getElementById('changePasswordAlert');
  const successBox = document.getElementById('changePasswordSuccess');
  alertBox.classList.remove('visible');
  successBox.classList.remove('visible');

  try {
    await Auth.changePassword(
      DB.STORES.ADMINS,
      _currentAdmin.id,
      document.getElementById('currentPassword').value,
      document.getElementById('newPasswordSelf').value,
      document.getElementById('confirmNewPasswordSelf').value
    );
    successBox.classList.add('visible');
    document.getElementById('changePasswordForm').reset();
    _currentAdmin = await DB.get(DB.STORES.ADMINS, _currentAdmin.id);
  } catch (err) {
    alertBox.textContent = err.message || 'Could not update the password.';
    alertBox.classList.add('visible');
  }
});

/* ---- Update my security question ---- */

document.getElementById('securityQuestionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ensureAdminSession()) return;
  const alertBox = document.getElementById('securityQuestionAlert');
  const successBox = document.getElementById('securityQuestionSuccess');
  alertBox.classList.remove('visible');
  successBox.classList.remove('visible');

  try {
    await Auth.updateSecurityQuestion(
      DB.STORES.ADMINS,
      _currentAdmin.id,
      document.getElementById('adminSecurityQuestion').value,
      document.getElementById('adminSecurityAnswer').value
    );
    successBox.classList.add('visible');
    document.getElementById('adminSecurityAnswer').value = '';
    _currentAdmin = await DB.get(DB.STORES.ADMINS, _currentAdmin.id);
  } catch (err) {
    alertBox.textContent = err.message || 'Could not save the security question.';
    alertBox.classList.add('visible');
  }
});

/* ---- Unlock an account (clears its recent failed attempts) ---- */

document.getElementById('unlockBtn').addEventListener('click', async () => {
  if (!ensureAdminSession()) return;
  const alertBox = document.getElementById('unlockAlert');
  const successBox = document.getElementById('unlockSuccess');
  alertBox.classList.remove('visible');
  successBox.classList.remove('visible');

  const role = document.getElementById('unlockRole').value;
  let identifier = document.getElementById('unlockIdentifier').value.trim();
  if (role === 'applicant') identifier = identifier.toLowerCase();

  if (!identifier) {
    alertBox.textContent = 'Enter the email or username to unlock.';
    alertBox.classList.add('visible');
    return;
  }

  try {
    const logs = await DB.getAllByIndex(DB.STORES.LOGIN_LOGS, 'identifier', identifier);
    const toClear = logs.filter((l) => l.role === role && (l.status === 'failed' || l.status === 'reset_failed' || l.status === 'blocked'));

    if (toClear.length === 0) {
      alertBox.textContent = 'No recent failed attempts were found for that account - it is not currently locked.';
      alertBox.classList.add('visible');
      return;
    }

    await Promise.all(toClear.map((l) => DB.delete(DB.STORES.LOGIN_LOGS, l.id)));
    successBox.classList.add('visible');
    document.getElementById('unlockIdentifier').value = '';
    await renderSecurityTab();
  } catch (err) {
    alertBox.textContent = 'Could not unlock the account. ' + (err.message || '');
    alertBox.classList.add('visible');
  }
});

/* ---- Login activity table ---- */

['logSearch', 'logRoleFilter', 'logStatusFilter'].forEach((id) => {
  document.getElementById(id).addEventListener('input', renderLoginLogsTable);
  document.getElementById(id).addEventListener('change', renderLoginLogsTable);
});
document.getElementById('refreshLoginLogsBtn').addEventListener('click', () => {
  if (!ensureAdminSession()) return;
  renderSecurityTab();
});

const STATUS_LABELS = {
  success: 'Signed in',
  failed: 'Failed sign-in',
  blocked: 'Blocked (locked out)',
  reset_success: 'Password reset',
  reset_failed: 'Reset - wrong answer'
};

const STATUS_BADGE_CLASS = {
  success: 'badge-success',
  failed: 'badge-inactive',
  blocked: 'badge-inactive',
  reset_success: 'badge-neutral',
  reset_failed: 'badge-inactive'
};

async function renderSecurityTab() {
  _loginLogs = await DB.getAll(DB.STORES.LOGIN_LOGS);
  renderLoginLogsTable();
}

function getFilteredLogRows() {
  const query = document.getElementById('logSearch').value.trim().toLowerCase();
  const role = document.getElementById('logRoleFilter').value;
  const status = document.getElementById('logStatusFilter').value;

  return _loginLogs
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .filter((l) => {
      if (query && !l.identifier.toLowerCase().includes(query) && !(l.name || '').toLowerCase().includes(query)) return false;
      if (role && l.role !== role) return false;
      if (status && l.status !== status) return false;
      return true;
    });
}

function renderLoginLogsTable() {
  const rows = getFilteredLogRows().slice(0, 300); // keep the on-screen table snappy; export covers everything
  const tbody = document.querySelector('#loginLogsTable tbody');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No login activity matches this filter.</td></tr>';
    return;
  }

  rows.forEach((l) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(l.timestamp).toLocaleString()}</td>
      <td>${l.role === 'admin' ? 'Administrator' : 'Applicant'}</td>
      <td class="mono">${l.identifier}</td>
      <td>${l.name || '—'}</td>
      <td><span class="badge ${STATUS_BADGE_CLASS[l.status] || 'badge-neutral'}">${STATUS_LABELS[l.status] || l.status}</span></td>
      <td class="muted">${l.reason || ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ---- Export everything login-related to a real .xlsx workbook ---- */

document.getElementById('exportExcelBtn').addEventListener('click', async () => {
  if (!ensureAdminSession()) return;
  if (typeof XLSX === 'undefined') {
    alert('The Excel export library did not load (no internet connection?). Please check your connection and try again.');
    return;
  }

  const [logs, applicants, admins] = await Promise.all([
    DB.getAll(DB.STORES.LOGIN_LOGS),
    DB.getAll(DB.STORES.APPLICANTS),
    DB.getAll(DB.STORES.ADMINS)
  ]);

  const wb = XLSX.utils.book_new();

  const activitySheetData = logs
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((l) => ({
      'Date/Time': new Date(l.timestamp).toLocaleString(),
      'Account Type': l.role === 'admin' ? 'Administrator' : 'Applicant',
      'Email / Username': l.identifier,
      'Name': l.name || '',
      'Status': STATUS_LABELS[l.status] || l.status,
      'Detail': l.reason || '',
      'Browser': l.userAgent || ''
    }));
  const activitySheet = XLSX.utils.json_to_sheet(activitySheetData);
  XLSX.utils.book_append_sheet(wb, activitySheet, 'Login Activity');

  // Deliberately excludes password hashes/salts and security answers - only
  // account metadata that's safe for an administrator to review or archive.
  const applicantSheetData = applicants.map((a) => ({
    'Full Name': a.fullName,
    'Email': a.email,
    'Mobile': a.mobile,
    'Registered On': new Date(a.createdAt).toLocaleString(),
    'Security Question Set': a.securityAnswerHash ? 'Yes' : 'No',
    'Total Bookings': _applications.filter((app) => app.applicantId === a.id).length
  }));
  const applicantSheet = XLSX.utils.json_to_sheet(applicantSheetData);
  XLSX.utils.book_append_sheet(wb, applicantSheet, 'Applicant Accounts');

  const adminSheetData = admins.map((a) => ({
    'Username': a.username,
    'Created On': new Date(a.createdAt).toLocaleString(),
    'Security Question Set': a.securityAnswerHash ? 'Yes' : 'No'
  }));
  const adminSheet = XLSX.utils.json_to_sheet(adminSheetData);
  XLSX.utils.book_append_sheet(wb, adminSheet, 'Admin Accounts');

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  XLSX.writeFile(wb, `login-security-data-${stamp}.xlsx`);
});

boot();

/* Defense in depth: even if the tab is left open and idle, periodically
   re-verify the session so an expired session can't keep the dashboard
   usable until the next click. */
setInterval(() => {
  if (dashboardView.style.display !== 'none') ensureAdminSession();
}, 60000);
