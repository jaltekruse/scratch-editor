import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, FormattedMessage, FormattedRelativeTime, useIntl} from 'react-intl';

import Modal from '../../containers/modal.jsx';

import styles from './browser-projects-modal.css';

const messages = defineMessages({
    title: {
        id: 'gui.browserProjectsModal.title',
        defaultMessage: 'Projects saved in this browser',
        description: 'Title of the dialog listing projects saved in the browser'
    },
    titleLabel: {
        id: 'gui.browserProjectsModal.titleLabel',
        defaultMessage: 'Project name',
        description: 'Accessible label of the project name field in the browser projects dialog'
    }
});

const BrowserProjectsModalComponent = ({
    busy,
    error,
    onChangeSaveTitle,
    onDelete,
    onOpen,
    onRequestClose,
    onSave,
    projects,
    saveTitle
}) => {
    const intl = useIntl();
    return (
        <Modal
            className={styles.modalContent}
            contentLabel={intl.formatMessage(messages.title)}
            id="browserProjectsModal"
            onRequestClose={onRequestClose}
        >
            <div className={styles.body}>
                <div className={styles.saveRow}>
                    <input
                        aria-label={intl.formatMessage(messages.titleLabel)}
                        className={styles.titleInput}
                        disabled={busy}
                        value={saveTitle}
                        onChange={onChangeSaveTitle}
                    />
                    <button
                        className={styles.button}
                        disabled={busy || !saveTitle.trim()}
                        onClick={onSave}
                    >
                        <FormattedMessage
                            defaultMessage="Save current project"
                            description="Button that saves the current project in the browser"
                            id="gui.browserProjectsModal.save"
                        />
                    </button>
                </div>
                {error ? <p className={styles.message}>{error}</p> : null}
                {projects && projects.length === 0 ? (
                    <p className={styles.message}>
                        <FormattedMessage
                            defaultMessage="No projects are saved in this browser yet."
                            description="Shown in the browser projects dialog when nothing has been saved"
                            id="gui.browserProjectsModal.empty"
                        />
                    </p>
                ) : null}
                <ul className={styles.list}>
                    {(projects || []).map(project => (
                        <li
                            className={styles.item}
                            key={project.title}
                        >
                            <div className={styles.itemText}>
                                <div className={styles.itemTitle}>{project.title}</div>
                                <div className={styles.itemDetails}>
                                    <FormattedMessage
                                        defaultMessage="Saved {time} · {size} KB"
                                        description="When a browser-saved project was last saved, and its size"
                                        id="gui.browserProjectsModal.details"
                                        values={{
                                            time: (
                                                <FormattedRelativeTime
                                                    numeric="auto"
                                                    updateIntervalInSeconds={60}
                                                    value={Math.round((project.modified - Date.now()) / 1000)}
                                                />
                                            ),
                                            size: Math.max(1, Math.round(project.size / 1024))
                                        }}
                                    />
                                </div>
                            </div>
                            <button
                                className={styles.button}
                                disabled={busy}
                                onClick={() => onOpen(project.title)} // eslint-disable-line react/jsx-no-bind
                            >
                                <FormattedMessage
                                    defaultMessage="Open"
                                    description="Button that opens a project saved in the browser"
                                    id="gui.browserProjectsModal.open"
                                />
                            </button>
                            <button
                                className={styles.deleteButton}
                                disabled={busy}
                                onClick={() => onDelete(project.title)} // eslint-disable-line react/jsx-no-bind
                            >
                                <FormattedMessage
                                    defaultMessage="Delete"
                                    description="Button that deletes a project saved in the browser"
                                    id="gui.browserProjectsModal.delete"
                                />
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </Modal>
    );
};

BrowserProjectsModalComponent.propTypes = {
    busy: PropTypes.bool.isRequired,
    error: PropTypes.string,
    onChangeSaveTitle: PropTypes.func.isRequired,
    onDelete: PropTypes.func.isRequired,
    onOpen: PropTypes.func.isRequired,
    onRequestClose: PropTypes.func.isRequired,
    onSave: PropTypes.func.isRequired,
    projects: PropTypes.arrayOf(PropTypes.shape({
        title: PropTypes.string.isRequired,
        modified: PropTypes.number.isRequired,
        size: PropTypes.number.isRequired
    })),
    saveTitle: PropTypes.string.isRequired
};

export default BrowserProjectsModalComponent;
