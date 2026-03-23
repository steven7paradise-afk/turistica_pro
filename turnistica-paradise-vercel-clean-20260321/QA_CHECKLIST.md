# Turnistica Paradise - Payload e Test Manuali

## Esempio payload regole (POST /api/rules)
```json
{
  "employeeId": "emp_123",
  "unavailableDays": [0, 6],
  "forbiddenShiftIds": ["FULL", "CUSTOM:tpl_serale"],
  "preferredShiftId": "MATTINA",
  "note": "Preferisce mattina, no weekend"
}
```

## Esempio assignment union
```json
{
  "kind": "STANDARD",
  "type": "MATTINA"
}
```

```json
{
  "kind": "CUSTOM",
  "templateId": "tpl_apertura",
  "name": "Apertura",
  "startTime": "08:30",
  "endTime": "13:30"
}
```

```json
null
```

## Esempio payload salvataggio mese (PUT /api/schedule?month=2026-03)
```json
{
  "expectedVersion": 7,
  "assignments": {
    "emp_123": {
      "2026-03-01": { "kind": "STANDARD", "type": "RIPOSO" },
      "2026-03-02": { "kind": "STANDARD", "type": "MATTINA" },
      "2026-03-03": { "kind": "CUSTOM", "templateId": "tpl_apertura", "name": "Apertura", "startTime": "08:30", "endTime": "13:30" }
    }
  }
}
```

## Checklist test manuali
1. Login:
- Accedi come `ADMIN`, `MANAGER`, `STAFF`.
- Verifica redirect non autenticato su `/login`.

2. Permessi:
- `STAFF`: niente modifica celle, niente pannello admin attivo, stampa consentita.
- `MANAGER`: modifica, template/rules, publish; restore disabilitato.
- `ADMIN`: tutti i permessi incluso restore versione.

3. Draft/Publish/Versioning:
- Modifica almeno 3 celle e verifica autosave.
- Pubblica mese: deve creare snapshot in `/api/schedule/versions`.
- Ripristina snapshot (ADMIN): griglia torna allo stato snapshot.

4. Audit log:
- Modifica turni diversi e verifica entry con `employeeId`, `dateISO`, `oldShift`, `newShift`, `userId`, `timestamp`.
- Filtra per dipendente da drawer cronologia.

5. Conflitti ottimistici:
- Apri stesso mese in due browser/sessioni.
- Salva nella prima, poi nella seconda: atteso errore conflitto (409) + richiesta reload.

6. Undo/Redo:
- Esegui >5 modifiche; verifica undo/redo bottoni.
- Verifica shortcut `Ctrl/Cmd+Z` e `Ctrl/Cmd+Shift+Z`.
- Verifica limite 30 azioni.

7. Import/Export:
- Export CSV e controllo colonne `employee,date,shift`.
- Import CSV con mapping colonne e applicazione corretta.
- Export JSON con monthKey/version/assignments.

8. Validazioni:
- Template con nome vuoto -> errore.
- Template `startTime == endTime` -> errore.
- Template formato orario invalido -> errore.
- Overnight custom (es 22:00-04:00) -> ore corrette (6.0h).

9. Suggerimenti:
- Genera suggerimenti con regole vietato/non disponibile.
- Applica con toggle OFF: non sovrascrive celle manuali.
- Applica con toggle ON: sovrascrive.

10. UI/UX:
- Sticky header giorni e prima colonna dipendenti in scroll.
- Focus ring tastiera visibile su input/select/button.
- Stato loading skeleton e empty state funzionanti.

11. Stampa A4 landscape / PDF:
- `window.print()` in landscape A4.
- Titolo: `TABELLA TURNISTICA (DATA ESTESA)` in maiuscolo italiano.
- Legenda colori sotto titolo.
- In stampa compaiono etichette brevi: `M,P,F,R,FE,MA` + iniziali custom.
- Controlli admin/toolbar nascosti in stampa.
- Celle con warning mostrano asterisco e legenda minima.
