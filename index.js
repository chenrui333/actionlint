"use strict";
(async function () {
    function getElementById(id) {
        const e = document.getElementById(id);
        if (e === null) {
            throw new Error(`#${id} element does not exist`);
        }
        return e;
    }
    const body = getElementById('lint-result-body');
    const errorMessage = getElementById('error-msg');
    const successMessage = getElementById('success-msg');
    const nowLoading = getElementById('loading');
    const checkUrlButton = getElementById('check-url-btn');
    const checkUrlInput = getElementById('check-url-input');
    const permalinkButton = getElementById('permalink-btn');
    const invalidInputMessage = getElementById('invalid-input');
    const preferDark = window.matchMedia('(prefers-color-scheme: dark)');
    function colorTheme(isDark) {
        return isDark ? 'material-darker' : 'default';
    }
    async function getRemoteSource(url) {
        function getUrlToFetch(u) {
            const url = new URL(u);
            if (url.host === 'github.com') {
                const s = url.pathname.split('/blob/');
                if (s.length === 2) {
                    url.pathname = s.join('/');
                    url.host = 'raw.githubusercontent.com';
                    return url.toString();
                }
            }
            if (url.host === 'gist.github.com' && /\/[0-9a-f]+$/.test(url.pathname)) {
                url.host = 'gist.githubusercontent.com';
                url.pathname += '/raw';
                return url.toString();
            }
            return u;
        }
        const res = await fetch(getUrlToFetch(url));
        if (!res.ok) {
            throw new Error(`Fetching ${url} failed with status ${res.status}: ${res.statusText}`);
        }
        const src = await res.text();
        return src.trim();
    }
    async function getDefaultSource() {
        const params = new URLSearchParams(window.location.search);
        const s = params.get('s');
        if (s !== null) {
            return s;
        }
        const u = params.get('u');
        if (u !== null) {
            return getRemoteSource(u);
        }
        if (window.location.hash !== '') {
            const b64 = window.location.hash.slice(1);
            const compressed = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const decompressed = pako.inflate(compressed);
            return new TextDecoder().decode(decompressed);
        }
        const src = `# Paste your workflow YAML to this code editor

on:
  push:
    branch: main
    tags:
      - 'v\\d+'
jobs:
  test:
    strategy:
      matrix:
        os: [macos-latest, linux-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - run: echo "Checking commit '\${{ github.event.head_commit.message }}'"
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node_version: 18.x
      - uses: actions/cache@v4
        with:
          path: ~/.npm
          key: \${{ matrix.platform }}-node-\${{ hashFiles('**/package-lock.json') }}
        if: \${{ github.repository.permissions.admin == true }}
      - run: npm install && npm test`;
        return src;
    }
    const editorConfig = {
        mode: 'yaml',
        theme: colorTheme(preferDark.matches),
        lineNumbers: true,
        lineWrapping: true,
        autofocus: true,
        styleActiveLine: true,
        gutters: ['CodeMirror-linenumbers', 'error-marker'],
        extraKeys: {
            Tab(cm) {
                cm.execCommand(cm.somethingSelected() ? 'indentMore' : 'insertSoftTab');
            },
        },
        value: await getDefaultSource(),
    };
    const editor = CodeMirror(getElementById('editor'), editorConfig);
    const debounceInterval = isMobile.phone ? 1000 : 300;
    let debounceId = null;
    let contentChanged = false;
    editor.on('change', function (_, e) {
        contentChanged = true;
        if (typeof window.runActionlint !== 'function') {
            showError('Preparing Wasm file is not completed yet. Please wait for a while and try again.');
            return;
        }
        if (debounceId !== null) {
            window.clearTimeout(debounceId);
        }
        function startActionlint() {
            debounceId = null;
            errorMessage.style.display = 'none';
            successMessage.style.display = 'none';
            invalidInputMessage.style.display = 'none';
            editor.clearGutter('error-marker');
            window.runActionlint(editor.getValue());
        }
        if (e.origin === 'paste') {
            startActionlint();
            return;
        }
        debounceId = window.setTimeout(() => startActionlint(), debounceInterval);
    });
    function getSource() {
        return editor.getValue();
    }
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }
    function showInvalidInputMessage(message) {
        invalidInputMessage.textContent = message;
        invalidInputMessage.style.display = 'block';
        checkUrlInput.classList.add('is-danger');
    }
    function clearInvalidInputMessage() {
        checkUrlInput.classList.remove('is-danger');
        invalidInputMessage.style.display = 'none';
    }
    function dismissLoading() {
        nowLoading.style.display = 'none';
    }
    const reUrl = /https?:\/\/\S+/;
    function linkifyMessage(text) {
        function span(text) {
            const e = document.createElement('span');
            e.textContent = text;
            return e;
        }
        const ret = [];
        let rest = text;
        while (true) {
            const m = rest.match(reUrl);
            if (m === null || m.index === undefined || m[0] === undefined) {
                if (rest.length > 0) {
                    ret.push(span(rest));
                }
                return ret;
            }
            const idx = m.index;
            const url = m[0];
            const s = rest.slice(0, idx);
            if (s.length > 0) {
                ret.push(span(s));
            }
            const a = document.createElement('a');
            a.href = url;
            a.rel = 'noopener';
            a.textContent = url;
            a.className = 'has-text-link-my-light is-underlined';
            a.addEventListener('click', e => e.stopPropagation());
            ret.push(a);
            rest = rest.slice(idx + url.length);
        }
    }
    function onCheckCompleted(errors) {
        body.textContent = '';
        if (errors.length === 0) {
            successMessage.style.display = 'block';
            return;
        }
        for (const error of errors) {
            const row = document.createElement('tr');
            row.addEventListener('click', () => {
                editor.setCursor({ line: error.line - 1, ch: error.column - 1 });
                editor.focus();
            });
            const pos = document.createElement('td');
            const tag = document.createElement('span');
            tag.className = 'tag is-dark is-medium';
            tag.textContent = `line:${error.line}, col:${error.column}`;
            pos.appendChild(tag);
            row.appendChild(pos);
            const desc = document.createElement('td');
            for (const elem of linkifyMessage(error.message)) {
                desc.appendChild(elem);
            }
            const kind = document.createElement('span');
            kind.className = 'tag is-dark';
            kind.textContent = error.kind;
            kind.style.marginLeft = '4px';
            desc.appendChild(kind);
            row.appendChild(desc);
            body.appendChild(row);
            const marker = document.createElement('div');
            marker.style.color = '#ff5370';
            marker.textContent = '●';
            editor.setGutterMarker(error.line - 1, 'error-marker', marker);
        }
    }
    window.getYamlSource = getSource;
    window.showError = showError;
    window.onCheckCompleted = onCheckCompleted;
    window.dismissLoading = dismissLoading;
    window.addEventListener('beforeunload', e => {
        if (contentChanged) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
    checkUrlInput.addEventListener('keyup', e => {
        if (e.key === 'Enter' || e.keyCode === 13) {
            e.preventDefault();
            checkUrlButton.click();
        }
        if (checkUrlInput.value === '') {
            clearInvalidInputMessage();
        }
    });
    checkUrlButton.addEventListener('click', async (e) => {
        e.preventDefault();
        const input = checkUrlInput.value;
        let src;
        try {
            src = await getRemoteSource(input);
        }
        catch (err) {
            if (!(err instanceof Error)) {
                throw err;
            }
            showInvalidInputMessage(`Incorrect input "${input}": ${err.message}`);
            return;
        }
        clearInvalidInputMessage();
        editor.setValue(src);
    });
    permalinkButton.addEventListener('click', e => {
        e.preventDefault();
        const src = getSource();
        const bin = new TextEncoder().encode(src);
        const compressed = pako.deflate(bin);
        const b64 = btoa(String.fromCharCode(...compressed));
        window.location.hash = b64;
    });
    preferDark.addListener(event => {
        editor.setOption('theme', colorTheme(event.matches));
    });
    const go = new Go();
    let result;
    if (typeof WebAssembly.instantiateStreaming === 'function') {
        result = await WebAssembly.instantiateStreaming(fetch('main.wasm'), go.importObject);
    }
    else {
        const response = await fetch('main.wasm');
        const mod = await response.arrayBuffer();
        result = await WebAssembly.instantiate(mod, go.importObject);
    }
    await go.run(result.instance);
})().catch(err => {
    console.error('ERROR!:', err);
    alert(`${err.name}: ${err.message}\n\n${err.stack}`);
});
//# sourceMappingURL=index.js.map