/**
 * ADMIN CREDENTIALS — GITIGNORED FILE
 * =====================================
 * This file is intentionally excluded from git (.gitignore).
 * Do NOT commit this file to any repository.
 *
 * To set up your admin password:
 * 1. Open browser console (F12) on any page
 * 2. Run: crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_PASSWORD'))
 *          .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
 * 3. Copy the 64-character hex hash and paste it as passwordHash below.
 *
 * See ADMIN_SETUP.md for the full setup guide.
 */

export const ADMIN_CREDENTIALS = {
  id: 'admin',
  // SHA-256 hash of your chosen admin password (NOT plain text)
  // Default hash below = SHA-256 of "Admin@2025" — CHANGE THIS immediately!
  passwordHash: 'c2f07c1ecf7fdb0da5dad0a0a2dbc78ceaa0fa2f57a49cdba7d2cac8be4282f2'
};
