# نُورُ الأربعين النووية 🕌

موقع وتطبيق عربي (RTL) يجمع **الأحاديث النووية الـ42 كاملة** مع:
- 📜 النص الكامل + التخريج والراوي
- 💡 تبويب **الشرح المبسط** لكل حديث (يظهر عند اختيار الحديث)
- 🌿 المفردات والفوائد
- 🔍 بحث فوري + فلترة المنجز + تكبير الخط + استماع صوتي (TTS يعمل Offline)
- 🌙 وضع ليلي + حفظ التقدم (localStorage)
- 📲 PWA يعمل **بدون إنترنت** (Service Worker) وقابل للتثبيت، وقابل للتحويل لتطبيق أندرويد (Capacitor / TWA)

الاسم المختار: **نُورُ الأربعين النووية** — اسم سهل، معبّر، ومناسب لأيقونة التطبيق.

## التشغيل محليًا (بدون إنترنت بعد أول فتح)
يكفي فتح `index.html` مباشرة، أو الأفضل عبر سيرفر محلي:
```powershell
# أي خيار:
npx serve .
# أو
python -m http.server 8080
```
ثم افتح: http://localhost:8080

## الرفع على GitHub
```powershell
cd "C:\Users\Adam Ali\Downloads\ALSNA"
git init -b main
git add .
git commit -m "نور الأربعين النووية: موقع + PWA offline جاهز للأندرويد"
# أنشئ مستودعًا فارغًا على github ثم:
git remote add origin https://github.com/USERNAME/nour-al-arbaeen.git
git push -u origin main
# لتفعيل الموقع مجانًا: Settings → Pages → Deploy from branch → main → /
```

## التحويل إلى تطبيق أندرويد (يعمل بدون إنترنت)

### الطريقة 1: Capacitor (APK/AAB — موصى بها، Offline بالكامل)
```powershell
npm install
npm run android:init
npm run android:add
npm run android:sync
npm run android:open   # يفتح Android Studio ثم Build > Build APK
```
الملفات كلها محلية (لا CDN) لذا يعمل التطبيق بدون إنترنت.

### الطريقة 2: بناء APK تلقائيًا عبر GitHub Actions
موجود ملف `.github/workflows/build-apk.yml` — عند كل Push يبني APK ويرفعه في Artifacts.
حمّله وثبّته على هاتفك مباشرة.

### الطريقة 3: TWA (أسرع بدون Android Studio)
1. ارفع الموقع على GitHub Pages (رابط https).
2. افتح https://www.pwabuilder.com وأدخل الرابط ← Package for Android ← حمّل AAB ← ارفعه على Google Play أو ثبّته مباشرة.

## بنية المشروع
| ملف | دوره |
|---|---|
| `index.html` | الواجهة (RTL + PWA) |
| `data.js` | نصوص الـ42 حديث + الشرح + الفوائد |
| `app.js` | البحث/العرض/الحفظ/TTS/التثبيت |
| `sw.js` | تخزين كل الملفات للعمل Offline |
| `manifest.webmanifest` + `icon-*.png` | التثبيت والأندرويد |
| `capacitor.config.json` + `package.json` | تحويل Capacitor |

## ملاحظة شرعية
الشروح مختصرة مبسطة باعتماد شروح ابن دقيق العيد وابن رجب وابن عثيمين بتصرف. عند الشك ارجع للأصول.
