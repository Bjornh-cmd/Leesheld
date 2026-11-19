# Leesheld — adaptief begrijpend lezen voor groep 7

Een zelf te hosten webapp met twee rollen:

- **Ouder:** maakt een ouderaccount, maakt kindaccounts aan, maakt en publiceert eigen teksten met vragen en bekijkt resultaten.
- **Kind:** logt in met een door de ouder aangemaakte login, oefent zelfstandig, krijgt directe feedback, XP en een adaptieve volgende oefening.

De app bevat **42 startteksten** in `prisma/seed-lessons.json`. De teksten worden automatisch in PostgreSQL geplaatst als ze nog niet bestaan.

## Functies

- Ouderregistratie en login met gebruikersnaam/e-mail.
- Kindaccounts worden uitsluitend vanuit de ouderomgeving gemaakt.
- Wachtwoorden worden gehasht met bcrypt (12 rondes); er worden nooit leesbare wachtwoorden in de database opgeslagen.
- Sessies staan server-side in PostgreSQL; cookie is HttpOnly, SameSite=Lax en Secure in productie.
- Ouders kunnen eigen leesteksten en 3–20 meerkeuzevragen publiceren.
- Kinderen zien de 42 algemene startteksten plus teksten van hun eigen ouder.
- **Start adaptief oefenen:** de eerste oefening is een startmeting. Na minstens twee resultaten kiest de server een niveau op basis van het gemiddelde. Daarna wordt waar mogelijk geoefend op de vaardigheid die in eerdere antwoorden het zwakst was en worden recent gemaakte teksten vermeden.
- Scoreberekening gebeurt op de server; het kind kan de juiste antwoorden niet aanpassen door alleen de browser te wijzigen.
- Voortgang, XP, resultaten en vaardigheden worden per kind bijgehouden.
- PostgreSQL-opslag blijft bestaan bij herstarts via een Docker-volume.

## Snel starten met Docker Compose

Vereisten: Docker Engine + Docker Compose plugin.

1. Kopieer `.env.example` naar `.env`.
2. Genereer de waarden met `openssl rand -hex 32` voor `SESSION_SECRET` en `openssl rand -hex 24` voor `POSTGRES_PASSWORD`.
3. Start de stack:

```bash
docker compose up -d --build
```

4. Open `http://localhost:3000`.
5. Kies **Ouderaccount maken**, maak je ouderaccount en voeg daarna kindaccounts toe.

De app voert bij opstarten `prisma db push` uit, importeert de 42 voorbeeldteksten en start daarna de webserver. De PostgreSQL-data staat in volume `leesheld_pg`.

## Deployen op Coolify door GitHub-import (Docker Compose)

Dit project is ingericht voor de GitHub → Coolify → Docker Compose-route. Coolify bouwt zelf de Docker-image vanuit de `Dockerfile`; PostgreSQL draait als aparte, interne container met blijvende opslag.

### 1. Zet het project op GitHub

1. Download en pak het ZIP-bestand uit op je computer.
2. Installeer [Git for Windows](https://git-scm.com/download/win) en [GitHub CLI](https://cli.github.com/).
3. Open PowerShell in de map `leesheld-app` (de map waar `Dockerfile` staat).
4. Meld eenmalig aan bij GitHub:

```powershell
gh auth login
```

5. Publiceer de complete app en maak automatisch een **private** repository `leesheld` aan:

```powershell
.\push-to-github.ps1
```

Het script maakt de repository aan als die nog niet bestaat. Bestaat die al, dan pusht het naar die repository. `.env` en wachtwoorden worden door `.gitignore` uitgesloten.

### 2. Importeer de repository in Coolify

1. Open Coolify en kies **Projects → jouw project → Add New Resource**.
2. Kies **Private Repository (GitHub App)** (of de GitHub/Git-provideroptie die jouw Coolify-versie toont) en verbind GitHub als Coolify daarom vraagt.
3. Selecteer repository `leesheld` en branch `main`.
4. Kies **Docker Compose** als Build Pack / resource-type.
5. Vul als Compose-file path exact in: `docker-compose.coolify.yml`.
6. Sla de resource op. Coolify gebruikt de Compose-configuratie uit GitHub; de app wordt gebouwd met de meegeleverde `Dockerfile`.

### 3. Stel de secrets en het domein in

Voeg bij de Environment Variables van de Coolify-resource deze twee variabelen toe. Gebruik eigen willekeurige waarden:

```env
SESSION_SECRET=VUL_EEN_WILLEKEURIGE_SLEUTEL_VAN_MINIMAAL_64_HEX_TEKENS_IN
POSTGRES_PASSWORD=VUL_EEN_WILLEKEURIG_DATABASE_WACHTWOORD_IN
```

Je kunt ze op je eigen computer genereren met:

```bash
openssl rand -hex 32
openssl rand -hex 24
```

Gebruik de eerste uitvoer als `SESSION_SECRET` en de tweede als `POSTGRES_PASSWORD`. Zet deze waarden alleen in Coolify, nooit in GitHub.

Stel daarna bij de app-service je domein in en gebruik containerpoort **3000**. PostgreSQL hoeft niet publiek bereikbaar te zijn. Klik **Deploy**. Bij het opstarten maakt de app de databasetabellen aan, importeert hij de 42 voorbeeldteksten en start hij de website.

### 4. Eerste gebruik en updates

1. Open je domein via HTTPS.
2. Maak via **Ouderaccount maken** het eerste ouderaccount.
3. Maak daarna de kindaccounts vanuit de ouderomgeving.
4. Bij een volgende `git push` kan Coolify de nieuwe versie opnieuw deployen. De PostgreSQL-data blijft behouden zolang je het volume `leesheld_pg` niet verwijdert.

Maak in Coolify periodieke PostgreSQL-backups en bewaar die buiten dezelfde VPS.

## Beveiliging en privacy

- Gebruik HTTPS via Coolify en sterke, unieke wachtwoorden.
- Maak geen openbare kindregistratie aan: kinderen worden door een ouder aangemaakt.
- Sla geen geboortedatum, school of onnodige persoonsgegevens op.
- Ouders kunnen het wachtwoord van een kind resetten. Er is geen e-mail-wachtwoordherstel ingebouwd.
- De ouder kan de voortgang van eigen kinderen zien; kinderen kunnen geen andere familieaccounts opvragen.
- Beperk toegang tot de Coolify- en databasebeheeromgeving.
- Maak regelmatig databasebackups en test herstel.
- Dit project is een technische basis; toets vóór gebruik door een school of organisatie zelf de AVG/privacy- en bewaartermijnvereisten.

## Omgevingsvariabelen

| Variabele | Verplicht | Betekenis |
|---|---:|---|
| `DATABASE_URL` | Ja, intern | PostgreSQL-connection string. De meegeleverde Compose-bestanden bouwen deze URL uit `POSTGRES_PASSWORD`. |
| `POSTGRES_PASSWORD` | Ja bij Compose | Wachtwoord voor de interne PostgreSQL-service |
| `SESSION_SECRET` | Ja | Minimaal 32 tekens, voor sessieondertekening |
| `PORT` | Nee | Webserverpoort, standaard `3000` |
| `NODE_ENV` | Nee | Gebruik `production` op Coolify |

## Projectstructuur

```text
leesheld/
├── Dockerfile
├── docker-compose.yml
├── docker-compose.coolify.yml
├── package.json
├── prisma/
│   ├── schema.prisma
│   └── seed-lessons.json
└── src/
    ├── server.js
    └── public/
        └── index.html
```
