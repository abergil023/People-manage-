# מצבת הצוות – ניהול כוח אדם במילואים

דף ווב יחיד (`index.html`) שמתפרסם כ־Artifact ב־claude.ai עם מסד נתונים מובנה (`db`).

## מה יש (שלב 1)
- **לוח שנה**: לכל יום מילואים מוצג מספר הנוכחים (הנמוך ביותר באותו יום) מתוך הסד״כ. הצבע ירוק, צהוב או אדום לפי סף המינימום.
- **מסך יום**: מי בבית ולמה, מי בקורס, מי לא במילואים, יציאות לפי שעות עם ציר זמן, ורשימת הנוכחים. כפתור מעתיק סיכום לוואטסאפ.
- **יציאות והיעדרויות**: לפי ימים שלמים או לפי שעות, עם סטטוס (בבית / קורס / לא במילואים), סיבה והערה.
- **לוחמים**: מיון לפי מי היה הכי הרבה בבית. בלחיצה על לוחם מוצגת ההיסטוריה המלאה שלו.
- **הגדרות**: טווחי ימי המילואים, סף מינימום, והוספה, שינוי שם והסרה של לוחמים.

## מבנה נתונים
- `soldiers/{id}`: `{name, active, order}`
- `absences/{id}`: `{soldierId, type: home|course|nir, reason, note, allDay, start, end}`. הזמנים מקומיים בפורמט `YYYY-MM-DDTHH:MM`, והסוף לא כלול.
- `settings/main`: `{minStrength, reserveRanges: [{from, to}]}`

## שלב הבא
משימות ושבצ״ק (`tasks`, `shifts`), שמצביעים על `soldierId`.

---

# גרסה משותפת למפקדים – `docs/index.html`

גרסה נפרדת שכל מפקד יכול להשתמש בה לצוות שלו. היא לא קשורה למערכת הפרטית שלמעלה.
- **התחברות:** חובה להתחבר עם Google (Firebase Auth).
- **שמירה:** הנתונים נשמרים ב־Firestore במסמך אחד פרטי לכל משתמש: `teams/{uid}`.
- **אבטחה:** כללי האבטחה ב־`firestore.rules` מאפשרים לכל משתמש לקרוא ולכתוב רק את המסמך שלו.
- **אשף פתיחה:** שם הצוות ← הוספת לוחמים ידנית ← סימון ימי המילואים בלחיצה על הלוח.
- **מעבר מהגרסה הקודמת:** מי שהזין נתונים בגרסה הקודמת, שעבדה בלי ענן, מקבל הצעה להעביר אותם לענן.
- **פיצ'רים:** כל הפיצ'רים של המערכת המקורית. עותק גיבוי בקובץ או בקוד הוא אופציונלי.

## הגדרה חד־פעמית
1. **פרויקט Firebase:** פותחים פרויקט ב־console.firebase.google.com.
   - Authentication ← Sign-in method ← מפעילים את **Google**.
   - Authentication ← Settings ← Authorized domains ← מוסיפים `abergil023.github.io`.
   - Firestore Database ← Create database (Production mode) ← בלשונית Rules מדביקים את התוכן של `firestore.rules` ← Publish.
   - Project settings ← Your apps ← Web app (`</>`) ← מעתיקים את `apiKey`, `authDomain`, `projectId`, `appId` לתוך `FIREBASE_CONFIG` ב־`docs/index.html`.
2. **הפיכת הריפו לציבורי:** Settings ← General ← Change visibility ← **Public**.
3. **הפעלת Pages:** Settings ← Pages ← Deploy from a branch ← בוחרים ענף ותיקייה `/docs`.
4. **הכתובת:** `https://abergil023.github.io/People-manage-/`
