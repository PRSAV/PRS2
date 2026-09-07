const $ = id => document.getElementById(id);
const WORKER_URL = 'https://pv-capture-ai-v2.mahipal-office21.workers.dev';
const SESSION_KEY = 'prs-assetverify-session-v20';
const STICKY_PREFIX = 'prs-assetverify-sticky-v20-';
const CONDITIONS = ['Good','Fair','Poor','Damaged','Under Repair'];
const STATUSES = ['Found','Not Found','Pending'];
const NOT_FOUND_REASONS = ['','Missing','Disposed','Transferred','Stolen','Under Maintenance'];
const R2_FREE_BYTES = 10 * 1024 * 1024 * 1024;

const PERMISSION_CATALOG = [
  ['verification.view','Verification - View','Open the verification workspace and saved records'],
  ['verification.capture_photo','Verification - Take Photo','Capture a new verification photo'],
  ['verification.upload_gallery','Verification - Gallery Upload','Upload a photo from the device gallery'],
  ['verification.scan','Verification - Scan QR / Barcode','Use Scan & Verify'],
  ['verification.save','Verification - Save','Save a new verification record'],
  ['verification.edit','Verification - Edit','Edit an existing verification record'],
  ['verification.delete','Verification - Delete','Delete a verification record and photo'],
  ['verification.view_images','Verification - View Images','View stored verification photos'],
  ['records.search','Records - Search & Filters','Search and filter verification records'],
  ['records.export','Reports - Export Excel','Export the company verification report to Excel'],
  ['records.view_usage','Reports - Usage','View company photo storage usage'],
  ['audit.view','Governance - Audit Trail','View immutable company audit events'],
  ['backup.manage','Data Protection - Backup & Restore','Download and restore complete company backups'],
  ['members.view','Members - View','View company team members'],
  ['members.create','Members - Add','Add a company team member'],
  ['members.edit','Members - Edit','Edit a team member or assigned role'],
  ['members.delete','Members - Delete','Delete a team member'],
  ['roles.view','Roles - View','View roles and their permissions'],
  ['roles.create','Roles - Create','Create a custom role'],
  ['roles.edit','Roles - Edit','Edit system/custom role name, permissions and assignments'],
  ['roles.delete','Roles - Delete','Delete an unused custom role'],
  ['roles.assign','Roles - Assign','Assign roles to team members'],
  ['masters.view','Setting & Master - View','View sticky and variable field masters'],
  ['masters.edit','Setting & Master - Edit','Add, edit or delete sticky / variable fields'],
  ['company.edit','Company - Edit','Edit company details and credentials'],
  ['company.delete','Company - Delete','Permanently delete the company workspace']
];

let session = null;
let companies = [];
let records = [];
let users = [];
let roles = [];
let fields = {sticky:[], variable:[], allFields:[], schemaVersion:1};
let exportColumns = [];
let exportHistory = [];
let selectedCompany = null;
let deleteTargetCompany = null;
let pendingRecord = null;
let editingRecord = null;
let editingUser = null;
let editingRole = null;
let editingField = null;
let editingFieldGroup = null;
let aiSeq = 0;
let activeStatus = 'ALL';
let scanner = null;
let scannerControls = null;
let scannerRunning = false;
let scannerAutoProceed = false;
let appendPhotoMode = false;
let scanCodes = [];
let scanEvidenceFiles = [];
let auditEvents = [];
let selectedMemberForPin = null;
let syncRunning = false;
const OFFLINE_DB_NAME = 'prs-assetverify-offline-v20';
const OFFLINE_DB_VERSION = 1;

