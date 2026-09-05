/** Bootstrap only: student HTML and assertion bodies cross postMessage as data. */
export function webFrameDocument(nonce: string): string {
  const encodedNonce = JSON.stringify(nonce).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">
</head><body><script>
(() => {
  'use strict';
  const nonce = ${encodedNonce};
  const owner = parent;
  const post = owner.postMessage.bind(owner);
  const report = (data) => post({ ...data, nonce }, '*');
  let used = false;
  addEventListener('message', (event) => {
    if (event.source !== owner || !event.data || event.data.nonce !== nonce || event.data.type !== 'run' || used) return;
    const payload = event.data;
    if (typeof payload.code !== 'string' || typeof payload.fixture !== 'string' || !(payload.input === null || typeof payload.input === 'string')) return;
    used = true;
    let stdout = '', stderr = '', failed = false;
    const describe = (value) => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
    };
    const capture = (values) => values.map(describe).join(' ') + '\\n';
    const error = (reason) => {
      failed = true;
      stderr = (stderr + String(reason && (reason.stack || reason.message) || reason) + '\\n').slice(0, 64000);
    };
    // document.open clears listeners; install error capture after the reset.
    document.open();
    console.log = console.info = (...values) => { stdout = (stdout + capture(values)).slice(0, 64000); };
    console.warn = console.error = (...values) => { stderr = (stderr + capture(values)).slice(0, 64000); };
    addEventListener('error', (event) => { error(event.error || event.message); event.preventDefault(); });
    addEventListener('unhandledrejection', (event) => { error(event.reason); event.preventDefault(); });
    try {
      // Inline student scripts execute during parsing, just as in the seed verifier.
      // The inherited policy and opaque sandbox origin remain after document.open.
      document.write('<!doctype html><html><head></head><body>' + payload.fixture + '\\n' + payload.code + '</body></html>');
      document.close();
    } catch (reason) { error(reason); }
    // Let DOMContentLoaded/load handlers run before DOM assertions or free-run output.
    setTimeout(async () => {
      let actual = '';
      if (!failed && payload.input !== null) {
        try { actual = String(await new Function(payload.input)()); }
        catch (reason) { error(reason); }
      }
      report({ type: 'result', actual, stdout, stderr, ...(failed ? { failureKind: 'runtime-error' } : {}) });
    }, 0);
  });
  report({ type: 'ready' });
})();
</script></body></html>`
}
