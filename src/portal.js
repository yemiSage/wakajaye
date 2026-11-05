import { amountInKobo, maxPaymentKobo, paymentLines } from '../lib/payment-charges.mjs';
import { maxProofFiles } from '../lib/payment-proof.mjs';
import { prepareProofFiles } from '../lib/image-compression.mjs';

const app=document.querySelector('#app'), notice=document.querySelector('#notice');
const logo='<img class="logo" src="/wordmark.svg" alt="Wakajaye">';
const icons = __WAKAJAYE_ICONS__;
const isAdminPortal = app.dataset.portal === 'admin';
const icon = name => icons[name] || '';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input = (label, name, type = 'text', attrs = '', required = true) =>
  '<label>'+label+'<input name="'+name+'" type="'+type+'" '+attrs+(required?' required':'')+'></label>';
const btn=(label,action,cls='')=>'<button type="button" class="btn '+cls+'" data-go="'+esc(action)+'">'+label+'</button>';
const submit=(label,attrs='')=>'<button class="btn primary" '+attrs+'>'+label+'</button>';
const form=(name,contents)=>'<form class="stack" data-form="'+name+'">'+contents+'<p class="error" role="alert" hidden></p></form>';
let user=null,email='',mode='create',page='login';
let adminRecords = null;
let adminPage = 1;
let adminSearch = '';
let adminFilter = '';
let paymentProofs = [];
let tenantRefreshInFlight = false;
let agreementText = '';
const agreementVersion = 3;
let agreementDate = '';
const agreementUrl = '/api/agreement';
async function loadAgreement(date, expectedHash) {
  const response = await fetch(date ? agreementUrl+'?date='+encodeURIComponent(date) : agreementUrl);
  if (!response.ok) throw Error('Could not load the agreement. Please try again.');
  const document = await response.json();
  if (expectedHash && document.sha256 !== expectedHash) throw Error('The accepted agreement could not be verified.');
  agreementText = document.text;
  agreementDate = document.date;
}

function agreementParagraphs() {
  return agreementText.trim().split(/\n\s*\n/).map((paragraph, index) => {
    const text = esc(paragraph).replace(/\n/g, '<br>');
    if (index === 0 || /^\d+\. [A-Z]/.test(paragraph)) return '<h2>'+text+'</h2>';
    if (/^Bank:/.test(paragraph) || /^Total Annual Payment:/.test(paragraph)) return '<p class="agreement-payment"><strong>'+text+'</strong></p>';
    if (/^5\.4\./.test(paragraph)) return '<p class="agreement-warning">'+text+'</p>';
    return '<p>'+text+'</p>';
  }).join('');
}

