# Slimstock Projektmanagement – Plan

Stand: 16.11.2026 · Entwurf zur Abstimmung, noch kein Code.

Eine Browser-App (PWA), in der Slimstock-Berater ihre Kundenprojekte führen und das Projektmanagement mit dem
Kunden teilen: Projektplan mit Arbeitsversion und Entwürfen, Aufwandskalkulation, Taskliste, Beteiligte mit
Rechten. Kunden kommen ohne Konto über ihren persönlichen Link hinein. Die App ist mehrsprachig (Deutsch und
Englisch, Sprache je Projekt). Später kommen Projektdesign aus
Vorlagen, Meeting-Protokolle und Flash-Reports dazu.

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
│   ├─ Teilprojekt A (Schnittstellen) – Taskliste
│   └─ Teilprojekt B (Schulung)       – Taskliste
├─ Aufwandskalkulation (steckt in jeder Planversion)
└─ Taskliste (Projekt-Ebene)

Vorlagen (Projektdesign, später)
└─ Vorlage „Slim4-Einführung“ mit Bausteinen (Teilprojekte) zum An- und Abwählen
```

- **Projekt**: gehört zu einem Kunden, hat Name, Kürzel, Zeitraum, Arbeitskalender, Status.
- **Teilprojekt**: eigener Name, eigene Verantwortliche, eigene Taskliste. Technisch ein Baum,
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
der Arbeitsversion seit dem Anlegen des Entwurfs geändert hat. Fortschritt, geleisteter Aufwand,
Restaufwand und Ist-Termine werden immer übernommen (sie beschreiben die Wirklichkeit, nicht die Planung).
Für alle anderen Änderungen zeigt die App eine Liste; im POC als Hinweis, später pro Vorgang und Feld
übernehmbar.

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
- **Annehmen** macht die Slimstock-Projektleitung – auch ohne Zustimmung des Kunden. Die Abstimmung ist ein
  Angebot, keine Pflicht. Zustimmungen und Ablehnungen (wer, wann, Begründung) werden mit der Version
  gespeichert und bleiben in der Historie nachvollziehbar; beim Annehmen ohne Zustimmung zeigt die App das
  als Hinweis an.

**Übernahme beim Annehmen** (entschieden): Fortschritt, Ist-Termine und geleisteter Aufwand aus der
Arbeitsversion werden immer automatisch in den angenommenen Entwurf übernommen.

## 3. Aufwandskalkulation

Kalkuliert wird ausschließlich in **Tagen pro Projektrolle und Projektschritt** – keine Preise, keine Euro.
Angebote und Preise bleiben außerhalb der App.

Die Kalkulation ist **Teil jeder Planversion** – sie hängt an den Vorgängen. Damit hat jeder Entwurf seine
eigene Kalkulation, der Vergleich zeigt neben Terminen auch Mehr- oder Minderaufwand in Tagen, und ein Entwurf
mit zusätzlichem Umfang ist zugleich ein **Nachtrag (Change Request)**: Zustimmung des Kunden = Beauftragung.

### Planaufwand

- **Tage pro Vorgang und Projektrolle** (in Vierteltagen; intern Minuten wie in `pm.ts`, 1 Tag = 8 h),
  z. B. „Datenanalyse: Solution Architect 2, Consultant 3, Key User 2, IT-Interface 1“.
- Kalkuliert wird mit den **Projektrollen** aus Abschnitt 7 – Slimstock- und Kundenrollen gleichermaßen. Der
  Kunde sieht so, wie viele Tage seine Leute einplanen müssen.
- Rollen ohne Aufwand (z. B. Sponsor) sind als „nicht kalkuliert“ markiert und erscheinen nicht als Spalte.
- Summen auf jeder Ebene (Vorgang → Phase → Teilprojekt → Projekt) nach Rolle, getrennt nach
  **Slimstock-Tagen** und **Kunden-Tagen**.
- Verbindung zur Planung: Die Automatik „Dauer aus Aufwand“ aus shopping rechnet mit dem Aufwand der
  eingeteilten Personen (Person mit passender Rolle am Vorgang).
- **Abrechnungsart pro Teilprojekt**: *nach Aufwand* (Standard) oder *Festpreis* (siehe unten).

### Festpreis – was das bedeuten könnte (Vorschlag)

Da die App keine Euro kennt, wirkt sich Festpreis nur auf die Tage und die Kundensicht aus:

1. **Budget wird festgeschrieben**: Beim Markieren als Festpreis (bzw. beim Annehmen der Version, in der das
   passiert) werden die Slimstock-Tage des Teilprojekts als vereinbartes Budget gespeichert. Spätere
   Planänderungen ändern dieses Budget nicht – nur ein angenommener Entwurf, der ausdrücklich als **Nachtrag**
   gekennzeichnet ist.
2. **Mehraufwand ist Slimstock-Risiko**: Prognose über Budget erscheint intern rot.
3. **Kundensicht**: Bei Festpreis sieht der Kunde nur Fortschritt, Termine und seine eigenen Kunden-Tage –
   keine Slimstock-Ist-Tage und keine Prognose.
4. **Umfangsänderung**: Kommen in einem Entwurf Vorgänge in einem Festpreis-Teilprojekt dazu, fragt die App
   beim Annehmen: „Nachtrag (Budget erhöhen) oder im Festpreis (Budget bleibt)?“

Bei *nach Aufwand* folgt das Budget immer der Arbeitsversion, und der Kunde kann Ist und Prognose sehen
(je nach Projekteinstellung). Datenmodell und Oberfläche sehen die Abrechnungsart vor; die Regeln oben
setzen wir um, wenn du sie bestätigt hast.

### Ist und Prognose

- **Ist-Tage von Hand**: Buchungen am Vorgang mit Datum, Person, Rolle, Tagen und Notiz. Die Summe ist das
  Ist; über das Datum ergibt sich der Verlauf pro Monat. Buchungen hängen am Vorgang über dessen `key` und
  gelten damit unabhängig von Versionen.
- **Restaufwand** pro Vorgang und Rolle (Schätzung, Vorschlag = Plan − Ist).
- **Prognose** = Ist + Rest, Abweichung zum Budget in Tagen und %, mit Ampel ab einstellbaren Schwellen. Das
  ist später die Budget-Ampel im Flash-Report.
- **Bedarf über die Zeit**: Aus Plan-Terminen und Aufwand ergibt sich der Bedarf pro Monat und Rolle
  (Auslastung Slimstock, Belastung beim Kunden).

### Ansichten

- **Kalkulationstabelle**: Baum Teilprojekt → Phase → Vorgang, Spalten je Projektrolle, Summen; direkt
  bearbeitbar (in Entwürfen und der Arbeitsversion).
- **Vergleich**: Entwurf gegen Arbeitsversion – Δ Tage pro Zeile, Rolle und gesamt.
- **Budget**: Plan / Ist / Rest / Prognose je Teilprojekt und Rolle.
- **Export** als Excel (Aufwandsaufstellung, Nachtragsaufstellung) – in der Projektsprache.

### Was der Kunde sieht

Pro Projekt einstellbar: *nichts* · *nur Kunden-Tage* · *alle Tage (Plan)* · *alle Tage mit Ist und
Prognose*. Für Festpreis-Teilprojekte gilt höchstens „alle Tage (Plan)“.

## 4. Projektdesign aus Vorlagen (später – jetzt nur angedacht)

Beim Anlegen eines Projekts wählt man aus einer Vorlage die passenden Bausteine aus; daraus baut die App den
Projektplan samt Kalkulation. Was der Kunde nicht gekauft hat, kommt gar nicht erst in den Plan.

### Vorlagen und Bausteine

- **Vorlage** (z. B. „Slim4-Einführung Standard“): eine Sammlung von **Bausteinen**, gepflegt von Admins.
  Alle Texte einer Vorlage (Bausteine, Vorgänge, Tasks) werden **je Sprache** gepflegt; beim Erzeugen
  kommen sie in der Projektsprache ins Projekt (fehlt eine Übersetzung: Englisch, dann Deutsch).
- **Baustein = Teilprojekt** (z. B. Basis/Setup, Forecasting, Replenishment, Inventory Optimization,
  S&OP, ERP-Schnittstelle, Schulung, Go-live-Begleitung). Ein Baustein enthält Phasen, Vorgänge,
  Meilensteine, Tage pro Projektrolle, Abhängigkeiten (auch zu anderen Bausteinen) und optional
  Standard-Tasks (Checklisten).
- **Auswahlregeln** pro Baustein: *Pflicht* · *Standard an* · *Standard aus*; „benötigt Baustein X“;
  „genau einer aus Gruppe“ (z. B. Schnittstelle SAP / Dynamics / Datei). Auch einzelne Vorgänge können
  optional sein (z. B. „Vor-Ort-Workshop“ statt online).
- **Mengentreiber** (Parameter): z. B. Anzahl Standorte, Schnittstellen, Key User. Aufwand eines Vorgangs =
  fester Teil + Teil pro Einheit; Vorgänge können sich pro Einheit wiederholen („Schulung Standort“ × 3).

### Assistent „Neues Projekt“

1. Kunde, Name, Start, Arbeitskalender.
2. Vorlage wählen.
3. Bausteine an- und abwählen, Mengentreiber eintragen – daneben laufend Summe Tage je Rolle und voraussichtliches
   Projektende.
4. Vorschau als Gantt.
5. Erzeugen: Teilprojekte, Plan und Kalkulation entstehen als **erster Entwurf** (so kann man ihn direkt
   mit dem Kunden abstimmen) – oder auf Wunsch gleich als Arbeitsversion.

### Regeln beim Erzeugen

- Vorgänge abgewählter Bausteine entfallen. **Abhängigkeiten werden überbrückt**: Hing C über B an A und
  fällt B weg, hängt C danach direkt an A – die Kette reißt nicht.
- Jeder erzeugte Vorgang merkt sich seine Herkunft (Vorlage, Version, Baustein, Vorlagen-Vorgang).
- **Vorlagen sind versioniert**: Änderungen an einer Vorlage verändern laufende Projekte nicht.
- **Baustein nachträglich dazu** (Kunde kauft ein Modul nach): erzeugt einen Entwurf mit den neuen Vorgängen
  und deren Aufwand – also direkt einen Nachtrag zur Abstimmung.
- **Aus einem Projekt eine Vorlage machen**: ein gut gelaufenes Projekt (oder einzelne Teilprojekte) als
  Vorlage bzw. Baustein speichern.

### Was schon jetzt vorbereitet wird

Damit das später ohne Umbau passt: stabile `key` je Vorgang, Aufwand pro Rolle (nicht nur eine Zahl),
Teilprojekte als eigene Einheit im Plan, Herkunftsfeld `origin` an Vorgängen und Teilprojekten, und ein
Plan-Kopierer, der Vorgänge samt Abhängigkeiten in einen Entwurf einfügt (den brauchen Entwürfe ohnehin).

## 5. Taskliste

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

## 6. Meeting-Protokoll und Flash-Report (später)

Beides kommt nach dem POC. Hier festgehalten, damit das Datenmodell passt.

**Meeting-Protokoll**: Dokument mit Datum, Ebene (Projekt/Teilprojekt) und Status *Entwurf* →
*Veröffentlicht*. Der Kunde sieht nur Veröffentlichtes.

- Art (Kick-off, Jour fixe, Lenkungsausschuss, Workshop), Datum, Ort/Online, Teilnehmer (aus Beteiligten oder
  frei), Agenda.
- Punkte mit Typ: *Info* · *Entscheidung* · *Aufgabe*. Aufgaben werden beim Speichern zu Tasks (mit
  Rückverweis), Entscheidungen landen im Entscheidungslog des Projekts.
- Offene Tasks lassen sich im Meeting durchgehen und direkt aktualisieren.
- PDF-Export im Slimstock-Design.

**Flash-Report**: Statusbericht mit Ampeln (Termine, Budget, Umfang) und Trend, vorbefüllt aus Plan,
Kalkulation (Prognose) und Tasks. Details klären wir, wenn es so weit ist. Das Datenmodell sieht Dokumente
mit Typ vor, er passt also ohne Umbau dazu.

## 7. Beteiligte, Projektrollen und Rechte

Zwei Dinge werden getrennt:

- **Projektrolle** – was jemand im Projekt *tut*. Grundlage für Kalkulation, Zuständigkeiten und die
  Beteiligtenliste. Eine Person kann **mehrere Projektrollen** haben.
- **Berechtigung** – was jemand in der App *darf*. Ergibt sich aus den Projektrollen, lässt sich pro Person
  überschreiben.

### Projektrollen

| Slimstock | Kunde |
| --- | --- |
| Projektleiter | Projektleiter |
| Solution Architect | Projektmanager |
| Technical Consultant | Key User |
| Consultant | User |
| Trainer | IT-Infrastructure |
| Sponsor | IT-Interface |
| | IT-Interface-Partner |
| | Sponsor |

- Die Liste ist **erweiterbar**: Admins legen Rollen an, benennen um, sortieren, deaktivieren (gelöscht wird
  nichts, was schon benutzt wurde). Jede Rolle hat Namen je Sprache, eine Seite (Slimstock/Kunde), „wird
  kalkuliert“ ja/nein und eine Standard-Berechtigung.
- Pro Person im Projekt beliebig viele Rollen; in Teilprojekten ergänzbar (z. B. Consultant nur im
  Teilprojekt Schulung).
- Die Kalkulation plant gegen **Rollen**, die Einsatzplanung gegen **Personen** mit dieser Rolle.
- IT-Interface-Partner (z. B. der ERP-Dienstleister des Kunden) kommt wie Kundenpersonen über den
  persönlichen Link.

### Berechtigungen

Fünf Stufen. Die wirksame Stufe ist die höchste aus den Rollen der Person, pro Person überschreibbar.

| Stufe | Standard für Rollen (Vorschlag) |
| --- | --- |
| Projektleitung Slimstock | Projektleiter (Slimstock) |
| Team Slimstock | Solution Architect, Technical Consultant, Consultant, Trainer, Sponsor (Slimstock) |
| Projektleitung Kunde | Projektleiter, Projektmanager, Sponsor (Kunde) |
| Team Kunde | Key User, IT-Infrastructure, IT-Interface, IT-Interface-Partner |
| Leser | User |

| Recht | PL Slimstock | Team Slimstock | PL Kunde | Team Kunde | Leser |
| --- | :-: | :-: | :-: | :-: | :-: |
| Interne Inhalte sehen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Arbeitsversion und Entwürfe bearbeiten, Entwurf anlegen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Entwurf zur Abstimmung geben, annehmen; Sichtbarkeit für Kunden | ✅ | ❌ | ❌ | ❌ | ❌ |
| Für Kunden sichtbare Versionen sehen und kommentieren | ✅ | ✅ | ✅ | ✅ | sehen |
| Entwurf zustimmen / ablehnen | – | – | ✅ | ❌ | ❌ |
| Kalkulation bearbeiten, Ist-Tage buchen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Kalkulation sehen | ✅ | ✅ | je Projekteinstellung | je Projekteinstellung | ❌ |
| Tasks anlegen / bearbeiten | ✅ | ✅ | ✅ | eigene | ❌ |
| Beteiligte einladen, Rollen ändern | ✅ | ❌ | Kundenseite | ❌ | ❌ |
| Projekteinstellungen (Sprache, Kundensicht) | ✅ | ❌ | ❌ | ❌ | ❌ |

- **Admins** (Slimstock) legen Projekte und Slimstock-Benutzer an, pflegen die Rollenliste und (später)
  Vorlagen und sehen alles.
- Alle Rechte prüft der Server; die Oberfläche blendet nur aus.
- Änderungsprotokoll pro Projekt (wer hat wann was geändert).

## 8. Anmeldung

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

- Jede eingeladene Kundenperson bekommt **pro Projekt einen persönlichen Link**, z. B.
  `https://<adresse>/k/<token>`. Er läuft **nicht ab**. Wer ihn als Lesezeichen speichert, braucht kein Login.
