// Startwerte der App (nur Einstellungen). Wird beim allerersten Öffnen geladen.
// Echte Daten: per „Importieren“ (Sicherung) oder Sync. Test-Daten liegen in test/fixture.js (nicht veröffentlicht).
(function (root) {
  'use strict';
  const SEED = {
    version: 1,
    settings: {
      // Routenplaner
      tagesziel: 100, provision: 0.15, mwst: 0.19, versGrund: 2.99, versKm: 0.031, versMax: 24,
      tempo: 80, uebergabeH: 0.5, pufferH: 0.25, minEh: 15, limit: 2,
      endorte: ['Regensburg', 'München', 'Ingolstadt', '80', '81', '82', '85', 'Altdorf'],
      // Buchhaltung
      kvSatz: 0.205, kvMin: 1318.33, minijob: 602.82, steuerQuote: 0.05, zielNachKV: 1500,
      vorfinQuote: 0.049, kvAb: '2026-12', monatVon: '2026-11', monatBis: '2027-08',
    },
    // Keine Buchungsdaten im öffentlichen Code: die kommen per Import oder Sync.
    days: [], orders: [], einnahmen: [], ausgaben: [], kvGezahlt: {}, checkliste: [], geraete: [],
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = SEED; else root.SEED = SEED;
})(typeof window !== 'undefined' ? window : globalThis);
