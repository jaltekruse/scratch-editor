import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {connect} from 'react-redux';
import {SERIAL_PORT_FILTERS, uploadFirmware} from '@scratch/arduboy-toolchain';

import ArduboyModalComponent from '../components/arduboy-modal/arduboy-modal.jsx';
import downloadBlob from '../lib/download-blob';
import log from '../lib/log';
import {closeArduboyModal} from '../reducers/modals';
import {
    TARGETS,
    compileSketch,
    convertProjectToSketch,
    getCompiler,
    getSavedTargetId,
    saveTargetId,
    zipSketch
} from '../lib/arduboy/arduboy-build';

const messages = defineMessages({
    compileFailed: {
        id: 'gui.arduboyModal.compileFailed',
        defaultMessage: 'The project could not be built for Arduboy. Some blocks may not be supported yet.',
        description: 'Error shown when the Arduboy program fails to compile; compiler messages are shown below it'
    },
    failed: {
        id: 'gui.arduboyModal.failed',
        defaultMessage: 'Something went wrong: {message}',
        description: 'Error shown when building or uploading to the Arduboy fails unexpectedly'
    }
});

class CompileError extends Error {}

/** The user closed the device chooser; the upload stops without an error message. */
class UploadCancelled extends Error {}

const sketchName = title => (title || 'Project').replace(/[^A-Za-z0-9_]/g, '_');

const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

