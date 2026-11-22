import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, FormattedMessage, useIntl} from 'react-intl';

import Modal from '../../containers/modal.jsx';

import styles from './arduboy-modal.css';

const messages = defineMessages({
    title: {
        id: 'gui.arduboyModal.title',
        defaultMessage: 'Arduboy',
        description: 'Title of the dialog for uploading the project to an Arduboy game console'
    }
});

/**
 * Upload status steps, as reported by `uploadFirmware` in `@scratch/arduboy-toolchain`, plus the steps before it.
 */
const STEP_MESSAGES = defineMessages({
    'converting': {
        id: 'gui.arduboyModal.step.converting',
        defaultMessage: 'Converting project to Arduboy code…',
        description: 'Status shown while converting the Scratch project into Arduboy code'
    },
    'compiling': {
        id: 'gui.arduboyModal.step.compiling',
        defaultMessage: 'Compiling… (the first build downloads the compiler, which can take a while)',
        description: 'Status shown while compiling the Arduboy program'
    },
    'resetting': {
        id: 'gui.arduboyModal.step.resetting',
        defaultMessage: 'Restarting the device into its bootloader…',
        description: 'Status shown while asking the device to restart so it can be programmed'
    },
    'waiting-for-bootloader': {
        id: 'gui.arduboyModal.step.waitingForBootloader',
        defaultMessage: 'Waiting for the bootloader…',
        description: 'Status shown while waiting for the device to restart into programming mode'
    },
    'connecting': {
        id: 'gui.arduboyModal.step.connecting',
        defaultMessage: 'Connecting to the bootloader…',
        description: 'Status shown while connecting to the device in programming mode'
    },
    'write': {
        id: 'gui.arduboyModal.step.writing',
        defaultMessage: 'Writing…',
        description: 'Status shown while writing the program to the device'
    },
    'verify': {
        id: 'gui.arduboyModal.step.verifying',
        defaultMessage: 'Verifying…',
        description: 'Status shown while checking the program written to the device'
    },
    'done': {
        id: 'gui.arduboyModal.step.done',
        defaultMessage: 'Done! Your game is running on the device.',
        description: 'Status shown when the program was uploaded successfully'
    },
    'built': {
        id: 'gui.arduboyModal.step.built',
        defaultMessage: 'Build finished.',
        description: 'Status shown when the program was compiled successfully, without uploading'
    }
});

