# Slimstock-Projekte – Plan

Stand: 16.11.2026 · Entwurf zur Abstimmung, noch kein Code.

Eine Browser-App (PWA), in der Slimstock-Berater ihre Kundenprojekte führen und das Projektmanagement mit dem
Kunden teilen: Projektplan mit Versionen, Taskliste, Flash-Reports und Meeting-Protokolle, Beteiligte mit
Rechten. Kunden kommen ohne Konto per Magic Link hinein.

Grundlage ist die Projektplanung der Shopping-App (`doenke/shopping`, `docs/konzept/14-projektplanung.md`):
Dauer, Aufwand, Vorgänger (FS/SS/FF/SF mit Abstand), Meilensteine, „Nicht vor“, Netzplan mit Puffer und
kritischem Pfad, Ressourcenabgleich, Dauer aus Aufwand, Arbeitskalender, Gantt mit Ziehen, Tabelle und Kanban.
Was dort gilt, gilt hier auch – soweit unten nichts anderes steht.

---

## 1. Begriffe und Struktur

```
Projekt (Kunde X – Slim4-Einführung)
├─ Beteiligte + Rollen
├─ Projektplan
│   ├─ Version 1 „Angebot“          (eingefroren)
│   ├─ Version 2 „Kick-off-Baseline“ (eingefroren, mit Kunde abgestimmt)
│   └─ Version 3 „Arbeitsversion“    ← genau eine ist immer die Arbeitsversion
├─ Teilprojekte
│   ├─ Teilprojekt A (Schnittstellen)
│   │   ├─ Taskliste
│   │   └─ Flash-Reports / Protokolle
│   └─ Teilprojekt B (Schulung)
├─ Taskliste (Projekt-Ebene)
└─ Flash-Reports / Meeting-Protokolle (Projekt-Ebene)
```

- **Projekt**: gehört zu einem Kunden, hat Name, Kürzel, Zeitraum, Arbeitskalender, Status.
- **Teilprojekt**: eigener Name, eigene Verantwortliche, eigene Taskliste und Reports. Teilprojekte können
  weitere Teilprojekte haben (Baum); in der Oberfläche zunächst zwei Ebenen.
- **Projektplan**: gehört zum Gesamtprojekt und umfasst alle Teilprojekte – sonst gingen Abhängigkeiten
  zwischen Teilprojekten verloren (Schnittstelle fertig → Schulung kann beginnen). Jedes Teilprojekt ist im
  Plan eine **Sammelzeile** (Phase), deren Zeitraum sich aus ihren Vorgängen ergibt.

## 2. Projektplan und Versionen

### Vorgänge

Wie in der Shopping-App (`attributes.pm`): Start, Ende, Dauer (Vorgabe vs. berechnet), Meilenstein,
Nicht vor, Aufwand geplant/geleistet, Vorgänger mit Typ und Abstand, Personen (Ressourcen), Fälligkeit/Deadline.
Neu dazu:

- **Sammelvorgänge/Phasen** (Hierarchie im Plan; Teilprojekte sind die oberste Ebene darunter).
- **Fortschritt %** und **Ist-Start/Ist-Ende** – im Shopping-Konzept als „später möglich“ notiert, hier Pflicht.
- **Verantwortlich auf Kundenseite** vs. Slimstock (für die Kundensicht und den Flash-Report).
- **Sichtbarkeit**: „intern“ markierte Vorgänge sieht der Kunde nicht.

### Versionen

- Ein Plan hat beliebig viele **Versionen**. Genau eine ist die **Arbeitsversion**: nur sie ist bearbeitbar.
- **Neue Version** = Kopie der Arbeitsversion. Beim Anlegen wählt man, ob die Kopie die neue Arbeitsversion
  wird (die alte wird eingefroren) – das ist der Normalfall – oder ob nur ein eingefrorener Schnappschuss
  entsteht („Stand Lenkungsausschuss 12.11.“).
- Jede Version hat Name, Kommentar, Datum, Ersteller und einen Status: *Entwurf* · *Freigegeben (mit Kunde
  abgestimmt)* · *Archiviert*. Eingefrorene Versionen sind schreibgeschützt.
