// Runs before every test file (before app modules are imported).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://pwos:pwos@localhost:5432/pwos_test';
process.env.TOKEN_ENCRYPTION_KEY = '0'.repeat(64);
process.env.APP_URL = 'http://localhost:5173';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_MODE = 'webhook';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_FROM = 'work-os@test.local';
process.env.CRON_SECRET = 'test-cron-secret-0123456789abcdef0123456789';
delete process.env.ADMIN_EMAIL;
delete process.env.GITHUB_TOKEN;
