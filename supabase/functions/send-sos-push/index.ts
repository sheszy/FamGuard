import { createClient } from 'npm:@supabase/supabase-js@2';
import webPush from 'npm:web-push@3.6.7';

type PushSubscriptionRow = {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type WebPushError = Error & { statusCode?: number };
type FamilyAlertInsertWebhook = {
  type: 'INSERT';
  table: 'family_alerts';
  record: { id?: unknown };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function isSupportedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (!url.port || url.port === '443')
      && (
        host === 'fcm.googleapis.com'
        || host === 'android.googleapis.com'
        || host === 'fcmregistrations.googleapis.com'
        || host === 'web.push.apple.com'
        || host === 'push.apple.com'
        || host === 'push.services.mozilla.com'
        || host.endsWith('.push.services.mozilla.com')
        || host === 'updates.push.services.mozilla.com'
        || host === 'notify.windows.com'
        || host.endsWith('.notify.windows.com')
      );
  } catch {
    return false;
  }
}

function isFamilyAlertInsertWebhook(body: unknown): body is FamilyAlertInsertWebhook {
  if (!body || typeof body !== 'object') return false;
  const payload = body as Record<string, unknown>;
  return payload.type === 'INSERT'
    && payload.table === 'family_alerts'
    && !!payload.record
    && typeof payload.record === 'object';
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  try {
    const authorization = request.headers.get('authorization');
    const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
    const isWebhookSecretValid = !!webhookSecret
      && request.headers.get('x-webhook-secret') === webhookSecret;

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Supabase service environment is not configured.');
      return jsonResponse({ error: 'Push delivery is not configured on the server.' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const isServiceRoleToken = accessToken === serviceRoleKey;
    let userId: string | null = null;
    let authenticatedSenderName: string | null = null;
    if (accessToken && !isServiceRoleToken) {
      const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
      if (!authError && authData.user) {
        userId = authData.user.id;
        const metadataName = authData.user.user_metadata?.full_name;
        authenticatedSenderName = typeof metadataName === 'string'
          ? metadataName
          : authData.user.email || null;
      } else if (!isWebhookSecretValid) {
        return jsonResponse({ error: 'The signed-in session is invalid.' }, 401);
      }
    } else if (!accessToken && !isWebhookSecretValid) {
      return jsonResponse({ error: 'Sign in is required.' }, 401);
    }

    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      if (!userId) return jsonResponse({ error: 'Sign in is required.' }, 401);
      return jsonResponse({ error: 'A valid alertId is required.' }, 400);
    }
    const isWebhookRequest = (isWebhookSecretValid || isServiceRoleToken)
      && isFamilyAlertInsertWebhook(requestBody);
    if (!userId && !isWebhookRequest) {
      return jsonResponse({ error: 'Sign in is required.' }, 401);
    }
    const alertId = isWebhookRequest
      ? requestBody.record.id
      : requestBody && typeof requestBody === 'object'
        ? (requestBody as Record<string, unknown>).alertId
      : null;
    if (typeof alertId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(alertId)) {
      return jsonResponse({ error: 'A valid alertId is required.' }, 400);
    }

    const { data: alert, error: alertError } = await supabase.from('family_alerts')
      .select('id,user_id,target_user_id,kind,situation_reason,message,latitude,longitude,status')
      .eq('id', alertId)
      .maybeSingle();
    if (alertError) {
      console.error('Could not read the SOS alert:', alertError.message);
      return jsonResponse({ error: 'The SOS alert could not be verified.' }, 500);
    }
    if (!alert || (userId && alert.user_id !== userId) || alert.kind !== 'sos' || alert.status !== 'active') {
      return jsonResponse({ error: 'An active SOS alert owned by this account was not found.' }, 404);
    }
    if (!Number.isFinite(Number(alert.latitude)) || !Number.isFinite(Number(alert.longitude))) {
      return jsonResponse({ error: 'The SOS alert has no valid GPS coordinates.' }, 400);
    }

    const { data: connections, error: connectionError } = await supabase.from('family_connections')
      .select('member_a,member_b')
      .or(`member_a.eq.${alert.user_id},member_b.eq.${alert.user_id}`);
    if (connectionError) {
      console.error('Could not read SOS recipients:', connectionError.message);
      return jsonResponse({ error: 'Family recipients could not be loaded.' }, 500);
    }

    const connectedUserIds = new Set((connections || []).map(connection =>
      connection.member_a === alert.user_id ? connection.member_b : connection.member_a
    ));
    let recipientIds = [...connectedUserIds];
    if (alert.target_user_id) {
      if (!connectedUserIds.has(alert.target_user_id)) {
        return jsonResponse({ error: 'The SOS recipient is not an accepted family connection.' }, 403);
      }
      recipientIds = [alert.target_user_id];
    }
    if (!recipientIds.length) return jsonResponse({ sent: 0, failed: 0, staleRemoved: 0 });

    const { data: subscriptions, error: subscriptionError } = await supabase.from('push_subscriptions')
      .select('user_id,endpoint,p256dh,auth')
      .in('user_id', recipientIds);
    if (subscriptionError) {
      console.error('Could not load push subscriptions:', subscriptionError.message);
      return jsonResponse({ error: 'Family push subscriptions could not be loaded.' }, 500);
    }
    if (!subscriptions?.length) return jsonResponse({ sent: 0, failed: 0, staleRemoved: 0 });

    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubjectValue = Deno.env.get('VAPID_SUBJECT')?.trim();
    const vapidSubject = vapidSubjectValue
      ? (/^(?:mailto:|https?:\/\/)/i.test(vapidSubjectValue)
        ? vapidSubjectValue
        : `mailto:${vapidSubjectValue}`)
      : null;
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      console.error('VAPID server secrets are not configured.');
      return jsonResponse({ error: 'Push delivery is not configured on the server.' }, 500);
    }
    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    let senderName = authenticatedSenderName || 'A family member';
    const { data: profile, error: profileError } = await supabase.from('user_profiles')
      .select('display_name')
      .eq('user_id', alert.user_id)
      .maybeSingle();
    if (profileError) console.error('Could not load SOS sender profile:', profileError.message);
    if (profile?.display_name) senderName = profile.display_name;

    const situation = alert.situation_reason || alert.message || 'A family member needs help.';
    const payload = JSON.stringify({
      title: `Family SOS · ${senderName}`,
      body: `${situation} · GPS ${Number(alert.latitude).toFixed(5)}, ${Number(alert.longitude).toFixed(5)}`,
      alertId: alert.id,
      senderName,
      latitude: alert.latitude,
      longitude: alert.longitude,
      url: '/#locations'
    });

    const outcomes = await Promise.all(subscriptions.map(async (subscription: PushSubscriptionRow) => {
      if (!isSupportedPushEndpoint(subscription.endpoint)) {
        console.error('Push subscription endpoint is not a supported provider URL.');
        return 'failed';
      }
      try {
        await webPush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth }
        }, payload, {
          TTL: 300,
          urgency: 'high'
        });
        return 'sent';
      } catch (error) {
        const statusCode = (error as WebPushError).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await supabase.from('push_subscriptions')
            .delete()
            .eq('user_id', subscription.user_id)
            .eq('endpoint', subscription.endpoint);
          if (deleteError) {
            console.error('Could not remove a stale push subscription:', deleteError.message);
            return 'failed';
          }
          return 'stale';
        }
        console.error('Push delivery failed with status:', statusCode ?? 'unknown');
        return 'failed';
      }
    }));

    return jsonResponse({
      sent: outcomes.filter(outcome => outcome === 'sent').length,
      failed: outcomes.filter(outcome => outcome === 'failed').length,
      staleRemoved: outcomes.filter(outcome => outcome === 'stale').length
    });
  } catch (error) {
    console.error('SOS push function failed:', error instanceof Error ? error.message : String(error));
    return jsonResponse({ error: 'SOS push delivery failed.' }, 500);
  }
});
