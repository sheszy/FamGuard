import { supabase } from '../supabaseClient.js';

const env = import.meta.env || {};
const pendingRegistrations = new Map();

export function base64UrlToUint8Array(value) {
  if (!value || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
    throw new Error('VITE_VAPID_PUBLIC_KEY must be a valid base64url VAPID key.');
  }
  const unpadded = value.replace(/=+$/, '');
  const padding = '='.repeat((4 - unpadded.length % 4) % 4);
  const base64 = `${unpadded}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function registerPushSubscription(userId) {
  if (pendingRegistrations.has(userId)) return pendingRegistrations.get(userId);
  const task = registerPushSubscriptionForUser(userId);
  pendingRegistrations.set(userId, task);
  void task.then(
    () => pendingRegistrations.delete(userId),
    () => pendingRegistrations.delete(userId)
  );
  return task;
}

async function registerPushSubscriptionForUser(userId) {
  if (!userId) throw new Error('Sign in before enabling family push notifications.');
  if (!supabase) throw new Error('Push notifications require FamGuard Supabase configuration.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('This browser does not support background push notifications.');
  }
  if (!('Notification' in window)) {
    throw new Error('This browser does not support notifications.');
  }
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  }

  const vapidPublicKey = env.VITE_VAPID_PUBLIC_KEY?.trim();
  if (!vapidPublicKey) throw new Error('Set VITE_VAPID_PUBLIC_KEY to enable background push notifications.');

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(`Could not verify the signed-in user: ${authError.message}`);
  if (authData.user?.id !== userId) throw new Error('The active account changed. Sign in again before enabling notifications.');

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(vapidPublicKey)
    });
  }

  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) {
    throw new Error('The browser returned an incomplete push subscription. Try enabling notifications again.');
  }
  const { data: currentAuth, error: currentAuthError } = await supabase.auth.getUser();
  if (currentAuthError || currentAuth.user?.id !== userId) {
    try {
      await subscription.unsubscribe();
    } catch (error) {
      throw new Error(`The active account changed while push was being enabled, and its browser subscription could not be removed: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw new Error('The active account changed while push was being enabled. Sign in again and retry.');
  }

  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    updated_at: new Date().toISOString()
  }, { onConflict: 'endpoint' });
  if (error) throw new Error(`Push subscription could not be saved: ${error.message}`);

  return subscription;
}

export async function unregisterPushSubscription(userId) {
  if (!userId || !supabase || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  let removalError = '';
  try {
    const { error } = await supabase.from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', subscription.endpoint);
    if (error) removalError = error.message;
  } catch (error) {
    removalError = error instanceof Error ? error.message : String(error);
  }
  let unsubscribed = false;
  let unsubscribeError = '';
  try {
    unsubscribed = await subscription.unsubscribe();
  } catch (error) {
    unsubscribeError = error instanceof Error ? error.message : String(error);
  }
  if (removalError || unsubscribeError) {
    const details = [removalError, unsubscribeError].filter(Boolean).join(' ');
    throw new Error(`Push subscription cleanup was incomplete: ${details}`);
  }
  if (!unsubscribed) throw new Error('The browser did not remove the push subscription.');
}
