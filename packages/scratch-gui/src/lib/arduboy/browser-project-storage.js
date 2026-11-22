/**
 * Stores projects in the browser's IndexedDB, keyed by title, so the editor can be used without a server.
 */

const DB_NAME = 'scratch-gui-projects';
const DB_VERSION = 1;
const STORE = 'projects';

let dbPromise = null;

const promisify = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

const openDatabase = () => {
    if (!dbPromise) {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE, {keyPath: 'title'});
        };
        dbPromise = promisify(request);
        // Allow a later retry if the database could not be opened (e.g. storage blocked).
        dbPromise.catch(() => {
            dbPromise = null;
        });
    }
    return dbPromise;
};

const withStore = async (mode, operation) => {
    const db = await openDatabase();
    const transaction = db.transaction(STORE, mode);
    const committed = new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
    const result = await promisify(operation(transaction.objectStore(STORE)));
    await committed;
    return result;
};

/**
 * @typedef {object} StoredProjectInfo
 * @property {string} title Project title, unique within the store.
 * @property {number} modified Time of the last save, in milliseconds since the epoch.
 * @property {number} size Size of the project file in bytes.
 */

/**
 * List saved projects, most recently modified first.
 * @returns {Promise<StoredProjectInfo[]>} Saved projects, without their contents.
 */
const listProjects = async () => {
    const records = await withStore('readonly', store => store.getAll());
    return records
        .map(({title, modified, sb3}) => ({title, modified, size: sb3.byteLength}))
        .sort((a, b) => b.modified - a.modified);
};

/**
 * Save a project, replacing any saved project with the same title.
 * @param {string} title Project title.
 * @param {ArrayBuffer} sb3 Project file contents.
 * @returns {Promise<void>} Resolves once stored.
 */
const saveProject = async (title, sb3) => {
    await withStore('readwrite', store => store.put({title, modified: Date.now(), sb3}));
};

/**
 * Load a saved project's file.
 * @param {string} title Project title.
 * @returns {Promise<ArrayBuffer>} The `.sb3` contents.
 */
const loadProject = async title => {
    const record = await withStore('readonly', store => store.get(title));
    if (!record) throw new Error(`No project named "${title}" is saved in this browser`);
    return record.sb3;
};

/**
 * Check whether a project with this title is saved.
 * @param {string} title Project title.
 * @returns {Promise<boolean>} True if saved.
 */
const hasProject = async title => (await withStore('readonly', store => store.count(title))) > 0;

/**
 * Delete a saved project.
 * @param {string} title Project title.
 * @returns {Promise<void>} Resolves once deleted.
 */
const deleteProject = async title => {
    await withStore('readwrite', store => store.delete(title));
};

export {
    deleteProject,
    hasProject,
    listProjects,
    loadProject,
    saveProject
};
