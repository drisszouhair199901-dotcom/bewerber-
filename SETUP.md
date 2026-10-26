# Setup (Zugang + Google Sheet)

## 1. Google Sheet
Tab "Feuille 1", Zeile 1: Email | Password | Status | ExpiryDate | DeviceId | Role (optional G: Created)
- Admin-Zeile von Hand eintragen: deine E-Mail, Passwort, Status `active`, Role `ADMIN` (ExpiryDate leer = unbegrenzt).
- Kunde bezahlt: Status = `active` und ExpiryDate setzen (z.B. 30/11/2026 23:59) oder leer lassen (unbegrenzt).
- Gerät zurücksetzen (Kunde hat neues Handy): Zelle DeviceId leeren.
- Neue Konten bekommen automatisch 1 Std. gratis (Status active + ExpiryDate in 1 Std.). Danach setzt die App Status auf `expired`.
- Zweites Konto auf demselben Gerät: Status `pending` (keine Gratis-Stunde), du schaltest es manuell frei.

## 2. Service Account (damit die App das Sheet lesen/schreiben kann)
Google Cloud Console → Projekt → Google Sheets API aktivieren → IAM → Service Accounts → Schlüssel (JSON) erstellen.
Dann das Sheet mit der client_email des Service Accounts teilen (Editor).

## 3. Vercel → Settings → Environment Variables
GOOGLE_SERVICE_ACCOUNT_EMAIL  client_email aus dem JSON
GOOGLE_PRIVATE_KEY            private_key aus dem JSON (mit den \n)
SESSION_SECRET                lange zufällige Zeichenfolge
ANTHROPIC_API_KEY             für das automatische Anschreiben
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   dieselben wie im Supabase-Google-Provider (für Gmail-Erneuerung nach 1 Std.)
Optional: SHEET_ID, SHEET_TAB, ADMIN_EMAIL, WHATSAPP (212708121922), TRIAL_MINUTES (60), SHEET_TZ_OFFSET_MIN (60), ANTHROPIC_MODEL
Danach Redeploy.
