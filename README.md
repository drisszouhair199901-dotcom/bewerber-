# Ausbildung Bewerber

Sucht Ausbildungsstellen, findet Firmen-E-Mails und sendet Bewerbungen (Anschreiben als PDF, Lebenslauf, Zeugnisse) über das eigene Gmail-Konto.

## Struktur

```
index.html        Oberfläche (Login, Suche, Anschreiben, Senden, CSV)
api/jobs.js       Arbeitsagentur
api/email.js      E-Mail aus Impressum/Kontakt
api/maps.js       Google Maps (Places API New)
api/portal.js     Azubiyo, Aubi-plus, Ausbildung.de, Azubica
```

## Deploy (Vercel)

1. Alles in ein GitHub-Repo hochladen (`api/` bleibt ein Ordner, `index.html` liegt daneben).
2. In Vercel das Repo importieren, keine weitere Konfiguration nötig.
3. Für Google Maps: Places API (New) aktivieren, API-Key erstellen, in Vercel unter Settings, Environment Variables als `GOOGLE_MAPS_KEY` speichern, danach Redeploy.
4. In Supabase: Google-Provider aktivieren und die Redirect-URL der Vercel-Domain eintragen.

## Anschreiben

Platzhalter: `{anrede}`, `{firma}`, `{beruf}`, `{name}`. Die Anrede wird aus dem Feld "Ansprechpartner" gebildet (Herr/Frau Nachname), sonst "Sehr geehrte Damen und Herren,".

## Hinweise

- Der Gmail-Zugriff gilt etwa eine Stunde, danach neu anmelden.
- Gmail erlaubt ca. 500 E-Mails pro Tag.
