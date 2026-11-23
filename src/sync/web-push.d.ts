// web-push 4 ships no types; declare only what the sync job uses.
declare module 'web-push' {
  type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(sub: Sub, payload: string,
    options?: { TTL?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; timeout?: number }): Promise<{ statusCode: number }>;
}
