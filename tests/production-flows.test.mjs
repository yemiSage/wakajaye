import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { agreementForDate } from '../lib/agreement.mjs';
import { adminData, tenantDetails } from '../lib/admin.mjs';

test('agreement dates follow Lagos and downloaded content has continuing language', () => {
  const document = agreementForDate(new Date('2026-11-05T23:30:00Z'));
  assert.equal(document.date, '2026-11-06');
  assert.match(document.text, /this 6 day of November, 2026/);
  assert.doesNotMatch(document.text, /{{|By signing|signing below|who sign it/);
  assert.match(document.text, /By continuing, the Landlord and Occupants/);
  assert.match(document.text, /Account Number: 2264437570/);
});

const rows = Array.from({length: 25}, (_,index) => ({
  email: 'tenant'+index+'@example.com',
  profile: JSON.stringify({ first: 'Tenant', last: String(index), phone:'08000000000', gender:'Female',dob:'2000-01-01',agreement:{version:3} }),
  guarantor: JSON.stringify({name:'Guarantor'}),
  rent: index < 2 ? JSON.stringify({amount:254000}) : null,
  receipt_id: index < 2 ? String(index+1) : null,
  receipt_name: index < 2 ? 'proof.pdf' : null,
  mime: index < 2 ? 'application/pdf' : null,
  status: index === 0 ? 'verified' : index === 1 ? 'pending' : null,
}));
const db = { query: async () => ({rows}) };

test('admin summary counts only verified payments and paginates tenant records', async () => {
  const result = await adminData(db,new URLSearchParams());
  assert.equal(result.summary.tenants,25);
  assert.equal(result.summary.active,1);
  assert.equal(result.summary.pending,1);
  assert.equal(result.summary.received,254000);
  assert.equal(result.tenants.length,20);
  const second = await adminData(db,new URLSearchParams('page=2'));
  assert.equal(second.tenants.length,5);
  const pending = await adminData(db,new URLSearchParams('status=pending'));
  assert.equal(pending.tenants.length,1);
  const searched = await adminData(db,new URLSearchParams('search=tenant24@example.com'));
  assert.equal(searched.total,1);
  const detail = await tenantDetails({query:async()=>({rows:[rows[0]]})},rows[0].email);
  assert.equal(detail.guarantor.name,'Guarantor');
  assert.equal(detail.receipt.status,'verified');
});

test('admin endpoints refuse anonymous and non-admin sessions before querying tenant data',async()=>{
  const source=readFileSync('app/api/[action]/route.js','utf8');
  const start=source.indexOf('async function read(');
  const end=source.indexOf('async function mutate(',start);
  const context=vm.createContext({
    json: value=>value,
    RequestError: class extends Error { constructor(message,status){super(message);this.status=status;} },
  });
  vm.runInContext(source.slice(start,end),context);
  for (const action of ['admin','tenant','queue','file']) {
    for (const email of [undefined,'other@example.com']) {
      await assert.rejects(context.read({query(){throw Error('Unauthorized query');}}, {},action,email,'owner@example.com'),error=>error.status===403);
    }
  }
});

test('agreement checkbox stays locked until the end and requires explicit confirmation', () => {
  const consent = { disabled: true, checked: false };
  const button = { disabled: false };
  const events = {};
  const terms = { clientHeight:400, scrollHeight:6000, scrollTop:0,
    addEventListener:(name,fn)=>{events[name]=fn;} };
  const form = { elements:{consent},dataset:{},
    querySelector(selector) {
      if (selector === 'button:not([type])') return button;
      if (selector === '.terms') return terms;
      if (selector === '#agreement-progress') return {};
      return consent.disabled || !consent.checked ? consent : null;
    },
    addEventListener:(name,fn)=>{events['form-'+name]=fn;},
  };
  const app = {dataset:{portal:'tenant'},innerHTML:'',querySelectorAll:()=>[],addEventListener(){},
    querySelector:selector=>selector==='form[data-form]'?form:null};
  const context=vm.createContext({
    document:{querySelector:selector=>selector==='#app'?app:{},addEventListener(){}},
    __WAKAJAYE_ICONS__:{},Intl,Date,setTimeout,clearTimeout,
    text:agreementForDate(new Date('2026-11-05T12:00:00Z')).text,
  });
  const source=readFileSync('src/portal.js','utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source.slice(0,source.indexOf('email = app.querySelector')),context);
  vm.runInContext("agreementText=text; page='consent'; render();",context);
  assert(consent.disabled);
  terms.scrollTop=5590;
  events.scroll();
  assert(consent.disabled);
  terms.scrollTop=5600;
  events.scroll();
  assert.equal(consent.disabled,false);
  assert(button.disabled);
  consent.checked=true;
  events['form-change']();
  assert.equal(button.disabled,false);
  assert.match(app.innerHTML,/Download agreement \(PDF\)/);
  assert.match(app.innerHTML,/<strong>Bank: Zenith Bank/);
});

test('admin URL has its own navigation and does not require tenant onboarding', () => {
  const source=readFileSync('src/portal.js','utf8').replace(/^import .*;\n/gm,'');
  for (const portal of ['tenant','admin']) {
    const app={dataset:{portal},innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};
    const context=vm.createContext({
      document:{querySelector:selector=>selector==='#app'?app:{},addEventListener(){}},
      __WAKAJAYE_ICONS__:{},Intl,Date,setTimeout,clearTimeout,
    });
    vm.runInContext(source.slice(0,source.indexOf('email = app.querySelector')),context);
    vm.runInContext("user={email:'owner@example.com',admin:true};",context);
    assert.equal(vm.runInContext('tenantPage()',context),portal==='admin'?'admin':'profile');
    const navigation=vm.runInContext("shell('Dashboard','')",context);
    assert.equal(navigation.includes('data-go="admin"'),portal==='admin');
    assert.equal(navigation.includes('data-go="home"'),portal==='tenant');
    vm.runInContext("user={email:'tenant@example.com',admin:false};",context);
    if (portal==='admin') assert.equal(vm.runInContext('tenantPage()',context),'forbidden');
    vm.runInContext('user=null; page="login"; render();',context);
    assert.equal(app.innerHTML.includes('Admin sign in'),portal==='admin');
  }
});

test('admin OTP requests reject non-admin addresses before sending mail or changing codes',async()=>{
  const source=readFileSync('app/api/[action]/route.js','utf8');
  const start=source.indexOf('async function mutate(');
  const end=source.indexOf('async function handle(',start);
  const context=vm.createContext({
    RequestError:class extends Error {constructor(message,status){super(message);this.status=status;}},
    emailField:data=>data.email, field:(data,key)=>data[key],
  });
  vm.runInContext(source.slice(start,end),context);
  const db={query(){throw Error('Unauthorized query');}};
  for (const action of ['code','verify']) {
    await assert.rejects(context.mutate(db,action,{portal:'admin',email:'other@example.com',mode:'create',code:'123456'},null,'owner@example.com','',false),error=>error.status===403);
  }
});