function agreementDownload() {
  return '<a class="agreement-download" href="'+agreementUrl+'?format=pdf&date='+encodeURIComponent(agreementDate)+'" download>'+icon('Download')+'Download agreement (PDF)</a>';
}
const dateParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
const today=[dateParts.year,dateParts.month,dateParts.day].join('-');
const money=v=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(v);
function toast(message){notice.textContent=message;notice.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>notice.hidden=true,5500)}
async function api(path,data){const r=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const b=await r.json();if(!r.ok)throw Error(b.error||'Something went wrong.');return b}
function auth(title,desc,body,step=''){return '<main class="auth"><section class="auth-card" data-screen="'+esc(page)+'" aria-labelledby="auth-title"><header>'+logo+'</header>'+(step?'<p class="eyebrow">'+step+'</p>':'')+'<h1 id="auth-title">'+title+'</h1><p class="intro">'+desc+'</p>'+body+'</section></main>'}
function shell(title,body) {
 const navigationPage = page === 'activate' ? 'home' : page;
 const items = isAdminPortal ? [['Admin','admin'],['Tenants','tenants'],['Review','review']] : [['Home','home'],['Receipts','receipts'],['Agreement','agreement']];
 const navigation = items.map(([label,destination]) =>
   btn(icon(label)+'<span>'+label+'</span>',destination,'quiet '+(navigationPage===destination?'active':''))
     .replace('data-go=',(navigationPage===destination?'aria-current="page" ':'')+'data-go=')).join('');
 return '<div class="frame"><div class="shell '+(isAdminPortal?'admin-shell':'tenant-shell')+'"><aside class="sidebar"><div class="brand">'+logo+
   '</div><nav class="nav" aria-label="'+(isAdminPortal?'Admin portal':'Tenant portal')+'">'+navigation+
   '</nav><footer><div class="account" title="'+esc(user.email)+'">'+esc(user.email)+'</div>'+btn(icon('Logout')+'Sign out','logout','quiet')+
   '</footer></aside><main class="main'+(page==='review'?' receipt-review':'')+'"><header class="bar">'+title+'</header>'+body+'</main></div></div>';
}
function content(title,desc,body,narrow=false){return '<section class="content '+(narrow?'narrow':'')+'"><h1>'+title+'</h1><p>'+desc+'</p>'+body+'</section>'}
function render(){
 if (page === 'agreement-error') {
   app.innerHTML = auth('Agreement unavailable', 'Please retry loading the tenancy agreement.', btn('Try again', 'consent', 'primary'));
   return;
 }
 const rent=user?.rent, receipt=user?.receipt;
 if (page === 'login') {
   const title = isAdminPortal ? 'Admin sign in' : mode === 'create' ? 'Create your account' : 'Get into your account';
   app.innerHTML = auth(title, isAdminPortal ? 'Enter your administrator email to receive a sign-in code.' : 'Enter your email to receive a one-time code.',
     form('code', input('Email address','email','email','autocomplete="email" placeholder="you@example.com" value="'+esc(email)+'"')+submit('Send code'))+
     (isAdminPortal ? '' : '<p class="switch">'+(mode==='create'?'Already have an account?':'New to Wakajaye?')+' <button class="link" data-go="toggle">'+(mode==='create'?'Sign in':'Create an account')+'</button></p>'));
 }
 if (page === 'forbidden') {
   app.innerHTML = auth('Admin access required', 'This account does not have permission to open the admin dashboard.',
     btn('Sign out', 'logout', 'primary')+'<p class="switch"><a href="/">Go to tenant portal</a></p>');
   return;
 }
 if (page === 'admin-error') {
   app.innerHTML = auth('Unable to load dashboard', 'Please retry loading your admin dashboard.', btn('Try again', 'admin', 'primary'));
   return;
 }
 if(page==='verify')app.innerHTML=auth('Check your email','Enter the six-digit code for <strong>'+esc(email)+'</strong>.',form('verify',input('Verification code','code','text','inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"')+submit('Verify email'))+'<p class="switch"><button class="link" data-go="resend">Resend code</button> · <button class="link" data-go="login">Change email</button></p>');
 if (page === 'profile') {
   const names = '<div class="pair">' +
     input('First name', 'first', 'text', 'autocomplete="given-name" maxlength="80" value="'+esc(user.first)+'"') +
     input('Last name', 'last', 'text', 'autocomplete="family-name" maxlength="80" value="'+esc(user.last)+'"') + '</div>';
   const gender = '<label>Gender<select name="gender" required><option value="">Select an option</option>' +
     ['Female', 'Male', 'Non-binary', 'Prefer not to say'].map(option =>
       '<option'+(user.gender===option?' selected':'')+'>'+option+'</option>').join('') + '</select></label>';
   app.innerHTML = auth('Personal information', 'Tell us a little about yourself.', form('profile', names +
     input('Phone number', 'phone', 'tel', 'autocomplete="tel" maxlength="30" value="'+esc(user.phone)+'"') +
     gender + input('Date of birth', 'dob', 'date', 'autocomplete="bday" max="'+today+'" value="'+esc(user.dob)+'"') +
     submit('Continue')), 'Step 1 of 3');
 }
 if (page === 'guarantor') {
   app.innerHTML = auth('Guarantor details', 'Add someone Wakajaye can contact about your tenancy. Kindly note that this person will be contacted for confirmation purposes.',
     form('guarantor', input('Full name', 'name', 'text', 'maxlength="120"') +
       input('Relationship to you', 'relationship', 'text', 'maxlength="80"') +
       input('Phone number', 'phone', 'tel', 'maxlength="30"') +
       input('Email address (optional)', 'email', 'email', 'maxlength="254"', false) + submit('Continue')), 'Step 2 of 3');
 }
 if (page === 'consent') {
   const agreement = agreementDownload()+
     '<div class="terms" tabindex="0" role="region" aria-label="Residential tenancy agreement" aria-describedby="agreement-progress">'+agreementParagraphs()+'</div>'+
     '<p class="hint" id="agreement-progress" aria-live="polite">Scroll to the bottom of the agreement to enable the checkbox.</p>'+
     '<input type="hidden" name="agreementVersion" value="'+agreementVersion+'">'+
     '<input type="hidden" name="agreementDate" value="'+agreementDate+'">'+
     '<label class="check"><input type="checkbox" name="consent" required disabled>I have read and agree to the Residential Tenancy Agreement.</label>';
   app.innerHTML = auth('Consent and agreement', 'Read and accept the agreement to finish onboarding.',
     form('consent', agreement + submit('Accept and continue')), 'Step 3 of 3');
 }
 if (page === 'agreement') {
   app.innerHTML = shell('Agreement', content('Tenancy agreement', 'Read or download your tenancy agreement.',
     agreementDownload()+'<article class="card agreement-copy">'+agreementParagraphs()+'</article>', true));
 }
 if (page === 'home' || page === 'activate' || page === 'receipts') {
   const active = receipt?.status === 'verified';
   const status = active ? 'active' : receipt?.status ?? 'inactive';
   const message = {
     active: 'Your rent is active.', pending: 'Your payment is pending landlord approval.',
     correction: 'The landlord requested a correction.', rejected: 'Your payment submission was rejected.',
     inactive: 'Submit your payment details to activate your rent.',
   }[status];
   const reviewReason = rent?.review?.reason ? '<p class="review-reason"><strong>Reason</strong> '+esc(rent.review.reason)+'</p>' : '';
   const editLabel = status === 'correction' || status === 'rejected' ? 'Edit and resubmit' : 'Edit payment';
   const rentCard = '<article class="card rent-card"><div class="rent-card-header"><span class="mark">'+icon('Home')+
     '</span><div class="rent-card-summary"><h2>Your rent</h2><p>'+message+'</p></div>'+statusTag(status)+'</div>'+reviewReason+
     (receipt ? '<dl class="details">'+(rent.charges ? paymentLines(rent).map(([label,amount]) =>
       '<div><dt>'+label+'</dt><dd>'+money(amount)+'</dd></div>').join('') : '')+
       '<div><dt>Total paid</dt><dd>'+money(rent.amount)+'</dd></div></dl>'+(active?'':'<div class="action-row">'+btn(editLabel,'activate','primary')+btn('Refresh status','refresh-rent')+'</div>')
       : btn('Activate my rent', 'activate', 'primary'))+'</article>';
   const issuedDate = rent?.approvedAt && new Date(rent.approvedAt).toLocaleDateString('en-GB', {
     day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos',
   });
   const receiptRow = active
     ? '<tr><td>'+esc(issuedDate || '—')+'</td><td>'+esc(receipt.number)+'</td><td><a class="btn receipt-download" href="/api/receipt" download aria-label="Download receipt '+esc(receipt.number)+'">'+icon('Download')+'<span>Download</span></a></td></tr>'
     : '<tr><td colspan="3">'+(receipt ? message : 'No receipts issued yet.')+'</td></tr>';
   const receiptTable = '<div class="table-scroll"><table class="tenant-table receipt-table" aria-label="Issued rent receipts">'+
     '<thead><tr><th scope="col">Date</th><th scope="col">Receipt number</th><th scope="col">Action</th></tr></thead><tbody>'+receiptRow+'</tbody></table></div>'+
     (receipt && !active ? reviewReason : '');
   app.innerHTML = page === 'receipts'
     ? shell('Receipts', content('Rent receipts', 'View and download your issued rent receipts.', receiptTable, true))
     : shell('Home', content('Welcome, '+esc(user.first), 'Manage your Wakajaye rent and receipts in one place.', rentCard));
   if (page === 'activate') {
     app.insertAdjacentHTML('beforeend', '<dialog class="rent-sheet" aria-labelledby="rent-sheet-title">'+
       '<div class="row"><h2 id="rent-sheet-title">'+(receipt ? 'Edit payment' : 'Activate my rent')+'</h2>'+btn('Close', 'close-sheet', 'quiet')+'</div>'+
       '<p>Enter the total amount you paid and attach your proof of payment.</p>'+
       reviewReason+form('activate', paymentFields(rent)+
         uploadField()+submit(receipt ? 'Resubmit for review' : 'Save'))+'</dialog>');
     const dialog = app.querySelector('dialog');
     dialog.addEventListener('cancel', event => {
       event.preventDefault();
       if (!dialog.querySelector('[data-busy="true"]')) go('close-sheet');
     });
     dialog.showModal();
   }
 }
 if (['admin','tenants','review'].includes(page)) renderAdmin();
 initializeUpload();
 initializeAmount();
 app.querySelectorAll('select').forEach(enhanceSelect);
 app.querySelectorAll('input[type="date"]').forEach(enhanceDate);
 const activeForm = app.querySelector('form[data-form]');
 if (!activeForm) return;
 const submitButton = activeForm.querySelector('button:not([type])');
 const syncValidity = () => {
   submitButton.disabled = activeForm.dataset.busy === 'true' || activeForm.dataset.preparingProofs === 'true' ||
     Boolean(activeForm.querySelector(':invalid, [name="consent"]:disabled'));
 };
 activeForm.addEventListener('input', syncValidity);
 activeForm.addEventListener('change', syncValidity);
 const terms = activeForm.querySelector('.terms');
 if (terms) {
   const consent = activeForm.elements.consent;
   const unlockConsent = () => {
     if (agreementText && terms.clientHeight > 0 &&
         terms.scrollTop + terms.clientHeight >= terms.scrollHeight - 2) {
       consent.disabled = false;
       activeForm.querySelector('#agreement-progress').textContent =
         'You have reached the end. You can now tick the confirmation box.';
     }
     syncValidity();
   };
   terms.addEventListener('scroll', unlockConsent);
   unlockConsent();
 }
 syncValidity();
}
function enhanceSelect(select) {
  const wrapper = document.createElement('div');
  wrapper.className = 'select-picker';
  select.before(wrapper);
  wrapper.append(select);
  select.classList.add('picker-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.labels?.[0]?.firstChild?.textContent.trim() || select.name);
  const list = document.createElement('div');
  list.className = 'select-menu';
  list.id = 'options-' + crypto.randomUUID();
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', trigger.getAttribute('aria-label'));
  list.hidden = true;
  trigger.setAttribute('aria-controls', list.id);
  wrapper.append(trigger, list);

  function close() {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }
  function update() {
    trigger.innerHTML = '<span>'+esc(select.selectedOptions[0]?.textContent || 'Select an option')+'</span>'+icon('ChevronDown');
    trigger.classList.toggle('placeholder', !select.value);
    list.replaceChildren();
    for (const option of select.options) {
      if (!option.value) continue;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'select-option';
      item.innerHTML = '<span>'+esc(option.textContent)+'</span>'+(select.value === option.value ? icon('Check') : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(select.value === option.value));
      item.tabIndex = -1;
      item.disabled = option.disabled;
      item.addEventListener('click', () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        close();
        trigger.focus();
      });
      list.append(item);
    }
  }
  function open(position) {
    document.querySelectorAll('.select-menu').forEach(menu => {
      if (menu !== list) {
        menu.hidden = true;
        menu.previousElementSibling.setAttribute('aria-expanded', 'false');
      }
    });
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const items = [...list.querySelectorAll('button:not(:disabled)')];
    const selected = items.find(item => item.getAttribute('aria-selected') === 'true');
    const target = position === 'last' ? items.at(-1) : position === 'first' ? items[0] : selected || items[0];
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  }
  trigger.addEventListener('click', () => list.hidden ? open() : close());
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      open(event.key === 'End' || event.key === 'ArrowUp' ? 'last' : 'first');
    }
  });
  let search = '';
  let searchTimer;
  list.addEventListener('keydown', event => {
    const items = [...list.querySelectorAll('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = items[(index + 1) % items.length];
    if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
    if (event.key === 'Home') next = items[0];
    if (event.key === 'End') next = items.at(-1);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.focus();
    }
    if (event.key === 'Tab') close();
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
      search += event.key.toLowerCase();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { search = ''; }, 600);
      next = items.find(item => item.textContent.toLowerCase().startsWith(search));
    }
    if (next) {
      event.preventDefault();
      next.focus();
    }
  });
  wrapper.addEventListener('focusout', event => {
    if (!wrapper.contains(event.relatedTarget)) close();
  });
  select.addEventListener('change', update);
  select.addEventListener('invalid', event => {
    event.preventDefault();
    trigger.focus();
  });
  update();
}