const ArduboyModalComponent = ({
    busy,
    diagnostics,
    error,
    flashBytes,
    maxFlashBytes,
    onChangeTarget,
    onDownloadHex,
    onDownloadSketch,
    onRequestClose,
    onSelectBootloaderPort,
    onUpload,
    progress,
    ramBytes,
    maxRamBytes,
    serialSupported,
    showBootloaderButton,
    step,
    targetId,
    targets
}) => {
    const intl = useIntl();
    return (
        <Modal
            className={styles.modalContent}
            contentLabel={intl.formatMessage(messages.title)}
            id="arduboyModal"
            onRequestClose={onRequestClose}
        >
            <div className={styles.body}>
                <p className={styles.note}>
                    <FormattedMessage
                        defaultMessage="Turn your project into a game for an Arduboy or a homemade Arduboy. Connect the device with a USB cable, choose its type and click Upload." // eslint-disable-line @stylistic/max-len
                        description="Instructions at the top of the Arduboy upload dialog"
                        id="gui.arduboyModal.instructions"
                    />
                </p>
                {serialSupported ? null : (
                    <p className={styles.warning}>
                        <FormattedMessage
                            defaultMessage="This browser can't connect to devices. Use Chrome or Edge to upload, or download the firmware and upload it with another tool." // eslint-disable-line @stylistic/max-len
                            description="Warning shown in the Arduboy dialog when the browser lacks Web Serial support"
                            id="gui.arduboyModal.noSerial"
                        />
                    </p>
                )}
                <div className={styles.row}>
                    <label
                        className={styles.label}
                        htmlFor="arduboy-target"
                    >
                        <FormattedMessage
                            defaultMessage="Device"
                            description="Label for choosing the type of Arduboy hardware"
                            id="gui.arduboyModal.device"
                        />
                    </label>
                    <select
                        className={styles.select}
                        disabled={busy}
                        id="arduboy-target"
                        value={targetId}
                        onChange={onChangeTarget}
                    >
                        {targets.map(target => (
                            <option
                                key={target.id}
                                value={target.id}
                            >
                                {target.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div className={styles.row}>
                    <button
                        className={styles.button}
                        disabled={busy || !serialSupported}
                        onClick={onUpload}
                    >
                        <FormattedMessage
                            defaultMessage="Upload"
                            description="Button that builds the project and uploads it to the Arduboy"
                            id="gui.arduboyModal.upload"
                        />
                    </button>
                    {showBootloaderButton ? (
                        <button
                            className={styles.attentionButton}
                            onClick={onSelectBootloaderPort}
                        >
                            <FormattedMessage
                                defaultMessage="Select the device again"
                                description="Button shown when the restarted Arduboy must be chosen again to finish uploading" // eslint-disable-line @stylistic/max-len
                                id="gui.arduboyModal.selectBootloader"
                            />
                        </button>
                    ) : null}
                    <button
                        className={styles.secondaryButton}
                        disabled={busy}
                        onClick={onDownloadHex}
                    >
                        <FormattedMessage
                            defaultMessage="Download firmware (.hex)"
                            description="Button that builds the project and downloads the Arduboy firmware file"
                            id="gui.arduboyModal.downloadHex"
                        />
                    </button>
                    <button
                        className={styles.secondaryButton}
                        disabled={busy}
                        onClick={onDownloadSketch}
                    >
                        <FormattedMessage
                            defaultMessage="Download Arduino sketch"
                            description="Button that downloads the generated Arduino source code"
                            id="gui.arduboyModal.downloadSketch"
                        />
                    </button>
                </div>
                {showBootloaderButton ? (
                    <p className={styles.warning}>
                        <FormattedMessage
                            defaultMessage="The device restarted into programming mode. Click “Select the device again” and choose it within a few seconds." // eslint-disable-line @stylistic/max-len
                            description="Explains why the Arduboy must be chosen a second time during upload"
                            id="gui.arduboyModal.bootloaderHelp"
                        />
                    </p>
                ) : null}
                {step ? (
                    <p className={styles.note}>{intl.formatMessage(STEP_MESSAGES[step])}</p>
                ) : null}
                {progress === null ? null : (
                    <progress
                        className={styles.progress}
                        max={1}
                        value={progress}
                    />
                )}
                {flashBytes ? (
                    <p className={styles.note}>
                        <FormattedMessage
                            defaultMessage="Program size: {flashBytes} of {maxFlashBytes} bytes. Memory: {ramBytes} of {maxRamBytes} bytes." // eslint-disable-line @stylistic/max-len
                            description="Size of the compiled Arduboy program and memory it uses"
                            id="gui.arduboyModal.size"
                            values={{flashBytes, maxFlashBytes, ramBytes, maxRamBytes}}
                        />
                    </p>
                ) : null}
                {error ? <p className={styles.warning}>{error}</p> : null}
                {diagnostics ? <pre className={styles.log}>{diagnostics}</pre> : null}
            </div>
        </Modal>
    );
};

ArduboyModalComponent.propTypes = {
    busy: PropTypes.bool.isRequired,
    diagnostics: PropTypes.string,
    error: PropTypes.string,
    flashBytes: PropTypes.number,
    maxFlashBytes: PropTypes.number,
    maxRamBytes: PropTypes.number,
    onChangeTarget: PropTypes.func.isRequired,
    onDownloadHex: PropTypes.func.isRequired,
    onDownloadSketch: PropTypes.func.isRequired,
    onRequestClose: PropTypes.func.isRequired,
    onSelectBootloaderPort: PropTypes.func.isRequired,
    onUpload: PropTypes.func.isRequired,
    progress: PropTypes.number,
    ramBytes: PropTypes.number,
    serialSupported: PropTypes.bool.isRequired,
    showBootloaderButton: PropTypes.bool.isRequired,
    step: PropTypes.oneOf(Object.keys(STEP_MESSAGES)),
    targetId: PropTypes.string.isRequired,
    targets: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        name: PropTypes.string.isRequired
    })).isRequired
};

export default ArduboyModalComponent;
