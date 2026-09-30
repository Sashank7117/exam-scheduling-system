/**
 * admin-login.js
 * ------------------------------------------------------------------
 * Powers admin-login.html: this is the ONLY entry point for
 * administrator authentication. admin.html (the dashboard) never
 * shows a login form of its own - it just checks for a valid admin
 * session and redirects here if there isn't one.
 *
 * Also handles first-run setup: if no administrator account exists
 * yet, this page collects one instead of shipping a known default
 * username/password.
 * ------------------------------------------------------------------
 */

const loginCard = document.getElementById('loginCard');
const setupCard = document.getElementById('setupCard');

async function boot() {
  await DB.init();

  // Already signed in as an admin? Skip straight to the dashboard
  // rather than asking them to sign in again.
  const session = Auth.getSession();
  if (session && session.role === 'admin') {
    window.location.href = 'admin.html';
    return;
  }

  const adminCount = await DB.count(DB.STORES.ADMINS);
  if (adminCount === 0) {
    showSetup();
  } else {
    showLogin();
  }
}

function showLogin() {
  setupCard.style.display = 'none';
  loginCard.style.display = 'block';
}

function showSetup() {
  loginCard.style.display = 'none';
  setupCard.style.display = 'block';

  const select = document.getElementById('setupSecurityQuestion');
  Auth.SECURITY_QUESTIONS.forEach((q) => {
    const opt = document.createElement('option');
    opt.value = q;
    opt.textContent = q;
    select.appendChild(opt);
  });
}

/* --------------------------------- Sign in --------------------------------- */

document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertBox = document.getElementById('alertBox');
  const submitBtn = document.getElementById('submitBtn');
  alertBox.classList.remove('visible');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in…';

  try {
    await Auth.loginAdmin(
      document.getElementById('username').value,
      document.getElementById('password').value
    );
    window.location.href = 'admin.html';
  } catch (err) {
    alertBox.textContent = err.message || 'Unable to sign in.';
    alertBox.classList.add('visible');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';
  }
});

/* ------------------------------ First-run setup ------------------------------ */

document.getElementById('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertBox = document.getElementById('setupAlertBox');
  const submitBtn = document.getElementById('setupSubmitBtn');
  alertBox.classList.remove('visible');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account…';

  try {
    await Auth.createFirstAdmin({
      username: document.getElementById('setupUsername').value,
      password: document.getElementById('setupPassword').value,
      confirmPassword: document.getElementById('setupConfirmPassword').value,
      securityQuestion: document.getElementById('setupSecurityQuestion').value,
      securityAnswer: document.getElementById('setupSecurityAnswer').value
    });
    window.location.href = 'admin.html';
  } catch (err) {
    alertBox.textContent = err.message || 'Could not create the administrator account.';
    alertBox.classList.add('visible');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Administrator Account';

    // If someone else's tab just created the first admin, don't leave this
    // tab stuck on a setup form for an account that can no longer be made.
    const adminCount = await DB.count(DB.STORES.ADMINS);
    if (adminCount > 0) {
      setTimeout(showLogin, 1200);
    }
  }
});

/* Guard against the browser's back/forward cache restoring a stale view of
   this page (e.g. showing "setup" after an admin account now exists). */
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    boot();
  }
});

boot();
