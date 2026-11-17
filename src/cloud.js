import { createClient } from '@supabase/supabase-js';

const env = import.meta.env;
const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim();
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const cloudStatus = document.getElementById('cloud-status');
const accountButton = document.getElementById('account-button');
const signOutButton = document.getElementById('sign-out-button');
const locationToggle = document.getElementById('route-toggle');
const locationCopy = document.getElementById('route-copy');
const locationStatus = document.getElementById('route-status');
const locationUpdateStatus = document.getElementById('location-update-status');
const shareLocationToggle = document.getElementById('share-location-toggle');
const homeLocationBadge = document.getElementById('home-location-badge');
const homeLocationStatus = document.getElementById('home-location-status');
const taskIds = new Set();
const calendarEventIds = new Set();
let user = null;
let profile = null;
let familyMembers = [];
let familyRequests = [];
let sharedLocations = [];
let taskQueue = Promise.resolve();
let calendarQueue = Promise.resolve();
let locationQueue = Promise.resolve();
let locationWatchId = null;
let locationHeartbeatTimer = null;
let latestLocationCoordinates = null;
let lastLocationWriteAt = 0;
let alertChannel;
let familyChannel;
let familyRefreshTimer;
let sessionLoadSequence = 0;
let profilePromptUserId = null;
let selectedLocationUserId = null;
let mappedLocationVersion = '';

function setStatus(message) {
  cloudStatus.textContent = message;
}

function getLocationTrackingPreference(userId) {
  if (!userId) return false;
  try {
    const saved = localStorage.getItem(`famguard-location-tracking:${userId}`);
    return saved === null ? true : saved === 'true';
  } catch {
    return true;
  }
}

function setLocationTrackingPreference(enabled, userId = user?.id) {
  if (!userId) return;
  try {
    localStorage.setItem(`famguard-location-tracking:${userId}`, String(enabled));
  } catch {
    window.toast('The location tracking preference could not be saved on this device.');
  }
}

function updateLocationUi(enabled, message) {
  locationToggle.checked = enabled;
  locationCopy.textContent = enabled ? 'Location tracking is on' : 'Location tracking is off';
  locationStatus.textContent = enabled ? 'Location tracking is on' : 'Location tracking is off';
  locationUpdateStatus.textContent = message;
  homeLocationBadge.textContent = enabled ? 'On' : 'Off';
  homeLocationStatus.textContent = enabled
    ? profile?.share_location
      ? 'Tracking and family sharing are on. Only accepted members can see this device’s location.'
      : 'Tracking is on for this device. Its location is saved only to your account.'
    : 'Tracking is off. Turn it on from Locations when you want to save this device’s location.';
}

async function stopLocationTracking({ removeSaved = true, userId = user?.id } = {}) {
  if (locationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(locationWatchId);
  }
  if (locationHeartbeatTimer) clearInterval(locationHeartbeatTimer);
  locationHeartbeatTimer = null;
  latestLocationCoordinates = null;
  locationWatchId = null;
  lastLocationWriteAt = 0;
  updateLocationUi(false, 'Location tracking is off.');

  if (!removeSaved || !userId || !supabase) return;

  locationUpdateStatus.textContent = 'Tracking stopped. Removing the saved location…';
  const removeSavedLocation = async () => {
    const { error } = await supabase.from('locations').delete().eq('user_id', userId);
    if (error) throw new Error(error.message);
  };
  locationQueue = locationQueue.then(removeSavedLocation, removeSavedLocation);
  locationQueue = locationQueue.then(
    () => {
      locationUpdateStatus.textContent = 'Tracking stopped; the saved location was removed.';
    },
    error => {
      const message = error instanceof Error ? error.message : String(error);
      locationUpdateStatus.textContent = `Tracking stopped, but the saved location could not be removed: ${message}`;
      window.toast('Could not remove the saved location from Supabase.');
    }
  );
  await locationQueue;
  if (user?.id === userId) await loadFamilyLocations({ silent: true });
}

