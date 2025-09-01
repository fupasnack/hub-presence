/* Shared utilities for Presensi FUPA (guard, role, time rules, Firestore helpers, notifications) */

// Firebase v10 modular (hosted)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp, addDoc, collection,
  query, where, orderBy, limit, getDocs, updateDoc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyA-xV3iuv-KAE_-xhiXZSPCTn54EgYUD40",
  authDomain: "presensi-online-f0964.firebaseapp.com",
  projectId: "presensi-online-f0964",
  storageBucket: "presensi-online-f0964.firebasestorage.app",
  messagingSenderId: "895308244103",
  appId: "1:895308244103:web:ab240a8be762a44f49c422",
  measurementId: "G-E9C7760C2S"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Hard role mapping (strict)
export const ADMIN_UIDS = new Set([
  "odO8ZtMgTKeao0SDuy9L3gUmkx02", // annisa@fupa.id
  "ujHnWTnftGh6scTI8cQyN8fhmOB2"  // karomi@fupa.id
]);
export const KARY_UIDS = new Set([
  "HD4EsoL2ykgwQeBl6RP1WfrcCKw1", // cabang1@fupa.id
  "FD69ceLyhqedlBfhbLb2I0TljY03", // cabang2@fupa.id
  "h5aw8ppJSgP9PQM0Oc2HtugUAH02"  // cabang3@fupa.id
]);

export function roleOf(uid){
  if (ADMIN_UIDS.has(uid)) return 'admin';
  if (KARY_UIDS.has(uid)) return 'karyawan';
  return 'karyawan';
}

// Strict route guard to prevent URL bypass
export function guardPage(expectedRole){
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      const lsUid = localStorage.getItem('presensi_uid');
      const lsRole = localStorage.getItem('presensi_role');

      if (!user || !lsUid || user.uid !== lsUid) {
        // not signed-in or mismatch; cleanup and go login
        try { await signOut(auth); } catch {}
        localStorage.clear();
        location.replace('index.html');
        return;
      }
      const mapped = roleOf(user.uid);
      if (mapped !== expectedRole) {
        // wrong role, force back
        location.replace('index.html');
        return;
      }
      resolve(user);
    });
  });
}

// Notification helpers (local + via SW)
export async function ensureNotificationPermission(){
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'default'){
    try{ await Notification.requestPermission(); }catch(e){}
  }
  return Notification.permission === 'granted';
}

export function localNotify(title, body){
  if ('Notification' in window && Notification.permission === 'granted'){
    new Notification(title, {
      body,
      icon: 'https://fonts.gstatic.com/s/i/materialiconsoutlined/notifications/24px.svg',
      badge: 'https://fonts.gstatic.com/s/i/materialiconsoutlined/notifications/24px.svg',
      silent: true
    });
  }
}

export function swNotify(title, body){
  if (navigator.serviceWorker && navigator.serviceWorker.controller){
    navigator.serviceWorker.controller.postMessage({
      type: 'notify',
      payload: { title, body }
    });
  } else {
    localNotify(title, body);
  }
}

