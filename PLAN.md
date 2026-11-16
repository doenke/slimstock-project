# Slimstock Projektmanagement – Plan

Stand: 16.11.2026 · Entwurf zur Abstimmung, noch kein Code.

Eine Browser-App (PWA), in der Slimstock-Berater ihre Kundenprojekte führen und das Projektmanagement mit dem
Kunden teilen: Projektplan mit Arbeitsversion und Entwürfen, Taskliste, Meeting-Protokolle, Beteiligte mit
Rechten. Kunden kommen ohne Konto über ihren persönlichen Link hinein.

Grundlage ist die Projektplanung der ToDo-Listen in der Shopping-App (`doenke/shopping`,
`docs/konzept/14-projektplanung.md`): Dauer, Aufwand, Vorgänger (FS/SS/FF/SF mit Abstand), Meilensteine,
„Nicht vor“, Netzplan mit Puffer und kritischem Pfad, Ressourcenabgleich, Dauer aus Aufwand,
Arbeitskalender, Gantt mit Ziehen, Tabelle und Kanban. Rechenkern (`pm.ts`) und Gantt werden hierher kopiert
und eigenständig weiterentwickelt. Was dort gilt, gilt hier auch – soweit unten nichts anderes steht.

**Ablauf:** Zuerst ein Proof of Concept (POC) als Docker-Container auf garageband. Läuft der, zieht die App
zu Slimstock um. Deshalb hängt nichts an garageband oder kanonenwiese.de: Adresse, Port, Datenbank und
Mailversand kommen ausschließlich aus der Docker-Umgebung.

---

## 1. Begriffe und Struktur

```
Projekt (Kunde X – Slim4-Einführung)
├─ Beteiligte + Rollen
├─ Projektplan (einer pro Projekt)
│   ├─ Arbeitsversion          ← immer genau eine, wird laufend gepflegt
│   ├─ Entwurf „Go-live 2 Wochen später“   (in Bearbeitung)
│   ├─ Entwurf „Schulung vorziehen“        (zur Abstimmung beim Kunden)
│   └─ Historie: frühere Arbeitsversionen  (schreibgeschützt)
├─ Teilprojekte
│   ├─ Teilprojekt A (Schnittstellen) – Taskliste, Protokolle
│   └─ Teilprojekt B (Schulung)       – Taskliste, Protokolle
├─ Taskliste (Projekt-Ebene)
└─ Meeting-Protokolle (Projekt-Ebene)
```

- **Projekt**: gehört zu einem Kunden, hat Name, Kürzel, Zeitraum, Arbeitskalender, Status.
- **Teilprojekt**: eigener Name, eigene Verantwortliche, eigene Taskliste und Protokolle. Technisch ein Baum,
  in der Oberfläche zunächst zwei Ebenen.
- **Projektplan**: einer pro Projekt, er umfasst alle Teilprojekte. Jedes Teilprojekt ist im Plan eine
  **Sammelzeile** (Phase), deren Zeitraum sich aus ihren Vorgängen ergibt. So bleiben Abhängigkeiten zwischen
  Teilprojekten erhalten (Schnittstelle fertig → Schulung kann beginnen).

## 2. Projektplan: Arbeitsversion und Entwürfe

### Vorgänge

Wie in der Shopping-App (`attributes.pm`): Start, Ende, Dauer (Vorgabe vs. berechnet), Meilenstein, Nicht vor,
Aufwand geplant/geleistet, Vorgänger mit Typ und Abstand, Personen (Ressourcen), Deadline. Neu dazu:

- **Sammelvorgänge/Phasen** (Hierarchie; Teilprojekte sind die oberste Ebene darunter).
- **Fortschritt %** und **Ist-Start/Ist-Ende**.
- **Verantwortlich**: Slimstock oder Kunde (Person).
- **Intern**: Vorgänge mit diesem Haken sieht der Kunde in keiner Version.

### Das Versionsmodell

- **Arbeitsversion** – es gibt immer genau eine. Sie ist der gültige Plan, an ihr wird laufend gearbeitet
  (Fortschritt, Ist-Termine, kleine Korrekturen).