- Der Link öffnet genau dieses eine Projekt. Ist dieselbe Person (gleiche E-Mail) in mehreren Projekten
  dabei, hat sie mehrere Links; die Person bleibt trotzdem ein Benutzer (Name, Kommentare, Zuweisungen).
- Token: 32 Byte Zufall. In der DB verschlüsselt (mit einem Schlüssel aus der Env), damit die Projektleitung
  den Link jederzeit wieder **kopieren oder erneut zusenden** kann, ohne dass er sich ändert.
- **Link erneuern** macht den alten sofort ungültig (z. B. wenn er weitergeleitet wurde). **Person
  entfernen** sperrt den Link und damit den Zugang zu diesem Projekt sofort.
- Beim Öffnen setzt die App zusätzlich ein Cookie, damit die installierte PWA auch ohne Link-Aufruf startet.
- Schutz: `Referrer-Policy: no-referrer` (der Link landet nicht bei fremden Seiten), `noindex`, keine
  externen Inhalte, Protokoll der Zugriffe (letzter Zugriff pro Person sichtbar), Rate-Limit auf `/k/`.
- **Bewusste Grenze:** Wer den Link hat, ist drin – wie bei einem geteilten Dokument-Link. Das steht in der
  Einladung, und die Rechte der Kundenrollen sind entsprechend begrenzt (nichts Internes, kein Löschen).
