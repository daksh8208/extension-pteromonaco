import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory, useLocation, useParams } from 'react-router';
import { dirname } from 'pathe';

import { encodePathSegments, hashToPath } from '@/helpers';
import { httpErrorToHuman } from '@/api/http';
import getFileContents from '@/api/server/files/getFileContents';
import saveFileContents from '@/api/server/files/saveFileContents';
import FileNameModal from '@/components/server/files/FileNameModal';
import { ServerContext } from '@/state/server';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import useFlash from '@/plugins/useFlash';
import Can from '@/components/elements/Can';
import Select from '@/components/elements/Select';
import Button from '@/components/elements/Button';
import modes from '@/modes';

declare global {
    interface Window {
        monaco: any;
        require: any;
    }
}

// Monaco Editor version pinned for stability
const MONACO_VERSION = '0.52.0';
const MONACO_CDN = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

// Map file extensions to MIME types (matching the panel's modes list)
const detectLanguageFromPath = (filePath: string): string => {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

    const map: Record<string, string> = {
        js: 'text/javascript',
        jsx: 'text/javascript',
        ts: 'application/typescript',
        tsx: 'application/typescript',
        html: 'text/html',
        htm: 'text/html',
        css: 'text/css',
        scss: 'text/x-scss',
        sass: 'text/x-sass',
        xml: 'application/xml',
        json: 'application/json',
        yaml: 'text/x-yaml',
        yml: 'text/x-yaml',
        toml: 'text/x-toml',
        py: 'text/x-python',
        php: 'text/x-php',
        java: 'text/x-java',
        c: 'text/x-csrc',
        cpp: 'text/x-c++src',
        cxx: 'text/x-c++src',
        cc: 'text/x-c++src',
        cs: 'text/x-csharp',
        go: 'text/x-go',
        rs: 'text/x-rustsrc',
        rb: 'text/x-ruby',
        lua: 'text/x-lua',
        sh: 'text/x-sh',
        bash: 'text/x-sh',
        zsh: 'text/x-sh',
        dockerfile: 'text/x-dockerfile',
        env: 'text/x-properties',
        properties: 'text/x-properties',
        conf: 'text/x-nginx-conf',
        nginx: 'text/x-nginx-conf',
        sql: 'text/x-sql',
        md: 'text/x-markdown',
        markdown: 'text/x-markdown',
        txt: 'text/plain',
        diff: 'text/x-diff',
        patch: 'text/x-diff',
        vue: 'script/x-vue',
    };

    return map[ext] ?? 'text/plain';
};

// Map MIME types to Monaco language identifiers
const getMonacoLanguage = (mimeType: string): string => {
    const map: Record<string, string> = {
        'text/plain': 'plaintext',
        'application/json': 'json',
        'text/javascript': 'javascript',
        'application/javascript': 'javascript',
        'application/typescript': 'typescript',
        'text/typescript': 'typescript',
        'text/html': 'html',
        'text/css': 'css',
        'text/xml': 'xml',
        'application/xml': 'xml',
        'text/yaml': 'yaml',
        'application/x-yaml': 'yaml',
        'text/x-yaml': 'yaml',
        'application/yaml': 'yaml',
        'text/x-python': 'python',
        'application/x-python': 'python',
        'text/python': 'python',
        'application/x-php': 'php',
        'text/x-php': 'php',
        'text/php': 'php',
        'text/x-java': 'java',
        'application/java': 'java',
        'text/x-csharp': 'csharp',
        'text/csharp': 'csharp',
        'text/x-sql': 'sql',
        'application/sql': 'sql',
        'text/x-sh': 'shell',
        'application/x-sh': 'shell',
        'text/x-shellscript': 'shell',
        'application/x-shellscript': 'shell',
        'text/x-dockerfile': 'dockerfile',
        'application/x-dockerfile': 'dockerfile',
        'text/markdown': 'markdown',
        'text/x-markdown': 'markdown',
        'text/x-gfm': 'markdown',
        'application/x-httpd-php': 'php',
        'text/x-c': 'c',
        'text/x-csrc': 'c',
        'text/x-c++': 'cpp',
        'text/x-c++src': 'cpp',
        'text/x-cpp': 'cpp',
        'text/x-go': 'go',
        'text/x-ruby': 'ruby',
        'text/x-rustsrc': 'rust',
        'text/x-lua': 'lua',
        'text/x-sass': 'scss',
        'text/x-scss': 'scss',
        'text/x-toml': 'ini',
        'text/x-nginx-conf': 'ini',
        'text/x-properties': 'ini',
        'text/x-diff': 'diff',
        'text/x-mariadb': 'mysql',
        'text/x-mssql': 'sql',
        'text/x-mysql': 'mysql',
        'text/x-pgsql': 'pgsql',
        'text/x-sqlite': 'sql',
        'message/http': 'http',
        'script/x-vue': 'html',
    };
    return map[mimeType] ?? 'plaintext';
};