function toast(message, ms=2800){const e=$('toast');e.textContent=message;e.classList.remove('hidden');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.add('hidden'),ms)}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function pad(n){return String(n).padStart(2,'0')}
function fmtDate(d){d=new Date(d);return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`}
function fmtTime(d){d=new Date(d);return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`}
function isoDateInput(d){const x=new Date(d);return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`}
function timeInput(d){const x=new Date(d);return `${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`}
function combineDateTime(date,time){const d=new Date(`${date}T${time || '00:00:00'}`);return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString()}
function uid(){return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}
function bytesLabel(n){if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;if(n<1024*1024*1024)return `${(n/1024/1024).toFixed(1)} MB`;return `${(n/1024/1024/1024).toFixed(2)} GB`}
function hasPermission(code){const p=session?.member?.permissions||[];return p.includes('*')||p.includes(code)}
function authHeaders(body=false){const h={};if(body)h['Content-Type']='application/json';if(session?.token)h.Authorization=`Bearer ${session.token}`;return h}
async function api(path,options={}){
  const opts={...options,headers:{...authHeaders(!!options.body),...(options.headers||{})}};
  try{
    const r=await fetch(`${WORKER_URL}${path}`,opts);
    if(r.status===401&&session){clearSession();showWelcome();toast('Company session expired. Please login again.')}
    return r;
  }catch(error){
    console.error('PRS API connection error:',path,error);
    throw new Error(navigator.onLine
      ? 'Could not reach the PRS cloud server. Please retry in a moment.'
      : 'You are offline. Reconnect to use this cloud feature.');
  }
}
async function apiJson(path,options={}){
  const r=await api(path,options);
  const text=await r.text().catch(()=>'');
  let d={};
  if(text){try{d=JSON.parse(text)}catch{d={}}}
  if(!r.ok)throw new Error(d.error||`Cloud request failed (${r.status})`);
  return d;
}
function saveSession(){localStorage.setItem(SESSION_KEY,JSON.stringify(session))}
function clearSession(){session=null;localStorage.removeItem(SESSION_KEY)}
function loadSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}

const allViews=['welcomeView','createCompanyView','existingCompanyView','verifyView','searchView','usersView','rolesView','mastersView','downloadHistoryView','auditView','backupView','usageView','editCompanyView'];
const menuSubviewIds=new Set(['searchView','usersView','rolesView','mastersView','downloadHistoryView','auditView','backupView','usageView','editCompanyView']);
function showView(id){allViews.forEach(v=>$(v).classList.toggle('hidden',v!==id));const showExit=id!=='welcomeView'&&id!=='verifyView';$('viewExitBtn').classList.toggle('hidden',!showExit);$('viewExitBtn').dataset.currentView=id;closeDrawer()}
function showWelcome(){showView('welcomeView');$('menuBtn').classList.add('hidden');$('logoutBtn').classList.add('hidden');$('syncBadge').classList.add('hidden');$('companySubtitle').textContent=''}
function openDrawer(){$('drawer').classList.remove('hidden');$('drawerBackdrop').classList.remove('hidden')}
function closeDrawer(){$('drawer').classList.add('hidden');$('drawerBackdrop').classList.add('hidden')}
function updateShell(){if(!session)return;$('menuBtn').classList.remove('hidden');$('logoutBtn').classList.remove('hidden');$('syncBadge').classList.remove('hidden');$('companySubtitle').textContent=session.company.name;$('drawerCompany').textContent=session.company.name;$('drawerUser').textContent=session.member?`${session.member.name} · ${session.member.roleName}`:'Team member not selected';document.querySelectorAll('[data-permission]').forEach(e=>e.classList.toggle('hidden',!hasPermission(e.dataset.permission)));document.querySelectorAll('[data-permission-button]').forEach(e=>{const ok=hasPermission(e.dataset.permissionButton);e.classList.toggle('hidden',!ok);e.disabled=!ok});updateOfflineNotice();updateSyncUi()}

$('menuBtn').onclick=openDrawer;$('drawerBackdrop').onclick=closeDrawer;$('closeDrawerBtn').onclick=closeDrawer;$('viewExitBtn').onclick=()=>{const current=$('viewExitBtn').dataset.currentView;if(current==='createCompanyView'||current==='existingCompanyView'){showWelcome();return}if(session?.member){showView('verifyView');renderStickyFields();renderRecent()}else if(session){showView('existingCompanyView');loadCompanies()}else showWelcome()};$('logoutBtn').onclick=async()=>{try{await apiJson('/auth/logout',{method:'POST'})}catch{}clearSession();showWelcome()};

document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=async()=>{const n=b.dataset.nav;if(n==='verify'){showView('verifyView');renderStickyFields();renderRecent()}if(n==='search'){showView('searchView');populateFilters();renderSearch()}if(n==='users'){showView('usersView');await refreshUsers();renderUsers()}if(n==='roles'){showView('rolesView');await refreshRoles();renderRoles()}if(n==='masters'){showView('mastersView');await Promise.all([refreshFields(),refreshExportColumns()]);renderMasters()}if(n==='downloadHistory'){showView('downloadHistoryView');await refreshDownloadHistory()}if(n==='audit'){showView('auditView');await refreshAudit()}if(n==='backup'){showView('backupView')}if(n==='usage'){showView('usageView');await loadUsage()}if(n==='editCompany'){fillCompanyEdit();showView('editCompanyView')}if(n==='switchMember'){await refreshUsers();showMemberSelector()}if(n==='switchCompany'){clearSession();showView('existingCompanyView');await loadCompanies()}if(n==='welcome'){clearSession();showWelcome()}});

// ---------- Company creation / login ----------
function createMemberRow(data={},locked=false){
  const wrap=document.createElement('div');
  wrap.className='member-row member-row-v6';
  wrap.innerHTML=`<label>Full Name *<input class="cm-name" value="${escapeHtml(data.name||'')}" placeholder="Member name"></label><label>Initial Role *<select class="cm-role"><option value="ADMIN" ${data.role==='ADMIN'?'selected':''}>Admin</option><option value="VERIFIER" ${data.role==='VERIFIER'?'selected':''}>Verifier</option></select></label><label>Member PIN *<input class="cm-pin" type="password" inputmode="numeric" maxlength="6" placeholder="4–6 digits"></label><button class="remove-member" type="button" ${locked?'disabled':''}>✕</button>`;
  const role=wrap.querySelector('.cm-role');
  role.dataset.lastValue=role.value;
  role.addEventListener('change',()=>{
    const hasAdmin=[...$('createMembers').querySelectorAll('.cm-role')].some(select=>select.value==='ADMIN');
    if(!hasAdmin){
      role.value=role.dataset.lastValue||'ADMIN';
      toast('At least one Admin is compulsory. The last Admin cannot be changed to Verifier.',4200);
      return;
    }
    role.dataset.lastValue=role.value;
  });
  wrap.querySelector('.remove-member').onclick=()=>{
    const rolesNow=[...$('createMembers').querySelectorAll('.member-row')];
    const thisIsAdmin=role.value==='ADMIN';
    const adminCount=rolesNow.filter(row=>row.querySelector('.cm-role')?.value==='ADMIN').length;
    if(thisIsAdmin&&adminCount<=1){toast('At least one Admin is compulsory.');return;}
    wrap.remove();
  };
  return wrap;
}
function resetCreateCompany(){$('newCompanyName').value='';$('newCompanyStartDate').value=isoDateInput(new Date());$('newCompanyUsername').value='';$('newCompanyPassword').value='';$('createMembers').innerHTML='';$('createMembers').appendChild(createMemberRow({role:'ADMIN'},true));$('createMembers').appendChild(createMemberRow({role:'VERIFIER'}))}
function collectCreateMembers(){return [...$('createMembers').querySelectorAll('.member-row')].map(r=>({name:r.querySelector('.cm-name').value.trim(),role:r.querySelector('.cm-role').value,pin:r.querySelector('.cm-pin').value.trim()}))}
$('openCreateCompanyBtn').onclick=()=>{resetCreateCompany();showView('createCompanyView')};$('openExistingCompanyBtn').onclick=async()=>{showView('existingCompanyView');await loadCompanies()};document.querySelectorAll('[data-back-welcome]').forEach(b=>b.onclick=showWelcome);$('addCreateMemberBtn').onclick=()=>$('createMembers').appendChild(createMemberRow({role:'VERIFIER'}));
$('createCompanyBtn').onclick=async()=>{const name=$('newCompanyName').value.trim(),startDate=$('newCompanyStartDate').value,username=$('newCompanyUsername').value.trim(),password=$('newCompanyPassword').value,members=collectCreateMembers();if(!name||!startDate||!username||!password){toast('Complete company name, start date, username and password.');return}if(password.length<6){toast('Company password must be at least 6 characters.');return}if(members.some(m=>!m.name)||!members.some(m=>m.role==='ADMIN')){toast('Every member needs a name and at least one Admin is required.');return}if(members.some(m=>!/^\d{4,6}$/.test(m.pin))){toast('Set a 4–6 digit personal PIN for every team member.');return}const btn=$('createCompanyBtn');btn.disabled=true;btn.textContent='Creating Company…';try{const d=await apiJson('/public/companies',{method:'POST',body:JSON.stringify({name,startDate,username,password,members})});session=d.session;saveSession();await enterCompany()}catch(e){toast(e.message,4500)}finally{btn.disabled=false;btn.textContent='Create Company'}};

async function loadCompanies(){try{const d=await apiJson('/public/companies');companies=d.companies||[];$('companyList').innerHTML=companies.map(c=>`<div class="company-row company-row-v9"><button class="company-open-btn" data-company="${c.id}"><strong>${escapeHtml(c.name)}</strong><span>${escapeHtml(c.code)}</span></button><span class="company-users">${c.memberCount} member${c.memberCount===1?'':'s'}</span><span class="company-start">Start: ${escapeHtml(c.startDate)}</span><span class="status-active">Active</span><button class="danger mini-btn company-delete-public" data-public-delete-company="${c.id}">Delete</button></div>`).join('');$('noCompanies').classList.toggle('hidden',companies.length>0);document.querySelectorAll('[data-company]').forEach(b=>b.onclick=()=>openLogin(b.dataset.company));document.querySelectorAll('[data-public-delete-company]').forEach(b=>b.onclick=e=>{e.stopPropagation();openPublicDeleteCompany(b.dataset.publicDeleteCompany)})}catch(e){toast(e.message)}}
function openPublicDeleteCompany(id){deleteTargetCompany=companies.find(c=>String(c.id)===String(id));if(!deleteTargetCompany)return;$('publicDeleteCompanyTitle').textContent=`Delete ${deleteTargetCompany.name}`;$('publicDeleteAdminName').value='';$('publicDeleteAdminPin').value='';$('publicDeleteCompanyModal').classList.remove('hidden')}
$('confirmPublicDeleteCompanyBtn').onclick=async()=>{if(!deleteTargetCompany)return;const adminName=$('publicDeleteAdminName').value.trim(),pin=$('publicDeleteAdminPin').value.trim();if(!adminName||!/^[0-9]{4,6}$/.test(pin)){toast('Enter the company Admin name and 4–6 digit PIN.');return}if(!confirm(`Permanently delete ${deleteTargetCompany.name} and all of its cloud data?`))return;try{await apiJson('/public/delete-company',{method:'POST',body:JSON.stringify({companyId:deleteTargetCompany.id,adminName,pin})});$('publicDeleteCompanyModal').classList.add('hidden');toast('Company permanently deleted.');deleteTargetCompany=null;await loadCompanies()}catch(e){toast(e.message,4500)}};
function openLogin(id){selectedCompany=companies.find(c=>String(c.id)===String(id));if(!selectedCompany)return;$('loginCompanyName').textContent=selectedCompany.name;$('loginUsername').value='';$('loginPassword').value='';$('loginModal').classList.remove('hidden')}
$('loginBtn').onclick=async()=>{try{const d=await apiJson('/auth/login',{method:'POST',body:JSON.stringify({companyId:selectedCompany.id,username:$('loginUsername').value.trim(),password:$('loginPassword').value})});session=d.session;saveSession();$('loginModal').classList.add('hidden');await enterCompany()}catch(e){toast(e.message,4200)}};
$('forgotPasswordBtn').onclick=()=>{$('loginModal').classList.add('hidden');$('forgotStep1').classList.remove('hidden');$('forgotStep2').classList.add('hidden');$('forgotUsername').value=$('loginUsername').value.trim();$('forgotModal').classList.remove('hidden')};
$('sendResetBtn').onclick=async()=>{try{const d=await apiJson('/auth/forgot',{method:'POST',body:JSON.stringify({companyId:selectedCompany.id,username:$('forgotUsername').value.trim()})});$('forgotStep1').classList.add('hidden');$('forgotStep2').classList.remove('hidden');toast(d.emailConfigured?'Reset code sent.':'Reset request created, but email delivery is not configured yet.',4500)}catch(e){toast(e.message,4200)}};
$('resetPasswordBtn').onclick=async()=>{try{await apiJson('/auth/reset',{method:'POST',body:JSON.stringify({companyId:selectedCompany.id,username:$('forgotUsername').value.trim(),code:$('resetCode').value.trim(),newPassword:$('newPassword').value})});$('forgotModal').classList.add('hidden');toast('Company password changed.');openLogin(selectedCompany.id)}catch(e){toast(e.message,4200)}};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).classList.add('hidden'));

async function restoreSession(){session=loadSession();if(!session){showWelcome();return}if(!navigator.onLine){toast('Offline mode: using the last signed-in session.',3500);await enterCompany();return}try{const d=await apiJson('/auth/me');session=d.session;saveSession();await enterCompany()}catch(e){if(isNetworkError(e)){toast('Network unavailable. Opening cached company data.',3500);await enterCompany()}else{clearSession();showWelcome()}}}
async function enterCompany(){
  updateShell();
  await refreshUsers();
  if(!session.member){showMemberSelector();return}
  await Promise.all([refreshRoles(),refreshFields(),refreshExportColumns(),refreshRecords()]);
  renderStickyFields();
  showView('verifyView');
  if(navigator.onLine){await syncQueue();await refreshRecords()}
}
function showMemberSelector(){$('memberSelectList').innerHTML=users.filter(u=>u.active!==0).map(u=>`<button class="member-select-btn" data-member-select="${u.id}"><span>${escapeHtml(u.name)}</span><small>${escapeHtml(u.roleName||'Role')} · PIN protected</small></button>`).join('');$('memberSelectModal').classList.remove('hidden');document.querySelectorAll('[data-member-select]').forEach(b=>b.onclick=()=>requestMemberPin(b.dataset.memberSelect))}
$('closeMemberSelectBtn').onclick=()=>{$('memberSelectModal').classList.add('hidden');if(!session?.member){clearSession();showView('existingCompanyView');loadCompanies()}};
function requestMemberPin(id){if(!navigator.onLine){toast('Reconnect to the internet to switch team members and validate the PIN.',4200);return}selectedMemberForPin=users.find(u=>String(u.id)===String(id));if(!selectedMemberForPin)return;$('memberPinTitle').textContent=`Enter PIN for ${selectedMemberForPin.name}`;$('memberPinHint').textContent=`Role: ${selectedMemberForPin.roleName||'Member'}`;$('memberPinInput').value='';$('memberPinModal').classList.remove('hidden');setTimeout(()=>$('memberPinInput').focus(),50)}
async function selectMember(id,pin){try{const d=await apiJson('/auth/select-member',{method:'POST',body:JSON.stringify({memberId:id,pin})});session=d.session;saveSession();$('memberPinModal').classList.add('hidden');$('memberSelectModal').classList.add('hidden');updateShell();await Promise.all([refreshUsers(),refreshRoles(),refreshFields(),refreshExportColumns(),refreshRecords()]);renderStickyFields();showView('verifyView');syncQueue()}catch(e){toast(e.message,4200)}}
$('confirmMemberPinBtn').onclick=()=>{const pin=$('memberPinInput').value.trim();if(!/^\d{4,6}$/.test(pin)){toast('Enter your 4–6 digit member PIN.');return}if(selectedMemberForPin)selectMember(selectedMemberForPin.id,pin)};$('memberPinInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('confirmMemberPinBtn').click()});

// ---------- Dynamic fields ----------
function fieldDefaultValue(def){if(def.type==='number')return '';return ''}
function stickyKey(){return STICKY_PREFIX + session.company.id}
function loadSticky(){try{return JSON.parse(localStorage.getItem(stickyKey())||'{}')}catch{return {}}}
function saveStickyFromDom(){const out={};fields.sticky.forEach(f=>{const el=$(`sticky_${f.id}`);if(el)out[f.id]=el.value});localStorage.setItem(stickyKey(),JSON.stringify(out));return out}
function fieldInputHtml(def,value='',idPrefix='field'){const id=`${idPrefix}_${def.id}`;const val=escapeHtml(value??'');if(def.type==='textarea')return `<label class="dynamic-field">${escapeHtml(def.label)}<textarea id="${id}" rows="3">${val}</textarea></label>`;if(def.type==='select'){const opts=(def.options||[]).map(o=>`<option ${String(o)===String(value)?'selected':''}>${escapeHtml(o)}</option>`).join('');return `<label class="dynamic-field">${escapeHtml(def.label)}<select id="${id}"><option value=""></option>${opts}</select></label>`}if(def.type==='member'){const opts=users.filter(u=>u.active!==0).map(u=>`<option value="${u.id}" ${String(u.id)===String(value)?'selected':''}>${escapeHtml(u.name)}</option>`).join('');return `<label class="dynamic-field">${escapeHtml(def.label)}<select id="${id}"><option value=""></option>${opts}</select></label>`}return `<label class="dynamic-field">${escapeHtml(def.label)}<input id="${id}" type="${def.type==='number'?'number':'text'}" value="${val}" /></label>`}
function renderStickyFields(){const c=$('stickyFieldsContainer');if(!c)return;const vals=loadSticky();c.innerHTML=fields.sticky.map(f=>fieldInputHtml(f,vals[f.id]??fieldDefaultValue(f),'sticky')).join('')||'<div class="empty">No sticky fields configured.</div>';fields.sticky.forEach(f=>{const el=$(`sticky_${f.id}`);if(el)el.addEventListener('change',saveStickyFromDom)})}
function collectFieldValues(group,prefix){const defs=fields[group];const out={};defs.forEach(f=>{const el=$(`${prefix}_${f.id}`);if(el)out[f.id]=el.value});return out}
function renderVariableFields(containerId,values={},prefix='variable'){$(containerId).innerHTML=fields.variable.map(f=>fieldInputHtml(f,values[f.id]??(f.systemKey==='clickedBy'?session.member?.id:''),prefix)).join('')||'<div class="empty">No variable fields configured.</div>'}
function captureStickyValues(){return collectFieldValues('sticky','captureSticky')}
function saveCaptureStickyValues(){const values=captureStickyValues();localStorage.setItem(stickyKey(),JSON.stringify(values));return values}
function areCaptureStickyFieldsComplete(){if(!fields.sticky.length)return true;return fields.sticky.every(f=>{const el=$(`captureSticky_${f.id}`);return !!String(el?.value??'').trim()})}
function updateGuidedCaptureFlow(scrollWhenRevealed=false){if(!pendingRecord||!$('detailStep2'))return;const complete=areCaptureStickyFieldsComplete();const hint=$('stickyCompletionHint');if(complete){saveCaptureStickyValues();if(hint)hint.textContent=fields.sticky.length?'✓ Sticky Fields complete. Variable Fields are now available below.':'No Sticky Fields are configured. Variable Fields are available below.';const wasHidden=$('detailStep2').classList.contains('hidden');$('detailStep2').classList.remove('hidden');if(wasHidden&&scrollWhenRevealed)requestAnimationFrame(()=>$('detailStep2').scrollIntoView({behavior:'smooth',block:'start'}))}else{const missing=fields.sticky.filter(f=>!String($(`captureSticky_${f.id}`)?.value??'').trim()).map(f=>f.label);if(hint)hint.textContent=`Complete Sticky Fields to continue: ${missing.join(', ')}`;$('detailStep2').classList.add('hidden')}}
function renderCaptureStickyFields(overrides={}){const c=$('captureStickyFieldsContainer');if(!c)return;const vals={...loadSticky(),...overrides};c.innerHTML=fields.sticky.map(f=>fieldInputHtml(f,vals[f.id]??fieldDefaultValue(f),'captureSticky')).join('')||'<div class="empty">No sticky fields configured.</div>';fields.sticky.forEach(f=>{const el=$(`captureSticky_${f.id}`);if(!el)return;el.addEventListener('input',()=>updateGuidedCaptureFlow(true));el.addEventListener('change',()=>updateGuidedCaptureFlow(true))});updateGuidedCaptureFlow(false)}
function fieldLabelById(id){return [...fields.sticky,...fields.variable].find(f=>String(f.id)===String(id))?.label||id}

async function refreshFields(){if(!session?.member)return;try{const d=await apiJson('/fields');fields={sticky:d.sticky||[],variable:d.variable||[],allFields:d.allFields||[...(d.sticky||[]),...(d.variable||[])],schemaVersion:Number(d.schemaVersion||1)};await cacheSet('fields',fields);if(!$('mastersView').classList.contains('hidden'))renderMasters()}catch(e){const cached=await cacheGet('fields');if(cached)fields={sticky:cached.sticky||[],variable:cached.variable||[],allFields:cached.allFields||[...(cached.sticky||[]),...(cached.variable||[])],schemaVersion:Number(cached.schemaVersion||1)};else if(navigator.onLine)console.error(e);if(!$('mastersView').classList.contains('hidden'))renderMasters()}}
async function refreshExportColumns(){if(!session?.member)return;try{const d=await apiJson('/export-columns');exportColumns=d.columns||[];await cacheSet('exportColumns',exportColumns);if(!$('mastersView').classList.contains('hidden'))renderMasters()}catch(e){const cached=await cacheGet('exportColumns');if(cached)exportColumns=cached;else if(navigator.onLine)console.error(e)}}
function renderMasters(){const render=(list,group,target)=>{$(target).innerHTML=list.map(f=>`<div class="master-item"><div><strong>${escapeHtml(f.label)}</strong><small>${escapeHtml(f.type)} · schema ${Number(f.createdSchemaVersion||1)}${f.options?.length?` · ${escapeHtml(f.options.join(', '))}`:''}${f.systemKey?` · default: ${escapeHtml(f.systemKey)}`:''}</small></div><div class="master-actions">${hasPermission('masters.edit')?`<button class="secondary mini-btn" data-field-edit="${f.id}" data-field-group="${group}">Edit</button><button class="danger mini-btn" data-field-delete="${f.id}" data-field-group="${group}">Deactivate</button>`:''}</div></div>`).join('')||'<div class="empty">No fields configured.</div>'};render(fields.sticky,'sticky','stickyMasterList');render(fields.variable,'variable','variableMasterList');const ec=$('exportColumnMasterList');if(ec){ec.innerHTML=exportColumns.map(c=>`<div class="master-item"><div><strong>${escapeHtml(c.label)}</strong><small>${escapeHtml(c.key)}${c.locked?' · locked':''} · ${c.active?'Active':'Inactive for current schema'}</small></div><div class="master-actions">${c.locked?'<span class="pill">Required</span>':hasPermission('masters.edit')?`<button class="${c.active?'danger':'secondary'} mini-btn" data-export-column-toggle="${escapeHtml(c.key)}">${c.active?'Deactivate':'Activate'}</button>`:''}</div></div>`).join('')||'<div class="empty">No export columns configured.</div>'}document.querySelectorAll('[data-field-edit]').forEach(b=>b.onclick=()=>openFieldModal(b.dataset.fieldGroup,b.dataset.fieldEdit));document.querySelectorAll('[data-field-delete]').forEach(b=>b.onclick=()=>deleteField(b.dataset.fieldGroup,b.dataset.fieldDelete));document.querySelectorAll('[data-export-column-toggle]').forEach(b=>b.onclick=()=>toggleExportColumn(b.dataset.exportColumnToggle))}
async function toggleExportColumn(key){const col=exportColumns.find(c=>c.key===key);if(!col||col.locked)return;try{await apiJson(`/export-columns/${encodeURIComponent(key)}`,{method:'PUT',body:JSON.stringify({active:!col.active})});await Promise.all([refreshExportColumns(),refreshFields()]);renderMasters();toast(`${col.label} ${col.active?'deactivated':'activated'} for the current schema. Historical export columns remain preserved.`,4200)}catch(e){toast(e.message,4200)}}
$('addStickyFieldBtn').onclick=()=>openFieldModal('sticky');$('addVariableFieldBtn').onclick=()=>openFieldModal('variable');$('fieldType').onchange=()=>$('fieldOptionsWrap').classList.toggle('hidden',$('fieldType').value!=='select');
function openFieldModal(group,id=null){editingFieldGroup=group;editingField=id?fields[group].find(f=>String(f.id)===String(id)):null;$('fieldModalTitle').textContent=`${editingField?'Edit':'Add'} ${group==='sticky'?'Sticky':'Variable'} Field`;$('fieldLabel').value=editingField?.label||'';$('fieldType').value=editingField?.type||'text';$('fieldOptions').value=(editingField?.options||[]).join(', ');$('fieldOptionsWrap').classList.toggle('hidden',$('fieldType').value!=='select');$('fieldModal').classList.remove('hidden')}
$('saveFieldBtn').onclick=async()=>{const payload={group:editingFieldGroup,label:$('fieldLabel').value.trim(),type:$('fieldType').value,options:$('fieldType').value==='select'?$('fieldOptions').value.split(',').map(x=>x.trim()).filter(Boolean):[]};if(!payload.label){toast('Field label is required.');return}try{if(editingField)await apiJson(`/fields/${editingField.id}`,{method:'PUT',body:JSON.stringify(payload)});else await apiJson('/fields',{method:'POST',body:JSON.stringify(payload)});$('fieldModal').classList.add('hidden');await refreshFields();renderMasters();renderStickyFields();toast('Field master updated. Historical field versions remain preserved.')}catch(e){toast(e.message,4200)}};
async function deleteField(group,id){const f=fields[group].find(x=>String(x.id)===String(id));if(!confirm(`Delete field "${f?.label||id}"? Existing historical values remain stored but the field will no longer appear.`))return;try{await apiJson(`/fields/${id}`,{method:'DELETE'});await refreshFields();renderMasters();renderStickyFields();toast('Field deactivated. Its historical Excel column is preserved.')}catch(e){toast(e.message,4200)}}

// ---------- GPS (2.0: iOS-friendly automatic warm-up, always optional) ----------
let gpsWarmup = { startedAt: 0, best: null, watchId: null, promise: null, finish: null };

function gpsFromPosition(p){
  return {
    latitude:Number(p.coords.latitude).toFixed(7),
    longitude:Number(p.coords.longitude).toFixed(7),
    accuracy:Math.round(Number(p.coords.accuracy)||0),
    error:''
  };
}
function betterGps(a,b){
  if(!a)return b;
  if(!b)return a;
  const aa=Number(a.accuracy||999999),ba=Number(b.accuracy||999999);
  return ba<aa?b:a;
}
function stopGpsWatch(){
  if(gpsWarmup.watchId!==null&&navigator.geolocation){try{navigator.geolocation.clearWatch(gpsWarmup.watchId)}catch{}}
  gpsWarmup.watchId=null;
}
function primeGpsCapture(){
  if(!navigator.geolocation){gpsWarmup={startedAt:Date.now(),best:null,watchId:null,promise:Promise.resolve({latitude:'',longitude:'',accuracy:'',error:'Geolocation is not supported on this device.'}),finish:null};return gpsWarmup.promise}
  if(gpsWarmup.promise&&Date.now()-gpsWarmup.startedAt<30000)return gpsWarmup.promise;
  stopGpsWatch();
  gpsWarmup.startedAt=Date.now();gpsWarmup.best=null;
  gpsWarmup.promise=new Promise(resolve=>{
    let finished=false;
    const finish=(fallback='GPS unavailable')=>{
      if(finished)return;finished=true;stopGpsWatch();
      resolve(gpsWarmup.best||{latitude:'',longitude:'',accuracy:'',error:fallback});
    };
    gpsWarmup.finish=finish;
    const success=p=>{
      gpsWarmup.best=betterGps(gpsWarmup.best,gpsFromPosition(p));
      // A reasonably accurate fix is enough; otherwise keep watching for a better iPhone fix.
      if(Number(gpsWarmup.best.accuracy||9999)<=35)finish('');
    };
    const error=e=>{if(e?.code===1)finish('Location permission was denied. GPS is optional.');};
    try{
      gpsWarmup.watchId=navigator.geolocation.watchPosition(success,error,{enableHighAccuracy:true,maximumAge:0,timeout:20000});
      navigator.geolocation.getCurrentPosition(success,()=>{}, {enableHighAccuracy:true,maximumAge:0,timeout:12000});
      // Safari/iPhone can occasionally stall on high-accuracy. Ask for a network-assisted fix too.
      setTimeout(()=>{if(!finished)navigator.geolocation.getCurrentPosition(success,()=>{}, {enableHighAccuracy:false,maximumAge:0,timeout:9000})},4500);
      setTimeout(()=>finish('Location could not be determined. GPS is optional.'),22000);
    }catch(e){finish(e?.message||'GPS unavailable');}
  });
  return gpsWarmup.promise;
}

async function getCurrentGps(){
  const recent=Date.now()-gpsWarmup.startedAt<30000;
  if(recent&&gpsWarmup.promise)return gpsWarmup.promise;
  return primeGpsCapture();
}

async function captureGpsForPendingRecord(captureToken){
  if(!pendingRecord||pendingRecord.captureToken!==captureToken)return {latitude:'',longitude:'',accuracy:'',error:'Verification is no longer active.'};
  $('gpsNote').textContent='Detecting GPS automatically… On iPhone, allow location when Safari asks. You may continue without it.';
  const gps=await getCurrentGps();
  if(!pendingRecord||pendingRecord.captureToken!==captureToken)return gps;
  pendingRecord.gps=gps;
  if(!$('latitude').value.trim())$('latitude').value=gps.latitude||'';
  if(!$('longitude').value.trim())$('longitude').value=gps.longitude||'';
  if(!$('gpsAccuracy').value.trim())$('gpsAccuracy').value=gps.accuracy||'';
  $('gpsNote').textContent=gps.error
    ? `GPS not captured: ${gps.error} You can still save because location is optional.`
    : `GPS detected automatically with approximately ${gps.accuracy} m accuracy. Latitude / Longitude / Accuracy remain optional and editable.`;
  return gps;
}

function currentGpsFromForm(){return {latitude:$('latitude').value.trim(),longitude:$('longitude').value.trim(),accuracy:$('gpsAccuracy').value.trim()}}

// ---------- Image / asset rows ----------
function assetDefault(){return {rowId:uid(),assetName:'',quantity:1,condition:'Good',verificationStatus:'Found',notFoundReason:'',serialNumber:'',barcode:''}}
function statusClass(s){return s==='Found'?'found':s==='Not Found'?'notfound':'pending'}
function assetRowHtml(a={},edit=false){const p=edit?'e-':'';return `<div class="asset-row" data-row="${escapeHtml(a.rowId||uid())}"><div class="grid two"><label>Asset Name *<input class="${p}asset-name" value="${escapeHtml(a.assetName||a.name||'')}"></label><label>Quantity<input class="${p}qty" type="number" min="1" value="${Number(a.quantity)||1}"></label><label>Condition<select class="${p}condition">${CONDITIONS.map(x=>`<option ${x===a.condition?'selected':''}>${x}</option>`).join('')}</select></label><label>Found Status<select class="${p}status">${STATUSES.map(x=>`<option ${x===a.verificationStatus?'selected':''}>${x}</option>`).join('')}</select></label><label class="reason-wrap">Not Found Reason<select class="${p}reason">${NOT_FOUND_REASONS.map(x=>`<option ${x===a.notFoundReason?'selected':''}>${x}</option>`).join('')}</select></label><label>Serial Number<input class="${p}serial" value="${escapeHtml(a.serialNumber||'')}"></label><label>Barcode / QR / Asset Tag<input class="${p}barcode" value="${escapeHtml(a.barcode||'')}"></label></div><button type="button" class="remove-asset danger mini-btn">Remove</button></div>`}
function wireAssetRows(container){container.querySelectorAll('.remove-asset').forEach(b=>b.onclick=()=>b.closest('.asset-row').remove());container.querySelectorAll('select[class$="status"]').forEach(s=>{const sync=()=>{const w=s.closest('.asset-row').querySelector('.reason-wrap');w.classList.toggle('hidden',s.value!=='Not Found')};s.addEventListener('change',sync);sync()})}
function renderAssetRows(list,edit=false){const c=$(edit?'editAssetRows':'assetRows');c.innerHTML=(list?.length?list:[assetDefault()]).map(a=>assetRowHtml(a,edit)).join('');wireAssetRows(c)}
function collectAssetRows(edit=false){const p=edit?'e-':'';return [...$(edit?'editAssetRows':'assetRows').querySelectorAll('.asset-row')].map(r=>({rowId:r.dataset.row||uid(),assetName:r.querySelector(`.${p}asset-name`).value.trim(),quantity:Math.max(1,Number(r.querySelector(`.${p}qty`).value)||1),condition:r.querySelector(`.${p}condition`).value,verificationStatus:r.querySelector(`.${p}status`).value,notFoundReason:r.querySelector(`.${p}reason`).value,serialNumber:r.querySelector(`.${p}serial`).value.trim(),barcode:r.querySelector(`.${p}barcode`).value.trim()})).filter(a=>a.assetName)}
async function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)})}
async function compressPhoto(file){
  const src=await fileToDataUrl(file);
  const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('This image format could not be decoded on this device.'));i.src=src});
  let w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
  const maxDimension=1600,targetBytes=650*1024,minDimension=720;
  if(Math.max(w,h)>maxDimension){const scale=maxDimension/Math.max(w,h);w=Math.max(1,Math.round(w*scale));h=Math.max(1,Math.round(h*scale))}
  let quality=.80,blob=null;
  for(let pass=0;pass<12;pass++){
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('Image compression is unavailable on this browser.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
    blob=await new Promise(res=>canvas.toBlob(res,'image/jpeg',quality));
    if(!blob)throw new Error('Image compression failed.');
    if(blob.size<=targetBytes||Math.max(w,h)<=minDimension)break;
    if(quality>.48)quality-=.08;else{w=Math.max(1,Math.round(w*.86));h=Math.max(1,Math.round(h*.86));quality=.68}
  }
  return {dataUrl:await blobToDataUrl(blob),size:blob.size,width:w,height:h,compressed:true};
}
function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})}

function stickySnapshotText(sticky){return fields.sticky.map(f=>`${f.label}: ${sticky[f.id]||'—'}`).join(' · ')}
function setCaptureDateTime(iso){const d=new Date(iso);$('capturedDateInput').value=isoDateInput(d);$('capturedTimeInput').value=timeInput(d)}

$('takePhotoBtn').onclick=()=>{if(!hasPermission('verification.capture_photo'))return;appendPhotoMode=false;primeGpsCapture();$('cameraInput').click()};
$('uploadPhotoBtn').onclick=()=>{if(!hasPermission('verification.upload_gallery'))return;appendPhotoMode=false;primeGpsCapture();$('galleryInput').click()};
$('addCameraPhotoBtn').onclick=()=>{appendPhotoMode=true;primeGpsCapture();$('cameraInput').click()};
$('addGalleryPhotosBtn').onclick=()=>{appendPhotoMode=true;$('galleryInput').click()};
$('cameraInput').onchange=async e=>{const files=[...(e.target.files||[])];e.target.value='';if(appendPhotoMode)await appendPendingPhotos(files,'camera');else await preparePhotos(files,'camera')};
$('galleryInput').onchange=async e=>{const files=[...(e.target.files||[])];e.target.value='';if(appendPhotoMode)await appendPendingPhotos(files,'gallery');else await preparePhotos(files,'gallery')};

async function compressFiles(files,source){const list=[...(files||[])].filter(Boolean).slice(0,12);const out=[];for(const file of list){const c=await compressPhoto(file);out.push({id:uid(),dataUrl:c.dataUrl,size:c.size,name:file.name||'photo.jpg',source})}return out}
function renderPendingPhotoPreview(){const photos=pendingRecord?.photos||[];const has=photos.length>0;$('photoPreviewArea').classList.toggle('hidden',!has);$('photoPreview').classList.toggle('hidden',!has);if(has)$('photoPreview').src=photos[0].dataUrl;$('photoThumbs').innerHTML=photos.map((p,i)=>`<div class="photo-thumb ${i===0?'active':''}"><img src="${p.dataUrl}" alt="Photo ${i+1}"><button type="button" data-remove-pending-photo="${p.id}" aria-label="Remove photo">✕</button><span>${i+1}</span></div>`).join('');document.querySelectorAll('[data-remove-pending-photo]').forEach(b=>b.onclick=()=>{if(!pendingRecord)return;pendingRecord.photos=pendingRecord.photos.filter(p=>String(p.id)!==String(b.dataset.removePendingPhoto));const first=pendingRecord.photos[0];pendingRecord.dataUrl=first?.dataUrl||null;pendingRecord.size=pendingRecord.photos.reduce((n,p)=>n+(p.size||0),0);pendingRecord.photoName=first?.name||'';renderPendingPhotoPreview()})}
function openPendingDetailStep1(){
  $('detailModal').classList.remove('hidden');
  requestAnimationFrame(()=>{
    const sheet=$('detailModal').querySelector('.modal-sheet');
    if(sheet)sheet.scrollTop=0;
  });
  updateGuidedCaptureFlow(false);
}

async function preparePhotos(files,source){
  if(!files?.length)return;
  toast(`Preparing ${files.length} photo${files.length===1?'':'s'}…`,3500);
  try{
    // Compress first. Do not block the next step on GPS or AI.
    const photos=await compressFiles(files,source);
    if(!photos.length)return;
    const d=new Date(),first=photos[0],captureToken=uid();
    pendingRecord={
      captureToken,
      photos,
      dataUrl:first.dataUrl,
      size:photos.reduce((n,p)=>n+p.size,0),
      source,
      capturedAt:d.toISOString(),
      photoName:first.name,
      scanCode:'',
      gps:{latitude:'',longitude:'',accuracy:'',error:'GPS detection is in progress…'}
    };
    $('detailTitle').textContent=photos.length>1?`Review ${photos.length} photos`:'Review captured photo';
    renderPendingPhotoPreview();
    $('scanOnlyPreview').classList.add('hidden');
    $('retryAiBtn').classList.remove('hidden');
    setCaptureDateTime(d);
    $('latitude').value='';
    $('longitude').value='';
    $('gpsAccuracy').value='';
    $('gpsNote').textContent='GPS detection started automatically. Latitude, Longitude and GPS Accuracy are optional; you can save even if location is unavailable.';
    renderCaptureStickyFields();
    renderVariableFields('variableFieldsContainer',{},'variable');
    renderAssetRows([assetDefault()]);
    $('aiStatus').textContent=`${photos.length} photo${photos.length===1?'':'s'} ready (${bytesLabel(pendingRecord.size)}). AI analysis is running in the background.`;
    openPendingDetailStep1();

    pendingRecord.gpsPromise=captureGpsForPendingRecord(captureToken);

    runAi();
  }catch(e){
    console.error(e);
    toast('Could not prepare photo(s). Please try again.',4200);
  }
}
async function appendPendingPhotos(files,source){appendPhotoMode=false;if(!pendingRecord||!files?.length)return;try{toast(`Adding ${files.length} photo${files.length===1?'':'s'}…`,3500);const extra=await compressFiles(files,source);pendingRecord.photos=[...(pendingRecord.photos||[]),...extra].slice(0,12);const first=pendingRecord.photos[0];pendingRecord.dataUrl=first?.dataUrl||null;pendingRecord.size=pendingRecord.photos.reduce((n,p)=>n+(p.size||0),0);pendingRecord.photoName=first?.name||'';renderPendingPhotoPreview();$('aiStatus').textContent=`${pendingRecord.photos.length} photos attached. Re-run AI if you want all images analysed.`}catch(e){toast('Could not add photo(s).',4200)}}
async function runAi(){const photos=(pendingRecord?.photos||[]).filter(p=>p.dataUrl);if(!photos.length)return;const seq=++aiSeq;$('retryAiBtn').disabled=true;if(!navigator.onLine){$('aiStatus').textContent='Offline mode: AI identification will be available after reconnecting. Enter assets manually.';$('retryAiBtn').disabled=false;return}try{const merged=new Map();for(let i=0;i<photos.length;i++){if(seq!==aiSeq||!pendingRecord)return;$('aiStatus').textContent=`AI analysing image ${i+1} of ${photos.length}…`;const d=await apiJson('/ai',{method:'POST',body:JSON.stringify({image:photos[i].dataUrl})});for(const x of d.assets||[]){const key=String(x.name||'').trim().toLowerCase();if(!key)continue;const prior=merged.get(key);if(!prior||Number(x.quantity||1)>Number(prior.quantity||1))merged.set(key,{name:x.name,quantity:x.quantity||1})}}if(seq!==aiSeq||!pendingRecord)return;const list=[...merged.values()].map(x=>({...assetDefault(),assetName:x.name||'',quantity:x.quantity||1}));if(list.length){renderAssetRows(list);$('aiStatus').textContent=`AI analysed ${photos.length} image${photos.length===1?'':'s'} and detected ${list.length} asset type${list.length===1?'':'s'}. Verify and edit if required.`}else $('aiStatus').textContent='AI found no clear fixed asset. Add manually.'}catch(e){console.error(e);$('aiStatus').textContent='AI could not identify reliably. Enter assets manually.'}finally{$('retryAiBtn').disabled=false}}
$('retryAiBtn').onclick=runAi;
$('addAssetRowBtn').onclick=()=>{$('assetRows').insertAdjacentHTML('beforeend',assetRowHtml(assetDefault()));wireAssetRows($('assetRows'))};
$('discardPhotoBtn').onclick=()=>{pendingRecord=null;appendPhotoMode=false;aiSeq++;$('detailModal').classList.add('hidden')};

function clickedByFromVariable(variable){const f=fields.variable.find(x=>x.systemKey==='clickedBy');return f&&variable[f.id]?variable[f.id]:session.member.id}
$('savePhotoBtn').onclick=async()=>{
  if(!pendingRecord||!hasPermission('verification.save'))return;
  if(!areCaptureStickyFieldsComplete()){
    toast('Complete all Sticky Fields first. Variable Fields will then appear automatically.',4200);
    updateGuidedCaptureFlow(false);
    return;
  }

  // 2.0: GPS detection runs in the background and never blocks saving. Blank Latitude / Longitude / Accuracy are valid.

  const assets=collectAssetRows();
  if(!assets.length){
    toast('Enter at least one asset name.');
    return;
  }

  const sticky=saveCaptureStickyValues();
  const variable=collectFieldValues('variable','variable');
  const clientId=uid();
  const photos=(pendingRecord.photos||[]).map(p=>({
    dataUrl:p.dataUrl,
    name:p.name||'photo.jpg',
    source:p.source||pendingRecord.source,
    size:p.size||0
  }));

  const payload={
    clientId,
    photos,
    photo:photos[0]?.dataUrl||null,
    photoSize:photos.reduce((n,p)=>n+(p.size||0),0),
    photoName:photos[0]?.name||'',
    capturedAt:combineDateTime($('capturedDateInput').value,$('capturedTimeInput').value),
    source:pendingRecord.source,
    scanCode:pendingRecord.scanCode||'',
    latitude:$('latitude').value.trim(),
    longitude:$('longitude').value.trim(),
    gpsAccuracy:$('gpsAccuracy').value.trim(),
    sticky,
    variable,
    clickedByMemberId:clickedByFromVariable(variable),
    assets
  };

  try{
    if(!navigator.onLine)throw new TypeError('Offline');
    await apiJson('/records',{method:'POST',body:JSON.stringify(payload)});
    pendingRecord=null;
    $('detailModal').classList.add('hidden');
    await refreshRecords();
    toast('Verification saved. It is now included in Export Excel.',4200);
  }catch(e){
    if(isNetworkError(e)||!navigator.onLine){
      await queueOfflineAction('POST','/records',payload,buildOptimisticRecord(payload));
      pendingRecord=null;
      $('detailModal').classList.add('hidden');
      await refreshRecords();
      toast('Verification saved offline. It will sync automatically and then be available in Export Excel.',5000);
    }else{
      toast(e.message,4500);
    }
  }
};

// ---------- Scanner auto-fill helpers ----------
function normalizeScanKey(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'')}
function parseScanPayload(raw){
  const text=String(raw||'').trim();
  if(!text)return {raw:text,data:{},structured:false};
  try{const parsed=JSON.parse(text);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return {raw:text,data:parsed,structured:true}}catch{}
  try{
    const u=new URL(text);
    const data={};u.searchParams.forEach((v,k)=>data[k]=v);
    if(Object.keys(data).length)return {raw:text,data,structured:true};
  }catch{}
  const data={};
  for(const line of text.split(/[\n\r;]+/)){
    const m=line.match(/^\s*([^:=]+?)\s*[:=]\s*(.+?)\s*$/);
    if(m)data[m[1].trim()]=m[2].trim();
  }
  if(Object.keys(data).length)return {raw:text,data,structured:true};
  return {raw:text,data:{barcode:text},structured:false};
}
function scanValue(obj,keys){for(const key of keys){const target=normalizeScanKey(key);for(const [k,v] of Object.entries(obj||{})){if(normalizeScanKey(k)===target&&v!==undefined&&v!==null)return String(v)}}return ''}
function scanPayloadToAsset(parsed){
  const d=parsed.data||{};
  const assetName=scanValue(d,['assetName','asset','name','item','itemName','description']);
  const qty=Math.max(1,Number(scanValue(d,['quantity','qty','count']))||1);
  const condition=scanValue(d,['condition']);
  const status=scanValue(d,['verificationStatus','status','foundStatus']);
  const reason=scanValue(d,['notFoundReason','reason']);
  const serial=scanValue(d,['serialNumber','serial','srNo','serialNo']);
  const barcode=scanValue(d,['barcode','qr','qrCode','assetTag','tag','code','id'])||(!parsed.structured?parsed.raw:'');
  return {...assetDefault(),assetName,quantity:qty,condition:CONDITIONS.includes(condition)?condition:'Good',verificationStatus:STATUSES.includes(status)?status:'Found',notFoundReason:NOT_FOUND_REASONS.includes(reason)?reason:'',serialNumber:serial,barcode};
}
function scanDynamicValues(parsedList){
  const sticky={},variable={};
  const defs=[...(fields.sticky||[]),...(fields.variable||[])];
  const aliases=new Map();
  for(const f of defs){
    for(const key of [f.id,f.label,f.systemKey])if(key)aliases.set(normalizeScanKey(key),f);
  }
  for(const parsed of parsedList){
    for(const [key,value] of Object.entries(parsed.data||{})){
      const f=aliases.get(normalizeScanKey(key));
      if(!f)continue;
      const target=f.group==='variable'||fields.variable.some(x=>String(x.id)===String(f.id))?variable:sticky;
      target[f.id]=String(value??'');
    }
  }
  return {sticky,variable};
}

// ---------- Scan & Verify ----------
// 2.0.4 MOBILE DECODER ENGINE
// Live scanning is handled by @zxing/browser instead of html5-qrcode.
// Reason: html5-qrcode 2.3.8 can open the iPhone camera yet fail to decode
// codes on iOS. ZXing Browser reads directly from the live video stream and
// supports both QR and common 1D/2D barcode formats.
function renderScanCodes(){
  const manual=$('manualScanCode').value.trim();
  const all=[...new Set([...scanCodes,...(manual?[manual]:[])])];
  $('scanDetectedList').innerHTML=all.length
    ?all.map(c=>`<span class="scan-code-chip">${escapeHtml(c)}${scanCodes.includes(c)?`<button type="button" data-remove-scan="${escapeHtml(c)}">✕</button>`:''}</span>`).join('')
    :'<span class="muted">No codes captured yet.</span>';
  document.querySelectorAll('[data-remove-scan]').forEach(b=>b.onclick=()=>{
    scanCodes=scanCodes.filter(c=>c!==b.dataset.removeScan);
    renderScanCodes();
  });
}

$('scanVerifyBtn').onclick=()=>openScanner();
$('closeScannerBtn').onclick=closeScanner;
$('startScannerBtn').onclick=startScanner;
$('scanImageBtn').onclick=()=>$('scanImageInput').click();
$('manualScanCode').addEventListener('input',renderScanCodes);

function zxingResultText(result){
  if(!result)return '';
  if(typeof result.getText==='function')return String(result.getText()||'').trim();
  if(typeof result.text==='string')return result.text.trim();
  return String(result||'').trim();
}

function loadImageElement(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>resolve({img,url});
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Image could not be opened'))};
    img.src=url;
  });
}

$('scanImageInput').onchange=async e=>{
  const files=[...(e.target.files||[])];
  e.target.value='';
  if(!files.length)return;
  if(!window.ZXingBrowser?.BrowserMultiFormatReader){
    toast('Scanner decoder is unavailable. Reload the page and try again.');
    return;
  }
  scanEvidenceFiles=[...scanEvidenceFiles,...files].slice(0,12);
  let found=0;
  const reader=new ZXingBrowser.BrowserMultiFormatReader();
  for(const f of files){
    let item=null;
    try{
      item=await loadImageElement(f);
      const result=await reader.decodeFromImageElement(item.img);
      const code=zxingResultText(result);
      if(code&&!scanCodes.includes(code)){scanCodes.push(code);found++}
    }catch(error){
      console.debug('Image scan did not find a code:',error?.name||error?.message||error);
    }finally{
      if(item?.url)URL.revokeObjectURL(item.url);
    }
  }
  renderScanCodes();
  $('scanStatus').textContent=found
    ?`${found} new code${found===1?'':'s'} detected.`
    :'No readable QR / barcode found. Try a closer, sharper image.';
};

$('useScanCodeBtn').onclick=async()=>{
  const manual=$('manualScanCode').value.trim();
  const codes=[...new Set([...scanCodes,...(manual?[manual]:[])])];
  if(!codes.length){toast('Scan or enter at least one code first.');return}
  await closeScanner();
  await prepareScanRecord(codes,scanEvidenceFiles);
};

function openScanner(){
  if(!hasPermission('verification.scan'))return;
  scanCodes=[];
  scanEvidenceFiles=[];
  scannerAutoProceed=false;
  $('manualScanCode').value='';
  $('scanStatus').textContent='Tap Start Camera. Then keep the QR / barcode inside the frame until it is detected automatically.';
  renderScanCodes();
  $('qrReader').innerHTML='';
  $('scannerModal').classList.remove('hidden');
  $('startScannerBtn').textContent='Start Camera';
  $('startScannerBtn').disabled=false;
}

function isIOSDevice(){
  return /iPhone|iPad|iPod/i.test(navigator.userAgent||'') ||
    (navigator.platform==='MacIntel' && Number(navigator.maxTouchPoints||0)>1);
}

function cameraErrorMessage(error){
  const name=String(error?.name||'');
  const message=String(error?.message||'');
  if(name==='NotAllowedError'||name==='PermissionDeniedError'){
    return isIOSDevice()
      ?'Camera permission is blocked. In Safari open Website Settings for this site, set Camera to Allow, reload, and try again.'
      :'Camera permission is blocked. Allow Camera for this website in Chrome site settings, then try again.';
  }
  if(name==='NotFoundError'||name==='DevicesNotFoundError')return 'No usable camera was found on this device.';
  if(name==='NotReadableError'||name==='TrackStartError'||name==='AbortError')return 'The camera is busy. Close other camera apps/tabs, wait a few seconds, then try again.';
  if(name==='OverconstrainedError'||name==='ConstraintNotSatisfiedError')return 'Rear camera mode was not accepted by the browser.';
  if(name==='SecurityError')return 'The browser blocked camera access. Open PRS2 using its HTTPS GitHub Pages address.';
  return message||name||'Unknown camera error';
}

function handleScannerDecoded(decoded){
  const value=String(decoded||'').trim();
  if(!value||scannerAutoProceed)return;
  scannerAutoProceed=true;
  scanCodes=[value];
  $('manualScanCode').value=value;
  renderScanCodes();
  try{navigator.vibrate?.(100)}catch{}
  $('scanStatus').textContent=`Code detected: ${value}. Auto-filling verification fields…`;

  setTimeout(async()=>{
    try{
      await stopScanner({preserveStatus:true});
      $('scannerModal').classList.add('hidden');
      await prepareScanRecord([value],scanEvidenceFiles);
    }catch(error){
      console.error('Automatic scan continuation failed:',error);
      scannerAutoProceed=false;
      $('scanStatus').textContent='The code was read but the form could not open. Tap Use Code(s) & Verify.';
    }
  },80);
}

function buildScannerVideo(){
  const root=$('qrReader');
  root.innerHTML=`
    <div style="position:relative;width:100%;min-height:300px;background:#050914;border-radius:14px;overflow:hidden;">
      <video id="prsZxingVideo" playsinline webkit-playsinline autoplay muted
        style="display:block;width:100%;height:min(62vh,520px);object-fit:cover;background:#050914;"></video>
      <div style="position:absolute;left:10%;right:10%;top:24%;bottom:24%;border:3px solid rgba(255,255,255,.95);border-radius:18px;box-shadow:0 0 0 9999px rgba(0,0,0,.18);pointer-events:none;"></div>
      <div style="position:absolute;left:0;right:0;bottom:12px;text-align:center;color:white;font-size:13px;font-weight:700;text-shadow:0 1px 3px #000;pointer-events:none;">Keep the QR / barcode inside the box</div>
    </div>`;
  return $('prsZxingVideo');
}

async function improveMobileCamera(video){
  try{
    const stream=video?.srcObject;
    const track=stream?.getVideoTracks?.()[0];
    if(!track)return;
    const caps=track.getCapabilities?.()||{};

    // Continuous autofocus where the browser exposes it.
    if(Array.isArray(caps.focusMode)&&caps.focusMode.includes('continuous')){
      try{await track.applyConstraints({advanced:[{focusMode:'continuous'}]})}catch{}
    }

    // A small optical/digital zoom materially improves recognition of small
    // fixed-asset labels without requiring the user to move extremely close.
    if(caps.zoom&&Number.isFinite(caps.zoom.min)&&Number.isFinite(caps.zoom.max)&&caps.zoom.max>caps.zoom.min){
      const target=Math.min(caps.zoom.max,Math.max(caps.zoom.min,1.5));
      if(target>caps.zoom.min){
        try{await track.applyConstraints({advanced:[{zoom:target}]})}catch{}
      }
    }
  }catch(error){
    console.debug('Optional camera tuning unavailable:',error);
  }
}

async function startScanner(){
  if(scannerRunning){await stopScanner();return}
  if(!window.isSecureContext){
    $('scanStatus').textContent='Camera requires HTTPS. Open the PRS2 GitHub Pages website.';
    return;
  }
  if(!window.ZXingBrowser?.BrowserMultiFormatReader){
    toast('ZXing scanner decoder is unavailable. Reload the page and try again.',4200);
    return;
  }
  if(!navigator.mediaDevices?.getUserMedia){
    $('scanStatus').textContent='Live camera is unavailable. Use current Safari on iPhone or Chrome on Android.';
    return;
  }

  const button=$('startScannerBtn');
  button.disabled=true;
  button.textContent='Opening Camera…';
  $('scanStatus').textContent='Opening rear camera… allow Camera permission if prompted.';
  scannerAutoProceed=false;

  try{
    await stopScanner({preserveStatus:true});
    const video=buildScannerVideo();
    scanner=new ZXingBrowser.BrowserMultiFormatReader();

    // High-resolution rear-camera request improves small asset-tag decoding.
    // Width/height are ideals rather than hard requirements so older phones
    // can still choose a supported stream.
    const constraints={
      audio:false,
      video:{
        facingMode:{ideal:'environment'},
        width:{ideal:1920},
        height:{ideal:1080},
        frameRate:{ideal:30,max:30}
      }
    };

    scannerControls=await scanner.decodeFromConstraints(
      constraints,
      video,
      (result,error)=>{
        if(result){
          const value=zxingResultText(result);
          if(value)handleScannerDecoded(value);
        }else if(error){
          // NotFoundException is expected for most frames. Keep scanning.
          const name=String(error?.name||error?.constructor?.name||'');
          if(name&&!/NotFoundException|ChecksumException|FormatException/i.test(name)){
            console.debug('ZXing frame decode:',name,error?.message||'');
          }
        }
      }
    );

    scannerRunning=true;
    video.setAttribute('playsinline','');
    video.setAttribute('webkit-playsinline','');
    video.muted=true;
    try{await video.play()}catch{}
    await improveMobileCamera(video);

    button.disabled=false;
    button.textContent='Stop Camera';
    $('scanStatus').textContent='Camera is live and scanning continuously. Keep the full QR / barcode inside the white box for 1–2 seconds.';
  }catch(error){
    console.error('ZXing mobile scanner start failed:',error);
    scannerRunning=false;
    scannerAutoProceed=false;
    try{scannerControls?.stop?.()}catch{}
    scannerControls=null;
    scanner=null;
    $('qrReader').innerHTML='';
    button.disabled=false;
    button.textContent='Start Camera';
    $('scanStatus').textContent=`Camera scanner could not start. ${cameraErrorMessage(error)}`;
  }
}

async function stopScanner(options={}){
  const button=$('startScannerBtn');
  try{
    try{scannerControls?.stop?.()}catch{}
    const video=$('prsZxingVideo');
    const stream=video?.srcObject;
    if(stream?.getTracks){for(const track of stream.getTracks())try{track.stop()}catch{}}
  }finally{
    scannerRunning=false;
    scannerControls=null;
    scanner=null;
    $('qrReader').innerHTML='';
    if(button){button.disabled=false;button.textContent='Start Camera'}
    if(!options.preserveStatus&&!$('scannerModal').classList.contains('hidden')){
      $('scanStatus').textContent=scanCodes.length
        ?`${scanCodes.length} code${scanCodes.length===1?'':'s'} captured.`
        :'Camera stopped. Tap Start Camera to scan again.';
    }
  }
}

async function closeScanner(){
  scannerAutoProceed=false;
  await stopScanner();
  $('scannerModal').classList.add('hidden');
}

async function prepareScanRecord(codes,evidenceFiles=[]){
  toast('QR / barcode read. Auto-filling verification fields…',2800);
  try{
    const photos=await compressFiles(evidenceFiles,'scan-image');
    const d=new Date(),joined=codes.join(' | '),first=photos[0],captureToken=uid();
    const parsedCodes=codes.map(parseScanPayload);
    const mapped=scanDynamicValues(parsedCodes);
    const assets=parsedCodes.map(scanPayloadToAsset);
    pendingRecord={captureToken,photos,dataUrl:first?.dataUrl||null,size:photos.reduce((n,p)=>n+p.size,0),source:'scan',capturedAt:d.toISOString(),photoName:first?.name||'',scanCode:joined,gps:{latitude:'',longitude:'',accuracy:'',error:'GPS detection is in progress…'}};
    $('detailTitle').textContent=codes.length>1?`Scan & Verify · ${codes.length} codes`:'Scan & Verify Details';
    renderPendingPhotoPreview();
    $('scanOnlyPreview').classList.remove('hidden');
    $('scanOnlyCode').textContent=joined;
    $('retryAiBtn').classList.add('hidden');
    const filledCount=Object.keys(mapped.sticky).length+Object.keys(mapped.variable).length+assets.reduce((n,a)=>n+[a.assetName,a.serialNumber,a.barcode].filter(Boolean).length,0);
    $('aiStatus').textContent=filledCount
      ?`Scanner auto-filled ${filledCount} recognised value${filledCount===1?'':'s'}. Review before saving.`
      :'QR / barcode text captured and placed in Barcode / QR / Asset Tag automatically.';
    setCaptureDateTime(d);
    $('latitude').value='';$('longitude').value='';$('gpsAccuracy').value='';
    $('gpsNote').textContent='GPS detection starts after scanning. Latitude, Longitude and GPS Accuracy remain optional.';
    renderCaptureStickyFields(mapped.sticky);
    renderVariableFields('variableFieldsContainer',mapped.variable,'variable');
    renderAssetRows(assets.length?assets:[assetDefault()]);
    openPendingDetailStep1();
    updateGuidedCaptureFlow(false);
    // GPS starts only after camera is released, avoiding competing permission
    // prompts on iPhone Safari.
    pendingRecord.gpsPromise=captureGpsForPendingRecord(captureToken);
  }catch(e){
    console.error(e);
    scannerAutoProceed=false;
    toast('Could not prepare scan verification. Please try again.',4200);
  }
}

// ---------- Records ----------
async function refreshRecords(){if(!session?.member)return;let base=[];try{const d=await apiJson('/records');base=d.records||[];await cacheSet('records',base)}catch(e){base=(await cacheGet('records'))||[];if(!isNetworkError(e)&&navigator.onLine)console.error(e)}records=await applyQueueOverlay(base);renderRecent();populateFilters();if(!$('searchView').classList.contains('hidden'))renderSearch();updateSyncUi()}
function flattenAssets(){return records.flatMap(r=>(r.assets||[]).map(a=>({record:r,asset:a})))}
function canViewPhotos(){return hasPermission('verification.view_images')||hasPermission('verification.view')||hasPermission('records.export')}
function currentPhotoUrl(url){
  if(!url)return '';
  if(String(url).startsWith('data:image/'))return url;
  try{
    const u=new URL(url,WORKER_URL);
    if(session?.token)u.searchParams.set('access',session.token);
    u.searchParams.set('pv','20');
    return u.toString();
  }catch{return url}
}
function currentPhotoUrls(r){return (r?.photoUrls?.length?r.photoUrls:(r?.photoUrl?[r.photoUrl]:[])).map(currentPhotoUrl).filter(Boolean)}

function recordCard(r){const tags=(r.assets||[]).map(a=>`<span class="asset-tag ${statusClass(a.verificationStatus)}">${escapeHtml(a.assetName)} × ${a.quantity} · ${escapeHtml(a.condition)} · ${escapeHtml(a.verificationStatus)}</span>`).join('');const sticky=fields.sticky.map(f=>`${escapeHtml(f.label)}: ${escapeHtml(r.sticky?.[f.id]||'')}`).filter(x=>!x.endsWith(': ')).join(' · ');const gps=r.latitude&&r.longitude?`<span class="gps-chip">GPS ${escapeHtml(r.latitude)}, ${escapeHtml(r.longitude)}</span>`:'';const urls=currentPhotoUrls(r);const img=urls[0]&&canViewPhotos()?`<div class="record-photo-wrap"><img src="${escapeHtml(urls[0])}" alt="Verification photo" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.record-photo-wrap').classList.add('photo-load-error');this.alt='Photo could not be loaded';">${urls.length>1?`<span class="photo-count-badge">${urls.length} photos</span>`:''}</div>`:'';return `<article class="record ${img?'':'no-photo'} ${r.localPending?'local-pending':''}">${img}<div class="record-body">${r.localPending?'<span class="pending-sync-chip">Pending cloud sync</span>':''}<div class="record-source">${escapeHtml(r.source||'record')}</div><h3>${escapeHtml((r.assets?.[0]?.assetName)||r.scanCode||'Verification')}</h3><p>${sticky||'No sticky fields'}</p><p>${fmtDate(r.capturedAt)} ${fmtTime(r.capturedAt)} · By ${escapeHtml(r.clickedByName||'')}</p>${gps}${r.scanCode?`<p>Scanned Code(s): ${escapeHtml(r.scanCode)}</p>`:''}<div class="asset-tags">${tags}</div></div><div class="record-actions">${hasPermission('verification.edit')?`<button class="secondary mini-btn" data-edit-record="${r.id}">Edit</button>`:''}${hasPermission('verification.delete')?`<button class="danger mini-btn" data-delete-record="${r.id}">Delete</button>`:''}</div></article>`}
function renderRecent(){const list=records.slice().sort((a,b)=>new Date(b.capturedAt)-new Date(a.capturedAt));$('photoCount').textContent=list.length;$('assetCount').textContent=flattenAssets().length;$('recordsEmpty').classList.toggle('hidden',list.length>0);$('recordList').innerHTML=list.slice(0,50).map(recordCard).join('');wireRecordActions($('recordList'))}
function wireRecordActions(container){container.querySelectorAll('[data-edit-record]').forEach(b=>b.onclick=()=>openEditRecord(b.dataset.editRecord));container.querySelectorAll('[data-delete-record]').forEach(b=>b.onclick=()=>deleteRecord(b.dataset.deleteRecord))}
async function deleteRecord(id){if(!confirm('Delete this verification record and its stored photo?'))return;const local=records.find(r=>String(r.id)===String(id));if(local?.localPending&&local.clientId){await removePendingCreate(local.clientId);toast('Offline verification removed from this device.');await refreshRecords();return}try{if(!navigator.onLine)throw new TypeError('Offline');await apiJson(`/records/${id}`,{method:'DELETE'});toast('Record deleted.');await refreshRecords()}catch(e){if(isNetworkError(e)||!navigator.onLine){await queueOfflineAction('DELETE',`/records/${id}`,null,{id,deleted:true});toast('Delete queued. It will sync automatically.',4000);await refreshRecords()}else toast(e.message,4200)}}
function renderEditSticky(values){$('editStickyFields').innerHTML=fields.sticky.map(f=>fieldInputHtml(f,values?.[f.id]||'','editSticky')).join('')}
function openEditRecord(id){editingRecord=records.find(r=>String(r.id)===String(id));if(!editingRecord)return;const urls=currentPhotoUrls(editingRecord);if(urls.length){$('editPreview').src=urls[0];$('editPreview').classList.remove('hidden');$('editScanPreview').classList.add('hidden');$('editPhotoThumbs').innerHTML=urls.map((u,i)=>`<img src="${escapeHtml(u)}" data-edit-photo-thumb="${i}" class="${i===0?'active':''}" alt="Photo ${i+1}">`).join('');document.querySelectorAll('[data-edit-photo-thumb]').forEach(img=>img.onclick=()=>{$('editPreview').src=urls[Number(img.dataset.editPhotoThumb)];document.querySelectorAll('[data-edit-photo-thumb]').forEach(x=>x.classList.remove('active'));img.classList.add('active')})}else{$('editPreview').classList.add('hidden');$('editPhotoThumbs').innerHTML='';$('editScanPreview').classList.remove('hidden');$('editScanPreview').textContent=`Scanned Code(s): ${editingRecord.scanCode||'—'}`}renderEditSticky(editingRecord.sticky||{});renderVariableFields('editVariableFields',editingRecord.variable||{},'editVariable');const d=new Date(editingRecord.capturedAt);$('editCapturedDate').value=isoDateInput(d);$('editCapturedTime').value=timeInput(d);$('editLatitude').value=editingRecord.latitude||'';$('editLongitude').value=editingRecord.longitude||'';$('editGpsAccuracy').value=editingRecord.gpsAccuracy||'';renderAssetRows(editingRecord.assets||[],true);$('editRecordModal').classList.remove('hidden')}
$('editAddAssetBtn').onclick=()=>{$('editAssetRows').insertAdjacentHTML('beforeend',assetRowHtml(assetDefault(),true));wireAssetRows($('editAssetRows'))};$('saveRecordEditBtn').onclick=async()=>{if(!editingRecord)return;const assets=collectAssetRows(true);if(!assets.length){toast('At least one asset is required.');return}const sticky=collectFieldValues('sticky','editSticky'),variable=collectFieldValues('variable','editVariable'),payload={capturedAt:combineDateTime($('editCapturedDate').value,$('editCapturedTime').value),latitude:$('editLatitude').value.trim(),longitude:$('editLongitude').value.trim(),gpsAccuracy:$('editGpsAccuracy').value.trim(),sticky,variable,clickedByMemberId:clickedByFromVariable(variable),assets};if(editingRecord.localPending&&editingRecord.clientId){await updatePendingCreate(editingRecord.clientId,payload);$('editRecordModal').classList.add('hidden');toast('Offline verification updated.');await refreshRecords();return}try{if(!navigator.onLine)throw new TypeError('Offline');await apiJson(`/records/${editingRecord.id}`,{method:'PUT',body:JSON.stringify(payload)});$('editRecordModal').classList.add('hidden');toast('Record updated.');await refreshRecords()}catch(e){if(isNetworkError(e)||!navigator.onLine){const optimistic={...editingRecord,...payload,clickedByName:users.find(u=>String(u.id)===String(payload.clickedByMemberId))?.name||editingRecord.clickedByName,localPending:true};await queueOfflineAction('PUT',`/records/${editingRecord.id}`,payload,optimistic);$('editRecordModal').classList.add('hidden');toast('Changes saved offline and queued for sync.',4200);await refreshRecords()}else toast(e.message,4200)}};

// ---------- Search & filters ----------
function uniqueFieldVals(fieldId){return [...new Set(records.map(r=>r.sticky?.[fieldId]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)))}
function populateFilters(){$('dynamicFilters').innerHTML=fields.sticky.map(f=>`<label>${escapeHtml(f.label)}<select data-filter-field="${f.id}"><option value="">All ${escapeHtml(f.label)}</option>${uniqueFieldVals(f.id).map(v=>`<option>${escapeHtml(v)}</option>`).join('')}</select></label>`).join('');$('dynamicFilters').querySelectorAll('select').forEach(s=>s.addEventListener('change',renderSearch))}
function renderStatusTabs(){const rows=flattenAssets();const items=[['ALL','All',rows.length],['Found','Found',rows.filter(x=>x.asset.verificationStatus==='Found').length],['Not Found','Not Found',rows.filter(x=>x.asset.verificationStatus==='Not Found').length],['Pending','Pending',rows.filter(x=>x.asset.verificationStatus==='Pending').length],['IMAGES','📷 With Images',records.filter(r=>(r.photoUrls?.length||r.photoUrl)).length]];$('statusTabs').innerHTML=items.map(([k,l,n])=>`<button class="${activeStatus===k?'active':''}" data-status="${k}">${l} (${n})</button>`).join('');$('statusTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{activeStatus=b.dataset.status;renderSearch()})}
function searchFilteredRecords(){const q=$('searchText').value.trim().toLowerCase(),condition=$('filterCondition').value,filters=[...$('dynamicFilters').querySelectorAll('select')].map(s=>[s.dataset.filterField,s.value]).filter(x=>x[1]);return records.filter(r=>{for(const [id,v] of filters)if(String(r.sticky?.[id]||'')!==v)return false;if(activeStatus==='IMAGES'&&!(r.photoUrls?.length||r.photoUrl))return false;const assets=r.assets||[];const assetMatch=assets.some(a=>{if(condition&&a.condition!==condition)return false;if(activeStatus!=='ALL'&&activeStatus!=='IMAGES'&&a.verificationStatus!==activeStatus)return false;const hay=[a.assetName,a.serialNumber,a.barcode,a.condition,a.verificationStatus,a.notFoundReason,r.scanCode,r.latitude,r.longitude,r.clickedByName,...Object.values(r.sticky||{}),...Object.values(r.variable||{})].join(' ').toLowerCase();return !q||hay.includes(q)});return assetMatch||(!assets.length&&!q)})}
function renderSearch(){renderStatusTabs();const found=searchFilteredRecords();$('searchResults').innerHTML=found.map(recordCard).join('');$('searchEmpty').classList.toggle('hidden',found.length>0);wireRecordActions($('searchResults'))}
$('searchText').addEventListener('input',renderSearch);$('filterCondition').addEventListener('change',renderSearch);$('clearFiltersBtn').onclick=()=>{$('searchText').value='';$('filterCondition').value='';$('dynamicFilters').querySelectorAll('select').forEach(s=>s.value='');activeStatus='ALL';renderSearch()};

// ---------- Roles & permissions ----------
function roleById(id){return roles.find(r=>String(r.id)===String(id))||null}
function adminRole(){return roles.find(r=>String(r.systemKey||'').toUpperCase()==='ADMIN')||null}
function activeAdmins(){return users.filter(u=>u.active!==0&&String(u.roleSystemKey||'').toUpperCase()==='ADMIN')}
function wouldRemoveLastAdmin(targetRoleId,memberIds=[]){
  const target=roleById(targetRoleId),selected=new Set(memberIds.map(String)),admins=activeAdmins();
  if(!admins.length)return true;
  if(String(target?.systemKey||'').toUpperCase()==='ADMIN')return users.filter(u=>u.active!==0&&selected.has(String(u.id))).length<1;
  return admins.filter(u=>!selected.has(String(u.id))).length<1;
}
async function refreshRoles(){if(!session?.member)return;try{const d=await apiJson('/roles');roles=d.roles||[];await cacheSet('roles',roles)}catch(e){const cached=await cacheGet('roles');if(cached)roles=cached;else if(navigator.onLine)console.error(e)}if(!$('rolesView').classList.contains('hidden'))renderRoles();fillRoleSelects()}
function fillRoleSelects(){const opts=roles.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}${r.systemRole?' · System':''}</option>`).join('');$('userRole').innerHTML=opts}
function renderRoles(){$('roleCards').innerHTML=roles.map(r=>`<article class="role-card"><h3>${escapeHtml(r.name)}</h3><p>${escapeHtml(r.description||'')}</p><div class="role-meta"><span class="pill">${r.systemRole?'System':'Custom'}</span>${r.systemKey?`<span class="pill">${escapeHtml(r.systemKey)}</span>`:''}<span class="pill">${r.memberCount||0} member(s)</span><span class="pill">${r.permissions?.length||0} permission(s)</span></div><div class="role-actions">${hasPermission('roles.edit')?`<button class="secondary mini-btn" data-role-edit="${r.id}">Edit Role</button>`:''}${hasPermission('roles.delete')&&!r.systemRole?`<button class="danger mini-btn" data-role-delete="${r.id}">Delete</button>`:''}</div></article>`).join('');document.querySelectorAll('[data-role-edit]').forEach(b=>b.onclick=()=>openRoleModal(b.dataset.roleEdit));document.querySelectorAll('[data-role-delete]').forEach(b=>b.onclick=()=>deleteRole(b.dataset.roleDelete))}
$('createRoleBtn').onclick=()=>openRoleModal();
function openRoleModal(id=null){editingRole=id?roleById(id):null;$('roleModalTitle').textContent=editingRole?(editingRole.systemRole?`Edit System Role · ${editingRole.systemKey||''}`:'Edit Role'):'Create Role';$('roleName').value=editingRole?.name||'';$('roleDescription').value=editingRole?.description||'';const current=new Set(editingRole?.permissions||[]);$('permissionChecklist').innerHTML=PERMISSION_CATALOG.map(([code,label,desc])=>`<label class="permission-item"><input type="checkbox" value="${code}" ${current.has(code)?'checked':''}><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(desc)}</small></span></label>`).join('');const assigned=new Set(users.filter(u=>String(u.roleId)===String(editingRole?.id)).map(u=>String(u.id)));$('roleMemberAssignments').innerHTML=users.filter(u=>u.active!==0).map(u=>`<label class="assignment-item"><input type="checkbox" value="${u.id}" ${assigned.has(String(u.id))?'checked':''}>${escapeHtml(u.name)} <small>· ${escapeHtml(u.roleName||'Role')}</small></label>`).join('');$('roleModal').classList.remove('hidden')}
$('saveRoleBtn').onclick=async()=>{const name=$('roleName').value.trim(),description=$('roleDescription').value.trim(),permissions=[...$('permissionChecklist').querySelectorAll('input:checked')].map(x=>x.value),assignMembers=[...$('roleMemberAssignments').querySelectorAll('input:checked')].map(x=>x.value);if(!name){toast('Role name is required.');return}if(editingRole&&wouldRemoveLastAdmin(editingRole.id,assignMembers)){toast('At least one active Admin is compulsory. The last Admin cannot be reassigned.',4500);return}if(!editingRole&&activeAdmins().some(u=>assignMembers.includes(String(u.id)))&&activeAdmins().length===assignMembers.filter(id=>activeAdmins().some(u=>String(u.id)===String(id))).length){toast('At least one active Admin is compulsory. The last Admin cannot be moved to this role.',4500);return}if(!navigator.onLine){toast('Role changes require an internet connection.');return}const btn=$('saveRoleBtn');btn.disabled=true;const oldText=btn.textContent;btn.textContent='Saving…';try{const payload={name,description,permissions,assignMembers};const d=editingRole?await apiJson(`/roles/${editingRole.id}`,{method:'PUT',body:JSON.stringify(payload)}):await apiJson('/roles',{method:'POST',body:JSON.stringify(payload)});if(d.session){session=d.session;saveSession();updateShell()}$('roleModal').classList.add('hidden');await Promise.all([refreshRoles(),refreshUsers()]);renderRoles();renderUsers();toast('Role saved.')}catch(e){toast(e.message,4500)}finally{btn.disabled=false;btn.textContent=oldText}};
async function deleteRole(id){if(!navigator.onLine){toast('Role changes require an internet connection.');return}if(!confirm('Delete this custom role? It must not be assigned to any member.'))return;try{await apiJson(`/roles/${id}`,{method:'DELETE'});await refreshRoles();renderRoles();toast('Role deleted.')}catch(e){toast(e.message,4200)}}

// ---------- Team members ----------
async function refreshUsers(){if(!session)return;try{const d=await apiJson('/members');users=d.members||[];await cacheSet('users',users)}catch(e){const cached=await cacheGet('users');if(cached)users=cached;else if(navigator.onLine)console.error(e)}if(!$('usersView').classList.contains('hidden'))renderUsers()}
function renderUsers(){$('userCards').innerHTML=users.map(u=>`<article class="user-card"><div class="user-top"><div class="avatar">${escapeHtml((u.name||'?')[0].toUpperCase())}</div><div><h3>${escapeHtml(u.name)}</h3><span class="role-badge ${String(u.roleSystemKey||'').toUpperCase()==='ADMIN'?'admin':''}">${escapeHtml(u.roleName||'Role')}</span> ${u.roleSystemKey?`<span class="pin-status">${escapeHtml(u.roleSystemKey)}</span>`:'<span class="pin-status">PIN</span>'}</div></div><div class="user-stats"><div><strong>${u.photoCount||0}</strong><small>Records</small></div><div><strong>${u.assetCount||0}</strong><small>Asset rows</small></div></div><div class="user-actions">${hasPermission('members.edit')?`<button class="secondary mini-btn" data-user-edit="${u.id}">Edit</button>`:''}${hasPermission('members.delete')&&String(u.id)!==String(session.member?.id)?`<button class="danger mini-btn" data-user-delete="${u.id}">Delete</button>`:''}</div></article>`).join('');document.querySelectorAll('[data-user-edit]').forEach(b=>b.onclick=()=>openUserModal(b.dataset.userEdit));document.querySelectorAll('[data-user-delete]').forEach(b=>b.onclick=()=>deleteUser(b.dataset.userDelete))}
$('addUserBtn').onclick=()=>openUserModal();
function openUserModal(id=null){editingUser=id?users.find(u=>String(u.id)===String(id)):null;$('userModalTitle').textContent=editingUser?'Edit Team Member':'Add Team Member';$('userName').value=editingUser?.name||'';$('userPin').value='';fillRoleSelects();if(editingUser)$('userRole').value=editingUser.roleId;$('userModal').classList.remove('hidden')}
$('saveUserBtn').onclick=async()=>{const pin=$('userPin').value.trim();const payload={name:$('userName').value.trim(),roleId:$('userRole').value,...(pin?{pin}:{})};if(!payload.name||!payload.roleId){toast('Name and role are required.');return}if((!editingUser&&!/^\d{4,6}$/.test(pin))||(pin&&!/^\d{4,6}$/.test(pin))){toast('Member PIN must be 4–6 digits.');return}const selectedRole=roleById(payload.roleId);if(editingUser&&String(editingUser.roleSystemKey||'').toUpperCase()==='ADMIN'&&String(selectedRole?.systemKey||'').toUpperCase()!=='ADMIN'&&activeAdmins().length<=1){$('userRole').value=editingUser.roleId;toast('At least one active Admin is compulsory. The last Admin cannot be changed to another role.',4500);return}if(!navigator.onLine){toast('Team member changes require an internet connection.');return}const btn=$('saveUserBtn');btn.disabled=true;const oldText=btn.textContent;btn.textContent='Saving…';try{let d;if(editingUser)d=await apiJson(`/members/${editingUser.id}`,{method:'PUT',body:JSON.stringify(payload)});else d=await apiJson('/members',{method:'POST',body:JSON.stringify(payload)});if(d.session){session=d.session;saveSession();updateShell()}$('userModal').classList.add('hidden');await Promise.all([refreshUsers(),refreshRoles()]);renderUsers();renderRoles();toast('Team member saved.')}catch(e){toast(e.message,4200)}finally{btn.disabled=false;btn.textContent=oldText}};
async function deleteUser(id){const target=users.find(u=>String(u.id)===String(id));if(String(target?.roleSystemKey||'').toUpperCase()==='ADMIN'&&activeAdmins().length<=1){toast('At least one active Admin is compulsory. The last Admin cannot be deleted.',4500);return}if(!navigator.onLine){toast('Team member changes require an internet connection.');return}if(!confirm('Delete this team member? Historical records retain the saved Clicked By name.'))return;try{await apiJson(`/members/${id}`,{method:'DELETE'});await Promise.all([refreshUsers(),refreshRoles()]);renderUsers();renderRoles();toast('Team member deleted.')}catch(e){toast(e.message,4200)}}

// ---------- Company / usage ----------
function fillCompanyEdit(){$('editCompanyName').value=session.company.name;$('editCompanyStartDate').value=session.company.startDate;$('editCompanyCode').value=session.company.code;$('editCompanyUsername').value=session.company.username||'';$('editCompanyPassword').value=''}
$('saveCompanyBtn').onclick=async()=>{try{const d=await apiJson('/company',{method:'PUT',body:JSON.stringify({name:$('editCompanyName').value.trim(),startDate:$('editCompanyStartDate').value,username:$('editCompanyUsername').value.trim(),newPassword:$('editCompanyPassword').value})});session.company=d.company;saveSession();updateShell();toast('Company details updated.')}catch(e){toast(e.message,4200)}};
$('deleteCompanyBtn').onclick=async()=>{const name=session.company.name;if(prompt(`Type DELETE ${name} to permanently delete this company`)!==`DELETE ${name}`)return;try{await apiJson('/company',{method:'DELETE'});clearSession();showWelcome();toast('Company deleted.')}catch(e){toast(e.message,4200)}};
async function loadUsage(){try{const d=await apiJson('/usage');const pct=Math.min(100,(d.usedBytes/R2_FREE_BYTES)*100);$('usageText').textContent=`${bytesLabel(d.usedBytes)} of 10 GB`;$('usagePercent').textContent=`${pct.toFixed(2)}%`;$('usageBar').style.width=`${pct}%`;$('usagePhotos').textContent=d.photoCount;$('usageAssets').textContent=d.assetCount;$('usageBytes').textContent=bytesLabel(d.usedBytes)}catch(e){toast(e.message)}}

// ---------- Excel export 2.0: field history, 30 MB parts, persisted download history ----------
const MAX_XLSX_BYTES=30*1000*1000;
const EXPORT_SOFT_TARGET=23*1024*1024;
const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const exportPhotoCache=new Map();
let exportBusy=false;

async function urlToBase64(url){
  if(String(url).startsWith('data:image/'))return url;
  const target=currentPhotoUrl(url);
  if(exportPhotoCache.has(target))return exportPhotoCache.get(target);
  const promise=(async()=>{
    const r=await fetch(target,{headers:authHeaders(false),cache:'no-store',credentials:'omit'});
    if(!r.ok){let msg='';try{const d=await r.json();msg=d.error||''}catch{}throw new Error(msg||`Photo fetch failed (${r.status})`)}
    const blob=await r.blob();if(!String(blob.type||'').startsWith('image/'))throw new Error('Photo response was not an image');
    return blobToDataUrl(blob);
  })();
  exportPhotoCache.set(target,promise);
  try{return await promise}catch(e){exportPhotoCache.delete(target);throw e}
}
function fallbackExportColumns(){return [
  {key:'srNo',label:'Sr No',active:true,sortOrder:5},{key:'photo',label:'Photo',active:true,locked:true,sortOrder:10},{key:'photoCount',label:'Photo Count',active:true,sortOrder:20},{key:'company',label:'Company',active:true,sortOrder:30},
  {key:'latitude',label:'Latitude',active:true,sortOrder:40},{key:'longitude',label:'Longitude',active:true,sortOrder:50},{key:'gpsAccuracy',label:'GPS Accuracy (m)',active:true,sortOrder:60},
  {key:'source',label:'Source',active:true,sortOrder:70},{key:'scanCode',label:'Scanned Code(s)',active:true,sortOrder:80},{key:'assetName',label:'Asset Name',active:true,sortOrder:90},
  {key:'quantity',label:'Quantity',active:true,sortOrder:100},{key:'condition',label:'Condition',active:true,sortOrder:110},{key:'verificationStatus',label:'Found Status',active:true,sortOrder:120},
  {key:'notFoundReason',label:'Not Found Reason',active:true,sortOrder:130},{key:'serialNumber',label:'Serial Number',active:true,sortOrder:140},{key:'barcode',label:'Barcode / QR / Asset Tag',active:true,sortOrder:150},
  {key:'clickedBy',label:'Clicked By',active:true,sortOrder:160},{key:'date',label:'Date',active:true,sortOrder:170},{key:'time',label:'Time',active:true,sortOrder:180},{key:'schemaVersion',label:'Schema Version',active:true,sortOrder:190}
]}
function exportColumnList(all=true){const list=(exportColumns.length?exportColumns:fallbackExportColumns()).slice().sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));return all?list:list.filter(x=>x.active||x.locked)}
function uniqueFieldHeaders(defs){const counts=new Map();return defs.map(f=>{const base=String(f.label||'Field').trim()||'Field';const key=base.toLowerCase();const n=(counts.get(key)||0)+1;counts.set(key,n);const historical=!f.active||n>1;return {...f,exportHeader:historical?`${base} [schema ${Number(f.createdSchemaVersion||1)}]`:base}})}
function dynamicFieldValue(r,f){let v=(r.sticky&&r.sticky[f.id]!==undefined)?r.sticky[f.id]:(r.variable&&r.variable[f.id]!==undefined?r.variable[f.id]:'');if(f.type==='member'&&v)v=users.find(u=>String(u.id)===String(v))?.name||v;return v??''}
function standardExportValue(key,r,a){switch(key){case'photoCount':return currentPhotoUrls(r).length;case'company':return session.company.name;case'latitude':return r.latitude||'';case'longitude':return r.longitude||'';case'gpsAccuracy':return r.gpsAccuracy||'';case'source':return r.source||'';case'scanCode':return r.scanCode||'';case'assetName':return a?.assetName||'';case'quantity':return a?.quantity??'';case'condition':return a?.condition||'';case'verificationStatus':return a?.verificationStatus||'';case'notFoundReason':return a?.notFoundReason||'';case'serialNumber':return a?.serialNumber||'';case'barcode':return a?.barcode||'';case'clickedBy':return r.clickedByName||'';case'date':return fmtDate(r.capturedAt);case'time':return fmtTime(r.capturedAt);case'schemaVersion':return Number(r.schemaVersion||1);default:return ''}}
function roughRecordBytes(r,withPhotos){const rows=Math.max(1,(r.assets||[]).length);const photoBytes=withPhotos?Math.max(Number(r.photoSize||0),currentPhotoUrls(r).length*250000):0;return 6000+rows*2500+photoBytes*1.08}
function groupForExport(source,withPhotos){const groups=[];let cur=[],est=0;for(const r of source){const add=roughRecordBytes(r,withPhotos);if(cur.length&&est+add>EXPORT_SOFT_TARGET){groups.push(cur);cur=[];est=0}cur.push(r);est+=add}if(cur.length)groups.push(cur);return groups}
function workbookFileName(variant,partNo,totalParts=0){const v=variant==='with_photos'?'With_Photos':'Without_Photos';const suffix=totalParts>1?`_Part_${String(partNo).padStart(2,'0')}`:'';return `${session.company.code}_Physical_Verification_${v}_${isoDateInput(new Date())}${suffix}.xlsx`}

async function addVerificationSheet(wb,name,subset,{withPhotos=false,currentSchema=false}={}){
  const ws=wb.addWorksheet(name);
  const allDefs=uniqueFieldHeaders(currentSchema?[...(fields.sticky||[]),...(fields.variable||[])]:[...(fields.allFields||[])]);
  const standards=exportColumnList(!currentSchema).filter(c=>c.key!=='photo');
  const photoEnabled=withPhotos&&exportColumnList(!currentSchema).some(c=>c.key==='photo'&&(c.active||c.locked));
  const maxPhotos=photoEnabled?Math.min(12,Math.max(1,...subset.map(r=>currentPhotoUrls(r).length))):0;
  const photoCols=Array.from({length:maxPhotos},(_,i)=>({header:`Photo ${i+1}`,key:`photo_${i}`,width:24}));
  const stdCols=standards.map(c=>({header:c.label,key:`std_${c.key}`,width:['company','assetName','scanCode','barcode'].includes(c.key)?28:16,column:c}));
  const dynCols=allDefs.map((f,i)=>({header:f.exportHeader,key:`dyn_${i}`,width:20,field:f}));
  ws.columns=[...photoCols,...stdCols,...dynCols];
  ws.views=[{state:'frozen',ySplit:1}];ws.getRow(1).font={bold:true};ws.autoFilter={from:{row:1,column:1},to:{row:1,column:ws.columns.length}};
  let sr=0,rowNo=2,embedded=0,failed=0;
  for(const r of subset){
    const assets=(r.assets&&r.assets.length)?r.assets:[{}];
    let photoIds=[];
    if(photoEnabled){
      const urls=currentPhotoUrls(r).slice(0,maxPhotos);
      for(const u of urls){try{const data=await urlToBase64(u);const match=String(data).match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);if(!match)throw new Error('Unsupported image format');const ext=match[1].toLowerCase()==='png'?'png':'jpeg';photoIds.push(wb.addImage({base64:match[2],extension:ext}));embedded++}catch(e){console.error('Excel photo embed failed:',e);photoIds.push(null);failed++}}
    }
    for(let ai=0;ai<assets.length;ai++){
      const a=assets[ai];sr++;const obj={};standards.forEach(c=>obj[`std_${c.key}`]=c.key==='srNo'?sr:standardExportValue(c.key,r,a));allDefs.forEach((f,i)=>obj[`dyn_${i}`]=dynamicFieldValue(r,f));
      const row=ws.addRow(obj);row.height=photoEnabled&&ai===0?84:20;
      if(photoEnabled&&ai===0){photoIds.forEach((id,i)=>{if(id!==null)ws.addImage(id,{tl:{col:1+i,row:rowNo-1},ext:{width:145,height:100}})})}
      rowNo++;
    }
  }
  return {embedded,failed};
}
function addFieldHistorySheet(wb){
  const ws=wb.addWorksheet('Field History');
  ws.columns=[{header:'Field ID',key:'id',width:38},{header:'Group',key:'group',width:12},{header:'Label',key:'label',width:28},{header:'Type',key:'type',width:14},{header:'Status',key:'status',width:12},{header:'Created Schema',key:'createdSchema',width:16},{header:'Deactivated Schema',key:'deactivatedSchema',width:19},{header:'Created At',key:'createdAt',width:22},{header:'Deactivated At',key:'deactivatedAt',width:22}];
  ws.getRow(1).font={bold:true};
  for(const f of fields.allFields||[])ws.addRow({id:f.id,group:f.group||((fields.sticky||[]).some(x=>x.id===f.id)?'sticky':'variable'),label:f.label,type:f.type,status:f.active?'Active':'Historical',createdSchema:Number(f.createdSchemaVersion||1),deactivatedSchema:f.deactivatedSchemaVersion??'',createdAt:f.createdAt||'',deactivatedAt:f.deactivatedAt||''});
}
function addExportInfoSheet(wb,variant,subset){const ws=wb.addWorksheet('Export Info');ws.columns=[{header:'Item',key:'item',width:26},{header:'Value',key:'value',width:50}];ws.getRow(1).font={bold:true};[['Company',session.company.name],['Company Code',session.company.code],['Variant',variant==='with_photos'?'With Photos':'Without Photos'],['Exported At',new Date().toISOString()],['Record Count',subset.length],['Current Schema Version',Number(fields.schemaVersion||1)],['Maximum Excel Part Size','30 MB']].forEach(([item,value])=>ws.addRow({item,value}))}
async function buildWorkbookBuffer(subset,variant){
  const wb=new ExcelJS.Workbook();wb.creator='PRS.AssetVerify 2.0';wb.created=new Date();
  const withPhotos=variant==='with_photos';
  const stats=await addVerificationSheet(wb,'All Records',subset,{withPhotos,currentSchema:false});
  await addVerificationSheet(wb,'Current Schema',subset,{withPhotos:false,currentSchema:true});
  addFieldHistorySheet(wb);addExportInfoSheet(wb,variant,subset);
  const buffer=await wb.xlsx.writeBuffer();return {buffer,stats};
}
async function buildSizedParts(subset,variant){
  const groups=groupForExport(subset,variant==='with_photos'),parts=[];
  async function fit(group){
    const built=await buildWorkbookBuffer(group,variant);
    if(built.buffer.byteLength<=MAX_XLSX_BYTES){parts.push({records:group,buffer:built.buffer,size:built.buffer.byteLength,stats:built.stats});return}
    if(group.length<=1)throw new Error('A single verification record exceeds the 30 MB Excel limit even after image compression. Reduce the number of photos on that record.');
    const mid=Math.max(1,Math.floor(group.length/2));await fit(group.slice(0,mid));await fit(group.slice(mid));
  }
  for(const group of groups)await fit(group);
  return parts;
}
async function uploadExportPart(exportId,variant,partNo,fileName,buffer){
  const q=new URLSearchParams({variant,part:String(partNo),name:fileName});
  let r;try{r=await fetch(`${WORKER_URL}/exports/${encodeURIComponent(exportId)}/files?${q}`,{method:'POST',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':XLSX_MIME},body:buffer})}catch(e){throw new Error(navigator.onLine?'Could not upload the generated Excel part to Download History.':'You went offline while saving the export history.')}
  const text=await r.text();let d={};try{d=JSON.parse(text)}catch{}if(!r.ok)throw new Error(d.error||`Export upload failed (${r.status})`);return d.file;
}
function saveBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),3000)}
async function downloadBuffersTogether(parts,variant){
  if(parts.length===1){saveBlob(new Blob([parts[0].buffer],{type:XLSX_MIME}),parts[0].fileName);return}
  if(!window.JSZip)throw new Error('ZIP library is not loaded.');const zip=new JSZip();for(const p of parts)zip.file(p.fileName,p.buffer);const blob=await zip.generateAsync({type:'blob',compression:'STORE'});saveBlob(blob,`${session.company.code}_${variant==='with_photos'?'With_Photos':'Without_Photos'}_${isoDateInput(new Date())}.zip`)
}
async function generateExportSnapshot(preferredVariant){
  if(exportBusy)return;exportBusy=true;exportPhotoCache.clear();const progress=$('exportProgress');let exportId='';let completed=false;
  try{
    if(!navigator.onLine)throw new Error('Export history requires an internet connection.');
    if(!window.ExcelJS)throw new Error('Excel library is not loaded.');
    await Promise.all([refreshFields(),refreshExportColumns(),refreshRecords()]);
    if(!records.length)throw new Error('No records to export.');
    const start=await apiJson('/exports/start',{method:'POST',body:JSON.stringify({recordCount:records.length})});
    exportId=start.exportId;
    const order=preferredVariant==='without_photos'?['without_photos','with_photos']:['with_photos','without_photos'];
    const generated={with_photos:[],without_photos:[]};
    for(const variant of order){
      progress.textContent=`Building ${variant==='with_photos'?'export with photos':'export without photos'}…`;
      const built=await buildSizedParts(records.slice(),variant);
      for(let i=0;i<built.length;i++){
        const fileName=workbookFileName(variant,i+1,built.length);built[i].fileName=fileName;
        progress.textContent=`Saving ${variant==='with_photos'?'photo':'no-photo'} Excel part ${i+1} of ${built.length} to Download History…`;
        await uploadExportPart(exportId,variant,i+1,fileName,built[i].buffer);
      }
      generated[variant]=built;
    }
    await apiJson(`/exports/${encodeURIComponent(exportId)}/complete`,{method:'POST',body:'{}'});completed=true;
    progress.textContent='Both export variants are ready and stored in Download History.';
    await refreshDownloadHistory();
    await downloadBuffersTogether(generated[preferredVariant],preferredVariant);
    toast(`Export complete. Both variants are stored in Download History.`,5200);
    setTimeout(()=>$('exportModal').classList.add('hidden'),500);
  }catch(e){console.error(e);if(exportId&&!completed){try{await apiJson(`/exports/${encodeURIComponent(exportId)}`,{method:'DELETE'})}catch(cleanupError){console.warn('Export cleanup failed',cleanupError)}}progress.textContent=e.message||'Export failed.';toast(e.message||'Could not generate export.',5500)}finally{exportBusy=false}
}
$('exportBtn').onclick=()=>{if(!hasPermission('records.export'))return;if(!records.length){toast('No records to export.');return}$('exportProgress').textContent='Both variants will be generated and retained in Download History.';$('exportModal').classList.remove('hidden')};
$('exportWithPhotosBtn').onclick=()=>generateExportSnapshot('with_photos');
$('exportWithoutPhotosBtn').onclick=()=>generateExportSnapshot('without_photos');

async function refreshDownloadHistory(){
  if(!session?.member||!hasPermission('records.export'))return;
  try{const d=await apiJson('/exports');exportHistory=d.exports||[];renderDownloadHistory()}catch(e){toast(e.message||'Could not load download history.',4200)}
}
function renderDownloadHistory(){
  const c=$('downloadHistoryList'),empty=$('downloadHistoryEmpty');if(!c)return;
  empty.classList.toggle('hidden',exportHistory.length>0);
  c.innerHTML=exportHistory.map(job=>{const withCount=(job.files||[]).filter(f=>f.variant==='with_photos').length,noCount=(job.files||[]).filter(f=>f.variant==='without_photos').length;return `<article class="card download-history-item"><div><div class="eyebrow">${escapeHtml(fmtDate(job.createdAt))} · ${escapeHtml(fmtTime(job.createdAt))}</div><h3>${escapeHtml(job.memberName||'Member')} · ${Number(job.recordCount||0)} records</h3><p class="muted">Schema ${Number(job.schemaVersion||1)} · ${escapeHtml(job.status||'')}</p></div><div class="history-actions"><button class="primary mini-btn" data-history-download="${job.id}" data-history-variant="with_photos" ${withCount?'':'disabled'}>With Photos (${withCount})</button><button class="secondary mini-btn" data-history-download="${job.id}" data-history-variant="without_photos" ${noCount?'':'disabled'}>Without Photos (${noCount})</button></div></article>`}).join('');
  document.querySelectorAll('[data-history-download]').forEach(b=>b.onclick=()=>downloadHistoryVariant(b.dataset.historyDownload,b.dataset.historyVariant));
}
async function fetchStoredExportFile(jobId,file){
  const r=await fetch(`${WORKER_URL}/exports/${encodeURIComponent(jobId)}/file/${encodeURIComponent(file.id)}`,{headers:{Authorization:`Bearer ${session.token}`},cache:'no-store'});if(!r.ok){let d={};try{d=await r.json()}catch{}throw new Error(d.error||`Stored export download failed (${r.status})`)}return r.arrayBuffer();
}
async function downloadHistoryVariant(jobId,variant){
  const job=exportHistory.find(x=>String(x.id)===String(jobId));if(!job)return;const files=(job.files||[]).filter(f=>f.variant===variant).sort((a,b)=>a.partNo-b.partNo);if(!files.length){toast('This export variant has no stored files.');return}
  try{toast(`Preparing ${files.length} stored Excel file${files.length===1?'':'s'}…`,4000);if(files.length===1){const buf=await fetchStoredExportFile(jobId,files[0]);saveBlob(new Blob([buf],{type:XLSX_MIME}),files[0].fileName);return}if(!window.JSZip)throw new Error('ZIP library is not loaded.');const zip=new JSZip();for(let i=0;i<files.length;i++){const buf=await fetchStoredExportFile(jobId,files[i]);zip.file(files[i].fileName,buf)}const blob=await zip.generateAsync({type:'blob',compression:'STORE'});saveBlob(blob,`${session.company.code}_${variant==='with_photos'?'With_Photos':'Without_Photos'}_History_${isoDateInput(new Date(job.createdAt))}.zip`)}catch(e){toast(e.message||'Could not download stored export.',5000)}
}
$('refreshDownloadHistoryBtn').onclick=refreshDownloadHistory;

// ---------- Version 2.0 complete backup & restore ----------
$('downloadBackupBtn').onclick=async()=>{if(!hasPermission('backup.manage'))return;if(!navigator.onLine){toast('Reconnect to download a cloud backup.',3500);return}toast('Preparing complete company backup. Photos may take a moment…',6000);try{const d=await apiJson('/backup');const backup=d.backup;if(!backup)throw new Error('Backup data was not returned');const blob=new Blob([JSON.stringify(backup)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${session.company.code}_PRS_AssetVerify_Backup_${isoDateInput(new Date())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);toast('Complete company backup downloaded. Keep the file secure.',4500)}catch(e){toast(e.message||'Could not create backup.',4500)}};
$('restoreBackupBtn').onclick=async()=>{if(!hasPermission('backup.manage'))return;const file=$('restoreBackupInput').files?.[0];if(!file){toast('Select a PRS.AssetVerify backup JSON file first.');return}if(!navigator.onLine){toast('Restore requires an internet connection.');return}if(!confirm('Restore this backup? Current roles, members, masters, audit trail, records and photos in this company will be replaced. Company username/password and company code will remain unchanged.'))return;try{const backup=JSON.parse(await file.text());toast('Restoring backup and photos…',7000);const d=await apiJson('/restore',{method:'POST',body:JSON.stringify({backup})});session={...session,company:d.company||session.company,member:null};saveSession();roles=[];fields={sticky:[],variable:[],allFields:[],schemaVersion:1};exportColumns=[];exportHistory=[];records=[];await cacheSet('records',[]);await refreshUsers();$('restoreBackupInput').value='';updateShell();toast('Backup restored. Re-select a team member using the restored PIN.',5000);showMemberSelector()}catch(e){console.error(e);toast(e.message||'Restore failed.',5000)}};

// ---------- Offline database + automatic sync (2.0 isolated store) ----------
function openOfflineDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(OFFLINE_DB_NAME,OFFLINE_DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('cache'))db.createObjectStore('cache',{keyPath:'key'});if(!db.objectStoreNames.contains('queue')){const q=db.createObjectStore('queue',{keyPath:'id'});q.createIndex('companyId','companyId',{unique:false})}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function idbGet(store,key){const db=await openOfflineDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),req=tx.objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close()})}
async function idbPut(store,value){const db=await openOfflineDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>{db.close();resolve(value)};tx.onerror=()=>{db.close();reject(tx.error)}})}
async function idbDelete(store,key){const db=await openOfflineDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
async function idbAll(store){const db=await openOfflineDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),req=tx.objectStore(store).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close()})}
function companyCacheKey(type){return `${session?.company?.id||'none'}:${type}`}
async function cacheSet(type,value){if(!session?.company?.id)return;try{await idbPut('cache',{key:companyCacheKey(type),value,updatedAt:new Date().toISOString()})}catch(e){console.warn('Offline cache write failed',e)}}
async function cacheGet(type){if(!session?.company?.id)return null;try{return (await idbGet('cache',companyCacheKey(type)))?.value??null}catch{return null}}
function isNetworkError(e){const m=String(e?.message||e||'');return !navigator.onLine||e instanceof TypeError||/Failed to fetch|NetworkError|Load failed|Offline/i.test(m)}
async function companyQueue(){if(!session?.company?.id)return [];try{return (await idbAll('queue')).filter(x=>String(x.companyId)===String(session.company.id)).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt))}catch{return []}}
async function queueOfflineAction(method,path,payload,tempRecord){const item={id:uid(),companyId:session.company.id,memberId:session.member?.id||'',method,path,payload,tempRecord,createdAt:new Date().toISOString(),attempts:0,lastError:''};await idbPut('queue',item);await updateSyncUi();return item}
function buildOptimisticRecord(payload){const clicked=users.find(u=>String(u.id)===String(payload.clickedByMemberId)),urls=(payload.photos||[]).map(p=>p.dataUrl).filter(Boolean);if(!urls.length&&payload.photo)urls.push(payload.photo);return {id:`local-${payload.clientId}`,clientId:payload.clientId,photoName:payload.photoName||'',photoSize:payload.photoSize||0,photoUrl:urls[0]||'',photoUrls:urls,photoCount:urls.length,capturedAt:payload.capturedAt,createdAt:new Date().toISOString(),source:payload.source||'camera',scanCode:payload.scanCode||'',latitude:payload.latitude||'',longitude:payload.longitude||'',gpsAccuracy:payload.gpsAccuracy||'',sticky:payload.sticky||{},variable:payload.variable||{},clickedByUserId:payload.clickedByMemberId||'',clickedByName:clicked?.name||session.member?.name||'',assets:payload.assets||[],schemaVersion:Number(fields.schemaVersion||1),localPending:true}}
async function applyQueueOverlay(base){let out=(base||[]).map(x=>({...x}));const q=await companyQueue();for(const item of q){if(item.method==='POST'&&item.path==='/records'&&item.tempRecord){if(!out.some(r=>String(r.clientId)===String(item.tempRecord.clientId)))out.push({...item.tempRecord,localPending:true})}else if(item.method==='PUT'&&item.tempRecord){const i=out.findIndex(r=>String(r.id)===String(item.tempRecord.id));if(i>=0)out[i]={...out[i],...item.tempRecord,localPending:true}}else if(item.method==='DELETE'){const id=item.path.split('/').pop();out=out.filter(r=>String(r.id)!==String(id))}}return out}
async function removePendingCreate(clientId){const q=await companyQueue();for(const item of q)if(item.method==='POST'&&String(item.payload?.clientId)===String(clientId))await idbDelete('queue',item.id);await updateSyncUi()}
async function updatePendingCreate(clientId,changes){const q=await companyQueue(),item=q.find(x=>x.method==='POST'&&String(x.payload?.clientId)===String(clientId));if(!item)return;item.payload={...item.payload,...changes};item.tempRecord={...buildOptimisticRecord(item.payload),id:item.tempRecord?.id||`local-${clientId}`,createdAt:item.tempRecord?.createdAt||new Date().toISOString()};await idbPut('queue',item);await updateSyncUi()}
async function syncQueue(){if(syncRunning||!navigator.onLine||!session?.member)return;syncRunning=true;await updateSyncUi();let synced=0,failed=0;try{const q=await companyQueue();for(const item of q){try{const options={method:item.method};if(item.payload!==null&&item.payload!==undefined)options.body=JSON.stringify(item.payload);await apiJson(item.path,options);await idbDelete('queue',item.id);synced++}catch(e){if(isNetworkError(e))break;item.attempts=(item.attempts||0)+1;item.lastError=String(e.message||e);await idbPut('queue',item);failed++;if(/Authentication required|session expired/i.test(item.lastError))break}}}finally{syncRunning=false;await updateSyncUi()}if(synced){toast(`${synced} offline item${synced===1?'':'s'} synced to cloud.`,3500);try{const d=await apiJson('/records');await cacheSet('records',d.records||[])}catch{}}if(failed)toast(`${failed} queued item${failed===1?'':'s'} still need attention.`,4200)}
async function updateSyncUi(){const badge=$('syncBadge');if(!badge)return;badge.classList.remove('offline','pending','syncing');const count=(await companyQueue()).length;if(!navigator.onLine){badge.textContent=count?`Offline · ${count} pending`:'Offline';badge.classList.add('offline')}else if(syncRunning){badge.textContent=count?`Syncing ${count}…`:'Syncing…';badge.classList.add('syncing')}else if(count){badge.textContent=`${count} pending`;badge.classList.add('pending')}else badge.textContent='Cloud'}
function updateOfflineNotice(){const n=$('offlineNotice');if(n)n.classList.toggle('hidden',navigator.onLine)}

// ---------- Audit Trail ----------
async function refreshAudit(){if(!session?.member)return;try{const d=await apiJson('/audit?limit=300');auditEvents=d.events||[];await cacheSet('audit',auditEvents)}catch(e){auditEvents=(await cacheGet('audit'))||[];if(navigator.onLine&&!isNetworkError(e))toast(e.message,3500)}renderAudit()}
function auditDetailsText(details){if(!details||typeof details!=='object')return '';const parts=[];for(const [k,v] of Object.entries(details)){if(v===null||v===undefined||v==='')continue;let txt=typeof v==='object'?JSON.stringify(v):String(v);if(txt.length>260)txt=txt.slice(0,257)+'…';parts.push(`${k}: ${txt}`)}return parts.join(' · ')}
function renderAudit(){const q=$('auditSearch').value.trim().toLowerCase();const rows=auditEvents.filter(e=>{const hay=[e.action,e.entityType,e.entityId,e.memberName,auditDetailsText(e.details)].join(' ').toLowerCase();return !q||hay.includes(q)});$('auditList').innerHTML=rows.map(e=>`<article class="audit-event"><div class="audit-event-head"><div><span class="audit-action">${escapeHtml(String(e.action||'event').replaceAll('.',' · '))}</span><h3>${escapeHtml(e.memberName||'System')}</h3><p>${escapeHtml(e.entityType||'')} ${e.entityId?`· ${escapeHtml(e.entityId)}`:''}</p><p>${escapeHtml(auditDetailsText(e.details))}</p></div><div class="audit-meta">${fmtDate(e.createdAt)}<br>${fmtTime(e.createdAt)}</div></div></article>`).join('');$('auditEmpty').classList.toggle('hidden',rows.length>0)}
$('refreshAuditBtn').onclick=refreshAudit;$('auditSearch').addEventListener('input',renderAudit);$('clearAuditBtn').onclick=()=>{$('auditSearch').value='';renderAudit()};

// ---------- Visual viewport / always reachable close buttons ----------
function setupVisualViewport(){const update=()=>{const vv=window.visualViewport;document.documentElement.style.setProperty('--visual-viewport-height',`${Math.round(vv?.height||window.innerHeight)}px`);document.documentElement.style.setProperty('--visual-viewport-offset-top',`${Math.round(vv?.offsetTop||0)}px`)};update();window.addEventListener('resize',update);window.addEventListener('orientationchange',update);if(window.visualViewport){window.visualViewport.addEventListener('resize',update);window.visualViewport.addEventListener('scroll',update)}}

document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const visibleModal=[...document.querySelectorAll('.modal:not(.hidden)')].pop();if(visibleModal){if(visibleModal.id==='scannerModal'){closeScanner();return}if(visibleModal.id==='detailModal'){pendingRecord=null;aiSeq++;visibleModal.classList.add('hidden');return}if(visibleModal.id==='memberSelectModal'){ $('closeMemberSelectBtn').click(); return }visibleModal.classList.add('hidden');return}if(!$('drawer').classList.contains('hidden')){closeDrawer();return}if(!$('viewExitBtn').classList.contains('hidden'))$('viewExitBtn').click()});

async function health(){try{await fetch(WORKER_URL)}catch{}}
window.addEventListener('online',async()=>{updateOfflineNotice();await updateSyncUi();await syncQueue();await refreshRecords()});window.addEventListener('offline',()=>{updateOfflineNotice();updateSyncUi()});setupVisualViewport();health();restoreSession();if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.error));