- Versand: Die App zeigt den Link zum Kopieren/Teilen. Mailversand per SMTP ist optional (`SMTP_*` in der
  Env); ohne SMTP wird einfach kopiert.

## 9. Mehrsprachigkeit

Von Anfang an mehrsprachig: zum Start **Deutsch und Englisch**, vorbereitet für **Niederländisch und
Spanisch**, weitere Sprachen nur durch eine neue Sprachdatei.

- **Projektsprache** – je Projekt einstellbar. Sie ist die Standardsprache der Oberfläche für alle
  Beteiligten dieses Projekts und die Sprache von Einladungen, Mails, Exporten (Excel, später PDF) und der
  Texte, die aus Vorlagen ins Projekt kommen.
- **Spontan umschalten** – jeder kann über das Sprachmenü in der Kopfzeile jederzeit umschalten; das wirkt
  sofort. Die Wahl bleibt gemerkt (Slimstock-Benutzer im Profil, Kunden pro Link) und lässt sich mit
  „Projektsprache verwenden“ wieder zurücksetzen.
- Reihenfolge: eigene Wahl → Projektsprache → Browsersprache → Englisch. Außerhalb eines Projekts
  (Login, Projektliste) gilt eigene Wahl → Browsersprache.
- **Übersetzt wird** alles, was die App mitbringt: Oberfläche, Fehlermeldungen, Mails, Systembegriffe
  (Projektrollen, Standard-Status, Abhängigkeitstypen, Berechtigungsstufen) sowie Datums- und Zahlenformate
  (`16.11.2026` / `16/11/2026`, `1.234,5` / `1,234.5`, Wochenbeginn).
