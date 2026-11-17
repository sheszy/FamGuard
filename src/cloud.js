import { createClient } from '@supabase/supabase-js';

const env = import.meta.env;
const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim();
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const cloudStatus = document.getElementById('cloud-status');
const accountButton = document.getElementById('account-button');
const signOutButton = document.getElementById('sign-out-button');
const taskIds = new Set();
const calendarEventIds = new Set();
let user = null;
let taskQueue = Promise.resolve();
let calendarQueue = Promise.resolve();
let alertChannel;

function setStatus(message) {
  cloudStatus.textContent = message;
}

function renderAccount() {
  if (!supabase) {
    setStatus('Demo mode. Add your Supabase project URL and public key to .env.local.');
    accountButton.textContent = 'Connect Supabase';
    signOutButton.hidden = true;
    return;
  }

  if (user) {
    setStatus(`Connected as ${user.email}`);
    accountButton.textContent = 'Switch account';
    signOutButton.hidden = false;
    return;
  }

  setStatus('Supabase is configured. Sign in or create an account to sync your data.');
  accountButton.textContent = 'Sign in or create account';
  signOutButton.hidden = true;
}

function openAccountDialog() {
  if (!supabase) {
    window.modal({
      title: 'Connect Supabase',
      description: 'Add your project URL and publishable key locally, then add the same values to Vercel.',
      content: '<p class="eyebrow">Copy .env.example to .env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. Never add a service-role or secret key to this app.</p>',
      confirm: 'Got it'
    });
    return;
  }

  let creatingAccount = false;
  window.modal({
    title: 'Sign in to FamGuard',
    description: 'Continue with Google or use an email and password.',
    content: '<button class="btn-secondary" id="google-sign-in" type="button">Continue with Google</button><label class="eyebrow">Email<input class="input" id="auth-email" type="email" autocomplete="email" required></label><label class="eyebrow">Password<input class="input" id="auth-password" type="password" autocomplete="current-password" minlength="8" required></label><button class="text-link" id="auth-mode-toggle" type="button">Create an account instead</button>',
    confirm: 'Sign in',
    onConfirm: async (box, close) => {
      const email = box.querySelector('#auth-email').value.trim();
      const password = box.querySelector('#auth-password').value;
      if (!email || password.length < 8) {
        window.toast('Enter a valid email and a password with at least 8 characters.');
        return;
      }

      const result = creatingAccount
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        window.toast(result.error.message);
        return;
      }

      close();
      if (creatingAccount && !result.data.session) {
        window.toast('Check your email to confirm your new account.');
      } else {
        window.toast(creatingAccount ? 'Account created.' : 'Signed in.');
      }
    }
  });

  document.getElementById('google-sign-in').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (error) {
        button.disabled = false;
        window.toast(`Google sign-in failed: ${error.message}`);
      }
    } catch (error) {
      button.disabled = false;
      window.toast(`Google sign-in failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  document.getElementById('auth-mode-toggle').addEventListener('click', event => {
    creatingAccount = !creatingAccount;
    const box = event.currentTarget.closest('.modal');
    box.querySelector('h2').textContent = creatingAccount ? 'Create your account' : 'Sign in to FamGuard';
    box.querySelector('#auth-mode-toggle').textContent = creatingAccount ? 'Already have an account? Sign in' : 'Create an account instead';
    box.querySelector('.confirm').textContent = creatingAccount ? 'Create account' : 'Sign in';
  });
}

function syncTasks() {
  if (!user || window.famguardHydrating) return;

  const rows = window.famguardTasks.map(task => ({
    id: task.id,
    user_id: user.id,
    title: task.text,
    is_complete: task.done,
    scheduled_for: task.scheduledFor || null
  }));
  const currentIds = new Set(rows.map(row => row.id));

  taskQueue = taskQueue.then(async () => {
    if (rows.length) {
      const { error } = await supabase.from('tasks').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    const removedIds = [...taskIds].filter(id => !currentIds.has(id));
    if (removedIds.length) {
      const { error } = await supabase.from('tasks').delete().in('id', removedIds).eq('user_id', user.id);
      if (error) throw error;
    }

    taskIds.clear();
    currentIds.forEach(id => taskIds.add(id));
  }).catch(error => window.toast(`Task sync failed: ${error.message}`));
}

async function loadTasks() {
  const { data, error } = await supabase.from('tasks').select('id,title,is_complete,scheduled_for').order('created_at');
  if (error) {
    setStatus(`Signed in, but database setup needs attention: ${error.message}`);
    return;
  }

  window.famguardHydrating = true;
  window.famguardTasks.splice(0, window.famguardTasks.length, ...data.map(row => ({
    id: row.id,
    text: row.title,
    done: row.is_complete,
    scheduledFor: row.scheduled_for
  })));
  taskIds.clear();
  data.forEach(row => taskIds.add(row.id));
  window.famguardRenderTasks();
  window.famguardHydrating = false;
}

function syncCalendarEvents() {
  if (!user || window.famguardHydrating) return;

  const activeUser = user;
  const rows = window.famguardCalendarEvents.map(event => ({
    id: event.id,
    user_id: activeUser.id,
    title: event.title,
    event_date: event.date,
    event_type: event.type,
    is_recurring: event.recurring,
    person_name: event.personName || null,
    event_time: event.time || null
  }));
  const currentIds = new Set(rows.map(row => row.id));

  calendarQueue = calendarQueue.then(async () => {
    if (user?.id !== activeUser.id) return;
    if (rows.length) {
      const { error } = await supabase.from('family_events').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    const removedIds = [...calendarEventIds].filter(id => !currentIds.has(id));
    if (removedIds.length) {
      const { error } = await supabase.from('family_events').delete().in('id', removedIds).eq('user_id', activeUser.id);
      if (error) throw error;
    }

    calendarEventIds.clear();
    currentIds.forEach(id => calendarEventIds.add(id));
  }).catch(error => {
    setStatus(`Calendar sync failed: ${error.message}`);
    window.toast(`Calendar sync failed: ${error.message}`);
  });
}

async function loadCalendarEvents() {
  const activeUser = user;
  const { data, error } = await supabase
    .from('family_events')
    .select('id,title,event_date,event_type,is_recurring,person_name,event_time')
    .order('event_date');
  if (user?.id !== activeUser?.id) return;
  if (error) {
    setStatus(`Signed in, but calendar setup needs attention: ${error.message}`);
    window.toast(`Calendar could not load: ${error.message}. Run the updated supabase/schema.sql.`);
    return;
  }

  calendarEventIds.clear();
  const merged = new Map();
  data.forEach(row => {
    calendarEventIds.add(row.id);
    merged.set(row.id, {
      id: row.id,
      title: row.title,
      date: row.event_date,
      type: row.event_type,
      recurring: row.is_recurring,
      personName: row.person_name || '',
      time: row.event_time?.slice(0, 5) || ''
    });
  });
  window.famguardCalendarEvents.forEach(event => merged.set(event.id, event));
  window.famguardSetCalendarEvents([...merged.values()]);
}

function renderPosts(rows) {
  const list = document.getElementById('post-list');
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'eyebrow';
    empty.textContent = 'No community posts yet. Start the conversation.';
    list.append(empty);
    return;
  }

  rows.forEach(post => {
    const card = document.createElement('article');
    card.className = 'card post';
    card.innerHTML = '<div class="post-head"><span class="avatar self"></span><span class="post-author"><strong></strong><small></small></span><span class="post-tag"></span></div><p class="post-content"></p>';
    card.querySelector('.avatar').textContent = (post.author_name || 'Family').slice(0, 2).toUpperCase();
    card.querySelector('.post-author strong').textContent = post.author_name || 'FamGuard member';
    card.querySelector('.post-author small').textContent = new Date(post.created_at).toLocaleString();
    card.querySelector('.post-tag').textContent = post.topic;
    card.querySelector('.post-content').textContent = post.content;
    list.append(card);
  });
}

async function loadPosts() {
  const { data, error } = await supabase.from('community_posts').select('id,user_id,author_name,topic,content,created_at').order('created_at', { ascending: false });
  if (error) {
    setStatus(`Signed in, but database setup needs attention: ${error.message}`);
    return;
  }
  renderPosts(data);
}

function subscribeToAlerts() {
  if (alertChannel) supabase.removeChannel(alertChannel);
  alertChannel = supabase.channel(`famguard-alerts-${user.id}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'family_alerts', filter: `user_id=eq.${user.id}`
    }, payload => {
      const alert = payload.new;
      if ('Notification' in window && Notification.permission === 'granted') {
        navigator.serviceWorker?.ready.then(registration => registration.showNotification(alert.title, {
          body: alert.message,
          icon: '/famguard-icon.png'
        }));
      } else {
        window.toast(`${alert.title}: ${alert.message}`);
      }
    }).subscribe();
}