function queueLocationWrite(trackingUserId, coordinates) {
  const now = Date.now();
  if (now - lastLocationWriteAt < 30000) return;
  lastLocationWriteAt = now;
  const row = {
    user_id: trackingUserId,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    updated_at: new Date(now).toISOString()
  };
  locationQueue = locationQueue.then(async () => {
    if (locationWatchId === null || user?.id !== trackingUserId) return;
    const { error } = await supabase.from('locations').upsert(row, { onConflict: 'user_id' });
    if (error) {
      void stopLocationTracking({ removeSaved: false });
      updateLocationUi(false, `Location update failed: ${error.message}`);
      window.toast(`Location update failed: ${error.message}`);
      return;
    }
    locationUpdateStatus.textContent = profile?.share_location
      ? `Location shared with accepted family at ${new Date(row.updated_at).toLocaleTimeString()}.`
      : `Location saved privately at ${new Date(row.updated_at).toLocaleTimeString()}.`;
    void loadFamilyLocations({ silent: true });
  }).catch(error => {
    if (user?.id !== trackingUserId) return;
    const message = error instanceof Error ? error.message : String(error);
    void stopLocationTracking({ removeSaved: false });
    updateLocationUi(false, `Location update failed: ${message}`);
    window.toast(`Location update failed: ${message}`);
  });
}

function startLocationTracking() {
  if (!supabase || !user) {
    updateLocationUi(false, 'Sign in to save this device’s location to your account.');
    window.toast('Sign in before starting location tracking.');
    return;
  }
  if (!profile) {
    updateLocationUi(false, 'Complete your profile before starting location tracking.');
    window.toast('Complete your profile before enabling location tracking.');
    return;
  }
  if (!window.isSecureContext || !navigator.geolocation) {
    updateLocationUi(false, 'Location tracking requires browser geolocation on a secure HTTPS page.');
    window.toast('Location tracking is unavailable in this browser or connection.');
    return;
  }
  if (locationWatchId !== null) return;

  const trackingUserId = user.id;
  lastLocationWriteAt = 0;
  latestLocationCoordinates = null;
  updateLocationUi(true, profile.share_location
    ? 'Waiting for a location fix. Recent coordinates will be visible to accepted family members.'
    : 'Waiting for a location fix. Coordinates are saved privately to your account.');
  locationWatchId = navigator.geolocation.watchPosition(position => {
    if (locationWatchId === null || user?.id !== trackingUserId) return;
    latestLocationCoordinates = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    };
    queueLocationWrite(trackingUserId, latestLocationCoordinates);
  }, error => {
    if (locationWatchId === null || user?.id !== trackingUserId) return;
    if (error.code === 1) {
      setLocationTrackingPreference(false, trackingUserId);
      void stopLocationTracking({ userId: trackingUserId });
      locationUpdateStatus.textContent = 'Location permission was denied. Allow access in your browser settings and try again.';
    } else {
      locationUpdateStatus.textContent = `Location error: ${error.message}`;
      window.toast(`Location error: ${error.message}`);
    }
  }, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 10000
  });
  locationHeartbeatTimer = setInterval(() => {
    if (locationWatchId !== null && user?.id === trackingUserId && latestLocationCoordinates) {
      queueLocationWrite(trackingUserId, latestLocationCoordinates);
    }
  }, 30000);
}

const relationshipLabels = {
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  son: 'Son',
  daughter: 'Daughter',
  child: 'Child',
  sibling: 'Sibling',
  grandparent: 'Grandparent',
  spouse: 'Spouse / partner',
  friend: 'Friend',
  other: 'Other'
};

function relationshipLabel(value) {
  return relationshipLabels[value] || 'Family member';
}

function birthdayAndAge(value) {
  if (!value) return 'Not added (private)';
  const [year, month, day] = value.split('-').map(Number);
  const birthday = new Date(year, month - 1, day, 12);
  const today = new Date();
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return `${birthday.toLocaleDateString()} · age ${age} (private)`;
}

function renderProfile() {
  const displayName = profile?.display_name || '';
  document.getElementById('profile-name').textContent = profile?.display_name || 'Sign in to set up your profile.';
  document.getElementById('profile-role').textContent = profile ? relationshipLabel(profile.relationship) : '—';
  document.getElementById('profile-email').textContent = user?.email || '—';
  document.getElementById('profile-phone').textContent = profile?.phone || 'Not added (private)';
  document.getElementById('profile-birthday-age').textContent = birthdayAndAge(profile?.birth_date);
  document.getElementById('family-code').textContent = profile?.family_code || 'Available after profile setup';
  document.getElementById('copy-family-code').disabled = !profile?.family_code;
  shareLocationToggle.checked = Boolean(profile?.share_location);
  shareLocationToggle.disabled = !user || !profile;
  document.querySelector('.welcome-copy .eyebrow').textContent = displayName
    ? `WELCOME, ${displayName.toLocaleUpperCase()}`
    : 'WELCOME TO FAMGUARD';
  document.querySelector('.welcome-copy p').textContent = 'Connect with trusted people and choose what you share.';
  document.querySelector('.family-mini .mini-avatar').textContent = displayName
    ? displayName.split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase()
    : 'FG';
  document.querySelector('.family-mini strong').textContent = displayName || 'FamGuard member';
  document.querySelector('.family-mini small').textContent = profile ? relationshipLabel(profile.relationship) : 'Complete your profile';
}