const Editor = () => {
    const { hash } = useLocation();
    const history = useHistory();
    const { action } = useParams<{ action: 'new' | string }>();

    const [content, setContent] = useState('');
    const [modalVisible, setModalVisible] = useState(false);
    const [loading, setLoading] = useState(action === 'edit');
    const [monacoLoaded, setMonacoLoaded] = useState(false);
    const [lang, setLang] = useState('text/plain');

    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<any>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    const id = ServerContext.useStoreState((state) => state.server.data!.id);
    const uuid = ServerContext.useStoreState((state) => state.server.data!.uuid);
    const setDirectory = ServerContext.useStoreActions((actions) => actions.files.setDirectory);
    const { addError, clearFlashes } = useFlash();

    // Auto-detect language from file path
    useEffect(() => {
        if (action === 'edit' && hash) {
            setLang(detectLanguageFromPath(hashToPath(hash)));
        }
    }, [action, hash]);

    const save = useCallback((name?: string) => {
        if (!editorRef.current) return;

        setLoading(true);
        clearFlashes('files:view');

        const editorContent = editorRef.current.getValue();
        const filePath = name ?? hashToPath(hash);

        saveFileContents(uuid, filePath, editorContent)
            .then(() => {
                setContent(editorContent);
                if (name) {
                    history.push(`/server/${id}/files/edit#/${encodePathSegments(name)}`);
                    setDirectory(dirname(name));
                }
            })
            .catch((error) => {
                console.error('Error saving file:', error);
                addError({ message: httpErrorToHuman(error), key: 'files:view' });
            })
            .finally(() => setLoading(false));
    }, [uuid, hash, id, history, setDirectory, addError, clearFlashes]);

    // Load file contents for existing files
    useEffect(() => {
        if (action === 'new') return;

        setLoading(true);
        const path = hashToPath(hash);
        setDirectory(dirname(path));

        getFileContents(uuid, path)
            .then(setContent)
            .catch((error) => {
                console.error(error);
                addError({ message: httpErrorToHuman(error), key: 'files:view' });
            })
            .finally(() => setLoading(false));
    }, [action, uuid, hash]);

    // Load Monaco Editor from CDN
    useEffect(() => {
        if (window.monaco) {
            setMonacoLoaded(true);
            return;
        }

        const cssLink = document.createElement('link');
        cssLink.rel = 'stylesheet';
        cssLink.href = `${MONACO_CDN}/editor/editor.main.css`;
        document.head.appendChild(cssLink);

        const script = document.createElement('script');
        script.src = `${MONACO_CDN}/loader.js`;
        script.onload = () => {
            window.require.config({ paths: { vs: MONACO_CDN } });
            window.require(['vs/editor/editor.main'], () => {
                setMonacoLoaded(true);
            });
        };
        document.head.appendChild(script);

        return () => {
            editorRef.current?.dispose();
        };
    }, []);

    // Create the editor once Monaco is ready and content is available
    useEffect(() => {
        if (!monacoLoaded || !containerRef.current || editorRef.current) return;
        if (action === 'edit' && loading) return;

        editorRef.current = window.monaco.editor.create(containerRef.current, {
            value: content,
            language: 'plaintext',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: { enabled: true },
            fontSize: 14,
            wordWrap: 'off',
            scrollBeyondLastLine: false,
        });

        // Apply detected language after creation
        if (lang !== 'text/plain') {
            const monacoLang = getMonacoLanguage(lang);
            const model = editorRef.current.getModel();
            if (model) {
                window.monaco.editor.setModelLanguage(model, monacoLang);
            }
        }
    }, [monacoLoaded, loading, action]);

    // Sync language changes to the editor model
    useEffect(() => {
        if (!editorRef.current || !window.monaco) return;

        const model = editorRef.current.getModel();
        if (!model) return;

        const monacoLang = getMonacoLanguage(lang);
        const supported = window.monaco.languages.getLanguages().some((l: any) => l.id === monacoLang);
        window.monaco.editor.setModelLanguage(model, supported ? monacoLang : 'plaintext');
    }, [lang]);

    // Ctrl/Cmd+S shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (action === 'edit') {
                    save();
                } else {
                    setModalVisible(true);
                }
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [action, save]);

    /*
     * Hide the panel's original CodeMirror editor *and* its toolbar (language
     * select + "Save Content" button).
     *
     * Blueprint injects this component alongside the original editor rather
     * than replacing it, so without this the page renders two identical
     * toolbars. CSS alone is fragile here because the toolbar is a sibling of
     * the wrapper around the editor, not of the editor itself — so we resolve
     * the nodes from the DOM and skip anything belonging to this component.
     */
    useEffect(() => {
        const hidden: HTMLElement[] = [];

        const hide = (el: HTMLElement | null | undefined) => {
            if (!el || el.dataset.pteromonacoHidden === 'true') return;
            // Never hide our own UI.
            if (rootRef.current && (el.contains(rootRef.current) || rootRef.current.contains(el))) return;

            el.dataset.pteromonacoHidden = 'true';
            el.dataset.pteromonacoDisplay = el.style.display;
            el.style.display = 'none';
            hidden.push(el);
        };

        let editorHidden = false;
        let toolbarHidden = false;

        const hideOriginalEditor = () => {
            document.querySelectorAll<HTMLElement>('.CodeMirror').forEach((cm) => {
                const editorContainer = cm.parentElement;
                if (!editorContainer) return;

                // Prefer hiding the wrapper (also removes the original spinner
                // overlay), but fall back to the editor container if that
                // wrapper happens to contain our own editor.
                const wrapper = editorContainer.parentElement;
                if (wrapper && !(rootRef.current && wrapper.contains(rootRef.current))) {
                    hide(wrapper);
                } else {
                    hide(editorContainer);
                }
                editorHidden = true;
            });

            // The original toolbar is the closest ancestor of the panel's mode
            // <select> that also holds the save/create button.
            document.querySelectorAll<HTMLElement>('select').forEach((select) => {
                if (rootRef.current?.contains(select)) return;

                let node: HTMLElement | null = select.parentElement;
                while (node && node !== document.body) {
                    if (node.querySelector('button')) {
                        hide(node);
                        toolbarHidden = true;
                        return;
                    }
                    node = node.parentElement;
                }
            });
        };

        hideOriginalEditor();

        // CodeMirror and its toolbar mount asynchronously, so keep watching
        // until both have been dealt with, then stop observing to avoid doing
        // this work on every keystroke inside Monaco.
        let scheduled = 0;
        const observer = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = window.requestAnimationFrame(() => {
                scheduled = 0;
                hideOriginalEditor();
                if (editorHidden && toolbarHidden) observer.disconnect();
            });
        });

        if (!editorHidden || !toolbarHidden) {
            observer.observe(document.body, { childList: true, subtree: true });
        }

        return () => {
            observer.disconnect();
            if (scheduled) window.cancelAnimationFrame(scheduled);
            hidden.forEach((el) => {
                el.style.display = el.dataset.pteromonacoDisplay ?? '';
                delete el.dataset.pteromonacoHidden;
                delete el.dataset.pteromonacoDisplay;
            });
        };
    }, []);

    // Push new content into editor when it changes externally (e.g. initial load)
    useEffect(() => {
        if (editorRef.current && content !== editorRef.current.getValue()) {
            editorRef.current.setValue(content);
        }
    }, [content]);

    return (
        <div ref={rootRef} data-pteromonaco={'root'}>
            <FileNameModal
                visible={modalVisible}
                onDismissed={() => setModalVisible(false)}
                onFileNamed={(name) => {
                    setModalVisible(false);
                    setLang(detectLanguageFromPath(name));
                    save(name);
                }}
            />

            <div style={{ position: 'relative' }}>
                <SpinnerOverlay visible={loading} />
                <div
                    ref={containerRef}
                    id="monaco-container"
                    style={{ borderRadius: 'var(--borderRadius)', overflow: 'hidden' }}
                />
            </div>

            <div
                data-pteromonaco={'toolbar'}
                style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}
            >
                <div style={{ flex: '1 1 0%', maxWidth: '12rem', marginRight: '1rem' }}>
                    <Select value={lang} onChange={(e) => setLang(e.currentTarget.value)}>
                        {modes.map((mode) => (
                            <option key={`${mode.name}_${mode.mime}`} value={mode.mime}>
                                {mode.name}
                            </option>
                        ))}
                    </Select>
                </div>

                {action === 'edit' ? (
                    <Can action={'file.update'}>
                        <Button onClick={() => save()}>Save Content</Button>
                    </Can>
                ) : (
                    <Can action={'file.create'}>
                        <Button onClick={() => setModalVisible(true)}>Create File</Button>
                    </Can>
                )}
            </div>
        </div>
    );
};

export default Editor;
