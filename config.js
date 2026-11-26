// Supabase-Zugang für den Sync. Der Publishable Key ist öffentlich gedacht; geschützt wird über Row Level Security.
// Leer = Sync aus, die App läuft dann nur lokal.
window.SYNC_CONFIG = { url: 'https://hghopytzszuooqusiihm.supabase.co', anonKey: 'sb_publishable_mwMLYSiFn1-TOpT0kuQm7w_trBDEbzr',
  // öffentlicher Teil des Push-Schlüssels; der private liegt nur auf dem Mac (~/.config/ueberfuehrung/vapid.json)
  pushKey: 'BBIq4VrQUUGCwXWB97Is0GuoU6fQXYo2WGf94JP0N7_e0JvCeI2y97sFS2AZTYb_AhhHYeF2g-v8jZ2YdcCWgkY' };
