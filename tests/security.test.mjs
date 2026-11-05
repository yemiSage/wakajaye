import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { randomBytes, randomInt } from 'node:crypto';
import vm from 'node:vm';
import * as security from '../lib/security.mjs';

process.env.AUTH_SECRET = 'test-only-secret-never-used-in-production';
const address = security.ADMIN_EMAIL;
const salt = 'ab'.repeat(16);
const code = '417239';
const record = mode => ({ mode, digest: security.otpDigest(address, mode, salt, code), issued: Date.now()/1000, attempts: 0 });

function routeContext(overrides = {}) {
  const source = readFileSync('app/api/[action]/route.js','utf8');
  const context = vm.createContext({
    ...security, randomBytes, randomInt, Buffer, Response, AbortSignal, console,
    maxFileSize: 3*1024*1024,
    process: { env: {} },
    NextResponse: { json(data, options) {
      const response = Response.json(data, options);
      response.cookies = { set(name, value, settings) {
        response.headers.append('Set-Cookie', name+'='+value+'; HttpOnly; SameSite='+settings.sameSite+'; Max-Age='+settings.maxAge+(settings.secure?'; Secure':''));
      } };
      return response;
    } },
    ...overrides,
  });
  vm.runInContext('let pool;\n'+source.slice(source.indexOf('class RequestError'),source.indexOf('export { handle')),context);
  return context;
}

function request(action, {method='GET',body,origin='https://wakajaye.vercel.app',cookies={},headers={}}={}) {
  const url = new URL('/api/'+action,'https://wakajaye.vercel.app');
  const req = new Request(url, {
    method, headers: {host:url.host,origin,'content-type':'application/json',...headers},
    ...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body ?? {})}:{}),
  });
  req.nextUrl = url;
  req.cookies = {get:name=>cookies[name]?{value:cookies[name]}:undefined};
  return req;
}
async function call(context, action, options) {
  return context.handle(request(action,options), {params:Promise.resolve({action:action.split('?')[0]})});
}

test('admin and tenant tokens and OTPs are not interchangeable', () => {
  const token = randomBytes(32).toString('base64url');
  assert.notEqual(security.sessionDigest(token), security.sessionDigest(token,true));
  assert(security.matchesOtp(record('admin'),address,code,true));
  assert.equal(security.matchesOtp(record('admin'),address,code,false),false);
  assert.equal(security.matchesOtp(record('create'),address,code,true),false);
  assert.equal(security.matchesOtp(record('admin'),'attacker@example.com',code,true),false);
  assert.equal(security.matchesOtp(record('admin'),address,'000000',true),false);
  assert.equal(security.matchesOtp({...record('admin'),digest:salt+':'+code},address,code,true),false);
  assert.equal(security.usesAdminSession('admin','tenant'),true);
  assert.equal(security.usesAdminSession('session','admin'),true);
  assert.equal(security.usesAdminSession('session','tenant'),false);
});

test('request guards reject CSRF, malformed bodies and tenant-cookie admin access before using the database',async()=>{
  const context = routeContext(); // No database configured: reaching it would return 503.
  const cases = [
    ['unknown',{},404],
    ['admin',{},403],
    ['admin',{cookies:{wj:'a'.repeat(43)}},403],
    ['file?id=1',{cookies:{wj:'a'.repeat(43)}},403],
    ['approve',{method:'POST',body:{id:1},cookies:{wj:'a'.repeat(43)}},403],
    ['profile',{method:'POST',body:{}},401],
    ['code',{method:'POST',body:{email:address,mode:'signin'},origin:'https://attacker.example'},403],
    ['code',{method:'POST',body:{},headers:{'sec-fetch-site':'cross-site'}},403],
    ['code',{method:'POST',body:'{'},400],
    ['code',{method:'POST',body:[]},400],
    ['code',{method:'POST',body:{},headers:{'content-length':'4300001'}},413],
    ['code',{method:'POST',body:{email:'attacker@example.com',mode:'signin',portal:'admin'}},403],
    ['verify',{method:'POST',body:{email:'attacker@example.com',code,portal:'admin'}},403],
    ['verify',{method:'POST',body:{email:address,code:'123',portal:'admin'}},400],
  ];
  for (const [action, options, status] of cases) {
    assert.equal((await call(context,action,options)).status,status,action+' '+JSON.stringify(options));
  }
  assert.deepEqual(await (await call(context,'session?portal=admin',{cookies:{wj:'a'.repeat(43)}})).json(),{user:null});
});

test('admin OTP creates a short-lived separate cookie, is single-use and expires',async()=>{
  let stored = record('admin');
  let storedSession;
  const db = {async query(sql,params) {
    if (sql.startsWith('SELECT * FROM codes')) return {rows:stored?[stored]:[]};
    if (sql.startsWith('UPDATE codes')) { stored.attempts++; return {rows:[]}; }
    if (sql.startsWith('DELETE FROM codes')) stored = null;
    if (sql.startsWith('INSERT INTO sessions')) storedSession = params;
    if (sql.startsWith('SELECT t.profile')) return {rows:[{profile:null,guarantor:null,rent:null}]};
    return {rows:[]};
  }};
  const context = routeContext();
  const payload = {email:address,code,portal:'admin'};
  const wrongPortal = await context.mutate(db,'verify',{...payload,portal:'tenant'},null,address,'',true,false);
  assert.equal(wrongPortal.status,400);
  const response = await context.mutate(db,'verify',payload,null,address,'',true,true);
  assert.equal((await response.json()).user.admin,true);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie,/^wj_admin=/);
  assert.match(cookie,/HttpOnly; SameSite=strict; Max-Age=3600; Secure/);
  const raw = cookie.split(';')[0].slice('wj_admin='.length);
  assert.equal(storedSession[0],security.sessionDigest(raw,true));
  assert.notEqual(storedSession[0],security.sessionDigest(raw));
  await assert.rejects(context.mutate(db,'verify',payload,null,address,'',true,true),/fresh code/);
  stored = {...record('admin'),issued:Date.now()/1000-601};
  await assert.rejects(context.mutate(db,'verify',payload,null,address,'',true,true),/fresh code/);
  stored = {...record('admin'),attempts:5};
  await assert.rejects(context.mutate(db,'verify',payload,null,address,'',true,true),/fresh code/);
});

