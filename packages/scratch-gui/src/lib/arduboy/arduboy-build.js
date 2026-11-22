import JSZip from 'jszip';
import {browserRasterizer, Project, toArduboy} from 'sb-edit';
import {ArduboyCompiler, TARGETS} from '@scratch/arduboy-toolchain';

/**
 * Where webpack copies `@scratch/arduboy-toolchain/dist/toolchain`, relative to the page.
 */
const TOOLCHAIN_ASSETS_BASE = 'static/arduboy-toolchain/';
const TARGET_STORAGE_KEY = 'scratch-gui-arduboy-target';
const MAIN_SKETCH_FILE = 'project.ino';

let compiler = null;

/**
 * The shared compiler. Its worker keeps downloaded assets and compiled WebAssembly between builds.
 * @returns {ArduboyCompiler} The compiler.
 */
const getCompiler = () => {
    if (!compiler) compiler = new ArduboyCompiler({assetsBase: TOOLCHAIN_ASSETS_BASE});
    return compiler;
};

/**
 * @returns {string} The hardware target chosen last time, or the official Arduboy.
 */
const getSavedTargetId = () => {
    try {
        const id = localStorage.getItem(TARGET_STORAGE_KEY);
        if (TARGETS.some(target => target.id === id)) return id;
    } catch (e) {
        // Storage can be unavailable (e.g. blocked cookies); fall back to the default.
    }
    return TARGETS[0].id;
};

/**
 * @param {string} id Hardware target to use by default next time.
 */
const saveTargetId = id => {
    try {
        localStorage.setItem(TARGET_STORAGE_KEY, id);
    } catch (e) {
        // Not remembering the choice is harmless.
    }
};

/**
 * Convert a Scratch project to an Arduboy sketch.
 * @param {ArrayBuffer} sb3 The project file.
 * @returns {Promise<{files: Array<{path: string, contents: string}>, skipped: Array<object>}>} Sketch files (the
 *     primary file is `project.ino`), and the `{target, costume}` pairs left out because they are too large.
 */
const convertProjectToSketch = async sb3 => {
    const project = await Project.fromSb3(sb3);
    const {files, skipped} = await toArduboy(project, {rasterize: browserRasterizer});
    return {
        files: Object.entries(files).map(([path, contents]) => ({path, contents})),
        skipped
    };
};

/**
 * Compile a sketch produced by {@link convertProjectToSketch}.
 * @param {Array<{path: string, contents: string}>} files Sketch files.
 * @param {string} targetId Hardware target.
 * @returns {Promise<object>} The compile result from `@scratch/arduboy-toolchain`.
 */
const compileSketch = (files, targetId) => getCompiler().compile({target: targetId, files, main: MAIN_SKETCH_FILE});

/**
 * Package a sketch for the Arduino IDE, which expects the primary file to match the folder name.
 * @param {Array<{path: string, contents: string}>} files Sketch files.
 * @param {string} name Sketch (folder) name.
 * @returns {Promise<Blob>} Zip archive.
 */
const zipSketch = (files, name) => {
    const zip = new JSZip();
    const folder = zip.folder(name);
    for (const {path, contents} of files) {
        folder.file(path === MAIN_SKETCH_FILE ? `${name}.ino` : path, contents);
    }
    return zip.generateAsync({type: 'blob'});
};

export {
    TARGETS,
    compileSketch,
    convertProjectToSketch,
    getCompiler,
    getSavedTargetId,
    saveTargetId,
    zipSketch
};