- **Nicht übersetzt** werden Inhalte, die Menschen schreiben (Vorgänge, Tasks, Kommentare) – sie bleiben in
  der Sprache, in der sie geschrieben wurden. Später denkbar: Übersetzung auf Knopfdruck.
- Vorlagen pflegen ihre Texte je Sprache (Abschnitt 4).

Technik: `i18next` mit `react-i18next` im Browser, dieselben Sprachdateien (JSON, eine pro Sprache, in
`packages/shared/locales`) im Server für Mails und Exporte. Schlüssel englisch, keine Texte hart im Code.
Ein Test in der CI prüft, dass Deutsch und Englisch vollständig sind; fehlende Schlüssel in NL/ES fallen
auf Englisch zurück. Formatierung über `Intl`.

## 10. Technik

**Stack der Shopping-App, aber ohne Offline-Sync.**

| Schicht | Wahl | Warum |
| --- | --- | --- |
| Server | Node 22 + Fastify, TypeScript | wie shopping; Mail, PDF, Jobs im selben Prozess |
| Datenbank | PostgreSQL 17 + Drizzle | Versionen, Rechte, Historie – relationale Daten |
| Frontend | React + Vite, PWA | Gantt, Tabelle, Kanban aus shopping wiederverwendbar |
| Geteilt | `packages/shared`: Zod-Schemas, **`pm.ts` aus shopping**, Versionsvergleich | eine Rechnung in Browser und Server |
| Sprachen | `i18next` + `react-i18next`, `Intl` | Sprachdateien für Browser und Server gemeinsam |
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
| `DEFAULT_LANGUAGE` | Sprache für neue Projekte und die Anmeldeseite (`de` oder `en`) |
| `TZ` | `Europe/Berlin` |