- **Entwürfe** – beliebig viele, alle frei bearbeitbar. Ein neuer Entwurf ist eine Kopie der Arbeitsversion
  (Normalfall) oder eines anderen Entwurfs. Jeder Entwurf hat Name, Beschreibung („Was ändert sich und
  warum?“), Ersteller, Datum.
- **Annehmen** – ein angenommener Entwurf wird zur neuen Arbeitsversion. Die bisherige Arbeitsversion wandert
  schreibgeschützt in die **Historie** (mit Datum und wer angenommen hat). Danach geht es wie gewohnt weiter:
  in der Arbeitsversion arbeiten, daraus neue Entwürfe machen.
- **Verwerfen** – ein Entwurf, der nicht kommt, wird verworfen (bleibt in der Historie sichtbar, kann
  wiederbelebt werden).
- **Neue Projekte** starten mit einer leeren Arbeitsversion; der erste Plan kann direkt darin oder als
  Entwurf entstehen.

Status eines Entwurfs: *In Bearbeitung* → *Zur Abstimmung* → *Angenommen* · *Abgelehnt* · *Verworfen*.

**Wenn sich die Arbeitsversion inzwischen geändert hat:** Während ein Entwurf entsteht, wird die
Arbeitsversion weiter gepflegt (Fortschritt, Ist-Termine). Beim Annehmen zeigt die App deshalb, was sich in
der Arbeitsversion seit dem Anlegen des Entwurfs geändert hat, und bietet pro Vorgang und Feld an, diese
Änderung zu übernehmen. Vorschlag: Fortschritt, geleisteter Aufwand und Ist-Termine werden standardmäßig
übernommen (sie beschreiben die Wirklichkeit, nicht die Planung), alles andere entscheidet man.
Im POC genügt zunächst: Hinweis + Liste der Änderungen, Übernahme von Fortschritt/Ist/Aufwand automatisch.

**Vergleichen:** Jede Version lässt sich mit jeder anderen vergleichen (Standard: Entwurf gegen
Arbeitsversion). Im Gantt als graue Vergleichsbalken unter den Balken, dazu eine Tabelle der Unterschiede:
neue/entfernte Vorgänge, Verschiebungen von Start/Ende/Dauer in Arbeitstagen, geänderte Meilensteine und
Verknüpfungen, Auswirkung auf das Projektende. Möglich, weil jeder Vorgang über alle Versionen dieselbe
`key`-ID behält. Über diese `key` hängen auch Tasks am Plan.

### Abstimmung mit dem Kunden

- **Pro Version einstellbar, ob der Kunde sie sieht** – die Arbeitsversion genauso wie jeder Entwurf und
  jede Version der Historie. Der Kunde sieht eine Liste „Pläne“ mit genau diesen Versionen.
- **Entwurf zur Abstimmung geben:** Der Entwurf wird für die Kunden-Projektleitung sichtbar und für die
  Bearbeitung gesperrt, damit niemand einem sich bewegenden Ziel zustimmt. Wer ihn noch ändern will, holt ihn
  zurück in *In Bearbeitung*; bereits abgegebene Zustimmungen verfallen dann.
- **Der Kunde** sieht den Entwurf mit Vergleich zur Arbeitsversion, kann kommentieren (am Entwurf oder an
  einem Vorgang) und **zustimmen** oder **ablehnen** (mit Begründung).
- **Annehmen** macht die Slimstock-Projektleitung. Die Zustimmungen (wer, wann) werden mit der Version
  gespeichert und bleiben in der Historie nachvollziehbar. Einstellbar pro Projekt: „Annehmen nur nach
  Zustimmung der Kunden-Projektleitung“.

## 3. Taskliste

Die Taskliste ist **nicht versioniert** und getrennt vom Plan – Tasks sind die laufenden To-dos und offenen
Punkte („Kunde liefert Artikelstammdaten“, „Testzugang einrichten“).

- Felder wie die ToDo-Liste der Shopping-App: Titel, Beschreibung, Status (eigene Status je Projekt),
  Fällig, Wer (mehrere Personen, auch Kunden), Priorität, Bereich, Kommentare, Anhänge, Links.
