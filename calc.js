// Rechenlogik der Überführungs-App. Reine Funktionen, im Browser als window.Calc, in Node per require().
// Nachgebaut aus Routenplaner.numbers und Buchhaltung_Ueberfuehrung_2026-27.numbers (Formeln vom 26.11.2026).
(function (root) {
  'use strict';

  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : (x === '' || x == null ? 0 : (isFinite(+x) ? +x : 0)));

  // "14:45" -> 14.75 ; leer -> null
  function parseTime(t) {
    if (t == null || t === '') return null;
    const m = String(t).trim().match(/^(\d{1,2})[:.](\d{2})$/);
    return m ? +m[1] + +m[2] / 60 : null;
  }
  // 16.25 -> "16:15" ; über Mitternacht -> "00:30 (+1)"
  function fmtTime(h) {
    if (h == null || !isFinite(h)) return '';
    let mins = Math.round(h * 60);
    const plus = Math.floor(mins / 1440);
    mins -= plus * 1440;
    const s = String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
    return plus > 0 ? s + ' (+' + plus + ')' : s;
  }

  // Provision inkl. MwSt als Anteil vom Listenpreis (15 % × 1,19 = 17,85 %)
  const abzugQuote = (s) => s.provision * (1 + s.mwst);
  const provision = (preis, s) => r2(num(preis) * abzugQuote(s));
  // ERGO Basis: Deckel gilt vor MwSt (wie in Numbers)
  const versicherung = (km, s) => r2(Math.min(s.versGrund + num(km) * s.versKm, s.versMax) * (1 + s.mwst));
  const netto = (o, s) => r2(num(o.preis) - provision(o.preis, s) - versicherung(o.km, s) - num(o.extra));

  // Endort-Muster: Zahl = PLZ-Anfang, Text = irgendwo im Zielort
  function endortOk(nach, endorte) {
    const z = String(nach || '').toLowerCase();
    return (endorte || []).some((e) => {
      const p = String(e).trim().toLowerCase();
      if (!p) return false;
      return /^\d+$/.test(p) ? z.startsWith(p) : z.includes(p);
    });
  }

  const zaehlt = (o) => o.status !== 'abgesagt' && o.km !== '' && o.km != null;

  // Plant einen Tourtag: Zeiten, Kette, Prüfungen, Tageswerte.
  function planDay(day, orders, s) {
    // Reihenfolge der Kette über `seq` (übersteht den Sync), sonst Listenposition
    const list = orders.map((o, i) => [o, o.seq ?? i]).filter(([o]) => o.date === day.date && zaehlt(o)).sort((a, b) => a[1] - b[1]).map(([o]) => o);
    const zug = parseTime(day.zug) ?? 7.5; // Numbers-Default 7:30
    const rows = [];
    list.forEach((o, i) => {
      const first = i === 0, last = i === list.length - 1;
      const prev = rows[i - 1];
      const weg = num(o.weg);
      const ab = parseTime(o.ab) ?? 0;
      // Kette: frühestens nach Ankunft des Vorgängers + Puffer + Weg (Numbers rechnete hier ab Zug-Ankunft)
      const bereit = first ? zug + weg / 60 : prev.ankunft + s.pufferH + weg / 60;
      const abfahrt = Math.max(bereit, ab);
      const fahrt = num(o.km) / s.tempo;
      const ankunft = abfahrt + fahrt + s.uebergabeH;
      const std = fahrt + s.uebergabeH + (weg + (first ? num(o.anreise) : 0) + (last ? num(o.heim) : 0)) / 60;
      const n = netto(o, s);
      const bis = parseTime(o.bis);
      let anschluss;
      if (first) anschluss = day.start && String(o.von || '').toLowerCase().includes(String(day.start).toLowerCase()) ? 'start' : 'nichtStart';
      else if (String(o.von).trim() === String(prev.order.nach).trim()) anschluss = 'passt';
      else anschluss = o.weg === '' || o.weg == null ? 'luecke' : 'weg';
      rows.push({
        order: o, first, last, abfahrt, ankunft, std, netto: n,
        eh: std > 0 ? n / std : 0,
        ehOk: std > 0 && n / std >= s.minEh,
        warten: Math.max(0, ab - bereit),
        puenktlich: bis == null || ankunft <= bis,
        anschluss,
      });
    });
    const sum = (f) => r2(rows.reduce((a, r) => a + f(r), 0));
    const t = {
      date: day.date, rows, anzahl: rows.length,
      km: sum((r) => num(r.order.km)), preis: sum((r) => num(r.order.preis)), netto: sum((r) => r.netto),
    };
    if (rows.length) {
      const f = rows[0], l = rows[rows.length - 1];
      t.los = zug - num(f.order.anreise) / 60;
      t.zurueck = l.ankunft + num(l.order.heim) / 60;
      // ehrliche Tageszeit: Haustür bis Haustür, inkl. Wartezeiten
      t.std = t.zurueck - t.los;
      t.eh = t.std > 0 ? t.netto / t.std : 0;
      t.endeOk = endortOk(l.order.nach, s.endorte);
    } else { t.std = 0; t.eh = 0; t.endeOk = null; }
    t.zielQuote = s.tagesziel > 0 ? t.netto / s.tagesziel : 0;
    t.warnungen = [];
    if (rows.length > s.limit) t.warnungen.push('Mehr Aufträge als dein Limit (' + s.limit + ')');
    if (rows.some((r) => !r.puenktlich)) t.warnungen.push('Ein Auftrag kommt zu spät an');
    if (rows.some((r) => r.anschluss === 'luecke')) t.warnungen.push('Weg vom letzten Ziel fehlt');
    if (rows.some((r) => r.anschluss === 'nichtStart')) t.warnungen.push('Erster Abholort liegt nicht in der Startstadt');
    if (rows.length && !t.endeOk) t.warnungen.push('Letztes Ziel liegt außerhalb deiner Endorte');
    if (rows.length && t.eh < s.minEh) t.warnungen.push('Unter ' + s.minEh + ' €/Std.');
    return t;
  }

  // Schnell-Check eines einzelnen Auftrags (ersetzt den alten Tour-Check, rechnet jetzt mit Provision + Versicherung)
  function quickCheck(q, s) {
    const o = { date: 'x', status: 'idee', von: '', nach: q.nach || '', ab: '', weg: num(q.weg), km: num(q.km), preis: num(q.preis), extra: num(q.extra), anreise: num(q.anreise), heim: num(q.heim) };
    const r = planDay({ date: 'x', start: '', zug: '' }, [o], s).rows[0];
    return { netto: r.netto, std: r2(r.std), eh: r.eh, ok: r.ehOk, proKm: o.km > 0 ? o.preis / o.km : 0, provision: provision(o.preis, s), versicherung: versicherung(o.km, s), endeOk: endortOk(o.nach, s.endorte) };
  }

  // ---------- Buchhaltung ----------
  const monthKey = (iso) => String(iso || '').slice(0, 7);
  const yearOf = (iso) => String(iso || '').slice(0, 4);

  // Abzüge, die über die Rechnungs-Nr. an einer Einnahme hängen (Provision, Versicherung)
  const abzuegeVon = (e, ausgaben) => (e.rechnungsNr ? r2(ausgaben.filter((a) => a.ref === e.rechnungsNr).reduce((x, a) => x + num(a.betrag), 0)) : 0);
  const auszahlung = (e, ausgaben) => (e.brutto === '' || e.brutto == null ? null : r2(num(e.brutto) - abzuegeVon(e, ausgaben) - (e.vorfin ? num(e.vorfinGebuehr) : 0)));

  function monthList(from, to) {
    const out = [];
    let [y, m] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) { out.push(y + '-' + String(m).padStart(2, '0')); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }

  function monate(data, s) {
    const { einnahmen, ausgaben } = data;
    return monthList(s.monatVon, s.monatBis).map((mk) => {
      const ein = einnahmen.filter((e) => monthKey(e.datum) === mk);
      const einn = r2(ein.reduce((a, e) => a + num(e.brutto), 0));
      const vorf = ein.reduce((a, e) => a + (e.vorfin ? num(e.vorfinGebuehr) : 0), 0);
      const ausg = r2(ausgaben.filter((a) => monthKey(a.datum) === mk).reduce((a, x) => a + num(x.betrag), 0) + vorf);
      const gewinn = r2(einn - ausg);
      const kv = mk >= s.kvAb ? r2(s.kvSatz * Math.max(s.kvMin, s.minijob + Math.max(gewinn, 0))) : 0;
      const steuer = r2(Math.max(gewinn, 0) * s.steuerQuote);
      const kvGezahlt = num((data.kvGezahlt || {})[mk]);
      return {
        monat: mk, einnahmen: einn, ausgaben: ausg, gewinn,
        touren: ein.filter((e) => e.taetigkeit === 'Überführung').length,
        kv, steuer, nachKvSteuer: r2(gewinn - kv - steuer),
        ziel: gewinn - kv >= s.zielNachKV, kvGezahlt,
        // was die Kasse später nachfordern kann + Steuer
        ruecklage: r2(Math.max(kv - kvGezahlt, 0) + steuer),
      };
    });
  }

  const KATEGORIEN = ['Rückfahrt (Zug/Bus)', 'Deutschlandticket', 'Versicherung', 'Gebühren/Plattform', 'Telefon/Internet', 'Behörde (Gewerbe/Führungszeugnis)', 'Sonstiges'];

  // EÜR nach Zuflussprinzip: Einnahmen zählen im Jahr von „Geld erhalten am“
  function euer(data, year) {
    const y = String(year);
    const { einnahmen, ausgaben } = data;
    const einByT = (t) => r2(einnahmen.filter((e) => yearOf(e.erhaltenAm) === y && e.taetigkeit === t).reduce((a, e) => a + num(e.brutto), 0));
    const ein = { 'Überführung': einByT('Überführung'), 'Shapeit': einByT('Shapeit') };
    const vorf = einnahmen.filter((e) => yearOf(e.datum) === y && e.vorfin).reduce((a, e) => a + num(e.vorfinGebuehr), 0);
    const aus = {};
    KATEGORIEN.forEach((k) => {
      aus[k] = r2(ausgaben.filter((a) => yearOf(a.datum) === y && a.kategorie === k).reduce((x, a) => x + num(a.betrag), 0) + (k === 'Gebühren/Plattform' ? vorf : 0));
    });
    const sumE = r2(ein['Überführung'] + ein['Shapeit']);
    const sumA = r2(Object.values(aus).reduce((a, b) => a + b, 0));
    const offen = r2(einnahmen.filter((e) => yearOf(e.datum) === y && !e.erhaltenAm).reduce((a, e) => a + num(e.brutto), 0));
    return { jahr: y, einnahmen: ein, summeEinnahmen: sumE, ausgaben: aus, summeAusgaben: sumA, gewinn: r2(sumE - sumA), offen };
  }

  const nextId = (prefix, list) => {
    const max = list.reduce((m, x) => Math.max(m, +(String(x.id).match(/(\d+)$/) || [0, 0])[1]), 0);
    return prefix + String(max + 1).padStart(3, '0');
  };

  // Auftrag erledigt -> Einnahme + Belege für Provision und Versicherung (beide unter einer Belegnummer)
  function bucheAuftrag(o, data, s, opts) {
    opts = opts || {};
    // höchste vergebene Nummer + 1, damit gelöschte Rechnungen keine Nummer doppelt vergeben
    const prefix = 'UE-' + yearOf(o.date) + '-';
    const nr = data.einnahmen.concat(data.ausgaben).reduce((m, x) => { const r = String(x.rechnungsNr || x.ref || ''); return r.startsWith(prefix) ? Math.max(m, +r.slice(prefix.length) || 0) : m; }, 0) + 1;
    const rn = opts.rechnungsNr || (prefix + String(nr).padStart(3, '0'));
    const day = (data.days || []).find((d) => d.date === o.date) || { date: o.date, start: '', zug: '' };
    const row = planDay(day, data.orders || [o], s).rows.find((r) => r.order.id === o.id);
    const e = {
      id: nextId('E-', data.einnahmen), datum: o.date, taetigkeit: 'Überführung', auftraggeber: opts.auftraggeber || 'ONLOGIST',
      von: o.von, nach: o.nach, km: num(o.km), stunden: row ? r2(row.std) : '', brutto: num(o.preis),
      vorfin: !!opts.vorfin, vorfinGebuehr: opts.vorfin ? r2(num(o.preis) * s.vorfinQuote) : '',
      rechnungsNr: rn, bezahlt: false, erhaltenAm: '', notiz: 'Auftrag ' + (o.auftragsId || ''), auftragRef: o.id,
    };
    const beleg = nextId('B-', data.ausgaben);
    const tag = 'Auftrag ' + (o.auftragsId || '') + ' / ' + rn;
    const a = [
      { id: beleg, datum: o.date, taetigkeit: 'Überführung', kategorie: 'Gebühren/Plattform', beschreibung: 'ONLOGIST Provision brutto, ' + tag, betrag: provision(o.preis, s), bezahltMit: 'Abzug', ref: rn },
      { id: beleg, datum: o.date, taetigkeit: 'Überführung', kategorie: 'Versicherung', beschreibung: 'Partner-Versicherung brutto, ' + tag, betrag: versicherung(o.km, s), bezahltMit: 'Abzug', ref: rn },
    ];
    if (num(o.extra) > 0) a.push({ id: beleg, datum: o.date, taetigkeit: 'Überführung', kategorie: 'Sonstiges', beschreibung: 'Extra-Kosten, ' + tag, betrag: num(o.extra), bezahltMit: '', ref: '' }); // zahlst du selbst, wird nicht von der Auszahlung abgezogen
    return { einnahme: e, ausgaben: a };
  }

  // Auftrags-Datei vom Auto-Check übernehmen: nur neue Auftrags-IDs, fehlende Tourtage werden angelegt.
  // Gibt neue Listen zurück, verändert `data` nicht.
  function mergeInbox(data, inbox, makeKey) {
    if (!inbox || !Array.isArray(inbox.auftraege)) throw new Error('keine Auftrags-Datei (Feld „auftraege“ fehlt)');
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const known = new Set(data.orders.map((o) => String(o.auftragsId)));
    const days = data.days.slice(), orders = data.orders.slice();
    const neu = [], doppelt = [], fehler = [];
    inbox.auftraege.forEach((a, i) => {
      const id = String(a.auftragsId || '').trim();
      if (!id || !iso.test(String(a.date)) || !isFinite(+a.km) || !isFinite(+a.preis)) { fehler.push(i + 1); return; }
      if (known.has(id)) { doppelt.push(id); return; }
      known.add(id);
      const seq = orders.filter((x) => x.date === a.date).reduce((m, x) => Math.max(m, x.seq ?? -1), -1) + 1;
      if (!days.some((d) => d.date === a.date)) days.push({ _k: makeKey(), date: a.date, start: a.startstadt || '', zug: a.zug || '07:30' });
      const o = {
        _k: makeKey(), id: 'o' + makeKey(), date: a.date, seq, status: 'idee', auftragsId: id, von: String(a.von || ''), nach: String(a.nach || ''),
        ab: a.ab || '', bis: a.bis || '', weg: a.weg === '' || a.weg == null ? '' : num(a.weg), km: num(a.km), preis: num(a.preis), extra: 0,
        anreise: num(a.anreise), heim: num(a.heim), notiz: String(a.notiz || ''), quelle: 'auto-check',
      };
      orders.push(o);
      neu.push(o);
    });
    return { days, orders, neu, doppelt, fehler };
  }

  // ---------- Sync ----------
  // Jedes Element trägt `_k` (Schlüssel) und `_t` (letzte Änderung, ms). Gelöschtes steht in `_tomb[_k] = Zeit`.
  // Einstellungen und kvGezahlt tragen ihre Zeit in `_st`. Neuere Änderung gewinnt; Löschen gewinnt, wenn es nicht älter ist.
  // ---------- Ketten-Suche (Auto-Check) ----------
  const ortName = (s) => { const m = String(s || '').match(/^\s*(\d{5})?\s*([^(,]+)/); return m ? m[2].trim().toLowerCase() : ''; };
  const plz2 = (s) => (String(s || '').match(/^\s*(\d{2})\d{3}/) || [])[1];

  // Minuten vom Ziel `a` zum Abholort `b`; null = nicht sinnvoll verbindbar
  function wegZwischen(nach, von, wege) {
    const x = ortName(nach), y = ortName(von);
    const w = wege && (wege[x + '|' + y] ?? wege[y + '|' + x]);
    if (w != null) return num(w);
    if (x && x === y) return 15;
    // shortcut: gleiche PLZ-Region (erste 2 Ziffern) = ca. 45 Min. Nahverkehr; genauer über opts.wege
    if (plz2(nach) && plz2(nach) === plz2(von)) return 45;
    return null;
  }

  // Probiert jede Kette aus bis zu `maxTouren` Aufträgen desselben Tages durch. Eine Kette zählt nur, wenn
  // alle pünktlich sind, die Wartezeit je Auftrag ≤ maxWartenH ist, sie ≥ Mindest-€/Std. bringt (Haustür bis Haustür)
  // und das letzte Ziel wieder am Startort oder in einem erlaubten Endort liegt.
  // Kandidat: { auftragsId, date, von, nach, ab, bis, km, preis, anreise, heim, weg? }  (anreise/heim in Min. ab/bis Wohnort)
  function findChains(cands, s, opts) {
    opts = Object.assign({ maxTouren: 3, maxWartenH: 2, maxAnreise: 150, wege: {} }, opts || {});
    const byDate = {};
    cands.forEach((c) => { if (c && c.date && c.km > 0 && c.preis > 0) (byDate[c.date] = byDate[c.date] || []).push(c); });
    const out = {};
    Object.entries(byDate).forEach(([date, list]) => {
      const found = [];
      const bewerte = (kette) => {
        const first = kette[0], last = kette[kette.length - 1];
        const weg0 = first.weg ?? 15, ab0 = parseTime(first.ab) ?? 8;
        const orders = kette.map((c, i) => ({
          id: 'c' + i, date, seq: i, status: 'idee', von: c.von, nach: c.nach, ab: c.ab || '', bis: c.bis || '',
          km: num(c.km), preis: num(c.preis), extra: 0,
          weg: i === 0 ? weg0 : wegZwischen(kette[i - 1].nach, c.von, opts.wege),
          anreise: i === 0 ? num(c.anreise) : 0, heim: i === kette.length - 1 ? num(c.heim) : 0,
        }));
        const t = planDay({ date, start: ortName(first.von), zug: fmtTime(Math.max(0, ab0 - weg0 / 60)) }, orders, Object.assign({}, s, { limit: 99 }));
        const endeOk = ortName(last.nach) === ortName(first.von) || endortOk(last.nach, s.endorte);
        if (!endeOk || t.rows.some((r) => !r.puenktlich || r.warten > opts.maxWartenH) || t.eh < s.minEh) return;
        found.push({ auftragsIds: kette.map((c) => String(c.auftragsId)), touren: kette.length, netto: t.netto, std: r2(t.std), euroProStunde: r2(t.eh),
          los: fmtTime(t.los), zurueck: fmtTime(t.zurueck), strecke: kette.map((c) => ortName(c.von)).concat(ortName(last.nach)).join(' → ') });
      };
      const weiter = (kette) => {
        bewerte(kette);
        if (kette.length >= opts.maxTouren) return;
        const last = kette[kette.length - 1];
        list.forEach((c) => { if (!kette.includes(c) && wegZwischen(last.nach, c.von, opts.wege) != null) weiter(kette.concat([c])); });
      };
      list.forEach((c) => { if (num(c.anreise) <= opts.maxAnreise) weiter([c]); });
      found.sort((a, b) => b.euroProStunde - a.euroProStunde || b.netto - a.netto);
      if (found.length) out[date] = { beste: found[0], alternativen: found.slice(1, 4) };
    });
    return out;
  }

  const COLLS = ['days', 'orders', 'einnahmen', 'ausgaben', 'checkliste', 'geraete'];
  const SINGLES = ['settings', 'kvGezahlt'];

  // Stempelt Änderungen gegenüber dem zuletzt gespeicherten Stand (`prev`). Verändert `doc`.
  function stampChanges(doc, prev, now) {
    doc._tomb = doc._tomb || {};
    doc._st = doc._st || {};
    const strip = (x) => { const { _t, ...r } = x; return JSON.stringify(r); };
    COLLS.forEach((c) => {
      const old = new Map(((prev && prev[c]) || []).map((x) => [x._k, strip(x)]));
      const seen = new Set();
      (doc[c] || []).forEach((x) => {
        seen.add(x._k);
        if (old.get(x._k) !== strip(x) || !x._t) x._t = now;
      });
      old.forEach((_, k) => { if (!seen.has(k)) doc._tomb[k] = now; });
    });
    SINGLES.forEach((k) => {
      if (!prev || JSON.stringify(prev[k]) !== JSON.stringify(doc[k]) || !doc._st[k]) doc._st[k] = now;
    });
    return doc;
  }

  // Führt zwei Stände zusammen (lokal + Server). Gibt einen neuen Stand und Warnungen zurück.
  function mergeDocs(a, b) {
    a = a || {}; b = b || {};
    const tomb = Object.assign({}, a._tomb || {});
    Object.entries(b._tomb || {}).forEach(([k, t]) => { tomb[k] = Math.max(tomb[k] || 0, t); });
    const out = { version: a.version || b.version || 1, meta: Object.assign({}, b.meta || {}, a.meta || {}), _tomb: tomb, _st: {} };
    const newer = (x, y) => ((x._t || 0) !== (y._t || 0) ? ((x._t || 0) > (y._t || 0) ? x : y) : (JSON.stringify(x) >= JSON.stringify(y) ? x : y));
    COLLS.forEach((c) => {
      const map = new Map();
      [...(a[c] || []), ...(b[c] || [])].forEach((x) => { const cur = map.get(x._k); map.set(x._k, cur ? newer(cur, x) : x); });
      out[c] = [...map.values()].filter((x) => !(tomb[x._k] >= (x._t || 0)));
    });
    SINGLES.forEach((k) => {
      const ta = (a._st || {})[k] || 0, tb = (b._st || {})[k] || 0;
      const pick = ta >= tb ? (a[k] !== undefined ? a : b) : (b[k] !== undefined ? b : a);
      out[k] = pick[k];
      out._st[k] = Math.max(ta, tb);
    });
    // doppelt vergebene Nummern (zwei Geräte offline) melden, nicht still überschreiben
    const warnungen = [];
    const dup = (list, f) => { const seen = {}; list.forEach((x) => { const v = f(x); if (v) seen[v] = (seen[v] || 0) + 1; }); return Object.keys(seen).filter((v) => seen[v] > 1); };
    dup(out.einnahmen, (e) => e.id).forEach((v) => warnungen.push('Einnahme-Nr. ' + v + ' ist doppelt vergeben'));
    dup(out.einnahmen, (e) => e.rechnungsNr).forEach((v) => warnungen.push('Rechnungs-Nr. ' + v + ' ist doppelt vergeben'));
    return { doc: out, warnungen };
  }

  // Vergleichbare Form eines Stands (Reihenfolge egal), um unnötige Server-Schreibvorgänge zu sparen
  function canonical(doc) {
    const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {}) : v);
    const d = Object.assign({}, doc);
    COLLS.forEach((c) => { d[c] = (d[c] || []).slice().sort((x, y) => String(x._k).localeCompare(String(y._k))); });
    delete d.meta;
    return JSON.stringify(sortKeys(d));
  }

  const api = { canonical, stampChanges, mergeDocs, r2, num, parseTime, fmtTime, abzugQuote, provision, versicherung, netto, endortOk, planDay, quickCheck, auszahlung, abzuegeVon, monthList, monate, euer, KATEGORIEN, nextId, bucheAuftrag, mergeInbox, findChains };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
