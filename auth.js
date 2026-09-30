/**
 * auth.js
 * ------------------------------------------------------------------
 * Handles password hashing (Web Crypto API / PBKDF2), applicant
 * registration & login, admin login, and session management.
 *
 * IMPORTANT ABOUT SECURITY IN A BROWSER-ONLY APP:
 * There is no server here, so this cannot be "real" authentication
 * the way a backend system would provide it - anyone with access to
 * the browser's DevTools can inspect IndexedDB or step through the
 * JavaScript. What this module DOES do is follow good practice
 * within those limits: it never stores plain-text passwords (only
 * salted PBKDF2 hashes), never puts passwords in the URL or logs,
 * and keeps the "session" in sessionStorage (cleared when the tab
 * closes) rather than a long-lived localStorage token.
 * ------------------------------------------------------------------
 */

const SESSION_KEY = 'examSystemSession';
const SESSION_TIMEOUT_MINUTES = 30;
const PBKDF2_ITERATIONS = 100000;

/* Login security: after this many failed attempts (login or password-reset
   answer) for the same role+identifier within the lockout window, further
   attempts are blocked until the window passes. Every attempt - success,
   failure, or blocked - is written to the loginLogs store so it shows up
   in the admin Security tab and in the Excel export. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

const SECURITY_QUESTIONS = [
  'What was the name of your first school?',
  'What is your favorite book?',
  'What city were you born in?',
  'What was your childhood nickname?',
  'What is the name of your first pet?'
];

/* ---------------------------- Hashing ---------------------------- */