function openProfileDialog({ required = false } = {}) {
  if (!user || !supabase) {
    window.toast('Sign in before setting up a profile.');
    return;
  }

  const dialogUser = user;
  const today = new Date();
  const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  window.modal({
    title: required ? 'Set up your FamGuard profile' : 'Edit your profile',
    description: 'Your phone and birthday stay private. Family members only see your name and role.',
    content: '<label class="eyebrow">Full name<input class="input" id="profile-name-input" autocomplete="name" maxlength="80" required></label><label class="eyebrow">Phone number (optional)<input class="input" id="profile-phone-input" type="tel" autocomplete="tel" maxlength="32"></label><label class="eyebrow">Family role<select class="select" id="profile-role-input" required><option value="">Choose a role</option><option value="mother">Mother</option><option value="father">Father</option><option value="guardian">Guardian</option><option value="son">Son</option><option value="daughter">Daughter</option><option value="child">Child</option><option value="sibling">Sibling</option><option value="grandparent">Grandparent</option><option value="spouse">Spouse / partner</option><option value="friend">Friend</option><option value="other">Other</option></select></label><label class="eyebrow">Birthday (optional; age is calculated and private)<input class="input" id="profile-birthday-input" type="date"></label>',
    confirm: 'Save profile',
    onConfirm: async (box, close) => {
      if (user?.id !== dialogUser.id) {
        window.toast('Your account changed. Reopen profile setup for the current account.');
        return;
      }
      const displayName = box.querySelector('#profile-name-input').value.trim();
      const phone = box.querySelector('#profile-phone-input').value.trim();
      const relationship = box.querySelector('#profile-role-input').value;
      const birthDate = box.querySelector('#profile-birthday-input').value || null;
      if (!displayName || !relationship) {
        window.toast('Enter your name and choose a family role.');
        return;
      }
      if (phone && phone.length < 7) {
        window.toast('Enter a complete phone number or leave it blank.');
        return;
      }
      if (birthDate && birthDate > todayValue) {
        window.toast('Birthday cannot be in the future.');
        return;
      }

      const activeUser = dialogUser;
      const { data, error } = await supabase.from('user_profiles').upsert({
        user_id: activeUser.id,
        display_name: displayName,
        phone: phone || null,
        relationship,
        birth_date: birthDate,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
        .select('user_id,display_name,phone,relationship,birth_date,family_code,share_location')
        .single();
      if (error) {
        window.toast(`Profile could not be saved: ${error.message}. Check that supabase/schema.sql has been applied.`);
        return;
      }
      if (user?.id !== activeUser.id) return;

      profile = data;
      profilePromptUserId = null;
      renderProfile();
      close();
      if (getLocationTrackingPreference(activeUser.id)) startLocationTracking();
      await Promise.all([loadFamilyData(), loadFamilyLocations()]);
      subscribeToFamilyUpdates();
      startFamilyRefresh(activeUser.id);
      window.toast('Your private profile was saved.');
    }
  });

  const box = document.querySelector('#overlay-root .modal');
  box.querySelector('#profile-name-input').value = profile?.display_name
    || user.user_metadata?.full_name
    || user.user_metadata?.name
    || '';
  box.querySelector('#profile-phone-input').value = profile?.phone || '';
  box.querySelector('#profile-role-input').value = profile?.relationship || '';
  box.querySelector('#profile-birthday-input').value = profile?.birth_date || '';
  box.querySelector('#profile-birthday-input').max = todayValue;
}

async function loadProfile({ promptOnMissing = true } = {}) {
  const activeUser = user;
  const { data, error } = await supabase.from('user_profiles')
    .select('user_id,display_name,phone,relationship,birth_date,family_code,share_location')
    .maybeSingle();
  if (user?.id !== activeUser?.id) return false;
  if (error) {
    profile = null;
    renderProfile();
    setStatus(`Signed in, but profile setup needs attention: ${error.message}`);
    window.toast('Run the updated supabase/schema.sql before setting up a profile.');
    return false;
  }

  profile = data;
  renderProfile();
  if (profile) {
    profilePromptUserId = null;
    if (getLocationTrackingPreference(activeUser.id)) startLocationTracking();
  } else if (promptOnMissing && profilePromptUserId !== activeUser.id) {
    profilePromptUserId = activeUser.id;
    openProfileDialog({ required: true });
  }
  return true;
}

function renderFamilyMembers() {
  const list = document.getElementById('family-members');
  const homePreview = document.getElementById('home-family-preview');
  list.replaceChildren();
  homePreview.replaceChildren();
  const status = document.getElementById('family-members-status');
  if (!user || !profile) {
    status.textContent = 'Sign in and complete your profile to connect.';
    const empty = document.createElement('p');
    empty.className = 'eyebrow';
    empty.textContent = 'Sign in and connect with family using their FamGuard ID.';
    homePreview.append(empty);
    return;
  }
  status.textContent = familyMembers.length
    ? `${familyMembers.length} accepted family connection${familyMembers.length === 1 ? '' : 's'}.`
    : 'No accepted family connections yet.';
  if (!familyMembers.length) {
    const empty = document.createElement('p');
    empty.className = 'eyebrow';
    empty.textContent = 'Enter a family member’s ID above. They must accept your request before you are connected.';
    list.append(empty);
    const homeEmpty = document.createElement('p');
    homeEmpty.className = 'eyebrow';
    homeEmpty.textContent = 'No family connections yet. Add a member by ID in Fam-Dash.';
    homePreview.append(homeEmpty);
    return;
  }

  familyMembers.forEach(member => {
    const row = document.createElement('div');
    row.className = 'family-data-item';
    const copy = document.createElement('div');
    copy.className = 'family-data-copy';
    const name = document.createElement('strong');
    name.textContent = member.display_name;
    const detail = document.createElement('small');
    detail.textContent = `${relationshipLabel(member.relationship)} · Location sharing ${member.sharing_location ? 'enabled' : 'off'}`;
    copy.append(name, detail);
    row.append(copy);
    list.append(row);

    const preview = document.createElement('button');
    preview.className = 'contact';
    preview.type = 'button';
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = member.display_name.split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
    const previewCopy = document.createElement('span');
    const previewName = document.createElement('span');
    previewName.className = 'person-name';
    previewName.textContent = member.display_name;
    const previewRole = document.createElement('span');
    previewRole.className = 'person-status';
    previewRole.textContent = relationshipLabel(member.relationship);
    previewCopy.append(previewName, previewRole);
    preview.append(avatar, previewCopy);
    preview.addEventListener('click', () => document.querySelector('.main-nav [data-view="famdash"]')?.click());
    homePreview.append(preview);
  });
}

async function respondToFamilyRequest(requestId, accept) {
  const { error } = await supabase.rpc('respond_to_family_request', {
    p_request_id: requestId,
    p_accept: accept
  });
  if (error) {
    window.toast(`Family request could not be updated: ${error.message}`);
    return;
  }
  await Promise.all([loadFamilyData(), loadFamilyLocations()]);
  window.toast(accept ? 'Family connection accepted.' : 'Family request declined.');
}

function renderFamilyRequests() {
  const list = document.getElementById('family-requests');
  list.replaceChildren();
  const status = document.getElementById('family-requests-status');
  if (!user || !profile) {
    status.textContent = 'Sign in and complete your profile to manage requests.';
    return;
  }
  status.textContent = familyRequests.length
    ? `${familyRequests.length} pending request${familyRequests.length === 1 ? '' : 's'}.`
    : 'Incoming requests need your approval.';
  if (!familyRequests.length) {
    const empty = document.createElement('p');
    empty.className = 'eyebrow';
    empty.textContent = 'No pending requests.';
    list.append(empty);
    return;
  }

  familyRequests.forEach(request => {
    const row = document.createElement('div');
    row.className = 'family-data-item';
    const copy = document.createElement('div');
    copy.className = 'family-data-copy';
    const name = document.createElement('strong');
    name.textContent = request.counterpart_name;
    const detail = document.createElement('small');
    detail.textContent = `${relationshipLabel(request.counterpart_role)} · ${request.direction === 'received' ? 'Wants to connect' : 'Waiting for their approval'}`;
    copy.append(name, detail);
    row.append(copy);
    if (request.direction === 'received') {
      const actions = document.createElement('div');
      actions.className = 'family-request-actions';
      const accept = document.createElement('button');
      accept.className = 'text-link';
      accept.type = 'button';
      accept.textContent = 'Accept';
      accept.addEventListener('click', () => void respondToFamilyRequest(request.request_id, true));
      const decline = document.createElement('button');
      decline.className = 'text-link';
      decline.type = 'button';
      decline.textContent = 'Decline';
      decline.addEventListener('click', () => void respondToFamilyRequest(request.request_id, false));
      actions.append(accept, decline);
      row.append(actions);
    }
    list.append(row);
  });
}

async function loadFamilyData() {
  if (!user || !profile) {
    familyMembers = [];
    familyRequests = [];
    renderFamilyMembers();
    renderFamilyRequests();
    return false;
  }

  const activeUser = user;
  const [membersResult, requestsResult] = await Promise.all([
    supabase.rpc('get_family_members'),
    supabase.rpc('get_family_requests')
  ]);
  if (user?.id !== activeUser.id) return false;
  const error = membersResult.error || requestsResult.error;
  if (error) {
    setStatus(`Family setup needs attention: ${error.message}`);
    window.toast('Family connections are unavailable. Apply the updated supabase/schema.sql.');
    return false;
  }
  familyMembers = membersResult.data || [];
  familyRequests = requestsResult.data || [];
  renderFamilyMembers();
  renderFamilyRequests();
  return true;
}

function hideLocationMap() {
  const map = document.getElementById('live-map');
  map.hidden = true;
  map.removeAttribute('src');
  mappedLocationVersion = '';
}

function showLocationOnMap(location, name, { force = false } = {}) {
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  const map = document.getElementById('live-map');
  const version = `${location.user_id}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
  const now = Date.now();
  const shouldReload = force || map.hidden || version !== mappedLocationVersion
    && (location.user_id !== selectedLocationUserId || now - map.dataset.loadedAt > 60000);
  selectedLocationUserId = location.user_id;
  if (shouldReload) {
      const latitudeDelta = 0.008;
      const longitudeDelta = 0.008;
    const bounds = [
        Math.max(-180, longitude - longitudeDelta),
        Math.max(-90, latitude - latitudeDelta),
        Math.min(180, longitude + longitudeDelta),
        Math.min(90, latitude + latitudeDelta)
    ].map(value => value.toFixed(6)).join(',');
    map.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bounds}&layer=mapnik&marker=${latitude.toFixed(6)}%2C${longitude.toFixed(6)}`;
    map.dataset.loadedAt = String(now);
    mappedLocationVersion = version;
  }
  map.title = `${name}’s location on OpenStreetMap`;
  map.hidden = false;
}

function renderFamilyLocations() {
  const list = document.getElementById('live-family-locations');
  list.replaceChildren();
  const status = document.getElementById('live-family-status');
  if (!user || !profile) {
    status.textContent = 'Sign in and complete your profile to see locations.';
    hideLocationMap();
    return;
  }
  status.textContent = familyMembers.length
    ? 'Only current locations shared by accepted family members are available.'
    : 'No accepted family connections yet. Your own location appears here when tracking is on.';

  const entries = [{
    user_id: user.id,
    display_name: `${profile.display_name} (you)`,
    relationship: profile.relationship,
    sharing_location: profile.share_location
  }, ...familyMembers.map(member => ({ ...member, user_id: member.member_id }))];
  entries.forEach(member => {
    const location = sharedLocations.find(row => row.user_id === member.user_id);
    const row = document.createElement('div');
    row.className = 'family-data-item';
    const copy = document.createElement('div');
    copy.className = 'family-data-copy';
    const name = document.createElement('strong');
    name.textContent = member.display_name;
    const detail = document.createElement('small');
    detail.textContent = location
      ? `Updated ${new Date(location.updated_at).toLocaleTimeString()}`
      : member.user_id === user.id && locationWatchId !== null
        ? 'Waiting for a location fix'
        : member.sharing_location
          ? 'Sharing enabled; waiting for a fresh location'
          : 'Location sharing is off';
    copy.append(name, detail);
    row.append(copy);
    if (location) {
      const show = document.createElement('button');
      show.className = 'text-link';
      show.type = 'button';
      show.textContent = 'Show on map';
      show.addEventListener('click', () => showLocationOnMap(location, member.display_name, { force: true }));
      row.append(show);
    }
    list.append(row);
  });

  const current = sharedLocations.find(row => row.user_id === selectedLocationUserId);
  if (selectedLocationUserId && !current) selectedLocationUserId = null;
  const selected = current && entries.find(entry => entry.user_id === selectedLocationUserId);
  if (current && selected) {
    showLocationOnMap(current, selected.display_name);
    return;
  }

  const defaultLocation = sharedLocations.find(row => row.user_id === user.id)
    || familyMembers
      .map(member => sharedLocations.find(row => row.user_id === member.member_id))
      .find(Boolean);
  const defaultMember = defaultLocation && entries.find(entry => entry.user_id === defaultLocation.user_id);
  if (defaultLocation && defaultMember) showLocationOnMap(defaultLocation, defaultMember.display_name);
  else hideLocationMap();
}

async function loadFamilyLocations({ silent = false } = {}) {
  if (!user || !profile) {
    sharedLocations = [];
    renderFamilyLocations();
    return false;
  }

  const activeUser = user;
  const { data, error } = await supabase.from('locations')
    .select('user_id,latitude,longitude,updated_at')
    .order('updated_at', { ascending: false });
  if (user?.id !== activeUser.id) return false;
  if (error) {
    if (!silent) {
      setStatus(`Locations could not be loaded: ${error.message}`);
      window.toast('Location sharing is unavailable. Apply the updated supabase/schema.sql.');
    }
    return false;
  }

  const freshnessLimit = Date.now() - 120000;
  sharedLocations = (data || []).filter(row => Date.parse(row.updated_at) >= freshnessLimit);
  renderFamilyLocations();
  return true;
}

async function updateLocationSharing() {
  if (!user || !profile) {
    shareLocationToggle.checked = false;
    window.toast('Complete your profile before changing location sharing.');
    return;
  }
  const activeUser = user;
  const wasSharing = profile.share_location;
  shareLocationToggle.disabled = true;
  const { error } = await supabase.from('user_profiles')
    .update({ share_location: shareLocationToggle.checked, updated_at: new Date().toISOString() })
    .eq('user_id', activeUser.id);
  if (error) {
    shareLocationToggle.checked = wasSharing;
    shareLocationToggle.disabled = false;
    window.toast(`Location sharing could not be changed: ${error.message}`);
    return;
  }
  profile = { ...profile, share_location: shareLocationToggle.checked };
  shareLocationToggle.disabled = false;
  updateLocationUi(locationWatchId !== null, locationUpdateStatus.textContent);
  await Promise.all([loadFamilyData(), loadFamilyLocations()]);
  window.toast(profile.share_location
    ? 'Your current location is visible to accepted family only while tracking is active.'
    : 'Family location sharing is off.');
}

async function submitFamilyCode(event) {
  event.preventDefault();
  if (!user || !profile) {
    window.toast('Sign in and complete your profile before connecting with family.');
    return;
  }
  const input = document.getElementById('family-code-entry');
  const code = input.value.trim().replace(/\s/g, '').toUpperCase();
  if (code.length !== 16) {
    window.toast('Enter the complete 16-character FamGuard ID.');
    return;
  }

  const { data, error } = await supabase.rpc('lookup_family_code', { p_family_code: code });
  if (error) {
    window.toast(`FamGuard ID lookup failed: ${error.message}`);
    return;
  }
  if (!data?.length) {
    window.toast('No FamGuard ID matched. Check the code with its owner.');
    return;
  }

  const member = data[0];
  const requesterId = user.id;
  window.modal({
    title: 'Send a family request?',
    description: 'They must accept before you are connected. Contact details and birthdays stay private.',
    content: '<p class="eyebrow" id="family-request-preview"></p>',
    confirm: 'Send request',
    onConfirm: async (_, close) => {
      if (user?.id !== requesterId) {
        window.toast('Your account changed. Start the family request again.');
        return;
      }
      const { error: requestError } = await supabase.rpc('request_family_connection', { p_family_code: code });
      if (requestError) {
        window.toast(`Family request could not be sent: ${requestError.message}`);
        return;
      }
      close();
      input.value = '';
      await loadFamilyData();
      window.toast('Request sent. You will connect after they accept.');
    }
  });
  document.getElementById('family-request-preview').textContent =
    `Send a request to ${member.display_name} (${relationshipLabel(member.relationship)})?`;
}

async function copyFamilyCode() {
  if (!profile?.family_code) return;
  try {
    await navigator.clipboard.writeText(profile.family_code);
    window.toast('FamGuard ID copied.');
  } catch {
    window.toast('Could not copy the ID. Select and copy it manually.');
  }
}

function subscribeToFamilyUpdates() {
  if (familyChannel) supabase.removeChannel(familyChannel);
  if (!user) return;
  familyChannel = supabase.channel(`famguard-family-${user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'family_requests' }, () => {
      void loadFamilyData();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'family_connections' }, () => {
      void Promise.all([loadFamilyData(), loadFamilyLocations({ silent: true })]);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, () => {
      void loadFamilyLocations({ silent: true });
    })
    .subscribe();
}

function startFamilyRefresh(activeUserId) {
  if (familyRefreshTimer) clearInterval(familyRefreshTimer);
  familyRefreshTimer = setInterval(() => {
    if (user?.id !== activeUserId || document.visibilityState !== 'visible') return;
    void loadFamilyData();
    void loadFamilyLocations({ silent: true });
  }, 15000);
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
  const loadSequence = ++sessionLoadSequence;
  const nextUser = session?.user || null;
  if (user?.id !== nextUser?.id) {
    if (familyRefreshTimer) clearInterval(familyRefreshTimer);
    familyRefreshTimer = null;
    if (familyChannel) supabase.removeChannel(familyChannel);
    familyChannel = null;
    profile = null;
    familyMembers = [];
    familyRequests = [];
    sharedLocations = [];
    profilePromptUserId = null;
    selectedLocationUserId = null;
    hideLocationMap();
    if (locationWatchId !== null) await stopLocationTracking({ removeSaved: false });
    taskIds.clear();
    calendarEventIds.clear();
  }
  window.famguardSetCalendarOwner(nextUser?.id || null);
  user = nextUser;
  window.famguardUser = user;
  renderAccount();
  renderProfile();
  if (!user) {
    if (alertChannel) supabase.removeChannel(alertChannel);
    if (familyChannel) supabase.removeChannel(familyChannel);
    window.famguardHydrating = true;
    let savedTasks = [];
    try { savedTasks = JSON.parse(localStorage.getItem('famguard-tasks')) || []; } catch {}
    window.famguardTasks.splice(0, window.famguardTasks.length, ...savedTasks);
    taskIds.clear();
    window.famguardRenderTasks();
    window.famguardHydrating = false;
    renderFamilyMembers();
    renderFamilyRequests();
    renderFamilyLocations();
    return;
  }

  await loadProfile();
  if (loadSequence !== sessionLoadSequence) return;
  await loadTasks();
  if (loadSequence !== sessionLoadSequence) return;
  await loadCalendarEvents();
  if (loadSequence !== sessionLoadSequence) return;
  await loadPosts();
  if (loadSequence !== sessionLoadSequence) return;
  if (profile) {
    await loadFamilyData();
    if (loadSequence !== sessionLoadSequence) return;
    await loadFamilyLocations();
    if (loadSequence !== sessionLoadSequence) return;
    subscribeToFamilyUpdates();
    startFamilyRefresh(user.id);
  } else {
    renderFamilyMembers();
    renderFamilyRequests();
    renderFamilyLocations();
  }
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
document.getElementById('edit-profile').addEventListener('click', () => openProfileDialog());
document.getElementById('copy-family-code').addEventListener('click', copyFamilyCode);
document.getElementById('family-code-form').addEventListener('submit', event => void submitFamilyCode(event));
shareLocationToggle.addEventListener('change', updateLocationSharing);
locationToggle.addEventListener('change', () => {
  setLocationTrackingPreference(locationToggle.checked);
  if (locationToggle.checked) startLocationTracking();
  else void stopLocationTracking();
});
document.getElementById('sign-out-button').addEventListener('click', async () => {
  if (locationWatchId !== null) await stopLocationTracking();
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
  renderProfile();
  renderFamilyMembers();
  renderFamilyRequests();
  renderFamilyLocations();
}