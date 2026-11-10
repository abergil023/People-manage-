# אבטחה – מצבת הצוות (הגרסה המשותפת)

## ארכיטקטורה
- **אתר סטטי:** GitHub Pages מתיקיית `docs/`. גרסת הבדיקה המוקשחת נמצאת ב־`docs/staging/`.
- **התחברות:** Firebase Authentication, ספק Google בלבד.
- **נתונים:** Firestore, מסמך פרטי אחד לכל משתמש: `teams/{uid}`.
- **אין צד־שרת:** אין קוד שרת, אין Admin SDK, אין Cloud Functions ואין Storage.

## מה הוקשח בקוד

| נושא | מה נעשה |
|---|---|
| כללי Firestore (`firestore.rules`) | כל משתמש ניגש רק ל־`teams/{uid}` שלו, ורק בנתיב מדויק (`get`). רשימה ושאילתות חסומות (אין enumeration). ולידציה של מבנה, טיפוסים וגדלים. `updatedAt` חייב להיות זמן השרת. כל אוסף אחר חסום. |
| Storage (`storage.rules`) | הכל חסום, למקרה שהשירות יופעל. |
| XSS | ולידציה קשיחה לכל נתון שנכנס, מהענן או מקוד גיבוי: מזהים, תווים, אורכים, enums. escape לכל ערך שנכנס ל־HTML. נבדק עם קוד גיבוי זדוני. |
| CSP | כל ה־JS עבר לקבצים. `script-src 'self'` בלי inline. החיבורים מותרים רק ל־Firebase ול־Google. `object-src`, `base-uri` ו־`form-action` חסומים. |
| שרשרת אספקה | ה־SDK של Firebase (12.19.0) מאוחסן באתר עצמו (`vendor/`) ולא נטען מ־CDN. בדיקת `npm audit` רצה ב־CI. |
| Clickjacking | האפליקציה לא מוצגת כשהיא בתוך iframe של אתר אחר. |
| התנתקות | מנקה את המטמון המקומי של Firestore (IndexedDB) ואת שאריות localStorage. |
| שלמות נתונים | אם מסמך קיים בענן לא נקרא כראוי, השמירה מושבתת ולא נפתח אשף שעלול לדרוס אותו. |
| App Check | הקוד מוכן ל־reCAPTCHA Enterprise, ויופעל כשמזינים site key ב־`APP_CHECK_SITE_KEY`. |

## בדיקות אוטומטיות
- **`npm run test:rules`:** 16 בדיקות כללים מול Firestore Emulator. בודקות שמשתמש לא יכול לקרוא, לערוך, למחוק, ליצור או למנות נתונים של אחרים, שמשתמש לא מחובר חסום, ושמבנים לא חוקיים נדחים.
- **`npm run test:web`:** 6 בדיקות של האפליקציה האמיתית עם ה־SDK האמיתי מול אמולטורים:
  - כתיבה אמיתית עוברת את הכללים ואין הפרות CSP.
  - בידוד בין משתמשים.
  - קוד גיבוי זדוני לא מצליח להזריק סקריפט.
  - ההתנתקות מנקה את המטמון.
  - הגנה מ־clickjacking.
  - רגרסיה מלאה של הפיצ'רים.
- **CI:** `.github/workflows/security-tests.yml` מריץ את הכל בכל push ופעם בשבוע.

## צ'קליסט לבעל הפרויקט (בקונסולה)
1. **גיבוי לפני כל שינוי:** בכל חשבון, "הורדת קובץ גיבוי" מתוך האפליקציה.
2. **כללים:** Firestore ← Rules ← מדביקים את `firestore.rules` ← Publish.
3. **App Check:**
   - App Check ← Apps ← רושמים את ה־web app עם reCAPTCHA Enterprise לדומיין `abergil023.github.io`.
   - **לא** מפעילים Enforce. במשך שבוע עוקבים ב־Metrics, ורק אז אוכפים על Firestore ועל Authentication.
4. **מפתח ה־API:** Google Cloud ← APIs & Services ← Credentials ← Browser key.
   - **Website restrictions:** `https://abergil023.github.io/*` ו־`https://matsevet.firebaseapp.com/*`.
   - **API restrictions:** Identity Toolkit API, Token Service API, Cloud Firestore API ו־Firebase App Check API. אם מופעל reCAPTCHA Enterprise, גם reCAPTCHA Enterprise API.
5. **IAM:**
   - ב־Google Cloud ← IAM רק החשבון שלך מופיע כ־Owner.
   - ב־Service Accounts, ל־`firebase-adminsdk-…` אין מפתחות (Keys). אם יש, מוחקים.
6. **Authentication:**
   - Settings ← Authorized domains: נשארים `abergil023.github.io`, `matsevet.firebaseapp.com` ו־`matsevet.web.app`. `localhost` מוסר.
   - User actions ← Email enumeration protection מופעל.
7. **חשבונות:** אימות דו־שלבי בחשבון Google ובחשבון GitHub.
8. **GitHub:** Settings ← Pages ← Enforce HTTPS.
9. **ניטור:** פעם בשבוע עוברים על Firebase ← Usage, App Check ← Metrics, ורשימת המשתמשים ב־Authentication.

## גיבוי ושחזור
- **במסלול החינמי (Spark)** אין גיבוי אוטומטי בצד השרת. כל מפקד יכול להוריד קובץ גיבוי או קוד גיבוי מתוך האפליקציה.
- **במעבר ל־Blaze:** מומלץ להפעיל Point-in-time recovery ו־Scheduled backups ב־Firestore.

## חזרה אחורה
- **הכללים:** מדביקים חזרה את הגרסה הקודמת ולוחצים Publish.
- **האתר:** `git revert` לקומיט הרלוונטי.