function _bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function _base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const Auth = {
  SESSION_TIMEOUT_MINUTES,
  SECURITY_QUESTIONS,

  /** Case/whitespace-insensitive so a correct answer typed differently still matches. */
  normalizeAnswer(answer) {
    return (answer || '').trim().toLowerCase();
  },

  /**
   * Hashes a password with PBKDF2-SHA256.
   * If saltBase64 is omitted, a new random salt is generated (use this
   * when creating a new password). Pass the stored salt back in to
   * verify a login attempt.
   */
  async hashPassword(password, saltBase64 = null) {
    const salt = saltBase64 ? _base64ToBytes(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    return {
      hash: _bytesToBase64(new Uint8Array(derivedBits)),
      salt: _bytesToBase64(salt)
    };
  },

  /** Recomputes the hash for a login attempt and compares it to the stored hash. */
  async verifyPassword(password, storedHash, storedSalt) {
    const { hash } = await Auth.hashPassword(password, storedSalt);
    return hash === storedHash;
  },

  /* ------------------------- Validation -------------------------- */

  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  isValidMobile(mobile) {
    return /^[0-9]{10}$/.test(mobile.replace(/[\s-]/g, ''));
  },

  /** At least 8 characters, one letter and one number. Used for applicant accounts. */
  isStrongPassword(password) {
    return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
  },

  /**
   * Administrator accounts hold far more privilege than an applicant
   * account, so they're held to a stricter policy: at least 10
   * characters, upper case, lower case, a number, and a symbol.
   */
  isStrongAdminPassword(password) {
    return (
      password.length >= 10 &&
      /[a-z]/.test(password) &&
      /[A-Z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[^A-Za-z0-9]/.test(password)
    );
  },

  /* ------------------------- Registration -------------------------- */

  /**
   * Registers a new applicant. Throws an Error with a user-friendly
   * message if validation fails or the email is already registered.
   */
  async registerApplicant({ fullName, email, mobile, password, confirmPassword, securityQuestion, securityAnswer }) {
    fullName = (fullName || '').trim();
    email = (email || '').trim().toLowerCase();
    mobile = (mobile || '').trim();

    if (!fullName) throw new Error('Full name is required.');
    if (!email || !Auth.isValidEmail(email)) throw new Error('Please enter a valid email address.');
    if (!mobile || !Auth.isValidMobile(mobile)) throw new Error('Please enter a valid 10-digit mobile number.');
    if (!Auth.isStrongPassword(password)) throw new Error('Password must be at least 8 characters and include a letter and a number.');
    if (password !== confirmPassword) throw new Error('Passwords do not match.');
    if (!securityQuestion) throw new Error('Please choose a security question.');
    if (!securityAnswer || !securityAnswer.trim()) throw new Error('Please provide an answer to your security question.');

    const existing = await DB.getByIndex(DB.STORES.APPLICANTS, 'email', email);
    if (existing) throw new Error('An account with this email already exists.');

    const { hash, salt } = await Auth.hashPassword(password);
    const { hash: answerHash, salt: answerSalt } = await Auth.hashPassword(Auth.normalizeAnswer(securityAnswer));

    const id = await DB.add(DB.STORES.APPLICANTS, {
      fullName,
      email,
      mobile,
      passwordHash: hash,
      passwordSalt: salt,
      securityQuestion,
      securityAnswerHash: answerHash,
      securityAnswerSalt: answerSalt,
      createdAt: new Date().toISOString()
    });

    return id;
  },

  /* ------------------------ First-run admin setup ------------------------- */

  /**
   * Creates the one and only initial administrator account. Only succeeds
   * if no administrator account exists yet - there is deliberately no
   * seeded default username/password shipped with this app. Re-checks the
   * count right before writing to close the race where two tabs both load
   * the empty-state setup form at once.
   */
  async createFirstAdmin({ username, password, confirmPassword, securityQuestion, securityAnswer }) {
    username = (username || '').trim();

    if (!username || username.length < 3) throw new Error('Please choose a username of at least 3 characters.');
    if (!Auth.isStrongAdminPassword(password)) {
      throw new Error('Password must be at least 10 characters and include upper case, lower case, a number, and a symbol.');
    }
    if (password !== confirmPassword) throw new Error('Passwords do not match.');
    if (!securityQuestion) throw new Error('Please choose a security question.');
    if (!securityAnswer || !securityAnswer.trim()) throw new Error('Please provide an answer to your security question.');

    const existingCount = await DB.count(DB.STORES.ADMINS);
    if (existingCount > 0) throw new Error('An administrator account already exists. Please sign in instead.');

    const existingUsername = await DB.getByIndex(DB.STORES.ADMINS, 'username', username);
    if (existingUsername) throw new Error('That username is already taken.');

    const { hash, salt } = await Auth.hashPassword(password);
    const { hash: answerHash, salt: answerSalt } = await Auth.hashPassword(Auth.normalizeAnswer(securityAnswer));

    const id = await DB.add(DB.STORES.ADMINS, {
      username,
      passwordHash: hash,
      passwordSalt: salt,
      securityQuestion,
      securityAnswerHash: answerHash,
      securityAnswerSalt: answerSalt,
      createdAt: new Date().toISOString()
    });

    await Auth.recordLoginEvent('admin', username, username, 'success', 'account_created');
    Auth.startSession({ userId: id, role: 'admin', name: username });
    return id;
  },

  /* ------------------------ Login security log ----------------------- */

  /** Records a login-related event (login attempt or password reset attempt) for the audit log. */
  async recordLoginEvent(role, identifier, name, status, reason) {
    try {
      await DB.add(DB.STORES.LOGIN_LOGS, {
        role,
        identifier,
        name: name || '',
        status,          // 'success' | 'failed' | 'blocked' | 'reset_success' | 'reset_failed'
        reason: reason || '',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent
      });
    } catch {
      // Logging must never block a login attempt from completing.
    }
  },

  /**
   * Checks whether a role+identifier is currently locked out due to too
   * many recent failures. Returns { locked, minutesRemaining } - counts
   * both failed logins and failed password-reset answers together, since
   * both are guessing attacks against the same account.
   */
  async checkLockout(role, identifier) {
    const logs = await DB.getAllByIndex(DB.STORES.LOGIN_LOGS, 'identifier', identifier);
    const cutoff = Date.now() - LOCKOUT_WINDOW_MINUTES * 60000;

    const recentFailures = logs
      .filter((l) => l.role === role && (l.status === 'failed' || l.status === 'reset_failed'))
      .filter((l) => new Date(l.timestamp).getTime() >= cutoff)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (recentFailures.length < MAX_FAILED_ATTEMPTS) {
      return { locked: false, minutesRemaining: 0 };
    }

    const mostRecentFailure = new Date(recentFailures[0].timestamp).getTime();
    const unlocksAt = mostRecentFailure + LOCKOUT_WINDOW_MINUTES * 60000;
    const minutesRemaining = Math.max(1, Math.ceil((unlocksAt - Date.now()) / 60000));

    return { locked: Date.now() < unlocksAt, minutesRemaining };
  },

  /* ---------------------------- Login ------------------------------ */

  async loginApplicant(email, password) {
    email = (email || '').trim().toLowerCase();

    const lockout = await Auth.checkLockout('applicant', email);
    if (lockout.locked) {
      await Auth.recordLoginEvent('applicant', email, '', 'blocked', 'lockout');
      throw new Error(`Too many failed attempts. Please try again in about ${lockout.minutesRemaining} minute(s), or reset your password.`);
    }

    const applicant = await DB.getByIndex(DB.STORES.APPLICANTS, 'email', email);
    if (!applicant) {
      await Auth.recordLoginEvent('applicant', email, '', 'failed', 'no_such_account');
      throw new Error('Invalid email or password.');
    }

    const ok = await Auth.verifyPassword(password, applicant.passwordHash, applicant.passwordSalt);
    if (!ok) {
      await Auth.recordLoginEvent('applicant', email, applicant.fullName, 'failed', 'wrong_password');
      throw new Error('Invalid email or password.');
    }

    await Auth.recordLoginEvent('applicant', email, applicant.fullName, 'success', '');
    Auth.startSession({ userId: applicant.id, role: 'applicant', name: applicant.fullName });
    return applicant;
  },

  async loginAdmin(username, password) {
    username = (username || '').trim();

    const lockout = await Auth.checkLockout('admin', username);
    if (lockout.locked) {
      await Auth.recordLoginEvent('admin', username, '', 'blocked', 'lockout');
      throw new Error(`Too many failed attempts. Please try again in about ${lockout.minutesRemaining} minute(s), or reset your password.`);
    }

    const admin = await DB.getByIndex(DB.STORES.ADMINS, 'username', username);
    if (!admin) {
      await Auth.recordLoginEvent('admin', username, '', 'failed', 'no_such_account');
      throw new Error('Invalid username or password.');
    }

    const ok = await Auth.verifyPassword(password, admin.passwordHash, admin.passwordSalt);
    if (!ok) {
      await Auth.recordLoginEvent('admin', username, admin.username, 'failed', 'wrong_password');
      throw new Error('Invalid username or password.');
    }

    await Auth.recordLoginEvent('admin', username, admin.username, 'success', '');
    Auth.startSession({ userId: admin.id, role: 'admin', name: admin.username });
    return admin;
  },

  /* ------------------------ Forgot password / reset ------------------------ */

  /**
   * Looks up the security question for a given role+identifier, without
   * revealing whether the account exists (returns null either way so the
   * reset form can show a generic message rather than leaking which
   * emails/usernames are registered).
   */
  async getSecurityQuestion(role, identifier) {
    identifier = (identifier || '').trim();
    if (role !== 'admin') identifier = identifier.toLowerCase();
    const store = role === 'admin' ? DB.STORES.ADMINS : DB.STORES.APPLICANTS;
    const indexName = role === 'admin' ? 'username' : 'email';
    const record = await DB.getByIndex(store, indexName, identifier);
    return record ? record.securityQuestion : null;
  },

  /**
   * Verifies the security answer and, if correct, sets a new password.
   * Throws a user-friendly Error on any failure (locked out, no account,
   * wrong answer, weak new password).
   */
  async resetPassword(role, identifier, securityAnswer, newPassword, confirmNewPassword) {
    identifier = (identifier || '').trim();
    if (role !== 'admin') identifier = identifier.toLowerCase();
    const store = role === 'admin' ? DB.STORES.ADMINS : DB.STORES.APPLICANTS;
    const indexName = role === 'admin' ? 'username' : 'email';

    const strongEnough = role === 'admin' ? Auth.isStrongAdminPassword(newPassword) : Auth.isStrongPassword(newPassword);
    if (!strongEnough) {
      throw new Error(role === 'admin'
        ? 'New password must be at least 10 characters and include upper case, lower case, a number, and a symbol.'
        : 'New password must be at least 8 characters and include a letter and a number.');
    }
    if (newPassword !== confirmNewPassword) throw new Error('New passwords do not match.');

    const lockout = await Auth.checkLockout(role, identifier);
    if (lockout.locked) {
      await Auth.recordLoginEvent(role, identifier, '', 'blocked', 'lockout');
      throw new Error(`Too many failed attempts. Please try again in about ${lockout.minutesRemaining} minute(s).`);
    }

    const record = await DB.getByIndex(store, indexName, identifier);
    if (!record || !record.securityAnswerHash) {
      await Auth.recordLoginEvent(role, identifier, '', 'reset_failed', 'no_account_or_no_question');
      throw new Error('We could not verify that account and security answer.');
    }

    const ok = await Auth.verifyPassword(Auth.normalizeAnswer(securityAnswer), record.securityAnswerHash, record.securityAnswerSalt);
    if (!ok) {
      await Auth.recordLoginEvent(role, identifier, record.fullName || record.username, 'reset_failed', 'wrong_answer');
      throw new Error('That answer did not match. Please try again.');
    }

    const { hash, salt } = await Auth.hashPassword(newPassword);
    record.passwordHash = hash;
    record.passwordSalt = salt;
    await DB.put(store, record);

    await Auth.recordLoginEvent(role, identifier, record.fullName || record.username, 'reset_success', '');
    return true;
  },

  /**
   * Changes a password for an already-authenticated user (used from the
   * admin Security tab), verifying the current password first.
   */
  async changePassword(store, id, currentPassword, newPassword, confirmNewPassword) {
    const strongEnough = store === DB.STORES.ADMINS ? Auth.isStrongAdminPassword(newPassword) : Auth.isStrongPassword(newPassword);
    if (!strongEnough) {
      throw new Error(store === DB.STORES.ADMINS
        ? 'New password must be at least 10 characters and include upper case, lower case, a number, and a symbol.'
        : 'New password must be at least 8 characters and include a letter and a number.');
    }
    if (newPassword !== confirmNewPassword) throw new Error('New passwords do not match.');

    const record = await DB.get(store, id);
    if (!record) throw new Error('Account not found.');

    const ok = await Auth.verifyPassword(currentPassword, record.passwordHash, record.passwordSalt);
    if (!ok) throw new Error('Current password is incorrect.');

    const { hash, salt } = await Auth.hashPassword(newPassword);
    record.passwordHash = hash;
    record.passwordSalt = salt;
    await DB.put(store, record);
    return true;
  },

  /** Updates (or sets for the first time) the security question on an already-authenticated account. */
  async updateSecurityQuestion(store, id, question, answer) {
    if (!question) throw new Error('Please choose a security question.');
    if (!answer || !answer.trim()) throw new Error('Please provide an answer.');

    const record = await DB.get(store, id);
    if (!record) throw new Error('Account not found.');

    const { hash, salt } = await Auth.hashPassword(Auth.normalizeAnswer(answer));
    record.securityQuestion = question;
    record.securityAnswerHash = hash;
    record.securityAnswerSalt = salt;
    await DB.put(store, record);
    return true;
  },

  /* --------------------------- Session ------------------------------ */

  /** Starts a new session and regenerates the session token (prevents session fixation). */
  startSession({ userId, role, name }) {
    const token = _bytesToBase64(crypto.getRandomValues(new Uint8Array(24)));
    const now = Date.now();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      userId, role, name, token, loginAt: now, lastActivity: now
    }));
  },

  /** Returns the current session, or null if there isn't one or it has timed out. */
  getSession() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    let session;
    try { session = JSON.parse(raw); } catch { return null; }

    const minutesSinceActivity = (Date.now() - session.lastActivity) / 60000;
    if (minutesSinceActivity > SESSION_TIMEOUT_MINUTES) {
      Auth.logout();
      return null;
    }

    // Sliding expiry: any check-in while active extends the session.
    session.lastActivity = Date.now();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  },

  logout() {
    sessionStorage.removeItem(SESSION_KEY);
  },

  /**
   * Guards a page: if there's no valid session with the required role,
   * redirects to the given login page and returns null. Otherwise
   * returns the session object. Call this at the top of protected pages.
   */
  requireRole(role, redirectTo) {
    const session = Auth.getSession();
    if (!session || session.role !== role) {
      window.location.href = redirectTo;
      return null;
    }
    return session;
  }
};