Sonst wie üblich: Image `ghcr.io/doenke/slimstock-project`, Healthcheck `/healthz` (prüft DB),
`compose.example.yml` mit Postgres, Versionierung x.yy.zzz, README im bekannten Stil (deutsch), mehrsprachige
Oberfläche, englischer Code. Für den Umzug zu Slimstock: Image + Datenbank-Dump, keine weiteren Abhängigkeiten.

### Datenmodell (Skizze)

```
users            id, kind (staff|customer), username?, password_hash?, email, name, is_admin, language?,
                 last_seen_at
customers        id, name
projects         id, customer_id, parent_id?, name, code, language, calendar, settings
                 (customer_effort_view, …), origin?
project_roles    id, side (slimstock|customer), names (jsonb je Sprache), calculated, default_permission,
                 sort, active
memberships      id, project_id, user_id, permission_override?, invited_by, created_at,
                 link_token_hash?, link_token_enc?, link_rotated_at, link_last_used_at, link_language?
member_roles     membership_id, role_id, subproject_id?
plan_versions    id, project_id, kind (working|draft|history), name, description,
                 status (editing|in_review|accepted|rejected|discarded),
                 based_on_version_id, based_on_snapshot_at, customer_visible, is_change_request,
                 created_by, accepted_by, accepted_at, replaced_at
version_reviews  version_id, user_id, verdict (approve|reject), comment, at
plan_items       id, version_id, key, parent_key?, subproject_id?, title, pm (jsonb wie shopping),
                 progress, actual_start, actual_end, owner_user_id?, internal, sort, rev, origin?
item_efforts     plan_item_id, role_id, planned, remaining                  (Minuten)
effort_entries   id, project_id, item_key, user_id, role_id, date, minutes, note   (Ist, versionsunabhängig)
subproject_terms version_id, subproject_id, billing (tm|fixed), fixed_budget?

templates        id, names (jsonb je Sprache)                               (später: Projektdesign)
template_versions id, template_id, no, published_at
template_modules id, template_version_id, names, rule (required|default_on|default_off), group?, requires[]
template_items   id, module_id, key, parent_key?, titles, pm, efforts, optional, per_param?
template_params  id, template_version_id, name, unit, default
tasks            id, project_id, plan_item_key?, title, status, due, assignees[], priority, internal,
                 source_doc_id?, rev
documents        id, project_id, type (minutes|flash), date, status, data (jsonb), published_at, author
decisions        id, project_id, document_id, text, date
comments         id, target (version|plan_item|task|document), target_id, author, text, at
sessions, audit_log
```

