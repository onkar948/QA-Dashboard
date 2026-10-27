# QA Tracker V2 — Single Firebase Account

1. Replace `APP_CONFIG.accountEmail` in `config.js` with the email of your single existing Firebase Authentication account.
2. Replace `REPLACE_WITH_YOUR_FIREBASE_AUTH_UID` in `firestore.rules` with that account's Firebase Authentication UID and publish the rules in Firebase Console.
3. Ensure Firebase Authentication Email/Password sign-in is enabled and the account email is verified.
4. Upload `index.html`, `app.js`, `config.js`, `style.css`, and `v2.css` to GitHub Pages repository root.
5. Admin and Tester screens both accept the password of the **same Firebase account**. The email field is hidden. Dashboard is publicly readable.

## Security limitation

Admin/Tester are **interface modes only**, not separate security roles. Anyone who knows the single Firebase password can select Admin and access all private data. Firestore cannot distinguish these modes. Do not add separate local passwords in public JavaScript or assume they enforce permissions. For secure separation, use separate Firebase identities or a trusted backend.

## Known V2 limitations

- Single-document storage can overwrite concurrent edits and eventually hit Firestore size limits.
- Public dashboard/defect remarks are accessible to anyone.
- Excel import is based on Test Case ID and does not fully preserve arbitrary custom columns.
- Automatic OneDrive archiving and V1 migration are not included.
- This package is syntax-checked but not tested against your live Firebase project.