test('OTP request reaches only the allowed admin inbox with an admin-bound digest',async()=>{
  let saved;
  let delivered;
  const context = routeContext({
    process:{env:{BREVO_API_KEY:'test-key',BREVO_FROM_EMAIL:'sender@example.com'}},
    fetch: async (_url,options) => {delivered=JSON.parse(options.body);return {status:201};},
  });
  const db={async query(sql,params){if(sql.startsWith('INSERT INTO codes'))saved=params;return{rows:[]};}};
  const result=await context.mutate(db,'code',{email:address,mode:'create',portal:'admin'},null,address,'',true);
  assert.equal(result.status,200);
  assert.equal(delivered.to[0].email,address);
  assert.equal(saved[3],'admin');
  const deliveredCode=delivered.textContent.match(/code is (\d{6})/)[1];
  assert(security.matchesOtp({digest:saved[1],mode:saved[3]},address,deliveredCode,true));
  assert.equal(saved[1].includes(deliveredCode),false);
});

test('durable OTP counters cap resend and verification attempts by IP and mailbox and reset after 15 minutes',async()=>{
  const counters=new Map();
  const db={async query(sql,params){
    if(sql.startsWith('DELETE'))return{rows:[]};
    const [key,now,cutoff]=params;
    const old=counters.get(key);
    const counter=!old||old.issued<=cutoff?{issued:now,attempts:1}:{...old,attempts:old.attempts+1};
    counters.set(key,counter);
    return{rows:[counter]};
  }};
  for(let n=0;n<5;n++)assert(await security.consumeAuthLimit(db,'code','ip-a',address,1000));
  assert.equal(await security.consumeAuthLimit(db,'code','ip-b',address,1001),false);
  assert(await security.consumeAuthLimit(db,'code','ip-b',address,1901));
  for(let n=0;n<10;n++)assert(await security.consumeAuthLimit(db,'code','ip-c','new'+n+'@example.com',2000));
  assert.equal(await security.consumeAuthLimit(db,'code','ip-c','new11@example.com',2001),false);
  for(let n=0;n<20;n++)assert(await security.consumeAuthLimit(db,'verify','ip-d',address,3000));
  assert.equal(await security.consumeAuthLimit(db,'verify','ip-e',address,3001),false);
  for(let n=0;n<30;n++)assert(await security.consumeAuthLimit(db,'verify','ip-f','new'+n+'@example.com',4000));
  assert.equal(await security.consumeAuthLimit(db,'verify','ip-f','new31@example.com',4001),false);
});

test('receipt delivery prevents content sniffing and sandboxes inline content',async()=>{
  const context=routeContext();
  const response=await context.read({query:async()=>({rows:[{name:'proof.pdf',mime:'application/pdf',bytes:Buffer.from('%PDF-1.7')}]})},request('file?id=1&preview=1'),'file',address,address);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(response.headers.get('content-security-policy'),/^sandbox;/);
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('invalid payment amounts and disguised uploads are rejected before storing receipts',async()=>{
  const context=routeContext({agreementVersion:3});
  let writes=0;
  const db={async query(sql){
    if(sql.startsWith('SELECT t.profile'))return{rows:[{profile:JSON.stringify({agreement:{version:3}}),guarantor:'{}',rent:null}]};
    writes++;return{rows:[]};
  }};
  for(const amount of ['-1','NaN','1e6','1,000','0','1.001','1000000001']) {
    await assert.rejects(context.mutate(db,'activate',{amount},address,address,'',true),/valid payment amount/);
  }
  await assert.rejects(context.mutate(db,'activate',{amount:'254000',name:'proof.pdf',file:Buffer.from('<script>alert(1)</script>').toString('base64')},address,address,'',true),/Choose a PDF/);
  assert.equal(writes,0);
});

test('amounts group thousands and untrusted tenant data cannot escape HTML attributes',()=>{
  const app={dataset:{portal:'tenant'},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};
  const context=vm.createContext({document:{querySelector:selector=>selector==='#app'?app:{},addEventListener(){}},__WAKAJAYE_ICONS__:{},Intl,Date,setTimeout,clearTimeout});
  const source=readFileSync('src/portal.js','utf8');
  vm.runInContext(source.slice(0,source.indexOf('email = app.querySelector')),context);
  for(const [input,expected] of [['1234567.89','1,234,567.89'],['250000','250,000'],['.50','0.50'],['0001250','1,250'],['1,250.','1,250.'],['bad',null],['1.234',null]])assert.equal(context.formatAmount(input),expected);
  const email='evil"><img/src=x/onerror=alert(1)>@example.com';
  const html=context.tenantTable([{name:'<svg/onload=alert(1)>',email,status:'inactive',rent:null}]);
  assert.doesNotMatch(html,/<img|<svg/);
  assert.match(html,/data-go="tenant:evil&quot;&gt;&lt;img/);
  vm.runInContext("user={email:'tenant@example.com'};page='home';",context);
  const shell=context.shell('Home','');
  assert.match(shell,/class="shell tenant-shell"/);
  assert.match(shell,/aria-current="page" data-go="home"/);
  assert.match(shell,/data-go="receipts"/);
});