„Genau eine Arbeitsversion“: partieller Unique-Index auf `plan_versions(project_id) WHERE kind = 'working'`.
Annehmen ist eine Transaktion: alte Arbeitsversion → `history`, Entwurf → `working`, Fortschritt, Ist und
Rest aus der alten Arbeitsversion übernehmen. Ist-Buchungen hängen am Vorgang über `key` und gelten so
für jede Version.

## 11. Ausbaustufen

| Stufe | Inhalt |
| --- | --- |
| **1 – Gerüst** | Repo, Docker + Postgres, Healthcheck, Versionierung, Mehrsprachigkeit (de/en) von Anfang an, Login mit Benutzername/Passwort, Benutzerverwaltung, Projektrollen (erweiterbar), Projekte + Teilprojekte, Beteiligte mit Rollen und Berechtigungen |
| **2 – Plan** | `pm.ts` und Gantt aus shopping übernehmen, Vorgänge mit Hierarchie, Tabelle + Gantt, Arbeitsversion |
| **3 – Entwürfe** | Entwürfe anlegen/bearbeiten/verwerfen, Vergleich (Gantt + Tabelle), Annehmen mit Übernahme der Ist-Daten, Historie |
| **4 – Kalkulation** | Tage pro Vorgang und Projektrolle, Summen, Vergleich Δ Tage, Ist-Buchungen von Hand, Rest/Prognose, Abrechnungsart (Festpreis-Regeln nach Bestätigung), Excel-Export |
| **5 – Kunden** | Persönliche Links pro Projekt, Kundensicht, Sichtbarkeit pro Version, Abstimmung (zustimmen/ablehnen, Kommentare), Rechteprüfung mit Tests |
| **6 – Taskliste** | Tasks mit Tabelle/Kanban, Verknüpfung zum Plan, „Meine Aufgaben“ |
| **7 – Feinschliff** | Änderungsprotokoll, Mail-Benachrichtigungen (neuer Entwurf zur Abstimmung, Task zugewiesen) |