- **Basisplan / Vergleich**: Eine eingefrorene Version kann als Basisplan gewählt werden. Der Gantt zeigt
  dann dünne graue Balken für den Basisplan unter den aktuellen Balken; eine Tabelle listet Verschiebungen
  (Start/Ende/Dauer/Meilensteine in Tagen) – das ist auch die Zahl für den Flash-Report.
- **Ältere Version wieder zur Arbeitsversion machen**: als „Neue Version aus Version 2“ (kopieren statt
  zurückdrehen), damit die Historie nie verloren geht.
- **Stabile Vorgangs-Schlüssel**: Jeder Vorgang behält über alle Versionen dieselbe `key`-ID. Darüber
  laufen Vergleich, Basisplan und die Verknüpfung von Tasks mit Vorgängen.
- **Was der Kunde sieht** (Projekteinstellung): entweder die Arbeitsversion live oder nur die zuletzt
  *freigegebene* Version. Vorschlag: Standard „freigegebene Version“.

## 3. Taskliste

Die Taskliste ist **nicht versioniert** und getrennt vom Plan – Tasks sind die laufenden To-dos und offenen
Punkte („Kunde liefert Artikelstammdaten“, „Testzugang einrichten“).

- Felder wie ToDo-Liste der Shopping-App: Titel, Beschreibung, Status (eigene Status je Projekt), Fällig,
  Wer (mehrere Personen, auch Kunden), Priorität, Bereich/Tag, Kommentare, Anhänge, Links.
- Ebene: Projekt oder Teilprojekt; optional **verknüpft mit einem Plan-Vorgang** (über dessen `key`).
- Herkunft: von Hand, aus einem Meeting-Protokoll oder Flash-Report.
- Ansichten: Tabelle (gruppiert nach Fällig/Status/Wer/Teilprojekt), Kanban, „Meine Aufgaben“ über alle
  Projekte.
- Sichtbarkeit: *intern* oder *mit Kunde geteilt*.
- Kunden können ihnen zugewiesene Tasks abhaken, kommentieren und den Status ändern (je nach Rolle).

## 4. Flash-Report und Meeting-Protokoll

Beides sind **Dokumente** mit Datum, Ebene (Projekt/Teilprojekt) und Status *Entwurf* → *Veröffentlicht*.
Der Kunde sieht nur Veröffentlichtes. Veröffentlichte Dokumente sind eingefroren (Korrektur = neue Fassung
mit Hinweis).

**Flash-Report** (Statusbericht, z. B. 14-tägig):
- Ampeln: Gesamt, Termine, Budget/Aufwand, Umfang/Qualität – mit Trend (↑ → ↓) gegenüber dem letzten Report.
- Automatisch vorbefüllt: Fortschritt, nächste/verpasste Meilensteine, Abweichung zum Basisplan,
  erledigte und überfällige Tasks seit dem letzten Report, Aufwand geplant/geleistet.
- Freitext: Erreicht · Nächste Schritte · Risiken & Probleme · Entscheidungsbedarf.
- Neuer Report übernimmt Risiken/Entscheidungsbedarf aus dem letzten als Vorschlag.

**Meeting-Protokoll**:
- Art (Kick-off, Jour fixe, Lenkungsausschuss, Workshop), Datum, Ort/Online, Teilnehmer (aus Beteiligten
  oder frei), Agenda.
- Punkte mit Typ: *Info* · *Entscheidung* · *Aufgabe*. Aufgaben werden beim Speichern zu Tasks in der
  Taskliste (mit Rückverweis), Entscheidungen landen in einem Entscheidungslog des Projekts.
- Offene Tasks des Projekts lassen sich im Meeting durchgehen und direkt aktualisieren.

Beide: PDF-Export im Slimstock-Design und „Per Mail an Teilnehmer“ (Link, kein Anhang mit Daten).

## 5. Beteiligte und Rechte

Beteiligte sind Personen mit einer **Rolle je Projekt**; in Teilprojekten kann eine Rolle ergänzt oder
erhöht werden (nie gesenkt – vererbt wird von oben).

