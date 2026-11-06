import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../apps/dingxiaosui/app/account/studio/studio-client.tsx', import.meta.url), 'utf8');
const lines = source.split(/\r?\n/u);
const callback = name => {
  const line = lines.find(value => value.trim().startsWith(`const ${name}=useCallback(`));
  assert.ok(line, `Missing ${name} callback`);
  return line.slice(line.indexOf('useCallback(') + 'useCallback('.length, line.lastIndexOf(',['));
};
const between = (start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source block: ${start}`);
  return source.slice(first, last);
};
const prepareSource = readFileSync(new URL('../apps/dingxiaosui/lib/reference-image.ts', import.meta.url), 'utf8').replace(/^export\s+/gmu, '');
const chooseSource = between('async function chooseReference(', 'function switchCapability(');
const checkSource = lines.find(line => line.trim().startsWith('const check=')).trim();
const inputLine = lines.find(line => line.includes('id="studio-reference-file"'));
const changeSource = inputLine.match(/onChange=\{(e=>\{.*?void chooseReference\(file\)\})\}/u)?.[1];
assert.ok(changeSource, 'File input must retain its change handler');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const stripBody = body => {
  const wrapped = stripTypeScriptTypes(`function isolatedScope(){${body}}`);
  return wrapped.slice(wrapped.indexOf('{') + 1, wrapped.lastIndexOf('}'));
};

// Run the real callbacks without a browser, server, credentials, or paid requests.
function selectionHarness(identityRequest, prepareReference) {
  const state = { identityReady: true, data: { owner: 'original' }, referenceImage: null, referenceBusy: false, reloads: 0 };
  const fields = ['IdentityReady', 'Data', 'CreditSummary', 'Prompt', 'Product', 'Brand', 'SellingPoints', 'ReferenceImage', 'ReferenceBusy', 'ReferenceError', 'ImageMode', 'EditInstructions', 'Consent', 'PendingReview', 'Loaded', 'Notice'];
  const setters = Object.fromEntries(fields.map(name => [`set${name}`, value => { state[name[0].toLowerCase() + name.slice(1)] = value; }]));
  const runtime = stripBody(`
    const {${Object.keys(setters).join(',')}} = setters;
    const identityRef={current:'original'}, epochRef={current:0}, referenceEpoch={current:0}, lockedRef={current:false}, pendingRequest={current:null};
    const window={location:{reload(){state.reloads++}}}, document={visibilityState:'visible'};
    let busy=false;
    class StudioApiError extends Error { constructor(message,status){super(message);this.status=status;} }
    const identityChanged=${callback('identityChanged')};
    const verifyIdentity=${callback('verifyIdentity')};
    ${checkSource}
    ${chooseSource}
    const onFileChange=${changeSource};
    return {check,onFileChange,chooseReference,identityChanged,lockedRef,referenceEpoch,
      authError:status=>new StudioApiError('authentication failed',status)};
  `);
  const operations = new Function('api', 'prepareReference', 'state', 'setters', runtime)(identityRequest, prepareReference, state, setters);
  return { ...operations, state };
}

test('focus verification hides the existing editor instead of unmounting its file input', () => {
  assert.doesNotMatch(source, /data\s*&&\s*!identityReady\s*\?/u);
  assert.match(source, /data&&!identityReady&&<section className="studio-login">/u);
  assert.match(source, /:<div hidden=\{!identityReady\}>\s*<div className="studio-layout">/u);
  assert.match(source, /<fieldset disabled=\{busy\|\|!identityReady\}>/u);
  assert.match(source, /if\(busy\|\|lockedRef\.current\|\|!identityReady\|\|!consent/u);
});

test('identity verification unmounts history media while retaining the editor file input', () => {
  const historyStart = '{identityReady&&<aside className="studio-results">';
  const history = between(historyStart, '</aside>}');
  assert.match(source, /<\/section>\{identityReady&&<aside className="studio-results">/u);
  assert.match(history, /<video src=\{url\} controls/u);
  assert.doesNotMatch(history, /studio-reference-file/u);
  assert.ok(source.indexOf('id="studio-reference-file"') < source.indexOf(historyStart));
});

test('file change arriving after focus is retained while identity verification is pending', async () => {
  const identity = deferred(), photo = { dataUrl: 'fixture', hash: 'photo-hash' };
  const harness = selectionHarness(() => identity.promise, async () => photo);
  harness.check();
  assert.equal(harness.state.identityReady, false);
  assert.equal(harness.lockedRef.current, true);
  const target = { files: [{}], value: 'selected-file' };
  harness.onFileChange({ target });
  await tick();
  assert.equal(target.value, '');
  assert.equal(harness.state.referenceImage, photo);
  assert.equal(harness.state.identityReady, false);
  identity.resolve({ user: { id: 'original' } });
  await tick();
  assert.equal(harness.state.identityReady, true);
  assert.equal(harness.state.referenceImage, photo);
  assert.equal(harness.state.reloads, 0);
});

test('verification failure keeps selection hidden and generation locked until reverified', async () => {
  const first = deferred(), photo = { dataUrl: 'fixture', hash: 'photo-hash' };
  let request = () => first.promise;
  const harness = selectionHarness(() => request(), async () => photo);
  harness.check();
  await harness.chooseReference({});
  first.reject(new Error('network unavailable'));
  await tick();
  assert.equal(harness.state.identityReady, false);
  assert.equal(harness.lockedRef.current, true);
  assert.equal(harness.state.referenceImage, photo);
  request = async () => ({ user: { id: 'original' } });
  harness.check();
  await tick();
  assert.equal(harness.state.identityReady, true);
  assert.equal(harness.lockedRef.current, false);
  assert.equal(harness.state.referenceImage, photo);
});

for (const scenario of ['different account', 'expired authentication']) {
  test(`${scenario} clears selection and ignores image processing that finishes later`, async () => {
    const identity = deferred(), photo = deferred();
    const harness = selectionHarness(() => identity.promise, () => photo.promise);
    harness.check();
    const choosing = harness.chooseReference({});
    if (scenario === 'different account') identity.resolve({ user: { id: 'another-account' } });
    else identity.reject(harness.authError(401));
    await tick();
    photo.resolve({ dataUrl: 'old-private-image', hash: 'old' });
    await choosing;
    assert.equal(harness.state.referenceImage, null);
    assert.equal(harness.state.data, null);
    assert.equal(harness.state.identityReady, false);
    assert.equal(harness.lockedRef.current, true);
    assert.equal(harness.state.reloads, 1);
  });
}

function imageHarness(width = 2, height = 2) {
  const calls = { mime: null, revoked: 0, decoded: 0, drawSize: null };
  const output = Buffer.from('normalized-image');
  class Image {
    naturalWidth = width;
    naturalHeight = height;
    set src(_) { calls.decoded++; queueMicrotask(() => this.onload()); }
  }
  class FileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      });
    }
  }
  const document = { createElement: () => ({ getContext: () => ({ drawImage(_image, _x, _y, outputWidth, outputHeight) { calls.drawSize = [outputWidth, outputHeight]; } }), toBlob(done, mime) { done(new Blob([output], { type: mime })); } }) };
  const URL = { createObjectURL(blob) { calls.mime = blob.type; return 'blob:fixture'; }, revokeObjectURL() { calls.revoked++; } };
  const runtime = stripBody(`${prepareSource};return prepareReference;`);
  const prepare = new Function('window', 'document', 'URL', 'FileReader', 'crypto', runtime)({ Image }, document, URL, FileReader, webcrypto);
  return { prepare, calls };
}

for (const [mime, bytes] of [
  ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 72, 68, 82])],
  ['image/jpeg', Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])],
  ['image/webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ')],
]) {
  test(`empty file MIME uses ${mime} signature, then decodes and re-encodes`, async () => {
    const { prepare, calls } = imageHarness();
    const result = await prepare(new File([bytes], 'unnamed-photo', { type: '' }));
    assert.equal(calls.mime, mime);
    assert.equal(calls.decoded, 1);
    assert.equal(calls.revoked, 1);
    assert.match(result.dataUrl, new RegExp(`^data:${mime};base64,`, 'u'));
    assert.equal(result.hash.length, 64);
  });
}

test('a JPEG name or declared MIME does not make unsupported bytes an accepted image', async () => {
  const { prepare, calls } = imageHarness();
  await assert.rejects(prepare(new File(['not an image'], 'photo.jpg', { type: 'image/jpeg' })), /JPG.*PNG.*WebP/u);
  assert.equal(calls.decoded, 0);
});

test('the existing 6 MiB client limit remains in force', async () => {
  const { prepare, calls } = imageHarness();
  await assert.rejects(prepare({ size: 6 * 1024 * 1024 + 1 }), /6 MB/u);
  assert.equal(calls.decoded, 0);
});

for (const [width, height, expected] of [[6000, 3000, [4096, 2048]], [3000, 6000, [2048, 4096]], [640, 480, [640, 480]]]) {
  test(`reference helper requests proportional ${width}x${height} to ${expected.join('x')} canvas draw`, async () => {
    const { prepare, calls } = imageHarness(width, height);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 72, 68, 82]);
    const result = await prepare(new File([pngSignature], 'synthetic.png'));
    assert.deepEqual(calls.drawSize, expected);
    assert.deepEqual([result.width, result.height], expected);
    assert.equal(calls.revoked, 1);
  });
}
