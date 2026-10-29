// Tests the no-code preparation path. Issuance itself is tested in-memory separately.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parsePreparationArgs,preparationManifest,prepareEventCards} from './prepare-event-cards.mjs';

assert.throws(()=>parsePreparationArgs([]),/absolute/);
assert.throws(()=>parsePreparationArgs(['--out','relative']),/absolute/);
assert.throws(()=>parsePreparationArgs(['--out','/tmp/example','--unknown']),/Unknown/);
assert.throws(()=>parsePreparationArgs(['--out','/tmp/example','--out','/tmp/other']),/one new/);
assert.equal(parsePreparationArgs(['--out','/tmp/example']).issueLocalCodes,false);
assert.equal(parsePreparationArgs(['--out','/tmp/example','--issue-local-codes']).issueLocalCodes,true);
const manifest=preparationManifest();assert.equal(manifest.issued,false);assert.equal(manifest.totalImageUnits,250);assert.equal(manifest.totalTextUnits,500);assert.equal(manifest.productionDeployed,false);assert(!JSON.stringify(manifest).includes('ZDXE-'));
const output=path.join(fs.realpathSync(os.tmpdir()),'zdx-event-manifest-test-'+randomUUID());
const result=await prepareEventCards({outputDir:output});assert.equal(result.issuedCount,0);
assert.equal(fs.statSync(output).mode&0o777,0o700);
const files=fs.readdirSync(output);assert.deepEqual(files.sort(),['manifest.json','使用说明.txt'].sort());
for(const name of files)assert.equal(fs.statSync(path.join(output,name)).mode&0o777,0o600);
const original=fs.readFileSync(path.join(output,'manifest.json'),'utf8');
await assert.rejects(()=>prepareEventCards({outputDir:output,issueLocalCodes:true}),/already exists/);
assert.equal(fs.readFileSync(path.join(output,'manifest.json'),'utf8'),original);
await assert.rejects(()=>prepareEventCards({outputDir:path.resolve(import.meta.dirname,'../public','event-cards-'+randomUUID())}),/public/);
console.log('PASS: manifest-only default, explicit local issuance flag, protected output refusal, private modes, no overwrite and no code disclosure. Test manifest retained:',output);
