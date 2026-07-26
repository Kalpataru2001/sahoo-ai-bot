# 🔐 Admin Panel Setup Guide

## First-Time Setup

### Step 1 — Choose Your Admin Password
Pick a strong password you'll remember. Default is `Admin@2025` (change it!).

### Step 2 — Generate the SHA-256 Hash
Open any browser, press **F12** to open DevTools, go to the **Console** tab, and run:

```javascript
crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_PASSWORD_HERE'))
  .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')))
```

Replace `YOUR_PASSWORD_HERE` with your actual password. Copy the 64-character hex string printed in the console.

### Step 3 — Update Credentials File
Open `src/app/admin-panel/admin.credentials.ts` and update:

```typescript
export const ADMIN_CREDENTIALS = {
  id: 'admin',            // ← change admin ID if you want
  passwordHash: 'PASTE_YOUR_64_CHAR_HASH_HERE'
};
```

### Step 4 — Save and You're Done!
The credentials file is gitignored — it will never be committed to git.

---

## How to Access the Admin Panel

### First Time (each new browser session):
Visit: `https://your-app-url/?admin_access=true`

This opens the Admin Login screen. Enter your Admin ID and Password.

### After Login (same browser session):
Press **`Ctrl + Shift + A`** anywhere in the app to toggle the admin panel.

### After Closing the Browser:
The session is cleared for security. Use the URL again.

---

## Changing the Password
1. Generate a new SHA-256 hash (Step 2 above)
## Security Notes
- The credentials file is committed to git — but it only contains a **SHA-256 hash**, never the actual password
- SHA-256 is a one-way function — the real password **cannot be reverse-engineered** from the hash
- Admin session uses `sessionStorage` (cleared when browser closes)
- Auto-logout after 30 min inactivity
- The secret URL param is **wiped from the address bar** immediately after opening
- Regular users have **no visible hint** that an admin panel exists

## Changing the Password
1. Generate a new SHA-256 hash (Step 2 above)
2. Replace `passwordHash` in `src/app/admin-panel/admin.credentials.ts`
3. Commit and push — the new hash takes effect on next deploy