function enhanceDate(input) {
  const wrapper = document.createElement('div');
  wrapper.className = 'date-picker';
  input.before(wrapper);
  wrapper.append(input);
  input.classList.add('picker-native');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger date-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  const label = input.labels?.[0]?.firstChild?.textContent.trim() || 'Date';
  trigger.setAttribute('aria-label', label);
  wrapper.append(trigger);
  function updateTrigger() {
    const value = input.value ? new Date(input.value + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Select a date';
    trigger.innerHTML = '<span>'+esc(value)+'</span>'+icon('ChevronDown');
    trigger.classList.toggle('placeholder', !input.value);
  }
  input.addEventListener('change', updateTrigger);
  input.addEventListener('invalid', event => {
    event.preventDefault();
    trigger.focus();
  });
  updateTrigger();
  trigger.addEventListener('click', () => {
    const maximum = input.max || today;
    const maxYear = Number(maximum.slice(0, 4));
    const initial = input.value || (maxYear - 18) + '-01-01';
    let selected = input.value;
    let year = Number(initial.slice(0, 4));
    let month = Number(initial.slice(5, 7)) - 1;
    const minimumYear = input.min ? Number(input.min.slice(0, 4)) : 1900;
    const dialog = document.createElement('dialog');
    dialog.className = 'date-sheet';
    dialog.setAttribute('aria-label', 'Choose ' + label.toLowerCase());
    dialog.innerHTML = '<div class="row"><h2></h2><button type="button" class="btn quiet date-close" aria-label="Close calendar">'+icon('Close')+'</button></div>' +
      '<p class="date-description">Choose your month, year, and day.</p>' +
      '<div class="calendar-toolbar"><button type="button" class="btn calendar-prev" aria-label="Previous month">'+icon('Previous')+'</button>' +
      '<select class="calendar-month" aria-label="Month"></select><select class="calendar-year" aria-label="Year"></select>' +
      '<button type="button" class="btn calendar-next" aria-label="Next month">'+icon('Next')+'</button></div>' +
      '<div class="calendar-weekdays" aria-hidden="true">' + ['M','T','W','T','F','S','S'].map(day => '<span>'+day+'</span>').join('') + '</div>' +
      '<div class="calendar-days" role="group" aria-label="Days"></div>' +
      '<p class="calendar-selection" aria-live="polite"></p>' +
      '<button type="button" class="btn primary calendar-confirm">Confirm date</button>';
    dialog.querySelector('h2').textContent = label;
    const monthControl = dialog.querySelector('.calendar-month');
    const yearControl = dialog.querySelector('.calendar-year');
    for (let index = 0; index < 12; index++) {
      monthControl.add(new Option(new Date(2000, index, 1).toLocaleDateString('en-GB', { month: 'long' }), String(index)));
    }
    for (let value = maxYear; value >= minimumYear; value--) yearControl.add(new Option(String(value), String(value)));
    monthControl.value = String(month);
    yearControl.value = String(year);
    app.append(dialog);
    enhanceSelect(monthControl);
    enhanceSelect(yearControl);
    const close = () => {
      dialog.close();
      dialog.remove();
      trigger.focus();
    };
    dialog.querySelector('.date-close').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    const grid = dialog.querySelector('.calendar-days');
    function paint() {
      grid.replaceChildren();
      const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
      const count = new Date(year, month + 1, 0).getDate();
      for (let index = 0; index < firstWeekday; index++) grid.append(document.createElement('span'));
      for (let day = 1; day <= count; day++) {
        const value = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'calendar-day';
        button.textContent = String(day);
        button.dataset.date = value;
        button.disabled = value > maximum || Boolean(input.min && value < input.min);
        button.setAttribute('aria-label', new Date(year, month, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
        button.setAttribute('aria-pressed', String(value === selected));
        button.addEventListener('click', () => {
          selected = value;
          paint();
          grid.querySelector('[data-date="'+value+'"]').focus();
        });
        grid.append(button);
      }
      dialog.querySelector('.calendar-prev').disabled = year === minimumYear && month === 0;
      dialog.querySelector('.calendar-next').disabled = year === maxYear && month >= Number(maximum.slice(5, 7)) - 1;
      dialog.querySelector('.calendar-confirm').disabled = !selected;
      dialog.querySelector('.calendar-selection').textContent = selected
        ? new Date(selected + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : 'No date selected';
    }
    function syncMonth() {
      monthControl.value = String(month);
      yearControl.value = String(year);
      monthControl.dispatchEvent(new Event('change'));
      yearControl.dispatchEvent(new Event('change'));
    }
    monthControl.addEventListener('change', () => { month = Number(monthControl.value); paint(); });
    yearControl.addEventListener('change', () => { year = Number(yearControl.value); paint(); });
    dialog.querySelector('.calendar-prev').addEventListener('click', () => {
      if (month === 0) { year--; month = 11; } else month--;
      syncMonth();
    });
    dialog.querySelector('.calendar-next').addEventListener('click', () => {
      if (month === 11) { year++; month = 0; } else month++;
      syncMonth();
    });
    grid.addEventListener('keydown', event => {
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      const offset = offsets[event.key];
      if (!offset || !event.target.dataset.date) return;
      event.preventDefault();
      const next = new Date(event.target.dataset.date + 'T12:00:00');
      next.setDate(next.getDate() + offset);
      const value = next.getFullYear() + '-' + String(next.getMonth()+1).padStart(2,'0') + '-' + String(next.getDate()).padStart(2,'0');
      if (value > maximum || next.getFullYear() < minimumYear || (input.min && value < input.min)) return;
      year = next.getFullYear();
      month = next.getMonth();
      syncMonth();
      grid.querySelector('[data-date="'+value+'"]').focus();
    });
    dialog.querySelector('.calendar-confirm').addEventListener('click', () => {
      input.value = selected;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      close();
    });
    paint();
    dialog.showModal();
  });
}

document.addEventListener('click', event => {
  for (const menu of document.querySelectorAll('.select-menu:not([hidden])')) {
    if (!menu.parentElement.contains(event.target)) {
      menu.hidden = true;
      menu.previousElementSibling.setAttribute('aria-expanded', 'false');
    }
  }
});

const paymentStatusLabels = { active:'Active', pending:'Pending', inactive:'Inactive', correction:'Correction requested', rejected:'Rejected' };
function statusTag(status) {
  const style = {active:'good',pending:'pending',correction:'pending',rejected:'rejected'}[status] || '';
  return '<span class="tag '+style+'">'+(paymentStatusLabels[status] || 'Inactive')+'</span>';
}

function renderAdmin() {
  const summary = adminRecords.summary;
  const metrics = [
    ['Tenants', summary.tenants], ['Pending payments', summary.pending],
    ['Active rent', summary.active], ['Verified payments', money(summary.received)],
  ].map(([label,value]) => '<article class="card metric"><p>'+label+'</p><strong>'+value+'</strong></article>').join('');
  const pending = adminRecords.tenants.filter(tenant => tenant.status === 'pending');
  let body;
  let title;
  let description;
  if (page === 'admin') {
    title = 'Hostel overview';
    description = 'Manage tenants and verify rent payments.';
    body = '<div class="admin-metrics">'+metrics+'</div><div class="section-title"><h2>Payment review</h2>'+
      btn('View all pending', 'review')+'</div>'+tenantTable(pending);
  } else {
    title = page === 'review' ? 'Receipt review' : 'Tenants';
    description = page === 'review' ? 'Review proof of payment before activating rent.' : 'Find tenants and view their tenancy records.';
    const options = ['', ...Object.keys(paymentStatusLabels)].map(value => '<option value="'+value+'"'+
      (adminFilter===value?' selected':'')+'>'+(paymentStatusLabels[value] || 'All statuses')+'</option>').join('');
    body = form('admin-search', '<div class="admin-search-row">'+
      '<label>Search tenants<input name="search" type="search" value="'+esc(adminSearch)+'" placeholder="Name, email, or phone"></label>'+
      (page==='tenants'?'<label>Rent status<select name="status">'+options+'</select></label>':'')+
      submit(icon('Search')+'Search')+'</div>')+
      tenantTable(adminRecords.tenants)+
      '<div class="row pagination"><p>'+adminRecords.total+' matching tenants</p><div>'+
      (adminPage>1?btn(icon('Previous')+'Previous','admin-prev'):'')+' '+
      (adminPage*adminRecords.pageSize<adminRecords.total?btn('Next'+icon('Next'),'admin-next'):'')+'</div></div>';
  }
  app.innerHTML = shell(page==='admin'?'Admin overview':page==='review'?'Review':'Tenants', content(title,description,body));
}

function tenantTable(tenants) {
  if (!tenants.length) return '<article class="card empty-state"><span class="mark">'+icon('Tenants')+'</span><h2>No tenants to show</h2><p>Tenant records and submitted payments will appear here.</p></article>';
  return '<div class="table-scroll"><table class="tenant-table"><thead><tr><th>Tenant</th><th>Rent</th><th>Amount paid</th><th></th></tr></thead><tbody>'+
    tenants.map(tenant => '<tr><td><strong>'+esc(tenant.name)+'</strong><small>'+esc(tenant.email)+'</small></td>'+
      '<td>'+statusTag(tenant.status)+'</td><td>'+(tenant.rent?money(tenant.rent.amount):'—')+'</td><td>'+
      '<div class="action-row">'+btn(icon('Eye')+'View', 'tenant:'+tenant.email)+
      adminIconButton('Email','Email tenant','email-tenant:'+tenant.email)+
      adminIconButton('Trash','Delete tenant','delete-tenant:'+tenant.email)+'</div></td></tr>').join('')+'</tbody></table></div>';
}

function adminIconButton(symbol, label, action) {
  return btn(icon(symbol), action, 'icon-btn').replace('data-go=', 'aria-label="'+label+'" title="'+label+'" data-go=');
}

function proofPreview(file, index, receiptId) {
  const url = '/api/file?id='+encodeURIComponent(receiptId)+'&index='+index;
  const preview = file.mime === 'application/pdf'
    ? '<iframe sandbox="" referrerpolicy="no-referrer" title="Payment proof '+(index+1)+'" src="'+url+'&preview=1"></iframe>'
    : '<img loading="lazy" alt="Payment proof '+(index+1)+'" src="'+url+'&preview=1">';
  return '<details class="proof-preview"'+(index === 0 ? ' open' : '')+'><summary>'+esc(file.name)+'</summary>'+
    '<div class="receipt-preview">'+preview+'</div><a class="btn" href="'+url+'">'+icon('Download')+'Download proof</a></details>';
}

function showTenant(tenant) {
  const rows = values => '<dl class="tenant-details">'+values.map(([label,value]) => '<div><dt>'+label+'</dt><dd>'+esc(value||'—')+'</dd></div>').join('')+'</dl>';
  const dialog = document.createElement('dialog');
  dialog.className = 'tenant-sheet';
  dialog.setAttribute('aria-label', 'Tenant details');
  const profile = tenant.profile;
  const guarantor = tenant.guarantor;
  const reviewKey = tenant.receipt ? tenant.receipt.id+':'+encodeURIComponent(tenant.rent?.submittedAt ?? '') : '';
  dialog.innerHTML = '<div class="row"><h2>'+esc(tenant.name)+'</h2><button class="btn quiet" type="button" data-close-tenant aria-label="Close tenant details">'+icon('Close')+'</button></div>'+
    '<div class="tenant-status">'+statusTag(tenant.status)+'</div><h3>Personal information</h3>'+
    rows([['Email',tenant.email],['Phone',profile.phone],['Gender',profile.gender],['Date of birth',profile.dob]])+
    '<h3>Guarantor</h3>'+(guarantor?rows([['Name',guarantor.name],['Relationship',guarantor.relationship],['Phone',guarantor.phone],['Email',guarantor.email]]):'<p>Not submitted.</p>')+
    '<h3>Agreement</h3>'+rows([['Onboarding',tenant.onboardingComplete?'Complete':'Incomplete'],['Accepted',profile.agreement?.acceptedAt?new Date(profile.agreement.acceptedAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}):''],['Version',profile.agreement?.version],['Agreement date',profile.agreement?.date]])+
    '<h3>Payment</h3>'+rows([
      ...(tenant.rent?.charges ? paymentLines(tenant.rent).map(([label,amount]) => [label,money(amount)]) : []),
      ['Total paid',tenant.rent?money(tenant.rent.amount):''],
      ['Submitted',tenant.rent?.submittedAt?new Date(tenant.rent.submittedAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'}):''],
    ])+
    (tenant.receipt?tenant.receipt.files.map((file,index) => proofPreview(file,index,tenant.receipt.id)).join('')+
      (tenant.rent?.review?.reason ? '<p class="review-reason">'+esc(tenant.rent.review.reason)+'</p>' : '')+
      (tenant.status==='pending' ? '<div class="action-row review-actions">'+
        btn('Request correction','correction:'+reviewKey)+btn('Reject payment','reject:'+reviewKey)+'</div>'+
        btn(icon('Check')+'Approve payment and issue receipt','approve:'+reviewKey,'primary approve-payment') : '')
      :'<p>No payment receipt submitted.</p>');
  const close = () => { if (dialog.querySelector('[aria-busy="true"]')) return; dialog.close(); dialog.remove(); app.querySelector('[data-go="'+CSS.escape('tenant:'+tenant.email)+'"]')?.focus(); };
  dialog.querySelector('[data-close-tenant]').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault(); if (!dialog.querySelector('[aria-busy="true"]')) close();});
  app.append(dialog);
  dialog.showModal();
}

function uploadField() {
  return '<label class="upload-card">'+
    '<input type="file" accept=".pdf,image/*" multiple class="receipt-file">'+
    '<span class="upload-symbol">'+icon('Upload')+'</span>'+
    '<span class="upload-title">Add proof files</span>'+
    '<span class="upload-description">Up to five PDFs or images. Images up to 10 MB each are compressed to 1 MB or less. 3 MB total after compression.</span>'+
    '<span class="upload-selected" aria-live="polite"></span></label><ul class="proof-list"></ul>';
}

function paymentFields(rent) {
  const value = rent?.amount ?? rent?.charges?.houseRent;
  return '<div class="payment-fields"><label><span>Total amount paid</span>'+
    '<div class="money-field"><input name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"'+
    ' value="'+esc(value > 0 ? formatAmount(String(value)) : '')+'" required><span aria-hidden="true">₦</span></div></label>'+
    '</div>';
}

function formatAmount(value) {
  const normalized = value.replace(/,/g,'');
  if (!/^\d*(\.\d{0,2})?$/.test(normalized)) return null;
  const [integer, decimals] = normalized.split('.');
  const grouped = (integer || (decimals === undefined ? '' : '0')).replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return grouped + (decimals === undefined ? '' : '.'+decimals);
}

function initializeAmount() {
  const inputs = app.querySelectorAll('.money-field input');
  if (!inputs.length) return;
  const validate = () => {
    for (const input of inputs) {
      const raw = input.value.replace(/,/g,'');
      const kobo = raw === '' && !input.required ? 0 : amountInKobo(raw);
      const valid = kobo !== null && kobo >= (input.required ? 1 : 0) && kobo <= maxPaymentKobo;
      input.setCustomValidity(valid ? '' : 'Enter a valid payment amount.');
    }
  };
  for (const input of inputs) {
    let previous = input.value;
    input.addEventListener('input', () => {
      const before = input.value.slice(0,input.selectionStart).replace(/,/g,'').length + (input.value.startsWith('.') ? 1 : 0);
      input.value = formatAmount(input.value) ?? previous;
      previous = input.value;
      let index = 0;
      let digits = 0;
      while (index<input.value.length && digits<before) {
        if (input.value[index]!==',') digits++;
        index++;
      }
      input.setSelectionRange(index,index);
      validate();
    });
  }
  validate();
}

function initializeUpload() {
  const input = app.querySelector('.receipt-file');
  if (!input) return;
  const card = input.closest('.upload-card');
  const list = app.querySelector('.proof-list');
  const feedback = card.querySelector('.upload-selected');
  let preparing = false;
  paymentProofs = (user?.receipt?.files || []).map((file, index) => ({ ...file, keep: index }));
  const renderFiles = (message = '') => {
    const count = paymentProofs.length;
    input.setCustomValidity(preparing ? 'Wait for image compression to finish.' : count ? '' : 'Add at least one proof file.');
    card.classList.toggle('has-file', count > 0);
    card.classList.toggle('has-error', Boolean(message));
    feedback.textContent = message || (count ? count+' of '+maxProofFiles+' files added' : '');
    list.innerHTML = paymentProofs.map((file, index) => '<li><span>'+esc(file.name)+'</span>'+
      '<button type="button" class="btn quiet" data-remove-proof="'+index+'" aria-label="Remove '+esc(file.name)+'">'+icon('Trash')+'Remove</button></li>').join('');
    input.form.dispatchEvent(new Event('change'));
  };
  input.addEventListener('change', async () => {
    if (preparing || input.form.dataset.busy === 'true') return;
    const selected = Array.from(input.files);
    input.value = '';
    if (!selected.length) return;
    const uploadForm = input.form;
    preparing = true;
    uploadForm.dataset.preparingProofs = 'true';
    input.disabled = true;
    card.setAttribute('aria-busy', 'true');
    renderFiles();
    feedback.textContent = 'Preparing proof files…';
    let message = '';
    try {
      const prepared = await prepareProofFiles([...paymentProofs, ...selected]);
      if (app.contains(input)) paymentProofs = prepared;
    } catch (error) {
      message = error.message;
    } finally {
      preparing = false;
      delete uploadForm.dataset.preparingProofs;
      input.disabled = false;
      card.removeAttribute('aria-busy');
      if (app.contains(input)) renderFiles(message);
    }
  });
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-proof]');
    if (!button || preparing || input.form.dataset.busy === 'true') return;
    paymentProofs.splice(Number(button.dataset.removeProof), 1);
    renderFiles();
    input.focus();
  });
  renderFiles();
}

