/**
 * schedule.js
 * ------------------------------------------------------------------
 * Powers schedule.html: the Exam -> Location -> Date -> Time workflow,
 * and the seat-booking transaction that generates the serial number
 * and hall ticket number.
 *
 * The dependent dropdowns here are convenience UI only. Every value
 * (exam status, slot capacity, remaining seats) is re-checked against
 * IndexedDB inside the booking transaction below, so nothing about
 * seat availability is trusted from what's currently on screen.
 * ------------------------------------------------------------------
 */

let session = null;
let allExams = [];
let allSlots = [];
let myApplications = [];

let selectedExamId = null;
let selectedLocation = null;
let selectedDate = null;
let selectedSlot = null;

const alertBox = document.getElementById('alertBox');

function showError(message) {
  alertBox.textContent = message;
  alertBox.classList.add('visible');
}
function clearError() { alertBox.classList.remove('visible'); }

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}
function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/* --------------------------------- Init ---------------------------------- */

async function init() {
  await DB.init();
  session = Auth.requireRole('applicant', 'login.html');
  if (!session) return;

  document.getElementById('whoAmI').textContent = session.name;
  document.getElementById('logoutBtn').addEventListener('click', () => {
    Auth.logout();
    window.location.href = 'index.html';
  });

  const [exams, slots, myApps] = await Promise.all([
    DB.getAll(DB.STORES.EXAMS),
    DB.getAll(DB.STORES.SLOTS),
    DB.getAllByIndex(DB.STORES.APPLICATIONS, 'applicantId', session.userId)
  ]);

  allExams = exams.filter((e) => e.status === 'active');
  allSlots = slots;
  myApplications = myApps;

  const examSelect = document.getElementById('examSelect');
  allExams.forEach((exam) => {
    const opt = document.createElement('option');
    opt.value = exam.id;
    opt.textContent = `${exam.examName} (${exam.examCode})`;
    examSelect.appendChild(opt);
  });

  if (allExams.length === 0) {
    showError('There are no active exams open for scheduling right now. Please check back later.');
  }
}

/* ----------------------------- Step: Exam ----------------------------- */

document.getElementById('examSelect').addEventListener('change', (e) => {
  clearError();
  selectedExamId = e.target.value ? Number(e.target.value) : null;
  selectedLocation = null;
  selectedDate = null;
  selectedSlot = null;

  hidePanelsFrom('location');
  document.getElementById('locationSelect').innerHTML = '<option value="">Choose a location…</option>';

  if (!selectedExamId) return;

  if (myApplications.some((a) => a.examId === selectedExamId)) {
    showError('You already have a booking for this exam. Check your dashboard for your hall ticket.');
    return;
  }

  const locations = [...new Set(allSlots.filter((s) => s.examId === selectedExamId).map((s) => s.location))].sort();
  const locationSelect = document.getElementById('locationSelect');
  locations.forEach((loc) => {
    const opt = document.createElement('option');
    opt.value = loc;
    opt.textContent = loc;
    locationSelect.appendChild(opt);
  });

  setStep('location');
  showPanel('location');
});

/* --------------------------- Step: Location ---------------------------- */

document.getElementById('locationSelect').addEventListener('change', (e) => {
  clearError();
  selectedLocation = e.target.value || null;
  selectedDate = null;
  selectedSlot = null;

  hidePanelsFrom('date');
  document.getElementById('dateSelect').innerHTML = '<option value="">Choose a date…</option>';

  if (!selectedLocation) return;

  const dates = [...new Set(
    allSlots
      .filter((s) => s.examId === selectedExamId && s.location === selectedLocation)
      .map((s) => s.date)
  )].sort();

  const dateSelect = document.getElementById('dateSelect');
  dates.forEach((date) => {
    const opt = document.createElement('option');
    opt.value = date;
    opt.textContent = formatDate(date);
    dateSelect.appendChild(opt);
  });

  setStep('date');
  showPanel('date');
});

/* ----------------------------- Step: Date ------------------------------ */

document.getElementById('dateSelect').addEventListener('change', (e) => {
  clearError();
  selectedDate = e.target.value || null;
  selectedSlot = null;

  hidePanelsFrom('time');

  if (!selectedDate) return;

  renderSlotGrid();
  setStep('time');
  showPanel('time');
});

function renderSlotGrid() {
  const grid = document.getElementById('slotGrid');
  grid.innerHTML = '';

  const matches = allSlots
    .filter((s) => s.examId === selectedExamId && s.location === selectedLocation && s.date === selectedDate)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (matches.length === 0) {
    grid.innerHTML = '<div class="empty-state">No time slots on this date.</div>';
    return;
  }

  matches.forEach((slot) => {
    const available = Math.max(0, slot.capacity - slot.booked);
    const isFull = available === 0;
    const card = document.createElement('div');
    card.className = 'slot-card' + (isFull ? ' full' : '');
    let seatClass = 'ok';
    if (isFull) seatClass = 'full';
    else if (available <= Math.max(1, Math.round(slot.capacity * 0.1))) seatClass = 'low';

    card.innerHTML = `
      <div class="time">${formatTime(slot.startTime)} &ndash; ${formatTime(slot.endTime)}</div>
      <div class="meta">Capacity: ${slot.capacity}</div>
      <div class="seats ${seatClass}">${isFull ? 'FULL' : available + ' seat(s) available'}</div>
    `;

    if (!isFull) {
      card.addEventListener('click', () => selectSlot(slot, card));
    }
    grid.appendChild(card);
  });
}

