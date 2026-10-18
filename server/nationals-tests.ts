export const adversarialTestSource = String.raw`import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const base = process.env.BASE_URL || 'http://127.0.0.1:4100';
const auth = { alpha: 'practice-alpha', beta: 'practice-beta', admin: 'practice-admin' };
async function request(method, path, body, { role = 'alpha', key, match, raw } = {}) {
  const headers = { 'Content-Type': raw === undefined ? 'application/json' : 'text/plain' };
  if (role) headers.Authorization = 'Bearer ' + (auth[role] || role);
  if (key) headers['Idempotency-Key'] = key;
  if (match !== undefined) headers['If-Match'] = String(match);
  const response = await fetch(base + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  let data; if (text) { assert.match(response.headers.get('content-type') || '', /application\/json/); data = JSON.parse(text); }
  if (response.status >= 400) assert.equal(typeof data?.error, 'string', 'Errors must be JSON {error:string}');
  if (response.status === 204) assert.equal(text, '');
  return { status: response.status, data };
}
const allocation = (ref, start = '2027-02-08T10:00:00Z', end = '2027-02-08T12:00:00Z', units = 1, resource = 1) => ({ resource_id: resource, start_at: start, end_at: end, units, external_ref: ref });
const makeDfx = (rows, count = rows.length) => {
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  const csv = 'id;label;capacity;enabled\n' + rows.map(row => [row[0], quote(row[1]), row[2], row[3]].join(';') + '\n').join('');
  return 'DFX1\n' + csv + '#rows=' + count + ';sha256=' + createHash('sha256').update(csv, 'utf8').digest('hex') + '\n';
};
test('Nationals adversarial contract — fresh seed required', async t => {
  let created;
  await t.test('Reject missing and unknown authentication', async () => {
    assert.equal((await request('GET','/api/resources',undefined,{role:null})).status,401);
    assert.equal((await request('GET','/api/resources',undefined,{role:'not-a-token'})).status,401);
    assert.equal((await request('GET','/api/resources',undefined,{role:'__proto__'})).status,401);
    assert.equal((await request('GET','/api/resources',undefined,{role:'constructor'})).status,401);
    assert.equal((await fetch(base+'/api/resources',{headers:{Authorization:'practice-alpha'}})).status,401);
  });
  await t.test('Read all three seeded resources', async () => {
    const result = await request('GET','/api/resources'); assert.equal(result.status,200); assert.equal(result.data.length,3);
    assert.equal(result.data[0].capacity,2); assert.equal(result.data[2].enabled,0);
  });
  await t.test('Scope collections by team', async () => {
    const a = await request('GET','/api/allocations'), b = await request('GET','/api/allocations',undefined,{role:'beta'});
    assert.equal(a.data.length,1); assert.ok(a.data.every(row=>row.team_id===1));
    assert.equal(b.data.length,2); assert.ok(b.data.every(row=>row.team_id===2));
  });
  await t.test('Hide another team’s item', async () => {
    assert.equal((await request('GET','/api/allocations/2')).status,404);
    assert.equal((await request('DELETE','/api/allocations/2',undefined,{match:1})).status,404);
  });
  await t.test('Protect administrative endpoints', async () => {
    assert.equal((await request('GET','/api/audit')).status,403);
    assert.equal((await request('GET','/api/report')).status,403);
    assert.equal((await request('POST','/api/imports',undefined,{raw:'not a file'})).status,403);
  });
  await t.test('Validate malformed input, dates, missing keys and quantities', async () => {
    assert.equal((await request('POST','/api/allocations',undefined,{raw:'{oops',key:'json'})).status,400);
    assert.equal((await request('POST','/api/allocations',allocation('no-key'))).status,400);
    for (const [index, body] of [
      allocation('fraction',undefined,undefined,0.5), allocation('zero',undefined,undefined,0),
      allocation('negative',undefined,undefined,-1), allocation('local','2027-02-08T10:00:00'),
      allocation('bad-date','2027-02-30T10:00:00Z','2027-03-02T11:00:00Z'),
      allocation('reversed','2027-02-08T12:00:00Z','2027-02-08T11:00:00Z'),
      allocation('too-long','2027-02-08T00:00:00Z','2027-02-08T09:00:00Z'),
    ].entries()) assert.equal((await request('POST','/api/allocations',body,{key:'invalid-'+index})).status,400);
  });
  await t.test('Reject missing, disabled and over-capacity resources', async () => {
    assert.equal((await request('POST','/api/allocations',allocation('missing',undefined,undefined,1,9999),{key:'missing'})).status,404);
    assert.equal((await request('POST','/api/allocations',allocation('disabled',undefined,undefined,1,3),{key:'disabled'})).status,409);
    assert.equal((await request('POST','/api/allocations',allocation('over',undefined,undefined,3),{key:'over'})).status,409);
  });
  await t.test('Use peak concurrent demand, not sum of all overlapping rows', async () => {
    const result = await request('POST','/api/allocations',allocation('spans-adjacent'),{key:'span'});
    assert.equal(result.status,201); created=result.data;
    assert.equal(created.team_id,1); assert.equal(created.revision,1);
    assert.equal(created.start_at,'2027-02-08T10:00:00.000Z');
  });
  await t.test('Require a revision for cancellation', async () => {
    assert.ok(created); assert.equal((await request('DELETE','/api/allocations/'+created.id)).status,428);
  });
  await t.test('Reject stale writes without side effects', async () => {
    assert.ok(created); assert.equal((await request('DELETE','/api/allocations/'+created.id,undefined,{match:99})).status,412);
    const current=await request('GET','/api/allocations/'+created.id); assert.equal(current.data.status,'active'); assert.equal(current.data.revision,1);
  });
  await t.test('Cancel once, release capacity and increment the revision', async () => {
    assert.ok(created); assert.equal((await request('DELETE','/api/allocations/'+created.id,undefined,{match:1})).status,204);
    const current=await request('GET','/api/allocations/'+created.id); assert.equal(current.data.status,'cancelled'); assert.equal(current.data.revision,2);
    assert.equal((await request('DELETE','/api/allocations/'+created.id,undefined,{match:2})).status,204);
  });
  await t.test('Report zero rows correctly and exclude cancelled work', async () => {
    const report=await request('GET','/api/report',undefined,{role:'admin'}); assert.equal(report.status,200);
    assert.deepEqual(report.data,[{resource_id:1,active_count:2,total_units:2,unit_minutes:120},{resource_id:2,active_count:1,total_units:1,unit_minutes:60},{resource_id:3,active_count:0,total_units:0,unit_minutes:0}]);
  });
  await t.test('Exactly one of two conflicting concurrent requests succeeds', async () => {
    const results=await Promise.all(['a','b'].map(ref=>request('POST','/api/allocations',allocation('race-'+ref,'2027-02-08T14:00:00Z','2027-02-08T15:00:00Z',2),{key:'race-'+ref})));
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  });
  await t.test('Ten simultaneous retries return one persisted allocation', async () => {
    const body=allocation('retry','2027-02-08T16:00:00Z','2027-02-08T17:00:00Z',2);
    const results=await Promise.all(Array.from({length:10},()=>request('POST','/api/allocations',body,{key:'retry-burst'})));
    assert.ok(results.every(r=>r.status===201)); assert.equal(new Set(results.map(r=>r.data.id)).size,1);
    assert.equal((await request('GET','/api/allocations')).data.filter(row=>row.external_ref==='retry').length,1);
  });
  await t.test('Idempotency compares semantic fields, not JSON key order', async () => {
    const body=allocation('retry','2027-02-08T17:00:00+01:00','2027-02-08T18:00:00+01:00',2);
    const reversed=Object.fromEntries(Object.entries(body).reverse());
    assert.equal((await request('POST','/api/allocations',reversed,{key:'retry-burst'})).status,201);
  });
  await t.test('A key reused with a changed payload conflicts', async () => {
    assert.equal((await request('POST','/api/allocations',allocation('retry','2027-02-08T16:00:00Z','2027-02-08T17:00:00Z',1),{key:'retry-burst'})).status,409);
  });
  await t.test('External references stay unique after cancellation', async () => {
    assert.equal((await request('POST','/api/allocations',allocation('spans-adjacent'),{key:'different-key'})).status,409);
  });
  await t.test('The same retry key and reference can be used by separate teams', async () => {
    assert.equal((await request('POST','/api/allocations',allocation('shared','2027-02-08T18:00:00Z','2027-02-08T19:00:00Z',1,2),{key:'shared'})).status,201);
    assert.equal((await request('POST','/api/allocations',allocation('shared','2027-02-08T19:00:00Z','2027-02-08T20:00:00Z',1,2),{key:'shared',role:'beta'})).status,201);
  });
  await t.test('Explicit DST offsets represent elapsed time correctly', async () => {
    const result=await request('POST','/api/allocations',allocation('dst','2027-03-28T01:00:00+01:00','2027-03-28T03:00:00+02:00',1,2),{key:'dst'});
    assert.equal(result.status,201); assert.equal(Date.parse(result.data.end_at)-Date.parse(result.data.start_at),3600000);
  });
  const rows=[[100,'CNC; "Precision"',3,1],[101,'Salle\nÉtage 2',4,1]];
  await t.test('Reject a damaged legacy checksum', async () => {
    const damaged=makeDfx(rows).replace(/sha256=[a-f0-9]{64}/,'sha256='+'0'.repeat(64));
    assert.equal((await request('POST','/api/imports',undefined,{role:'admin',raw:damaged})).status,400);
  });
  await t.test('Validate the legacy row count', async () => {
    assert.equal((await request('POST','/api/imports',undefined,{role:'admin',raw:makeDfx(rows,99)})).status,400);
  });
  await t.test('Rollback an entire import when its second row conflicts', async () => {
    const result=await request('POST','/api/imports',undefined,{role:'admin',raw:makeDfx([[202,'Temporary',2,1],[1,'Collision',2,1]])});
    assert.equal(result.status,409); assert.ok(!(await request('GET','/api/resources')).data.some(row=>row.id===202));
  });
  await t.test('Dry-run imports leave resources and audit untouched', async () => {
    const before=await request('GET','/api/audit',undefined,{role:'admin'});
    const result=await request('POST','/api/imports?dry_run=1',undefined,{role:'admin',raw:makeDfx(rows)});
    assert.equal(result.status,200); assert.deepEqual(result.data,{created:2,dry_run:true});
    assert.equal((await request('GET','/api/resources')).data.length,3);
    assert.deepEqual((await request('GET','/api/audit',undefined,{role:'admin'})).data,before.data);
  });
  await t.test('Read BOM, CRLF, escaped quotes, delimiters and embedded newlines', async () => {
    const result=await request('POST','/api/imports',undefined,{role:'admin',raw:'\uFEFF'+makeDfx(rows).replaceAll('\n','\r\n')});
    assert.equal(result.status,201); assert.deepEqual(result.data,{created:2,dry_run:false});
    const resources=(await request('GET','/api/resources')).data;
    assert.equal(resources.length,5); assert.equal(resources.find(row=>row.id===100).label,'CNC; "Precision"'); assert.equal(resources.find(row=>row.id===101).label,'Salle\nÉtage 2');
  });
  await t.test('Audit exactly once for successful logical operations', async () => {
    const audit=(await request('GET','/api/audit',undefined,{role:'admin'})).data;
    assert.equal(audit.filter(row=>row.action==='created').length,6);
    assert.equal(audit.filter(row=>row.action==='cancelled').length,1);
    assert.equal(audit.filter(row=>row.action==='imported').length,1);
    assert.equal(new Set(audit.map(row=>row.id)).size,audit.length);
    assert.deepEqual(audit.map(row=>row.id),[...audit.map(row=>row.id)].sort((a,b)=>a-b));
  });
});
`;

