# Turnistica Paradise

Web app professionale di turnistica per uso reale in salone, costruita con Next.js App Router e persistenza ibrida:
- locale su file per l'uso quotidiano sul PC del salone
- cloud su Neon PostgreSQL per deploy Netlify

## Cosa include
- Accesso rapido con PIN fisso `190326`
- Home dedicata solo a oggi e domani
- Pianificazione mese/settimana con autosave, undo/redo e storico versioni
- Gestione personale con foto salvate localmente su questo PC
- Regole, preferenze, indisponibilita e turni personalizzati
- Export/import JSON e CSV
- Stampa A4 landscape ottimizzata per il mese completo
- Server accessibile in LAN/Wi-Fi su `0.0.0.0:3001`

## Stack
- Next.js 14 App Router
- React 18
- TypeScript strict
- CSS Modules + design tokens interni
- Persistenza locale in `.local-data/`
- Prisma + Neon per deploy cloud

## Avvio locale
1. `npm install`
2. `npm run dev`
3. Apri `http://localhost:3001`
4. Da tablet o telefono nella stessa rete, apri `http://IP-DEL-PC:3001`

## Produzione locale sul PC del salone
1. `npm run build`
2. `npm run start`

Il server ascolta gia su `0.0.0.0:3001`, quindi resta raggiungibile anche dagli altri dispositivi della rete locale.

## Dati locali
- Archivio principale: `.local-data/turnistica.json`
- Foto dipendenti: `.local-data/employee-photos/`

Se il file dati e vuoto o corrotto, l'app prova a ricreare una struttura sicura senza dipendere da servizi esterni.

## Variabili opzionali
Puoi copiare `.env.example` in `.env.local` se vuoi personalizzare:
- `PARADISE_STORAGE_MODE=local` per forzare il file locale
- `PARADISE_STORAGE_MODE=database` per usare Neon anche fuori da Netlify
- `PARADISE_SESSION_SECRET` per firmare la sessione locale
- `SIMPLE_PIN` se un domani vuoi cambiare il PIN
- `DATABASE_URL` connessione pooled Neon per runtime
- `DIRECT_URL` connessione diretta Neon per `prisma db push`

Se non imposti nulla, l'app funziona subito con il PIN `190326`.

## Deploy Vercel + Supabase
1. Crea un database PostgreSQL su Supabase.
2. In Vercel imposta queste variabili ambiente:
   - `PARADISE_STORAGE_MODE=database`
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `PARADISE_SESSION_SECRET`
   - `SIMPLE_PIN`
3. Vercel usa il comando `build` del progetto, gia configurato.
4. Durante il build:
   - Prisma genera il client
   - Prisma applica lo schema con `db push`
   - `scripts/bootstrap-database.ts` copia i dati iniziali da `.local-data/` nel database se e ancora vuoto
5. Dopo il primo deploy, i dati vivono su Supabase e le foto personale vengono lette dal database.

## Deploy Netlify + Neon
1. Crea un database Neon PostgreSQL.
2. In Netlify imposta queste variabili ambiente:
   - `PARADISE_STORAGE_MODE=database`
   - `PARADISE_SESSION_SECRET`
   - `SIMPLE_PIN`
3. Se hai installato l'estensione Neon di Netlify, bastano gia:
   - `NETLIFY_DATABASE_URL`
   - `NETLIFY_DATABASE_URL_UNPOOLED`
   Il build le mappera automaticamente in `DATABASE_URL` e `DIRECT_URL`.
4. Se non usi l'estensione Neon, imposta manualmente:
   - `DATABASE_URL`
   - `DIRECT_URL`
5. Il repository include `netlify.toml`, quindi Netlify usera:
   - `npm run build:netlify`
6. Durante il build:
   - Prisma genera il client
   - Prisma applica lo schema con `db push`
   - `scripts/bootstrap-database.ts` copia i dati iniziali da `.local-data/` verso il database se e ancora vuoto
7. Dopo il primo deploy, i dati vivono su Neon e le foto personale vengono lette dal database.
