/**
 * hallticket.js
 * ------------------------------------------------------------------
 * Powers hallticket.html: looks up a booking by its hall ticket
 * number, verifies the signed-in user is allowed to see it, renders
 * the ticket, and wires up printing.
 * ------------------------------------------------------------------
 */

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function showError(message) {
  const box = document.getElementById('alertBox');
  box.textContent = message;
  box.classList.add('visible');
}

async function init() {
  await DB.init();

  // Either role may view a hall ticket (applicants view their own;
  // admins view any, e.g. from the Reports tab) - but someone signed
  // out entirely gets sent to the login page.
  const session = Auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }

  if (session.role === 'applicant') {
    document.getElementById('whoAmI').textContent = session.name;
    document.getElementById('logoutBtn').addEventListener('click', () => {
      Auth.logout();
      window.location.href = 'index.html';
    });
  } else {
    // Admins land here from a report link, not the applicant chrome.
    document.querySelector('.topnav').style.display = 'none';
  }

  const ticketNumber = new URLSearchParams(window.location.search).get('ticket');
  if (!ticketNumber) {
    showError('No hall ticket was specified.');
    return;
  }

  const application = await DB.getByIndex(DB.STORES.APPLICATIONS, 'hallTicketNumber', ticketNumber);
  if (!application) {
    showError('We could not find a hall ticket with that number.');
    return;
  }

  if (session.role === 'applicant' && application.applicantId !== session.userId) {
    showError('You do not have permission to view this hall ticket.');
    return;
  }

  const [applicant, exam, slot] = await Promise.all([
    DB.get(DB.STORES.APPLICANTS, application.applicantId),
    DB.get(DB.STORES.EXAMS, application.examId),
    DB.get(DB.STORES.SLOTS, application.slotId)
  ]);

  if (!applicant || !exam || !slot) {
    showError('This hall ticket refers to data that no longer exists.');
    return;
  }

  document.getElementById('t-hallTicketNumber').textContent = application.hallTicketNumber;
  document.getElementById('t-applicantName').textContent = applicant.fullName;
  document.getElementById('t-examName').textContent = exam.examName;
  document.getElementById('t-examCode').textContent = exam.examCode;
  document.getElementById('t-location').textContent = slot.location;
  document.getElementById('t-date').textContent = formatDate(slot.date);
  document.getElementById('t-time').textContent = `${formatTime(slot.startTime)} – ${formatTime(slot.endTime)}`;
  document.getElementById('t-serial').textContent = application.serialNumber;

  document.getElementById('s-hallTicketNumber').textContent = application.hallTicketNumber;
  document.getElementById('s-examCode').textContent = exam.examCode;
  document.getElementById('s-locationCode').textContent = slot.locationCode;
  document.getElementById('s-serial').textContent = application.serialNumber;

  document.getElementById('ticketWrap').style.display = 'block';
  document.title = `Hall Ticket ${application.hallTicketNumber}`;
}

document.getElementById('printBtn').addEventListener('click', () => window.print());

init();

/* Guard against the browser's back/forward cache restoring a rendered
   hall ticket after logout or after the session has expired. */
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    if (!Auth.getSession()) window.location.href = 'login.html';
  }
});