function tenantPage() {
 if (!user) return 'login';
 if (isAdminPortal) return user.admin ? 'admin' : 'forbidden';
 if (!user.first || !user.gender || !user.dob) return 'profile';
 if (!user.guarantor) return 'guarantor';
 if (user.agreement?.version !== agreementVersion) return 'consent';
 return 'home';
}

async function refreshTenantPayment() {
  if (isAdminPortal || tenantRefreshInFlight || document.visibilityState !== 'visible' ||
      user?.receipt?.status !== 'pending' || !['home','receipts'].includes(page)) return;
  const previousUser = user;
  const previousPage = page;
  tenantRefreshInFlight = true;
  try {
    const { user: latest } = await api('session');
    if (user !== previousUser || page !== previousPage) return;
    if (JSON.stringify(latest?.receipt) === JSON.stringify(previousUser.receipt) &&
        JSON.stringify(latest?.rent) === JSON.stringify(previousUser.rent)) return;
    user = latest;
    if (!user) page = 'login';
    render();
  } catch {
    // A temporary connection failure should leave the open dashboard usable.
  } finally {
    tenantRefreshInFlight = false;
  }
}

async function go(p){
 if (p === 'close-sheet') {
   if (app.querySelector('[data-busy="true"]')) return;
   p = 'home';
 }
 if (p === 'activate' && user?.receipt?.status === 'verified') p = 'home';
 if (['home','activate','receipts','agreement','review','admin','tenants'].includes(p)) {
   const destination = tenantPage();
   if (isAdminPortal && destination !== 'admin') p = destination;
   if (!isAdminPortal && destination !== 'home') p = destination;
 }
 if (p === 'refresh-rent' || p === 'receipts' || (p === 'activate' && user?.receipt)) {
   ({ user } = await api('session'+(isAdminPortal?'?portal=admin':'')));
   const destination = tenantPage();
   if (p === 'refresh-rent' || destination !== 'home' ||
       (p === 'activate' && user?.receipt?.status === 'verified')) p = destination;
 }
 if(p==='toggle' && !isAdminPortal){mode=mode==='create'?'signin':'create';return render()}
 if(p==='logout'){await api('logout',{portal:isAdminPortal?'admin':'tenant'});user=null;email='';adminRecords=null;p='login'}
 if(p==='resend'){await api('code',{email,mode,portal:isAdminPortal?'admin':'tenant'});return toast('A new code was requested.')}
 if (p.startsWith('tenant:')) {
   const { tenant } = await api('tenant?email='+encodeURIComponent(p.slice(7)));
   return showTenant(tenant);
 }
 if (p.startsWith('email-tenant:') || p.startsWith('delete-tenant:')) {
   const separator = p.indexOf(':');
   return showAdminAction(p.slice(0,separator), { email: p.slice(separator+1) });
 }
 if (p.startsWith('correction:') || p.startsWith('reject:')) {
   const [decision, id, submittedAt] = p.split(':');
   return showAdminAction('review-payment', { id, submittedAt: decodeURIComponent(submittedAt), decision: decision === 'reject' ? 'rejected' : 'correction' });
 }
 if (p === 'admin-prev' || p === 'admin-next') {
   adminPage += p === 'admin-next' ? 1 : -1;
   p = page;
 } else if (p !== page) adminPage = 1;
 if (p.startsWith('approve:')) {
   const [, id, submittedAt] = p.split(':');
   await api('approve',{id:Number(id),submittedAt:decodeURIComponent(submittedAt) || null});
   toast('Payment approved. The official receipt was emailed to the tenant.');
   app.querySelector('.tenant-sheet')?.close();
   p = page;
 }
 if (['admin','tenants','review'].includes(p)) {
   const params = new URLSearchParams({
     page: String(adminPage), search: p==='admin'?'':adminSearch,
     status: p==='admin'||p==='review'?'pending':adminFilter,
   });
   adminRecords = await api('admin?'+params);
 }
 if (p === 'consent') await loadAgreement();
 if (p === 'agreement') await loadAgreement(user.agreement.date, user.agreement.sha256);
 page=p;render();
}