- Ebene: Projekt oder Teilprojekt; optional **verknüpft mit einem Vorgang** im Plan (über dessen `key`,
  bleibt also über alle Versionen bestehen).
- Herkunft: von Hand oder aus einem Meeting-Protokoll.
- Ansichten: Tabelle (gruppiert nach Fällig/Status/Wer/Teilprojekt), Kanban, „Meine Aufgaben“ über alle
  Projekte – auch für Kunden.
- Sichtbarkeit: *intern* oder *mit Kunde geteilt*.
- Kunden können zugewiesene Tasks abhaken, kommentieren und den Status ändern (je nach Rolle).

## 4. Meeting-Protokoll

Dokument mit Datum, Ebene (Projekt/Teilprojekt) und Status *Entwurf* → *Veröffentlicht*. Der Kunde sieht nur
Veröffentlichtes.

- Art (Kick-off, Jour fixe, Lenkungsausschuss, Workshop), Datum, Ort/Online, Teilnehmer (aus Beteiligten oder
  frei), Agenda.
- Punkte mit Typ: *Info* · *Entscheidung* · *Aufgabe*. Aufgaben werden beim Speichern zu Tasks (mit
  Rückverweis), Entscheidungen landen im Entscheidungslog des Projekts.
- Offene Tasks lassen sich im Meeting durchgehen und direkt aktualisieren.
- PDF-Export im Slimstock-Design (Stufe 7).

**Flash-Report**: kommt später (siehe Abschnitt 8). Das Datenmodell sieht Dokumente mit Typ vor, er passt
also ohne Umbau dazu.

## 5. Beteiligte und Rechte

Beteiligte sind Personen mit einer **Rolle je Projekt**; in Teilprojekten kann eine Rolle ergänzt oder erhöht
werden (nie gesenkt – vererbt wird von oben).

| Recht | Projektleitung (Slimstock) | Berater (Slimstock) | Projektleitung Kunde | Mitglied Kunde | Leser |
| --- | :-: | :-: | :-: | :-: | :-: |
| Interne Inhalte sehen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Arbeitsversion und Entwürfe bearbeiten | ✅ | ✅ | ❌ | ❌ | ❌ |
| Entwurf anlegen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Entwurf zur Abstimmung geben, annehmen; Sichtbarkeit für Kunden | ✅ | ❌ | ❌ | ❌ | ❌ |
| Freigegebene Versionen sehen und kommentieren | ✅ | ✅ | ✅ | ✅ | sehen |
| Entwurf zustimmen / ablehnen | – | – | ✅ | ❌ | ❌ |
| Tasks anlegen / bearbeiten | ✅ | ✅ | ✅ | eigene | ❌ |
| Protokoll schreiben, veröffentlichen | ✅ | ✅ | kommentieren | ❌ | ❌ |
| Beteiligte einladen, Rollen ändern | ✅ | ❌ | Kunden-Mitglieder | ❌ | ❌ |

- **Admins** (Slimstock) legen Projekte und Slimstock-Benutzer an und sehen alles.
- Alle Rechte prüft der Server; die Oberfläche blendet nur aus.
- Änderungsprotokoll pro Projekt (wer hat wann was geändert).

## 6. Anmeldung

### Slimstock-Mitarbeiter: Benutzername und Passwort

- Admin legt Benutzer an (Benutzername, Name, E-Mail, Admin ja/nein) und vergibt ein Startpasswort; beim
  ersten Login muss es geändert werden. Jeder kann sein Passwort ändern, ein Admin kann es zurücksetzen.
- Passwörter als **Argon2id**-Hash, Mindestlänge 12, Rate-Limit und kurze Sperre nach Fehlversuchen.
- Der **erste Admin** entsteht aus der Env (`ADMIN_USERNAME`, `ADMIN_PASSWORD`) beim ersten Start, wenn es
  noch keinen Benutzer gibt.
- Sitzung: signiertes Cookie (HttpOnly, Secure, SameSite=Lax), Schlüssel `SESSION_KEY` aus der Env.
- Die Anmeldung ist so gekapselt, dass später das **Firmenlogin (OIDC, z. B. Microsoft Entra ID)** als
  zweiter Weg dazukommt und bestehende Benutzer per E-Mail verknüpft werden.

