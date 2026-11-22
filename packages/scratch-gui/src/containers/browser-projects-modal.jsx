import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {connect} from 'react-redux';

import BrowserProjectsModalComponent from '../components/browser-projects-modal/browser-projects-modal.jsx';
import log from '../lib/log';
import sharedMessages from '../lib/shared-messages';
import {
    deleteProject,
    hasProject,
    listProjects,
    loadProject,
    saveProject
} from '../lib/arduboy/browser-project-storage';
import {closeBrowserProjectsModal, closeLoadingProject, openLoadingProject} from '../reducers/modals';
import {setProjectUnchanged} from '../reducers/project-changed';
import {setProjectTitle} from '../reducers/project-title';

const messages = defineMessages({
    confirmOverwrite: {
        id: 'gui.browserProjectsModal.confirmOverwrite',
        defaultMessage: 'A project named “{title}” is already saved. Replace it?',
        description: 'Confirmation before saving over a project with the same name in the browser'
    },
    confirmDelete: {
        id: 'gui.browserProjectsModal.confirmDelete',
        defaultMessage: 'Delete “{title}” from this browser? This can’t be undone.',
        description: 'Confirmation before deleting a project saved in the browser'
    },
    storageError: {
        id: 'gui.browserProjectsModal.storageError',
        defaultMessage: 'Browser storage is unavailable: {message}',
        description: 'Error shown when projects cannot be read from or written to browser storage'
    },
    loadError: {
        id: 'gui.browserProjectsModal.loadError',
        defaultMessage: 'The project could not be opened.',
        description: 'Error shown when a project saved in the browser fails to load'
    }
});

const BrowserProjectsModal = ({
    onLoadingFinished,
    onLoadingStarted,
    onProjectSaved,
    onRequestClose,
    projectChanged,
    projectTitle,
    visible,
    vm
}) => {
    const intl = useIntl();
    const [projects, setProjects] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [saveTitle, setSaveTitle] = useState('');

    const storageTask = useCallback(async task => {
        setBusy(true);
        setError(null);
        try {
            await task();
            setProjects(await listProjects());
        } catch (e) {
            log.error('Browser project storage failed', e);
            setError(intl.formatMessage(messages.storageError, {message: e.message}));
        } finally {
            setBusy(false);
        }
    }, [intl]);

    // Refresh when the dialog opens; the title is only a starting suggestion, so later changes don't reset it.
    useEffect(() => {
        if (!visible) return;
        setSaveTitle(projectTitle || '');
        storageTask(() => Promise.resolve());
    }, [visible]);

    const handleSave = useCallback(() => storageTask(async () => {
        const title = saveTitle.trim();
        if (await hasProject(title) &&
            !confirm(intl.formatMessage(messages.confirmOverwrite, {title}))) { // eslint-disable-line no-alert
            return;
        }
        const sb3 = await vm.saveProjectSb3();
        await saveProject(title, await sb3.arrayBuffer());
        onProjectSaved(title);
    }), [intl, onProjectSaved, saveTitle, storageTask, vm]);

    const handleOpen = useCallback(async title => {
        const replaceWarning = intl.formatMessage(sharedMessages.replaceProjectWarning);
        if (projectChanged && !confirm(replaceWarning)) return; // eslint-disable-line no-alert
        setBusy(true);
        onLoadingStarted();
        let success = false;
        try {
            await vm.loadProject(await loadProject(title));
            success = true;
        } catch (e) {
            log.warn('Could not open project from browser storage', e);
            setError(intl.formatMessage(messages.loadError));
        }
        onLoadingFinished(success ? title : null);
        setBusy(false);
        if (success) onRequestClose();
    }, [intl, onLoadingFinished, onLoadingStarted, onRequestClose, projectChanged, vm]);

    const handleDelete = useCallback(title => {
        if (!confirm(intl.formatMessage(messages.confirmDelete, {title}))) return; // eslint-disable-line no-alert
        storageTask(() => deleteProject(title));
    }, [intl, storageTask]);

    const handleChangeSaveTitle = useCallback(e => setSaveTitle(e.target.value), []);

    if (!visible) return null;
    return (
        <BrowserProjectsModalComponent
            busy={busy}
            error={error}
            projects={projects}
            saveTitle={saveTitle}
            onChangeSaveTitle={handleChangeSaveTitle}
            onDelete={handleDelete}
            onOpen={handleOpen}
            onRequestClose={onRequestClose}
            onSave={handleSave}
        />
    );
};

BrowserProjectsModal.propTypes = {
    onLoadingFinished: PropTypes.func.isRequired,
    onLoadingStarted: PropTypes.func.isRequired,
    onProjectSaved: PropTypes.func.isRequired,
    onRequestClose: PropTypes.func.isRequired,
    projectChanged: PropTypes.bool.isRequired,
    projectTitle: PropTypes.string,
    visible: PropTypes.bool.isRequired,
    vm: PropTypes.shape({
        loadProject: PropTypes.func.isRequired,
        saveProjectSb3: PropTypes.func.isRequired
    }).isRequired
};

const mapStateToProps = state => ({
    projectChanged: state.scratchGui.projectChanged,
    projectTitle: state.scratchGui.projectTitle,
    visible: state.scratchGui.modals.browserProjectsModal,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onLoadingStarted: () => dispatch(openLoadingProject()),
    onLoadingFinished: title => {
        if (title !== null) {
            dispatch(setProjectTitle(title));
            dispatch(setProjectUnchanged());
        }
        dispatch(closeLoadingProject());
    },
    onProjectSaved: title => {
        dispatch(setProjectTitle(title));
        dispatch(setProjectUnchanged());
    },
    onRequestClose: () => dispatch(closeBrowserProjectsModal())
});

export default connect(mapStateToProps, mapDispatchToProps)(BrowserProjectsModal);
