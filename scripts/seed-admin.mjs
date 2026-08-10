/**
 * Admin seed is intentionally disabled for open-source deployments.
 * Do not create a default root admin from this script.
 *
 * For commercial self-hosting, create an admin account manually via D1
 * (set role='admin' on a user row) after registering normally.
 */
console.log('seed-admin: no-op (admin auto-seed removed for open-source mode)');
console.log('To grant admin in commercial deployments, UPDATE users SET role = \'admin\' WHERE username = ?');
process.exit(0);