function showAdminAction(action, fields) {
  const dialog = document.createElement('dialog');
  dialog.className = 'admin-action-dialog';
  let title;
  let details;
  let submitText;
  if (action === 'email-tenant') {
    title = 'Email tenant';
    details = '<p>To '+esc(fields.email)+'</p>'+input('Subject','subject','text','maxlength="120"')+
      '<label>Message<textarea name="message" rows="6" maxlength="5000" required></textarea></label>';
    submitText = 'Send email';
  } else if (action === 'delete-tenant') {
    title = 'Delete tenant';
    details = '<p>Permanently delete '+esc(fields.email)+' and their payment records? This also signs them out.</p>';
    submitText = 'Delete tenant';
  } else {
    title = fields.decision === 'rejected' ? 'Reject payment' : 'Request correction';
    details = '<label>Reason for the tenant<textarea name="reason" rows="4" maxlength="1000" required></textarea></label>';
    submitText = title;
  }
  const hidden = Object.entries(fields).map(([key,value]) => '<input type="hidden" name="'+key+'" value="'+esc(value)+'">').join('');
  dialog.setAttribute('aria-label',title);
  dialog.innerHTML = '<div class="row"><h2>'+title+'</h2><button type="button" class="btn quiet" data-cancel-action>Cancel</button></div>'+
    form(action, hidden+details+submit(submitText, action === 'delete-tenant' ? 'data-destructive' : ''));
  dialog.querySelector('[data-cancel-action]').addEventListener('click', () => {
    if (!dialog.querySelector('[data-busy="true"]')) dialog.close();
  });
  dialog.addEventListener('cancel', event => {
    if (dialog.querySelector('[data-busy="true"]')) event.preventDefault();
  });
  dialog.addEventListener('close', () => dialog.remove());
  app.append(dialog);
  dialog.showModal();
}
function setButtonLoading(button, loading) {
  if (loading) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const dot = document.createElement('span');
    dot.className = 'loading-dot';
    dot.setAttribute('aria-hidden', 'true');
    button.append(dot);
    return;
  }
  button.removeAttribute('aria-busy');
  button.querySelector('.loading-dot')?.remove();
}

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-go]');
  if (!button || button.disabled) return;
  setButtonLoading(button, true);
  try {
    await go(button.dataset.go);
  } catch (error) {
    toast(error.message);
  } finally {
    setButtonLoading(button, false);
    button.disabled = false;
  }
});
app.addEventListener('submit',async e=>{
 const f=e.target;if(!f.dataset.form)return;if(f.dataset.busy==='true'||f.dataset.preparingProofs==='true'){e.preventDefault();return;}e.preventDefault();const data=Object.fromEntries(new FormData(f));const error=f.querySelector('.error'),b=f.querySelector('button:not([type])');error.hidden=true;f.dataset.busy='true';setButtonLoading(b,true);
 try{
  const action=f.dataset.form;
  if (action === 'admin-search') {
    adminSearch = data.search || '';
    adminFilter = data.status || '';
    adminPage = 1;
    return await go(page);
  }
  if (['email-tenant','delete-tenant','review-payment'].includes(action)) {
    if (action === 'review-payment') {
      data.id = Number(data.id);
      data.submittedAt ||= null;
    }
    await api(action,data);
    f.closest('dialog').close();
    if (action === 'email-tenant') return toast('Email sent to '+data.email+'.');
    toast(action === 'delete-tenant' ? 'Tenant deleted.' : 'Review sent to the tenant dashboard.');
    if (action === 'delete-tenant' && data.email === user.email) {
      user = null;
      return await go('login');
    }
    adminPage = 1;
    return await go(page);
  }
  if(action==='code'){email=data.email.trim().toLowerCase();await api('code',{email,mode,portal:isAdminPortal?'admin':'tenant'});return await go('verify')}
  if(action==='verify'){user=(await api('verify',{email,code:data.code,portal:isAdminPortal?'admin':'tenant'})).user;return await go(tenantPage())}
  if (action === 'activate') {
    data.amount = data.amount.replace(/,/g,'');
    data.submittedAt = user.rent?.submittedAt ?? null;
    data.proofs = await Promise.all(paymentProofs.map(entry => {
      if (entry.keep !== undefined) return { keep: entry.keep };
      return new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(Error('Could not read “'+entry.name+'”. Add the file again.'));
        reader.onload = () => resolve({ name:entry.name, file:reader.result.split(',')[1] });
        reader.readAsDataURL(entry);
      });
    }));
  }
  user=(await api(action,data)).user;
  if(action==='activate')toast('Payment submitted for landlord approval.');
  return await go(tenantPage());
 } catch (e) {
   if (f.dataset.form === 'activate') {
     await go('home');
     toast('Failed to save.');
   } else {
     error.textContent = e.message || 'Could not complete the request.';
     error.hidden = false;
   }
 } finally {
   setButtonLoading(b,false);
   delete f.dataset.busy;
   f.dispatchEvent(new Event('change'));
 }
});
email = app.querySelector('[name="email"]')?.value || '';
render();
if (!isAdminPortal) {
  document.addEventListener('visibilitychange', refreshTenantPayment);
  window.addEventListener('focus', refreshTenantPayment);
  window.addEventListener('pageshow', refreshTenantPayment);
  window.setInterval(refreshTenantPayment, 30_000);
}
(async () => {
 try {
   ({user} = await api('session'+(isAdminPortal?'?portal=admin':'')));
   if (!user) return;
   const destination = tenantPage();
   if (destination === 'admin') {
     try { await go('admin'); } catch (error) { page = 'admin-error'; toast(error.message); render(); }
     return;
   }
   page = destination;
   if (page === 'consent') await loadAgreement();
 } catch (error) {
   if (page === 'consent') page = 'agreement-error';
   toast(error.message);
 }
 render();
})();
