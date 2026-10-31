const firebaseConfig = {
  apiKey: "AIzaSyAGzMraQB5fYOEwwH-wDpPsQoxDk3wQEHs",
  authDomain: "gen-math-portal.firebaseapp.com",
  projectId: "gen-math-portal",
  storageBucket: "gen-math-portal.firebasestorage.app",
  messagingSenderId: "425391959827",
  appId: "1:425391959827:web:01db158e1b3536ae43b4e6",
  measurementId: "G-150VM9CW9K"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Only this exact Google account sees the Admin dashboard. Change it to YOUR email if needed.
const ADMIN_EMAILS = ["gaadrian2009@gmail.com", "darwintuibuen@gmail.com"];   // add more accounts here to give them the Admin tab
const isAdminEmail = e => !!e && ADMIN_EMAILS.indexOf(String(e).toLowerCase()) >= 0;

// Cloudinary handles actual file storage (Firebase Storage now requires billing to enable)
const CLOUDINARY_CLOUD_NAME = "n9stqvzo";
const CLOUDINARY_UPLOAD_PRESET = "gen_uploads";

/* ---------- DATA ---------- */
const modules = [];

/* ---------- NAV ---------- */
// Router state: the address bar (#hash) always says where the student is, so refreshing keeps them on the same screen.
let _routing = false, pendingAdminRoute = false;
const learnCtx = { level:null, family:null }, gameCtx = { level:null, family:null };

function goToPage(name, noSync){
  sketchResetMax();
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  if(name === 'admin') loadAdminDashboard();
  document.querySelectorAll('#navLinks button, #bottomNav button').forEach(b=>{
    b.classList.toggle('active', b.dataset.page===name);
  });
  if(!noSync) routeSync();
}
document.querySelectorAll('#navLinks button, #bottomNav button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const p = btn.dataset.page;
    if(p === 'home') goHome();
    else if(p === 'game') openGamePage();
    else goToPage(p);
  });
});

// Takes the student to the Home page, back to its first screen (works from any page or lesson)
function goHome(){
  goToPage('home', true);
  showWizardStep('welcome');
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ---------- AUTOMATIC PHONE / COMPUTER LAYOUT ---------- */
// No button needed: the page switches layout by itself.
// Phone layout  = narrow screens (or touch devices up to tablet size). Computer layout = everything else.
// It also reacts live when a window is resized or a phone is rotated.
const appEl = document.getElementById('app');
const phoneQuery = window.matchMedia('(max-width: 820px), (pointer: coarse) and (max-width: 1024px)');
function applyDeviceLayout(){
  appEl.classList.toggle('mobile-mode', phoneQuery.matches);
}
applyDeviceLayout();
if(phoneQuery.addEventListener) phoneQuery.addEventListener('change', applyDeviceLayout);
else phoneQuery.addListener(applyDeviceLayout);   // older browsers

/* ---------- MODULE CARDS ---------- */
function badgeClass(strand){ return strand; }
function renderModuleCard(m){
  return `<div class="module-card">
    <span class="badge ${badgeClass(m.strand)}">${m.badge}</span>
    <h4>${m.title}</h4>
    <p class="objective">${m.objective}</p>
    <div class="slide-preview"><span class="dot"></span> ${Math.floor(Math.random()*6)+8} slides uploaded</div>
    <div class="card-footer">
      <div class="progress-mini"><div class="fill" style="width:${m.progress}%;"></div></div>
    </div>
  </div>`;
}
const emptyModulesMsg = `<p style="color:var(--ink-soft); font-size:14px; grid-column:1/-1;">No modules yet — upload a lesson file above to create one.</p>`;
function renderAllModules(filter){
  const list = filter==='all' ? modules : modules.filter(m=>m.strand===filter);
  document.getElementById('allModules').innerHTML = list.map(renderModuleCard).join('') || emptyModulesMsg;
  document.getElementById('moduleCount').textContent = list.length+' modules';
}
renderAllModules('all');
document.querySelectorAll('#strandFilters button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#strandFilters button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderAllModules(btn.dataset.strand);
  });
});
/* ---------- REAL FILE UPLOAD (Firebase Storage + Firestore) ---------- */
function fileExtLabel(filename){
  const ext = filename.split('.').pop().toUpperCase();
  return ext === 'PPTX' ? 'PPT' : ext === 'DOCX' ? 'DOC' : ext;
}
function formatBytes(bytes){
  return (bytes / (1024*1024)).toFixed(1) + ' MB';
}

function renderUploads(files){
  document.getElementById('uploadList').innerHTML = files.length
    ? files.map(f=>`
    <div class="upload-row">
      <div class="file-icon">${fileExtLabel(f.name)}</div>
      <div class="meta">
        <a href="${f.url}" target="_blank" rel="noopener" class="name" style="color:var(--ink); text-decoration:none;">${f.name}</a>
        <div class="sub">${formatBytes(f.size)} · uploaded by ${f.uploadedBy || 'someone'}</div>
      </div>
      <span class="strand-tag">${f.strand}</span>
    </div>`).join('')
    : `<p style="color:var(--ink-soft); font-size:14px;">No files uploaded yet.</p>`;
}

// Live-updating list — refreshes automatically whenever anyone uploads a new file
db.collection('uploads').orderBy('uploadedAt', 'desc').onSnapshot(snapshot=>{
  const files = snapshot.docs.map(doc=>doc.data());
  renderUploads(files);
}, err=>{
  console.error('Could not load uploads:', err);
  renderUploads([]);
});