### Kunden: persönlicher Link ohne Ablauf

- Jede eingeladene Kundenperson bekommt **einen persönlichen Link**, z. B. `https://<adresse>/k/<token>`.
  Er läuft **nicht ab**. Wer ihn als Lesezeichen speichert, braucht kein Login.
- Der Link gilt für die Person und damit für alle Projekte, in denen sie Beteiligte ist.
- Token: 32 Byte Zufall. In der DB verschlüsselt (mit einem Schlüssel aus der Env), damit die Projektleitung
  den Link jederzeit wieder **kopieren oder erneut zusenden** kann, ohne dass er sich ändert.
- **Link erneuern** macht den alten sofort ungültig (z. B. wenn er weitergeleitet wurde). **Person
  entfernen** sperrt den Zugang zu diesem Projekt sofort.
- Beim Öffnen setzt die App zusätzlich ein Cookie, damit die installierte PWA auch ohne Link-Aufruf startet.
- Schutz: `Referrer-Policy: no-referrer` (der Link landet nicht bei fremden Seiten), `noindex`, keine
  externen Inhalte, Protokoll der Zugriffe (letzter Zugriff pro Person sichtbar), Rate-Limit auf `/k/`.
- **Bewusste Grenze:** Wer den Link hat, ist drin – wie bei einem geteilten Dokument-Link. Das steht in der
  Einladung, und die Rechte der Kundenrollen sind entsprechend begrenzt (nichts Internes, kein Löschen).
- Versand: Die App zeigt den Link zum Kopieren/Teilen. Mailversand per SMTP ist optional (`SMTP_*` in der
  Env); ohne SMTP wird einfach kopiert.

## 7. Technik

**Stack der Shopping-App, aber ohne Offline-Sync.**

| Schicht | Wahl | Warum |
| --- | --- | --- |
| Server | Node 22 + Fastify, TypeScript | wie shopping; Mail, PDF, Jobs im selben Prozess |
| Datenbank | PostgreSQL 17 + Drizzle | Versionen, Rechte, Historie – relationale Daten |
| Frontend | React + Vite, PWA | Gantt, Tabelle, Kanban aus shopping wiederverwendbar |
| Geteilt | `packages/shared`: Zod-Schemas, **`pm.ts` aus shopping**, Versionsvergleich | eine Rechnung in Browser und Server |
| Echtzeit | WebSocket: „Projekt X hat sich geändert“ → neu laden | einfach; kein HLC/Feld-Sync nötig |
| Passwörter | Argon2id (`@node-rs/argon2`) | |
| PDF | Headless-Chromium oder `pdfmake` | Protokoll im Slimstock-CD (später) |

Bewusst **online-first**: Die App braucht eine Verbindung; offline nur Lesen des zuletzt Geladenen.
Gleichzeitiges Bearbeiten: optimistische Sperre pro Datensatz (Versionsnummer), bei Konflikt Hinweis
„inzwischen geändert“. Entwürfe haben dadurch kein Mehrbenutzer-Problem, das über das der Arbeitsversion
hinausgeht.

### Konfiguration (alles per Docker-Env)

| Variable | Wofür |
| --- | --- |
| `PUBLIC_URL` | Adresse der App, z. B. `https://projekte.example.org` – Subdomain ist noch offen |
| `PORT` | Port im Container und auf dem Host (POC: zufälliger Port aus 30000–49151) |
| `DATABASE_URL` | PostgreSQL |
| `SESSION_KEY` | signiert Sitzungscookies |
| `LINK_KEY` | verschlüsselt die Kunden-Links |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | erster Admin beim ersten Start |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | optionaler Mailversand |
| `TRUSTED_PROXY` | `X-Forwarded-*` nur hinter Reverse Proxy vertrauen |
| `TZ` | `Europe/Berlin` |

