const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { obfuscate, mergeIntoKeySystem } = require('./obfuscator');

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

// TODO: ضع هنا الـ UID ديالك من Firebase Auth (Authentication → Users)
// هو اللي كيحدد شكون هو "owner" وكيقدر يوافق على submissions.
const OWNER_UID = 'waWTQ15aklY6sYJLAFNMW0919Jj1';

function randomId(len = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ---- 1) الزائر كيبعث السكريبت ديالو (محتاج يكون مسجل الدخول) ----
exports.submitKeySystem = onCall(async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError('unauthenticated', 'لازم تكون مسجل الدخول باش تبعث سكريبت.');
  }

  const { name, scriptSrc } = request.data || {};
  if (!scriptSrc || typeof scriptSrc !== 'string' || !scriptSrc.trim()) {
    throw new HttpsError('invalid-argument', 'بعث السكريبت ديالك.');
  }
  if (scriptSrc.length > 200000) {
    throw new HttpsError('invalid-argument', 'السكريبت طويل بزاف (حد أقصى 200,000 حرف).');
  }

  // الـ key-system template ثابتة، محفوظة من طرفك فقط (config/keySystemTemplate)
  // الزائر ماعندوش حتى تيوصل ليها مباشرة — غير السيرفر كيقراها.
  const tplDoc = await db.collection('config').doc('keySystemTemplate').get();
  if (!tplDoc.exists || !tplDoc.data().src) {
    throw new HttpsError('failed-precondition', 'ماكايناش template ديال key-system محفوظة فـ Firestore.');
  }
  const ksTemplate = tplDoc.data().src;

  let merged;
  try {
    const scriptObf = obfuscate(scriptSrc, { stripComments: true, encryptStrings: true, splitNumbers: true, renameLocals: true });
    const ksProcessed = obfuscate(ksTemplate, { stripComments: true, renameLocals: true, encryptStrings: false, splitNumbers: false });
    merged = mergeIntoKeySystem(ksProcessed, scriptObf);
  } catch (e) {
    throw new HttpsError('internal', 'ماقدرتش نقرا السكريبت، تأكد من الكود ديالك.');
  }

  const id = randomId(12);
  await db.collection('submissions').doc(id).set({
    uid: auth.uid,
    name: (name || 'untitled').toString().slice(0, 80),
    status: 'pending',            // pending -> approved | rejected
    matched: merged.matched,      // false = مالقاش loadstring(HttpGet) فالـ template، خاصك تتأكد يدوياً
    content: merged.merged,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id, matched: merged.matched };
});

// ---- 2) نتا (owner) كتوافق أو كترفض submission ----
exports.approveSubmission = onCall(async (request) => {
  const auth = request.auth;
  if (!auth || auth.uid !== OWNER_UID) {
    throw new HttpsError('permission-denied', 'هاد العملية مخصصة للـ owner.');
  }
  const { id, action } = request.data || {};
  if (!id) throw new HttpsError('invalid-argument', 'خاصك تبعث id ديال الـ submission.');

  const ref = db.collection('submissions').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'ماكايناش submission بهاد id.');

  if (action === 'reject') {
    await ref.update({ status: 'rejected', decidedAt: admin.firestore.FieldValue.serverTimestamp() });
  } else {
    await ref.update({ status: 'approved', decidedAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  return { ok: true };
});

// ---- 3) الرابط الثابت اللي كيوصل ليه اللاعبين: .../serveScript?id=xxxx ----
// باقي pending ولا rejected -> ماكيرجعش الكود، كيرجع غير رسالة.
exports.serveScript = onRequest(async (req, res) => {
  const id = (req.query.id || '').toString().trim();
  if (!id) { res.status(400).send('-- missing id'); return; }

  const snap = await db.collection('submissions').doc(id).get();
  if (!snap.exists) { res.status(404).send('-- not found'); return; }

  const data = snap.data();
  if (data.status !== 'approved') {
    res.status(403).send('-- pending owner review, try again later');
    return;
  }

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.status(200).send(data.content);
});
