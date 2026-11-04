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
function shell(title,body){return '<div class="frame"><div class="shell"><aside class="sidebar"><div class="brand">'+logo+'</div><nav class="nav" aria-label="Tenant portal">'+(user.admin?[['Review','review']]:[['Home','home'],['Receipts','receipts']]).map(([n,p])=>btn(icon(n)+n,p,'quiet '+(page===p?'active':'')).replace('data-go=',(page===p?'aria-current="page" ':'')+'data-go=')).join('')+'</nav><footer><div class="account">'+esc(user.email)+'</div>'+btn('Sign out','logout','quiet')+'</footer></aside><main class="main"><header class="bar">'+title+'</header>'+body+'</main></div></div>'}
function content(title,desc,body,narrow=false){return '<section class="content '+(narrow?'narrow':'')+'"><h1>'+title+'</h1><p>'+desc+'</p>'+body+'</section>'}
function render(){
 const rent=user?.rent, receipt=user?.receipt;
 if(page==='login')app.innerHTML=auth(mode==='create'?'Create your account':'Get into your account','Enter your email to receive a one-time code.',form('code',input('Email address','email','email','autocomplete="email" placeholder="you@example.com" value="'+esc(email)+'"')+submit('Send code'))+'<p class="switch">'+(mode==='create'?'Already have an account?':'New to Wakajaye?')+' <button class="link" data-go="toggle">'+(mode==='create'?'Sign in':'Create an account')+'</button></p>');
 if(page==='verify')app.innerHTML=auth('Check your email','Enter the six-digit code for <strong>'+esc(email)+'</strong>.',form('verify',input('Verification code','code','text','inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"')+submit('Verify email'))+'<p class="switch"><button class="link" data-go="resend">Resend code</button> · <button class="link" data-go="login">Change email</button></p>');
 if(page==='profile')app.innerHTML=auth('Personal information','Tell us a little about yourself.',form('profile','<div class="pair">'+input('First name','first','text','autocomplete="given-name" maxlength="80" value="'+esc(user.first)+'"')+input('Last name','last','text','autocomplete="family-name" maxlength="80" value="'+esc(user.last)+'"')+'</div>'+input('Phone number','phone','tel','autocomplete="tel" maxlength="30" value="'+esc(user.phone)+'"')+submit('Continue')),'Step 1 of 2');
 if(page==='guarantor')app.innerHTML=auth('Guarantor details','Add someone Wakajaye can contact about your tenancy.',form('guarantor',input('Full name','name','text','maxlength="120"')+input('Relationship to you','relationship','text','maxlength="80"')+input('Phone number','phone','tel','maxlength="30"')+input('Email address','email','email','maxlength="254"')+submit('Finish setup'))+'<p class="switch"><button class="link" data-go="profile">Back</button></p>','Step 2 of 2');
 if(page==='home')app.innerHTML=shell('Home',content('Welcome, '+esc(user.first),'Manage your Wakajaye rent and receipts in one place.','<div class="grid"><article class="card"><div class="row"><span class="mark">'+icon('Home')+'</span><span class="tag '+(rent?'good':'')+'">'+(rent?'Active':'Inactive')+'</span></div><h2>Your rent</h2><p>'+(rent?'Your rent is active.':'Add your payment details to activate your rent.')+'</p>'+(rent?'<dl class="details"><div><dt>Amount paid</dt><dd>'+money(rent.amount)+'</dd></div><div><dt>Payment date</dt><dd>'+esc(rent.paid)+'</dd></div><div><dt>Occupants</dt><dd>'+esc(rent.occupants)+'</dd></div></dl>':btn('Activate rent','activate','primary'))+'</article><article class="card"><div class="row"><span class="mark">'+icon('Receipts')+'</span><span class="tag '+(receipt?.status==='verified'?'good':'')+'">'+(receipt?.status==='verified'?'Verified':receipt?'Pending review':'No receipt')+'</span></div><h2>Rent receipt</h2><p>'+(receipt?'View the status of your payment receipt.':'Upload your proof of payment for the hostel admin to review.')+'</p>'+btn(receipt?'View receipt':'Upload receipt','receipts')+'</article></div>'));
 if(page==='activate')app.innerHTML=shell('Rent',content('Activate your rent','Enter the details of the payment you already made.',form('activate','<div class="pair">'+input('Payment date','paid','date','max="'+today+'"')+input('Amount paid (₦)','amount','number','min="0.01" step="0.01" max="1000000000"')+input('Number of occupants','occupants','number','min="1" max="100" step="1"')+input('Date of birth','dob','date','max="'+today+'"')+'</div><h2>Tenant consent</h2><div class="terms" tabindex="0" aria-label="Tenant consent terms"><p><strong>1. Payment information</strong><br>Confirm the payment date and amount match the payment you made for your Wakajaye tenancy.</p><p><strong>2. Proof of payment</strong><br>Upload a clear copy of your proof of payment. Hostel staff will review the receipt before issuing an official receipt.</p><p><strong>3. Occupancy</strong><br>Confirm the number of people who will live in the unit. Tell the hostel if the number changes.</p><p><strong>4. Contact information</strong><br>Confirm you have permission to share your guarantor’s contact information with Wakajaye for tenancy administration.</p><p><strong>5. Records</strong><br>Wakajaye will use these details to manage your tenancy, verify payment, and send your receipt to your verified email address.</p><p>End of consent form.</p></div><p class="hint">Scroll to the bottom to enable the checkbox.</p><label class="check"><input type="checkbox" name="consent" required disabled>I have read and agree to the terms above.</label>'+submit('Activate rent','disabled')+btn('Back to home','home')),true));
 if(page==='receipts')app.innerHTML=shell('Receipts',content('Rent receipt','Submit your proof of payment and track its review.','<article class="card">'+(!rent?'<p>Activate your rent before uploading a receipt.</p>'+btn('Activate rent','activate','primary'):receipt?'<span class="tag '+(receipt.status==='verified'?'good':'')+'">'+(receipt.status==='verified'?'Verified':'Pending review')+'</span><h2>'+esc(receipt.name)+'</h2><p>'+(receipt.status==='verified'?'Your payment was verified. The official receipt was '+'sent to '+esc(user.email)+'.':'The hostel admin will review your proof of payment and get back to you by email.')+'</p>':form('receipt',input('Proof of payment','file','file','accept=".pdf,.jpg,.jpeg,.png"')+'<p class="hint">PDF, JPG, or PNG · Up to 3 MB</p>'+submit('Submit receipt')))+'</article>',true));
 if(page==='review')app.innerHTML=shell('Review',content('Receipt review','Verify uploaded proof of payment and issue the tenant’s receipt.',queue.length?'<div class="stack">'+queue.map(r=>'<article class="card"><h2>'+esc(r.email)+'</h2><p>'+money(r.amount)+' · Paid '+esc(r.paid)+'</p><a class="btn" href="/api/file?id='+encodeURIComponent(r.id)+'">Download proof</a> '+btn('Verify and issue receipt','approve:'+r.id,'primary')+'</article>').join('')+'</div>':'<article class="card"><p>No receipts are waiting for review.</p></article>'));
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
async function go(p){
 if(p==='toggle'){mode=mode==='create'?'signin':'create';return render()}
 if(p==='logout'){await api('logout',{});user=null;email='';p='login'}
 if(p==='resend'){await api('code',{email,mode});return toast('A new code was requested.')}
 if(p==='review')queue=(await api('queue')).queue;
 if(p.startsWith('approve:')){await api('approve',{id:Number(p.split(':')[1])});queue=(await api('queue')).queue;toast('Receipt verified and issued.');return render()}
 page=p;render();
}
app.addEventListener('click',async e=>{const b=e.target.closest('[data-go]');if(!b)return;b.disabled=true;try{await go(b.dataset.go)}catch(e){toast(e.message)}finally{b.disabled=false}});
app.addEventListener('submit',async e=>{
 const f=e.target;if(!f.dataset.form)return;e.preventDefault();const data=Object.fromEntries(new FormData(f));const error=f.querySelector('.error'),b=f.querySelector('button:not([type])');error.hidden=true;f.dataset.busy='true';b.disabled=true;
 try{
  const action=f.dataset.form;
  if(action==='code'){email=data.email.trim().toLowerCase();await api('code',{email,mode});return go('verify')}
  if(action==='verify'){user=(await api('verify',{email,code:data.code})).user;return go(user.admin?'review':user.guarantor?'home':user.first?'guarantor':'profile')}
  if(action==='receipt'){if(data.file.size>3*1024*1024)throw Error('Choose a file no larger than 3 MB.');const file=data.file;data.file=await new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(file)});data.name=file.name;}
  user=(await api(action,data)).user;
  if(action==='receipt'){toast('Receipt submitted for admin review.');return go('receipts')}
  if(action==='activate')toast('Your rent is now active.');
  return go(action==='profile'?'guarantor':'home');
 }catch(e){error.textContent=e.message||'Could not complete the request.';error.hidden=false;}finally{delete f.dataset.busy;f.dispatchEvent(new Event('change'));}
});
(async()=>{try{({user}=await api('session'));page=user?(user.guarantor?'home':user.first?'guarantor':'profile'):'login';if(user?.admin)return await go('review')}catch(e){toast('Start the Wakajaye server to use this portal.')}render()})();