| Recht | Projektleitung (Slimstock) | Berater (Slimstock) | Projektleitung Kunde | Mitglied Kunde | Leser |
| --- | :-: | :-: | :-: | :-: | :-: |
| Interne Inhalte sehen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Plan-Arbeitsversion bearbeiten | ✅ | ✅ | ❌ | ❌ | ❌ |
| Version anlegen / freigeben | ✅ | ❌ | Freigabe bestätigen | ❌ | ❌ |
| Tasks anlegen / bearbeiten | ✅ | ✅ | ✅ | eigene | ❌ |
| Flash-Report / Protokoll schreiben, veröffentlichen | ✅ | ✅ (Entwurf) | Kommentieren | ❌ | ❌ |
| Beteiligte einladen, Rollen ändern | ✅ | ❌ | Kunden-Mitglieder | ❌ | ❌ |
| Projekt lesen (freigegebene Inhalte) | ✅ | ✅ | ✅ | ✅ | ✅ |

- **Slimstock-Mitarbeiter** melden sich per SSO (OIDC) an. Admins (Gruppe `admins`) legen Projekte an und
  sehen alles.
- **Kunden** haben kein Passwort: Zugang per Magic Link (Abschnitt 6).
- Alle Rechte prüft der Server; die Oberfläche blendet nur aus.
- Änderungsprotokoll pro Projekt (wer hat wann was geändert), für Kunden nur über geteilte Inhalte.

## 6. Kundenzugang per Magic Link

1. Projektleitung lädt eine Person mit E-Mail und Rolle ein → die App schickt eine Mail mit Link.
2. Später: Kunde gibt auf der Startseite seine E-Mail ein → neue Mail mit Link (nur wenn die Adresse
   eingeladen ist; die Antwort verrät nicht, ob es sie gibt).
3. Link: einmalig nutzbar, 15 Minuten gültig, Token nur als Hash in der DB.
4. Danach Sitzungscookie (HttpOnly, Secure, SameSite=Lax), z. B. 30 Tage, auf dem Gerät „merken“.
5. Entzug: Rolle entfernen beendet sofort alle Sitzungen der Person für dieses Projekt.
6. Rate-Limit pro Adresse und IP, Protokoll der Anmeldungen.

Braucht einen Mailversand (SMTP-Zugang in der `.env`). Slimstock-Mitarbeiter könnten den Magic Link als
Notlösung ebenfalls nutzen – Vorschlag: nein, nur SSO.

## 7. Technik

**Vorschlag: Stack der Shopping-App, aber ohne Offline-Sync.**

| Schicht | Wahl | Warum |
| --- | --- | --- |
| Server | Node 22 + Fastify, TypeScript | wie shopping; Mailversand, PDF, Jobs im selben Prozess |
| Datenbank | PostgreSQL 17 + Drizzle | Versionen, Rechte, Historie – relationale Daten |
| Frontend | React + Vite, PWA | Gantt, Tabelle, Kanban aus shopping wiederverwendbar |
| Geteilt | `packages/shared` mit Zod-Schemas und **`pm.ts` aus shopping** (Netzplan, Ressourcenabgleich) | eine Rechnung in Browser und Server (Server braucht sie für Flash-Report und PDF) |
| Echtzeit | WebSocket: „Projekt X hat sich geändert“ → neu laden | einfach; kein HLC/Feld-Sync nötig |
| PDF | Headless-Chromium (Playwright) oder `pdfmake` | Flash-Report/Protokoll im CD |
| Auth | OIDC (`openid-client`) + Magic Link + signierte Cookies | |

Bewusst **online-first**: Die App braucht eine Verbindung; offline nur Lesen des zuletzt Geladenen. Der
aufwendige Offline-Sync der Shopping-App (Feld-Uhren, IndexedDB-Vollkopie) lohnt sich hier nicht und macht
Rechte und Versionen deutlich schwieriger. Gleichzeitiges Bearbeiten: optimistische Sperre pro Datensatz
(Versionsnummer), bei Konflikt Hinweis „inzwischen geändert“.