function uploadModuleFile(file){
  const statusMsg = document.getElementById('uploadStatusMsg');

  if(!currentUser){
    statusMsg.textContent = '⚠️ Please sign in with Google before uploading a file.';
    statusMsg.style.color = 'var(--orange-dark)';
    return;
  }

  const strand = document.getElementById('uploadStrandSelect').value;

  statusMsg.style.color = 'var(--ink-soft)';
  statusMsg.textContent = `Uploading "${file.name}"... 0%`;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  // Cloudinary rejects "&" and other special characters in folder paths
  function sanitizeFolderName(str){
    return str.replace(/&/g, 'and').replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  }
  formData.append('folder', `modules/${sanitizeFolderName(strand)}`);

  // Cloudinary treats PDFs as "image" resource type, everything else as "raw"
  const resourceType = file.name.toLowerCase().endsWith('.pdf') ? 'image' : 'raw';
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', endpoint, true);

  xhr.upload.onprogress = (e)=>{
    if(e.lengthComputable){
      const pct = Math.round((e.loaded / e.total) * 100);
      statusMsg.textContent = `Uploading "${file.name}"... ${pct}%`;
    }
  };

  xhr.onload = async ()=>{
    if(xhr.status < 200 || xhr.status >= 300){
      console.error(xhr.responseText);
      statusMsg.style.color = 'var(--orange-dark)';
      statusMsg.textContent = `Upload failed — check your Cloudinary cloud name/preset.`;
      return;
    }
    const data = JSON.parse(xhr.responseText);
    await db.collection('uploads').add({
      name: file.name,
      strand,
      size: file.size,
      url: data.secure_url,
      uploadedBy: currentUser.name,
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    statusMsg.style.color = '#1F8A6B';
    statusMsg.textContent = `✅ "${file.name}" uploaded to ${strand}.`;
  };

  xhr.onerror = ()=>{
    statusMsg.style.color = 'var(--orange-dark)';
    statusMsg.textContent = 'Upload failed — check your internet connection.';
  };

  xhr.send(formData);
}

function handleModuleFileUpload(event){
  const file = event.target.files[0];
  if(file) uploadModuleFile(file);
  event.target.value = '';
}

const dropZone = document.getElementById('dropZone');
['dragover','dragleave','drop'].forEach(evt=>{
  dropZone.addEventListener(evt, e=>{
    e.preventDefault();
    dropZone.classList.toggle('drag', evt==='dragover');
    if(evt==='drop' && e.dataTransfer.files.length){
      uploadModuleFile(e.dataTransfer.files[0]);
    }
  });
});
/* ---------- ACCORDION ---------- */
function toggleAccordion(headEl){
  headEl.parentElement.classList.toggle('open');
}

/* ---------- REAL GOOGLE SIGN-IN (FIREBASE) ---------- */
let currentUser = null;   // {uid, email, name}
let pendingFirebaseUser = null;

function getInitials(name){
  const parts = name.trim().split(/\s+/);
  return parts.length>1 ? (parts[0][0]+parts[1][0]).toUpperCase() : parts[0].slice(0,2).toUpperCase();
}

function signInWithGoogle(){
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err=>{
    console.error(err);
    alert("Sign-in didn't go through: " + err.message + "\n\n(Make sure this page is open at http://localhost, not opened directly as a file.)");
  });
}

function handleUserChipClick(){
  if(confirm("Sign out of BITS?")) auth.signOut();
}

function profileAction(){
  if(currentUser) auth.signOut();
  else signInWithGoogle();
}

/* ================= CLASS SECTION (ICT - 1 / ICT - 2) =================
   Students pick the class they belong to (Home page and Profile page). It is saved on their account as
   users/{uid}.classSection, so the Admin tab can group students by section and show each section's recent activity.
   To add another class later, just add it to this list, for example 'ICT - 3'. */
const CLASS_SECTIONS = ['ICT - 1', 'ICT - 2', 'Others'];
// The sections used to be called ICT - A and ICT - B. Students who already picked one of those are moved to the new name automatically.
const CLASS_LEGACY = { 'ICT - A':'ICT - 1', 'ICT - B':'ICT - 2' };
function classNormalize(v){ return Object.prototype.hasOwnProperty.call(CLASS_LEGACY, v) ? CLASS_LEGACY[v] : v; }
const CLASS_PENDING_KEY = 'bitsClassSectionPending';   // only used when a student picks BEFORE signing in
let classSection = null;

function classPendingGet(){ try{ const v = classNormalize(localStorage.getItem(CLASS_PENDING_KEY)); return CLASS_SECTIONS.indexOf(v) >= 0 ? v : null; }catch(_){ return null; } }
function classPendingSet(v){ try{ if(v) localStorage.setItem(CLASS_PENDING_KEY, v); else localStorage.removeItem(CLASS_PENDING_KEY); }catch(_){} }

// Computer icon used on the ICT class buttons (inline SVG so it follows the theme colors)
const CP_PC_ICON = '<svg class="cp-pc" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" focusable="false">'
  + '<rect class="pc-bezel" x="2.5" y="3.5" width="27" height="19" rx="4"/>'
  + '<rect class="pc-screen" x="5.2" y="6.2" width="21.6" height="13.6" rx="2.2"/>'
  + '<path class="pc-code" d="M12 10.6 9.2 13l2.8 2.4M20 10.6l2.8 2.4-2.8 2.4M17.3 9.9l-2.6 6.2"/>'
  + '<rect class="pc-stand" x="13.8" y="22.5" width="4.4" height="3"/>'
  + '<rect class="pc-base" x="9" y="25.4" width="14" height="3" rx="1.5"/>'
  + '</svg>';

function renderClassPickers(){
  document.querySelectorAll('.class-pick').forEach(box => {
    const opts = box.querySelector('.cp-options'), note = box.querySelector('.cp-note');
    box.classList.toggle('need', !classSection);
    if(opts) opts.innerHTML = CLASS_SECTIONS.map(label => {
      const on = label === classSection, isIct = label.indexOf(' - ') >= 0, letter = isIct ? CP_PC_ICON : '\u22EF';
      return `<button type="button" class="cp-opt ${on ? 'on' : ''}" role="radio" aria-checked="${on}" data-sec="${escapeHtml(label)}" onclick="setClassSection(this.dataset.sec)">
        <span class="cp-letter ${isIct ? 'cp-letter-pc' : ''}" aria-hidden="true">${isIct ? letter : escapeHtml(letter)}</span>
        <span class="cp-name">${escapeHtml(label)}</span>
        <span class="cp-check" aria-hidden="true">\u2713</span>
      </button>`;
    }).join('');
    if(note){
      note.classList.remove('err');
      note.textContent = !classSection ? ''
        : currentUser ? `\u2705 You are in ${classSection}. Picked the wrong one? Tap another section to change it, or tap it again to unselect.`
        : `You picked ${classSection}. Sign in with Google so your teacher can see your progress.`;
    }
  });
}

async function setClassSection(label){
  if(CLASS_SECTIONS.indexOf(label) < 0) return;
  // Tapping the section you already picked un-chooses it
  const clearing = (label === classSection), next = clearing ? null : label;
  const prev = classSection;
  classSection = next; renderClassPickers();
  if(!currentUser){ classPendingSet(next); return; }
  try{
    await db.collection('users').doc(currentUser.uid).set({ classSection: next, classSectionAt: Date.now() }, {merge:true});
    logActivity(clearing ? 'class_cleared' : 'class_selected', clearing ? `${prev} (cleared)` : (prev ? `${label} (was ${prev})` : label), { classSection: next });
  }catch(err){
    console.error(err);
    classSection = prev; renderClassPickers();
    document.querySelectorAll('.class-pick .cp-note').forEach(n => { n.textContent = 'Could not save your class section. Check your connection and try again.'; n.classList.add('err'); });
  }
}

// Called right after a student signs in: use the saved section, or save the one they picked before signing in.
function classSectionOnSignIn(data){
  const raw = data ? data.classSection : null, saved = CLASS_SECTIONS.indexOf(classNormalize(raw)) >= 0 ? classNormalize(raw) : null;
  const pending = classPendingGet();
  if(saved){
    classSection = saved; classPendingSet(null);
    // saved under the old name (ICT - A / ICT - B): quietly update the account so the teacher's Admin tab matches
    if(raw !== saved && currentUser) db.collection('users').doc(currentUser.uid).set({ classSection: saved }, {merge:true}).catch(console.error);
  }
  else if(pending){
    classSection = pending; classPendingSet(null);
    db.collection('users').doc(currentUser.uid).set({ classSection: pending, classSectionAt: Date.now() }, {merge:true})
      .then(() => logActivity('class_selected', pending, { classSection: pending })).catch(console.error);
  } else classSection = null;
  renderClassPickers();
}
function classSectionOnSignOut(){ classSection = classPendingGet(); renderClassPickers(); }

classSection = classPendingGet();
renderClassPickers();

// Fires automatically whenever sign-in state changes (page load, login, logout)
auth.onAuthStateChanged(async (user)=>{
  if(user){
    const docRef = db.collection('users').doc(user.uid);
    const snap = await docRef.get();
    if(!snap.exists){
      // first time signing in — ask what name to show
      pendingFirebaseUser = user;
      document.getElementById('modalEmailShown').textContent = user.email;
      document.getElementById('loginName').value = user.displayName || '';
      document.getElementById('loginError').classList.remove('show');
      document.getElementById('loginModalOverlay').classList.add('show');
    } else {
      const data = snap.data();
      currentUser = {uid:user.uid, email:user.email, name:data.displayName};
      const streak = await syncDailyStreak(user.uid, data);
      applySignedInUI(data.displayName, user.email, data.moduleProgress || {}, streak);

      // restore this account's saved theme + notification preference
      if(typeof data.themeIndex === 'number' && data.themeIndex !== themeIndex){
        applyThemeInstant(data.themeIndex);
      }
      document.getElementById('notifToggle').setAttribute('aria-checked', data.notificationsEnabled !== false);
      db.collection('users').doc(user.uid).set({lastSeenAt: Date.now()}, {merge:true}).catch(console.error);
      updateAdminAccess(user.email);
      classSectionOnSignIn(data);
      loadActiveDaysForUser(user.uid, data);
    }
  } else {
    currentUser = null;
    activeDays = new Set(); loadLocalDays(); markActiveToday();
    showSignedOutUI();
  }
});

// DAILY STREAK: a day counts as "active" when the student opens the app (or practices) that day.
// Using the app on consecutive days raises the streak by 1. Missing a whole day drops it back to 0
// (it starts again at 1 the next time they open the app). The streak is always worked out from the
// saved list of active days (users/{uid}.activeDays), so it can go up AND down.
async function syncDailyStreak(uid, data){
  const today = dayKey(new Date());
  activeDays = new Set(Array.isArray(data.activeDays) ? data.activeDays : []);
  activeDays.add(today);
  const streak = calcStreaks().current;
  try{
    await db.collection('users').doc(uid).set({
      activeDays: firebase.firestore.FieldValue.arrayUnion(today),
      streak, lastLoginTimestamp: Date.now()
    }, {merge:true});
  }catch(e){ console.error(e); }
  return streak;
}

async function confirmDisplayName(){
  const nameInput = document.getElementById('loginName').value.trim();
  const errorBox = document.getElementById('loginError');
  if(!nameInput){
    errorBox.classList.add('show');
    return;
  }
  const user = pendingFirebaseUser;
  await db.collection('users').doc(user.uid).set({
    displayName: nameInput,
    email: user.email,
    moduleProgress: {},
    streak: 1,
    activeDays: [dayKey(new Date())],
    lastLoginTimestamp: Date.now(),
    lastSeenAt: Date.now(),
    themeIndex: 0,
    notificationsEnabled: true,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }, {merge:true});

  currentUser = {uid:user.uid, email:user.email, name:nameInput};
  activeDays = new Set([dayKey(new Date())]);
  renderStreakCalendar();
  applySignedInUI(nameInput, user.email, {}, 1);
  document.getElementById('notifToggle').setAttribute('aria-checked', 'true');
  updateAdminAccess(user.email);
  classSectionOnSignIn({});
  document.getElementById('loginModalOverlay').classList.remove('show');
}

function applySignedInUI(displayName, email, moduleProgress, streak){
  const initials = getInitials(displayName);
  document.getElementById('googleSignInBtn').style.display = 'none';
  const chip = document.getElementById('userChip');
  chip.style.display = 'flex';
  document.getElementById('navAvatar').textContent = initials;
  document.getElementById('navUname').innerHTML = displayName + `<span class="sub">${email}</span>`;
  document.getElementById('greetingHeading').textContent = `Hey ${displayName}! Ready to keep your streak going?`;
  document.getElementById('profileAvatar').textContent = initials;
  document.getElementById('profileName').textContent = displayName;
  document.getElementById('profileEmail').textContent = email;
  document.getElementById('profileSignInBtn').textContent = 'Sign out';
  document.getElementById('editNameBtn').style.display = 'inline-block';

  document.getElementById('statStreak').textContent = streak;

  // apply this user's saved progress onto the shared module list, then re-render
  modules.forEach(m=>{
    if(moduleProgress[m.title] !== undefined) m.progress = moduleProgress[m.title];
  });
  renderAllModules(document.querySelector('#strandFilters button.active')?.dataset.strand || 'all');
}

function showSignedOutUI(){
  updateAdminAccess(null);
  classSectionOnSignOut();
  document.getElementById('googleSignInBtn').style.display = 'flex';
  document.getElementById('userChip').style.display = 'none';
  document.getElementById('greetingHeading').textContent = 'Fall in love with solving problems';
  document.getElementById('profileAvatar').textContent = '?';
  document.getElementById('profileName').textContent = 'Not signed in';
  document.getElementById('profileEmail').textContent = 'Sign in with Google to save your progress';
  document.getElementById('profileSignInBtn').textContent = 'Sign in with Google';
  document.getElementById('editNameBtn').style.display = 'none';
  cancelEditingName();
  document.getElementById('statStreak').textContent = '0';
  document.getElementById('notifToggle').setAttribute('aria-checked', 'true');
}

/* ---------- Edit display name ---------- */
function startEditingName(){
  if(!currentUser) return;
  document.getElementById('profileNameInput').value = currentUser.name;
  document.getElementById('profileNameDisplay').style.display = 'none';
  document.getElementById('profileNameEditRow').style.display = 'flex';
  document.getElementById('profileNameInput').focus();
}
function cancelEditingName(){
  document.getElementById('profileNameDisplay').style.display = 'flex';
  document.getElementById('profileNameEditRow').style.display = 'none';
}
async function saveEditedName(){
  const newName = document.getElementById('profileNameInput').value.trim();
  if(!newName || !currentUser) return;

  await db.collection('users').doc(currentUser.uid).set({displayName: newName}, {merge:true});
  currentUser.name = newName;

  const initials = getInitials(newName);
  document.getElementById('navAvatar').textContent = initials;
  document.getElementById('navUname').innerHTML = newName + `<span class="sub">${currentUser.email}</span>`;
  document.getElementById('profileAvatar').textContent = initials;
  document.getElementById('profileName').textContent = newName;
  document.getElementById('greetingHeading').textContent = `Hey ${newName}! Ready to keep your streak going?`;

  cancelEditingName();
}

// ----- Per-user persistence: module progress + quiz results -----
async function saveModuleProgress(title, progress){
  if(!currentUser) return;
  await db.collection('users').doc(currentUser.uid).set({
    moduleProgress: { [title]: progress }
  }, {merge:true});
}

/* ---------- THEME SWITCHER ---------- */
const themes = [
  { name:"Calm Teal", paper:"#FAF9F4", surface:"#EFF3EE", surface2:"#E4EEEA", ink:"#1E3A3A", inkSoft:"#4A6363", primary:"#3D8A8A", primaryDark:"#2C6666", accent:"#F2A65A", accentDark:"#D98A3D", yellow:"#FFD873", line:"#D8E0DA" },
  { name:"Coral Sunset", paper:"#FFF8F3", surface:"#FDEDE3", surface2:"#FCE1D0", ink:"#4A2E23", inkSoft:"#8C6952", primary:"#E8734A", primaryDark:"#C65934", accent:"#4AA8A8", accentDark:"#368585", yellow:"#FFDDA8", line:"#F0DCCB" },
  { name:"Violet Mint", paper:"#F8F6FC", surface:"#EDE8F8", surface2:"#E1D8F3", ink:"#2E2350", inkSoft:"#6F63A0", primary:"#7C5CD6", primaryDark:"#5F42B8", accent:"#3FBFA0", accentDark:"#2FA089", yellow:"#FFE066", line:"#DDD4F0" },
  { name:"Sunny Blue", paper:"#F5FAFF", surface:"#E8F2FC", surface2:"#D9EAFA", ink:"#133A5E", inkSoft:"#4C7A9E", primary:"#2E86DE", primaryDark:"#1F65AE", accent:"#F2A65A", accentDark:"#D98A3D", yellow:"#FFE38A", line:"#CFE3F5" },
  { name:"Rose Blush", paper:"#FFF5F7", surface:"#FDE8ED", surface2:"#FBDAE3", ink:"#4A1F2B", inkSoft:"#8C5568", primary:"#E0568C", primaryDark:"#B83E6E", accent:"#4FBFA0", accentDark:"#35A085", yellow:"#FFE08A", line:"#F5D5DE" },
  { name:"Forest Moss", paper:"#F6FAF3", surface:"#E9F3E1", surface2:"#DCECD0", ink:"#1E3620", inkSoft:"#5C7A5F", primary:"#5B8C3E", primaryDark:"#456B2E", accent:"#E8A33D", accentDark:"#C6862A", yellow:"#FFE38A", line:"#D3E5C6" },
  { name:"Midnight Indigo", paper:"#F4F5FB", surface:"#E7E9F7", surface2:"#D9DCF2", ink:"#1B1F3B", inkSoft:"#5B5F8A", primary:"#4A4FD6", primaryDark:"#3739AD", accent:"#3DC4D6", accentDark:"#2CA3B3", yellow:"#FFDD75", line:"#D5D8F0" }
];
let themeIndex = 0;

function applyTheme(t){
  const root = document.documentElement.style;
  root.setProperty('--paper', t.paper);
  root.setProperty('--surface', t.surface);
  root.setProperty('--surface-2', t.surface2);
  root.setProperty('--ink', t.ink);
  root.setProperty('--ink-soft', t.inkSoft);
  root.setProperty('--teal', t.primary);
  root.setProperty('--teal-dark', t.primaryDark);
  root.setProperty('--orange', t.accent);
  root.setProperty('--orange-dark', t.accentDark);
  root.setProperty('--yellow', t.yellow);
  root.setProperty('--line', t.line);
}

function cycleTheme(e){
  goToTheme((themeIndex + 1) % themes.length);
}

function selectTheme(index){
  if(index === themeIndex) return;
  goToTheme(index);
}

function goToTheme(targetIndex){
  const nextTheme = themes[targetIndex];

  // flowing-wave flourish on the logo icon
  const wave = document.getElementById('wavePath');
  wave.classList.remove('wave-spin');
  void wave.offsetWidth; // restart animation
  wave.classList.add('wave-spin');

  // ripple that expands from the logo and reveals the new palette
  const btn = document.getElementById('logoBtn');
  const rect = btn.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top + rect.height/2;
  const maxDist = Math.hypot(
    Math.max(cx, window.innerWidth - cx),
    Math.max(cy, window.innerHeight - cy)
  ) * 2.15;

  const ripple = document.createElement('div');
  ripple.className = 'theme-ripple';
  ripple.style.left = cx + 'px';
  ripple.style.top = cy + 'px';
  ripple.style.width = maxDist + 'px';
  ripple.style.height = maxDist + 'px';
  ripple.style.background = nextTheme.primary;
  document.body.appendChild(ripple);

  requestAnimationFrame(()=>{
    ripple.style.opacity = '0.9';
    ripple.style.transform = 'translate(-50%,-50%) scale(1)';
  });

  const appEl2 = document.getElementById('app');
  appEl2.classList.add('theme-transition');

  setTimeout(()=>{
    applyTheme(nextTheme);
    themeIndex = targetIndex;
    updateActiveSwatch();
    if(currentUser){
      db.collection('users').doc(currentUser.uid).set({themeIndex}, {merge:true}).catch(console.error);
    }
  }, 300);

  setTimeout(()=>{
    ripple.style.opacity = '0';
  }, 620);

  setTimeout(()=>{
    ripple.remove();
    appEl2.classList.remove('theme-transition');
  }, 1100);
}

// Instantly apply a theme with no ripple/animation — used when loading a signed-in user's saved preference
function applyThemeInstant(targetIndex){
  themeIndex = targetIndex;
  applyTheme(themes[targetIndex]);
  updateActiveSwatch();
}

function populateThemeSwatches(){
  const row = document.getElementById('themeSwatchRow');
  if(!row) return;
  row.innerHTML = themes.map((t,i)=>
    `<button class="theme-swatch" title="${t.name}" style="background:linear-gradient(135deg, ${t.primary}, ${t.accent});" onclick="selectTheme(${i})"></button>`
  ).join('');
  updateActiveSwatch();
}
function updateActiveSwatch(){
  document.querySelectorAll('.theme-swatch').forEach((el,i)=>{
    el.classList.toggle('active', i === themeIndex);
  });
}
populateThemeSwatches();

/* ---------- Notification toggle (real setting, persisted per account) ---------- */
function toggleNotifications(){
  const btn = document.getElementById('notifToggle');
  const newState = btn.getAttribute('aria-checked') !== 'true';
  btn.setAttribute('aria-checked', newState);
  if(currentUser){
    db.collection('users').doc(currentUser.uid).set({notificationsEnabled: newState}, {merge:true}).catch(console.error);
  }
}

/* ================= CUSTOM CURSOR — icon badge that morphs per target ================= */
(function initCustomCursor(){
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if(isTouchDevice){
    document.body.classList.add('no-custom-cursor');
    return;
  }
  document.body.classList.add('custom-cursor-active');

  const badge = document.getElementById('cursorBadge');
  const icon = document.getElementById('cursorIcon');

  // Original, simple line-icons (not copied from any reference) — one per state
  const ICONS = {
    default:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z"/></svg>',
    click:    '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="9" y="9" width="6" height="12" rx="3"/><circle cx="12" cy="6" r="3.2"/></svg>',
    upload:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 11l17-8-6 17-3-7-8-2z"/></svg>',
    drop:     '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 11l17-8-6 17-3-7-8-2z"/></svg>',
    cta:      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
    disabled: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>'
  };
  icon.innerHTML = ICONS.default;

  document.addEventListener('mousemove', (e)=>{
    // Direct 1:1 positioning — no easing, no pull toward elements, zero lag
    badge.style.left = e.clientX + 'px';
    badge.style.top = e.clientY + 'px';
  });

  // Selectors, checked in priority order (most specific first)
  const SEL_DISABLED = 'button:disabled, [aria-disabled="true"]';
  const SEL_TEXT     = 'textarea, input:not([type="file"])';
  const SEL_DROPZONE = '.lecture-upload-zone, .upload-zone';
  const SEL_CTA      = '.hero-cta';
  const SEL_CLICK    = 'button, a, select, .module-card, .lecture-card, .input-choice-card, .quiz-option, .theme-swatch, .toggle-switch, [onclick]';

  const STATE_CONFIG = [
    {selector: SEL_DISABLED, state: 'state-disabled', icon: ICONS.disabled},
    {selector: SEL_TEXT,     state: 'state-text',     icon: ''},
    {selector: SEL_DROPZONE, state: 'state-upload',   icon: ICONS.upload},
    {selector: SEL_CTA,      state: 'state-cta',      icon: ICONS.cta},
    {selector: SEL_CLICK,    state: 'state-click',    icon: ICONS.click},
  ];
  const ALL_STATES = STATE_CONFIG.map(c=>c.state).concat('state-drop');

  function setCursorState(config){
    ALL_STATES.forEach(s=> badge.classList.remove(s));
    if(config){
      badge.classList.add(config.state);
      icon.innerHTML = config.icon;
    } else {
      icon.innerHTML = ICONS.default;
    }
  }

  function matchState(target){
    for(const config of STATE_CONFIG){
      const el = target.closest(config.selector);
      if(el) return {config, el};
    }
    return null;
  }

  document.addEventListener('mouseover', (e)=>{
    const match = matchState(e.target);
    if(match) setCursorState(match.config);
  });
  document.addEventListener('mouseout', (e)=>{
    const stillInside = e.relatedTarget && matchState(e.relatedTarget);
    if(!stillInside) setCursorState(null);
  });

  // Dragging a file over any drop zone overrides everything with the "drop here" state
  document.querySelectorAll(SEL_DROPZONE).forEach(zone=>{
    zone.addEventListener('dragover', ()=>{
      ALL_STATES.forEach(s=> badge.classList.remove(s));
      badge.classList.add('state-drop');
      icon.innerHTML = ICONS.drop;
    });
    zone.addEventListener('dragleave', ()=>{
      if(zone.matches(':hover')) setCursorState({state:'state-upload', icon:ICONS.upload});
      else setCursorState(null);
    });
    zone.addEventListener('drop', ()=> setCursorState(null));
  });

  // Real expanding ripple on click, spawned at the exact click point
  document.addEventListener('mousedown', (e)=>{
    const ripple = document.createElement('div');
    ripple.className = 'click-ripple';
    ripple.style.left = e.clientX + 'px';
    ripple.style.top = e.clientY + 'px';
    document.body.appendChild(ripple);
    ripple.addEventListener('animationend', ()=> ripple.remove());
  });
})();

/*
  To swap in an image-based cursor later instead of this CSS/HTML one, you'd
  set it natively on the body, e.g.:
    body.custom-cursor-active { cursor: url("cursor.png") 12 12, auto !important; }
  and remove the `cursor:none` rule + the #cursorBadge element.
  Everything above is structured as a drop-in replacement for that.
*/

/* ================= HOME PAGE FLOW: Start Learning -> pick a level -> quiz ================= */
function showWizardStep(stepName){
  document.querySelectorAll('.wizard-step').forEach(s=>s.classList.remove('active'));
  document.getElementById('step-' + stepName).classList.add('active');
  routeSync();
}

// MINI GAME FORMAT (each topic has a `game:{ questions:[] }` slot):
//   { level:'easy'|'medium'|'hard', q:'Question text', num:'1011', from:2, to:10, answer:'11', solution:['Step 1 ...','Step 2 ...','Step 3 ...'] }
//   Students TYPE their answer. `num` is the number being converted (shown in the big conversion display),
//   `from` / `to` are the bases (2, 8, 10 or 16). Binary, octal and hex answers ignore leading zeros and upper/lower case.
//   Each question's `level` only changes the little difficulty tag. Add `levels:true` inside `game:{}` to show a difficulty picker instead.
//   `lesson:{}` on a topic is the "Quick lesson" card shown above the game (idea, steps, worked example, cheat sheet).
//   You can also add `cta:'your own call-to-action text'` inside `game:{}` to change the banner text.

// The three groups of conversions shown on the topic picker.
const BEGINNER_SRC = {
  beginner: {
    name: 'Beginner Level',
    short: 'Beginner',
    difficulty: 'easy',
    groups: [
      { label: "Binary and decimal", tone: 'a', topics: [
        { key:"bin-dec", title:"Binary to Decimal", sub:"Add up the place values", icon:"2→10", small:true,
          game:{ cta:"Think you can master Binary to Decimal? Answer every question, beat your best score, and tap Show solution whenever you're stuck!", questions:[
            // ---------- EASY (7 questions) ----------
            {"level": "easy", "q": "Convert this binary number to decimal.", "num": "101", "from": 2, "to": 10, "base": 10, "answer": "5", "solution": ["Write the place values above the bits, from left to right: 4, 2, 1.", "Keep only the place values that sit above a 1: 4, 1.", "Add them up: 4 + 1 = 5."]},
            {"level": "easy", "q": "Convert this binary number to decimal.", "num": "110", "from": 2, "to": 10, "base": 10, "answer": "6", "solution": ["Write the place values above the bits, from left to right: 4, 2, 1.", "Keep only the place values that sit above a 1: 4, 2.", "Add them up: 4 + 2 = 6."]},
            {"level": "easy", "q": "Convert this binary number to decimal.", "num": "111", "from": 2, "to": 10, "base": 10, "answer": "7", "solution": ["Write the place values above the bits, from left to right: 4, 2, 1.", "Keep only the place values that sit above a 1: 4, 2, 1.", "Add them up: 4 + 2 + 1 = 7."]},
            {"level": "easy", "q": "Convert this binary number to decimal.", "num": "1001", "from": 2, "to": 10, "base": 10, "answer": "9", "solution": ["Write the place values above the bits, from left to right: 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 8, 1.", "Add them up: 8 + 1 = 9."]},
            {"level": "easy", "q": "Convert this binary number to decimal.", "num": "1010", "from": 2, "to": 10, "base": 10, "answer": "10", "solution": ["Write the place values above the bits, from left to right: 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 8, 2.", "Add them up: 8 + 2 = 10."]},
            {"level": "easy", "q": "Convert this binary number to decimal.", "num": "1100", "from": 2, "to": 10, "base": 10, "answer": "12", "solution": ["Write the place values above the bits, from left to right: 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 8, 4.", "Add them up: 8 + 4 = 12."]},
            {"level": "easy", "q": "Convert this binary number to decimal.", "num": "1111", "from": 2, "to": 10, "base": 10, "answer": "15", "solution": ["Write the place values above the bits, from left to right: 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 8, 4, 2, 1.", "Add them up: 8 + 4 + 2 + 1 = 15."]},
            // ---------- MEDIUM (7 questions) ----------
            {"level": "medium", "q": "What is this binary number in decimal?", "num": "10010", "from": 2, "to": 10, "base": 10, "answer": "18", "solution": ["Write the place values above the bits, from left to right: 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 16, 2.", "Add them up: 16 + 2 = 18."]},
            {"level": "medium", "q": "What is this binary number in decimal?", "num": "10101", "from": 2, "to": 10, "base": 10, "answer": "21", "solution": ["Write the place values above the bits, from left to right: 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 16, 4, 1.", "Add them up: 16 + 4 + 1 = 21."]},
            {"level": "medium", "q": "What is this binary number in decimal?", "num": "11001", "from": 2, "to": 10, "base": 10, "answer": "25", "solution": ["Write the place values above the bits, from left to right: 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 16, 8, 1.", "Add them up: 16 + 8 + 1 = 25."]},
            {"level": "medium", "q": "What is this binary number in decimal?", "num": "11111", "from": 2, "to": 10, "base": 10, "answer": "31", "solution": ["Write the place values above the bits, from left to right: 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 16, 8, 4, 2, 1.", "Add them up: 16 + 8 + 4 + 2 + 1 = 31."]},
            {"level": "medium", "q": "What is this binary number in decimal?", "num": "100000", "from": 2, "to": 10, "base": 10, "answer": "32", "solution": ["Write the place values above the bits, from left to right: 32, 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 32.", "There is just one 1, so the answer is 32."]},
            {"level": "medium", "q": "What is this binary number in decimal?", "num": "101101", "from": 2, "to": 10, "base": 10, "answer": "45", "solution": ["Write the place values above the bits, from left to right: 32, 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 32, 8, 4, 1.", "Add them up: 32 + 8 + 4 + 1 = 45."]},
            {"level": "medium", "q": "What is this binary number in decimal?", "num": "110011", "from": 2, "to": 10, "base": 10, "answer": "51", "solution": ["Write the place values above the bits, from left to right: 32, 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 32, 16, 2, 1.", "Add them up: 32 + 16 + 2 + 1 = 51."]},
            // ---------- HARD (6 questions) ----------
            {"level": "hard", "q": "A computer stores the letter A as this byte. What decimal code is that?", "num": "01000001", "from": 2, "to": 10, "base": 10, "answer": "65", "solution": ["Write the place values above the bits, from left to right: 128, 64, 32, 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 64, 1.", "Add them up: 64 + 1 = 65."]},
            {"level": "hard", "q": "Convert this byte to decimal.", "num": "10101010", "from": 2, "to": 10, "base": 10, "answer": "170", "solution": ["Write the place values above the bits, from left to right: 128, 64, 32, 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 128, 32, 8, 2.", "Add them up: 128 + 32 + 8 + 2 = 170."]},
            {"level": "hard", "q": "Convert this byte to decimal.", "num": "11001000", "from": 2, "to": 10, "base": 10, "answer": "200", "solution": ["Write the place values above the bits, from left to right: 128, 64, 32, 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 128, 64, 8.", "Add them up: 128 + 64 + 8 = 200."]},
            {"level": "hard", "q": "Only the leftmost bit of this byte is on. What is its decimal value?", "num": "10000000", "from": 2, "to": 10, "base": 10, "answer": "128", "solution": ["Write the place values above the bits, from left to right: 128, 64, 32, 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 128.", "There is just one 1, so the answer is 128."]},
            {"level": "hard", "q": "Convert this byte to decimal.", "num": "11011011", "from": 2, "to": 10, "base": 10, "answer": "219", "solution": ["Write the place values above the bits, from left to right: 128, 64, 32, 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 128, 64, 16, 8, 2, 1.", "Add them up: 128 + 64 + 16 + 8 + 2 + 1 = 219."]},
            {"level": "hard", "q": "This is the biggest value one byte can hold. What is it in decimal?", "num": "11111111", "from": 2, "to": 10, "base": 10, "answer": "255", "solution": ["Write the place values above the bits, from left to right: 128, 64, 32, 16, 8, 4, 2, 1.", "Keep only the place values that sit above a 1: 128, 64, 32, 16, 8, 4, 2, 1.", "Add them up: 128 + 64 + 32 + 16 + 8 + 4 + 2 + 1 = 255."]},
          ] },
          lesson:{"title": "How to convert binary to decimal", "idea": "Every bit has a place value, and the values double as you move left: 1, 2, 4, 8, 16 and so on. Add up the place values of the bits that are 1.", "steps": ["Write the place values above the bits. Start with 1 on the far right and double each step to the left.", "Ignore the place values that sit above a 0.", "Add the place values that sit above a 1.", "The total is your decimal number."], "exTitle": "Example: convert 10110 to decimal", "exLines": ["Place values: 16, 8, 4, 2, 1", "Bits: 1, 0, 1, 1, 0", "Keep 16, 4 and 2 (the bits that are 1)", "16 + 4 + 2 = 22"], "exAnswer": "10110 in binary = 22 in decimal", "tip": "Memorize the powers of 2: 1, 2, 4, 8, 16, 32, 64, 128.", "ref": "place"},
          resources:[],
          focus:["adding place values of bits that are 1", "bytes up to 255"] },
        { key:"dec-bin", title:"Decimal to Binary", sub:"Divide by 2, read the remainders", icon:"10→2", small:true,
          game:{ cta:"Think you can master Decimal to Binary? Answer every question, beat your best score, and tap Show solution whenever you're stuck!", questions:[
            // ---------- EASY (7 questions) ----------
            {"level": "easy", "q": "Convert this decimal number to binary.", "num": "3", "from": 10, "to": 2, "base": 2, "answer": "11", "solution": ["Divide by 2 again and again, keeping each remainder: 3 ÷ 2 = 1 remainder 1; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 1.", "So 3 in binary is 11."]},
            {"level": "easy", "q": "Convert this decimal number to binary.", "num": "5", "from": 10, "to": 2, "base": 2, "answer": "101", "solution": ["Divide by 2 again and again, keeping each remainder: 5 ÷ 2 = 2 remainder 1; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 0 1.", "So 5 in binary is 101."]},
            {"level": "easy", "q": "Convert this decimal number to binary.", "num": "6", "from": 10, "to": 2, "base": 2, "answer": "110", "solution": ["Divide by 2 again and again, keeping each remainder: 6 ÷ 2 = 3 remainder 0; 3 ÷ 2 = 1 remainder 1; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 1 0.", "So 6 in binary is 110."]},
            {"level": "easy", "q": "Convert this decimal number to binary.", "num": "9", "from": 10, "to": 2, "base": 2, "answer": "1001", "solution": ["Divide by 2 again and again, keeping each remainder: 9 ÷ 2 = 4 remainder 1; 4 ÷ 2 = 2 remainder 0; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 0 0 1.", "So 9 in binary is 1001."]},
            {"level": "easy", "q": "Convert this decimal number to binary.", "num": "10", "from": 10, "to": 2, "base": 2, "answer": "1010", "solution": ["Divide by 2 again and again, keeping each remainder: 10 ÷ 2 = 5 remainder 0; 5 ÷ 2 = 2 remainder 1; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 0 1 0.", "So 10 in binary is 1010."]},
            {"level": "easy", "q": "Convert this decimal number to binary.", "num": "12", "from": 10, "to": 2, "base": 2, "answer": "1100", "solution": ["Divide by 2 again and again, keeping each remainder: 12 ÷ 2 = 6 remainder 0; 6 ÷ 2 = 3 remainder 0; 3 ÷ 2 = 1 remainder 1; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 1 0 0.", "So 12 in binary is 1100."]},
            {"level": "easy", "q": "Convert this decimal number to binary.", "num": "15", "from": 10, "to": 2, "base": 2, "answer": "1111", "solution": ["Divide by 2 again and again, keeping each remainder: 15 ÷ 2 = 7 remainder 1; 7 ÷ 2 = 3 remainder 1; 3 ÷ 2 = 1 remainder 1; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 1 1 1.", "So 15 in binary is 1111."]},
            // ---------- MEDIUM (7 questions) ----------
            {"level": "medium", "q": "What is this decimal number in binary?", "num": "18", "from": 10, "to": 2, "base": 2, "answer": "10010", "solution": ["Divide by 2 again and again, keeping each remainder: 18 ÷ 2 = 9 remainder 0; 9 ÷ 2 = 4 remainder 1; 4 ÷ 2 = 2 remainder 0; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 0 0 1 0.", "So 18 in binary is 10010."]},
            {"level": "medium", "q": "What is this decimal number in binary?", "num": "21", "from": 10, "to": 2, "base": 2, "answer": "10101", "solution": ["Divide by 2 again and again, keeping each remainder: 21 ÷ 2 = 10 remainder 1; 10 ÷ 2 = 5 remainder 0; 5 ÷ 2 = 2 remainder 1; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 0 1 0 1.", "So 21 in binary is 10101."]},
            {"level": "medium", "q": "What is this decimal number in binary?", "num": "25", "from": 10, "to": 2, "base": 2, "answer": "11001", "solution": ["Divide by 2 again and again, keeping each remainder: 25 ÷ 2 = 12 remainder 1; 12 ÷ 2 = 6 remainder 0; 6 ÷ 2 = 3 remainder 0; 3 ÷ 2 = 1 remainder 1; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 1 0 0 1.", "So 25 in binary is 11001."]},
            {"level": "medium", "q": "What is this decimal number in binary?", "num": "30", "from": 10, "to": 2, "base": 2, "answer": "11110", "solution": ["Divide by 2 again and again, keeping each remainder: 30 ÷ 2 = 15 remainder 0; 15 ÷ 2 = 7 remainder 1; 7 ÷ 2 = 3 remainder 1; 3 ÷ 2 = 1 remainder 1; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 1 1 1 0.", "So 30 in binary is 11110."]},
            {"level": "medium", "q": "What is this decimal number in binary?", "num": "33", "from": 10, "to": 2, "base": 2, "answer": "100001", "solution": ["Divide by 2 again and again, keeping each remainder: 33 ÷ 2 = 16 remainder 1; 16 ÷ 2 = 8 remainder 0; 8 ÷ 2 = 4 remainder 0; 4 ÷ 2 = 2 remainder 0; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 0 0 0 0 1.", "So 33 in binary is 100001."]},
            {"level": "medium", "q": "What is this decimal number in binary?", "num": "40", "from": 10, "to": 2, "base": 2, "answer": "101000", "solution": ["Divide by 2 again and again, keeping each remainder: 40 ÷ 2 = 20 remainder 0; 20 ÷ 2 = 10 remainder 0; 10 ÷ 2 = 5 remainder 0; 5 ÷ 2 = 2 remainder 1; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 0 1 0 0 0.", "So 40 in binary is 101000."]},
            {"level": "medium", "q": "What is this decimal number in binary?", "num": "45", "from": 10, "to": 2, "base": 2, "answer": "101101", "solution": ["Divide by 2 again and again, keeping each remainder: 45 ÷ 2 = 22 remainder 1; 22 ÷ 2 = 11 remainder 0; 11 ÷ 2 = 5 remainder 1; 5 ÷ 2 = 2 remainder 1; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 0 1 1 0 1.", "So 45 in binary is 101101."]},
            // ---------- HARD (6 questions) ----------
            {"level": "hard", "q": "Convert this decimal number to binary.", "num": "64", "from": 10, "to": 2, "base": 2, "answer": "1000000", "solution": ["Divide by 2 again and again, keeping each remainder: 64 ÷ 2 = 32 remainder 0; 32 ÷ 2 = 16 remainder 0; 16 ÷ 2 = 8 remainder 0; 8 ÷ 2 = 4 remainder 0; 4 ÷ 2 = 2 remainder 0; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 0 0 0 0 0 0.", "So 64 in binary is 1000000."]},
            {"level": "hard", "q": "Convert this decimal number to binary.", "num": "100", "from": 10, "to": 2, "base": 2, "answer": "1100100", "solution": ["Divide by 2 again and again, keeping each remainder: 100 ÷ 2 = 50 remainder 0; 50 ÷ 2 = 25 remainder 0; 25 ÷ 2 = 12 remainder 1; 12 ÷ 2 = 6 remainder 0; 6 ÷ 2 = 3 remainder 0; 3 ÷ 2 = 1 remainder 1; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 1 0 0 1 0 0.", "So 100 in binary is 1100100."]},
            {"level": "hard", "q": "Convert this decimal number to binary.", "num": "128", "from": 10, "to": 2, "base": 2, "answer": "10000000", "solution": ["Divide by 2 again and again, keeping each remainder: 128 ÷ 2 = 64 remainder 0; 64 ÷ 2 = 32 remainder 0; 32 ÷ 2 = 16 remainder 0; 16 ÷ 2 = 8 remainder 0; 8 ÷ 2 = 4 remainder 0; 4 ÷ 2 = 2 remainder 0; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 0 0 0 0 0 0 0.", "So 128 in binary is 10000000."]},
            {"level": "hard", "q": "Convert this decimal number to binary.", "num": "150", "from": 10, "to": 2, "base": 2, "answer": "10010110", "solution": ["Divide by 2 again and again, keeping each remainder: 150 ÷ 2 = 75 remainder 0; 75 ÷ 2 = 37 remainder 1; 37 ÷ 2 = 18 remainder 1; 18 ÷ 2 = 9 remainder 0; 9 ÷ 2 = 4 remainder 1; 4 ÷ 2 = 2 remainder 0; 2 ÷ 2 = 1 remainder 0; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 0 0 1 0 1 1 0.", "So 150 in binary is 10010110."]},
            {"level": "hard", "q": "Convert this decimal number to binary.", "num": "200", "from": 10, "to": 2, "base": 2, "answer": "11001000", "solution": ["Divide by 2 again and again, keeping each remainder: 200 ÷ 2 = 100 remainder 0; 100 ÷ 2 = 50 remainder 0; 50 ÷ 2 = 25 remainder 0; 25 ÷ 2 = 12 remainder 1; 12 ÷ 2 = 6 remainder 0; 6 ÷ 2 = 3 remainder 0; 3 ÷ 2 = 1 remainder 1; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 1 0 0 1 0 0 0.", "So 200 in binary is 11001000."]},
            {"level": "hard", "q": "This is the biggest value one byte can hold. Write it in binary.", "num": "255", "from": 10, "to": 2, "base": 2, "answer": "11111111", "solution": ["Divide by 2 again and again, keeping each remainder: 255 ÷ 2 = 127 remainder 1; 127 ÷ 2 = 63 remainder 1; 63 ÷ 2 = 31 remainder 1; 31 ÷ 2 = 15 remainder 1; 15 ÷ 2 = 7 remainder 1; 7 ÷ 2 = 3 remainder 1; 3 ÷ 2 = 1 remainder 1; 1 ÷ 2 = 0 remainder 1.", "Read the remainders from the last one up to the first one: 1 1 1 1 1 1 1 1.", "So 255 in binary is 11111111."]},
          ] },
          lesson:{"title": "How to convert decimal to binary", "idea": "Keep dividing the number by 2 and write down each remainder. The remainders, read from the bottom up, are the binary number.", "steps": ["Divide the number by 2 and write the remainder (it is always 0 or 1).", "Divide the answer (the quotient) by 2 again and write the new remainder.", "Repeat until the quotient reaches 0.", "Read the remainders from the last one to the first one. That is your binary number."], "exTitle": "Example: convert 22 to binary", "exLines": ["22 ÷ 2 = 11 remainder 0", "11 ÷ 2 = 5 remainder 1", "5 ÷ 2 = 2 remainder 1", "2 ÷ 2 = 1 remainder 0", "1 ÷ 2 = 0 remainder 1", "Read the remainders from the bottom up: 1 0 1 1 0"], "exAnswer": "22 in decimal = 10110 in binary", "tip": "Check your work by converting back with place values.", "ref": "place"},
          resources:[],
          focus:["repeated division by 2", "reading remainders bottom to top"] }
      ] },
      { label: "Binary and octal", tone: 'b', topics: [
        { key:"bin-oct", title:"Binary to Octal", sub:"Group the bits in threes", icon:"2→8", small:true,
          game:{ cta:"Think you can master Binary to Octal? Answer every question, beat your best score, and tap Show solution whenever you're stuck!", questions:[
            // ---------- EASY (7 questions) ----------
            {"level": "easy", "q": "Convert this binary number to octal.", "num": "101", "from": 2, "to": 8, "base": 8, "answer": "5", "solution": ["Split the bits into groups of 3, starting from the right: 101.", "Convert each group to one digit: 101 = 5.", "Write the digits side by side: 5."]},
            {"level": "easy", "q": "Convert this binary number to octal.", "num": "110", "from": 2, "to": 8, "base": 8, "answer": "6", "solution": ["Split the bits into groups of 3, starting from the right: 110.", "Convert each group to one digit: 110 = 6.", "Write the digits side by side: 6."]},
            {"level": "easy", "q": "Convert this binary number to octal.", "num": "111", "from": 2, "to": 8, "base": 8, "answer": "7", "solution": ["Split the bits into groups of 3, starting from the right: 111.", "Convert each group to one digit: 111 = 7.", "Write the digits side by side: 7."]},
            {"level": "easy", "q": "Convert this binary number to octal.", "num": "1010", "from": 2, "to": 8, "base": 8, "answer": "12", "solution": ["Split the bits into groups of 3, starting from the right (add 2 zeros on the left to fill the first group): 001 | 010.", "Convert each group to one digit: 001 = 1, 010 = 2.", "Write the digits side by side: 12."]},
            {"level": "easy", "q": "Convert this binary number to octal.", "num": "1101", "from": 2, "to": 8, "base": 8, "answer": "15", "solution": ["Split the bits into groups of 3, starting from the right (add 2 zeros on the left to fill the first group): 001 | 101.", "Convert each group to one digit: 001 = 1, 101 = 5.", "Write the digits side by side: 15."]},
            {"level": "easy", "q": "Convert this binary number to octal.", "num": "1111", "from": 2, "to": 8, "base": 8, "answer": "17", "solution": ["Split the bits into groups of 3, starting from the right (add 2 zeros on the left to fill the first group): 001 | 111.", "Convert each group to one digit: 001 = 1, 111 = 7.", "Write the digits side by side: 17."]},
            {"level": "easy", "q": "Convert this binary number to octal.", "num": "10000", "from": 2, "to": 8, "base": 8, "answer": "20", "solution": ["Split the bits into groups of 3, starting from the right (add 1 zero on the left to fill the first group): 010 | 000.", "Convert each group to one digit: 010 = 2, 000 = 0.", "Write the digits side by side: 20."]},
            // ---------- MEDIUM (7 questions) ----------
            {"level": "medium", "q": "What is this binary number in octal?", "num": "101110", "from": 2, "to": 8, "base": 8, "answer": "56", "solution": ["Split the bits into groups of 3, starting from the right: 101 | 110.", "Convert each group to one digit: 101 = 5, 110 = 6.", "Write the digits side by side: 56."]},
            {"level": "medium", "q": "What is this binary number in octal?", "num": "110101", "from": 2, "to": 8, "base": 8, "answer": "65", "solution": ["Split the bits into groups of 3, starting from the right: 110 | 101.", "Convert each group to one digit: 110 = 6, 101 = 5.", "Write the digits side by side: 65."]},
            {"level": "medium", "q": "What is this binary number in octal?", "num": "111000", "from": 2, "to": 8, "base": 8, "answer": "70", "solution": ["Split the bits into groups of 3, starting from the right: 111 | 000.", "Convert each group to one digit: 111 = 7, 000 = 0.", "Write the digits side by side: 70."]},
            {"level": "medium", "q": "What is this binary number in octal?", "num": "100111", "from": 2, "to": 8, "base": 8, "answer": "47", "solution": ["Split the bits into groups of 3, starting from the right: 100 | 111.", "Convert each group to one digit: 100 = 4, 111 = 7.", "Write the digits side by side: 47."]},
            {"level": "medium", "q": "What is this binary number in octal?", "num": "1001001", "from": 2, "to": 8, "base": 8, "answer": "111", "solution": ["Split the bits into groups of 3, starting from the right (add 2 zeros on the left to fill the first group): 001 | 001 | 001.", "Convert each group to one digit: 001 = 1, 001 = 1, 001 = 1.", "Write the digits side by side: 111."]},
            {"level": "medium", "q": "What is this binary number in octal?", "num": "1011011", "from": 2, "to": 8, "base": 8, "answer": "133", "solution": ["Split the bits into groups of 3, starting from the right (add 2 zeros on the left to fill the first group): 001 | 011 | 011.", "Convert each group to one digit: 001 = 1, 011 = 3, 011 = 3.", "Write the digits side by side: 133."]},
            {"level": "medium", "q": "What is this binary number in octal?", "num": "1110101", "from": 2, "to": 8, "base": 8, "answer": "165", "solution": ["Split the bits into groups of 3, starting from the right (add 2 zeros on the left to fill the first group): 001 | 110 | 101.", "Convert each group to one digit: 001 = 1, 110 = 6, 101 = 5.", "Write the digits side by side: 165."]},
            // ---------- HARD (6 questions) ----------
            {"level": "hard", "q": "Convert this binary number to octal.", "num": "11010110", "from": 2, "to": 8, "base": 8, "answer": "326", "solution": ["Split the bits into groups of 3, starting from the right (add 1 zero on the left to fill the first group): 011 | 010 | 110.", "Convert each group to one digit: 011 = 3, 010 = 2, 110 = 6.", "Write the digits side by side: 326."]},
            {"level": "hard", "q": "Convert this binary number to octal.", "num": "10111001", "from": 2, "to": 8, "base": 8, "answer": "271", "solution": ["Split the bits into groups of 3, starting from the right (add 1 zero on the left to fill the first group): 010 | 111 | 001.", "Convert each group to one digit: 010 = 2, 111 = 7, 001 = 1.", "Write the digits side by side: 271."]},
            {"level": "hard", "q": "Convert this binary number to octal.", "num": "11111111", "from": 2, "to": 8, "base": 8, "answer": "377", "solution": ["Split the bits into groups of 3, starting from the right (add 1 zero on the left to fill the first group): 011 | 111 | 111.", "Convert each group to one digit: 011 = 3, 111 = 7, 111 = 7.", "Write the digits side by side: 377."]},
            {"level": "hard", "q": "Convert this binary number to octal.", "num": "101010101", "from": 2, "to": 8, "base": 8, "answer": "525", "solution": ["Split the bits into groups of 3, starting from the right: 101 | 010 | 101.", "Convert each group to one digit: 101 = 5, 010 = 2, 101 = 5.", "Write the digits side by side: 525."]},
            {"level": "hard", "q": "Convert this binary number to octal.", "num": "110011001", "from": 2, "to": 8, "base": 8, "answer": "631", "solution": ["Split the bits into groups of 3, starting from the right: 110 | 011 | 001.", "Convert each group to one digit: 110 = 6, 011 = 3, 001 = 1.", "Write the digits side by side: 631."]},
            {"level": "hard", "q": "Convert this binary number to octal.", "num": "1000000000", "from": 2, "to": 8, "base": 8, "answer": "1000", "solution": ["Split the bits into groups of 3, starting from the right (add 2 zeros on the left to fill the first group): 001 | 000 | 000 | 000.", "Convert each group to one digit: 001 = 1, 000 = 0, 000 = 0, 000 = 0.", "Write the digits side by side: 1000."]},
          ] },
          lesson:{"title": "How to convert binary to octal", "idea": "Octal is base 8, and 8 = 2 × 2 × 2, so every octal digit is exactly 3 bits. Group the bits in threes and convert each group.", "steps": ["Start from the right and split the bits into groups of 3.", "If the leftmost group is short, add zeros on its left to fill it.", "Turn each group of 3 bits into one octal digit (0 to 7) using the cheat sheet.", "Write the digits side by side."], "exTitle": "Example: convert 1101011 to octal", "exLines": ["Groups from the right: 1 | 101 | 011", "Pad the first group: 001 | 101 | 011", "001 = 1, 101 = 5, 011 = 3"], "exAnswer": "1101011 in binary = 153 in octal", "tip": "Always group from the right, never from the left.", "ref": "oct"},
          resources:[],
          focus:["grouping bits in 3s", "padding with leading zeros"] },
        { key:"oct-bin", title:"Octal to Binary", sub:"Turn each digit into 3 bits", icon:"8→2", small:true,
          game:{ cta:"Think you can master Octal to Binary? Answer every question, beat your best score, and tap Show solution whenever you're stuck!", questions:[
            // ---------- EASY (7 questions) ----------
            {"level": "easy", "q": "Convert this octal number to binary.", "num": "2", "from": 8, "to": 2, "base": 2, "answer": "10", "solution": ["Turn each octal digit into 3 bits: 2 = 010.", "Join the groups together: 010.", "Drop the zeros at the very front: 10."]},
            {"level": "easy", "q": "Convert this octal number to binary.", "num": "3", "from": 8, "to": 2, "base": 2, "answer": "11", "solution": ["Turn each octal digit into 3 bits: 3 = 011.", "Join the groups together: 011.", "Drop the zeros at the very front: 11."]},
            {"level": "easy", "q": "Convert this octal number to binary.", "num": "4", "from": 8, "to": 2, "base": 2, "answer": "100", "solution": ["Turn each octal digit into 3 bits: 4 = 100.", "Join the groups together: 100.", "There are no leading zeros to drop, so the answer is 100."]},
            {"level": "easy", "q": "Convert this octal number to binary.", "num": "5", "from": 8, "to": 2, "base": 2, "answer": "101", "solution": ["Turn each octal digit into 3 bits: 5 = 101.", "Join the groups together: 101.", "There are no leading zeros to drop, so the answer is 101."]},
            {"level": "easy", "q": "Convert this octal number to binary.", "num": "6", "from": 8, "to": 2, "base": 2, "answer": "110", "solution": ["Turn each octal digit into 3 bits: 6 = 110.", "Join the groups together: 110.", "There are no leading zeros to drop, so the answer is 110."]},
            {"level": "easy", "q": "Convert this octal number to binary.", "num": "7", "from": 8, "to": 2, "base": 2, "answer": "111", "solution": ["Turn each octal digit into 3 bits: 7 = 111.", "Join the groups together: 111.", "There are no leading zeros to drop, so the answer is 111."]},
            {"level": "easy", "q": "Convert this octal number to binary.", "num": "10", "from": 8, "to": 2, "base": 2, "answer": "1000", "solution": ["Turn each octal digit into 3 bits: 1 = 001, 0 = 000.", "Join the groups together: 001000.", "Drop the zeros at the very front: 1000."]},
            // ---------- MEDIUM (7 questions) ----------
            {"level": "medium", "q": "What is this octal number in binary?", "num": "12", "from": 8, "to": 2, "base": 2, "answer": "1010", "solution": ["Turn each octal digit into 3 bits: 1 = 001, 2 = 010.", "Join the groups together: 001010.", "Drop the zeros at the very front: 1010."]},
            {"level": "medium", "q": "What is this octal number in binary?", "num": "17", "from": 8, "to": 2, "base": 2, "answer": "1111", "solution": ["Turn each octal digit into 3 bits: 1 = 001, 7 = 111.", "Join the groups together: 001111.", "Drop the zeros at the very front: 1111."]},
            {"level": "medium", "q": "What is this octal number in binary?", "num": "25", "from": 8, "to": 2, "base": 2, "answer": "10101", "solution": ["Turn each octal digit into 3 bits: 2 = 010, 5 = 101.", "Join the groups together: 010101.", "Drop the zeros at the very front: 10101."]},
            {"level": "medium", "q": "What is this octal number in binary?", "num": "36", "from": 8, "to": 2, "base": 2, "answer": "11110", "solution": ["Turn each octal digit into 3 bits: 3 = 011, 6 = 110.", "Join the groups together: 011110.", "Drop the zeros at the very front: 11110."]},
            {"level": "medium", "q": "What is this octal number in binary?", "num": "45", "from": 8, "to": 2, "base": 2, "answer": "100101", "solution": ["Turn each octal digit into 3 bits: 4 = 100, 5 = 101.", "Join the groups together: 100101.", "There are no leading zeros to drop, so the answer is 100101."]},
            {"level": "medium", "q": "What is this octal number in binary?", "num": "52", "from": 8, "to": 2, "base": 2, "answer": "101010", "solution": ["Turn each octal digit into 3 bits: 5 = 101, 2 = 010.", "Join the groups together: 101010.", "There are no leading zeros to drop, so the answer is 101010."]},
            {"level": "medium", "q": "What is this octal number in binary?", "num": "64", "from": 8, "to": 2, "base": 2, "answer": "110100", "solution": ["Turn each octal digit into 3 bits: 6 = 110, 4 = 100.", "Join the groups together: 110100.", "There are no leading zeros to drop, so the answer is 110100."]},
            // ---------- HARD (6 questions) ----------
            {"level": "hard", "q": "Convert this octal number to binary.", "num": "77", "from": 8, "to": 2, "base": 2, "answer": "111111", "solution": ["Turn each octal digit into 3 bits: 7 = 111, 7 = 111.", "Join the groups together: 111111.", "There are no leading zeros to drop, so the answer is 111111."]},
            {"level": "hard", "q": "Convert this octal number to binary.", "num": "100", "from": 8, "to": 2, "base": 2, "answer": "1000000", "solution": ["Turn each octal digit into 3 bits: 1 = 001, 0 = 000, 0 = 000.", "Join the groups together: 001000000.", "Drop the zeros at the very front: 1000000."]},
            {"level": "hard", "q": "Convert this octal number to binary.", "num": "123", "from": 8, "to": 2, "base": 2, "answer": "1010011", "solution": ["Turn each octal digit into 3 bits: 1 = 001, 2 = 010, 3 = 011.", "Join the groups together: 001010011.", "Drop the zeros at the very front: 1010011."]},
            {"level": "hard", "q": "Convert this octal number to binary.", "num": "275", "from": 8, "to": 2, "base": 2, "answer": "10111101", "solution": ["Turn each octal digit into 3 bits: 2 = 010, 7 = 111, 5 = 101.", "Join the groups together: 010111101.", "Drop the zeros at the very front: 10111101."]},
            {"level": "hard", "q": "Convert this octal number to binary.", "num": "345", "from": 8, "to": 2, "base": 2, "answer": "11100101", "solution": ["Turn each octal digit into 3 bits: 3 = 011, 4 = 100, 5 = 101.", "Join the groups together: 011100101.", "Drop the zeros at the very front: 11100101."]},
            {"level": "hard", "q": "Convert this octal number to binary.", "num": "377", "from": 8, "to": 2, "base": 2, "answer": "11111111", "solution": ["Turn each octal digit into 3 bits: 3 = 011, 7 = 111, 7 = 111.", "Join the groups together: 011111111.", "Drop the zeros at the very front: 11111111."]},
          ] },
          lesson:{"title": "How to convert octal to binary", "idea": "This is the reverse of grouping. Turn every octal digit into its own 3-bit group, then join the groups together.", "steps": ["Look at each octal digit one at a time.", "Replace each digit with its 3-bit binary value (use the cheat sheet).", "Join all the groups together.", "Drop any zeros at the very front."], "exTitle": "Example: convert 345 to binary", "exLines": ["3 = 011, 4 = 100, 5 = 101", "Join them: 011100101", "Drop the leading zero: 11100101"], "exAnswer": "345 in octal = 11100101 in binary", "tip": "Keep all 3 bits for every digit except at the very front.", "ref": "oct"},
          resources:[],
          focus:["3-bit groups for octal digits", "dropping leading zeros"] }
      ] },
      { label: "Binary and hexadecimal", tone: 'c', topics: [
        { key:"bin-hex", title:"Binary to Hexadecimal", sub:"Group the bits in fours", icon:"2→16", small:true,
          game:{ cta:"Think you can master Binary to Hexadecimal? Answer every question, beat your best score, and tap Show solution whenever you're stuck!", questions:[
            // ---------- EASY (7 questions) ----------
            {"level": "easy", "q": "Convert this binary number to hexadecimal.", "num": "1001", "from": 2, "to": 16, "base": 16, "answer": "9", "solution": ["Split the bits into groups of 4, starting from the right: 1001.", "Convert each group to one digit: 1001 = 9.", "Write the digits side by side: 9."]},
            {"level": "easy", "q": "Convert this binary number to hexadecimal.", "num": "1010", "from": 2, "to": 16, "base": 16, "answer": "A", "solution": ["Split the bits into groups of 4, starting from the right: 1010.", "Convert each group to one digit: 1010 = A (10).", "Write the digits side by side: A."]},
            {"level": "easy", "q": "Convert this binary number to hexadecimal.", "num": "1011", "from": 2, "to": 16, "base": 16, "answer": "B", "solution": ["Split the bits into groups of 4, starting from the right: 1011.", "Convert each group to one digit: 1011 = B (11).", "Write the digits side by side: B."]},
            {"level": "easy", "q": "Convert this binary number to hexadecimal.", "num": "1100", "from": 2, "to": 16, "base": 16, "answer": "C", "solution": ["Split the bits into groups of 4, starting from the right: 1100.", "Convert each group to one digit: 1100 = C (12).", "Write the digits side by side: C."]},
            {"level": "easy", "q": "Convert this binary number to hexadecimal.", "num": "1101", "from": 2, "to": 16, "base": 16, "answer": "D", "solution": ["Split the bits into groups of 4, starting from the right: 1101.", "Convert each group to one digit: 1101 = D (13).", "Write the digits side by side: D."]},
            {"level": "easy", "q": "Convert this binary number to hexadecimal.", "num": "1110", "from": 2, "to": 16, "base": 16, "answer": "E", "solution": ["Split the bits into groups of 4, starting from the right: 1110.", "Convert each group to one digit: 1110 = E (14).", "Write the digits side by side: E."]},
            {"level": "easy", "q": "Convert this binary number to hexadecimal.", "num": "1111", "from": 2, "to": 16, "base": 16, "answer": "F", "solution": ["Split the bits into groups of 4, starting from the right: 1111.", "Convert each group to one digit: 1111 = F (15).", "Write the digits side by side: F."]},
            // ---------- MEDIUM (7 questions) ----------
            {"level": "medium", "q": "What is this binary number in hexadecimal?", "num": "10000", "from": 2, "to": 16, "base": 16, "answer": "10", "solution": ["Split the bits into groups of 4, starting from the right (add 3 zeros on the left to fill the first group): 0001 | 0000.", "Convert each group to one digit: 0001 = 1, 0000 = 0.", "Write the digits side by side: 10."]},
            {"level": "medium", "q": "What is this binary number in hexadecimal?", "num": "11010", "from": 2, "to": 16, "base": 16, "answer": "1A", "solution": ["Split the bits into groups of 4, starting from the right (add 3 zeros on the left to fill the first group): 0001 | 1010.", "Convert each group to one digit: 0001 = 1, 1010 = A (10).", "Write the digits side by side: 1A."]},
            {"level": "medium", "q": "What is this binary number in hexadecimal?", "num": "101101", "from": 2, "to": 16, "base": 16, "answer": "2D", "solution": ["Split the bits into groups of 4, starting from the right (add 2 zeros on the left to fill the first group): 0010 | 1101.", "Convert each group to one digit: 0010 = 2, 1101 = D (13).", "Write the digits side by side: 2D."]},
            {"level": "medium", "q": "What is this binary number in hexadecimal?", "num": "111111", "from": 2, "to": 16, "base": 16, "answer": "3F", "solution": ["Split the bits into groups of 4, starting from the right (add 2 zeros on the left to fill the first group): 0011 | 1111.", "Convert each group to one digit: 0011 = 3, 1111 = F (15).", "Write the digits side by side: 3F."]},
            {"level": "medium", "q": "What is this binary number in hexadecimal?", "num": "100110", "from": 2, "to": 16, "base": 16, "answer": "26", "solution": ["Split the bits into groups of 4, starting from the right (add 2 zeros on the left to fill the first group): 0010 | 0110.", "Convert each group to one digit: 0010 = 2, 0110 = 6.", "Write the digits side by side: 26."]},
            {"level": "medium", "q": "What is this binary number in hexadecimal?", "num": "1011100", "from": 2, "to": 16, "base": 16, "answer": "5C", "solution": ["Split the bits into groups of 4, starting from the right (add 1 zero on the left to fill the first group): 0101 | 1100.", "Convert each group to one digit: 0101 = 5, 1100 = C (12).", "Write the digits side by side: 5C."]},
            {"level": "medium", "q": "What is this binary number in hexadecimal?", "num": "1100111", "from": 2, "to": 16, "base": 16, "answer": "67", "solution": ["Split the bits into groups of 4, starting from the right (add 1 zero on the left to fill the first group): 0110 | 0111.", "Convert each group to one digit: 0110 = 6, 0111 = 7.", "Write the digits side by side: 67."]},
            // ---------- HARD (6 questions) ----------
            {"level": "hard", "q": "Convert this binary number to hexadecimal.", "num": "10101010", "from": 2, "to": 16, "base": 16, "answer": "AA", "solution": ["Split the bits into groups of 4, starting from the right: 1010 | 1010.", "Convert each group to one digit: 1010 = A (10), 1010 = A (10).", "Write the digits side by side: AA."]},
            {"level": "hard", "q": "Convert this binary number to hexadecimal.", "num": "11110000", "from": 2, "to": 16, "base": 16, "answer": "F0", "solution": ["Split the bits into groups of 4, starting from the right: 1111 | 0000.", "Convert each group to one digit: 1111 = F (15), 0000 = 0.", "Write the digits side by side: F0."]},
            {"level": "hard", "q": "Convert this binary number to hexadecimal.", "num": "11111111", "from": 2, "to": 16, "base": 16, "answer": "FF", "solution": ["Split the bits into groups of 4, starting from the right: 1111 | 1111.", "Convert each group to one digit: 1111 = F (15), 1111 = F (15).", "Write the digits side by side: FF."]},
            {"level": "hard", "q": "Convert this binary number to hexadecimal.", "num": "10111110", "from": 2, "to": 16, "base": 16, "answer": "BE", "solution": ["Split the bits into groups of 4, starting from the right: 1011 | 1110.", "Convert each group to one digit: 1011 = B (11), 1110 = E (14).", "Write the digits side by side: BE."]},
            {"level": "hard", "q": "Convert this binary number to hexadecimal.", "num": "1101001011", "from": 2, "to": 16, "base": 16, "answer": "34B", "solution": ["Split the bits into groups of 4, starting from the right (add 2 zeros on the left to fill the first group): 0011 | 0100 | 1011.", "Convert each group to one digit: 0011 = 3, 0100 = 4, 1011 = B (11).", "Write the digits side by side: 34B."]},
            {"level": "hard", "q": "Convert this binary number to hexadecimal.", "num": "111100001010", "from": 2, "to": 16, "base": 16, "answer": "F0A", "solution": ["Split the bits into groups of 4, starting from the right: 1111 | 0000 | 1010.", "Convert each group to one digit: 1111 = F (15), 0000 = 0, 1010 = A (10).", "Write the digits side by side: F0A."]},
          ] },
          lesson:{"title": "How to convert binary to hexadecimal", "idea": "Hexadecimal is base 16, and 16 = 2 × 2 × 2 × 2, so every hex digit is exactly 4 bits. Values 10 to 15 are written as the letters A to F.", "steps": ["Start from the right and split the bits into groups of 4.", "If the leftmost group is short, add zeros on its left to fill it.", "Turn each group into one hex digit: 0 to 9, then A = 10, B = 11, C = 12, D = 13, E = 14, F = 15.", "Write the digits side by side."], "exTitle": "Example: convert 101111010 to hexadecimal", "exLines": ["Groups from the right: 1 | 0111 | 1010", "Pad the first group: 0001 | 0111 | 1010", "0001 = 1, 0111 = 7, 1010 = A"], "exAnswer": "101111010 in binary = 17A in hexadecimal", "tip": "Learn 1010 = A, 1011 = B, 1100 = C, 1101 = D, 1110 = E, 1111 = F.", "ref": "hex"},
          resources:[],
          focus:["grouping bits in 4s", "hex digits A to F"] },
        { key:"hex-bin", title:"Hexadecimal to Binary", sub:"Turn each digit into 4 bits", icon:"16→2", small:true,
          game:{ cta:"Think you can master Hexadecimal to Binary? Answer every question, beat your best score, and tap Show solution whenever you're stuck!", questions:[
            // ---------- EASY (7 questions) ----------
            {"level": "easy", "q": "Convert this hexadecimal number to binary.", "num": "3", "from": 16, "to": 2, "base": 2, "answer": "11", "solution": ["Turn each hexadecimal digit into 4 bits: 3 = 0011.", "Join the groups together: 0011.", "Drop the zeros at the very front: 11."]},
            {"level": "easy", "q": "Convert this hexadecimal number to binary.", "num": "5", "from": 16, "to": 2, "base": 2, "answer": "101", "solution": ["Turn each hexadecimal digit into 4 bits: 5 = 0101.", "Join the groups together: 0101.", "Drop the zeros at the very front: 101."]},
            {"level": "easy", "q": "Convert this hexadecimal number to binary.", "num": "9", "from": 16, "to": 2, "base": 2, "answer": "1001", "solution": ["Turn each hexadecimal digit into 4 bits: 9 = 1001.", "Join the groups together: 1001.", "There are no leading zeros to drop, so the answer is 1001."]},
            {"level": "easy", "q": "Convert this hexadecimal number to binary.", "num": "A", "from": 16, "to": 2, "base": 2, "answer": "1010", "solution": ["Turn each hexadecimal digit into 4 bits: A (10) = 1010.", "Join the groups together: 1010.", "There are no leading zeros to drop, so the answer is 1010."]},
            {"level": "easy", "q": "Convert this hexadecimal number to binary.", "num": "B", "from": 16, "to": 2, "base": 2, "answer": "1011", "solution": ["Turn each hexadecimal digit into 4 bits: B (11) = 1011.", "Join the groups together: 1011.", "There are no leading zeros to drop, so the answer is 1011."]},
            {"level": "easy", "q": "Convert this hexadecimal number to binary.", "num": "D", "from": 16, "to": 2, "base": 2, "answer": "1101", "solution": ["Turn each hexadecimal digit into 4 bits: D (13) = 1101.", "Join the groups together: 1101.", "There are no leading zeros to drop, so the answer is 1101."]},
            {"level": "easy", "q": "Convert this hexadecimal number to binary.", "num": "F", "from": 16, "to": 2, "base": 2, "answer": "1111", "solution": ["Turn each hexadecimal digit into 4 bits: F (15) = 1111.", "Join the groups together: 1111.", "There are no leading zeros to drop, so the answer is 1111."]},
            // ---------- MEDIUM (7 questions) ----------
            {"level": "medium", "q": "What is this hexadecimal number in binary?", "num": "10", "from": 16, "to": 2, "base": 2, "answer": "10000", "solution": ["Turn each hexadecimal digit into 4 bits: 1 = 0001, 0 = 0000.", "Join the groups together: 00010000.", "Drop the zeros at the very front: 10000."]},
            {"level": "medium", "q": "What is this hexadecimal number in binary?", "num": "1F", "from": 16, "to": 2, "base": 2, "answer": "11111", "solution": ["Turn each hexadecimal digit into 4 bits: 1 = 0001, F (15) = 1111.", "Join the groups together: 00011111.", "Drop the zeros at the very front: 11111."]},
            {"level": "medium", "q": "What is this hexadecimal number in binary?", "num": "2A", "from": 16, "to": 2, "base": 2, "answer": "101010", "solution": ["Turn each hexadecimal digit into 4 bits: 2 = 0010, A (10) = 1010.", "Join the groups together: 00101010.", "Drop the zeros at the very front: 101010."]},
            {"level": "medium", "q": "What is this hexadecimal number in binary?", "num": "3C", "from": 16, "to": 2, "base": 2, "answer": "111100", "solution": ["Turn each hexadecimal digit into 4 bits: 3 = 0011, C (12) = 1100.", "Join the groups together: 00111100.", "Drop the zeros at the very front: 111100."]},
            {"level": "medium", "q": "What is this hexadecimal number in binary?", "num": "4B", "from": 16, "to": 2, "base": 2, "answer": "1001011", "solution": ["Turn each hexadecimal digit into 4 bits: 4 = 0100, B (11) = 1011.", "Join the groups together: 01001011.", "Drop the zeros at the very front: 1001011."]},
            {"level": "medium", "q": "What is this hexadecimal number in binary?", "num": "7E", "from": 16, "to": 2, "base": 2, "answer": "1111110", "solution": ["Turn each hexadecimal digit into 4 bits: 7 = 0111, E (14) = 1110.", "Join the groups together: 01111110.", "Drop the zeros at the very front: 1111110."]},
            {"level": "medium", "q": "What is this hexadecimal number in binary?", "num": "A5", "from": 16, "to": 2, "base": 2, "answer": "10100101", "solution": ["Turn each hexadecimal digit into 4 bits: A (10) = 1010, 5 = 0101.", "Join the groups together: 10100101.", "There are no leading zeros to drop, so the answer is 10100101."]},
            // ---------- HARD (6 questions) ----------
            {"level": "hard", "q": "Convert this hexadecimal number to binary.", "num": "C3", "from": 16, "to": 2, "base": 2, "answer": "11000011", "solution": ["Turn each hexadecimal digit into 4 bits: C (12) = 1100, 3 = 0011.", "Join the groups together: 11000011.", "There are no leading zeros to drop, so the answer is 11000011."]},
            {"level": "hard", "q": "Convert this hexadecimal number to binary.", "num": "FF", "from": 16, "to": 2, "base": 2, "answer": "11111111", "solution": ["Turn each hexadecimal digit into 4 bits: F (15) = 1111, F (15) = 1111.", "Join the groups together: 11111111.", "There are no leading zeros to drop, so the answer is 11111111."]},
            {"level": "hard", "q": "Convert this hexadecimal number to binary.", "num": "1A3", "from": 16, "to": 2, "base": 2, "answer": "110100011", "solution": ["Turn each hexadecimal digit into 4 bits: 1 = 0001, A (10) = 1010, 3 = 0011.", "Join the groups together: 000110100011.", "Drop the zeros at the very front: 110100011."]},
            {"level": "hard", "q": "Convert this hexadecimal number to binary.", "num": "2BC", "from": 16, "to": 2, "base": 2, "answer": "1010111100", "solution": ["Turn each hexadecimal digit into 4 bits: 2 = 0010, B (11) = 1011, C (12) = 1100.", "Join the groups together: 001010111100.", "Drop the zeros at the very front: 1010111100."]},
            {"level": "hard", "q": "Convert this hexadecimal number to binary.", "num": "ABC", "from": 16, "to": 2, "base": 2, "answer": "101010111100", "solution": ["Turn each hexadecimal digit into 4 bits: A (10) = 1010, B (11) = 1011, C (12) = 1100.", "Join the groups together: 101010111100.", "There are no leading zeros to drop, so the answer is 101010111100."]},
            {"level": "hard", "q": "Convert this hexadecimal number to binary.", "num": "F0F", "from": 16, "to": 2, "base": 2, "answer": "111100001111", "solution": ["Turn each hexadecimal digit into 4 bits: F (15) = 1111, 0 = 0000, F (15) = 1111.", "Join the groups together: 111100001111.", "There are no leading zeros to drop, so the answer is 111100001111."]},
          ] },
          lesson:{"title": "How to convert hexadecimal to binary", "idea": "Replace every hex digit with its 4-bit binary value, then join the groups together. It is the reverse of grouping.", "steps": ["Look at each hex digit one at a time.", "Replace it with 4 bits (use the cheat sheet, for example A = 1010 and F = 1111).", "Join all the groups together.", "Drop any zeros at the very front."], "exTitle": "Example: convert 2F to binary", "exLines": ["2 = 0010, F = 1111", "Join them: 00101111", "Drop the leading zeros: 101111"], "exAnswer": "2F in hexadecimal = 101111 in binary", "tip": "Keep all 4 bits for every digit except at the very front.", "ref": "hex"},
          resources:[],
          focus:["4-bit groups for hex digits", "dropping leading zeros"] }
      ] }
    ]
  }
};

/* ================= ARITHMETIC SECTIONS: Addition, Subtraction, Multiplication, Division =================
   Every section holds the same 6 conversion types (binary to decimal, decimal to binary, binary to octal,
   octal to binary, binary to hexadecimal, hexadecimal to binary). In each topic the student does the
   operation on two numbers written in the "from" base and gives the result in the "to" base.
   Questions are built from a fixed seed, so they are the same on every visit, and every answer is computed
   by the program (never typed by hand). Each topic has 60 questions: 20 easy, 20 medium and 20 hard. The student picks a difficulty and plays its 20. */
const BASE_WORD = { 2:'binary', 8:'octal', 10:'decimal', 16:'hexadecimal' };
const CONV_GROUPS = [
  { label:'Binary and decimal', tone:'a', items:[
    { k:'bin-dec', from:2,  to:10, title:'Binary to Decimal',     ref:'place' },
    { k:'dec-bin', from:10, to:2,  title:'Decimal to Binary',     ref:'place' } ] },
  { label:'Binary and octal', tone:'b', items:[
    { k:'bin-oct', from:2,  to:8,  title:'Binary to Octal',       ref:'oct' },
    { k:'oct-bin', from:8,  to:2,  title:'Octal to Binary',       ref:'oct' } ] },
  { label:'Binary and hexadecimal', tone:'c', items:[
    { k:'bin-hex', from:2,  to:16, title:'Binary to Hexadecimal', ref:'hex' },
    { k:'hex-bin', from:16, to:2,  title:'Hexadecimal to Binary', ref:'hex' } ] }
];
const ARITH = {
  add:{ name:'Addition',       sym:'+', show:'+',      tone:'a', result:'sum',        verb:'Add',
        desc:'Add two numbers, then write the sum in another number system.',
        step:'Add the two decimal numbers.',
        idea:'Adding works the same in every number system. The easy route is to change both numbers to decimal, add them, and then write the total in the base the question asks for.',
        tip:'Binary carry rule: 1 + 1 = 10 (write 0 and carry 1).', ex:[13, 6] },
  sub:{ name:'Subtraction',    sym:'\u2212', show:'\u2212', tone:'b', result:'difference', verb:'Subtract',
        desc:'Subtract one number from another, then change the answer\u2019s base.',
        step:'Subtract the second decimal number from the first.',
        idea:'Subtract the second number from the first. The easy route is to change both numbers to decimal, subtract, and then write the difference in the base the question asks for.',
        tip:'Binary borrow rule: 10 \u2212 1 = 1 (borrow from the next place).', ex:[25, 9] },
  mul:{ name:'Multiplication', sym:'\u00D7', show:'\u00D7', tone:'c', result:'product',    verb:'Multiply',
        desc:'Multiply two numbers, then write the product in another base.',
        step:'Multiply the two decimal numbers.',
        idea:'Multiplying works the same in every number system. Change both numbers to decimal, multiply them, and then write the product in the base the question asks for.',
        tip:'In binary, multiplying by 2 just shifts every bit one place to the left.', ex:[6, 5] },
  div:{ name:'Division',       sym:'\u00F7', show:'\u00F7', tone:'d', result:'quotient',   verb:'Divide',
        desc:'Divide one number by another (exact answers), then change the base.',
        step:'Divide the first decimal number by the second.',
        idea:'Divide the first number by the second. Every question divides exactly, with no remainder. Change both numbers to decimal, divide, and then write the quotient in the base the question asks for.',
        tip:'In binary, dividing by 2 just shifts every bit one place to the right.', ex:[28, 4] }
};
const ARITH_ORDER = ['add','sub','mul','div'];
const FROM_METHOD = {
  2:'use place values (1, 2, 4, 8, 16 and so on) for every bit that is 1, then add them',
  8:'multiply each digit by its power of 8 (1, 8, 64 and so on), then add',
  10:'both numbers are already decimal, so keep them as they are',
  16:'multiply each digit by its power of 16 (1, 16, 256 and so on), then add (A = 10 up to F = 15)'
};
const TO_METHOD = {
  10:'the result is already decimal, so you are done',
  2:'divide by 2 again and again, then read the remainders from the last to the first',
  8:'write it in binary, group the bits in 3s from the right, and turn each group into one octal digit',
  16:'write it in binary, group the bits in 4s from the right, and turn each group into one hex digit (A = 10 up to F = 15)'
};

// small seeded random number generator (same questions on every visit)
function seededRng(str){
  let h = 1779033703 ^ str.length;
  for(let i = 0; i < str.length; i++){ h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function arFmt(n, base){ return n.toString(base).toUpperCase(); }

// One operand pair for an operation and difficulty: returns [first, second, result] in decimal.
function arithPair(op, diff, r){
  const R = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  let a, b;
  if(op === 'add'){
    const [lo, hi] = diff === 'easy' ? [1, 9] : diff === 'medium' ? [8, 31] : [32, 127];
    a = R(lo, hi); b = R(lo, hi); return [a, b, a + b];
  }
  if(op === 'sub'){
    if(diff === 'easy'){ a = R(4, 15); b = R(1, a - 1); }
    else if(diff === 'medium'){ a = R(16, 63); b = R(4, a - 1); }
    else { a = R(64, 255); b = R(16, a - 8); }
    return [a, b, a - b];
  }
  if(op === 'mul'){
    if(diff === 'easy'){ a = R(2, 8); b = R(2, 8); }
    else if(diff === 'medium'){ a = R(5, 15); b = R(2, 7); }
    else { a = R(10, 31); b = R(5, 15); }
    return [a, b, a * b];
  }
  let d, k;                                   // division: pick divisor and quotient, so it always divides exactly
  if(diff === 'easy'){ d = R(2, 6); k = R(2, 8); }
  else if(diff === 'medium'){ d = R(2, 9); k = R(4, 15); }
  else { d = R(3, 15); k = R(6, 31); }
  return [d * k, d, k];
}

function arithSolution(op, a, b, res, from, to){
  const O = ARITH[op];
  const A = arFmt(a, from), B = arFmt(b, from), R = arFmt(res, to);
  const s1 = from === 10
    ? `The numbers are already in decimal: ${a} and ${b}.`
    : `Convert both ${BASE_WORD[from]} numbers to decimal: ${A} = ${a} and ${B} = ${b}.`;
  const s2 = `${O.verb} in decimal: ${a} ${O.show} ${b} = ${res}.`;
  let s3;
  if(to === 10){
    s3 = `The answer is already in decimal, so the final answer is ${res}.`;
  } else if(to === 2){
    s3 = `Convert ${res} to binary (divide by 2 and read the remainders from the last to the first): ${res} = ${R}.`;
  } else {
    const size = to === 8 ? 3 : 4, bin = res.toString(2);
    const padded = bin.padStart(Math.ceil(bin.length / size) * size, '0');
    const groups = padded.match(new RegExp('.{' + size + '}', 'g'));
    const digits = groups.map(g => arFmt(parseInt(g, 2), to));
    s3 = `Write ${res} in binary: ${bin}. Group the bits in ${size}s from the right: ${groups.join(' | ')}. Each group is one ${BASE_WORD[to]} digit: ${digits.join(' ')}, so the answer is ${R}.`;
  }
  return [s1, s2, s3];
}

const DIFF_NAME = { easy:'Easy', medium:'Medium', hard:'Hard' };

// Binary arithmetic: 20 questions of ONE difficulty. Both numbers are binary and so is the answer.
function buildArithTopic(op, diff){
  const O = ARITH[op];
  const rnd = seededRng(op + '|bin|' + diff);
  const rows = [], seen = new Set();
  let guard = 0;
  while(rows.length < 20 && guard++ < 5000){
    const [a, b, res] = arithPair(op, diff, rnd);
    const key = a + ',' + b;
    if(seen.has(key) || res < 1 || (op !== 'div' && a === b)) continue;
    seen.add(key); rows.push([a, b, res]);
  }
  rows.sort((x, y) => x[2] - y[2]);          // easiest first
  const questions = rows.map(([a, b, res]) => {
    const q = diff === 'easy'
      ? `${O.verb} ${op === 'sub' ? 'these binary numbers (first minus second)' : op === 'div' ? 'the first binary number by the second' : 'these binary numbers'}. Write the ${O.result} in binary.`
      : diff === 'medium'
      ? `What is the ${O.result} of these binary numbers? Give it in binary.`
      : `Work out the ${O.result} of these binary numbers and write it in binary.`;
    return {
      level: diff, q, num: `${arFmt(a, 2)} ${O.show} ${arFmt(b, 2)}`, expr: true,
      from: 2, to: 2, base: 2, answer: arFmt(res, 2), solution: arithSolution(op, a, b, res, 2, 2)
    };
  });

  const [ea, eb] = O.ex, eres = op === 'add' ? ea + eb : op === 'sub' ? ea - eb : op === 'mul' ? ea * eb : ea / eb;
  const exExpr = `${arFmt(ea, 2)} ${O.show} ${arFmt(eb, 2)}`;
  const title = 'Binary ' + O.name;
  return {
    key: op + '_' + diff, ck: op + '-bin', diff,
    title,
    sub: `${O.verb} binary numbers, answer in binary`,
    icon: O.sym,
    game: { cta: `Think you can master ${title} (${DIFF_NAME[diff]})? Answer every question, beat your best score, and tap Show solution whenever you're stuck!`, questions },
    lesson: {
      title: `How to ${O.verb.toLowerCase()} binary numbers`,
      idea: O.idea,
      steps: [
        from10steps(2),
        O.step,
        `Convert the result back to binary: ${TO_METHOD[2]}.`,
        'Check your work: change your answer back to decimal and make sure it matches the result.'
      ],
      exTitle: `Example: ${exExpr} (binary)`,
      exLines: arithSolution(op, ea, eb, eres, 2, 2),
      exAnswer: `${exExpr} = ${arFmt(eres, 2)} in binary`,
      tip: O.tip,
      ref: 'place'
    },
    resources: [],
    focus: [`${O.name.toLowerCase()} in binary`, `${DIFF_NAME[diff]} questions`]
  };
}

/* ----- Binary conversion: 20 questions of ONE difficulty, computed by the program ----- */
const CONV_RANGE = {
  'bin-dec': { easy:[2, 31],   medium:[32, 127],   hard:[128, 1023] },
  'dec-bin': { easy:[2, 31],   medium:[32, 127],   hard:[128, 1023] },
  'bin-oct': { easy:[8, 63],   medium:[64, 511],   hard:[512, 4095] },
  'oct-bin': { easy:[8, 63],   medium:[64, 511],   hard:[512, 4095] },
  'bin-hex': { easy:[16, 255], medium:[256, 4095], hard:[4096, 65535] },
  'hex-bin': { easy:[16, 255], medium:[256, 4095], hard:[4096, 65535] }
};
function convDigitLabel(d, base){ return (base === 16 && d >= 10) ? `${d.toString(16).toUpperCase()} (${d})` : String(d); }
function convSolution(item, n){
  const bin = n.toString(2), k = item.k;
  if(k === 'bin-dec'){
    const pv = bin.split('').map((_, i) => 2 ** (bin.length - 1 - i));
    const ones = pv.filter((_, i) => bin[i] === '1');
    return [
      `Write the place values above the bits, from left to right: ${pv.join(', ')}.`,
      `Keep the place values that sit above a 1: ${ones.join(' + ')}.`,
      ones.length > 1 ? `Add them up: ${ones.join(' + ')} = ${n}.` : `Only one place value is left, so the answer is ${n}.`
    ];
  }
  if(k === 'dec-bin'){
    const lines = []; let x = n;
    while(x > 0){ lines.push(`${x} \u00F7 2 = ${Math.floor(x / 2)} remainder ${x % 2}`); x = Math.floor(x / 2); }
    return [
      `Divide by 2 again and again, and write down each remainder: ${lines.join('; ')}.`,
      `Read the remainders from the last one up to the first one: ${bin}.`,
      `So ${n} in binary is ${bin}.`
    ];
  }
  if(k === 'bin-oct' || k === 'bin-hex'){
    const size = k === 'bin-oct' ? 3 : 4, to = item.to;
    const pad = (size - bin.length % size) % size;
    const padded = '0'.repeat(pad) + bin, groups = padded.match(new RegExp('.{' + size + '}', 'g'));
    const ans = n.toString(to).toUpperCase();
    return [
      `Split the bits into groups of ${size}, starting from the right${pad ? ` (add ${pad} zero${pad > 1 ? 's' : ''} on the left to fill the first group)` : ''}: ${groups.join(' | ')}.`,
      `Convert each group to one digit: ${groups.map(g => `${g} = ${convDigitLabel(parseInt(g, 2), to)}`).join(', ')}.`,
      `Write the digits side by side: ${ans}.`
    ];
  }
  const from = item.from, size = from === 8 ? 3 : 4, str = n.toString(from).toUpperCase();
  const groups = str.split('').map(ch => parseInt(ch, 16).toString(2).padStart(size, '0'));
  const joined = groups.join('');
  return [
    `Turn each ${BASE_WORD[from]} digit into ${size} bits: ${str.split('').map((ch, i) => `${convDigitLabel(parseInt(ch, 16), from)} = ${groups[i]}`).join(', ')}.`,
    `Join the groups together: ${joined}.`,
    joined === bin ? `There are no leading zeros to drop, so the answer is ${bin}.` : `Drop the zeros at the very front: ${bin}.`
  ];
}
const CONV_SRC = {};
BEGINNER_SRC.beginner.groups.forEach(g => g.topics.forEach(t => { CONV_SRC[t.key] = t; }));
const CONV_ITEMS = {};
CONV_GROUPS.forEach(g => g.items.forEach(it => { CONV_ITEMS[it.k] = it; }));

function buildConvTopic(k, diff){
  const item = CONV_ITEMS[k], src = CONV_SRC[k];
  const rnd = seededRng('conv|' + k + '|' + diff);
  const [lo, hi] = CONV_RANGE[k][diff];
  const nums = new Set();
  let guard = 0;
  while(nums.size < 20 && guard++ < 5000) nums.add(lo + Math.floor(rnd() * (hi - lo + 1)));
  const f = BASE_WORD[item.from], g = BASE_WORD[item.to];
  const questions = [...nums].sort((x, y) => x - y).map(n => ({
    level: diff,
    q: diff === 'easy' ? `Convert this ${f} number to ${g}.` : diff === 'medium' ? `What is this ${f} number in ${g}?` : `Work out this ${f} number in ${g}.`,
    num: arFmt(n, item.from), from: item.from, to: item.to, base: item.to, answer: arFmt(n, item.to),
    solution: convSolution(item, n)
  }));
  return Object.assign({}, src, {
    key: k + '_' + diff, ck: k, diff,
    game: { cta: `Think you can master ${item.title} (${DIFF_NAME[diff]})? Answer every question, beat your best score, and tap Show solution whenever you're stuck!`, questions }
  });
}
function from10steps(from){
  return from === 10 ? 'Both numbers are already decimal, so keep them as they are.'
                     : `Convert each ${BASE_WORD[from]} number to decimal: ${FROM_METHOD[from]}.`;
}

// Every topic ("family") holds three levels: Easy, Medium and Hard, 20 questions each.
const DIFFS = ['easy', 'medium', 'hard'];
const SECTION_ORDER = ['arith', 'conv'];
function buildArithFamily(op){
  const O = ARITH[op];
  return { key: op, title: 'Binary ' + O.name, sub: `${O.verb} binary numbers, answer in binary`, icon: O.sym,
           topics: DIFFS.map(d => buildArithTopic(op, d)) };
}
function buildConvFamily(k){
  const src = CONV_SRC[k], item = CONV_ITEMS[k];
  return { key: k, title: item.title, sub: src.sub, icon: src.icon, small: true,
           topics: DIFFS.map(d => buildConvTopic(k, d)) };
}
const LEVELS = {
  arith: {
    name: 'Binary Arithmetic', short: 'Arithmetic', sym: '\u00B1', tone: 'a',
    desc: 'Add, subtract, multiply and divide binary numbers.',
    intro: 'Four topics. Open one to pick Easy, Medium or Hard.',
    groups: [
      { label: 'Addition and subtraction',   tone: 'a', ops: ['add', 'sub'] },
      { label: 'Multiplication and division', tone: 'b', ops: ['mul', 'div'] }
    ].map(g => ({ label: g.label, tone: g.tone, families: g.ops.map(buildArithFamily) }))
  },
  conv: {
    name: 'Binary Conversion', short: 'Conversion', sym: '\u21C4', tone: 'c',
    desc: 'Change numbers between binary, decimal, octal and hexadecimal.',
    intro: 'Six topics. Open one to pick Easy, Medium or Hard.',
    groups: CONV_GROUPS.map(g => ({ label: g.label, tone: g.tone, families: g.items.map(it => buildConvFamily(it.k)) }))
  }
};
function familiesOf(levelKey){ return LEVELS[levelKey].groups.flatMap(g => g.families); }
function allTopicsOf(levelKey){ return familiesOf(levelKey).flatMap(f => f.topics); }
function familyOf(levelKey, topicKey){ return familiesOf(levelKey).find(f => f.topics.some(t => t.key === topicKey)); }

// The section cards (Binary Arithmetic / Binary Conversion). `handler` is the function that runs when a card is tapped.
function sectionCardsHtml(handler){
  return SECTION_ORDER.map(op => {
    const L = LEVELS[op];
    const fams = familiesOf(op);
    return `
      <button class="sec-card sec-${L.tone}" onclick="${handler}('${op}')">
        <span class="sec-symbol" aria-hidden="true">${L.sym}</span>
        <span class="sec-body">
          <span class="sec-name">${L.name}</span>
          <span class="sec-meta">${fams.length} topics</span>
        </span>
        <span class="topic-arrow">\u2192</span>
      </button>`;
  }).join('');
}
function renderSections(){
  const el = document.getElementById('sectionGrid');
  if(!el) return;
  el.innerHTML = sectionCardsHtml('chooseLevel');
}
renderSections();

function openSections(){
  showWizardStep('sections');
  window.scrollTo({ top:0, behavior:'smooth' });
}

// Section card clicked: show its topics and remember the section for this student.
function chooseLevel(levelKey){
  const level = LEVELS[levelKey];
  if(!level) return;
  if(currentUser){
    db.collection('users').doc(currentUser.uid).set({level: level.name}, {merge:true}).catch(console.error);
  }
  learnCtx.level = levelKey; learnCtx.family = null;
  renderTopics(levelKey);
  showWizardStep('topics');
}

// Topic cards, grouped under labels (Binary and decimal, Binary and octal, ...). Just the topic name, nothing else.
function topicGroupsHtml(levelKey, handler){
  return LEVELS[levelKey].groups.map(group => `
    <div class="topic-group-label tone-${group.tone}"><span class="tg-dot"></span>${escapeHtml(group.label)}</div>
    <div class="topic-grid topic-grid-wide">
      ${group.families.map(f => `
        <button class="topic-card tone-${group.tone}" onclick="${handler}('${levelKey}', '${f.key}')">
          <span class="topic-icon${f.small ? ' topic-icon-sm' : ''}">${escapeHtml(f.icon)}</span>
          <span class="topic-text"><span class="topic-title">${escapeHtml(f.title)}</span></span>
          <span class="topic-arrow">\u2192</span>
        </button>`).join('')}
    </div>`).join('');
}
function renderTopics(levelKey){
  const level = LEVELS[levelKey];
  document.getElementById('topicsHeading').textContent = level.name;
  document.getElementById('topicGroups').innerHTML = topicGroupsHtml(levelKey, 'openFamily');
}

// Topic card clicked: show the "Choose your difficulty" screen (Easy / Medium / Hard).
const LEVEL_UI = {
  easy:   { desc: 'Warm-up questions to get you started', bars: 1 },
  medium: { desc: 'A bit trickier. Time to think!',        bars: 2 },
  hard:   { desc: 'Challenge mode for math champions',     bars: 3 }
};
function openFamily(levelKey, familyKey){
  const fam = familiesOf(levelKey).find(f => f.key === familyKey);
  if(!fam) return;
  learnCtx.level = levelKey; learnCtx.family = familyKey;
  const level = LEVELS[levelKey];
  document.getElementById('levelsBody').innerHTML = `
    <div class="res-header">
      <span class="res-badge${fam.icon.length >= 3 ? ' res-badge-sm' : ''}">${escapeHtml(fam.icon)}</span>
      <div>
        <div class="res-eyebrow">${escapeHtml(level.name)}</div>
        <h3 class="res-title">${escapeHtml(fam.title)}</h3>
      </div>
    </div>
    <div class="dp-banner">
      <span class="dp-rocket" aria-hidden="true">\uD83D\uDE80</span>
      <p>Pick a level for <b>${escapeHtml(fam.title)}</b> to open its lesson and mini game.</p>
    </div>
    <h4 class="dp-title">Choose your difficulty</h4>
    <div class="dp-grid">
      ${fam.topics.map((t, i) => {
        const U = LEVEL_UI[t.diff];
        return `
        <button type="button" class="dp-card dp-${t.diff}" style="--i:${i};" onclick="openTopic('${levelKey}', '${t.key}')" aria-label="${DIFF_NAME[t.diff]} level: ${escapeHtml(fam.title)}">
          <span class="dp-orb" aria-hidden="true"></span>
          <span class="dp-name">${DIFF_NAME[t.diff]}</span>
          <span class="dp-desc">${U.desc}</span>
          <span class="dp-meter" aria-hidden="true">${[1, 2, 3].map(n => `<i class="${n <= U.bars ? 'on' : ''}"></i>`).join('')}</span>
          <span class="dp-play">Start <b>\u2192</b></span>
        </button>`;
      }).join('')}
    </div>`;
  showWizardStep('levels');
  window.scrollTo({ top:0, behavior:'smooth' });
}
function backToTopicList(){
  showWizardStep('topics');
  window.scrollTo({ top:0, behavior:'smooth' });
}

// Level card clicked: open that level's lesson page.
function openTopic(levelKey, topicKey){
  const topic = allTopicsOf(levelKey).find(t => t.key === topicKey);
  if(topic) showTopicResources(levelKey, topic);
}

let currentTopicRef = null;

// Back from a lesson page: return to that topic's Easy / Medium / Hard screen.
function goBackToTopics(){
  const fam = currentTopicRef && familyOf(currentTopicRef.levelKey, currentTopicRef.topicKey);
  if(fam){ openFamily(currentTopicRef.levelKey, fam.key); return; }
  showWizardStep('topics');
  window.scrollTo({top:0, behavior:'smooth'});
}
function backToTopicTop(){
  window.scrollTo({top:0, behavior:'smooth'});
}
// Next goes Easy, Medium, Hard, then on to the next topic's Easy.
function goNextTopic(){
  if(!currentTopicRef) return;
  const list = allTopicsOf(currentTopicRef.levelKey);
  const idx = list.findIndex(t => t.key === currentTopicRef.topicKey);
  if(idx >= 0 && idx < list.length - 1){
    showTopicResources(currentTopicRef.levelKey, list[idx + 1]);
    window.scrollTo({top:0, behavior:'smooth'});
  } else {
    renderTopics(currentTopicRef.levelKey);   // that was the last level of the last topic
    backToTopicList();
  }
}

function showTopicResources(levelKey, topic){
  currentTopicRef = { levelKey, topicKey: topic.key };
  const _list = allTopicsOf(levelKey);
  const _isLast = _list.findIndex(t => t.key === topic.key) >= _list.length - 1;
  document.getElementById('resNextBtn').textContent = _isLast ? 'All topics ✓' : 'Next Level →';
  const level = LEVELS[levelKey];
  const badge = document.getElementById('resBadge');
  badge.textContent = topic.icon;
  badge.classList.toggle('res-badge-sm', topic.icon.length >= 3);
  document.getElementById('resEyebrow').textContent = level.name;
  {
    // Big coloured difficulty badge, with a little pop every time a lesson opens, so students can see the level really changed.
    const dEl = document.getElementById('resDiff');
    document.getElementById('resTop').dataset.diff = topic.diff || '';
    if(dEl){
      if(topic.diff){
        const L = GAME_LEVELS[topic.diff];
        dEl.className = 'res-diff diff-' + topic.diff;
        dEl.textContent = L.emoji + ' ' + L.label + ' level';
        dEl.hidden = false;
        void dEl.offsetWidth; dEl.classList.add('pop');
      } else dEl.hidden = true;
    }
  }
  document.getElementById('resTitle').textContent = topic.title;

  const ICONS = {
    ppt:'<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    quiz:'<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M9 9l1.5 1.5L14 7M9 15h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  const resources = topic.resources || [];
  const others = resources.filter(r=>r.type!=='video');

  const cardsHtml = others.map((r,i)=>`
    <a class="res-card res-${r.type}" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">
      <span class="res-card-icon">${ICONS[r.type] || ''}</span>
      <span class="res-tag tag-${r.type}">Step ${i + 1}</span>
      <span class="res-card-title">${escapeHtml(r.title)}</span>
      <span class="res-card-desc">${escapeHtml(r.desc)}</span>
      <span class="res-card-cta">${escapeHtml(r.cta || 'Open')} <span>→</span></span>
    </a>`).join('');

  document.getElementById('resBody').innerHTML = resources.length
    ? (cardsHtml ? `<div class="res-grid">${cardsHtml}</div>` : '')
    : topic.lesson ? renderLesson(topic)
    : `<div class="res-empty"><span>🚧</span><h4>Lesson materials coming soon</h4><p>The lesson and mini game for ${escapeHtml(topic.title)} will be added here.</p></div>`;
  document.getElementById('gameBody').innerHTML = '';
  if(!document.getElementById('gameMount')) document.getElementById('resBody').insertAdjacentHTML('beforeend', '<div id="gameMount"></div>');
  document.getElementById('resBody').insertAdjacentHTML('beforeend', '<div id="sketchMount"></div>');
  skProblem = null;
  document.querySelectorAll('#resBody .cheat').forEach(csBindHints);
  gameInit(topic);       // the mini game sits on the same page as the quick lesson and cheat sheet
  sketchInit(topic);
  markActiveToday();
  showWizardStep('resources');
}

/* ================= QUICK LESSON CARD (shown above the mini game) ================= */
function lessonRefHtml(kind){
  if(kind === 'place'){
    let cells = '';
    for(let e = 7; e >= 0; e--){
      cells += `<div class="ref-chip"><b>${1 << e}</b><span>2<sup>${e}</sup></span></div>`;
    }
    return `<div class="lesson-ref"><h5>Cheat sheet: place values of one byte</h5><div class="ref-grid">${cells}</div></div>`;
  }
  const bits = kind === 'oct' ? 3 : 4;
  const count = kind === 'oct' ? 8 : 16;
  let cells = '';
  for(let i = 0; i < count; i++){
    cells += `<div class="ref-chip"><b>${i.toString(16).toUpperCase()}</b><span>${i.toString(2).padStart(bits, '0')}</span></div>`;
  }
  const title = kind === 'oct' ? 'Cheat sheet: octal digit = 3 bits' : 'Cheat sheet: hex digit = 4 bits';
  return `<div class="lesson-ref"><h5>${title}</h5><div class="ref-grid">${cells}</div></div>`;
}

/* ================= CHEAT SHEET (tap a card for details, rules for the operation, quick facts, live converter) =================
   Everything on the cheat sheet is calculated by the program, so the examples are always correct. */
const CS_ORD = ['1st','2nd','3rd','4th','5th','6th','7th','8th'];
const CS_PLACE_NAMES = ['ones','twos','fours','eights','sixteens','thirty-twos','sixty-fours','one-hundred-twenty-eights'];
const CS_SUP = '\u2070\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079';
function csPow(base, e){ return String(base) + String(e).split('').map(d => CS_SUP[+d]).join(''); }
function csBits(n, pad){ return n.toString(2).padStart(pad || 1, '0'); }
function csTerms(n, count){ const t = []; for(let i = count - 1; i >= 0; i--) if((n >> i) & 1) t.push(1 << i); return t; }
function csGroup(str, size){ const g = []; for(let i = str.length; i > 0; i -= size) g.unshift(str.slice(Math.max(0, i - size), i)); return g.join(' '); }
function csSec(title, body, cls){ return `<div class="cs-sec ${cls || ''}"><h6>${title}</h6>${body}</div>`; }
function csLine(t){ return `<div class="cs-line">${t}</div>`; }
function csDetail(i, big, sub, secs){
  return `<div class="cs-detail" data-for="${i}" hidden>
    <div class="cs-dhead"><span class="cs-dbig">${big}</span><span class="cs-dsub">${sub}</span></div>
    <div class="cs-dgrid">${secs}</div>
  </div>`;
}

/* ----- Explore tab: one detail card for every tile ----- */
function csPlaceDetailSmall(e){
  const val = 1 << e;
  const n = val | (0b10110101 & (val - 1));               // an example number that uses this place
  const bin = csBits(n, e + 1), terms = csTerms(n, e + 1);
  const sumLine = terms.length === 1 ? `${bin} = ${terms[0]}` : `${bin} = ${terms.join(' + ')} = ${n}`;
  let left = n, rows = '';
  for(let i = e; i >= 0; i--){
    const pv = 1 << i;
    if(left >= pv){ rows += `<tr><td>${pv}</td><td>${left} \u2265 ${pv}</td><td><b class="on">1</b></td><td>${left} \u2212 ${pv} = ${left - pv}</td></tr>`; left -= pv; }
    else          { rows += `<tr><td>${pv}</td><td>${left} &lt; ${pv}</td><td><b>0</b></td><td>nothing to subtract</td></tr>`; }
  }
  const secs =
    csSec('What it means', csLine(`A <b>1</b> in this place adds <b>${val}</b> to the number. A <b>0</b> adds nothing.`) +
      csLine(`It is the <b>${CS_ORD[e]}</b> place from the right (the ${CS_PLACE_NAMES[e]} place).`) +
      csLine(e ? `Every place is double the one before it: ${val / 2} \u00D7 2 = ${val}.` : `Every place is double the one before it, starting from 1.`) +
      csLine(`As a binary number it is <b>1${'0'.repeat(e)}</b>${e ? ` (a 1 followed by ${e} zero${e > 1 ? 's' : ''})` : ''}.`)) +
    csSec('Binary \u2192 Decimal example', csLine(`<b>${sumLine}</b>`) + csLine(`Add the place value of every 1. Skip the 0s.`)) +
    csSec(`Decimal \u2192 Binary example: ${n}`,
      `<div class="cs-tablewrap"><table class="cs-table"><thead><tr><th>Place</th><th>Does it fit?</th><th>Bit</th><th>Left over</th></tr></thead><tbody>${rows}</tbody></table></div>` +
      csLine(`Reading the bits from top to bottom gives <b>${bin}</b>.`), 'wide') +
    csSec('Good to know', csLine(`${e + 1} bit${e ? 's' : ''} can hold the numbers 0 to <b>${(1 << (e + 1)) - 1}</b>.`) +
      csLine(e === 7 ? 'One byte is 8 bits, so it holds 0 to 255.' : e === 3 ? 'Four bits (a nibble) make exactly one hexadecimal digit.' : e === 2 ? 'Three bits make exactly one octal digit (0 to 7).' : `This place is worth exactly 1 more than all the smaller places added together (${val - 1} + 1 = ${val}).`));
  return csDetail(e, `${CS_PLACE_NAMES[e].charAt(0).toUpperCase()}${CS_PLACE_NAMES[e].slice(1)}`, `${csPow(2, e)} = ${val}`, secs);
}

const CS_OCT_NOTES = [
  'Zero: all three bits are off (000). Inside a number never drop these zeros: 705\u2088 = 111 000 101.',
  'The smallest non-zero digit: only the ones bit is on. In file permissions, 1 means execute.',
  'Only the twos bit is on. In file permissions, 2 means write.',
  'The twos and ones bits are on: 2 + 1 = 3. In file permissions, 3 means write + execute.',
  'Only the fours bit is on. In file permissions, 4 means read.',
  'The fours and ones bits are on: 4 + 1 = 5. In file permissions, 5 means read + execute.',
  'The fours and twos bits are on: 4 + 2 = 6. In file permissions, 6 means read + write.',
  'The largest octal digit: every bit is on (111). In file permissions, 7 means read + write + execute.'
];
function csOctDetail(d){
  const bits = csBits(d, 3), terms = csTerms(d, 3), other = (d + 3) % 8;
  const os = d.toString(8) + other.toString(8), dec = d * 8 + other;
  const secs =
    csSec('What it means', csLine(`Octal digit <b>${d}</b> is binary <b>${bits}</b> and decimal <b>${d}</b>.`) +
      csLine(`The three bits are worth 4, 2 and 1: <b>${bits} = ${terms.length ? terms.join(' + ') : '0'}${terms.length > 1 ? ' = ' + d : ''}</b>.`) +
      csLine(CS_OCT_NOTES[d])) +
    csSec('Binary \u2192 Octal example', csLine(`Binary <b>${csBits(d, 3)} ${csBits(other, 3)}</b> is two groups of 3.`) +
      csLine(`${csBits(d, 3)} = ${d} and ${csBits(other, 3)} = ${other}`) + csLine(`So the octal number is <b>${os}</b>.`)) +
    csSec('Octal \u2192 Binary example', csLine(`Octal <b>${os}</b>: turn each digit into 3 bits.`) +
      csLine(`${d} \u2192 ${csBits(d, 3)} and ${other} \u2192 ${csBits(other, 3)}`) + csLine(`Join them: <b>${csBits(d, 3)}${csBits(other, 3)}</b>.`)) +
    csSec('Octal \u2192 Decimal check', csLine(`${os}\u2088 = ${d} \u00D7 8 + ${other} = <b>${dec}</b>`) + csLine(`Every octal place is worth 8 times the place to its right.`));
  return csDetail(d, `${d}`, `octal digit \u00B7 bits ${bits}`, secs);
}

const CS_HEX_NOTES = {
  10:'A is ten. It is the first letter-digit, the first number after 9.',
  11:'B is eleven.',
  12:'C is twelve. A dozen eggs is C eggs.',
  13:'D is thirteen.',
  14:'E is fourteen.',
  15:'F is fifteen, the biggest hex digit (all four bits on). FF = 255 is the biggest byte, and #FF0000 is pure red on a web page.'
};
function csHexDetail(h){
  const L = h.toString(16).toUpperCase(), bits = csBits(h, 4), terms = csTerms(h, 4);
  const other = (h + 5) % 16, O = other.toString(16).toUpperCase(), hs = L + O, dec = h * 16 + other;
  const secs =
    csSec('What it means', csLine(`Hex digit <b>${L}</b> is binary <b>${bits}</b> and decimal <b>${h}</b>.`) +
      csLine(`The four bits are worth 8, 4, 2 and 1: <b>${bits} = ${terms.length ? terms.join(' + ') : '0'}${terms.length > 1 ? ' = ' + h : ''}</b>.`) +
      csLine(h > 9 ? CS_HEX_NOTES[h] : (h === 0 ? 'Zero: all four bits are off (0000). Keep these zeros inside a number: 205\u2081\u2086 = 0010 0000 0101.' : `Digits 0 to 9 keep the same value in hex and decimal.`))) +
    csSec('Binary \u2192 Hex example', csLine(`Binary <b>${csBits(h, 4)} ${csBits(other, 4)}</b> is two groups of 4.`) +
      csLine(`${csBits(h, 4)} = ${L} and ${csBits(other, 4)} = ${O}`) + csLine(`So the hex number is <b>${hs}</b>.`)) +
    csSec('Hex \u2192 Binary example', csLine(`Hex <b>${hs}</b>: turn each digit into 4 bits.`) +
      csLine(`${L} \u2192 ${csBits(h, 4)} and ${O} \u2192 ${csBits(other, 4)}`) + csLine(`Join them: <b>${csBits(h, 4)}${csBits(other, 4)}</b>.`)) +
    csSec('Hex \u2192 Decimal check', csLine(`${hs}\u2081\u2086 = ${L} \u00D7 16 + ${O} = ${h} \u00D7 16 + ${other} = <b>${dec}</b>`) + csLine(`Every hex place is worth 16 times the place to its right.`));
  return csDetail(h, L, `hex digit \u00B7 bits ${bits}`, secs);
}

/* ----- Operation tab: rules + a worked example in binary (calculated live) ----- */
function csPre(rows){ return `<pre class="cs-pre" tabindex="0">${rows.join('\n')}</pre>`; }
function csCells(str, w){ return str.padStart(w, ' ').split('').join(' '); }
function csOpWorked(op, a, b){
  const A = a.toString(2), B = b.toString(2), lab = 9;
  if(op === 'add'){
    const R = (a + b).toString(2), w = R.length, pa = A.padStart(w, '0'), pb = B.padStart(w, '0');
    const carry = Array(w).fill(' '); let c = 0;
    for(let i = w - 1; i >= 0; i--){ const s = (+pa[i]) + (+pb[i]) + c; c = s >= 2 ? 1 : 0; if(c && i > 0) carry[i - 1] = '1'; }
    const hl = s => s.replace(/1/g, '<i>1</i>');
    return { pre: csPre([
        'carry'.padEnd(lab) + hl(carry.join(' ')),
        ''.padEnd(lab) + csCells(A, w),
        '+'.padEnd(lab - 1) + ' ' + csCells(B, w),
        ''.padEnd(lab) + '\u2500'.repeat(w * 2 - 1),
        ''.padEnd(lab) + csCells(R, w)]), result: R,
      note: `Work from the right. Write the sum bit and carry the 1 to the next column. Check in decimal: ${a} + ${b} = ${a + b}.` };
  }
  if(op === 'sub'){
    const R = (a - b).toString(2), w = A.length, pa = A.padStart(w, '0'), pb = B.padStart(w, '0'), rr = R.padStart(w, '0');
    const borrow = Array(w).fill(' '); let br = 0;
    for(let i = w - 1; i >= 0; i--){ let d = (+pa[i]) - (+pb[i]) - br; if(d < 0){ d += 2; br = 1; if(i > 0) borrow[i - 1] = '1'; } else br = 0; }
    const hl = s => s.replace(/1/g, '<i>1</i>');
    return { pre: csPre([
        'borrow'.padEnd(lab) + hl(borrow.join(' ')),
        ''.padEnd(lab) + csCells(A, w),
        '\u2212'.padEnd(lab - 1) + ' ' + csCells(B, w),
        ''.padEnd(lab) + '\u2500'.repeat(w * 2 - 1),
        ''.padEnd(lab) + rr.split('').join(' ')]), result: rr.replace(/^0+(?=.)/, ''),
      note: `Work from the right. When a column shows 0 \u2212 1, borrow a 1 from the next column on the left (that makes 10 \u2212 1 = 1). Check in decimal: ${a} \u2212 ${b} = ${a - b}.` };
  }
  if(op === 'mul'){
    const R = (a * b).toString(2), parts = [];
    for(let i = 0; i < B.length; i++){ if(B[B.length - 1 - i] === '1') parts.push({ i, v:a << i }); }
    const lines = parts.map(p => `Bit ${p.i} of ${B} is 1 \u2192 write ${A}${p.i ? ' shifted ' + p.i + ' place' + (p.i > 1 ? 's' : '') + ' to the left' : ''} = <b>${p.v.toString(2)}</b>`);
    const zeros = B.split('').reverse().map((bit, i) => bit === '0' ? i : -1).filter(i => i >= 0);
    if(zeros.length) lines.push(`Bit${zeros.length > 1 ? 's' : ''} ${zeros.join(', ')} ${zeros.length > 1 ? 'are' : 'is'} 0 \u2192 nothing to write.`);
    lines.push(`Add the lines: ${parts.map(p => p.v.toString(2)).join(' + ')} = <b>${R}</b>`);
    lines.push(`Check in decimal: ${a} \u00D7 ${b} = ${a * b}.`);
    return { html: lines.map(csLine).join(''), result: R };
  }
  // division: long division one bit at a time
  const R = (a / b).toString(2), lines = []; let r = 0, q = '';
  A.split('').forEach(bit => {
    r = r * 2 + (+bit); const fits = r >= b;
    lines.push(`Bring down ${bit} \u2192 ${r.toString(2)} ${fits ? '\u2265' : '<'} ${B} \u2192 write <b>${fits ? 1 : 0}</b>${fits ? ` and subtract (left over ${(r - b).toString(2)})` : ''}`);
    if(fits) r -= b; q += fits ? '1' : '0';
  });
  lines.push(`Drop the leading zeros: the quotient is <b>${q.replace(/^0+(?=.)/, '')}</b>.`);
  lines.push(`Check in decimal: ${a} \u00F7 ${b} = ${a / b}.`);
  return { html: lines.map(csLine).join(''), result: q.replace(/^0+(?=.)/, '') };
}
function csOpPane(op, from){
  const O = ARITH[op], [a, b] = O.ex;
  const rules = {
    add:[['0 + 0','0'],['0 + 1','1'],['1 + 0','1'],['1 + 1','10','write 0, carry 1'],['1 + 1 + 1','11','write 1, carry 1']],
    sub:[['0 \u2212 0','0'],['1 \u2212 0','1'],['1 \u2212 1','0'],['0 \u2212 1','1','borrow: 10 \u2212 1 = 1']],
    mul:[['0 \u00D7 0','0'],['0 \u00D7 1','0'],['1 \u00D7 0','0'],['1 \u00D7 1','1'],['\u00D7 10 (\u00D7 2)','shift left','adds one 0 on the right']],
    div:[['0 \u00F7 1','0'],['1 \u00F7 1','1'],['\u00F7 10 (\u00F7 2)','shift right','drops one bit on the right'],['\u00F7 0','not allowed','never divide by zero']]
  }[op];
  const chips = rules.map(r => `<div class="cs-rule"><b>${r[0]} = ${r[1]}</b>${r[2] ? `<span>${r[2]}</span>` : ''}</div>`).join('');
  const w = csOpWorked(op, a, b);
  const title = { add:'Column addition', sub:'Column subtraction', mul:'Shift and add', div:'Long division' }[op];
  const baseNote = from === 8 ? 'Your numbers are octal. Turn every digit into 3 bits (or convert to decimal first), then use these binary rules.'
                 : from === 16 ? 'Your numbers are hexadecimal. Turn every digit into 4 bits (or convert to decimal first), then use these binary rules.'
                 : from === 10 ? 'Your numbers are decimal. Either convert them to binary first, or work in decimal and convert the result at the end.'
                 : 'Your numbers are already binary, so you can use these rules directly.';
  return `
    <div class="cs-opgrid">
      ${csSec(`Binary ${O.name.toLowerCase()} rules`, `<div class="cs-rules">${chips}</div>`)}
      ${csSec('Your numbers', csLine(baseNote) + csLine(`<b>Tip:</b> ${O.tip.replace(/^[A-Za-z ]+?:\s*/, '')}`))}
    </div>
    ${csSec(`Worked example: ${a.toString(2)} ${O.show} ${b.toString(2)} (${a} ${O.show} ${b} in decimal)`, (w.pre || '') + (w.html || '') + (w.pre ? csLine(w.note) : ''), 'cs-worked')
      .replace('class="cs-sec cs-worked"', `class="cs-sec cs-worked" data-op="${op}" data-result="${w.result}" data-title="${title}"`)}`;
}

/* ----- Quick facts tab ----- */
function csFactsPane(kind, item){
  const chips = (arr) => `<div class="cs-facts">${arr.map(x => `<div class="cs-fact"><b>${x[0]}</b><span>${x[1]}</span></div>`).join('')}</div>`;
  const powers = (base, max, from) => { const r = []; for(let e = from || 0; e <= max; e++) r.push([`${csPow(base, e)}`, csComma(BigInt(base) ** BigInt(e))]); return r; };
  const map = `<div class="cs-map">
      <div class="cs-map-i ${kind === 'place' ? 'on' : ''}"><b>Binary \u21C4 Decimal</b><span>place values: 1, 2, 4, 8, 16 ...</span></div>
      <div class="cs-map-i ${kind === 'oct' ? 'on' : ''}"><b>Binary \u21C4 Octal</b><span>groups of 3 bits</span></div>
      <div class="cs-map-i ${kind === 'hex' ? 'on' : ''}"><b>Binary \u21C4 Hex</b><span>groups of 4 bits</span></div>
    </div>`;
  let a, b, c;
  if(kind === 'place'){
    a = csSec('Powers of 2 (first 17)', chips(powers(2, 16)), 'wide') + csSec('Big powers of 2', chips([...powers(2, 24, 20).filter((_, i) => i % 4 === 0), ...powers(2, 32, 30).filter((_, i) => i !== 1), ...powers(2, 64, 48).filter((_, i) => i % 16 === 0)]), 'wide');
    b = csSec('How many bits do I need?', chips([['1 bit','0 to 1'],['2 bits','0 to 3'],['3 bits','0 to 7'],['4 bits','0 to 15'],['8 bits','0 to 255'],['16 bits','0 to 65,535'],['32 bits','0 to 4,294,967,295'],['64 bits','0 to 18,446,744,073,709,551,615']]));
    c = csSec('Speed tricks', csLine('The last bit tells you odd or even: ends in <b>0</b> = even, ends in <b>1</b> = odd.') +
      csLine('Add a <b>0</b> on the right to double the number: 101 (5) \u2192 1010 (10).') +
      csLine('All ones is one less than the next power of 2: 1111 = 16 \u2212 1 = 15.')) +
      csSec('Common mistakes', csLine('Start counting place values from the <b>right</b>, with 1.') + csLine('A 0 bit still takes up a place. Do not skip it.') + csLine('Leading zeros change nothing: 0011 = 11.'));
  } else if(kind === 'oct'){
    a = csSec('Powers of 8', chips(powers(8, 8)));
    b = csSec('File permissions (a real use of octal)', chips([['4','read (r)'],['2','write (w)'],['1','execute (x)'],['755','111 101 101 = rwxr-xr-x']]));
    c = csSec('How to group', csLine('Binary \u2192 octal: group from the <b>right</b> in 3s, then add zeros on the <b>left</b> if the last group is short.') +
      csLine('Example: 1101 \u2192 001 101 \u2192 15.')) +
      csSec('Common mistakes', csLine('Octal only uses digits <b>0 to 7</b>. There is no 8 or 9.') + csLine('Do not group from the left.') + csLine('Keep zeros inside a number: 705\u2088 = 111 000 101.'));
  } else {
    a = csSec('Powers of 16', chips(powers(16, 8)));
    b = csSec('Letters and web colors', chips([['A','10'],['B','11'],['C','12'],['D','13'],['E','14'],['F','15'],['FF','255'],['#FF8800','red 255, green 136, blue 0']]));
    c = csSec('How to group', csLine('Binary \u2192 hex: group from the <b>right</b> in 4s, then add zeros on the <b>left</b> if the last group is short.') +
      csLine('Example: 101111 \u2192 0010 1111 \u2192 2F.')) +
      csSec('Common mistakes', csLine('Remember A to F are the digits 10 to 15.') + csLine('Do not group from the left.') + csLine('Capital and small letters mean the same: 2f = 2F.'));
  }
  return `<div class="cs-factsgrid">${map}${a}${b}${c}</div>`;
}

/* ----- Converter tab ----- */
const CS_RX = { 2:/^[01]+$/, 8:/^[0-7]+$/, 10:/^[0-9]+$/, 16:/^[0-9A-F]+$/ };
const CS_NAME = { 2:'Binary', 8:'Octal', 10:'Decimal', 16:'Hexadecimal' };
const CS_MAX = (1n << 64n) - 1n;           // the biggest 64-bit number
function csParseBig(raw, base){ let n = 0n; const B = BigInt(base); for(const ch of raw) n = n * B + BigInt(parseInt(ch, 16)); return n; }
function csConvPane(base, kind){
  const start = base === 10 ? '45' : (45).toString(base).toUpperCase();
  const btns = [2, 8, 10, 16].map(b => `<button type="button" class="cs-base ${b === base ? 'on' : ''}" data-base="${b}" aria-pressed="${b === base}" onclick="csConvBase(this)">${CS_NAME[b]}</button>`).join('');
  const rows = [2, 8, 10, 16].map(b => `<div class="cs-out"><span class="cs-out-l">${CS_NAME[b]} <i>base ${b}</i></span><b class="cs-out-v" data-out="${b}">\u2014</b><button type="button" class="cs-copy" aria-label="Copy the ${CS_NAME[b].toLowerCase()} number" onclick="csCopy(this)">Copy</button></div>`).join('');
  return `<div class="cs-conv" data-base="${base}">
    <p class="cs-conv-intro">Type a number and see it in every number system, up to 64 bits. Great for checking your answers.</p>
    <div class="cs-bases" role="group" aria-label="Number system of the number you type">${btns}</div>
    <input class="cs-conv-in" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="90" value="${start}" oninput="csConvRun(this.closest('.cs-conv'))" aria-label="Number to convert">
    <div class="cs-conv-err" role="status" aria-live="polite"></div>
    <div class="cs-outs">${rows}</div>
    <details class="cs-steps"><summary>\uD83D\uDCD6 Show the steps</summary><div class="cs-dgrid cs-steps-body"></div></details>
  </div>
  ${csBitsPane(kind || 'place')}`;
}
function csConvRun(root){
  if(!root) return;
  const base = +root.dataset.base, inp = root.querySelector('.cs-conv-in'), err = root.querySelector('.cs-conv-err');
  const raw = inp.value.trim().toUpperCase().replace(/[\s_,]/g, '');
  const outs = root.querySelectorAll('[data-out]'), steps = root.querySelector('.cs-steps'), body = root.querySelector('.cs-steps-body');
  const clear = msg => { outs.forEach(o => { o.textContent = '\u2014'; o.classList.remove('has'); }); err.textContent = msg; err.classList.toggle('show', !!msg); inp.classList.toggle('bad', !!msg); if(body) body.innerHTML = ''; if(steps) steps.hidden = true; };
  if(!raw){ clear(''); return; }
  if(!CS_RX[base].test(raw)){
    const ok = { 2:'binary only uses 0 and 1', 8:'octal only uses the digits 0 to 7', 10:'decimal only uses the digits 0 to 9', 16:'hexadecimal only uses 0 to 9 and A to F' }[base];
    clear(`That is not a valid ${CS_NAME[base].toLowerCase()} number: ${ok}.`); return;
  }
  const n = csParseBig(raw, base);
  if(n > CS_MAX){ clear('That number is too big. Try one up to 18,446,744,073,709,551,615 (64 bits).'); return; }
  err.textContent = ''; err.classList.remove('show'); inp.classList.remove('bad');
  outs.forEach(o => {
    const b = +o.dataset.out; let s = n.toString(b).toUpperCase();
    if(b === 2 || b === 16) s = csGroup(s, 4); else if(b === 10) s = csComma(s);
    o.textContent = s; o.classList.add('has');
  });
  if(body){ body.innerHTML = csConvSteps(n, base, raw).map(csExHtml).join(''); steps.hidden = false; }
}
function csConvBase(btn){
  const root = btn.closest('.cs-conv'), inp = root.querySelector('.cs-conv-in'), old = +root.dataset.base, nb = +btn.dataset.base;
  const raw = inp.value.trim().toUpperCase().replace(/[\s_,]/g, '');
  if(raw && CS_RX[old].test(raw)){ const n = csParseBig(raw, old); if(n <= CS_MAX) inp.value = n.toString(nb).toUpperCase(); }
  root.dataset.base = nb;
  root.querySelectorAll('.cs-base').forEach(b => { const on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  csConvRun(root);
}

/* ================= CHEAT SHEET EXTRAS: more examples, practice, step-by-step converter, bit flipper =================
   Every example and every practice answer is CALCULATED by these functions (never typed by hand), so they cannot be wrong.
   Each generator returns { tag, title, lines[], answer, value }. `value` is the plain result, used to mark practice answers. */
function csDigit(v){ return v.toString(16).toUpperCase(); }
function csTrim0(s){ return s.replace(/^0+(?=.)/, ''); }
function csLow(b){ return CS_NAME[b].toLowerCase(); }

function csN(x){ const b = BigInt(x); return b >= 10000n ? csComma(b) : b.toString(); }
function csTermList(arr, max){ return arr.length <= max ? arr.map(csN).join(' + ') : arr.slice(0, 6).map(csN).join(' + ') + ` + \u2026 (${arr.length} terms)`; }
function csExBinToDec(s){
  const len = s.length, val = BigInt('0b' + s), ones = [];
  s.split('').forEach((ch, i) => { if(ch === '1') ones.push(len - 1 - i); });
  const used = ones.map(p => 1n << BigInt(p));
  const addLine = !used.length ? 'There are no 1s, so the value is <b>0</b>.'
    : `Add the place values that sit above a 1: <b>${csTermList(used, len <= 12 ? 99 : 8)}${used.length > 1 ? ' = ' + csN(val) : ''}</b>`;
  let lines;
  if(len <= 12){
    lines = [`Place values: ${s.split('').map((_, i) => csN(1n << BigInt(len - 1 - i))).join(' ')}`, `Bits: ${s.split('').join(' ')}`, addLine];
  } else {
    lines = [`Bits: ${csGroup(s, 4)}`, `The 1s are at places ${ones.length <= 12 ? ones.join(', ') : ones.length + ' different places'} (count from 0 on the right).`, addLine];
  }
  return { tag:'toDec', title:`Binary \u2192 decimal: ${csGroup(s, 4)}`, value:val.toString(), lines,
    answer:`${csGroup(s, 4)} in binary = ${csN(val)} in decimal` };
}
function csExDecToBinSub(num){
  const lines = []; let left = num, bits = '';
  for(let e = 7; e >= 0; e--){
    const w = 1 << e;
    if(left >= w){ bits += '1'; lines.push(`${w} fits into ${left} \u2192 <b>1</b> (${left - w} left)`); left -= w; }
    else { bits += '0'; lines.push(`${w} is bigger than ${left} \u2192 <b>0</b>`); }
  }
  return { tag:'fromDec', title:`Decimal \u2192 binary (subtract method): ${num}`, value:csTrim0(bits), lines,
    answer:`${num} in decimal = ${csTrim0(bits)} in binary` };
}
function csExDecToBase(num, base){
  const name = csLow(base), B = BigInt(base);
  let q = BigInt(num);
  if(q === 0n) return { tag:'fromDec', title:`Decimal \u2192 ${name}: 0`, value:'0', lines:['Zero is written 0 in every number system.'], answer:`0 in decimal = 0 in ${name}` };
  const orig = q, steps = [], digits = [];
  while(q > 0n){
    const r = q % B, nq = q / B;
    steps.push(`${csN(q)} \u00F7 ${base} = ${csN(nq)} remainder ${r}${r > 9n ? ' (' + csDigit(Number(r)) + ')' : ''}`);
    digits.push(csDigit(Number(r))); q = nq;
  }
  digits.reverse();
  const shown = steps.length > 12 ? [...steps.slice(0, 6), `\u2026 (${steps.length - 9} more steps, keep dividing the same way) \u2026`, ...steps.slice(-3)] : steps;
  const val = digits.join('');
  return { tag:'fromDec', title:`Decimal \u2192 ${name} (divide by ${base}): ${csN(orig)}`, value:val,
    lines:[...shown, `Read the remainders from the bottom up: <b>${val}</b>`], answer:`${csN(orig)} in decimal = ${val} in ${name}` };
}
function csExGroup(s, size, base){
  const pad = (size - (s.length % size)) % size, p = '0'.repeat(pad) + s, groups = [];
  for(let i = 0; i < p.length; i += size) groups.push(p.slice(i, i + size));
  const digits = groups.map(g => csDigit(parseInt(g, 2))), name = csLow(base), val = csTrim0(digits.join(''));
  const lines = [`Group from the right, ${size} bits at a time: ${csGroup(s, size)}`];
  if(pad) lines.push(`The first group is short, so add ${pad} zero${pad > 1 ? 's' : ''} on its left: ${groups.join(' ')}`);
  if(groups.length <= 8) lines.push(groups.map((g, i) => `${g} = ${digits[i]}`).join(', '));
  else lines.push(`Each group of ${size} bits becomes one digit: ${digits.join(' ')}`);
  lines.push(`Write the digits side by side: <b>${digits.join('')}</b>`);
  return { tag:'group', title:`Binary \u2192 ${name}: ${csGroup(s, 4)}`, value:val, lines, answer:`${csGroup(s, 4)} in binary = ${val} in ${name}` };
}
function csExUngroup(s, size, base){
  const parts = s.split('').map(ch => parseInt(ch, base).toString(2).padStart(size, '0'));
  const joined = parts.join(''), val = csTrim0(joined), name = csLow(base);
  const lines = [s.length <= 8 ? s.split('').map((ch, i) => `${ch} = ${parts[i]}`).join(', ') : `Each digit becomes ${size} bits: ${parts.join(' ')}`, `Join the groups: ${s.length <= 8 ? joined : csGroup(joined, 4)}`];
  if(val !== joined) lines.push(`Drop the zeros at the very front: <b>${s.length <= 8 ? val : csGroup(val, 4)}</b>`);
  return { tag:'group', title:`${CS_NAME[base]} \u2192 binary: ${s}`, value:val, lines, answer:`${s} in ${name} = ${csGroup(val, 4)} in binary` };
}
function csExBaseToDec(s, base){
  const n = s.length, name = csLow(base), B = BigInt(base);
  const terms = s.split('').map((ch, i) => ({ ch, v:BigInt(parseInt(ch, base)), w:B ** BigInt(n - 1 - i) }));
  const total = terms.reduce((a, t) => a + t.v * t.w, 0n);
  const label = t => `${t.ch}${t.v > 9n ? ' (' + t.v + ')' : ''} \u00D7 ${csN(t.w)}`;
  let lines;
  if(n <= 8){
    lines = [`Place values: ${terms.map(t => csN(t.w)).join(' ')}`, terms.map(label).join(' + '),
      `${terms.map(t => csN(t.v * t.w)).join(' + ')}${terms.length > 1 ? ' = <b>' + csN(total) + '</b>' : ''}`];
  } else {
    const nz = terms.filter(t => t.v !== 0n);
    lines = [`Each place is worth ${base} times the one on its right (\u2026, ${csN(B ** 2n)}, ${base}, 1).`,
      `Only the non-zero digits add something: ${nz.slice(0, 8).map(label).join(' + ')}${nz.length > 8 ? ' + \u2026' : ''}`,
      `Add everything up: <b>${csN(total)}</b>`];
  }
  return { tag:'toDec', title:`${CS_NAME[base]} \u2192 decimal: ${s}`, value:total.toString(), lines, answer:`${s} in ${name} = ${csN(total)} in decimal` };
}

function csExHtml(ex){
  return `<div class="cs-sec cs-excard" data-tag="${ex.tag}"><h6>${ex.title}</h6>${ex.lines.map(csLine).join('')}<div class="cs-ans">\u2705 ${ex.answer}</div></div>`;
}

/* ----- More examples tab ----- */
function csExampleList(kind){
  if(kind === 'place') return [
    ...['101','1101','10010','11001100','10101010','11111111','01000001'].map(csExBinToDec),
    ...[45, 100, 200].map(csExDecToBinSub), ...[13, 37, 77, 156].map(n => csExDecToBase(n, 2))];
  if(kind === 'oct') return [
    ...['110101','1101011','101110','1000001','11111111'].map(s => csExGroup(s, 3, 8)),
    ...['345','72','1604','777'].map(s => csExUngroup(s, 3, 8)),
    ...['17','345','1604'].map(s => csExBaseToDec(s, 8)),
    ...[100, 229, 500].map(n => csExDecToBase(n, 8))];
  return [
    ...['11010111','101111','1111111100','10100101','1001110'].map(s => csExGroup(s, 4, 16)),
    ...['2F','A5','3C9','FF'].map(s => csExUngroup(s, 4, 16)),
    ...['2F','A5','FF','1C','3E8'].map(s => csExBaseToDec(s, 16)),
    ...[255, 300, 1000].map(n => csExDecToBase(n, 16))];
}
function csExamplesPane(kind){
  const list = csExampleList(kind), tags = [];
  list.forEach(e => { if(tags.indexOf(e.tag) < 0) tags.push(e.tag); });
  const label = { toDec:'To decimal', fromDec:'From decimal', group: kind === 'oct' ? 'Binary \u21C4 octal' : 'Binary \u21C4 hex' };
  const chips = ['all', ...tags].map((t, i) => `<button type="button" class="cs-base ${i === 0 ? 'on' : ''}" data-tag="${t}" aria-pressed="${i === 0}" onclick="csExFilter(this)">${t === 'all' ? 'All (' + list.length + ')' : label[t]}</button>`).join('');
  return `<p class="cs-hint"><span aria-hidden="true">\uD83D\uDCDD</span> ${list.length} worked examples. Pick a type, then follow the steps.</p>
    <div class="cs-bases cs-exfilter" role="group" aria-label="Filter examples">${chips}</div>
    <div class="cs-dgrid cs-exgrid">${list.map(csExHtml).join('')}</div>`;
}
function csExFilter(btn){
  const pane = btn.closest('.cs-pane'), tag = btn.dataset.tag;
  pane.querySelectorAll('.cs-exfilter .cs-base').forEach(b => { const on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  pane.querySelectorAll('.cs-excard').forEach(c => { c.hidden = !(tag === 'all' || c.dataset.tag === tag); });
}

/* ----- Practice tab: random questions, checked by the program ----- */
const CS_QLEVELS = { easy:'Easy', medium:'Medium', hard:'Hard', expert:'Expert' };
function csRand(a, b){ return a + Math.floor(Math.random() * (b - a + 1)); }
function csQuizMake(kind, level, avoid){
  const range = kind === 'place' ? { easy:[3, 4], medium:[5, 6], hard:[7, 8], expert:[12, 16] }[level] : { easy:[3, 6], medium:[6, 9], hard:[9, 12], expert:[13, 24] }[level];
  const types = kind === 'place' ? ['b2d', 'd2b'] : kind === 'oct' ? ['b2o', 'o2b', 'o2d', 'd2o'] : ['b2h', 'h2b', 'h2d', 'd2h'];
  let q, tries = 0;
  do {
    const len = csRand(range[0], range[1]), n = csRand(Math.pow(2, len - 1), Math.pow(2, len) - 1), t = types[csRand(0, types.length - 1)];
    const B = kind === 'oct' ? 8 : 16, size = kind === 'oct' ? 3 : 4;
    if(t === 'b2d'){ q = { num:n.toString(2), from:2, to:10, ex:csExBinToDec(n.toString(2)) }; }
    else if(t === 'd2b'){ q = { num:String(n), from:10, to:2, ex:csExDecToBase(n, 2) }; }
    else if(t[0] === 'b'){ q = { num:n.toString(2), from:2, to:B, ex:csExGroup(n.toString(2), size, B) }; }
    else if(t[2] === 'b'){ q = { num:n.toString(B).toUpperCase(), from:B, to:2, ex:csExUngroup(n.toString(B).toUpperCase(), size, B) }; }
    else if(t[2] === 'd'){ q = { num:n.toString(B).toUpperCase(), from:B, to:10, ex:csExBaseToDec(n.toString(B).toUpperCase(), B) }; }
    else { q = { num:String(n), from:10, to:B, ex:csExDecToBase(n, B) }; }
    q.answer = q.ex.value;
    tries++;
  } while(avoid && q.num === avoid.num && q.from === avoid.from && q.to === avoid.to && tries < 20);
  return q;
}
function csQuizNormalise(s, base){
  s = String(s || '').trim().toUpperCase().replace(/[\s_,]/g, '');
  return base === 10 ? s.replace(/^0+(?=.)/, '') : csTrim0(s);
}
function csQuizPane(kind, level){
  const lvl = CS_QLEVELS[level] ? level : 'easy';
  const lv = Object.keys(CS_QLEVELS).map((k, i) => `<button type="button" class="cs-base ${k === lvl ? 'on' : ''}" data-level="${k}" aria-pressed="${k === lvl}" onclick="csQuizLevel(this)">${CS_QLEVELS[k]}</button>`).join('');
  return `<div class="cs-quiz" data-ready="0" data-kind="${kind}" data-start="${lvl}">
    <p class="cs-hint"><span aria-hidden="true">\uD83C\uDFAF</span> Endless practice. Every question is new, and the program checks your answer.</p>
    <div class="cs-bases" role="group" aria-label="Difficulty">${lv}</div>
    <div class="cs-qscore" aria-live="polite"><span>\u2705 Correct <b data-s="ok">0</b></span><span>\uD83D\uDCDD Tried <b data-s="all">0</b></span><span>\uD83D\uDD25 Streak <b data-s="streak">0</b></span><span>\uD83C\uDFC6 Best <b data-s="best">0</b></span></div>
    <div class="cs-qbox"><div class="cs-qask"></div><div class="cs-qnum"></div></div>
    <div class="cs-qrow">
      <input class="cs-q-in" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" aria-label="Your answer" onkeydown="if(event.key==='Enter'){event.preventDefault();csQuizCheck(this.closest('.cs-quiz'));}">
      <button type="button" class="cs-qbtn go" onclick="csQuizCheck(this.closest('.cs-quiz'))">Check</button>
    </div>
    <div class="cs-qfb" role="status" aria-live="polite"></div>
    <div class="cs-qactions">
      <button type="button" class="cs-qbtn" data-act="show" onclick="csQuizShow(this.closest('.cs-quiz'))">Show solution</button>
      <button type="button" class="cs-qbtn" onclick="csQuizNew(this.closest('.cs-quiz'))">Next question \u2192</button>
    </div>
    <div class="cs-qsol"></div>
  </div>`;
}
function csQuizState(root){
  if(!root._s) root._s = { level:root.dataset.start || 'easy', ok:0, all:0, streak:0, best:0, cur:null, done:false };
  return root._s;
}
function csQuizScore(root){
  const s = csQuizState(root);
  ['ok', 'all', 'streak', 'best'].forEach(k => { const el = root.querySelector(`[data-s="${k}"]`); if(el) el.textContent = s[k]; });
}
function csQuizNew(root, quiet){
  if(!root) return;
  const s = csQuizState(root), kind = root.dataset.kind;
  s.cur = csQuizMake(kind, s.level, s.cur); s.done = false;
  const q = s.cur, word = { 2:'binary', 8:'octal', 10:'decimal', 16:'hexadecimal' };
  root.querySelector('.cs-qask').textContent = `Convert from ${word[q.from]} to ${word[q.to]}:`;
  root.querySelector('.cs-qnum').textContent = q.from === 2 ? csGroup(q.num, 4) : q.num;
  skProblem = { tag:'Practice', text:`Convert from ${word[q.from]} to ${word[q.to]}`, num:root.querySelector('.cs-qnum').textContent, from:q.from, to:q.to, expr:true };
  skPaintProblem();
  const inp = root.querySelector('.cs-q-in'); inp.value = ''; inp.disabled = false; inp.classList.remove('bad', 'good');
  const fb = root.querySelector('.cs-qfb'); fb.textContent = ''; fb.className = 'cs-qfb';
  root.querySelector('.cs-qsol').innerHTML = '';
  root.querySelector('[data-act="show"]').disabled = false;
  root.dataset.ready = '1'; csQuizScore(root);
  if(!quiet){ try{ inp.focus({ preventScroll:true }); }catch(_){} }
}
function csQuizLevel(btn){
  const root = btn.closest('.cs-quiz'); csQuizState(root).level = btn.dataset.level;
  root.querySelectorAll('[data-level]').forEach(b => { const on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  csQuizNew(root);
}
function csQuizCheck(root){
  const s = csQuizState(root); if(!s.cur || s.done) return;
  const inp = root.querySelector('.cs-q-in'), fb = root.querySelector('.cs-qfb'), q = s.cur;
  const mine = csQuizNormalise(inp.value, q.to);
  if(!mine){ fb.className = 'cs-qfb bad'; fb.textContent = 'Type your answer first.'; return; }
  const rx = CS_RX[q.to];
  if(!rx.test(mine)){ fb.className = 'cs-qfb bad'; fb.textContent = `That is not a valid ${csLow(q.to)} number. Check the digits you used.`; return; }
  s.all++; s.done = true; inp.disabled = true;
  if(mine === q.answer){
    s.ok++; s.streak++; if(s.streak > s.best) s.best = s.streak;
    inp.classList.add('good'); fb.className = 'cs-qfb good'; fb.textContent = s.streak > 2 ? `Correct! ${s.streak} in a row!` : 'Correct! Well done.';
  } else {
    s.streak = 0; inp.classList.add('bad'); fb.className = 'cs-qfb bad';
    fb.innerHTML = `Not quite. You wrote <b>${escapeHtml(mine)}</b>. The answer is <b>${escapeHtml(q.to === 2 ? csGroup(q.answer, 4) : q.answer)}</b>.`;
    root.querySelector('.cs-qsol').innerHTML = csExHtml(q.ex);
  }
  root.querySelector('[data-act="show"]').disabled = true;
  csQuizScore(root);
}
function csQuizShow(root){
  const s = csQuizState(root); if(!s.cur) return;
  root.querySelector('.cs-qsol').innerHTML = csExHtml(s.cur.ex);
}

/* ----- Converter helpers: step-by-step working, copy buttons and the bit flipper ----- */
function csConvSteps(n, base, raw){
  const bin = n.toString(2);
  if(base === 2)  return [csExBinToDec(raw), csExGroup(raw, 3, 8), csExGroup(raw, 4, 16)];
  if(base === 8)  return [csExUngroup(raw, 3, 8), csExBaseToDec(raw, 8), csExGroup(bin, 4, 16)];
  if(base === 16) return [csExUngroup(raw, 4, 16), csExBaseToDec(raw, 16), csExGroup(bin, 3, 8)];
  return [csExDecToBase(n, 2), csExGroup(bin, 3, 8), csExGroup(bin, 4, 16)];
}
function csCopy(btn){
  const out = btn.parentElement.querySelector('.cs-out-v'), txt = out ? out.textContent.replace(/[\s,]/g, '') : '';
  if(!txt || txt === '\u2014') return;
  const done = () => { btn.textContent = 'Copied \u2713'; btn.classList.add('ok'); setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('ok'); }, 1300); };
  const fallback = () => { const t = document.createElement('textarea'); t.value = txt; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try{ document.execCommand('copy'); done(); }catch(_){} t.remove(); };
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(done, fallback); } else fallback();
}
/* ----- Big numbers: place values all the way up to a 64-bit number (BigInt keeps every digit exact) ----- */
function csComma(v){ return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function csOrd(n){ const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
// Short form for a tile: exact below one million, then "2.15 billion" (the exact value is always in the detail card).
function csShortVal(v){
  v = BigInt(v);
  if(v < 1000000n) return csComma(v);
  const names = [[10n ** 18n, 'quintillion'], [10n ** 15n, 'quadrillion'], [10n ** 12n, 'trillion'], [10n ** 9n, 'billion'], [10n ** 6n, 'million']];
  for(const [d, nm] of names){
    if(v >= d){
      const x = Number((v * 200n + d) / (2n * d)) / 100;
      return `${x.toFixed(2).replace(/\.?0+$/, '')} ${nm}`;
    }
  }
  return csComma(v);
}
const CS_BIG_NOTES = {
  8:'The first place of the second byte. One byte stops at 255, so 256 needs a ninth bit.',
  10:'1,024 is the computer "kilo": 1 KiB = 1,024 bytes.',
  15:'The top bit of a 16-bit number (2 bytes). 16 bits hold 0 to 65,535.',
  16:'65,536 is how many different values 16 bits can make (0 to 65,535).',
  20:'1,048,576 bytes = 1 MiB.',
  23:'The top bit of a 24-bit number. 24 bits make 16,777,216 colours (8 bits each for red, green and blue).',
  30:'1,073,741,824 bytes = 1 GiB.',
  31:'The top bit of a 32-bit number. 32 bits hold 0 to 4,294,967,295.',
  32:'4,294,967,296 is the number of possible IPv4 addresses.',
  63:'The top bit of a 64-bit number. 64 bits hold 0 to 18,446,744,073,709,551,615.'
};
function csPlaceDetailBig(e){
  const E = BigInt(e), val = 1n << E, mid = Math.floor(e / 2), midV = 1n << BigInt(mid), n = val | midV | 1n, bin = n.toString(2);
  let left = n, rows = '';
  const ones = [[val, e], [midV, mid], [1n, 0]];
  ones.forEach(([pv, p], idx) => {
    rows += `<tr><td>${csN(pv)}</td><td>${csN(left)} \u2265 ${csN(pv)}</td><td><b class="on">1</b></td><td>${csN(left)} \u2212 ${csN(pv)} = ${csN(left - pv)}</td></tr>`;
    left -= pv;
    if(idx < ones.length - 1){
      const gap = p - ones[idx + 1][1] - 1;
      if(gap > 0) rows += `<tr class="cs-gaprow"><td colspan="4">The ${gap} place${gap > 1 ? 's' : ''} in between (${csPow(2, ones[idx + 1][1] + 1)} to ${csPow(2, p - 1)}) are all too big, so each is a <b class="zero">0</b>.</td></tr>`;
    }
  });
  const secs =
    csSec('What it means', csLine(`A <b>1</b> in this place adds <b>${csComma(val)}</b> to the number. A <b>0</b> adds nothing.`) +
      csLine(`This is bit number <b>${e}</b> (counting from 0 on the right). It sits in <b>byte ${Math.floor(e / 8) + 1}</b>.`) +
      csLine(`Every place is double the one before it: ${csComma(val / 2n)} \u00D7 2 = ${csComma(val)}.`) +
      csLine(`As a binary number it is <b>${csGroup('1' + '0'.repeat(e), 4)}</b> (a 1 followed by ${e} zeros).`) +
      csLine(`${csPow(2, e)} means 2 multiplied by itself ${e} times.`)) +
    csSec('Binary \u2192 Decimal example', csLine(`<b>${csGroup(bin, 4)}</b>`) +
      csLine(`Only three places are 1: ${csN(val)} + ${csN(midV)} + 1 = <b>${csN(n)}</b>`) + csLine('Add the place value of every 1. Skip the 0s.')) +
    csSec(`Decimal \u2192 Binary example: ${csN(n)}`,
      `<div class="cs-tablewrap"><table class="cs-table"><thead><tr><th>Place</th><th>Does it fit?</th><th>Bit</th><th>Left over</th></tr></thead><tbody>${rows}</tbody></table></div>` +
      csLine(`Every other place is 0, so the binary number is <b>${csGroup(bin, 4)}</b>.`), 'wide') +
    csSec('Good to know', csLine(`${e + 1} bits can hold the numbers 0 to <b>${csComma((1n << (E + 1n)) - 1n)}</b>.`) +
      csLine(`This place is worth exactly 1 more than all the smaller places added together (${csN(val - 1n)} + 1 = ${csN(val)}).`) +
      (CS_BIG_NOTES[e] ? csLine(CS_BIG_NOTES[e]) : ''));
  return csDetail(e, `Bit ${e}`, `${csPow(2, e)} = ${csComma(val)}`, secs);
}
// A place value of the octal (8) or hexadecimal (16) system: 8^k or 16^k.
function csPlaceDetailBase(base, k){
  const B = BigInt(base), val = B ** BigInt(k), bpd = base === 8 ? 3 : 4, name = base === 8 ? 'octal' : 'hexadecimal', Name = name[0].toUpperCase() + name.slice(1);
  const top = base === 8 ? 5 : 10, midD = base === 8 ? 3 : 12, low = base === 8 ? 7 : 15;
  const digs = Array(k + 1).fill(0);
  digs[k] = top; if(k >= 2) digs[Math.floor(k / 2)] = midD; if(k >= 1) digs[0] = low;
  const s = digs.slice().reverse().map(csDigit).join('');
  const terms = []; digs.forEach((d, i) => { if(d) terms.push({ d, w: B ** BigInt(i) }); });
  terms.reverse();
  const total = terms.reduce((a, t) => a + BigInt(t.d) * t.w, 0n);
  const parts = s.split('').map(ch => parseInt(ch, base).toString(2).padStart(bpd, '0'));
  const lab = t => `${csDigit(t.d)}${t.d > 9 ? ' (' + t.d + ')' : ''} \u00D7 ${csN(t.w)}`;
  const secs =
    csSec('What it means', csLine(`Each 1 in this place is worth <b>${csComma(val)}</b>. A digit <b>d</b> here adds d \u00D7 ${csComma(val)}.`) +
      csLine(`It is the <b>${csOrd(k + 1)}</b> place from the right.`) +
      csLine(`Because ${base} = ${csPow(2, bpd)}, the value ${csPow(base, k)} is the same as <b>${csPow(2, bpd * k)}</b> = ${csComma(val)}.`) +
      csLine(k ? `Every place is ${base} times the one before it: ${csComma(val / B)} \u00D7 ${base} = ${csComma(val)}.` : 'The first place is always worth 1.')) +
    csSec(`${Name} \u2192 Decimal example`, csLine(`${Name} <b>${s}</b>`) + csLine(`${terms.map(lab).join(' + ')}`) +
      csLine(`${terms.map(t => csN(BigInt(t.d) * t.w)).join(' + ')}${terms.length > 1 ? ' = ' : ' = '}<b>${csN(total)}</b>`) + csLine('Zeros add nothing, so only the non-zero digits are listed.')) +
    csSec(`${Name} \u2192 Binary example`, csLine(`${Name} <b>${s}</b>: every digit becomes ${bpd} bits.`) + csLine(`${parts.join(' ')}`) +
      csLine(`Join them: <b>${csGroup(parts.join(''), 4)}</b>`)) +
    csSec('Good to know', csLine(`The biggest number with ${k + 1} ${name} digit${k ? 's' : ''} is ${csPow(base, k + 1)} \u2212 1 = <b>${csComma(val * B - 1n)}</b>.`) +
      csLine(`${k + 1} ${name} digit${k ? 's' : ''} use exactly ${bpd * (k + 1)} bits.`));
  return csDetail(k, csPow(base, k), `= ${csComma(val)}`, secs);
}
function csPlaceDetail(e){ return e < 8 ? csPlaceDetailSmall(e) : csPlaceDetailBig(e); }

/* ----- Explore tab: digits or place values, shown a page (a byte) at a time ----- */
function csExploreModel(kind, mode){
  if(mode === 'digits'){
    const base = kind === 'oct' ? 8 : 16, bits = kind === 'oct' ? 3 : 4;
    return { base, count:base, per:base, place:false,
      tile: i => ({ main:csDigit(i), sub:csBits(i, bits), title:`${i} = ${csBits(i, bits)}` }),
      hint:`Tap a digit to see its ${bits}-bit pattern, with examples both ways.`,
      detail: i => kind === 'oct' ? csOctDetail(i) : csHexDetail(i) };
  }
  const base = kind === 'place' ? 2 : kind === 'oct' ? 8 : 16, count = kind === 'place' ? 64 : kind === 'oct' ? 22 : 16;
  return { base, count, per:8, place:true,
    tile: e => { const v = BigInt(base) ** BigInt(e); return { main:csShortVal(v), sub:`${base}<sup>${e}</sup>`, title:csComma(v) }; },
    hint: kind === 'place' ? 'Tap a place value to see what it means, with examples. Use the Byte buttons to go past 128, all the way to 2\u2076\u00B3.'
        : `Tap a place value to see what it means. Place values of ${kind === 'oct' ? 'octal are powers of 8' : 'hexadecimal are powers of 16'}.`,
    detail: e => base === 2 ? csPlaceDetail(e) : csPlaceDetailBase(base, e) };
}
function csExploreInner(kind, mode, page){
  const M = csExploreModel(kind, mode), pages = Math.ceil(M.count / M.per), from = page * M.per, to = Math.min(M.count, from + M.per);
  let tiles = '';
  for(let i = from; i < to; i++){
    const t = M.tile(i), cls = t.main.length > 11 ? 'xlong' : t.main.length > 7 ? 'long' : '';
    tiles += `<button type="button" class="cs-tile ${cls}" data-i="${i}" title="${t.title}" aria-pressed="false" onclick="csExplorePick(this)"><b>${t.main}</b><span>${t.sub}</span></button>`;
  }
  let chips = '', head = '';
  if(M.place){
    const lo = BigInt(M.base) ** BigInt(from), hi = BigInt(M.base) ** BigInt(to - 1);
    if(pages > 1) chips = Array.from({ length:pages }, (_, p) => {
      const f = p * M.per, t = Math.min(M.count, f + M.per) - 1;
      return `<button type="button" class="cs-base ${p === page ? 'on' : ''}" data-page="${p}" aria-pressed="${p === page}" onclick="csExplorePage(this)">${M.base === 2 ? 'Byte ' + (p + 1) : csPow(M.base, f) + '\u2013' + csPow(M.base, t)}</button>`;
    }).join('');
    head = (M.base === 2 ? `Byte ${page + 1} \u00B7 bits ${from} to ${to - 1} \u00B7 ` : '') +
      `place values ${csPow(M.base, from)} to ${csPow(M.base, to - 1)} (${csShortVal(lo)} to ${csShortVal(hi)})`;
  }
  return { hint:`<span aria-hidden="true">\uD83D\uDC46</span> ${M.hint}`, chips, head, tiles };
}
function csExploreFrame(kind){
  const mode = kind === 'place' ? 'place' : 'digits', I = csExploreInner(kind, mode, 0);
  const modes = kind === 'place' ? '' : `<div class="cs-bases cs-modes" role="group" aria-label="What to explore">
      <button type="button" class="cs-base on" data-mode="digits" aria-pressed="true" onclick="csExploreMode(this)">Digits</button>
      <button type="button" class="cs-base" data-mode="place" aria-pressed="false" onclick="csExploreMode(this)">Place values</button></div>`;
  return `<div class="cs-explore" data-mode="${mode}" data-page="0">${modes}
    <p class="cs-hint">${I.hint}</p>
    <div class="cs-bases cs-pages" role="group" aria-label="Pages of place values">${I.chips}</div>
    <div class="cs-pagehead">${I.head}</div>
    <div class="cs-tiles cs-tiles-8">${I.tiles}</div>
    <div class="cs-details" aria-live="polite"></div>
  </div>`;
}
function csExploreRedraw(box){
  const kind = box.closest('.cheat').dataset.kind, I = csExploreInner(kind, box.dataset.mode, +box.dataset.page);
  box.querySelector('.cs-hint').innerHTML = I.hint;
  box.querySelector('.cs-pages').innerHTML = I.chips;
  box.querySelector('.cs-pagehead').innerHTML = I.head;
  box.querySelector('.cs-tiles').innerHTML = I.tiles;
  box.querySelector('.cs-details').innerHTML = '';
  box.closest('.cs-pane').classList.remove('has-open');
}
function csExploreMode(btn){
  const box = btn.closest('.cs-explore'); box.dataset.mode = btn.dataset.mode; box.dataset.page = 0;
  box.querySelectorAll('.cs-modes .cs-base').forEach(b => { const on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  csExploreRedraw(box);
}
function csExplorePage(btn){ const box = btn.closest('.cs-explore'); box.dataset.page = btn.dataset.page; csExploreRedraw(box); }
function csExplorePick(btn){
  const box = btn.closest('.cs-explore'), kind = btn.closest('.cheat').dataset.kind, i = +btn.dataset.i, was = btn.classList.contains('on');
  box.querySelectorAll('.cs-tile').forEach(t => { t.classList.remove('on'); t.setAttribute('aria-pressed', 'false'); });
  const host = box.querySelector('.cs-details'); host.innerHTML = '';
  btn.closest('.cs-pane').classList.toggle('has-open', !was);
  if(was) return;
  btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true');
  host.innerHTML = csExploreModel(kind, box.dataset.mode).detail(i);
  const d = host.querySelector('.cs-detail');
  if(d){ d.hidden = false; try{ d.scrollIntoView({ block:'nearest', behavior: skReducedMotion() ? 'auto' : 'smooth' }); }catch(_){} }
}

/* ----- Flip the bits: 8, 16, 32 or 64 bits, one byte per row ----- */
const CS_FLIP = {
  place:{ widths:[8, 16, 32, 64], row:8, group:4, base:0 },
  hex:  { widths:[8, 16, 32, 64], row:8, group:4, base:16 },
  oct:  { widths:[9, 18, 36, 63], row:9, group:3, base:8 }
};
function csFlipGrid(kind, w){
  const C = CS_FLIP[kind], rows = Math.ceil(w / C.row);
  let html = '';
  for(let r = rows - 1; r >= 0; r--){
    let groups = '';
    for(let g = C.row / C.group - 1; g >= 0; g--){
      const gi = r * (C.row / C.group) + g;
      let bits = '';
      for(let j = C.group - 1; j >= 0; j--){
        const i = gi * C.group + j;
        let label;
        if(kind === 'place'){
          const v = 1n << BigInt(i);
          label = `<span class="w-full">${csComma(v)}</span><span class="w-pow">2<sup>${i}</sup></span>`;
        } else label = `<span class="w-full w-local">${1 << j}</span>`;
        const big = kind === 'place' ? `${i >= 27 ? ' b-d' : ''}${i >= 14 ? ' b-m' : ''}` : '';
        bits += `<button type="button" class="cs-bit${big}" data-i="${i}" aria-pressed="false" aria-label="Bit ${i}, currently 0" onclick="csBitFlip(this)">${label}<b>0</b></button>`;
      }
      groups += `<div class="cs-fgroup"><div class="cs-fbits" style="--n:${C.group}">${bits}</div>${C.base ? `<span class="cs-fdigit" data-g="${gi}">0</span>` : ''}</div>`;
    }
    const lab = kind === 'oct' ? `Digits ${r * 3 + 1}\u2013${r * 3 + 3}` : `Byte ${r + 1}`;
    html += `<div class="cs-frow"><span class="cs-frow-l">${lab}</span><div class="cs-fgroups">${groups}</div></div>`;
  }
  return html;
}
function csBitsPane(kind){
  const C = CS_FLIP[kind];
  const chips = C.widths.map((w, i) => `<button type="button" class="cs-base ${i === 0 ? 'on' : ''}" data-w="${w}" aria-pressed="${i === 0}" onclick="csFlipWidth(this)">${w} bits<small>${kind === 'oct' ? w / 3 + ' digits' : w / 8 + (w === 8 ? ' byte' : ' bytes')}</small></button>`).join('');
  const dName = kind === 'hex' ? 'hex' : 'octal';
  const intro = C.base ? `Tap a bit to turn it on or off. Every group of ${C.group} bits is one ${dName} digit, shown underneath.` : 'Tap a bit to turn it on or off and watch the number change. Choose more bits to go past 255.';
  return `<div class="cs-flip" data-kind="${kind}" data-w="${C.widths[0]}" data-v="0">
    <h6>\uD83D\uDD79\uFE0F Flip the bits</h6>
    <p class="cs-conv-intro">${intro}</p>
    <div class="cs-bases cs-fwidths" role="group" aria-label="How many bits">${chips}</div>
    <div class="cs-fgrid">${csFlipGrid(kind, C.widths[0])}</div>
    <div class="cs-bitsum" aria-live="polite">0</div>
    <div class="cs-bitouts">
      <div><span>Decimal</span><b data-bo="10">0</b></div><div><span>Octal</span><b data-bo="8">0</b></div><div><span>Hex</span><b data-bo="16">0</b></div><div class="cs-bo-wide"><span>Binary</span><b data-bo="2">0</b></div>
    </div>
    <div class="cs-qactions">
      <button type="button" class="cs-qbtn" onclick="csBitSet(this, 'zero')">Clear</button>
      <button type="button" class="cs-qbtn" onclick="csBitSet(this, 'ones')">All ones</button>
      <button type="button" class="cs-qbtn" onclick="csBitSet(this, 'rand')">Random</button>
      <button type="button" class="cs-qbtn go" onclick="csBitSend(this)">Send to converter \u2191</button>
    </div>
  </div>`;
}
function csFlipSum(v, w){
  const on = []; for(let i = w - 1; i >= 0; i--) if((v >> BigInt(i)) & 1n) on.push(1n << BigInt(i));
  if(!on.length) return '0';
  if(on.length === 1) return csComma(v);
  return on.length <= 6 ? `${on.map(csComma).join(' + ')} = ${csComma(v)}` : `${on.length} bits are on = ${csComma(v)}`;
}
function csBitPaint(root, v){
  const w = +root.dataset.w, kind = root.dataset.kind, C = CS_FLIP[kind];
  root.dataset.v = v.toString();
  root.querySelectorAll('.cs-bit').forEach(b => {
    const i = +b.dataset.i, on = ((v >> BigInt(i)) & 1n) === 1n;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.querySelector('b').textContent = on ? '1' : '0';
    b.setAttribute('aria-label', `Bit ${i}, currently ${on ? 1 : 0}`);
  });
  if(C.base){
    const mask = (1n << BigInt(C.group)) - 1n;
    root.querySelectorAll('.cs-fdigit').forEach(d => { d.textContent = ((v >> BigInt(+d.dataset.g * C.group)) & mask).toString(C.base).toUpperCase(); });
  }
  root.querySelector('.cs-bitsum').textContent = csFlipSum(v, w);
  const bin = v.toString(2).padStart(w, '0');
  const set = (b, s) => { const el = root.querySelector(`[data-bo="${b}"]`); if(el) el.textContent = s; };
  set(10, csComma(v));
  set(8, v.toString(8).padStart(kind === 'oct' ? w / 3 : 1, '0'));
  set(16, v.toString(16).toUpperCase().padStart(kind === 'oct' ? 1 : w / 4, '0'));
  set(2, csGroup(bin, kind === 'oct' ? 3 : 4));
}
function csBitFlip(btn){ const root = btn.closest('.cs-flip'); csBitPaint(root, BigInt(root.dataset.v) ^ (1n << BigInt(btn.dataset.i))); }
function csBitSet(btn, mode){
  const root = btn.closest('.cs-flip'), w = +root.dataset.w;
  let v = 0n;
  if(mode === 'ones') v = (1n << BigInt(w)) - 1n;
  else if(mode === 'rand'){ let s = ''; for(let i = 0; i < w; i++) s += Math.random() < 0.5 ? '0' : '1'; v = BigInt('0b' + s); }
  csBitPaint(root, v);
}
function csFlipWidth(btn){
  const root = btn.closest('.cs-flip'), w = +btn.dataset.w, kind = root.dataset.kind;
  root.querySelectorAll('.cs-fwidths .cs-base').forEach(b => { const on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  root.dataset.w = w;
  root.querySelector('.cs-fgrid').innerHTML = csFlipGrid(kind, w);
  csBitPaint(root, BigInt(root.dataset.v) & ((1n << BigInt(w)) - 1n));
}
function csBitSend(btn){
  const flip = btn.closest('.cs-flip'), conv = flip.closest('.cs-pane').querySelector('.cs-conv'), inp = conv.querySelector('.cs-conv-in');
  conv.dataset.base = 2; inp.value = BigInt(flip.dataset.v).toString(2).padStart(+flip.dataset.w, '0');
  conv.querySelectorAll('.cs-base').forEach(b => { const on = +b.dataset.base === 2; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  csConvRun(conv);
  try{ conv.scrollIntoView({ block:'nearest', behavior: skReducedMotion() ? 'auto' : 'smooth' }); }catch(_){}
}

/* ----- Whole cheat sheet ----- */
function renderCheat(topic){
  const kind = topic.lesson.ref;
  const ck = topic.ck || topic.key;
  const item = CONV_GROUPS.flatMap(g => g.items).find(x => ck === x.k || ck.endsWith('-' + x.k));
  const opKey = (ck.split('-')[0]), op = ARITH[opKey] ? opKey : null;
  const title = kind === 'place' ? 'Place values of a binary number' : kind === 'oct' ? 'Octal: digits and place values' : 'Hexadecimal: digits and place values';
  const tabs = [
    { id:'explore', icon:'\uD83D\uDD0D', label:'Explore' },
    ...(op ? [{ id:'op', icon:ARITH[op].sym, label:ARITH[op].name }] : []),
    { id:'examples', icon:'\uD83D\uDCDD', label:'More examples' },
    { id:'facts', icon:'\uD83D\uDCDA', label:'Quick facts' },
    { id:'conv', icon:'\uD83E\uDDEE', label:'Converter' }
  ];
  const tabBtns = tabs.map((t, i) => `<button type="button" role="tab" class="cs-tab ${i === 0 ? 'on' : ''}" data-tab="${t.id}" aria-selected="${i === 0}" onclick="csTab(this)"><span aria-hidden="true">${t.icon}</span> ${t.label}</button>`).join('');
  return `
    <div class="cheat" data-kind="${kind}">
      <div class="cs-walkrow"><button type="button" class="cs-walk" onclick="startCheatTour(this)"><span aria-hidden="true">🧭</span> Walk me through this</button></div>
      <div class="cs-tabsbar"><div class="cs-tabs" role="tablist">${tabBtns}</div></div>
      <div class="cs-body">
        <div class="cs-pane" data-pane="explore" role="tabpanel">${csExploreFrame(kind)}</div>
        ${op ? `<div class="cs-pane" data-pane="op" role="tabpanel" hidden>${csOpPane(op, item ? item.from : 2)}</div>` : ''}
        <div class="cs-pane" data-pane="examples" role="tabpanel" hidden>${csExamplesPane(kind)}</div>
        <div class="cs-pane" data-pane="facts" role="tabpanel" hidden>${csFactsPane(kind, item)}</div>
        <div class="cs-pane" data-pane="conv" role="tabpanel" hidden>${csConvPane(item ? item.from : 2, kind)}</div>
        <div class="cs-more" aria-hidden="true">Scroll for more \u2193</div>
      </div>
    </div>`;
}
function csTab(btn){
  const root = btn.closest('.cheat');
  root.querySelectorAll('.cs-tab').forEach(t => { const on = t === btn; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
  root.querySelectorAll('.cs-pane').forEach(p => { p.hidden = p.dataset.pane !== btn.dataset.tab; });
  if(btn.dataset.tab === 'conv') csConvRun(root.querySelector('.cs-conv'));
  const tabs = root.querySelector('.cs-tabs');
  if(tabs) tabs.scrollTo({ left: btn.offsetLeft - (tabs.clientWidth - btn.offsetWidth) / 2, behavior: skReducedMotion() ? 'auto' : 'smooth' });
  const pane = root.querySelector('.cs-pane:not([hidden])'); if(pane) pane.scrollTop = 0;
  csHints(root);
}

/* Cheat sheet scroll cues: the scrollbars are invisible, so a fade + "Scroll for more" pill (and an arrow on the tab row) tell students there is more inside. */
function csHints(root){
  if(!root) return;
  const tabs = root.querySelector('.cs-tabs'), bar = root.querySelector('.cs-tabsbar'), body = root.querySelector('.cs-body');
  if(tabs && bar){
    const max = tabs.scrollWidth - tabs.clientWidth;
    bar.classList.toggle('more-r', max > 4 && tabs.scrollLeft < max - 4);
    bar.classList.toggle('more-l', tabs.scrollLeft > 4);
  }
  const pane = body && body.querySelector('.cs-pane:not([hidden])');
  if(pane){
    const room = pane.scrollHeight - pane.clientHeight;
    body.classList.toggle('more', room > 6 && pane.scrollTop < room - 6);
  }
}
function csBindHints(root){
  if(!root || root._hints) return;
  root._hints = true;
  const upd = () => csHints(root), tabs = root.querySelector('.cs-tabs'), body = root.querySelector('.cs-body');
  if(tabs) tabs.addEventListener('scroll', upd, { passive:true });
  root.querySelectorAll('.cs-pane').forEach(p => p.addEventListener('scroll', upd, { passive:true }));
  if(window.ResizeObserver) new ResizeObserver(upd).observe(root);
  if(window.MutationObserver && body) new MutationObserver(upd).observe(body, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden'] });
  upd();
}
// One small nudge of the tab row the first time the cheat sheet opens, so students see the other tabs.
function csNudge(root){
  const tabs = root.querySelector('.cs-tabs');
  if(!tabs || root._nudged || skReducedMotion()) return;
  const max = tabs.scrollWidth - tabs.clientWidth;
  if(max < 8) return;
  root._nudged = true;
  tabs.scrollTo({ left: Math.min(70, max), behavior:'smooth' });
  setTimeout(() => tabs.scrollTo({ left:0, behavior:'smooth' }), 650);
}


function foldHtml(id, icon, title, sub, body){
  return `
    <div class="fold" data-fold="${id}">
      <button type="button" class="fold-head" aria-expanded="false" onclick="foldToggle(this)">
        <span class="fold-ico" aria-hidden="true">${icon}</span>
        <span class="fold-text"><span class="fold-title">${title}</span><span class="fold-sub">${sub}</span></span>
        <span class="fold-chev" aria-hidden="true"></span>
      </button>
      <div class="fold-body"><div class="fold-in"><div class="fold-pad">${body}</div></div></div>
    </div>`;
}
function foldToggle(btn){
  const f = btn.closest('.fold'), open = !f.classList.contains('open');
  f.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open);
  const cheat = f.querySelector('.cheat');
  if(open && cheat) setTimeout(() => { csHints(cheat); csNudge(cheat); }, 360);
}

function renderLesson(topic){
  const L = topic.lesson;
  const steps = L.steps.map((t, i) => `<li><span class="ls-num">${i + 1}</span><span>${escapeHtml(t)}</span></li>`).join('');
  const lines = L.exLines.map(t => `<div class="ex-line">${escapeHtml(t)}</div>`).join('');
  const lessonBody = `
      <div class="lesson-idea">${escapeHtml(L.idea)}</div>
      <div class="lesson-cols">
        <div class="lesson-panel">
          <h5>Steps</h5>
          <ol class="ls-steps">${steps}</ol>
        </div>
        <div class="lesson-panel lesson-example">
          <h5>${escapeHtml(L.exTitle)}</h5>
          ${lines}
          <div class="ex-answer">\u2705 ${escapeHtml(L.exAnswer)}</div>
        </div>
      </div>
      <div class="lesson-tip"><span>\uD83D\uDCA1</span><p>${escapeHtml(L.tip)}</p></div>`;
  return `
    <div class="lesson-stack">
      ${foldHtml('lesson', '\uD83D\uDCD8', 'Quick lesson', escapeHtml(L.title), lessonBody)}
      ${foldHtml('cheat', '\uD83D\uDCD2', 'Cheat sheet', 'Place values, examples, quick facts and a converter', renderCheat(topic))}
      <div id="gameMount"></div>
    </div>`;
}

/* ================= ACTIVITY LOG + ADMIN DASHBOARD ================= */
// Student-supplied text (names) is shown in the admin table, so it must be escaped.
function escapeHtml(value){
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]
  ));
}

// Records something a signed-in student did, so the admin can see it.
function logActivity(type, detail, extra){
  if(!currentUser) return;
  const userRef = db.collection('users').doc(currentUser.uid);
  userRef.collection('activity').add(Object.assign({
    type, detail: detail || '', classSection: classSection || null, at: firebase.firestore.FieldValue.serverTimestamp()
  }, extra || {})).catch(console.error);
  userRef.set({lastSeenAt: Date.now()}, {merge:true}).catch(console.error);
}

// Only REAL activity is recorded: a student checking their first answer in a mini game (and, when a game has
// difficulty levels, the level they picked). Opening a lesson page or replaying the same section within
// 10 minutes is not logged again, so the admin board is not flooded with repeats.
const GAME_LOG_COOLDOWN_MS = 10 * 60 * 1000;
const recentGameLogs = {};
function logGamePlay(section, levelKey){
  if(!currentUser) return;
  const key = currentUser.uid + '|' + section + '|' + (levelKey || 'all');
  const now = Date.now();
  if(recentGameLogs[key] && now - recentGameLogs[key] < GAME_LOG_COOLDOWN_MS) return;
  recentGameLogs[key] = now;
  const levelLabel = levelKey ? ((typeof GAME_LEVELS !== 'undefined' && GAME_LEVELS[levelKey]) ? GAME_LEVELS[levelKey].label : levelKey) : '';
  logActivity('game_played', levelLabel ? `${section} \u00B7 ${levelLabel}` : section, { section, level: levelKey || 'all' });
}

// Shows/hides the Admin tab. This only controls what's VISIBLE — the real protection
// is the Firestore security rules, which stop anyone else from reading other students' data.
function updateAdminAccess(email){
  const isAdmin = isAdminEmail(email);
  document.getElementById('adminNavBtn').style.display = isAdmin ? 'inline-flex' : 'none';
  document.getElementById('adminBottomNavBtn').style.display = isAdmin ? 'flex' : 'none';
  if(!isAdmin && document.getElementById('page-admin').classList.contains('active')) goToPage('home');
  if(isAdmin && pendingAdminRoute){ pendingAdminRoute = false; goToPage('admin'); }
}

function formatWhen(ms){
  if(!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
}

function describeActivity(a){
  if(a.type === 'game_played') return `played <b>${escapeHtml(a.detail || 'a mini game')}</b>`;
  if(a.type === 'class_selected') return `chose class section <b>${escapeHtml(a.detail)}</b>`;
  if(a.type === 'topic_opened') return `opened the ${escapeHtml(a.detail)} lesson`;
  return escapeHtml(a.type || 'did something');
}

// ----- Admin dashboard: section cards, walkthrough progress, and a searchable / sortable / paged student list -----
const ADMIN_NONE = '__none';
const ADMIN_QUEST_FALLBACK = [   // only used if the Quest Guide has not loaded; the real list comes from window.BITS_QUESTS
  { id:'signin', ico:'🔐', t:'Sign in with Google' }, { id:'class', ico:'🏫', t:'Choose your class section' },
  { id:'warmup', ico:'🎯', t:'Answer a warm-up question' }, { id:'lesson', ico:'📘', t:'Open a lesson' },
  { id:'game', ico:'🎮', t:'Visit the Game arena' }, { id:'profile', ico:'👤', t:'Check your profile' }
];
const ADM_FILTERS = [['all','All'], ['today','Active today'], ['week','Active this week'], ['idle','Inactive 7d+'], ['wdone','Walkthrough finished'], ['wnot','Walkthrough unfinished']];
const ADM_SIZES = [10, 25, 50, 100];
const ADM_DEFAULT_DIR = { name:'asc', section:'asc', level:'asc' };
const adm = { students:[], section:'all', q:'', filter:'all', sort:'recent', dir:'desc', page:1, size:25, open:new Set(), feedMore:false, loadedAt:0, token:0, actDone:0, actTotal:0 };
try{ const n = parseInt(localStorage.getItem('bitsAdminPageSize'), 10); if(ADM_SIZES.indexOf(n) >= 0) adm.size = n; }catch(_){}

function adminQuests(){ return (window.BITS_QUESTS && window.BITS_QUESTS.length) ? window.BITS_QUESTS : ADMIN_QUEST_FALLBACK; }
// Which admin group a student belongs to. Anyone without a valid class section is "No section yet".
function adminKey(s){ return CLASS_SECTIONS.indexOf(s.classSection) >= 0 ? s.classSection : ADMIN_NONE; }
function adminLabel(key){ return key === 'all' ? 'All students' : key === ADMIN_NONE ? 'No section yet' : key; }
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function timeAgo(ms){
  if(!ms) return 'Never';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if(s < 60) return 'Just now';
  if(s < 3600) return Math.floor(s / 60) + ' min ago';
  if(s < 86400) return Math.floor(s / 3600) + ' h ago';
  if(s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return new Date(ms).toLocaleDateString(undefined, { month:'short', day:'numeric' });
}
// Walkthrough (Quest Guide) progress of one student, read from users/{uid}.questProgress
function admQuest(s){
  const qs = adminQuests(), qp = (s.qp && typeof s.qp === 'object') ? s.qp : null;
  const done = (qp && qp.done && typeof qp.done === 'object') ? qp.done : {};
  const n = qs.filter(q => done[q.id]).length;
  return { started: !!qp, done, n, total: qs.length, tour: !!(qp && qp.tour), pct: qs.length ? Math.round(n / qs.length * 100) : 0 };
}
function admHue(id){ let h = 0; for(let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return h; }
function admInitials(name){
  const first = w => Array.from(w)[0] || '';
  const p = String(name).replace(/@.*/, '').trim().split(/[\s._-]+/).filter(Boolean);
  return ((p.length ? first(p[0]) : '?') + (p.length > 1 ? first(p[p.length - 1]) : '')).toUpperCase();
}
// only touch the DOM when the markup really changed (keeps open dropdowns / focus / scroll steady while data streams in)
function admSet(el, html){ if(el && el._h !== html){ el.innerHTML = html; el._h = html; } }

/* ---------- filtering, sorting, paging ---------- */
const ADM_CMP = {
  recent:  (a, b) => a.lastActive - b.lastActive,
  name:    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity:'base' }),
  section: (a, b) => adminKey(a).localeCompare(adminKey(b)),
  level:   (a, b) => String(a.level).localeCompare(String(b.level)),
  streak:  (a, b) => a.streak - b.streak,
  games:   (a, b) => a.games - b.games,
  walk:    (a, b) => a.wk.n - b.wk.n
};
function admBase(){ return adm.section === 'all' ? adm.students : adm.students.filter(s => adminKey(s) === adm.section); }
function admMatch(s, f, t){
  switch(f){
    case 'today': return s.lastActive > t.day;
    case 'week':  return s.lastActive > t.week;
    case 'idle':  return s.lastActive <= t.week;
    case 'wdone': return s.wk.total > 0 && s.wk.n >= s.wk.total;
    case 'wnot':  return s.wk.n < s.wk.total;
    default:      return true;
  }
}
function admVisible(){
  adm.students.forEach(s => { s.wk = admQuest(s); });
  const now = Date.now(), t = { day: now - 864e5, week: now - 6048e5 };
  let list = admBase();
  const words = adm.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(words.length) list = list.filter(s => {
    const hay = (s.name + ' ' + s.email + ' ' + s.level + ' ' + (adminKey(s) === ADMIN_NONE ? '' : s.classSection)).toLowerCase();
    return words.every(w => hay.indexOf(w) >= 0);
  });
  const counts = {}; ADM_FILTERS.forEach(f => { counts[f[0]] = list.filter(s => admMatch(s, f[0], t)).length; });
  list = list.filter(s => admMatch(s, adm.filter, t));
  const cmp = ADM_CMP[adm.sort] || ADM_CMP.recent, sign = adm.dir === 'asc' ? 1 : -1;
  list.sort((a, b) => (cmp(a, b) || a.name.localeCompare(b.name, undefined, { sensitivity:'base' })) * sign);
  return { list, counts };
}

/* ---------- user actions ---------- */
function setAdminSection(key){ adm.section = key; adm.page = 1; renderAdmin(); }
function admSetFilter(k){ adm.filter = k; adm.page = 1; admRenderStudents(); }
function admSortBy(k){
  if(adm.sort === k) adm.dir = adm.dir === 'asc' ? 'desc' : 'asc';
  else { adm.sort = k; adm.dir = ADM_DEFAULT_DIR[k] || 'desc'; }
  adm.page = 1; admRenderStudents();
}
function admSortSelect(k){ adm.sort = k; adm.dir = ADM_DEFAULT_DIR[k] || 'desc'; adm.page = 1; admRenderStudents(); }
let admSearchTimer = 0;
function admSearchInput(v){ clearTimeout(admSearchTimer); admSearchTimer = setTimeout(() => { adm.q = v; adm.page = 1; admRenderStudents(); }, 150); }
function admSetSize(v){ const n = parseInt(v, 10); if(ADM_SIZES.indexOf(n) < 0) return; adm.size = n; adm.page = 1; try{ localStorage.setItem('bitsAdminPageSize', String(n)); }catch(_){} admRenderStudents(); }
function admGoPage(p){
  adm.page = p; admRenderStudents();
  const panel = document.getElementById('adminStudentsPanel'); if(panel) panel.scrollIntoView({ behavior:'smooth', block:'start' });
}
function admClear(){ adm.q = ''; adm.filter = 'all'; adm.page = 1; const i = document.getElementById('adminSearch'); if(i) i.value = ''; admRenderStudents(); }

function admToggle(id){
  const item = document.querySelector(`.adm-item[data-id="${CSS.escape(id)}"]`); if(!item) return;
  const more = item.querySelector('.adm-more'), line = item.querySelector('.adm-line'), open = more.hidden;
  const s = adm.students.find(x => x.id === id); if(!s) return;
  if(open){
    adm.open.add(id); more.innerHTML = admDetail(s);
    if(!s.actLoaded) admFetchActivity(s).then(() => admSoon(true));
  } else adm.open.delete(id);
  more.hidden = !open; item.classList.toggle('open', open); line.setAttribute('aria-expanded', open);
  const list = document.getElementById('adminRows'); if(list) list._h = null;   // force the next refresh to rebuild rows from state
}

/* ---------- data loading ---------- */
function admFetchActivity(s){
  if(s.actPromise) return s.actPromise;
  s.actPromise = db.collection('users').doc(s.id).collection('activity').orderBy('at', 'desc').limit(40).get().then(snap => {
    s.activity = snap.docs.map(a => { const d = a.data(); return { ...d, ms: (d.at && d.at.toMillis) ? d.at.toMillis() : 0 }; }).sort((x, y) => y.ms - x.ms);
    s.games = s.activity.filter(a => a.type === 'game_played').length;
  }).catch(err => { console.error(err); s.actErr = true; }).then(() => { s.actLoaded = true; });
  return s.actPromise;
}
let admTimer = 0;
function admSoon(now){
  if(now){ clearTimeout(admTimer); admTimer = 0; renderAdmin(); return; }
  if(!admTimer) admTimer = setTimeout(() => { admTimer = 0; renderAdmin(); }, 400);
}
// Loads every student's recent activity in the background (6 at a time) so a big class never blocks the page.
async function admLoadAllActivity(token){
  const queue = adm.students.slice();
  adm.actTotal = queue.length; adm.actDone = 0;
  const worker = async () => {
    while(queue.length && token === adm.token){
      const s = queue.shift(); await admFetchActivity(s); adm.actDone++; admSoon();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  if(token === adm.token) admSoon(true);
}

async function loadAdminDashboard(force){
  if(!currentUser || !isAdminEmail(currentUser.email)) return;
  // opening the tab again within 2 minutes just shows what is already loaded (use Refresh for a new pull)
  if(!force && adm.students.length && Date.now() - adm.loadedAt < 120000){ renderAdmin(); return; }

  const token = ++adm.token;
  const msg = document.getElementById('adminLoadingMsg'), btn = document.getElementById('adminRefreshBtn');
  if(!adm.students.length){ msg.hidden = false; msg.className = 'adm-state'; msg.textContent = 'Loading students…'; }
  btn.disabled = true;
  try{
    const usersSnap = await db.collection('users').get();
    if(token !== adm.token) return;
    adm.students = usersSnap.docs.map(doc => {
      const u = doc.data();
      return {
        id: doc.id, name: u.displayName || u.email || '(no name)', email: u.email || '', level: u.level || '\u2014',
        classSection: classNormalize(u.classSection || ''),
        streak: calcStreaks(new Set(Array.isArray(u.activeDays) ? u.activeDays : [])).current,
        lastActive: u.lastSeenAt || u.lastLoginTimestamp || 0,
        qp: u.questProgress || null,
        activity: [], games: 0, actLoaded: false, actErr: false
      };
    });
    adm.loadedAt = Date.now();
    msg.hidden = true;
    renderAdmin();
    admLoadAllActivity(token);
  } catch(err){
    console.error(err);
    msg.hidden = false; msg.className = 'adm-state err';
    msg.textContent = `Couldn't load student data (${err.message}). Make sure the admin Firestore rules have been published.`;
  } finally {
    if(token === adm.token) btn.disabled = false;
  }
}

/* ---------- rendering ---------- */
function admDetail(s){
  const qs = adminQuests(), w = s.wk || admQuest(s);
  const sec = adminKey(s) === ADMIN_NONE ? 'Not set' : s.classSection;
  const quests = qs.map(q => {
    const v = w.done[q.id], ok = !!v;
    const when = ok ? ((typeof v === 'number' && v > 1e11) ? formatWhen(v) : 'Done') : 'Not yet';
    return `<div class="adm-q ${ok ? 'ok' : ''}"><i aria-hidden="true">${ok ? '\u2713' : ''}</i><span>${escapeHtml(q.ico || '')} ${escapeHtml(q.t)}</span><small>${when}</small></div>`;
  }).join('');
  const walk = w.started
    ? `<div class="adm-qlist">${quests}</div><p class="adm-note">Guided tour: <b>${w.tour ? 'taken' : 'not taken yet'}</b></p>`
    : `<p class="adm-note">No walkthrough data yet. It appears after this student next opens the site.</p>`;
  let ev;
  if(!s.actLoaded) ev = '<p class="adm-note">Loading activity…</p>';
  else if(s.actErr) ev = '<p class="adm-note">Couldn\u2019t load this student\u2019s activity.</p>';
  else if(!s.activity.length) ev = '<p class="adm-note">No activity recorded yet.</p>';
  else ev = `<div class="adm-events">${s.activity.slice(0, 8).map(a => `<div class="adm-ev"><span class="adm-ev-t">${formatWhen(a.ms)}</span><span>${describeActivity(a)}</span></div>`).join('')}</div>`;
  return `<div class="adm-meta"><span>\u2709 ${escapeHtml(s.email || 'no email')}</span><span>Level: <b>${escapeHtml(s.level)}</b></span><span>Section: <b>${escapeHtml(sec)}</b></span></div>
    <div class="adm-more-grid"><div><h4>Walkthrough \u00B7 ${w.n}/${w.total}</h4>${walk}</div><div><h4>Recent activity</h4>${ev}</div></div>`;
}

function admRow(s, t){
  const id = escapeHtml(s.id), w = s.wk, open = adm.open.has(s.id);
  const active = s.lastActive > t.day ? 'on' : s.lastActive > t.week ? 'wk' : '';
  const sec = adminKey(s) === ADMIN_NONE ? '<span class="adm-badge none">Not set</span>' : `<span class="adm-badge">${escapeHtml(s.classSection)}</span>`;
  return `<div class="adm-item ${open ? 'open' : ''}" data-id="${id}">
    <div class="adm-line adm-cols" role="button" tabindex="0" aria-expanded="${open}" title="Click to see walkthrough and recent activity" onclick="admToggle(this.parentNode.dataset.id)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();admToggle(this.parentNode.dataset.id);}">
      <div class="adm-who"><span class="adm-av" style="--h:${admHue(s.id)}" aria-hidden="true">${escapeHtml(admInitials(s.name))}</span><span class="adm-who-t"><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.email)}</small></span></div>
      <div class="adm-c adm-c-sec">${sec}</div>
      <div class="adm-c adm-c-lvl">${escapeHtml(s.level)}</div>
      <div class="adm-c adm-c-str">${s.streak} \uD83D\uDD25</div>
      <div class="adm-c adm-c-gm">${s.actLoaded ? s.games : '\u2013'}<span class="adm-unit"> games</span></div>
      <div class="adm-c adm-c-wk"><div class="adm-wkcell ${w.n >= w.total && w.total ? 'full' : ''}" title="${w.n} of ${w.total} quests done"><div class="adm-meter"><i style="width:${w.pct}%"></i></div><span>${w.n}/${w.total}</span></div></div>
      <div class="adm-c adm-c-last" title="${s.lastActive ? escapeHtml(formatWhen(s.lastActive)) : 'Never'}"><span class="adm-dot ${active}" aria-hidden="true"></span>${timeAgo(s.lastActive)}</div>
      <span class="adm-caret" aria-hidden="true">\u25B8</span>
    </div>
    <div class="adm-more" ${open ? '' : 'hidden'}>${open ? admDetail(s) : ''}</div>
  </div>`;
}

function admRenderStudents(){
  const { list, counts } = admVisible();
  const t = { day: Date.now() - 864e5, week: Date.now() - 6048e5 };
  const size = adm.size, pages = Math.max(1, Math.ceil(list.length / size));
  if(adm.page > pages) adm.page = pages;
  if(adm.page < 1) adm.page = 1;
  const from = (adm.page - 1) * size, slice = list.slice(from, from + size);
  const total = admBase().length;

  document.getElementById('adminStudentsTitle').textContent = adm.section === 'all' ? 'Students' : `Students \u00B7 ${adminLabel(adm.section)}`;
  document.getElementById('adminListCount').textContent = list.length === total ? plural(total, 'student') : `${list.length} of ${plural(total, 'student')}`;

  admSet(document.getElementById('adminChips'), ADM_FILTERS.map(([k, label]) =>
    `<button type="button" class="adm-chip ${adm.filter === k ? 'on' : ''}" aria-pressed="${adm.filter === k}" onclick="admSetFilter('${k}')">${label}<em>${counts[k]}</em></button>`).join(''));

  document.querySelectorAll('#adminColHead .adm-th').forEach(b => {
    const on = b.dataset.sort === adm.sort;
    b.classList.toggle('on', on);
    b.querySelector('.adm-arrow').textContent = on ? (adm.dir === 'asc' ? '\u25B2' : '\u25BC') : '';
  });
  const sel = document.getElementById('adminSort'); if(sel && sel.value !== adm.sort) sel.value = adm.sort;

  // keep keyboard focus on the same row if the list is rebuilt while data streams in
  const act = document.activeElement, focusId = (act && act.closest && act.closest('.adm-item')) ? act.closest('.adm-item').dataset.id : null;
  const rows = document.getElementById('adminRows');
  admSet(rows, slice.length
    ? slice.map(s => admRow(s, t)).join('')
    : (total
        ? `<div class="adm-empty"><b>No students match</b><span>Try a different search or filter.</span><button type="button" class="lecture-action-btn" onclick="admClear()">Clear search &amp; filters</button></div>`
        : `<div class="adm-empty"><b>${adm.students.length ? `No students in ${escapeHtml(adminLabel(adm.section))} yet` : 'No students yet'}</b><span>They appear here after they sign in.</span></div>`));
  if(focusId){ const f = rows.querySelector(`.adm-item[data-id="${CSS.escape(focusId)}"] .adm-line`); if(f && f !== document.activeElement) f.focus({ preventScroll:true }); }

  // pager
  const pager = document.getElementById('adminPager');
  if(!list.length){ admSet(pager, ''); return; }
  const nums = [];
  for(let p = 1; p <= pages; p++){ if(p === 1 || p === pages || Math.abs(p - adm.page) <= 1) nums.push(p); else if(nums[nums.length - 1] !== '\u2026') nums.push('\u2026'); }
  admSet(pager, `<span class="adm-range">Showing <b>${from + 1}\u2013${Math.min(list.length, from + size)}</b> of <b>${list.length}</b></span>
    <div class="adm-pages" ${pages <= 1 ? 'hidden' : ''}>
      <button type="button" class="adm-pg" ${adm.page === 1 ? 'disabled' : ''} onclick="admGoPage(${adm.page - 1})" aria-label="Previous page">\u2039</button>
      ${nums.map(n => n === '\u2026' ? '<span class="adm-gap">\u2026</span>' : `<button type="button" class="adm-pg ${n === adm.page ? 'on' : ''}" ${n === adm.page ? 'aria-current="page"' : ''} onclick="admGoPage(${n})">${n}</button>`).join('')}
      <button type="button" class="adm-pg" ${adm.page === pages ? 'disabled' : ''} onclick="admGoPage(${adm.page + 1})" aria-label="Next page">\u203A</button>
    </div>
    <label class="adm-size">Rows per page <select class="adm-select" onchange="admSetSize(this.value)">${ADM_SIZES.map(n => `<option value="${n}" ${n === adm.size ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`);
}

function admRenderSections(){
  const dayAgo = Date.now() - 864e5;
  const inSec = key => key === 'all' ? adm.students : adm.students.filter(s => adminKey(s) === key);
  const cards = [{ key:'all', icon:'\uD83D\uDC65' }, ...CLASS_SECTIONS.map(s => ({ key:s, icon:'\uD83C\uDFEB' }))];
  if(inSec(ADMIN_NONE).length) cards.push({ key:ADMIN_NONE, icon:'\u2754' });
  admSet(document.getElementById('adminSections'), cards.map(c => {
    const list = inSec(c.key), act = list.filter(s => s.lastActive > dayAgo).length, on = c.key === adm.section;
    return `<button type="button" class="adm-sec ${on ? 'on' : ''}" data-key="${escapeHtml(c.key)}" aria-pressed="${on}" onclick="setAdminSection(this.dataset.key)">
      <span class="adm-sec-ico" aria-hidden="true">${c.icon}</span>
      <span class="adm-sec-body"><b>${escapeHtml(adminLabel(c.key))}</b><span>${plural(list.length, 'student')} \u00B7 ${act} active today</span></span>
    </button>`;
  }).join(''));
}

function admRenderKpis(base){
  const now = Date.now(), dayAgo = now - 864e5, weekAgo = now - 6048e5;
  const stats = base.map(s => s.wk);
  const avg = stats.length ? Math.round(stats.reduce((a, w) => a + w.pct, 0) / stats.length) : 0;
  const fin = stats.filter(w => w.total && w.n >= w.total).length;
  const kpi = (n, l, sub) => `<div class="adm-kpi"><div class="n">${n}</div><div class="l">${l}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  admSet(document.getElementById('adminKpis'),
    kpi(base.length, 'Students') +
    kpi(base.filter(s => s.lastActive > dayAgo).length, 'Active in last 24h') +
    kpi(base.filter(s => s.lastActive > weekAgo).length, 'Active in last 7 days') +
    kpi(base.reduce((n, s) => n + s.games, 0), 'Games played (recent)') +
    kpi(avg + '%', 'Walkthrough average', `${fin} finished`));
}

function admRenderWalk(base){
  const qs = adminQuests(), stats = base.map(s => s.wk), n = stats.length;
  const fin = stats.filter(w => w.total && w.n >= w.total).length, none = stats.filter(w => w.n === 0).length, mid = n - fin - none;
  const avg = n ? Math.round(stats.reduce((a, w) => a + w.pct, 0) / n) : 0;
  document.getElementById('adminWalkSum').textContent = n ? `${avg}% average \u00B7 ${fin}/${n} finished` : '';
  if(!n){ admSet(document.getElementById('adminWalk'), '<p class="adm-note" style="padding:0 2px;">No students yet.</p>'); return; }
  const rows = qs.map(q => {
    const c = stats.filter(w => w.done[q.id]).length, p = Math.round(c / n * 100);
    return `<div class="adm-qrow"><span class="adm-qico" aria-hidden="true">${escapeHtml(q.ico || '')}</span><span class="adm-qname">${escapeHtml(q.t)}</span><div class="adm-meter"><i style="width:${p}%"></i></div><span class="adm-qnum">${c}/${n} <em>${p}%</em></span></div>`;
  }).join('');
  admSet(document.getElementById('adminWalk'), `<div class="adm-wk-pills">
      <div class="adm-pill ok"><span>Finished all ${qs.length}</span><b>${fin}</b></div>
      <div class="adm-pill"><span>In progress</span><b>${mid}</b></div>
      <div class="adm-pill none"><span>Not started</span><b>${none}</b></div>
    </div><div class="adm-wk-rows">${rows}</div>`);
}

function admRenderStatus(){
  const txt = document.getElementById('adminUpdatedTxt'), bar = document.getElementById('adminLoad'), fill = document.getElementById('adminLoadFill');
  if(!txt) return;
  const loading = adm.actTotal > 0 && adm.actDone < adm.actTotal;
  txt.textContent = adm.loadedAt ? `Updated ${timeAgo(adm.loadedAt)}${loading ? ` \u00B7 loading activity ${adm.actDone}/${adm.actTotal}` : ''}` : '';
  bar.hidden = !loading;
  if(loading) fill.style.width = Math.round(adm.actDone / adm.actTotal * 100) + '%';
}

function renderAdmin(){
  adm.students.forEach(s => { s.wk = admQuest(s); });
  if(adm.section === ADMIN_NONE && !adm.students.some(s => adminKey(s) === ADMIN_NONE)) adm.section = 'all';
  const base = admBase();
  admRenderSections();
  admRenderKpis(base);
  admRenderWalk(base);
  admRenderStudents();
  admRenderStatus();
}
setInterval(() => { const p = document.getElementById('page-admin'); if(p && p.classList.contains('active') && adm.students.length) admRenderStatus(); }, 30000);

// Downloads the students currently shown (after section / search / filter) as a spreadsheet-friendly CSV
function exportAdminCsv(){
  if(!adm.students.length) return;
  const { list } = admVisible(), qs = adminQuests();
  const esc = v => { v = String(v == null ? '' : v); if(/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = ['Name', 'Email', 'Section', 'Level', 'Streak', 'Games (recent)', 'Walkthrough done', 'Walkthrough total', ...qs.map(q => q.t), 'Took tour', 'Last active'];
  const rows = list.map(s => {
    const w = s.wk;
    return [s.name, s.email, adminKey(s) === ADMIN_NONE ? '' : s.classSection, s.level, s.streak, s.actLoaded ? s.games : '', w.n, w.total,
      ...qs.map(q => w.done[q.id] ? 'Yes' : 'No'), w.tour ? 'Yes' : 'No', s.lastActive ? new Date(s.lastActive).toLocaleString() : 'Never'];
  });
  const csv = '\ufeff' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `bits-students-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}


/* ================= HOME: WARM-UP CHALLENGE (number system conversions) ================= */
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
const WU_DIGITS = '0123456789ABCDEF';

// The six conversion types. Every type has a fixed range of numbers, so the warm-up knows every possible question.
//   from / to = number bases, lo / hi = the range of decimal values used to build the question.
const WU_TYPES = [
  { tag:'Binary \u2192 Decimal',     from:2,  to:10, lo:8,  hi:63  },
  { tag:'Decimal \u2192 Binary',     from:10, to:2,  lo:8,  hi:63  },
  { tag:'Binary \u2192 Octal',       from:2,  to:8,  lo:8,  hi:255 },
  { tag:'Octal \u2192 Binary',       from:8,  to:2,  lo:8,  hi:63  },
  { tag:'Binary \u2192 Hexadecimal', from:2,  to:16, lo:16, hi:255 },
  { tag:'Hexadecimal \u2192 Binary', from:16, to:2,  lo:16, hi:255 }
];
const WU_BASE_NAME = { 2:'binary', 8:'octal', 10:'decimal', 16:'hex' };
['bin-dec', 'dec-bin', 'bin-oct', 'oct-bin', 'bin-hex', 'hex-bin'].forEach((k, i) => { WU_TYPES[i].k = k; });
function wuFmt(n, base){ return n.toString(base).toUpperCase(); }
// What the student sees: binary numbers are shown in groups of 4 bits (display only, the answer is unchanged).
function wuShow(n, base){
  const s = wuFmt(n, base);
  if(base !== 2) return s;
  const g = [];
  for(let i = s.length; i > 0; i -= 4) g.unshift(s.slice(Math.max(0, i - 4), i));
  return g.join(' ');
}

// NO-REPEAT SYSTEM (a shuffled "deck", like a deck of cards):
//  1. Each type owns a shuffled deck of every number in its range. A number is dealt once, then it is gone.
//  2. The next TYPE comes from a shuffled bag that holds each of the 6 types once, so the types are mixed
//     evenly and the same type never shows up twice in a row.
//  3. A deck is only reshuffled after every number in it has been used (and the first card of the new
//     deck is never the card that was just dealt).
const wuDecks = [];
let wuBag = [], wuLastType = -1, wuLastNum = -1, wuCount = 0;

function wuDealNumber(t){
  const T = WU_TYPES[t];
  let deck = wuDecks[t];
  if(!deck || !deck.length){
    const all = [];
    for(let n = T.lo; n <= T.hi; n++) all.push(n);
    deck = shuffleArr(all);
    if(deck.length > 1 && t === wuLastType && deck[deck.length - 1] === wuLastNum) deck.unshift(deck.pop());
    wuDecks[t] = deck;
  }
  return deck.pop();
}
function wuNextType(){
  if(!wuBag.length){
    wuBag = shuffleArr(WU_TYPES.map((_, i) => i));
    if(wuBag[wuBag.length - 1] === wuLastType) wuBag.unshift(wuBag.pop());   // never the same type twice in a row
  }
  return wuBag.pop();
}

// Builds 4 different answer choices: the right one plus 3 look-alikes (one digit changed, or a nearby number).
function wuChoices(answer, base){
  const set = new Set([answer]);
  let guard = 0;
  while(set.size < 4 && guard++ < 400){
    let cand;
    if(base === 10){
      const n = parseInt(answer, 10) + randInt(1, 9) * (Math.random() < .5 ? -1 : 1);
      if(n < 1) continue;
      cand = String(n);
    } else {
      const chars = answer.split('');
      const pos = randInt(0, chars.length - 1);
      const d = WU_DIGITS[randInt(0, base - 1)];
      if(d === chars[pos]) continue;
      if(pos === 0 && d === '0' && chars.length > 1) continue;
      chars[pos] = d;
      cand = chars.join('');
    }
    set.add(cand);
  }
  return Array.from(set);
}

let wuStreak = 0, wuBest = 0, wuAnswered = false, wuCurrent = null;
try{ wuBest = parseInt(localStorage.getItem('genWarmupBest') || '0', 10) || 0; }catch(e){}

function newWarmup(){
  const t = wuNextType();
  const n = wuDealNumber(t);
  const T = WU_TYPES[t];
  wuLastType = t; wuLastNum = n; wuCount++;
  wuCurrent = { tag:T.tag, answer:wuFmt(n, T.to), base:T.to, type:t, n:n };
  wuAnswered = false;
  const list = shuffleArr(wuChoices(wuCurrent.answer, wuCurrent.base));

  document.getElementById('wuTag').textContent = '\uD83D\uDD22 ' + T.tag;
  document.getElementById('wuQuestion').innerHTML =
    `<span class="wu-q-part"><b class="wu-num">${escapeHtml(wuShow(n, T.from))}</b><i class="wu-base">${WU_BASE_NAME[T.from]}</i></span>` +
    `<span class="wu-q-arrow" aria-hidden="true">\u2192</span>` +
    `<span class="wu-q-part"><b class="wu-num wu-unknown">?</b><i class="wu-base">${WU_BASE_NAME[T.to]}</i></span>`;
  document.getElementById('wuQuestion').setAttribute('aria-label', `${wuFmt(n, T.from)} in ${WU_BASE_NAME[T.from]} equals what in ${WU_BASE_NAME[T.to]}?`);
  document.getElementById('wuOptions').innerHTML = list.map(v =>
    `<button class="wu-opt" data-val="${v}" onclick="answerWarmup(this)">${v}</button>`).join('');
  const fb = document.getElementById('wuFeedback');
  fb.textContent = 'Pick an answer!';
  fb.className = 'wu-feedback';
  document.getElementById('wuNext').classList.remove('show');
  const _ws = document.getElementById('wuSolution'); if(_ws){ _ws.hidden = true; _ws.innerHTML = ''; }
  document.getElementById('wuStreak').textContent = wuStreak;
  document.getElementById('wuBest').textContent = wuBest;
  document.getElementById('wuCount').textContent = wuCount;
}

// Wrong answer: show a short step-by-step solution under the question.
function showWuSolution(){
  const box = document.getElementById('wuSolution');
  if(!box || !wuCurrent) return;
  const item = CONV_ITEMS[WU_TYPES[wuCurrent.type].k];
  if(!item) return;
  const steps = convSolution(item, wuCurrent.n);
  box.innerHTML = `<div class="wu-sol-head">\uD83D\uDCA1 Here is how to solve it</div><ol class="wu-sol-steps">${steps.map(t => `<li>${escapeHtml(t).replace(/; /g, '<br>')}</li>`).join('')}</ol>`;
  box.hidden = false;
}

function answerWarmup(btn){
  if(wuAnswered) return;
  wuAnswered = true;
  markActiveToday();
  const right = btn.dataset.val === wuCurrent.answer;
  const fb = document.getElementById('wuFeedback');

  document.querySelectorAll('#wuOptions .wu-opt').forEach(b=>{
    b.disabled = true;
    if(b.dataset.val === wuCurrent.answer) b.classList.add('correct');
  });

  if(right){
    wuStreak++;
    if(wuStreak > wuBest){
      wuBest = wuStreak;
      try{ localStorage.setItem('genWarmupBest', String(wuBest)); }catch(e){}
    }
    const praise = wuStreak % 5 === 0 ? `\uD83C\uDF89 ${wuStreak} in a row! You're on fire!` : ['Nice one! \u2705','Correct! Keep going \uD83D\uDCAA','Spot on! \u2B50','Great job! \uD83D\uDE80'][randInt(0,3)];
    fb.textContent = praise;
    fb.className = 'wu-feedback good';
    const card = document.getElementById('warmup');
    card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
  } else {
    btn.classList.add('wrong');
    fb.textContent = `Not quite \u2014 the answer is ${wuCurrent.answer}. Try the next one!`;
    fb.className = 'wu-feedback bad';
    wuStreak = 0;
    showWuSolution();
  }
  document.getElementById('wuStreak').textContent = wuStreak;
  document.getElementById('wuBest').textContent = wuBest;
  document.getElementById('wuNext').classList.add('show');
}

newWarmup();


/* ================= MINI GAME ================= */
// A topic's `game` can have `levels:true` plus questions tagged level:'easy' | 'medium' | 'hard'.
// Then the student first picks a difficulty and only gets questions of that level.
let gameState = null;

const GAME_LEVELS = {
  easy:   { label:'Easy',   emoji:'🟢', cls:'lv-easy',   desc:'Warm-up questions to get you started' },
  medium: { label:'Medium', emoji:'🟡', cls:'lv-medium', desc:'A bit trickier. Time to think!' },
  hard:   { label:'Hard',   emoji:'🔴', cls:'lv-hard',   desc:'Challenge mode for math champions' }
};

function shuffleArr(a){
  const r = a.slice();
  for(let i = r.length - 1; i > 0; i--){ const k = Math.floor(Math.random() * (i + 1)); [r[i], r[k]] = [r[k], r[i]]; }
  return r;
}
// (kept for older question formats)
function shuffleOptions(q){
  const correct = q.options[q.answer];
  const opts = shuffleArr(q.options);
  return Object.assign({}, q, { options: opts, answer: opts.indexOf(correct) });
}

const BASE_NAMES = { 2:'Binary', 8:'Octal', 10:'Decimal', 16:'Hexadecimal' };
function baseLabel(b){ return (BASE_NAMES[b] || 'Base ' + b) + ' \u00B7 base ' + b; }

// Shows a binary number in groups of 4 bits (display only) so long numbers are easy to read.
function convDisplayNum(num, base, isExpr){
  const text = String(num);
  if(isExpr || base !== 2) return escapeHtml(text);
  const groups = [];
  for(let i = text.length; i > 0; i -= 4) groups.unshift(text.slice(Math.max(0, i - 4), i));
  return groups.map(g => `<span class="bit-grp">${escapeHtml(g)}</span>`).join('');
}

function correctAnswer(q){
  return (typeof q.answer === 'number' && q.options) ? String(q.options[q.answer]) : String(q.answer);
}
function normAnswer(v){ return String(v).replace(/[\u2212\u2013\u2014]/g,'-').replace(/[,\s]/g,'').toLowerCase(); }

// Binary / octal / hex answers: ignore spaces, upper/lower case, a 0b / 0o / 0x prefix and leading zeros.
function normBase(v, base){
  let s = String(v).replace(/[\s_,]/g, '').toLowerCase();
  if(base === 2) s = s.replace(/^0b/, '');
  else if(base === 8) s = s.replace(/^0o/, '');
  else if(base === 16) s = s.replace(/^0x/, '');
  return s.replace(/^0+(?=.)/, '');
}
const BASE_DIGITS = { 2:/^[01]+$/, 8:/^[0-7]+$/, 10:/^[0-9]+$/, 16:/^[0-9a-f]+$/ };
const BASE_DIGIT_MSG = {
  2:'Binary answers use only the digits 0 and 1.',
  8:'Octal answers use only the digits 0 to 7.',
  10:'Decimal answers use only the digits 0 to 9.',
  16:'Hex answers use only 0 to 9 and the letters A to F.'
};
function answerShapeError(v, q){
  const base = q && q.base;
  if(!base || !BASE_DIGITS[base]) return '';
  return BASE_DIGITS[base].test(normBase(v, base)) ? '' : BASE_DIGIT_MSG[base];
}
function answersMatch(a, b, q){
  const base = q && q.base;
  if(base === 2 || base === 8 || base === 16) return normBase(a, base) === normBase(b, base);
  const x = normAnswer(a), y = normAnswer(b);
  if(x !== '' && !isNaN(Number(x)) && !isNaN(Number(y))) return Number(x) === Number(y);
  return x === y;
}
function gameType(v){ if(gameState) gameState.typed = v; }
function gameFocusInput(){
  const inp = document.querySelector('#gameMount .game-input:not(:disabled)');
  if(inp) inp.focus({preventScroll:true});
}

// Personal best score for each game, kept in this browser.
function gameBestKey(s){ return 'genBest_' + s.topic.key + (s.level ? '_' + s.level : ''); }
function gameLoadBest(s){ try{ return parseInt(localStorage.getItem(gameBestKey(s)) || '0', 10) || 0; }catch(e){ return 0; } }
function gameSaveBest(s){ try{ localStorage.setItem(gameBestKey(s), String(s.best)); }catch(e){} }

function gameInit(topic){
  const g = topic.game || {};
  const bank = g.questions || [];
  const useLevels = !!g.levels && bank.some(q => q.level);
  gameState = {
    topic, bank, useLevels, level:null,
    questions: useLevels ? [] : bank,
    cta: g.cta || `Think you've mastered ${topic.title}? Take the challenge, beat your best score, and tap Show solution whenever you're stuck!`,
    idx:0, score:0, typed:'', checked:false, showSol:false, fb:'', fbClass:'',
    logged:false, best:0, bestDone:false, newBest:false, results:[]
  };
  gameState.best = gameLoadBest(gameState);
  renderGame();
}

function gameStartLevel(level){
  const s = gameState; if(!s) return;
  s.level = level;
  logGamePlay(s.topic.title, level);
  s.questions = shuffleArr(s.bank.filter(q => q.level === level));
  s.idx = 0; s.score = 0; s.results = []; s.typed = ''; s.checked = false; s.showSol = false; s.fb = ''; s.fbClass = '';
  s.best = gameLoadBest(s); s.bestDone = false; s.newBest = false;
  renderGame();
  gameFocusInput();
}

function gameBackToLevels(){
  const s = gameState; if(!s) return;
  s.level = null; s.questions = [];
  s.idx = 0; s.score = 0; s.results = []; s.typed = ''; s.checked = false; s.showSol = false; s.fb = ''; s.fbClass = '';
  renderGame();
}

function renderGame(){
  const s = gameState, mount = document.getElementById('gameMount');
  if(!s || !mount) return;

  const picking = s.useLevels && !s.level;
  const total = s.questions.length;
  const q = s.questions[s.idx];
  const preview = !picking && !q && total === 0;
  const finished = !picking && total > 0 && s.idx >= total;
  const pct = total ? Math.round(Math.min(s.idx, total) / total * 100) : 0;
  const lv = s.level ? GAME_LEVELS[s.level] : null;
  const qlv = (q && q.level && GAME_LEVELS[q.level]) ? GAME_LEVELS[q.level] : lv;

  // Save a new personal best once, the moment the game is finished.
  if(finished && !s.bestDone){
    s.bestDone = true;
    s.newBest = s.score > s.best;
    if(s.newBest){ s.best = s.score; gameSaveBest(s); }
  }

  let body;
  if(picking){
    const cards = Object.keys(GAME_LEVELS).map((key, i) => {
      const L = GAME_LEVELS[key], U = LEVEL_UI[key];
      const n = s.bank.filter(x => x.level === key).length;
      return `
        <button type="button" class="dp-card dp-${key}" style="--i:${i};" onclick="gameStartLevel('${key}')" ${n ? '' : 'disabled'} aria-label="${L.label} level">
          <span class="dp-orb" aria-hidden="true"></span>
          <span class="dp-name">${L.label}</span>
          <span class="dp-desc">${L.desc}</span>
          <span class="dp-meter" aria-hidden="true">${[1, 2, 3].map(b => `<i class="${b <= U.bars ? 'on' : ''}"></i>`).join('')}</span>
          <span class="dp-play">Start <b>→</b></span>
        </button>`;
    }).join('');
    body = `
      <h4 class="dp-title">Choose your difficulty</h4>
      <div class="dp-grid">${cards}</div>`;
  } else if(finished){
    const p = total ? Math.round(s.score / total * 100) : 0;
    const emoji = p === 100 ? '🏆' : p >= 80 ? '🎉' : p >= 50 ? '👏' : '💪';
    const msg = p === 100 ? 'Perfect score! You are a number-system master.'
              : p >= 80 ? 'Awesome work! Only a few more to master.'
              : p >= 50 ? 'Good effort! Re-read the quick lesson and try again.'
              : 'Keep practicing! Read the quick lesson above, then give it another go.';
    body = `
      <div class="game-finish">
        <div class="gf-emoji">${emoji}</div>
        <h4>${lv ? lv.label + ' level' : 'Challenge'} complete!</h4>
        <p>You scored <b>${s.score}</b> out of <b>${total}</b> (${p}%).</p>
        <p class="gf-msg">${msg}</p>
        ${s.newBest ? '<div class="gf-best">🌟 New personal best!</div>' : ''}
        <div class="game-actions">
          <button class="game-btn primary" onclick="${s.useLevels ? `gameStartLevel('${s.level}')` : 'gameRestart()'}">↺ Play again</button>
          ${s.useLevels ? `<button class="game-btn ghost" onclick="gameBackToLevels()">Change level</button>` : ''}
        </div>
      </div>`;
  } else {
    const isHex = !!(q && q.to === 16);
    const inCls = 'game-input' + (isHex ? ' hex' : '') + (s.checked ? (s.fbClass === 'good' ? ' correct' : ' wrong') : '');
    const inMode = (q && q.to && q.to !== 16) ? 'numeric' : 'text';

    const steps = (q && q.solution && q.solution.length ? q.solution : [null,null,null]).map((t,i)=>`
        <li><span class="gs-num">${i+1}</span><span class="${t===null?'placeholder':''}">${t===null ? 'Step ' + (i+1) + ' of the solution will appear here.' : escapeHtml(t)}</span></li>`).join('');

    const conv = (q && q.num) ? `
        <div class="conv-row">
          <div class="conv-box from"><b class="conv-num${q.expr ? ' expr' : ''}">${convDisplayNum(q.num, q.from, q.expr)}</b><span class="conv-sub">${baseLabel(q.from)}</span></div>
          <span class="conv-arrow" aria-hidden="true">→</span>
          <div class="conv-box to"><b class="conv-num">?</b><span class="conv-sub">${baseLabel(q.to)}</span></div>
        </div>` : '';

    body = `
      <div class="game-progress"><div class="game-progress-fill" style="width:${pct}%"></div></div>
      <div class="game-pips" role="img" aria-label="Question ${Math.min(s.idx+1, Math.max(total,1))} of ${total}">${Array.from({length:total}, (_, i) => `<span class="pip ${s.results && s.results[i] === true ? 'ok' : s.results && s.results[i] === false ? 'no' : ''} ${i === s.idx ? 'now' : ''}"></span>`).join('')}</div>
      <div class="game-q-card">
        <span class="game-q-label">${qlv ? qlv.emoji + ' ' + qlv.label + ' · ' : ''}Question ${Math.min(s.idx+1, Math.max(total,1))} of ${total || '–'}</span>
        <div class="game-q-text ${q?'':'placeholder'}">${q ? escapeHtml(q.q) : 'Your question will appear here'}</div>
        ${conv}
      </div>
      <div class="game-answer">
        <label class="game-answer-label" for="gameInput">${q && q.to ? 'Your answer in ' + (BASE_NAMES[q.to] || 'base ' + q.to).toLowerCase() : 'Your answer'}</label>
        <input id="gameInput" class="${inCls}" type="text" inputmode="${inMode}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
               placeholder="${q ? 'Type your answer here' : 'Your answer goes here'}" value="${escapeHtml(s.typed || '')}"
               ${s.checked || !q ? 'disabled' : ''}
               oninput="gameType(this.value)" onkeydown="if(event.key==='Enter'){ ${s.checked ? 'gameNext()' : 'gameCheck()'}; }">
      </div>
      <div class="game-feedback ${s.fbClass||''}">${s.fb || (preview ? 'This is a preview of the game. Questions are coming soon!' : 'Type your answer, then press Check.')}</div>
      <div class="game-actions">
        <button class="game-btn primary" onclick="gameCheck()">✓ Check answer</button>
        <button class="game-btn ghost" onclick="gameToggleSolution()">💡 ${s.showSol ? 'Hide solution' : 'Show solution'}</button>
        <button class="game-btn next ${s.checked && !preview ? 'show' : ''}" onclick="gameNext()">${s.idx + 1 >= total ? 'Finish ✓' : 'Next →'}</button>
      </div>
      <div class="game-solution ${s.showSol ? 'open' : ''}">
        <div class="gs-head">💡 How to solve it</div>
        <ol class="gs-steps">${steps}</ol>
        <div class="gs-answer"><span>Final answer</span><b class="${q?'':'placeholder'}">${q ? escapeHtml(correctAnswer(q)) : '—'}</b></div>
      </div>`;
  }

  const stats = picking ? '' : `
        <div class="game-stats">
          ${lv ? `<span class="game-pill ${lv.cls}">${lv.emoji} ${lv.label}</span>` : ''}
          <span class="game-pill">⭐ Score <b>${s.score}</b></span>
          <span class="game-pill">🏆 Best <b>${s.best}</b></span>
          <span class="game-pill">🎯 <b>${Math.min(s.idx+1, Math.max(total,1))}</b> / ${total || '–'}</span>
          ${s.useLevels ? `<button class="game-pill game-pill-btn" onclick="gameBackToLevels()">↩ Change level</button>` : ''}
        </div>`;

  skProblem = (!picking && q) ? { tag:`Question ${Math.min(s.idx + 1, Math.max(total, 1))} of ${total}`, text:q.q, num:q.num, from:q.from, to:q.to, expr:!!q.expr } : null;
  mount.innerHTML = `
    <div class="game-card">
      <div class="game-head">
        <div class="game-title-wrap">
          <span class="game-badge">🎮</span>
          <div>
            <div class="game-eyebrow">Mini game</div>
            <h3 class="game-title">${escapeHtml(s.topic.title)} Challenge</h3>
          </div>
        </div>${stats}
      </div>
      <div class="game-cta"><span>🚀</span><p>${escapeHtml(s.cta)}</p></div>
      ${body}
    </div>`;
  skPaintProblem();
}

function gameCheck(){
  const s = gameState; if(!s || s.checked) return;
  const q = s.questions[s.idx];
  if(!q){ s.fb = 'Preview only. Questions are coming soon!'; s.fbClass = ''; renderGame(); return; }
  if(!String(s.typed || '').trim()){ s.fb = 'Type your answer first!'; s.fbClass = 'bad'; renderGame(); gameFocusInput(); return; }
  const shapeErr = answerShapeError(s.typed, q);
  if(shapeErr){ s.fb = shapeErr + ' Fix it and press Check again.'; s.fbClass = 'bad'; renderGame(); gameFocusInput(); return; }
  s.checked = true;
  markActiveToday();
  if(!s.useLevels && !s.logged){ s.logged = true; logGamePlay(s.topic.title, s.topic.diff || null); }
  const ok = answersMatch(s.typed, correctAnswer(q), q);
  s.results[s.idx] = ok;
  if(ok){ s.score++; s.fb = 'Correct! Great job! ⭐'; s.fbClass = 'good'; }
  else { s.fb = 'Not quite. Press Show solution to see how it works.'; s.fbClass = 'bad'; }
  renderGame();
}

function gameToggleSolution(){
  if(!gameState) return;
  gameState.showSol = !gameState.showSol;
  renderGame();
}

function gameNext(){
  const s = gameState; if(!s || !s.checked) return;
  s.idx++; s.typed = ''; s.checked = false; s.showSol = false; s.fb = ''; s.fbClass = '';
  renderGame();
  gameFocusInput();   // no auto-scroll between questions: the page stays exactly where the student is
  // When the whole set is finished the page gets shorter; only if the result card ended up off-screen, bring it into view (centred, no jump to the top).
  if(s.idx >= s.questions.length){
    const f = document.querySelector('#gameMount .game-finish');
    if(f){ const r = f.getBoundingClientRect(); if(r.top < 70 || r.bottom > window.innerHeight - 70) f.scrollIntoView({ block:'center', behavior:'smooth' }); }
  }
}

function gameRestart(){ gameInit(gameState.topic); }


/* ================= STREAK CALENDAR (tracks the days a student practiced) ================= */
// A day counts as "active" when the student opens the app, a lesson, answers a warm-up question
// or checks an answer in a mini game. Signed-in students are saved to their account
// (users/{uid}.activeDays); signed-out visitors are saved in this browser only.
const ACTIVE_KEY = 'genActiveDays';
let activeDays = new Set();
let calView = new Date(); calView.setDate(1);

function dayKey(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function parseDayKey(k){ const p = k.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }

function loadLocalDays(){
  try{ JSON.parse(localStorage.getItem(ACTIVE_KEY) || '[]').forEach(k => activeDays.add(k)); }catch(e){}
}
function saveLocalDays(){
  try{ localStorage.setItem(ACTIVE_KEY, JSON.stringify(Array.from(activeDays))); }catch(e){}
}

async function loadActiveDaysForUser(uid, data){
  (Array.isArray(data.activeDays) ? data.activeDays : []).forEach(k => activeDays.add(k));
  renderStreakCalendar();
  try{
    // also count days from the student's earlier activity log
    const snap = await db.collection('users').doc(uid).collection('activity').orderBy('at','desc').limit(500).get();
    snap.forEach(doc => { const a = doc.data(); if(a.at && a.at.toDate) activeDays.add(dayKey(a.at.toDate())); });
  }catch(e){ console.warn('Could not read activity history', e); }
  renderStreakCalendar();
  db.collection('users').doc(uid).set({ streak: calcStreaks().current }, {merge:true}).catch(console.error);
}

function markActiveToday(){
  const key = dayKey(new Date());
  if(activeDays.has(key)) return;
  activeDays.add(key);
  if(currentUser){
    db.collection('users').doc(currentUser.uid)
      .set({ activeDays: firebase.firestore.FieldValue.arrayUnion(key), streak: calcStreaks().current }, {merge:true}).catch(console.error);
  } else {
    saveLocalDays();
  }
  renderStreakCalendar();
}

function calcStreaks(days = activeDays){
  const has = d => days.has(dayKey(d));
  const d = new Date(); d.setHours(0,0,0,0);
  let current = 0;
  if(!has(d)) d.setDate(d.getDate() - 1);          // today isn't over yet: yesterday keeps the streak alive
  while(has(d)){ current++; d.setDate(d.getDate() - 1); }

  let best = 0, run = 0, prev = null;
  Array.from(days).map(parseDayKey).sort((a,b) => a - b).forEach(dt => {
    run = (prev && Math.round((dt - prev) / 86400000) === 1) ? run + 1 : 1;
    if(run > best) best = run;
    prev = dt;
  });
  return { current, best };
}

function calPrev(){ calView.setMonth(calView.getMonth() - 1); renderStreakCalendar(); }
function calNext(){ calView.setMonth(calView.getMonth() + 1); renderStreakCalendar(); }

function renderStreakCalendar(){
  const el = document.getElementById('streakCalendar');
  if(!el) return;
  const y = calView.getFullYear(), m = calView.getMonth();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const startDay = new Date(y, m, 1).getDay();
  const todayKey = dayKey(new Date());
  const { current, best } = calcStreaks();
  if(currentUser){ const st = document.getElementById('statStreak'); if(st) st.textContent = current; }
  const now = new Date();
  const atCurrentMonth = y === now.getFullYear() && m === now.getMonth();

  let cells = '', monthActive = 0;
  for(let i = 0; i < startDay; i++) cells += '<span class="sc-cell empty"></span>';
  for(let d = 1; d <= daysInMonth; d++){
    const k = dayKey(new Date(y, m, d));
    const active = activeDays.has(k);
    if(active) monthActive++;
    const cls = ['sc-cell', active ? 'active' : '', k === todayKey ? 'today' : '', k > todayKey ? 'future' : ''].join(' ');
    cells += `<span class="${cls}" title="${k}${active ? ' - active' : ''}"><b>${d}</b>${active ? '<i>🔥</i>' : ''}</span>`;
  }

  const todayDone = activeDays.has(todayKey);
  const msg = todayDone ? '🎉 You showed up today! Come back tomorrow to keep your streak going.'
            : current > 0 ? `🔥 Open the app today to keep your ${current}-day streak alive!`
            : 'Use the app every day to build your streak!';

  el.innerHTML = `
    <div class="sc-stats">
      <div class="sc-stat"><span class="sc-num">${current}</span><span class="sc-label">🔥 Current streak</span></div>
      <div class="sc-stat"><span class="sc-num">${best}</span><span class="sc-label">🏆 Longest streak</span></div>
      <div class="sc-stat"><span class="sc-num">${monthActive}</span><span class="sc-label">📅 Active this month</span></div>
    </div>
    <div class="sc-month">
      <button class="sc-nav" onclick="calPrev()" aria-label="Previous month">‹</button>
      <span>${calView.toLocaleString('en-US', { month:'long', year:'numeric' })}</span>
      <button class="sc-nav" onclick="calNext()" aria-label="Next month" ${atCurrentMonth ? 'disabled' : ''}>›</button>
    </div>
    <div class="sc-week">${['S','M','T','W','T','F','S'].map(w => `<span>${w}</span>`).join('')}</div>
    <div class="sc-grid">${cells}</div>
    <div class="sc-legend"><span><i class="lg lg-active"></i> Active day</span><span><i class="lg lg-today"></i> Today</span></div>
    <div class="sc-msg ${todayDone ? 'done' : ''}">${msg}</div>
    ${currentUser ? '' : '<div class="sc-note">Sign in to save your streak to your account.</div>'}`;
}

loadLocalDays();
renderStreakCalendar();


/* ================= SKETCHPAD (scratch space on every lesson page) ================= */
// Each topic (Binary to Decimal, Decimal to Binary, and so on) gets its own sketchpad under the mini game.
// Drawings are kept per topic while the page is open, so switching topics and coming back keeps your work.
const SKETCH_COLORS = [
  {name:'Ink',    val:'#1E3A3A'},
  {name:'Teal',   val:'#3D8A8A'},
  {name:'Orange', val:'#E8873A'},
  {name:'Red',    val:'#E5584F'},
  {name:'Blue',   val:'#2E86DE'},
  {name:'Purple', val:'#7C5CD6'},
  {name:'Green',  val:'#5B8C3E'}
];
const sketchPrefs = { tool:'pen', color:'#1E3A3A', size:4, bg:'grid' };
const sketchStore = {};      // topic key -> { strokes:[], redo:[], w, h }
let sketch = null;           // the sketchpad that is currently on screen
let skProblem = null;        // the problem the student is working on right now (set by the mini game / practice)

// Shows the current problem at the top of the sketch pad (it stays visible when the pad is maximized).
function skPaintProblem(){
  const el = document.getElementById('skProblem');
  if(!el) return;
  // a short highlight each time the problem changes, so the student notices the new question
  const key = skProblem ? [skProblem.tag, skProblem.text, skProblem.num, skProblem.from, skProblem.to].join('|') : '';
  const changed = key !== (el.dataset.key || '');
  el.dataset.key = key;
  if(!skProblem){
    el.className = 'sk-problem empty';
    el.innerHTML = '<span class="skp-tag">Current problem</span><span class="skp-text">Start the mini game and its question will show up here.</span><span class="skp-eq"><b class="skp-num unk">?</b></span>';
    return;
  }
  const p = skProblem, bl = b => (BASE_NAMES[b] || 'base ' + b).toLowerCase();
  const target = p.to ? `<span class="skp-arrow" aria-hidden="true">\u2192</span><b class="skp-num unk">?</b><span class="skp-base">${escapeHtml(bl(p.to))}</span>` : '';
  el.className = 'sk-problem';
  el.innerHTML = `<span class="skp-tag">${escapeHtml(p.tag)}</span><span class="skp-text">${escapeHtml(p.text)}</span>` +
    (p.num ? `<span class="skp-eq"><b class="skp-num">${convDisplayNum(p.num, p.from, p.expr)}</b><span class="skp-base">${escapeHtml(bl(p.from))}</span>${target}</span>` : '');
  if(changed){ el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
}

// The problem bar sticks just under the top bar while the student scrolls through the sketch pad, so measure that bar once and on resize.
function skSyncTopOffset(){
  const nav = document.querySelector('.topnav');
  const h = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--sk-top', (h + 8) + 'px');
}
window.addEventListener('resize', skSyncTopOffset);

function skMid(a, b){ return { x:(a.x + b.x) / 2, y:(a.y + b.y) / 2 }; }

function sketchInit(topic){
  const mount = document.getElementById('sketchMount');
  if(sketch && sketch.ro) sketch.ro.disconnect();
  sketchResetMax();               // drop any leftover full-screen overlay from a previous lesson
  sketch = null;
  if(!mount) return;

  const entry = sketchStore[topic.key] || (sketchStore[topic.key] = { strokes:[], redo:[], w:0, h:0 });
  if(!entry.view) entry.view = { z:1, x:0, y:0 };      // zoom level and pan, remembered for this topic

  const colorBtns = SKETCH_COLORS.map(c =>
    `<button class="sk-color" data-color="${c.val}" style="background:${c.val};" title="${c.name}" aria-label="${c.name} pen" onclick="sketchSetColor('${c.val}')"></button>`).join('');

  mount.innerHTML = `
    <div class="game-card sketch-card">
      <div class="game-head">
        <div class="game-title-wrap">
          <span class="game-badge">✏️</span>
          <div>
            <h3 class="game-title">Sketch pad</h3>
          </div>
        </div>
        <button type="button" class="sk-btn sk-max-btn" id="skMaxBtn" onclick="sketchToggleMax()" aria-label="Maximize sketchpad" aria-pressed="false">
          <svg class="sk-max-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="sk-ico-max" d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/><path class="sk-ico-min" d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/></svg>
          <span id="skMaxTxt">Maximize</span>
        </button>
      </div>
      <div class="sk-problem" id="skProblem" aria-live="polite"></div>

      <div class="sk-toolbar">
        <div class="sk-group">
          <button class="sk-btn" data-tool="pen" onclick="sketchSetTool('pen')">✏️ Pen</button>
          <button class="sk-btn" data-tool="eraser" onclick="sketchSetTool('eraser')">🧽 Eraser</button>
          <button class="sk-btn" data-tool="hand" onclick="sketchSetTool('hand')" title="Drag to move around the page">✋ Move</button>
        </div>
        <div class="sk-group" role="group" aria-label="Pen colors">${colorBtns}</div>
        <label class="sk-size">Size <input type="range" id="skSize" min="2" max="24" step="1" value="${sketchPrefs.size}" oninput="sketchSetSize(this.value)"><b id="skSizeVal">${sketchPrefs.size}</b></label>
      </div>

      <div class="sk-wrap sk-bg-${sketchPrefs.bg}" id="skWrap">
        <canvas class="sk-canvas" id="skCanvas" tabindex="0" aria-label="Sketchpad drawing area. Pinch with two fingers to zoom, or use the zoom buttons."></canvas>
        <div class="sk-zoom" role="group" aria-label="Zoom">
          <button type="button" class="sk-zbtn" onclick="sketchZoomBy(0.8)" aria-label="Zoom out">−</button>
          <button type="button" class="sk-zbtn sk-zval" id="skZoomVal" onclick="sketchZoomReset()" title="Back to 100%" aria-label="Reset zoom">100%</button>
          <button type="button" class="sk-zbtn" onclick="sketchZoomBy(1.25)" aria-label="Zoom in">+</button>
        </div>
      </div>

      <div class="sk-toolbar sk-toolbar-bottom">
        <div class="sk-group">
          <button class="sk-btn" id="skUndo" onclick="sketchUndo()">↶ Undo</button>
          <button class="sk-btn" id="skRedo" onclick="sketchRedo()">↷ Redo</button>
          <button class="sk-btn" id="skClear" onclick="sketchClear()">🗑 Clear</button>
        </div>
        <div class="sk-group">
          <button class="sk-btn" data-bg="grid" onclick="sketchSetBg('grid')">Grid</button>
          <button class="sk-btn" data-bg="lines" onclick="sketchSetBg('lines')">Lines</button>
          <button class="sk-btn" data-bg="plain" onclick="sketchSetBg('plain')">Plain</button>
        </div>
      </div>
    </div>`;

  const cv = document.getElementById('skCanvas');
  sketch = { topic, entry, canvas:cv, ctx:cv.getContext('2d'), dpr:1, k:1, max:false, busy:false, ph:null, bd:null, cur:null, pid:null, ro:null, ptrs:new Map(), g:null, pan:null, lock:false, space:false, raf:0 };
  sketchBindCanvas();

  // The lesson page is hidden until everything is built, so size the canvas whenever it actually becomes visible.
  if(window.ResizeObserver){
    sketch.ro = new ResizeObserver(() => sketchFit());
    sketch.ro.observe(cv);
  }
  sketchFit();
  sketchSyncUI();
  skSyncTopOffset();
  skPaintProblem();
}

// Matches the canvas' pixel size to its on-screen size (sharp on retina screens) and redraws the saved strokes.
function sketchFit(){
  const s = sketch; if(!s) return;
  const w = s.canvas.clientWidth, h = s.canvas.clientHeight;
  if(!w || !h) return;                       // still hidden
  const e = s.entry;
  if(s.max){
    // Maximized = a zoom: the drawing keeps its shape and simply scales with the width.
    s.k = e.w ? w / e.w : 1;
  } else {
    s.k = 1;
    if(e.w && e.h && (e.w !== w || e.h !== h)){   // window resized or phone rotated: scale the drawing with it
      const kx = w / e.w, ky = h / e.h;
      e.strokes.concat(e.redo).forEach(st => { if(st.pts) st.pts.forEach(p => { p.x *= kx; p.y *= ky; }); });
      if(e.view){ e.view.x *= kx; e.view.y *= ky; }
    }
    e.w = w; e.h = h;
  }
  s.dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w * s.dpr), ph = Math.round(h * s.dpr);
  if(s.canvas.width !== pw || s.canvas.height !== ph){ s.canvas.width = pw; s.canvas.height = ph; }
  skApplyView();
  sketchRedraw();
}

function sketchStyle(ctx, st){
  ctx.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = st.color; ctx.fillStyle = st.color;
  ctx.lineWidth = st.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
}

function sketchDrawStroke(ctx, st){
  const p = st.pts; if(!p.length) return;
  sketchStyle(ctx, st);
  ctx.beginPath();
  if(p.length === 1){
    ctx.arc(p[0].x, p[0].y, st.size / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.moveTo(p[0].x, p[0].y);
    const m0 = skMid(p[0], p[1]); ctx.lineTo(m0.x, m0.y);
    for(let i = 1; i < p.length - 1; i++){
      const m = skMid(p[i], p[i + 1]);
      ctx.quadraticCurveTo(p[i].x, p[i].y, m.x, m.y);
    }
    ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function sketchRedraw(){
  const s = sketch; if(!s) return;
  const ctx = s.ctx, sc = s.dpr * s.k, v = s.entry.view;
  const wipe = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, s.canvas.width, s.canvas.height); ctx.setTransform(sc * v.z, 0, 0, sc * v.z, sc * v.x, sc * v.y); };
  wipe();
  s.entry.strokes.forEach(st => { if(st.clear) wipe(); else sketchDrawStroke(ctx, st); });
}

// Draws just the newest bit of the stroke while the pen is moving (fast and smooth).
function sketchLiveSegment(final){
  const s = sketch, st = s.cur, p = st.pts, n = p.length, ctx = s.ctx;
  const sc = s.dpr * s.k, v = s.entry.view;
  ctx.setTransform(sc * v.z, 0, 0, sc * v.z, sc * v.x, sc * v.y);
  sketchStyle(ctx, st);
  ctx.beginPath();
  if(n === 1){
    ctx.arc(p[0].x, p[0].y, st.size / 2, 0, Math.PI * 2); ctx.fill();
  } else if(n === 2){
    const m = skMid(p[0], p[1]); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(m.x, m.y); ctx.stroke();
  } else {
    const a = skMid(p[n - 3], p[n - 2]), b = skMid(p[n - 2], p[n - 1]);
    ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(p[n - 2].x, p[n - 2].y, b.x, b.y); ctx.stroke();
  }
  if(final && n >= 2){
    const m = skMid(p[n - 2], p[n - 1]);
    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(p[n - 1].x, p[n - 1].y); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------- Zoom and pan ----------
   The drawing lives in "page units". entry.view = { z, x, y } says how the page is shown on the canvas:
   a page point (px, py) appears at  (px * z + x, py * z + y)  in canvas units. Pinching changes z and x/y. */
const SK_ZMIN = 0.5, SK_ZMAX = 8;
function skClamp(n, lo, hi){ return Math.min(hi, Math.max(lo, n)); }
function sketchSetView(x, y, z){
  const s = sketch; if(!s) return;
  const k = s.k || 1, W = s.canvas.clientWidth / k, H = s.canvas.clientHeight / k;
  z = skClamp(z, SK_ZMIN, SK_ZMAX);
  const v = s.entry.view;
  v.z = z;
  v.x = skClamp(x, 60 - W * z, W - 60);      // never let the page slide completely out of sight
  v.y = skClamp(y, 60 - H * z, H - 60);
  if(!s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; skApplyView(); sketchRedraw(); });
}
// zoom by a factor around a point (cx, cy in canvas units); default = the middle of the canvas
function sketchZoomBy(factor, cx, cy){
  const s = sketch; if(!s) return;
  const k = s.k || 1, v = s.entry.view;
  if(cx == null) cx = s.canvas.clientWidth / k / 2;
  if(cy == null) cy = s.canvas.clientHeight / k / 2;
  const z = skClamp(v.z * factor, SK_ZMIN, SK_ZMAX);
  const px = (cx - v.x) / v.z, py = (cy - v.y) / v.z;      // the page point under (cx, cy) stays put
  sketchSetView(cx - px * z, cy - py * z, Math.abs(z - 1) < 0.03 ? 1 : z);
}
function sketchZoomReset(){ sketchSetView(0, 0, 1); }
// shows the zoom on the grid / lines behind the drawing and on the zoom buttons
function skApplyView(){
  const s = sketch; if(!s) return;
  const v = s.entry.view, k = s.k || 1;
  const wrap = document.getElementById('skWrap');
  if(wrap){
    wrap.style.setProperty('--sk-k', k * v.z);
    wrap.style.setProperty('--sk-x', (v.x * k) + 'px');
    wrap.style.setProperty('--sk-y', (v.y * k) + 'px');
  }
  const lbl = document.getElementById('skZoomVal');
  if(lbl){
    lbl.textContent = Math.round(v.z * 100) + '%';
    lbl.classList.toggle('is-zoomed', v.z !== 1 || v.x !== 0 || v.y !== 0);
  }
}

function sketchBindCanvas(){
  const s = sketch, cv = s.canvas;
  const view = () => s.entry.view;
  // a pointer position in canvas units (before zoom), and the same position on the page being drawn on
  const local = ev => { const r = cv.getBoundingClientRect(), k = s.k || 1; return { x:(ev.clientX - r.left) / k, y:(ev.clientY - r.top) / k }; };
  const pos = ev => { const p = local(ev), v = view(); return { x:(p.x - v.x) / v.z, y:(p.y - v.y) / v.z }; };

  const dropStroke = () => { if(s.cur){ s.cur = null; s.pid = null; sketchRedraw(); } };

  // two fingers down: stop drawing and start a pinch (zoom) + drag (pan)
  const startPinch = () => {
    dropStroke();
    if(s.pan){ s.pan = null; cv.classList.remove('is-panning'); }
    const ids = Array.from(s.ptrs.keys()).slice(0, 2);
    const A = s.ptrs.get(ids[0]), B = s.ptrs.get(ids[1]);
    const r = cv.getBoundingClientRect(), k = s.k || 1, v = view();
    s.g = {
      a:ids[0], b:ids[1], d0:Math.max(1, Math.hypot(A.x - B.x, A.y - B.y)),
      m0:{ x:((A.x + B.x) / 2 - r.left) / k, y:((A.y + B.y) / 2 - r.top) / k },
      v0:{ z:v.z, x:v.x, y:v.y }
    };
    s.lock = true;
  };
  const updatePinch = () => {
    const g = s.g, A = s.ptrs.get(g.a), B = s.ptrs.get(g.b); if(!A || !B) return;
    const r = cv.getBoundingClientRect(), k = s.k || 1;
    const mx = ((A.x + B.x) / 2 - r.left) / k, my = ((A.y + B.y) / 2 - r.top) / k;
    const z = skClamp(g.v0.z * Math.hypot(A.x - B.x, A.y - B.y) / g.d0, SK_ZMIN, SK_ZMAX);
    const px = (g.m0.x - g.v0.x) / g.v0.z, py = (g.m0.y - g.v0.y) / g.v0.z;   // page point that was between the fingers
    sketchSetView(mx - px * z, my - py * z, z);                                // keep it between the fingers
  };
  const startPan = e => {
    const p = local(e), v = view();
    s.pan = { pid:e.pointerId, sx:p.x, sy:p.y, vx:v.x, vy:v.y };
    cv.classList.add('is-panning');
  };

  cv.addEventListener('pointerdown', e => {
    if(e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    if(s.busy) return;                 // wait for the zoom animation to finish before drawing
    e.preventDefault();
    cv.focus({ preventScroll:true });
    try{ cv.setPointerCapture(e.pointerId); }catch(_){}
    if(e.pointerType === 'touch'){
      s.ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if(s.ptrs.size >= 2){ if(!s.g) startPinch(); return; }
      if(s.lock) return;
    }
    if(s.g || s.pan) return;
    if(e.button === 1 || s.space || sketchPrefs.tool === 'hand'){ startPan(e); return; }
    const P = sketchPrefs, erase = P.tool === 'eraser', z = view().z;
    s.pid = e.pointerId;
    // the pen keeps the same size on screen at every zoom level, so zooming in lets you write finer detail
    s.cur = { color:P.color, size:(erase ? P.size * 3 + 6 : P.size) / z, erase, pts:[pos(e)] };
    sketchLiveSegment(false);
  });
  cv.addEventListener('pointermove', e => {
    if(e.pointerType === 'touch' && s.ptrs.has(e.pointerId)) s.ptrs.set(e.pointerId, { x:e.clientX, y:e.clientY });
    if(s.g){ updatePinch(); return; }
    if(s.pan){
      if(e.pointerId === s.pan.pid){ const p = local(e); sketchSetView(s.pan.vx + (p.x - s.pan.sx), s.pan.vy + (p.y - s.pan.sy), view().z); }
      return;
    }
    if(!s.cur || e.pointerId !== s.pid) return;
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    (evs.length ? evs : [e]).forEach(ev => { s.cur.pts.push(pos(ev)); sketchLiveSegment(false); });
  });
  const end = e => {
    if(e.pointerType === 'touch'){
      s.ptrs.delete(e.pointerId);
      if(s.g && (e.pointerId === s.g.a || e.pointerId === s.g.b)) s.g = null;
      if(!s.ptrs.size) s.lock = false;
    }
    if(s.pan && e.pointerId === s.pan.pid){ s.pan = null; cv.classList.remove('is-panning'); return; }
    if(!s.cur || e.pointerId !== s.pid) return;
    sketchLiveSegment(true);
    s.entry.strokes.push(s.cur);
    s.entry.redo = [];
    s.cur = null; s.pid = null;
    sketchSyncUI();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('contextmenu', e => e.preventDefault());

  // computers: pinch on a trackpad (or Ctrl + scroll) zooms; scrolling while zoomed in moves around
  cv.addEventListener('wheel', e => {
    const v = view(), k = s.k || 1;
    if(e.ctrlKey || e.metaKey){
      e.preventDefault();
      const p = local(e);
      sketchZoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)), p.x, p.y);
    } else if(v.z > 1.001){
      e.preventDefault();
      sketchSetView(v.x - e.deltaX / k, v.y - e.deltaY / k, v.z);
    }
  }, { passive:false });
  // Safari: stop the whole page from zooming while pinching on the sketchpad
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(n => cv.addEventListener(n, e => e.preventDefault()));

  cv.addEventListener('keydown', e => {
    if(e.key === ' ' && !s.space){ s.space = true; cv.classList.add('tool-hand'); e.preventDefault(); return; }   // hold Space + drag to move
    if(!(e.ctrlKey || e.metaKey)){
      if(e.key === '+' || e.key === '='){ e.preventDefault(); sketchZoomBy(1.25); }
      else if(e.key === '-' || e.key === '_'){ e.preventDefault(); sketchZoomBy(0.8); }
      else if(e.key === '0'){ e.preventDefault(); sketchZoomReset(); }
      return;
    }
    const k = e.key.toLowerCase();
    if(k === 'z'){ e.preventDefault(); e.shiftKey ? sketchRedo() : sketchUndo(); }
    else if(k === 'y'){ e.preventDefault(); sketchRedo(); }
  });
  cv.addEventListener('keyup', e => { if(e.key === ' '){ s.space = false; sketchSyncUI(); } });
  cv.addEventListener('blur', () => { if(s.space){ s.space = false; sketchSyncUI(); } });

  // hide the site's custom cursor badge while drawing so the crosshair is the only pointer
  cv.addEventListener('pointerenter', () => document.body.classList.add('sketch-hover'));
  cv.addEventListener('pointerleave', () => { if(!s.cur && !s.pan) document.body.classList.remove('sketch-hover'); });
  cv.addEventListener('lostpointercapture', () => { if(!cv.matches(':hover')) document.body.classList.remove('sketch-hover'); });
}

function sketchHasInk(){
  const st = sketch ? sketch.entry.strokes : [];
  return st.length > 0 && !st[st.length - 1].clear;
}

function sketchSetTool(t){ sketchPrefs.tool = t; sketchSyncUI(); }
function sketchSetColor(c){ sketchPrefs.color = c; sketchPrefs.tool = 'pen'; sketchSyncUI(); }
function sketchSetSize(v){ sketchPrefs.size = Number(v) || 4; sketchSyncUI(); }
function sketchSetBg(b){ sketchPrefs.bg = b; sketchSyncUI(); }

function sketchUndo(){
  if(!sketch) return;
  const e = sketch.entry; if(!e.strokes.length) return;
  e.redo.push(e.strokes.pop());
  sketchRedraw(); sketchSyncUI();
}
function sketchRedo(){
  if(!sketch) return;
  const e = sketch.entry; if(!e.redo.length) return;
  e.strokes.push(e.redo.pop());
  sketchRedraw(); sketchSyncUI();
}
// Clear is itself an undo-able step, so a mis-tap never loses work for good.
function sketchClear(){
  if(!sketch || !sketchHasInk()) return;
  sketch.entry.strokes.push({ clear:true });
  sketch.entry.redo = [];
  sketchRedraw(); sketchSyncUI();
}

/* ---------- Maximize / minimize (zoom the sketchpad to full screen and back) ---------- */
const SK_ANIM_MS = 420;
function skReducedMotion(){ return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
function skMaxRect(){
  const vw = document.documentElement.clientWidth, vh = window.innerHeight, m = vw < 700 ? 0 : 16;
  return { top:m, left:m, width:vw - m * 2, height:vh - m * 2 };
}
function skSetGeo(card, g){
  card.style.top = g.top + 'px'; card.style.left = g.left + 'px';
  card.style.width = g.width + 'px'; card.style.height = g.height + 'px';
}
// runs fn once the card has finished its size transition (with a safety timeout)
function skAfterMove(card, fn){
  let done = false;
  const finish = () => { if(done) return; done = true; card.removeEventListener('transitionend', onEnd); fn(); };
  const onEnd = e => { if(e.target === card && e.propertyName === 'width') finish(); };
  card.addEventListener('transitionend', onEnd);
  setTimeout(finish, skReducedMotion() ? 30 : SK_ANIM_MS + 160);
}
function skSetBtn(isMax){
  const btn = document.getElementById('skMaxBtn'), txt = document.getElementById('skMaxTxt');
  if(txt) txt.textContent = isMax ? 'Minimize' : 'Maximize';
  if(btn){
    btn.classList.toggle('is-max', isMax);
    btn.setAttribute('aria-pressed', isMax ? 'true' : 'false');
    btn.setAttribute('aria-label', isMax ? 'Minimize sketchpad' : 'Maximize sketchpad');
  }
}
function sketchToggleMax(){
  if(!sketch || sketch.busy || sketch.cur) return;
  sketch.max ? sketchMinimize() : sketchMaximize();
}
function sketchMaximize(){
  const s = sketch, card = document.querySelector('#sketchMount .sketch-card');
  if(!s || !card) return;
  s.busy = true;
  const first = card.getBoundingClientRect();
  // a placeholder keeps the page from jumping while the card floats above it
  const ph = document.createElement('div');
  ph.className = 'sk-placeholder'; ph.style.height = first.height + 'px';
  card.parentNode.insertBefore(ph, card); s.ph = ph;
  const bd = document.createElement('div');
  bd.className = 'sk-backdrop'; bd.addEventListener('click', sketchToggleMax);
  document.body.appendChild(bd); s.bd = bd;
  const cta = card.querySelector('.game-cta');
  if(cta) cta.style.maxHeight = cta.offsetHeight + 'px';
  skSetGeo(card, first);                         // start exactly where the card already is
  card.style.setProperty('--sk-r', getComputedStyle(card).borderTopLeftRadius);
  card.classList.add('sk-fixed');
  s.max = true;                                  // from now on the canvas scales as a zoom
  void card.offsetWidth;                         // lock in the starting frame
  document.documentElement.classList.add('sk-lock');
  card.classList.add('sk-open'); bd.classList.add('show');
  skSetGeo(card, skMaxRect());
  window.addEventListener('resize', skOnResize);
  skSetBtn(true);
  skAfterMove(card, () => { s.busy = false; sketchFit(); try{ s.canvas.focus({ preventScroll:true }); }catch(_){} });
}
function sketchMinimize(){
  const s = sketch, card = document.querySelector('#sketchMount .sketch-card');
  if(!s || !card || !s.max || !s.ph) return;
  s.busy = true;
  window.removeEventListener('resize', skOnResize);
  const target = s.ph.getBoundingClientRect();
  card.classList.remove('sk-open');
  if(s.bd) s.bd.classList.remove('show');
  skSetGeo(card, target);
  skSetBtn(false);
  skAfterMove(card, () => {
    card.classList.remove('sk-fixed');
    ['top','left','width','height'].forEach(p => card.style[p] = '');
    card.style.removeProperty('--sk-r');
    const cta = card.querySelector('.game-cta'); if(cta) cta.style.maxHeight = '';
    if(s.ph) s.ph.remove(); s.ph = null;
    if(s.bd) s.bd.remove(); s.bd = null;
    document.documentElement.classList.remove('sk-lock');
    s.max = false; s.busy = false;
    sketchFit();
  });
}
function skOnResize(){
  const card = document.querySelector('#sketchMount .sketch-card');
  if(card && sketch && sketch.max && !sketch.busy) skSetGeo(card, skMaxRect());
}
function sketchResetMax(){
  document.documentElement.classList.remove('sk-lock');
  document.querySelectorAll('.sk-backdrop').forEach(n => n.remove());
  window.removeEventListener('resize', skOnResize);
}
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && sketch && sketch.max && !sketch.busy) sketchMinimize();
});

function sketchSyncUI(){
  const m = document.getElementById('sketchMount');
  if(!m || !sketch) return;
  const P = sketchPrefs, e = sketch.entry;
  m.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === P.tool));
  m.querySelectorAll('.sk-color').forEach(b => b.classList.toggle('active', P.tool === 'pen' && b.dataset.color === P.color));
  m.querySelectorAll('[data-bg]').forEach(b => b.classList.toggle('active', b.dataset.bg === P.bg));
  const wrap = document.getElementById('skWrap');
  if(wrap) wrap.className = 'sk-wrap sk-bg-' + P.bg;
  sketch.canvas.classList.toggle('tool-hand', P.tool === 'hand' || sketch.space);
  skApplyView();
  const size = document.getElementById('skSize'), val = document.getElementById('skSizeVal');
  if(size) size.value = P.size;
  if(val) val.textContent = P.size;
  document.getElementById('skUndo').disabled = !e.strokes.length;
  document.getElementById('skRedo').disabled = !e.redo.length;
  document.getElementById('skClear').disabled = !sketchHasInk();
}


/* ================= HERO: tap a BITS letter to change its color ================= */
(function initBitsLetters(){
  const letters = document.querySelectorAll('.hero-brand .hl');
  if(!letters.length) return;
  // [letter color, light tint]
  const PALETTE = [
    ['#E8734A', '#FFE6DA'], ['#2C8F8F', '#D6F1EC'], ['#E39A2D', '#FFF0CC'], ['#7C5CD6', '#E7DFFA'],
    ['#E0568C', '#FDE0EA'], ['#2E86DE', '#DCEBFB'], ['#4E9F3D', '#E0F3D8'], ['#D64545', '#FBDCDC']
  ];
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const idx = [0, 1, 2, 3];
  function paint(el, i){
    el.style.setProperty('--c', PALETTE[i][0]);
    el.style.setProperty('--tint', PALETTE[i][1]);
  }
  letters.forEach((el, n) => {
    paint(el, idx[n]);
    el.addEventListener('click', () => {
      idx[n] = (idx[n] + 1) % PALETTE.length;
      paint(el, idx[n]);
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      if(reduce) return;
      const col = PALETTE[idx[n]][0], shapes = ['50%', '4px', '50%'];
      for(let k = 0; k < 14; k++){
        const sp = document.createElement('i');
        sp.className = 'hl-spark';
        const ang = (Math.PI * 2 * k) / 14 + Math.random() * 0.4, dist = 70 + Math.random() * 60;
        sp.style.cssText = `--sz:${6 + Math.random() * 9}px; --sc:${k % 3 === 0 ? '#fff' : (k % 3 === 1 ? col : PALETTE[(idx[n] + 3) % PALETTE.length][0])};` +
          `--br:${shapes[k % 3]}; --dx:${Math.cos(ang) * dist}px; --dy:${Math.sin(ang) * dist}px; --rot:${Math.round(Math.random() * 360)}deg;`;
        el.appendChild(sp);
        setTimeout(() => sp.remove(), 850);
      }
    });
    el.addEventListener('animationend', e => { if(e.animationName === 'hl-pop') el.classList.remove('pop'); });
  });
})();


/* ================= GAME PAGE (next to Home): every mini game, with all three difficulties ================= */
function showGameStep(name){
  document.querySelectorAll('#page-game .game-step').forEach(x => x.classList.remove('active'));
  document.getElementById('gstep-' + name).classList.add('active');
  routeSync();
}
function renderGameSections(){
  const el = document.getElementById('gSectionGrid');
  if(el) el.innerHTML = sectionCardsHtml('gameChooseLevel');
}
function renderGameTopics(levelKey){
  document.getElementById('gTopicsHeading').textContent = LEVELS[levelKey].name;
  document.getElementById('gTopicGroups').innerHTML = topicGroupsHtml(levelKey, 'openGamePlay');
}
function openGamePage(){
  goToPage('game', true);
  showGameStep('sections');
  window.scrollTo({ top:0, behavior:'smooth' });
}
function gameChooseLevel(levelKey){
  if(!LEVELS[levelKey]) return;
  gameCtx.level = levelKey; gameCtx.family = null;
  renderGameTopics(levelKey);
  showGameStep('topics');
  window.scrollTo({ top:0, behavior:'smooth' });
}
function openGamePlay(levelKey, familyKey){
  const fam = LEVELS[levelKey] && familiesOf(levelKey).find(f => f.key === familyKey);
  if(!fam) return;
  gameCtx.level = levelKey; gameCtx.family = familyKey;
  const badge = document.getElementById('gBadge');
  badge.textContent = fam.icon; badge.classList.toggle('res-badge-sm', fam.icon.length >= 3);
  document.getElementById('gEyebrow').textContent = LEVELS[levelKey].name;
  document.getElementById('gTitle').textContent = fam.title;
  document.getElementById('resBody').innerHTML = '';
  document.getElementById('gameBody').innerHTML = '<div id="gameMount"></div><div id="sketchMount"></div>';
  // One game per topic that holds the Easy, Medium and Hard questions together (the student picks the level inside).
  const topic = { key: fam.key, title: fam.title, icon: fam.icon, game: {
    levels: true,
    questions: fam.topics.flatMap(t => t.game.questions),
    cta: `Think you can master ${fam.title}? Pick a level, beat your best score, and tap Show solution whenever you're stuck!`
  } };
  skProblem = null;
  gameInit(topic);
  sketchInit(topic);
  markActiveToday();
  showGameStep('play');
  window.scrollTo({ top:0, behavior:'smooth' });
}
function gameBackToTopicList(){
  if(gameCtx.level){ renderGameTopics(gameCtx.level); showGameStep('topics'); }
  else showGameStep('sections');
  window.scrollTo({ top:0, behavior:'smooth' });
}
// "Try the mini game" button on a lesson: opens the same topic on the Game page.
function gameFromLesson(){
  if(!currentTopicRef) return;
  const fam = familyOf(currentTopicRef.levelKey, currentTopicRef.topicKey);
  if(!fam) return;
  goToPage('game', true);
  openGamePlay(currentTopicRef.levelKey, fam.key);
}
renderGameSections();

/* ================= ROUTER: refresh keeps you where you were ================= */
// The address bar shows the current screen, for example #learn/arith/add/easy or #game/conv/bin-dec.
function routeHash(){
  const pg = document.querySelector('.page.active');
  const page = pg ? pg.id.replace('page-', '') : 'home';
  if(page === 'home'){
    const el = document.querySelector('#page-home .wizard-step.active'), step = el ? el.id.replace('step-', '') : 'welcome';
    if(step === 'sections') return 'learn';
    if(step === 'topics' && learnCtx.level) return 'learn/' + learnCtx.level;
    if(step === 'levels' && learnCtx.level && learnCtx.family) return `learn/${learnCtx.level}/${learnCtx.family}`;
    if(step === 'resources' && currentTopicRef){
      const t = allTopicsOf(currentTopicRef.levelKey).find(x => x.key === currentTopicRef.topicKey), f = familyOf(currentTopicRef.levelKey, currentTopicRef.topicKey);
      if(t && f) return `learn/${currentTopicRef.levelKey}/${f.key}/${t.diff}`;
    }
    return 'home';
  }
  if(page === 'game'){
    const el = document.querySelector('#page-game .game-step.active'), step = el ? el.id.replace('gstep-', '') : 'sections';
    if(step === 'topics' && gameCtx.level) return 'game/' + gameCtx.level;
    if(step === 'play' && gameCtx.level && gameCtx.family) return `game/${gameCtx.level}/${gameCtx.family}`;
    return 'game';
  }
  return page;
}
function routeSync(){
  if(_routing) return;
  const h = routeHash();
  if(location.hash !== '#' + h && !(h === 'home' && !location.hash)) history.pushState(null, '', '#' + h);
}
function routeApply(raw){
  const parts = String(raw || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const page = parts[0] || 'home';
  _routing = true;
  try{
    sketchResetMax();
    if(page === 'learn'){
      goToPage('home', true);
      const lvl = parts[1], fam = parts[2], diff = parts[3];
      if(lvl && LEVELS[lvl]){
        const f = fam && familiesOf(lvl).find(x => x.key === fam);
        if(f && diff){
          const t = f.topics.find(x => x.diff === diff);
          if(t) showTopicResources(lvl, t); else openFamily(lvl, fam);
        } else if(f) openFamily(lvl, fam);
        else { learnCtx.level = lvl; learnCtx.family = null; renderTopics(lvl); showWizardStep('topics'); }
      } else showWizardStep('sections');
    } else if(page === 'game'){
      goToPage('game', true);
      const lvl = parts[1], fam = parts[2];
      if(lvl && LEVELS[lvl] && fam && familiesOf(lvl).some(f => f.key === fam)) openGamePlay(lvl, fam);
      else if(lvl && LEVELS[lvl]){ gameCtx.level = lvl; gameCtx.family = null; renderGameTopics(lvl); showGameStep('topics'); }
      else showGameStep('sections');
    } else if(page === 'profile'){
      goToPage('profile', true);
    } else if(page === 'admin'){
      if(currentUser && isAdminEmail(currentUser.email)) goToPage('admin', true);
      else { pendingAdminRoute = true; goToPage('home', true); showWizardStep('welcome'); }   // shown as soon as the admin account finishes signing in
    } else {
      goToPage('home', true); showWizardStep('welcome');
    }
  } finally { _routing = false; }
}
window.addEventListener('popstate', () => { routeApply(location.hash); window.scrollTo(0, 0); });
if(location.hash) routeApply(location.hash);

/* =====================================================================
   BITS QUEST GUIDE: "?" button, quest checklist and spotlight tour.
   Self-contained. Edit QUESTS / the tour steps below to change the content.
   ===================================================================== */
(function(){ try{
  const KEY = 'bitsQuestGuideV1';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const QUESTS = [
    { id:'signin',  ico:'🔐', t:'Sign in with Google',        d:'Save your streak, scores and progress on any device.' },
    { id:'class',   ico:'🏫', t:'Choose your class section',  d:'Your teacher uses this to follow your progress.' },
    { id:'warmup',  ico:'🎯', t:'Answer a warm-up question',  d:'Fresh questions every time. Build a streak!' },
    { id:'lesson',  ico:'📘', t:'Open a lesson',              d:'Start Learning, pick a section, then choose a topic.' },
    { id:'game',    ico:'🎮', t:'Visit the Game arena',       d:'Practice conversions and arithmetic like a game.' },
    { id:'profile', ico:'👤', t:'Check your profile',         d:'See your name, streak and progress in one place.' }
  ];
  window.BITS_QUESTS = QUESTS;   // the Admin tab reads this list to show each student's walkthrough progress
  let S = { done:{}, seen:false, tour:false, hello:false, party:false };
  try{ const r = JSON.parse(localStorage.getItem(KEY) || 'null'); if(r && typeof r === 'object') S = Object.assign(S, r, { done: r.done || {} }); }catch(_){}
  /* ---------- walkthrough progress is also saved on the student's account (users/{uid}.questProgress) so the Admin tab can show it ---------- */
  let syncUid = null, syncOk = false, syncTimer = 0;
  function push(){
    if(!syncOk) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { try{
      if(typeof currentUser === 'undefined' || !currentUser || currentUser.uid !== syncUid) return;
      db.collection('users').doc(syncUid).set({ questProgress:{ done:S.done, tour:!!S.tour, seen:!!S.seen, total:QUESTS.length, updatedAt:Date.now() } }, { mergeFields:['questProgress'] }).catch(console.error);
    }catch(_){} }, 700);
  }
  const save = () => { try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(_){} push(); };
  // once per sign-in: merge what the account already has with this device, then keep the account up to date
  async function pull(){
    const uid = currentUser.uid; syncUid = uid; syncOk = false;
    try{
      const snap = await db.collection('users').doc(uid).get();
      if(typeof currentUser === 'undefined' || !currentUser || currentUser.uid !== uid) return;
      const r = snap.exists ? snap.data().questProgress : null;
      if(S.uid && S.uid !== uid){ S.done = {}; S.tour = false; S.party = false; }   // this device's checklist belonged to another account
      if(r && typeof r === 'object'){
        if(r.done && typeof r.done === 'object') Object.keys(r.done).forEach(k => { if(r.done[k] && !S.done[k]) S.done[k] = r.done[k]; });
        if(r.tour) S.tour = true;
        if(r.seen) S.seen = true;
      }
      S.uid = uid; syncOk = true; save(); render();
    }catch(err){ console.warn('Walkthrough sync failed', err); syncUid = null; }
  }
  const $ = id => document.getElementById(id);
  const make = html => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
  const vis = e => !!(e && e.getClientRects().length && e.offsetWidth > 0);
  const navBtn = p => [...document.querySelectorAll('#bottomNav [data-page="'+p+'"], #navLinks [data-page="'+p+'"]')].find(vis) || null;
  const navBar = () => vis($('bottomNav')) ? $('bottomNav') : $('navLinks');
  const C = 194.8;
  const ring = cls => `<svg class="${cls}" viewBox="0 0 70 70"><circle class="bg" cx="35" cy="35" r="31"/><circle class="fg" cx="35" cy="35" r="31" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>`;

  /* ---------- build the UI ---------- */
  const fab = make(`<button type="button" class="qg-fab" id="qgFab" aria-label="Open the BITS guide and checklist" aria-expanded="false">${ring('qg-ring-wrap')}<span class="qg-fab-q" aria-hidden="true">?</span><span class="qg-fab-count" id="qgCount">0/${QUESTS.length}</span></button>`);
  const scrim = make('<div class="qg-scrim"></div>');
  const panel = make(`<section class="qg-panel" role="dialog" aria-label="BITS Quest Guide" aria-hidden="true">
    <header class="qg-head"><div class="qg-head-txt"><span class="qg-kick">🧭 Your guide</span><h3>BITS Quest Guide</h3><p id="qgSub"></p></div>
      <div class="qg-bigring">${ring('')}<b id="qgBig">0/${QUESTS.length}</b></div><button type="button" class="qg-x" aria-label="Close guide">✕</button></header>
    <div class="qg-segs" id="qgSegs"></div><div class="qg-list" id="qgList"></div>
    <footer class="qg-foot"><button type="button" class="qg-tourbtn btn-3d" id="qgTour">▶ Take the 30-second tour</button><button type="button" class="qg-reset" id="qgReset">Reset checklist</button></footer></section>`);
  const hello = make('<div class="qg-hello" role="status"><b>👋 New here?</b>Take a quick tour and I’ll show you around BITS.<div><button type="button" class="y">Show me!</button><button type="button" class="n">Maybe later</button></div></div>');
  const toastEl = make('<div class="qg-toast" role="status" aria-live="polite"></div>');
  [scrim, panel, hello, toastEl, fab].forEach(n => document.body.appendChild(n));
  if(!S.seen) fab.classList.add('fresh');

  /* ---------- progress + checklist ---------- */
  const done = () => QUESTS.filter(q => S.done[q.id]).length;
  function render(){
    const n = done(), total = QUESTS.length, f = n / total;
    document.querySelectorAll('.qg-fab .fg, .qg-bigring .fg').forEach(c => c.style.strokeDashoffset = C * (1 - f));
    $('qgCount').textContent = n + '/' + total; $('qgBig').textContent = n + '/' + total;
    $('qgSegs').innerHTML = QUESTS.map(q => '<i class="' + (S.done[q.id] ? 'on' : '') + '"></i>').join('');
    $('qgSub').textContent = n === total ? '🏆 You’re a BITS Explorer! Amazing work.' : (total - n) + ' quest' + (total - n === 1 ? '' : 's') + ' left. Tap “Show me” and I’ll point the way.';
    const next = (QUESTS.find(q => !S.done[q.id]) || {}).id;
    $('qgList').innerHTML = QUESTS.map((q, i) => { const d = S.done[q.id];
      return `<div class="qg-q ${d ? 'done' : ''} ${q.id === next ? 'next' : ''}" style="--i:${i}"><div class="qg-ico">${d ? CHECK : q.ico}</div>
        <div class="qg-txt"><b>${q.t}</b>${q.id === next ? '<em>Up next</em>' : ''}<span>${q.d}</span></div>
        ${d ? '<span class="qg-ok">Done ✓</span>' : `<button type="button" class="qg-go" data-go="${q.id}">Show me</button>`}</div>`; }).join('');
  }
  function toast(msg){ toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('show'), 2800); }
  function party(){
    const cols = ['#F2A65A','#FFD873','#3D8A8A','#E5584F','#8fd6a8','#9b7be0'];
    for(let i = 0; i < 44; i++){ const p = document.createElement('span'); p.className = 'qg-confetti';
      p.style.cssText = `left:${Math.random()*100}vw;background:${cols[i%cols.length]};--x:${(Math.random()*240-120)|0}px;--r:${(Math.random()*900-450)|0}deg;--d:${(1.8+Math.random()*1.6).toFixed(2)}s;animation-delay:${(Math.random()*.5).toFixed(2)}s`;
      document.body.appendChild(p); setTimeout(() => p.remove(), 4200); }
  }
  function mark(id){
    if(S.done[id]) return; S.done[id] = Date.now(); save(); render();
    const q = QUESTS.find(x => x.id === id); const all = done() === QUESTS.length;
    toast(all ? '🏆 All quests complete! You’re a BITS Explorer!' : '✅ Quest complete: ' + q.t);
    if(all && !S.party){ S.party = true; save(); party(); }
  }

  /* ---------- panel open / close ---------- */
  function openPanel(){ endTour(true); hideHello(); render(); panel.classList.add('open'); scrim.classList.add('open'); panel.setAttribute('aria-hidden','false'); fab.setAttribute('aria-expanded','true'); fab.classList.remove('fresh'); S.seen = true; save(); }
  function closePanel(){ panel.classList.remove('open'); scrim.classList.remove('open'); panel.setAttribute('aria-hidden','true'); fab.setAttribute('aria-expanded','false'); }
  const isOpen = () => panel.classList.contains('open');
  function hideHello(){ hello.classList.remove('show'); }
  fab.addEventListener('click', () => isOpen() ? closePanel() : openPanel());
  scrim.addEventListener('click', closePanel);
  panel.querySelector('.qg-x').addEventListener('click', closePanel);
  document.addEventListener('click', e => { if(isOpen() && !panel.contains(e.target) && !fab.contains(e.target)) closePanel(); });
  $('qgTour').addEventListener('click', () => startTour(fullTour(), false));
  $('qgReset').addEventListener('click', () => { S.done = {}; S.party = false; save(); render(); toast('Checklist reset'); autoCheck(); });
  hello.querySelector('.y').addEventListener('click', () => { hideHello(); startTour(fullTour(), false); });
  hello.querySelector('.n').addEventListener('click', hideHello);

  /* ---------- spotlight tour ---------- */
  let T = null;
  const onHome = () => { const p = $('page-home'), w = $('step-welcome'); if(!(p && p.classList.contains('active') && w && w.classList.contains('active'))){ goToPage('home', true); showWizardStep('welcome'); } };
  const signEl = () => vis($('googleSignInBtn')) ? $('googleSignInBtn') : $('userChip');
  const STEP = {
    signin:  { t:'Sign in here 🔐', d:'Tap this button to sign in with Google. Your streak and progress get saved.', el: signEl },
    class:   { t:'Pick your class 🏫', d:'Choose ICT - 1, ICT - 2 or Others so your teacher can follow your progress.', pre:onHome, el:() => $('classPickHome') },
    warmup:  { t:'Try a warm-up 🎯', d:'Tap an answer. Every right one grows your streak, and the questions never repeat.', pre:onHome, el:() => $('warmup') },
    lesson:  { t:'Start learning 📘', d:'Tap Start Learning, pick a section, then open any topic to see its lesson.', pre:onHome, el:() => document.querySelector('.hero-cta') },
    game:    { t:'Open the Game 🎮', d:'Tap Game to practice conversions and arithmetic as a challenge.', el:() => navBtn('game') },
    profile: { t:'Open your profile 👤', d:'Tap Profile to see your name, streak and progress.', el:() => navBtn('profile') }
  };
  const fullTour = () => [
    { t:'Hi, I’m your BITS guide! 🧭', d:'Let’s take a 30-second look around. Leave any time with Esc or Skip.' },
    Object.assign({}, STEP.signin,  { t:'Save your progress 🔐', d:'Sign in with Google to keep your streak, scores and progress on every device.' }),
    { t:'Move around 🧭', d:'Home has lessons and warm-ups, Game is for practice, and Profile shows how you’re doing.', el: navBar },
    Object.assign({}, STEP.lesson, { t:'Start here 📘', d:'Start Learning leads to sections and topics, each with a quick lesson and practice.' }),
    Object.assign({}, STEP.class,  { t:'Choose your class 🏫' }),
    Object.assign({}, STEP.warmup, { t:'Quick warm-ups 🎯', d:'Answer fresh questions to build a streak. Wrong answers show the solution!' }),
    { t:'Your streak calendar 🔥', d:'Practice on different days and watch this calendar light up.', pre:onHome, el:() => $('streakCalendar') },
    { t:'You’re all set! 🎉', d:'Finish the six quests in your checklist to become a BITS Explorer. Tap the ? button any time.' }
  ];
  function startTour(steps, solo){
    closePanel(); hideHello(); endTour(true);
    const node = make('<div class="qg-tour" role="dialog" aria-modal="true" aria-label="BITS tour"><div class="qg-spot"></div><div class="qg-tip" tabindex="-1"></div></div>');
    document.body.appendChild(node);
    T = { steps, i:0, solo, node, spot:node.querySelector('.qg-spot'), tip:node.querySelector('.qg-tip'), target:null, raf:0 };
    node.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if(!a) return; const k = a.dataset.a;
      if(k === 'next') (T.i >= T.steps.length - 1) ? finishTour() : showStep(T.i + 1);
      else if(k === 'back') showStep(Math.max(0, T.i - 1)); else endTour(); });
    showStep(0); (function loop(){ if(!T) return; place(); T.raf = requestAnimationFrame(loop); })();
  }
  function showStep(i){
    T.i = i; const s = T.steps[i], n = T.steps.length;
    if(s.pre) try{ s.pre(); }catch(_){}
    let el = s.el ? s.el() : null; T.target = vis(el) ? el : null;
    if(T.target && !T.target.closest('.topnav, .bottom-nav, #navLinks')){
      const r = T.target.getBoundingClientRect(), tall = r.height > innerHeight * .55;
      window.scrollTo({ top: Math.max(0, r.top + scrollY - (tall ? 120 : (innerHeight - r.height) / 2 - 30)), behavior:'smooth' });
    }
    const last = i === n - 1;
    T.tip.innerHTML = `<div class="qg-tip-top"><span class="qg-step">${T.solo ? 'Look here' : 'Step ' + (i + 1) + ' of ' + n}</span><button type="button" class="qg-skip" data-a="skip">${T.solo ? 'Close' : 'Skip tour'}</button></div>
      <h4>${s.t}</h4><p>${s.d}</p>
      <div class="qg-tip-bot">${T.solo ? '<span></span>' : '<div class="qg-dots">' + T.steps.map((_, k) => '<i class="' + (k === i ? 'on' : '') + '"></i>').join('') + '</div>'}
      <div class="qg-tip-btns">${i > 0 ? '<button type="button" class="b" data-a="back">Back</button>' : ''}<button type="button" class="n" data-a="next">${T.solo ? 'Got it' : last ? 'Finish 🎉' : 'Next'}</button></div></div>`;
    T.tip.style.animation = 'none'; void T.tip.offsetWidth; T.tip.style.animation = '';
    T.spot.style.animation = 'none'; void T.spot.offsetWidth; T.spot.style.animation = '';
    T.tip.querySelector('.n').focus({ preventScroll:true });
  }
  function place(){
    const sp = T.spot, tip = T.tip, vw = innerWidth, vh = innerHeight, tw = tip.offsetWidth, th = tip.offsetHeight; let top, left;
    if(T.target && vis(T.target)){
      const r = T.target.getBoundingClientRect(), pad = 8;
      sp.classList.remove('none');
      sp.style.top = (r.top - pad) + 'px'; sp.style.left = (r.left - pad) + 'px'; sp.style.width = (r.width + pad * 2) + 'px'; sp.style.height = (r.height + pad * 2) + 'px';
      if(vh - r.bottom - pad >= th + 16) top = r.bottom + pad + 12;
      else if(r.top - pad >= th + 16) top = r.top - pad - 12 - th;
      else top = vh - th - 12;
      left = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), vw - tw - 12);
    } else {
      sp.classList.add('none'); sp.style.top = '50%'; sp.style.left = '50%'; sp.style.width = '0'; sp.style.height = '0';
      top = (vh - th) / 2; left = (vw - tw) / 2;
    }
    tip.style.top = Math.max(10, top) + 'px'; tip.style.left = left + 'px';
  }
  function endTour(silent){ if(!T) return; cancelAnimationFrame(T.raf); T.node.remove(); T = null; }
  function finishTour(){ const full = !T.solo; endTour(); if(full){ S.tour = true; save(); setTimeout(openPanel, 280); } }
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape'){ if(T) endTour(); else if(isOpen()) closePanel(); }
    else if(T && e.key === 'ArrowRight'){ (T.i >= T.steps.length - 1) ? finishTour() : showStep(T.i + 1); }
    else if(T && e.key === 'ArrowLeft'){ showStep(Math.max(0, T.i - 1)); }
  });
  $('qgList').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if(b) startTour([STEP[b.dataset.go]], true); });

  /* ---------- automatic quest detection ---------- */
  function autoCheck(){
    try{ if(typeof currentUser !== 'undefined' && currentUser){ if(syncUid !== currentUser.uid) pull(); mark('signin'); } else { syncUid = null; syncOk = false; } }catch(_){}
    try{ if(typeof classSection !== 'undefined' && classSection) mark('class'); }catch(_){}
  }
  setInterval(autoCheck, 1200);
  document.addEventListener('click', e => { if(e.target.closest && e.target.closest('#wuOptions button')) mark('warmup'); }, true);
  function wrap(name, fn){ try{ const o = window[name]; if(typeof o !== 'function') return; window[name] = function(){ try{ fn.apply(null, arguments); }catch(_){} return o.apply(this, arguments); }; }catch(_){} }
  wrap('goToPage', n => { if(n === 'game') mark('game'); if(n === 'profile') mark('profile'); });
  wrap('openTopic', () => mark('lesson'));
  wrap('showTopicResources', () => mark('lesson'));

  /* ---------- first-visit hello bubble ---------- */
  if(!S.hello && !S.seen) setTimeout(() => { if(!S.seen && !T && !isOpen()){ S.hello = true; save(); hello.classList.add('show'); } }, 2600);
  render(); autoCheck();
  /* ---------- Cheat sheet walkthrough (button sits at the top of every cheat sheet) ---------- */
  window.startCheatTour = function(btn){
    const root = btn.closest('.cheat'); if(!root) return;
    const q = sel => () => root.querySelector(sel);
    const tab = id => () => { const t = root.querySelector('.cs-tab[data-tab="' + id + '"]'); if(t) csTab(t); };
    const has = id => !!root.querySelector('.cs-tab[data-tab="' + id + '"]');
    const steps = [
      { t:'Your cheat sheet 📒', d:'This is a handy reference for the topic you are studying. Let’s see what is inside.', el:() => { const f = root.closest('.fold'); return f && f.querySelector('.fold-head'); } },
      { t:'Tabs = different tools', d:'Slide left or right to switch tabs: Explore, examples, quick facts and a converter. Some topics add a tab for the operation, like Addition.', pre:tab('explore'), el:q('.cs-tabsbar') },
      { t:'Tap to explore 👆', d:'In Explore, tap any tile to see what it means, with examples and how it is built.', el:q('.cs-explore .cs-hint') }
    ];
    if(root.querySelector('.cs-modes')) steps.push({ t:'Digits or place values', d:'Switch between the digits and the place values of this number system.', el:q('.cs-modes') });
    steps.push(
      { t:'Byte buttons', d:'One byte is 8 bits. Tap Byte 2, Byte 3 and so on to go past 128, all the way up to 2⁶³.', el:q('.cs-pages') },
      { t:'Where you are', d:'This line tells you which bits and which place values are on screen, and the numbers they stand for.', el:q('.cs-pagehead') },
      { t:'Place value tiles', d:'The big number is the place value. The small one is its power. Tap a tile to open its full explanation.', el:q('.cs-tiles') }
    );
    if(has('op')) steps.push({ t:'Rules for this operation', d:'See the rules and a worked example you can follow step by step.', pre:tab('op'), el:q('.cs-pane[data-pane="op"]') });
    steps.push(
      { t:'More examples 📝', d:'Pick a type of problem, then follow the solved steps.', pre:tab('examples'), el:q('.cs-exfilter') },
      { t:'Quick facts 📚', d:'Short reminders and rules to check your thinking before a quiz.', pre:tab('facts'), el:q('.cs-factsgrid') },
      { t:'Converter 🧮', d:'First choose which number system you will type in.', pre:tab('conv'), el:q('.cs-conv .cs-bases') },
      { t:'Type a number', d:'It shows the number in binary, octal, decimal and hex at once. Open “Show the steps” to learn how. Great for checking your answers!', el:q('.cs-conv-in') },
      { t:'Now you try! 🎉', d:'Go back to Explore and tap a tile. You can replay this walkthrough any time.', pre:tab('explore') }
    );
    startTour(steps, false);
  };
  window.openBitsGuide = openPanel; window.startBitsTour = () => startTour(fullTour(), false);
}catch(err){ console.warn('BITS guide failed to start', err); } })();


/* =====================================================================
   SKETCH RESUME: remembers each student's sketchpad drawing (on this device)
   and shows a "Continue where you left off" pop-up on the Home tab that
   jumps straight back to that topic's sketchpad.
   ===================================================================== */
(function(){ try{
  const KEY = 'bitsSketchResumeV1', MAX_BYTES = 2400000;
  const $ = id => document.getElementById(id);
  let saved = {}, cur = null, dismissed = 0, shownTs = 0, shownRec = null, timer = 0;
  try{ saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(_){ saved = {}; }

  // bring saved drawings back into the sketchpad's own store, so opening the topic shows them again
  Object.keys(saved).forEach(k => { const r = saved[k];
    const sk = (r && r.key) || k;
    if(r && Array.isArray(r.strokes) && r.strokes.length && !sketchStore[sk]){
      sketchStore[sk] = { redo:[], w:r.w || 0, h:r.h || 0, view:r.view || { z:1, x:0, y:0 },
        strokes: r.strokes.map(s => ({ color:s.color, size:s.size, erase:!!s.erase, pts:s.pts.map(a => ({ x:a[0], y:a[1] })) })) };
    } });

  function persist(){
    let txt = JSON.stringify(saved);
    while(txt.length > MAX_BYTES && Object.keys(saved).length > 1){      // too big: forget the oldest drawing first
      const oldest = Object.keys(saved).sort((a, b) => saved[a].ts - saved[b].ts)[0]; delete saved[oldest]; txt = JSON.stringify(saved);
    }
    try{ localStorage.setItem(KEY, txt); }catch(_){}
  }
  function saveNow(){
    try{
      if(!sketch || !sketch.entry || !cur || cur.key !== sketch.topic.key) return;
      const st = sketch.entry.strokes; let from = 0;
      for(let i = st.length - 1; i >= 0; i--) if(st[i].clear){ from = i + 1; break; }
      const live = st.slice(from).filter(s => s.pts && s.pts.length);
      if(!live.length){ delete saved[cur.id || cur.key]; persist(); return; }
      const r = v => Math.round(v * 10) / 10;
      saved[cur.id || cur.key] = { kind:cur.kind || 'learn', familyKey:cur.familyKey || null, levelKey:cur.levelKey, key:cur.key, title:cur.title, ts:Date.now(), w:sketch.entry.w, h:sketch.entry.h,
        view:sketch.entry.view || null, n:live.filter(s => !s.erase).length,
        strokes: live.map(s => ({ color:s.color, size:r(s.size), erase:!!s.erase, pts:s.pts.map(p => [r(p.x), r(p.y)]) })) };
      persist();
    }catch(_){}
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(saveNow, 350); };

  function after(name){ try{ const o = window[name]; if(typeof o !== 'function') return; window[name] = function(){ const out = o.apply(this, arguments); later(); return out; }; }catch(_){} }
  ['sketchUndo', 'sketchRedo', 'sketchClear'].forEach(after);
  document.addEventListener('pointerup', e => { if(e.target && e.target.id === 'skCanvas') later(); });
  document.addEventListener('pointercancel', e => { if(e.target && e.target.id === 'skCanvas') later(); });
  document.addEventListener('visibilitychange', () => { if(document.hidden) saveNow(); });
  window.addEventListener('pagehide', saveNow);
  (function(){ const o = window.showTopicResources; if(typeof o !== 'function') return;
    window.showTopicResources = function(levelKey, topic){ try{ saveNow(); cur = { kind:'learn', id:topic.key, levelKey, key:topic.key, title:topic.title + (topic.diff && DIFF_NAME[topic.diff] ? ' (' + DIFF_NAME[topic.diff] + ')' : '') }; }catch(_){} return o.apply(this, arguments); }; })();

  (function(){ const o = window.openGamePlay; if(typeof o !== 'function') return;
    window.openGamePlay = function(levelKey, familyKey){
      try{ saveNow(); const f = familiesOf(levelKey).find(x => x.key === familyKey);
        if(f) cur = { kind:'game', id:'game:' + f.key, levelKey, familyKey, key:f.key, title:f.title }; }catch(_){}
      return o.apply(this, arguments); }; })();

  /* ---------- the pop-up on the Home tab and the Game tab ---------- */
  const HEADS = ['Your sketch is waiting ✏️', 'Your ideas are still on the page 💭', 'Unfinished masterpiece detected 🎨', 'Don’t leave your thinking hanging 🧠'];
  const pop = document.createElement('div');
  pop.className = 'sr-pop'; pop.setAttribute('role', 'region'); pop.setAttribute('aria-label', 'Continue your sketch');
  pop.innerHTML = '<button type="button" class="sr-main"><span class="sr-thumb"><canvas width="144" height="104" aria-hidden="true"></canvas><i class="sr-pen" aria-hidden="true">✏️</i></span>' +
    '<span class="sr-txt"><em class="sr-head"></em><b>Continue where you left off</b><span class="sr-meta"></span></span><span class="sr-go" aria-hidden="true">→</span></button>' +
    '<button type="button" class="sr-x" aria-label="Hide this reminder">✕</button>';
  document.body.appendChild(pop);

  const latest = kind => Object.keys(saved).map(k => saved[k]).filter(r => r && r.strokes && r.strokes.length && (!kind || (r.kind || 'learn') === kind)).sort((a, b) => b.ts - a.ts)[0] || null;
  function ago(ts){ const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if(m < 1) return 'just now'; if(m < 60) return m + ' min ago'; const h = Math.round(m / 60); if(h < 24) return h + ' h ago';
    const d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago'; }
  function thumb(cv, rec){
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    rec.strokes.forEach(s => { if(!s.erase) s.pts.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }); });
    if(x1 < x0) return;
    const pad = 12, bw = Math.max(x1 - x0, 1), bh = Math.max(y1 - y0, 1), k = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh, 1.2);
    const ox = (W - bw * k) / 2 - x0 * k, oy = (H - bh * k) / 2 - y0 * k;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    rec.strokes.forEach(s => {
      ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(1.8, Math.min(s.erase ? 9 : 4.5, s.size * k));
      ctx.beginPath(); s.pts.forEach((p, i) => { const x = p[0] * k + ox, y = p[1] * k + oy; if(i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      if(s.pts.length === 1) ctx.lineTo(s.pts[0][0] * k + ox + .01, s.pts[0][1] * k + oy);
      ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
  }
  function show(rec){
    shownRec = rec;
    if(shownTs !== rec.ts + rec.key){
      shownTs = rec.ts + rec.key;
      pop.querySelector('.sr-head').textContent = HEADS[Math.floor(Math.random() * HEADS.length)];
      pop.querySelector('.sr-meta').textContent = (rec.title || 'Your topic') + (rec.kind === 'game' ? ' · 🎮 Game' : '') + ' · ' + ago(rec.ts);
      thumb(pop.querySelector('canvas'), rec);
    }
    pop.classList.add('show');
  }
  function tick(){
    const p = $('page-home'), w = $('step-welcome'), g = $('page-game'), gs = document.querySelector('#page-game .game-step.active');
    const onHome = p && p.classList.contains('active') && w && w.classList.contains('active');
    const onGame = g && g.classList.contains('active') && gs && (gs.id === 'gstep-sections' || gs.id === 'gstep-topics');   // not while a sketchpad is already open
    const rec = onGame ? latest('game') : onHome ? latest() : null;
    const busy = document.querySelector('.qg-tour');
    if(rec && rec.ts !== dismissed && !busy) show(rec); else pop.classList.remove('show');
  }
  setInterval(tick, 700); setTimeout(tick, 900);

  pop.querySelector('.sr-x').addEventListener('click', e => { e.stopPropagation(); const r = shownRec || latest(); dismissed = r ? r.ts : 0; pop.classList.remove('show'); });
  pop.querySelector('.sr-main').addEventListener('click', () => {
    const rec = shownRec || latest(); if(!rec) return; let topic = null; const game = rec.kind === 'game';
    try{ topic = game ? familiesOf(rec.levelKey).find(f => f.key === rec.familyKey) : allTopicsOf(rec.levelKey).find(t => t.key === rec.key); }catch(_){}
    pop.classList.remove('show');
    if(!topic){ Object.keys(saved).forEach(k => { if(saved[k] === rec) delete saved[k]; }); persist(); return; }
    if(game){ goToPage('game', true); openGamePlay(rec.levelKey, rec.familyKey); }
    else { goToPage('home', true); showTopicResources(rec.levelKey, topic); }
    const jump = () => { const m = $('sketchMount'); if(!m) return;
      window.scrollTo({ top: Math.max(0, m.getBoundingClientRect().top + scrollY - 90), behavior:'smooth' });
      const c = m.querySelector('.sketch-card'); if(c){ c.classList.add('sr-flash'); setTimeout(() => c.classList.remove('sr-flash'), 2400); } };
    setTimeout(jump, 450); setTimeout(jump, 1000);
  });
}catch(err){ console.warn('BITS sketch resume failed to start', err); } })();