Sonst wie üblich: Image `ghcr.io/doenke/slimstock-project`, Healthcheck `/healthz` (prüft DB),
`compose.example.yml` mit Postgres, Versionierung x.yy.zzz, README im bekannten Stil, deutsche Oberfläche,
englischer Code. Für den Umzug zu Slimstock: Image + Datenbank-Dump, keine weiteren Abhängigkeiten.

### Datenmodell (Skizze)

```
users            id, kind (staff|customer), username?, password_hash?, email, name, is_admin,
                 link_token_enc?, link_rotated_at, last_seen_at
customers        id, name
projects         id, customer_id, parent_id?, name, code, calendar, settings
memberships      project_id, user_id, role, invited_by, created_at
plan_versions    id, project_id, kind (working|draft|history), name, description,
                 status (editing|in_review|accepted|rejected|discarded),
                 based_on_version_id, based_on_snapshot_at, customer_visible,
                 created_by, accepted_by, accepted_at, replaced_at
version_reviews  version_id, user_id, verdict (approve|reject), comment, at
plan_items       id, version_id, key, parent_key?, subproject_id?, title, pm (jsonb wie shopping),
                 progress, actual_start, actual_end, owner_user_id?, internal, sort, rev
tasks            id, project_id, plan_item_key?, title, status, due, assignees[], priority, internal,
                 source_doc_id?, rev
documents        id, project_id, type (minutes|flash), date, status, data (jsonb), published_at, author
decisions        id, project_id, document_id, text, date
comments         id, target (version|plan_item|task|document), target_id, author, text, at
sessions, audit_log
```

„Genau eine Arbeitsversion“: partieller Unique-Index auf `plan_versions(project_id) WHERE kind = 'working'`.
Annehmen ist eine Transaktion: alte Arbeitsversion → `history`, Entwurf → `working`, Übernahmen aus der
alten Arbeitsversion anwenden.

## 8. Ausbaustufen

| Stufe | Inhalt |
| --- | --- |
| **1 – Gerüst** | Repo, Docker + Postgres, Healthcheck, Versionierung, Login mit Benutzername/Passwort, Benutzerverwaltung, Projekte + Teilprojekte, Beteiligte mit Rollen |
| **2 – Plan** | `pm.ts` und Gantt aus shopping übernehmen, Vorgänge mit Hierarchie, Tabelle + Gantt, Arbeitsversion |
| **3 – Entwürfe** | Entwürfe anlegen/bearbeiten/verwerfen, Vergleich (Gantt + Tabelle), Annehmen mit Übernahme der Ist-Daten, Historie |
| **4 – Kunden** | Persönliche Links, Kundensicht, Sichtbarkeit pro Version, Abstimmung (zustimmen/ablehnen, Kommentare), Rechteprüfung mit Tests |
| **5 – Taskliste** | Tasks mit Tabelle/Kanban, Verknüpfung zum Plan, „Meine Aufgaben“ |
| **6 – Protokolle** | Meeting-Protokoll → Tasks, Entscheidungslog |
| **7 – Feinschliff** | PDF-Export im CD, Änderungsprotokoll, Mail-Benachrichtigungen (neuer Entwurf zur Abstimmung, Task zugewiesen) |

**Später:** Flash-Report (Ampeln mit Trend, automatisch vorbefüllt aus Plan und Tasks), Firmenlogin per OIDC,
Umzug zu Slimstock, Import/Export MS Project (XML) und Excel, Projektportfolio über alle Kunden,
MCP-Schnittstelle wie in shopping.

## 9. Offene Fragen

1. **Annehmen ohne Kunden-Zustimmung:** Darf die Slimstock-Projektleitung einen Entwurf auch ohne
   Zustimmung annehmen (Vorschlag: ja, pro Projekt umstellbar)?
2. **Übernahme beim Annehmen:** Passt der Vorschlag, Fortschritt, Ist-Termine und geleisteten Aufwand aus der
   Arbeitsversion automatisch in den angenommenen Entwurf zu übernehmen?
3. **Meeting-Protokolle** im ersten Wurf behalten (Stufe 6) oder zusammen mit dem Flash-Report nach hinten?
4. **Kunden-Link** pro Person für alle Projekte (Vorschlag) oder pro Person und Projekt?