// Bootstrap global settings and user profile if missing (idempotent)
export async function bootstrapUser(uid, role){
  const settingsRef = doc(db, 'settings', 'global');
  const exist = await getDoc(settingsRef);
  const batch = writeBatch(db);
  if (!exist.exists()){
    batch.set(settingsRef, {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      hariWajib: { 0:false, 1:true, 2:true, 3:true, 4:true, 5:true, 6:true },
      jam: {
        berangkat: { start: "04:30", end: "05:30", toleransiMenit: 30 },
        pulang: { start: "10:00", end: "11:00", toleransiMenit: 30 }
      }
    });
  }
  // Ensure anchors
  ['announcements','leaves','attendance'].forEach(name=>{
    batch.set(doc(db, 'anchors', name), { alive:true, updatedAt: serverTimestamp() }, { merge:true });
  });

  const pRef = doc(db, 'profiles', uid);
  const pSnap = await getDoc(pRef);
  if (!pSnap.exists()){
    batch.set(pRef, {
      displayName: "",
      address: "",
      photoURL: "",
      role,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  await batch.commit();
}

// Time utilities
export function parseHHMM(str){
  const [h,m] = str.split(':').map(x=>parseInt(x,10));
  return {h, m};
}
export function minutesOfDay(date){
  return date.getHours()*60 + date.getMinutes();
}

// Evaluate attendance status
// return: { status: 'tepat'|'terlambat'|'alpa', mark: 'green'|'yellow'|'red' }
export function evaluateStatus(now, kind, settings){
  // kind: 'berangkat' | 'pulang'
  const cfg = settings?.jam?.[kind] || { start:"04:30", end:"05:30", toleransiMenit:30 };
  const {h:sh, m:sm} = parseHHMM(cfg.start);
  const {h:eh, m:em} = parseHHMM(cfg.end);
  const startMin = sh*60 + sm;
  const endMin = eh*60 + em;
  const tol = cfg.toleransiMenit ?? 30;
  const tolEnd = endMin + tol;

  const nowMin = minutesOfDay(now);

  if (nowMin < startMin) {
    return { status:'alpa', mark:'red', reason:'Belum waktunya' };
  }
  if (nowMin >= startMin && nowMin <= endMin) {
    return { status:'tepat', mark:'green' };
  }
  if (nowMin > endMin && nowMin <= tolEnd) {
    return { status:'terlambat', mark:'yellow' };
  }
  // over tolerance => late missed (alpa for the session)
  return { status:'alpa', mark:'red' };
}

// Check day rule (Sunday off unless overridden)
export function isAttendanceRequired(date, settings){
  const day = date.getDay(); // 0 Sunday ... 6 Saturday
  const hari = settings?.hariWajib ?? {0:false,1:true,2:true,3:true,4:true,5:true,6:true};
  return !!hari[day];
}

// Formatters
export function toISODate(d){
  const yy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yy}-${mm}-${dd}`;
}
export function toTime(d){
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  return `${hh}:${mm}:${ss}`;
}

// Firestore helpers
export async function getSettings(){
  const s = await getDoc(doc(db, 'settings', 'global'));
  return s.exists() ? s.data() : null;
}

export async function ensureTodayLog(uid, dateISO){
  const ref = doc(db, 'attendance', `${uid}_${dateISO}`);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    await setDoc(ref, {
      uid, date: dateISO, records: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    return (await getDoc(ref)).data();
  }
  return snap.data();
}

export async function appendAttendance(uid, dateISO, record){
  const ref = doc(db, 'attendance', `${uid}_${dateISO}`);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    await setDoc(ref, {
      uid, date: dateISO, records: [record], createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  } else {
    const data = snap.data();
    const next = Array.isArray(data.records) ? data.records.slice() : [];
    next.push(record);
    await updateDoc(ref, { records: next, updatedAt: serverTimestamp() });
  }
}

export async function removeAttendanceRecord(uid, dateISO, predicate){
  const ref = doc(db, 'attendance', `${uid}_${dateISO}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const before = Array.isArray(data.records) ? data.records : [];
  const after = before.filter(r => !predicate(r));
  await updateDoc(ref, { records: after, updatedAt: serverTimestamp() });
}

export async function listAttendanceFiltered({ nameOrUid, startDateISO, endDateISO }){
  // Attendance docs keyed by uid_date; we’ll query range by prefix via client scan (small pages)
  const qSnap = await getDocs(collection(db, 'attendance'));
  const rows = [];
  qSnap.forEach(docSnap=>{
    const d = docSnap.data();
    if (!d.date || !d.uid) return;
    if (startDateISO && d.date < startDateISO) return;
    if (endDateISO && d.date > endDateISO) return;
    if (nameOrUid && !(d.uid?.includes(nameOrUid))) return;
    rows.push({ id: docSnap.id, ...d });
  });
  // Sort by date desc
  rows.sort((a,b)=> (a.date < b.date ? 1 : -1));
  return rows;
}

// Announcements
export async function createAnnouncement({ title, message, createdBy }){
  return addDoc(collection(db, 'announcements'), {
    title, message, createdBy, createdAt: serverTimestamp()
  });
}

export async function listAnnouncements(limitCount=20){
  const q = query(collection(db, 'announcements'), orderBy('createdAt','desc'), limit(limitCount));
  const s = await getDocs(q);
  return s.docs.map(d => ({ id:d.id, ...d.data() }));
}

// Leaves (cuti)
export async function requestLeave({ uid, type, startDateISO, endDateISO, reason }){
  return addDoc(collection(db, 'leaves'), {
    uid, type, startDateISO, endDateISO, reason,
    status: 'pending',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
}

export async function setLeaveStatus({ leaveId, status, decidedBy }){
  const ref = doc(db, 'leaves', leaveId);
  await updateDoc(ref, { status, decidedBy, updatedAt: serverTimestamp() });
}

// Profiles
export async function getProfile(uid){
  const p = await getDoc(doc(db, 'profiles', uid));
  return p.exists() ? p.data() : null;
}
export async function updateProfile(uid, data){
  await updateDoc(doc(db, 'profiles', uid), { ...data, updatedAt: serverTimestamp() });
}

// CSV helper
export function toCSV(rows, headers){
  const escape = (v)=> {
    if (v == null) return '';
    const s = String(v).replace(/"/g,'""');
    return `"${s}"`;
  };
  const head = headers.map(h=>escape(h.label)).join(',');
  const body = rows.map(r => headers.map(h=>escape(typeof h.value==='function'? h.value(r) : r[h.key])).join(',')).join('\n');
  return head + '\n' + body;
}

// Date range utilities for filter
export function dateRange(kind, base=new Date()){
  const d = new Date(base);
  const toISO = (x)=> x.toISOString().slice(0,10);
  if (kind === 'harian'){
    return { start: toISO(d), end: toISO(d) };
  }
  if (kind === 'mingguan'){
    const day = d.getDay(); // 0..6
    const start = new Date(d); start.setDate(d.getDate() - day); // Minggu
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { start: toISO(start), end: toISO(end) };
  }
  if (kind === 'bulanan'){
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth()+1, 0);
    return { start: toISO(start), end: toISO(end) };
  }
  if (kind === 'tahunan'){
    const start = new Date(d.getFullYear(), 0, 1);
    const end = new Date(d.getFullYear(), 11, 31);
    return { start: toISO(start), end: toISO(end) };
  }
  return { start: toISO(d), end: toISO(d) };
}

// Client perf hints
export function defer(fn){ requestIdleCallback ? requestIdleCallback(fn) : setTimeout(fn, 0); }

// Easy role label color
export function markColor(status){
  if (status === 'tepat') return '#00C853';
  if (status === 'terlambat') return '#FFC400';
  return '#D32F2F';
}