Betrieb nach den üblichen Konventionen: Docker-Image `ghcr.io/doenke/<app>`, Healthcheck `/healthz`,
Versionierung x.yy.zzz, README im bekannten Stil, deutsche Oberfläche, englischer Code.

### Datenmodell (Skizze)

```
users            id, kind (staff|customer), sub?, email, name, avatar, is_admin
customers        id, name
projects         id, customer_id, parent_id?, name, code, calendar, settings, visible_plan (working|released)
memberships      project_id, user_id, role, invited_by, created_at
plan_versions    id, project_id, no, name, status (draft|released|archived), is_working, based_on, created_by, frozen_at
plan_items       id, version_id, key, parent_key?, subproject_id?, title, pm (jsonb wie shopping), progress,
                 actual_start, actual_end, internal, sort
tasks            id, project_id, plan_item_key?, title, status, due, assignees[], priority, internal, source_doc_id?
documents        id, project_id, type (flash|minutes), date, status, data (jsonb), published_at, author
decisions        id, project_id, document_id, text, date
comments         id, target (task|document|plan_item), author, text
magic_tokens     id, user_id, hash, expires_at, used_at
sessions / audit_log
```

Eindeutigkeit „genau eine Arbeitsversion“: partieller Unique-Index auf `plan_versions(project_id) WHERE is_working`.

## 8. Ausbaustufen

| Stufe | Inhalt |
| --- | --- |
| **1 – Gerüst** | Repo, Docker, Healthcheck, Versionierung, SSO-Login, Projekte + Teilprojekte anlegen, Beteiligte mit Rollen |
| **2 – Plan** | `pm.ts` übernehmen, Vorgänge mit Hierarchie, Tabelle + Gantt, Arbeitsversion |
| **3 – Versionen** | Version anlegen/einfrieren/freigeben, Basisplan im Gantt, Vergleichstabelle |
| **4 – Taskliste** | Tasks mit Tabelle/Kanban, Verknüpfung zum Plan, „Meine Aufgaben“ |
| **5 – Kunden** | Magic Link, Mailversand, Kundensicht (nur Geteiltes/Freigegebenes), Rechteprüfung, Tests dazu |
| **6 – Dokumente** | Meeting-Protokoll (→ Tasks, Entscheidungslog), Flash-Report mit Ampeln und Automatik |
| **7 – Feinschliff** | PDF-Export im CD, Kommentare, Änderungsprotokoll, Benachrichtigungen per Mail |

Später möglich: Import/Export MS Project (XML) und Excel, Aufwandserfassung, Projektportfolio über alle
Kunden, MCP-Schnittstelle wie in shopping.

## 9. Offene Fragen

1. **Login für Slimstock-Mitarbeiter**: Kanonenwiese SSO (Pocket ID) oder das Firmen-Login von Slimstock
   (Microsoft Entra ID)? Soll die App nur für dich oder für Kollegen sein?
2. **Hosting**: Kundendaten auf garageband (Docker) – passt das datenschutzrechtlich, oder soll es auf
   Slimstock-Infrastruktur/einen gemieteten Server? Danach richten sich Subdomain und Mailversand.
3. **Plan pro Projekt oder pro Teilprojekt?** Vorschlag: ein Plan fürs Gesamtprojekt, Teilprojekte als
   Phasen darin; Versionen gelten für den ganzen Plan.
4. **Kundensicht auf den Plan**: nur freigegebene Version (Vorschlag) oder live die Arbeitsversion?
5. **Was genau steht im Flash-Report?** Gibt es eine bestehende Slimstock-Vorlage (PowerPoint/Excel), die
   nachgebaut werden soll?
6. **„Was in der Shopping-App unter Projektmanagement schon da ist“** – gemeint ist die Projektplanung der
   ToDo-Listen (Netzplan, Gantt, Ressourcen, Kanban)? Code übernehmen (kopieren) oder als gemeinsames Paket?
   Vorschlag: `pm.ts` und Gantt kopieren und hier weiterentwickeln.
7. **Name und Subdomain** der App.
