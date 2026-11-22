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
    const [showBootloaderButton, setShowBootloaderButton] = useState(false);
    // Settles the promise returned to uploadFirmware's requestBootloaderPort callback.
    const bootloaderRequest = useRef(null);

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
            if (bootloaderRequest.current) {
                bootloaderRequest.current.reject(new Error('Upload cancelled'));
                bootloaderRequest.current = null;
            }
        };
    }, [visible]);

    const convert = useCallback(async () => {
        setStep('converting');
        const sb3 = await vm.saveProjectSb3();
        return convertProjectToSketch(await sb3.arrayBuffer());
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
        setProgress(null);
        try {
            await task();
        } catch (e) {
            setStep(null);
            setProgress(null);
            if (e instanceof CompileError) {
                setError(e.message);
            } else {
                log.error('Arduboy build or upload failed', e);
                setError(intl.formatMessage(messages.failed, {message: e.message}));
            }
        } finally {
            setBusy(false);
            setShowBootloaderButton(false);
        }
    }, [intl]);

    const handleUpload = useCallback(async () => {
        let port;
        try {
            // Must happen first, while the click still counts as a user gesture.
            port = await navigator.serial.requestPort({filters: SERIAL_PORT_FILTERS});
        } catch (e) {
            return; // The user closed the device chooser.
        }
        await run(async () => {
            const hex = await build();
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
                requestBootloaderPort: () => new Promise((resolve, reject) => {
                    bootloaderRequest.current = {resolve, reject};
                    setShowBootloaderButton(true);
                })
            });
        });
    }, [build, run]);

    const handleSelectBootloaderPort = useCallback(() => {
        const request = bootloaderRequest.current;
        if (!request) return;
        bootloaderRequest.current = null;
        setShowBootloaderButton(false);
        navigator.serial.requestPort({filters: SERIAL_PORT_FILTERS}).then(request.resolve, request.reject);
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
            showBootloaderButton={showBootloaderButton}
            step={step}
            targetId={targetId}
            targets={TARGETS}
            onChangeTarget={handleChangeTarget}
            onDownloadHex={handleDownloadHex}
            onDownloadSketch={handleDownloadSketch}
            onRequestClose={onRequestClose}
            onSelectBootloaderPort={handleSelectBootloaderPort}
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
