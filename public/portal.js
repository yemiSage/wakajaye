const app=document.querySelector('#app'), notice=document.querySelector('#notice');
const logo='<img class="logo" src="wordmark.svg" alt="Wakajaye">';
const icons={Home:'M3 10l9-7 9 7v10H3z M9 20v-7h6v7',Receipts:'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6m-6 4h6',Review:'M4 6h16v14H4z M8 6V3h8v3'};
const icon=n=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+icons[n]+'"/></svg>';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input=(label,name,type='text',attrs='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" '+attrs+' required></label>';
const btn=(label,action,cls='')=>'<button type="button" class="btn '+cls+'" data-go="'+action+'">'+label+'</button>';
const submit=(label,attrs='')=>'<button class="btn primary" '+attrs+'>'+label+'</button>';
const form=(name,contents)=>'<form class="stack" data-form="'+name+'">'+contents+'<p class="error" role="alert" hidden></p></form>';
let user=null,email='',mode='create',page='login',queue=[];
const dateParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
const today=[dateParts.year,dateParts.month,dateParts.day].join('-');
const money=v=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(v);
function toast(message){notice.textContent=message;notice.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>notice.hidden=true,5500)}
async function api(path,data){const r=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const b=await r.json();if(!r.ok)throw Error(b.error||'Something went wrong.');return b}
function auth(title,desc,body,step=''){return '<main class="auth"><section class="auth-card" aria-labelledby="auth-title"><header>'+logo+'</header>'+(step?'<p class="eyebrow">'+step+'</p>':'')+'<h1 id="auth-title">'+title+'</h1><p class="intro">'+desc+'</p>'+body+'</section></main>'}
function shell(title,body){return '<div class="frame"><div class="shell"><aside class="sidebar"><div class="brand">'+logo+'</div><nav class="nav" aria-label="Tenant portal">'+([['Home','home'],['Receipts','receipts'],...(user.admin?[['Review','review']]:[])]).map(([n,p])=>btn(icon(n)+n,p,'quiet '+(page===p?'active':'')).replace('data-go=',(page===p?'aria-current="page" ':'')+'data-go=')).join('')+'</nav><footer><div class="account" title="'+esc(user.email)+'">'+esc(user.email)+'</div>'+btn('Sign out','logout','quiet')+'</footer></aside><main class="main'+(page==='review'?' receipt-review':'')+'"><header class="bar">'+title+'</header>'+body+'</main></div></div>'}
function content(title,desc,body,narrow=false){return '<section class="content '+(narrow?'narrow':'')+'"><h1>'+title+'</h1><p>'+desc+'</p>'+body+'</section>'}
function render(){
 const rent=user?.rent, receipt=user?.receipt;
 if(page==='login')app.innerHTML=auth(mode==='create'?'Create your account':'Get into your account','Enter your email to receive a one-time code.',form('code',input('Email address','email','email','autocomplete="email" placeholder="you@example.com" value="'+esc(email)+'"')+submit('Send code'))+'<p class="switch">'+(mode==='create'?'Already have an account?':'New to Wakajaye?')+' <button class="link" data-go="toggle">'+(mode==='create'?'Sign in':'Create an account')+'</button></p>');
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
   app.innerHTML = auth('Guarantor details', 'Add someone Wakajaye can contact about your tenancy.',
     form('guarantor', input('Full name', 'name', 'text', 'maxlength="120"') +
       input('Relationship to you', 'relationship', 'text', 'maxlength="80"') +
       input('Phone number', 'phone', 'tel', 'maxlength="30"') +
       input('Email address', 'email', 'email', 'maxlength="254"') + submit('Continue')), 'Step 2 of 3');
 }
 if (page === 'consent') {
   const agreement = `<div class="terms" tabindex="0" aria-label="Tenant consent and agreement">
     <p><strong>1. Personal details</strong><br>Confirm the information you provided for your tenancy is accurate. Tell the hostel if it changes.</p>
     <p><strong>2. Guarantor details</strong><br>Confirm you have permission to share your guarantor’s contact information with Wakajaye for tenancy administration.</p>
     <p><strong>3. Proof of payment</strong><br>Provide the correct amount and a readable receipt. The landlord will review your submission before activating your rent.</p>
     <p><strong>4. Tenant records</strong><br>Wakajaye will use these details to manage your tenancy, verify your payment, and email your official receipt after approval.</p>
     <p>End of agreement.</p>
   </div><p class="hint">Scroll to the end to enable the checkbox.</p>
   <label class="check"><input type="checkbox" name="consent" required disabled>I have read and agree to these terms.</label>`;
   app.innerHTML = auth('Consent and agreement', 'Read and accept the agreement to finish onboarding.',
     form('consent', agreement + submit('Accept and continue')), 'Step 3 of 3');
 }
 if (page === 'home' || page === 'activate' || page === 'receipts') {
   const active = receipt?.status === 'verified';
   const status = active ? 'Active' : receipt ? 'Pending' : 'Inactive';
   const message = active ? 'Your rent is active.' : receipt
     ? 'Your payment is pending landlord approval.'
     : 'Submit your payment details to activate your rent.';
   const rentCard = '<article class="card"><div class="row"><span class="mark">'+icon('Home')+
     '</span><span class="tag '+(active?'good':'')+'">'+status+'</span></div><h2>Your rent</h2><p>'+message+'</p>'+
     (receipt ? '<dl class="details"><div><dt>Amount paid</dt><dd>'+money(rent.amount)+'</dd></div></dl>'+(active?'':btn('Refresh status','refresh-rent'))
       : btn('Activate my rent', 'activate', 'primary'))+'</article>';
   const receiptCard = '<article class="card"><h2>Payment receipt</h2><p>'+
     (receipt ? esc(receipt.name) : 'Add your receipt when you activate your rent.')+'</p>'+
     (receipt ? '<p>'+(active?'Your official receipt was sent to '+esc(user.email)+'.':message)+'</p>'
       : btn('Activate my rent', 'activate', 'primary'))+'</article>';
   app.innerHTML = page === 'receipts'
     ? shell('Receipts', content('Rent receipt', 'Track your payment receipt.', receiptCard, true))
     : shell('Home', content('Welcome, '+esc(user.first), 'Manage your Wakajaye rent and receipts in one place.', rentCard));
   if (page === 'activate') {
     app.insertAdjacentHTML('beforeend', '<dialog class="rent-sheet" aria-labelledby="rent-sheet-title">'+
       '<div class="row"><h2 id="rent-sheet-title">Activate my rent</h2>'+btn('Close', 'close-sheet', 'quiet')+'</div>'+
       '<p>Enter the amount you paid and attach your payment receipt.</p>'+
       form('activate', input('Amount paid (₦)', 'amount', 'number',
         'min="0.01" step="0.01" max="1000000000" value="'+esc(rent?.amount)+'"')+
         input('Payment receipt', 'file', 'file', 'accept=".pdf,.jpg,.jpeg,.png"')+
         '<p class="hint">PDF, JPG, or PNG · Up to 3 MB</p>'+submit('Save'))+'</dialog>');
     const dialog = app.querySelector('dialog');
     dialog.addEventListener('cancel', event => {
       event.preventDefault();
       if (!dialog.querySelector('[data-busy="true"]')) go('close-sheet');
     });
     dialog.showModal();
   }
 }
 if(page==='review')app.innerHTML=shell('Review',content('Receipt review','Verify uploaded proof of payment and issue the tenant’s receipt.',queue.length?'<div class="stack">'+queue.map(r=>'<article class="card"><h2>'+esc(r.email)+'</h2><p>'+money(r.amount)+(r.paid?' · Paid '+esc(r.paid):'')+'</p><a class="btn" href="/api/file?id='+encodeURIComponent(r.id)+'">Download proof</a> '+btn('Verify and issue receipt','approve:'+r.id,'primary')+'</article>').join('')+'</div>':'<article class="card"><p>No receipts are waiting for review.</p></article>'));
 app.querySelectorAll('select').forEach(enhanceSelect);
 app.querySelectorAll('input[type="date"]').forEach(enhanceDate);
 const activeForm = app.querySelector('form[data-form]');
 if (!activeForm) return;
 const submitButton = activeForm.querySelector('button:not([type])');
 const syncValidity = () => {
   submitButton.disabled = activeForm.dataset.busy === 'true' ||
     Boolean(activeForm.querySelector(':invalid, [name="consent"]:disabled'));
 };
 activeForm.addEventListener('input', syncValidity);
 activeForm.addEventListener('change', syncValidity);
 const terms = activeForm.querySelector('.terms');
 if (terms) {
   const consent = activeForm.elements.consent;
   const unlockConsent = () => {
     if (terms.scrollTop + terms.clientHeight >= terms.scrollHeight - 2) consent.disabled = false;
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
    trigger.textContent = select.selectedOptions[0]?.textContent || 'Select an option';
    trigger.classList.toggle('placeholder', !select.value);
    list.replaceChildren();
    for (const option of select.options) {
      if (!option.value) continue;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'select-option';
      item.textContent = option.textContent;
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
    trigger.textContent = input.value
      ? new Date(input.value + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'Select a date';
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
    dialog.innerHTML = '<div class="row"><h2></h2><button type="button" class="btn quiet date-close" aria-label="Close calendar">✕</button></div>' +
      '<p class="date-description">Choose your month, year, and day.</p>' +
      '<div class="calendar-toolbar"><button type="button" class="btn calendar-prev" aria-label="Previous month">‹</button>' +
      '<select class="calendar-month" aria-label="Month"></select><select class="calendar-year" aria-label="Year"></select>' +
      '<button type="button" class="btn calendar-next" aria-label="Next month">›</button></div>' +
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

function tenantPage() {
 if (!user) return 'login';
 if (!user.first || !user.gender || !user.dob) return 'profile';
 if (!user.guarantor) return 'guarantor';
 if (!user.agreement) return 'consent';
 return 'home';
}
async function go(p){
 if (p === 'close-sheet') {
   if (app.querySelector('[data-busy="true"]')) return;
   p = 'home';
 }
 if (p === 'activate' && user.receipt) p = 'home';
 if (['home','activate','receipts','review'].includes(p) && tenantPage() !== 'home') p = tenantPage();
 if (p === 'refresh-rent') {
   ({ user } = await api('session'));
   p = tenantPage();
 }
 if(p==='toggle'){mode=mode==='create'?'signin':'create';return render()}
 if(p==='logout'){await api('logout',{});user=null;email='';p='login'}
 if(p==='resend'){await api('code',{email,mode});return toast('A new code was requested.')}
 if(p==='review')queue=(await api('queue')).queue;
 if(p.startsWith('approve:')){await api('approve',{id:Number(p.split(':')[1])});queue=(await api('queue')).queue;toast('Receipt verified and issued.');return render()}
 page=p;render();
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
 const f=e.target;if(!f.dataset.form)return;if(f.dataset.busy==='true'){e.preventDefault();return;}e.preventDefault();const data=Object.fromEntries(new FormData(f));const error=f.querySelector('.error'),b=f.querySelector('button:not([type])');error.hidden=true;f.dataset.busy='true';setButtonLoading(b,true);
 try{
  const action=f.dataset.form;
  if(action==='code'){email=data.email.trim().toLowerCase();await api('code',{email,mode});return await go('verify')}
  if(action==='verify'){user=(await api('verify',{email,code:data.code})).user;return await go(tenantPage())}
  if(action==='activate'){if(data.file.size>3*1024*1024)throw Error('Choose a file no larger than 3 MB.');const file=data.file;data.file=await new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(file)});data.name=file.name;}
  user=(await api(action,data)).user;
  if(action==='activate')toast('Payment submitted for landlord approval.');
  return await go(tenantPage());
 }catch(e){error.textContent=e.message||'Could not complete the request.';error.hidden=false;}finally{setButtonLoading(b,false);delete f.dataset.busy;f.dispatchEvent(new Event('change'));}
});
(async () => {
 try {
   ({user} = await api('session'));
   page = tenantPage();
 } catch (error) {
   toast(error.message);
 }
 render();
})();