async function loadSession(session) {
  const nextUser = session?.user || null;
  if (user?.id !== nextUser?.id) {
    taskIds.clear();
    calendarEventIds.clear();
  }
  window.famguardSetCalendarOwner(nextUser?.id || null);
  user = nextUser;
  window.famguardUser = user;
  renderAccount();
  if (!user) {
    if (alertChannel) supabase.removeChannel(alertChannel);
    window.famguardHydrating = true;
    let savedTasks = [];
    try { savedTasks = JSON.parse(localStorage.getItem('famguard-tasks')) || []; } catch {}
    window.famguardTasks.splice(0, window.famguardTasks.length, ...savedTasks);
    taskIds.clear();
    window.famguardRenderTasks();
    window.famguardHydrating = false;
    return;
  }

  await loadTasks();
  await loadCalendarEvents();
  await loadPosts();
  subscribeToAlerts();
}

function submitCommunityPost() {
  window.modal({
    title: 'Write a post',
    description: 'Share a question, a life update, or a small win.',
    content: '<label class="eyebrow">Topic<select class="select" id="post-topic"><option>Asks moms</option><option>Little wins</option><option>Family life</option></select></label><label class="eyebrow">Your post<textarea class="textarea" id="post-text" maxlength="500" placeholder="What is on your mind?"></textarea></label>',
    confirm: 'Share post',
    onConfirm: async (box, close) => {
      const content = box.querySelector('#post-text').value.trim();
      if (!content) {
        window.toast('Write a little something before sharing.');
        return;
      }

      const { error } = await supabase.from('community_posts').insert({
        user_id: user.id,
        author_name: user.user_metadata?.full_name || user.email,
        topic: box.querySelector('#post-topic').value,
        content
      });
      if (error) {
        window.toast(`Post could not be saved: ${error.message}`);
        return;
      }

      close();
      await loadPosts();
      window.toast('Your post has been shared with signed-in FamGuard users.');
    }
  });
}

