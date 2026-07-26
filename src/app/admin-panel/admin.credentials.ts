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
  // SHA-256 hash of "Admin@2025"
  passwordHash: 'fcf7bb6d546cfb82d2e55486984ae7a1862a666acb441e0cf8b4ed34a4fcf9d7'
};