Stufen 1–7 sind der POC auf garageband.

**Danach, in dieser Reihenfolge vorgeschlagen:**
1. **Projektdesign aus Vorlagen** (Abschnitt 4): Vorlagen und Bausteine pflegen, Assistent, Mengentreiber,
   Baustein nachträglich als Nachtrag.
2. **Meeting-Protokolle** und **Flash-Report** (Abschnitt 6), PDF-Export im Slimstock-Design.
3. Firmenlogin per OIDC, Umzug zu Slimstock, Sprachen Niederländisch und Spanisch.
4. Import/Export MS Project (XML), Import Ist-Aufwand aus der Zeiterfassung, Projektportfolio über alle
   Kunden, MCP-Schnittstelle wie in shopping.

## 12. Entschieden

- Entwürfe beliebig viele; ein angenommener Entwurf wird zur Arbeitsversion.
- Die Slimstock-Projektleitung darf Entwürfe auch ohne Kunden-Zustimmung annehmen.
- Fortschritt, Ist-Termine und Ist-/Restaufwand werden beim Annehmen immer übernommen.
- Sichtbarkeit für den Kunden pro Version einstellbar; auch Entwürfe lassen sich abstimmen.
- Ein Plan pro Projekt.
- Kunden-Link pro Person und Projekt, ohne Ablauf.
- Slimstock-Login vorerst mit Benutzername und Passwort.
- POC auf garageband, Adresse per Docker-Env; danach Umzug zu Slimstock.
- Rechenkern und Gantt aus shopping werden kopiert und hier weiterentwickelt.
- Meeting-Protokolle und Flash-Report nach dem POC.
- Kalkulation nur in Tagen pro Projektrolle und Projektschritt, keine Euro; Ist-Tage von Hand.
- Projektrollen Slimstock und Kunde wie in Abschnitt 7, erweiterbar, mehrere Rollen pro Person.
- Festpreis ist eine Option pro Teilprojekt; die Regeln dazu sind noch Vorschlag.
- Mehrsprachig: Deutsch und Englisch zum Start, Projektsprache je Projekt, spontan umschaltbar.

## 13. Offene Fragen

1. **Festpreis**: Passen die vier Regeln in Abschnitt 3 (Budget festschreiben, Mehraufwand intern rot,
   eingeschränkte Kundensicht, Nachfrage „Nachtrag oder im Festpreis?“)?
2. **Berechtigungen aus Rollen**: Passt die Zuordnung in Abschnitt 7 – insbesondere Sponsor (Kunde) als
   Projektleitung Kunde (darf also Entwürfen zustimmen) und User nur als Leser?
3. **Kundensicht auf die Kalkulation**: Welche der vier Stufen soll Standard sein? Vorschlag: „alle Tage
   (Plan)“.
4. **Vorlagen**: kommen Ende der Woche von dir.