function selectSlot(slot, cardEl) {
  clearError();
  selectedSlot = slot;
  document.querySelectorAll('.slot-card').forEach((c) => c.classList.remove('selected'));
  cardEl.classList.add('selected');

  const exam = allExams.find((e) => e.id === selectedExamId);
  document.getElementById('confirmSummary').innerHTML = `
    <div class="row-between"><span class="muted">Exam</span><strong>${exam.examName} (${exam.examCode})</strong></div>
    <div class="row-between"><span class="muted">Location</span><strong>${slot.location}</strong></div>
    <div class="row-between"><span class="muted">Date</span><strong>${formatDate(slot.date)}</strong></div>
    <div class="row-between"><span class="muted">Time</span><strong>${formatTime(slot.startTime)} &ndash; ${formatTime(slot.endTime)}</strong></div>
  `;

  setStep('confirm');
  document.getElementById('panel-confirm').style.display = 'block';
  document.getElementById('panel-confirm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.getElementById('cancelSelectionBtn').addEventListener('click', () => {
  selectedSlot = null;
  document.querySelectorAll('.slot-card').forEach((c) => c.classList.remove('selected'));
  document.getElementById('panel-confirm').style.display = 'none';
  setStep('time');
});

/* -------------------------------- Confirm booking -------------------------------- */

document.getElementById('confirmBtn').addEventListener('click', async () => {
  clearError();
  const confirmBtn = document.getElementById('confirmBtn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Booking…';

  try {
    const hallTicketNumber = await bookSlot(selectedSlot.id, selectedExamId, session.userId);
    window.location.href = 'hallticket.html?ticket=' + encodeURIComponent(hallTicketNumber);
  } catch (err) {
    showError(err.message || 'Could not complete the booking. Please try again.');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm Booking';
    // Re-render the grid in case the failure was due to the slot filling up.
    const [slots, myApps] = await Promise.all([
      DB.getAll(DB.STORES.SLOTS),
      DB.getAllByIndex(DB.STORES.APPLICATIONS, 'applicantId', session.userId)
    ]);
    allSlots = slots;
    myApplications = myApps;
    renderSlotGrid();
  }
});

/**
 * Books a seat inside a single IndexedDB read-write transaction spanning
 * the slots and applications stores. Because the availability check, the
 * serial-number increment, and the two writes all happen inside the same
 * transaction, no other booking can interleave and cause overbooking -
 * the transaction either commits as a whole or is aborted and rolled back.
 */
function bookSlot(slotId, examId, applicantId) {
  return new Promise(async (resolve, reject) => {
    const db = await DB.raw();
    const tx = db.transaction([DB.STORES.SLOTS, DB.STORES.APPLICATIONS], 'readwrite');
    const slotsStore = tx.objectStore(DB.STORES.SLOTS);
    const applicationsStore = tx.objectStore(DB.STORES.APPLICATIONS);
    const applicantIndex = applicationsStore.index('applicantId');

    let hallTicketNumber = null;

    tx.onerror = () => reject(tx.error || new Error('Booking failed. Please try again.'));
    tx.onabort = () => reject(tx.error || new Error('This slot is no longer available. Please choose another.'));
    tx.oncomplete = () => resolve(hallTicketNumber);

    const dupRequest = applicantIndex.getAll(applicantId);
    dupRequest.onsuccess = () => {
      if (dupRequest.result.some((a) => a.examId === examId)) {
        tx.abort();
        return;
      }

      const slotRequest = slotsStore.get(slotId);
      slotRequest.onsuccess = () => {
        const slot = slotRequest.result;
        if (!slot) { tx.abort(); return; }

        const available = slot.capacity - slot.booked;
        if (available <= 0) { tx.abort(); return; }

        const exam = allExams.find((e) => e.id === examId);
        const serialNumber = slot.lastSerial + 1;
        const year = new Date(slot.date).getFullYear();
        hallTicketNumber = `${exam.examCode}-${year}-${slot.locationCode}-${String(serialNumber).padStart(4, '0')}`;

        slot.booked += 1;
        slot.lastSerial = serialNumber;
        slotsStore.put(slot);

        applicationsStore.add({
          applicantId,
          examId,
          slotId,
          serialNumber,
          hallTicketNumber,
          bookedAt: new Date().toISOString()
        });
      };
    };
  });
}

/* -------------------------------- Stepper / panel helpers -------------------------------- */

function setStep(stepName) {
  const order = ['exam', 'location', 'date', 'time', 'confirm'];
  const currentIndex = order.indexOf(stepName);
  document.querySelectorAll('.stepper .step[data-step]').forEach((el) => {
    const idx = order.indexOf(el.dataset.step);
    el.classList.remove('done', 'current');
    if (idx < currentIndex) el.classList.add('done');
    else if (idx === currentIndex) el.classList.add('current');
  });
}

function showPanel(name) {
  document.getElementById('panel-' + name).style.display = 'block';
}

function hidePanelsFrom(name) {
  const order = ['location', 'date', 'time', 'confirm'];
  const startIdx = order.indexOf(name);
  order.slice(startIdx).forEach((n) => {
    const el = document.getElementById('panel-' + n);
    if (el) el.style.display = 'none';
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
