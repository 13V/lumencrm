import 'server-only';
import webpush from 'web-push';
import { type JobContext, allRows } from './shared';

export function pushReady(): boolean { return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.APP_URL); }
export function trustedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    return ['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(url.hostname)
      || url.hostname.endsWith('.push.services.mozilla.com') || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com');
  } catch { return false; }
}
export interface PushSubscriptionRecord { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }
export async function ownerSubscriptions(context: JobContext): Promise<PushSubscriptionRecord[]> {
  const owners = await context.db.from('profiles').select('user_id').eq('role', 'owner').is('deleted_at', null);
  if (owners.error) throw new Error('owner_lookup_failed');
  const ids = (owners.data ?? []).map((owner) => owner.user_id);
  if (!ids.length) return [];
  return allRows<PushSubscriptionRecord>((from, to) => context.db.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', ids).is('deleted_at', null).range(from, to));
}
export async function deliverPush(subscription: PushSubscriptionRecord, body: { title: string; body: string; url: string; tag: string }): Promise<'sent' | 'gone'> {
  if (!trustedPushEndpoint(subscription.endpoint)) return 'gone';
  if (!pushReady()) throw new Error('push_not_configured');
  webpush.setVapidDetails(process.env.APP_URL!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  try {
    await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(body), { TTL: 3600, urgency: 'normal', timeout: 8000 });
    return 'sent';
  } catch (error) {
    const code = (error as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return 'gone';
    throw new Error(`push_http_${Number(code) || 0}`);
  }
}
