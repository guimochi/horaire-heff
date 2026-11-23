export type Course = { date: string /*YYYY-MM-DD*/; start: string /*HH:MM*/; end: string; subject: string;
  teacher: string; room: string; group: string; cancelled: boolean; extra: string[] };
export type Snapshot = { promo: string; fetchedAt: string /*ISO*/; weeks: string[] /*lundis YYYY-MM-DD*/; courses: Course[] };
export type ChangeKind = 'annule' | 'ajoute' | 'horaire' | 'local' | 'enseignant' | 'deplace' | 'autre';
export type Change = { id: string; kind: ChangeKind; promo: string; detectedAt: string; before: Course | null; after: Course | null };
export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