async function sendSos() {
  window.modal({
    title: 'Family SOS',
    description: user ? 'This saves an SOS record to your account. It does not notify family members yet.' : 'This is a demo alert. Sign in to save it to Supabase.',
    danger: true,
    confirm: user ? 'Save SOS alert' : 'Close',
    content: '<div class="sos-person"><span class="avatar self">MF</span><span><strong>Marika Flores needs help</strong><small>Current location · USTP CDO Campus</small></span></div><p class="eyebrow">A push-notification sender and family invitations are still needed for delivery to contacts.</p>',
    onConfirm: async (_, close) => {
      if (!user) {
        close();
        return;
      }
      const { error } = await supabase.from('family_alerts').insert({
        user_id: user.id,
        kind: 'sos',
        title: 'Family SOS',
        message: 'Marika Flores needs help. Current location: USTP CDO Campus.'
      });
      if (error) {
        window.toast(`SOS could not be saved: ${error.message}`);
        return;
      }
      close();
      window.toast('SOS saved. Family delivery is not configured yet.');
    }
  });
}

async function requestNotifications() {
  if (!('Notification' in window)) {
    window.toast('This browser does not support notifications.');
    return;
  }
  const permission = await Notification.requestPermission();
  window.toast(permission === 'granted' ? 'Device notifications are enabled for live app updates.' : 'Notification permission was not granted.');
}

let installPrompt;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});

document.getElementById('install-app').addEventListener('click', async () => {
  if (!installPrompt) {
    window.toast('Use your browser menu and choose “Add to Home Screen” or “Install app”.');
    return;
  }
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
});

document.getElementById('account-button').addEventListener('click', openAccountDialog);
document.getElementById('sign-out-button').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) window.toast(error.message);
});
document.getElementById('enable-notifications').addEventListener('click', requestNotifications);
window.addEventListener('famguard:tasks-changed', syncTasks);
window.addEventListener('famguard:calendar-events-changed', syncCalendarEvents);

if (supabase) {
  renderAccount();
  supabase.auth.onAuthStateChange((_event, session) => setTimeout(() => loadSession(session), 0));
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) setStatus(`Supabase connection failed: ${error.message}`);
    else loadSession(data.session);
  });
  document.getElementById('sos-button').onclick = sendSos;
  document.getElementById('new-post').onclick = () => {
    if (!user) {
      window.toast('Sign in to share a community post.');
      return;
    }
    submitCommunityPost();
  };
} else {
  renderAccount();
}