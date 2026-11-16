# Slimstock Projektmanagement – Hinweise für Claude

Browser-App (PWA) zum Führen von Slimstock-Kundenprojekten, geteilt mit dem Kunden. Fachlicher Plan und
alle Entscheidungen: **PLAN.md** (bei Änderungen am Konzept mitpflegen). Aktueller Stand: Stufen 1–4 fertig.

## Aufbau

pnpm-Monorepo, TypeScript durchgehend.

- `packages/shared` – Zod-Schemas (`schemas.ts`), Antworttypen (`types.ts`), Berechtigungen
  (`permissions.ts`), Standard-Projektrollen (`roles.ts`), Sprachen (`languages.ts`) und die
  Sprachdateien `src/locales/*.json` (für Web und Server). Projektplan: `schedule.ts` (Netzplan-Rechnung,
  aus doenke/shopping portiert) und `plan.ts` (Baum aus Vorgängen, Phasen und Teilprojekten, Verknüpfungen
  von Phasen, Rollups, Einfügen/Verschieben). Der Server rechnet den Plan immer auf dem vollen Stand und
  schickt Ergebnis + gefilterte Daten (`PlanPayload`); der Client rechnet nicht selbst. Versionen:
  Vorgänge behalten in jeder Version ihren `key`; Vergleich über `diffPlans`, beim Annehmen gehen die
  `ACTUAL_FIELDS` (Fortschritt, Ist-Termine, Restaufwand) aus der Arbeitsversion mit. Kalkulation:
  `effort.ts` (Plan je Rolle am Vorgang `efforts`, Rest `remaining`, Ist-Buchungen per `key` in
  `effort_entries`, Rollups, Budget je Abrechnungseinheit = Teilprojekt bzw. Projektebene; Festpreis-Budget
  in `plan_versions.terms`). Alles in Minuten (1 Tag = 480), angezeigt in Tagen.
- `apps/server` – Fastify 5, Drizzle + PostgreSQL. `src/app.ts` (Hooks, Healthcheck, statische Web-App),
  `src/api/*` (auth, admin, projects, plan, versions = Entwürfe/Annehmen, effort = Buchungen/Abrechnung,
  export = Excel über exceljs, access = Rechteberechnung), `src/i18n.ts` (Texte für Server-Ausgaben), `src/auth/*` (Argon2id, Sessions,
  Login-Bremse), `src/db/schema.ts` + Migrationen in `drizzle/` (`pnpm db:generate`, nie von Hand ändern).
- `apps/web` – React 19 + Vite, eigener Mini-Router (`router.tsx`), i18next, Plan unter `src/plan/*`, Service Worker `src/sw.ts`
  (Netz zuerst, API/Healthz nie gecacht), Styles in `src/styles.css` (Slimstock-Farben als Variablen).

## Regeln

- **Sprache:** Oberfläche mehrsprachig – jeder sichtbare Text als Schlüssel in `de.json` **und**
  `en.json` (ein Test prüft Gleichstand), `nl`/`es` fallen auf Englisch zurück. README und PLAN deutsch.
  Code, Bezeichner und Kommentare englisch.
- **Fehler:** Server wirft `ApiError(status, code)`; die Web-App übersetzt `errors.<code>`.
- **Rechte** prüft immer der Server (`requireRight`, `requireAdmin`); die UI blendet nur aus.
  Nicht-Mitglieder bekommen 404 statt 403. Kundenpersonen bekommen nie Slimstock-Stufen.
- **Versionierung** x.yy.zzz über `versions.json` + `scripts/version.mjs` (yy = Tage mit Änderungen seit
  `since`, zzz = CI-Lauf). Neue App-Ordner in `paths` eintragen. Version sichtbar in Fußzeile und `/healthz`.
- **README** bei jeder Funktionsänderung mitpflegen (Stil: duzen, Nutzen zuerst, ehrlich über Grenzen).
- Keine externen Ressourcen (CDNs, Webfonts). Secrets nur über Env.

## Verifikation

`pnpm format:check && pnpm typecheck && pnpm test && pnpm build`. Server-Tests brauchen PostgreSQL
(`TEST_DATABASE_URL`, Standard `postgres://postgres@127.0.0.1:54329/postgres`); jede Testdatei bekommt
eine eigene Datenbank (`test/helpers.ts`).

## Umgebung (Cloud-Sitzung)

- Test-PostgreSQL auf Port 54329 starten, falls nötig:
  `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/sspm-test -l /var/lib/postgresql/sspm-test.log -o '-p 54329 -k /tmp' -w start"`
  (beim ersten Mal vorher `initdb -D … -A trust -U postgres`).
- Icons neu rendern: `NODE_PATH=$(npm root -g) node tools/icons.mjs`.