export const mutationRunnerSource = String.raw`import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const candidates=JSON.parse(readFileSync(new URL('./mutations.json',import.meta.url),'utf8'));
async function run(candidate) {
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'0',DATABASE_PATH:':memory:',CANDIDATE_MODULE:candidate},stdio:['ignore','pipe','pipe']});
  try {
    const url=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Candidate did not start')),5000);
      child.stdout.on('data',buffer=>{const match=String(buffer).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error('Candidate exited '+code));});
    });
    return await new Promise((resolve,reject)=>{
      const tests=spawn(process.execPath,['--test','submission.test.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,BASE_URL:url},stdio:['ignore','pipe','pipe']});
      let output='';tests.stdout.on('data',chunk=>output+=chunk);tests.stderr.on('data',chunk=>output+=chunk);
      const timer=setTimeout(()=>{tests.kill();reject(new Error('Suite timed out'));},20000);
      tests.on('error',error=>{clearTimeout(timer);reject(error);});
      tests.on('exit',(code,signal)=>{clearTimeout(timer);if(signal)reject(new Error('Suite terminated'));else resolve({code,output});});
    });
  } finally {child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});}
}
const baseline=await run('./engine.mjs');
if(baseline.code!==0){console.error('Correct baseline must pass.\n'+baseline.output);process.exit(1);}
let killed=0;
for(const candidate of candidates){const result=await run('./mutants/'+candidate.id+'.mjs');if(result.code!==0){killed++;console.log('KILLED '+candidate.id);}else console.log('SURVIVED '+candidate.id);}
console.log(killed+'/'+candidates.length+' mutants killed');
if(killed<candidates.length)process.exitCode=1;
`;
