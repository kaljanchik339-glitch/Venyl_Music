# Venyl v2.7.7 — Email verification fix

## Что исправлено
- SMTP больше не проглатывает ошибки отправки verification email.
- При запуске Venyl проверяет SMTP-соединение через Nodemailer и пишет результат в Render Logs.
- `/api/health` показывает `mailerConfigured`, `mailerReady`, `mailerError` и `appBaseUrl`.
- Если `APP_BASE_URL` не задан в production, используется `https://venyl-music.onrender.com`.
- После регистрации ответ содержит `verificationSent` и понятное состояние отправки письма.
- Добавлен `POST /api/auth/resend-verification` для повторной отправки письма.
- В профиле появилась кнопка **«Отправить письмо повторно»** для неподтверждённого email.
- Повторная отправка ограничена 3 запросами за 15 минут.
- При повторной отправке старые verification-токены пользователя удаляются, создаётся новый токен на 24 часа.

## Render Environment Variables
Укажи в Render:

```env
NODE_ENV=production
APP_BASE_URL=https://venyl-music.onrender.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@gmail.com
SMTP_PASS=your_google_app_password
MAIL_FROM=Venyl <your@gmail.com>
```

`SMTP_PASS` должен быть Google App Password, а не обычный пароль Google-аккаунта.

Не добавляй реальные секреты в ZIP, GitHub или `.env.example`.
