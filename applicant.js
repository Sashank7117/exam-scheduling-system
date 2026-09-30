/**
 * applicant.js
 * ------------------------------------------------------------------
 * Powers applicant.html: shows the signed-in applicant's bookings
 * and lets them jump into scheduling a new exam.
 * ------------------------------------------------------------------
 */

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

async function init() {
  await DB.init();
  const session = Auth.requireRole('applicant', 'login.html');
  if (!session) return;

  document.getElementById('whoAmI').textContent = session.name;
  document.getElementById('welcomeHeading').textContent = `Welcome, ${session.name.split(' ')[0]}`;

  document.getElementById('logoutBtn').addEventListener('click', () => {
    Auth.logout();
    window.location.href = 'index.html';
  });

  const [applications, exams, slots] = await Promise.all([
    DB.getAllByIndex(DB.STORES.APPLICATIONS, 'applicantId', session.userId),
    DB.getAll(DB.STORES.EXAMS),
    DB.getAll(DB.STORES.SLOTS)
  ]);

  const list = document.getElementById('bookingsList');
  const empty = document.getElementById('bookingsEmpty');

  if (applications.length === 0) {
    empty.style.display = 'block';
    setupAccountForms(session);
    return;
  }

  applications
    .sort((a, b) => new Date(b.bookedAt) - new Date(a.bookedAt))
    .forEach((app) => {
      const exam = exams.find((e) => e.id === app.examId);
      const slot = slots.find((s) => s.id === app.slotId);
      const card = document.createElement('div');
      card.className = 'card booking-card';
      card.innerHTML = `
        <div>
          <div style="font-weight:600;">${exam ? exam.examName : 'Exam'}</div>
          <div class="muted" style="font-size:0.85rem; margin-top:2px;">
            ${slot ? `${slot.location} &middot; ${formatDate(slot.date)} &middot; ${formatTime(slot.startTime)}–${formatTime(slot.endTime)}` : ''}
          </div>
          <div class="ticket-no mono" style="margin-top:6px;">${app.hallTicketNumber}</div>
        </div>
        <a class="btn btn-outline" href="hallticket.html?ticket=${encodeURIComponent(app.hallTicketNumber)}">View Hall Ticket</a>
      `;
      list.appendChild(card);
    });

  setupAccountForms(session);
}

function setupAccountForms(session) {
  const questionSelect = document.getElementById('mySecurityQuestion');
  Auth.SECURITY_QUESTIONS.forEach((q) => {
    const opt = document.createElement('option');
    opt.value = q;
    opt.textContent = q;
    questionSelect.appendChild(opt);
  });

  DB.get(DB.STORES.APPLICANTS, session.userId).then((applicant) => {
    if (applicant && applicant.securityQuestion) questionSelect.value = applicant.securityQuestion;
  });

  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById('changePasswordAlert');
    const successBox = document.getElementById('changePasswordSuccess');
    alertBox.classList.remove('visible');
    successBox.classList.remove('visible');

    try {
      await Auth.changePassword(
        DB.STORES.APPLICANTS,
        session.userId,
        document.getElementById('currentPassword').value,
        document.getElementById('newPasswordSelf').value,
        document.getElementById('confirmNewPasswordSelf').value
      );
      successBox.classList.add('visible');
      document.getElementById('changePasswordForm').reset();
    } catch (err) {
      alertBox.textContent = err.message || 'Could not update the password.';
      alertBox.classList.add('visible');
    }
  });

  document.getElementById('securityQuestionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById('securityQuestionAlert');
    const successBox = document.getElementById('securityQuestionSuccess');
    alertBox.classList.remove('visible');
    successBox.classList.remove('visible');

    try {
      await Auth.updateSecurityQuestion(
        DB.STORES.APPLICANTS,
        session.userId,
        questionSelect.value,
        document.getElementById('mySecurityAnswer').value
      );
      successBox.classList.add('visible');
      document.getElementById('mySecurityAnswer').value = '';
    } catch (err) {
      alertBox.textContent = err.message || 'Could not save the security question.';
      alertBox.classList.add('visible');
    }
  });
}

init();

/* Guard against the browser's back/forward cache restoring a rendered
   page after logout or after the session has expired. */
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    Auth.requireRole('applicant', 'login.html');
  }
});
