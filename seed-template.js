// خدمها غير مرة وحدة من الكمبيوتر ديالك (ماشي Cloud Function) باش تبعث
// الـ key-system template لـ Firestore. بعد ما تخدمها قدر تمسحها أو ماتبعتهاش للـ repo.
//
// طريقة الاستعمال:
// 1) من Firebase Console → Project settings → Service accounts → Generate new private key
//    حط الملف اللي كينزل هنا وسميه serviceAccountKey.json (جنب هاد الملف)
// 2) npm install firebase-admin   (فهاد الفولدر)
// 3) node seed-template.js

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();

async function main() {
  const file = path.join(__dirname, 'LP10_KeySystem_HALLOWEEN.lua');
  const src = fs.readFileSync(file, 'utf8');
  await db.collection('config').doc('keySystemTemplate').set({
    src,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('تم رفع الـ template، طولها:', src.length, 'حرف');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