const ArduboyModal = ({onRequestClose, projectTitle, visible, vm}) => {
    const intl = useIntl();
    const [targetId, setTargetId] = useState(getSavedTargetId);
    const [busy, setBusy] = useState(false);
    const [step, setStep] = useState(null);
    const [progress, setProgress] = useState(null);
    const [error, setError] = useState(null);
    const [diagnostics, setDiagnostics] = useState('');
    const [size, setSize] = useState(null);
    const [skippedCostumes, setSkippedCostumes] = useState([]);
    // Which serial port the dialog is waiting for the user to choose with a button: 'device' or 'bootloader'.
    const [portRequest, setPortRequest] = useState(null);
    // Settles the promise of the pending port request.
    const pendingPortRequest = useRef(null);

    useEffect(() => {
        if (!visible) return;
        // Start downloading the compiler in the background; failures resurface when building. Creating the worker
        // throws synchronously where workers are blocked (e.g. pages opened from file://).
        try {
            getCompiler().warmUp()
                .catch(e => log.warn('Arduboy toolchain warm-up failed', e));
        } catch (e) {
            log.warn('Arduboy compiler is unavailable', e);
        }
        return () => {
            if (pendingPortRequest.current) {
                pendingPortRequest.current.reject(new UploadCancelled());
                pendingPortRequest.current = null;
            }
        };
    }, [visible]);

    const convert = useCallback(async () => {
        setStep('converting');
        const sb3 = await vm.saveProjectSb3();
        const {files, skipped} = await convertProjectToSketch(await sb3.arrayBuffer());
        setSkippedCostumes(skipped);
        return files;
    }, [vm]);

    const build = useCallback(async () => {
        const files = await convert();
        setStep('compiling');
        const result = await compileSketch(files, targetId);
        setDiagnostics(result.diagnostics);
        setSize(result.flashBytes ? result : null);
        if (!result.ok) throw new CompileError(intl.formatMessage(messages.compileFailed));
        return result.hex;
    }, [convert, intl, targetId]);

    const run = useCallback(async task => {
        setBusy(true);
        setError(null);
        setDiagnostics('');
        setSize(null);
        setSkippedCostumes([]);
        setProgress(null);
        try {
            await task();
        } catch (e) {
            setStep(null);
            setProgress(null);
            if (e instanceof CompileError) {
                setError(e.message);
            } else if (e instanceof UploadCancelled) {
                setDiagnostics('');
            } else {
                log.error('Arduboy build or upload failed', e);
                setError(intl.formatMessage(messages.failed, {message: e.message}));
            }
        } finally {
            setBusy(false);
            setPortRequest(null);
        }
    }, [intl]);

    /**
     * Have the user choose a serial port with a button, for when the browser no longer counts the original click as
     * a user gesture (the device chooser can only open in response to one).
     * @param {string} kind Which port is wanted: 'device' or 'bootloader'.
     * @returns {Promise<SerialPort>} The chosen port.
     */
    const askForPortWithButton = useCallback(kind => new Promise((resolve, reject) => {
        pendingPortRequest.current = {resolve, reject};
        setPortRequest(kind);
    }), []);

    const handleUpload = useCallback(() => run(async () => {
        // Build first, so the device is only contacted once there's something to upload.
        const hex = await build();
        let port;
        try {
            port = await navigator.serial.requestPort({filters: SERIAL_PORT_FILTERS});
        } catch (e) {
            if (e.name === 'NotFoundError') throw new UploadCancelled();
            // The build outlasted the click's user activation (e.g. while the compiler was still downloading).
            if (e.name !== 'SecurityError') throw e;
            port = await askForPortWithButton('device');
        }
        await uploadFirmware({
            port,
            hex,
            onStatus: status => {
                if (status.step === 'programming') {
                    setStep(status.phase);
                    setProgress(status.done / status.total);
                } else {
                    setStep(status.step);
                    setProgress(null);
                }
            },
            requestBootloaderPort: () => askForPortWithButton('bootloader')
        });
    }), [askForPortWithButton, build, run]);

    const handleChoosePort = useCallback(() => {
        const request = pendingPortRequest.current;
        if (!request) return;
        pendingPortRequest.current = null;
        setPortRequest(null);
        navigator.serial.requestPort({filters: SERIAL_PORT_FILTERS}).then(
            request.resolve,
            e => request.reject(e.name === 'NotFoundError' ? new UploadCancelled() : e)
        );
    }, []);

    const handleDownloadHex = useCallback(() => run(async () => {
        const hex = await build();
        setStep('built');
        downloadBlob(`${sketchName(projectTitle)}.hex`, new Blob([hex], {type: 'text/plain'}));
    }), [build, projectTitle, run]);

    const handleDownloadSketch = useCallback(() => run(async () => {
        const files = await convert();
        setStep(null);
        const name = sketchName(projectTitle);
        downloadBlob(`${name}.zip`, await zipSketch(files, name));
    }), [convert, projectTitle, run]);

    const handleChangeTarget = useCallback(e => {
        setTargetId(e.target.value);
        saveTargetId(e.target.value);
    }, []);

    if (!visible) return null;
    return (
        <ArduboyModalComponent
            busy={busy}
            diagnostics={diagnostics}
            error={error}
            flashBytes={size && size.flashBytes}
            maxFlashBytes={size && size.maxFlashBytes}
            maxRamBytes={size && size.maxRamBytes}
            progress={progress}
            ramBytes={size && size.ramBytes}
            serialSupported={serialSupported}
            portRequest={portRequest}
            skippedCostumes={skippedCostumes}
            step={step}
            targetId={targetId}
            targets={TARGETS}
            onChangeTarget={handleChangeTarget}
            onDownloadHex={handleDownloadHex}
            onDownloadSketch={handleDownloadSketch}
            onRequestClose={onRequestClose}
            onChoosePort={handleChoosePort}
            onUpload={handleUpload}
        />
    );
};

ArduboyModal.propTypes = {
    onRequestClose: PropTypes.func.isRequired,
    projectTitle: PropTypes.string,
    visible: PropTypes.bool.isRequired,
    vm: PropTypes.shape({
        saveProjectSb3: PropTypes.func.isRequired
    }).isRequired
};

const mapStateToProps = state => ({
    projectTitle: state.scratchGui.projectTitle,
    visible: state.scratchGui.modals.arduboyModal,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onRequestClose: () => dispatch(closeArduboyModal())
});

export default connect(mapStateToProps, mapDispatchToProps)(ArduboyModal);
