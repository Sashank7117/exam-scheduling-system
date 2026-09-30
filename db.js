/**
 * db.js
 * ------------------------------------------------------------------
 * IndexedDB data layer for the Exam Scheduling System.
 * Everything the app stores (applicants, admins, exams, slots,
 * applications/bookings) lives in one IndexedDB database.
 *
 * This file exposes a single global object, `DB`, with small
 * promise-based helper methods so the rest of the app never has to
 * touch the raw IndexedDB API directly (except the seat-booking
 * transaction in schedule.js, which needs a multi-store transaction).
 * ------------------------------------------------------------------
 */

const DB_NAME = 'ExamSchedulingSystemDB';
const DB_VERSION = 2;

const STORES = {
  APPLICANTS: 'applicants',
  ADMINS: 'admins',
  EXAMS: 'exams',
  SLOTS: 'slots',
  APPLICATIONS: 'applications',
  LOGIN_LOGS: 'loginLogs'
};

let _dbInstance = null;

/**
 * Opens (and if needed, creates) the database and all object stores.
 * Safe to call many times - subsequent calls reuse the same connection.
 */
function _openDatabase() {
  return new Promise((resolve, reject) => {
    if (_dbInstance) {
      resolve(_dbInstance);
      return;
    }

    if (!window.indexedDB) {
      reject(new Error('This browser does not support IndexedDB. Please use a modern browser (Chrome, Firefox, Edge, Safari).'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.APPLICANTS)) {
        const applicants = db.createObjectStore(STORES.APPLICANTS, { keyPath: 'id', autoIncrement: true });
        applicants.createIndex('email', 'email', { unique: true });
      }

      if (!db.objectStoreNames.contains(STORES.ADMINS)) {
        const admins = db.createObjectStore(STORES.ADMINS, { keyPath: 'id', autoIncrement: true });
        admins.createIndex('username', 'username', { unique: true });
      }

      if (!db.objectStoreNames.contains(STORES.EXAMS)) {
        const exams = db.createObjectStore(STORES.EXAMS, { keyPath: 'id', autoIncrement: true });
        exams.createIndex('examCode', 'examCode', { unique: true });
      }

      if (!db.objectStoreNames.contains(STORES.SLOTS)) {
        const slots = db.createObjectStore(STORES.SLOTS, { keyPath: 'id', autoIncrement: true });
        slots.createIndex('examId', 'examId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.APPLICATIONS)) {
        const applications = db.createObjectStore(STORES.APPLICATIONS, { keyPath: 'id', autoIncrement: true });
        applications.createIndex('applicantId', 'applicantId', { unique: false });
        applications.createIndex('slotId', 'slotId', { unique: false });
        applications.createIndex('examId', 'examId', { unique: false });
        applications.createIndex('hallTicketNumber', 'hallTicketNumber', { unique: true });
      }

      if (!db.objectStoreNames.contains(STORES.LOGIN_LOGS)) {
        const loginLogs = db.createObjectStore(STORES.LOGIN_LOGS, { keyPath: 'id', autoIncrement: true });
        loginLogs.createIndex('identifier', 'identifier', { unique: false });
        loginLogs.createIndex('role', 'role', { unique: false });
        loginLogs.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      _dbInstance = event.target.result;
      resolve(_dbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error || new Error('Failed to open the database.'));
    };
  });
}

/** Wraps an IDBRequest in a Promise. */
function _wrapRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const DB = {
  STORES,

  /** Opens the database. Call once on page load before anything else. */
  init() {
    return _openDatabase();
  },

  /** Returns the raw IDBDatabase instance, for custom multi-store transactions. */
  async raw() {
    return _openDatabase();
  },

  /** Adds a new record. Fails if the key already exists. Returns the new key. */
  async add(storeName, value) {
    const db = await _openDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    const result = await _wrapRequest(tx.objectStore(storeName).add(value));
    return result;
  },

  /** Inserts or updates a record (matched by keyPath). Returns the key. */
  async put(storeName, value) {
    const db = await _openDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    const result = await _wrapRequest(tx.objectStore(storeName).put(value));
    return result;
  },

  /** Fetches one record by primary key. */
  async get(storeName, key) {
    const db = await _openDatabase();
    const tx = db.transaction(storeName, 'readonly');
    return _wrapRequest(tx.objectStore(storeName).get(key));
  },

  /** Fetches every record in a store. */
  async getAll(storeName) {
    const db = await _openDatabase();
    const tx = db.transaction(storeName, 'readonly');
    return _wrapRequest(tx.objectStore(storeName).getAll());
  },

  /** Fetches the first record matching an index value. */
  async getByIndex(storeName, indexName, value) {
    const db = await _openDatabase();
    const tx = db.transaction(storeName, 'readonly');
    return _wrapRequest(tx.objectStore(storeName).index(indexName).get(value));
  },

  /** Fetches every record matching an index value. */
  async getAllByIndex(storeName, indexName, value) {
    const db = await _openDatabase();
    const tx = db.transaction(storeName, 'readonly');
    return _wrapRequest(tx.objectStore(storeName).index(indexName).getAll(value));
  },

  /** Deletes a record by primary key. */
  async delete(storeName, key) {
    const db = await _openDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    return _wrapRequest(tx.objectStore(storeName).delete(key));
  },

  /** Counts the records in a store. */
  async count(storeName) {
    const db = await _openDatabase();
    const tx = db.transaction(storeName, 'readonly');
    return _wrapRequest(tx.objectStore(storeName).count());
  }
};
