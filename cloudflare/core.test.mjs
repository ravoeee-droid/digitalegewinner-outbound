import assert from 'node:assert/strict';
import { test, before, beforeEach, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  if(specifier.startsWith('@/'))return next(new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  try{return next(specifier,context);}catch(error){
    if((specifier.startsWith('./')||specifier.startsWith('../'))&&!/\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);
    throw error;
  }
} });
const { d1Query, d1Batch } = await import('../lib/cloudflare-d1.ts');
const { readD1State, writeD1State, readD1Secret, writeD1Secret, deleteD1Secret, listD1Secrets, listD1SentMail, saveD1SentMail } = await import('../lib/cloudflare-store.ts');
const {readState,writeState,readStateFields}=await import('../lib/db.ts');
const {setSecret,getSecret,secretStatus}=await import('../lib/secrets.ts');
const {getWarmupStatus}=await import('../lib/mail-warmup.ts');
const originalFetch = globalThis.fetch;
const envKeys = ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_D1_DATABASE_ID','CLOUDFLARE_D1_API_TOKEN','APP_ENCRYPTION_KEY'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key,process.env[key]]));
let database;
let calls;
before(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = 'a'.repeat(32);
  process.env.CLOUDFLARE_D1_DATABASE_ID = '11111111-1111-1111-1111-111111111111';
  process.env.CLOUDFLARE_D1_API_TOKEN = 'test-only-token';
  process.env.APP_ENCRYPTION_KEY = 'test-only-vault-encryption-key';
});
beforeEach(() => {
  database?.close();
  database = new DatabaseSync(':memory:');
  const schema = readFileSync(new URL('./migrations/0001_core.sql',import.meta.url),'utf8');
  database.exec(schema);
  database.exec(schema); // Repeatable initialization must preserve data.
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url,options});
    const body = JSON.parse(options.body);
    assert.ok(!Array.isArray(body), 'Cloudflare REST expects a query object or {batch}, not an array');
    const result = (body.batch || [body]).map(({sql,params=[]}) => ({success:true,results:database.prepare(sql).all(...params)}));
    return Response.json({success:true,result});
  };
});
after(() => {
  database?.close();
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('state round-trip preserves JSON and increments version', async () => {
  assert.equal(await readD1State(),null);
  const payload = {mailboxes:[{id:'mb-1',email:'test@example.com'}],campaigns:[],settings:{enabled:false}};
  assert.equal((await writeD1State(payload)).version,1);
  assert.deepEqual((await readD1State()).payload,payload);
  assert.equal((await writeD1State({...payload,campaigns:[{id:'c-1'}]})).version,2);
});
test('workspaces cannot read each other’s state or ciphertext', async () => {
  await writeD1State({private:true},'workspace-a');
  await writeD1Secret('mailbox_credentials_json','ciphertext','workspace-a');
  assert.equal(await readD1State('workspace-b'),null);
  assert.equal(await readD1Secret('mailbox_credentials_json','workspace-b'),'');
});
test('vault upsert and deletion preserve unrelated keys and never list values', async () => {
  const hostileName = "mailbox' OR 1=1 --";
  await writeD1Secret(hostileName,'ciphertext-1');
  await writeD1Secret('other','unrelated');
  await writeD1Secret(hostileName,'ciphertext-2');
  assert.equal(await readD1Secret(hostileName),'ciphertext-2');
  const list = await listD1Secrets();
  assert.equal(list.length,2);
  assert.ok(list.every(row => !('encrypted_value' in row)));
  await deleteD1Secret(hostileName);
  assert.equal(await readD1Secret(hostileName),'');
  assert.equal(await readD1Secret('other'),'unrelated');
});
test('requests use the fixed Cloudflare origin, auth header, bound values, no cache or redirects', async () => {
  await d1Query('SELECT ? as value',["'; DROP TABLE er_state; --"]);
  assert.match(calls[0].url,/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\//);
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-only-token');
  assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(database.prepare("SELECT count(*) n FROM er_state").get().n,0);
});
test('errors do not expose SQL, bound secrets, or upstream error messages', async () => {
  globalThis.fetch = async () => Response.json({success:false,errors:[{message:'PRIVATE_TOKEN'}]},{status:403});
  await assert.rejects(d1Query('SELECT ?',['PRIVATE_VALUE']),error => error.message.includes('403') && !/PRIVATE/.test(error.message));
});
test('HTTP 200 with a failed statement is treated as failure', async () => {
  globalThis.fetch = async () => Response.json({success:true,result:[{success:false,error:'SECRET'}]});
  await assert.rejects(d1Query('SELECT 1'),/fehlgeschlagen/);
});
test('outbox and sent-mail schema accepts real fields and enforces identifiers', () => {
  database.prepare("INSERT INTO er_outbox(id,workspace,recipient,subject,body) VALUES(?,?,?,?,?)").run('id-1','default','test@example.com','Test','Body');
  assert.equal(database.prepare('SELECT status FROM er_outbox').get().status,'queued');
  assert.throws(() => database.prepare("INSERT INTO er_state(workspace,payload) VALUES('bad','invalid json')").run());
});

test('sent-mail history remains scoped to workspace and mailbox', async () => {
  await saveD1SentMail({mailboxId:'mb-a',to:'test@example.com',subject:'Test',body:'Body',messageId:'message-1'});
  await saveD1SentMail({mailboxId:'mb-b',to:'other@example.com',subject:'Other',body:'Other body',messageId:'message-2'});
  const messages = await listD1SentMail('mb-a',20);
  assert.equal(messages.length,1);
  assert.equal(messages[0].subject,'Test');
  assert.equal((await listD1SentMail('mb-a',20,'other-workspace')).length,0);
});

test('existing state API and vault use D1, keep encryption, and exclude unrelated state fields',async()=>{
  await writeState({mailboxes:[{id:'mb-1'}],campaigns:[],privateOtherField:'not-requested'});
  assert.equal((await readState()).version,1);
  assert.deepEqual(await readStateFields(['mailboxes']),{payload:{mailboxes:[{id:'mb-1'}]}});
  await setSecret('mailbox_credentials_json','private-mailbox-password');
  assert.equal(await getSecret('mailbox_credentials_json'),'private-mailbox-password');
  assert.notEqual(database.prepare('SELECT encrypted_value FROM er_secrets').get().encrypted_value,'private-mailbox-password');
  assert.deepEqual((await secretStatus()).map(row=>row.key),['mailbox_credentials_json']);
  assert.ok(calls.every(call=>call.url.startsWith('https://api.cloudflare.com/')));
});

test('incomplete D1 config fails explicitly rather than falling back to Postgres',async()=>{
  const token=process.env.CLOUDFLARE_D1_API_TOKEN;
  delete process.env.CLOUDFLARE_D1_API_TOKEN;
  try{await assert.rejects(readState(),/Cloudflare-D1-Verbindung ist unvollständig/);assert.equal(calls.length,0);}
  finally{process.env.CLOUDFLARE_D1_API_TOKEN=token;}
});

test('multiple queries use the documented batch envelope',async()=>{
  const result=await d1Batch([{sql:'SELECT 1 as value'},{sql:'SELECT 2 as value'}]);
  assert.deepEqual(result,[[{value:1}],[{value:2}]]);
  assert.equal(JSON.parse(calls[0].options.body).batch.length,2);
});

test('mailbox warmup status uses D1 without sending messages or contacting mail servers',async()=>{
  await setSecret('mailbox_credentials_json',JSON.stringify([{id:'mb-1',provider:'smtp',email:'test@example.com',imapHost:'invalid.example',imapUser:'test',imapPass:'test',smtpHost:'invalid.example',smtpPass:'test'}]));
  const first=await getWarmupStatus();
  assert.equal(first.eligibleMailboxes,1);
  assert.equal(first.mailboxes[0].sentToday,0);
  database.prepare("INSERT INTO mail_warmup_events(sender_mailbox_id,recipient_mailbox_id,token,seen_at) VALUES('mb-1','mb-2','test-token',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run();
  const status=await getWarmupStatus();
  assert.equal(status.mailboxes[0].sentToday,1);
  assert.equal(status.mailboxes[0].totalSent,1);
  assert.equal(status.mailboxes[0].totalSeen,1);
  assert.ok(calls.every(call=>call.url.startsWith('https://api.cloudflare.com/')));
});
