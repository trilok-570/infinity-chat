const appState = {
  currentUser: null,
  users: [],
  usersLoadState: 'idle',
  conversations: [],
  activeConversationId: null,
  activeNavigation: 'chats',
  collectionNavigation: 'chats',
  conversationFilter: 'all',
  conversationInfoOpen: false,
  pendingAttachment: null,
  recording: null,
  conversationLoadState: 'idle',
  unlockedConversationIds: new Set(),
  activeMessages: [],
  typingUsers: new Map(),
  onlineUserIds: new Set(),
  processedUnreadMessageIds: new Set()
};

const authScreen = document.getElementById('auth-screen');
const chatScreen = document.getElementById('chat-screen');
const authError = document.getElementById('auth-error');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const peopleList = document.getElementById('people-list');
const userSearchInput = document.getElementById('user-search-input');
const clearUserSearch = document.getElementById('clear-user-search');
const peopleCount = document.getElementById('people-count');
const conversationList = document.getElementById('conversation-list');
const listPanelTitle = document.getElementById('list-panel-title');
const conversationSectionTitle = document.getElementById('conversation-section-title');
const conversationSearchInput = document.getElementById('conversation-search-input');
const conversationSearchWrap = document.getElementById('conversation-search-wrap');
const conversationFilters = document.getElementById('conversation-filters');
const userSearchWrap = document.getElementById('user-search-wrap');
const conversationView = document.getElementById('conversation-view');
const friendsView = document.getElementById('friends-view');
const conversationInfoButton = document.getElementById('conversation-info-button');
const conversationInfoPanel = document.getElementById('conversation-info-panel');
const archiveChatButton = document.getElementById('archive-chat-button');
const infoPanelAvatar = document.getElementById('info-panel-avatar');
const infoPanelName = document.getElementById('info-panel-name');
const infoPanelUsername = document.getElementById('info-panel-username');
const infoPanelAbout = document.getElementById('info-panel-about');
const infoPanelProfileButton = document.getElementById('info-panel-profile-button');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const emojiPicker = document.getElementById('emoji-picker');
const messageSearchInput = document.getElementById('message-search-input');
const attachmentInput = document.getElementById('attachment-input');
const attachmentPreview = document.getElementById('attachment-preview');
const voiceMessageButton = document.getElementById('voice-message-button');
const voiceMessageIcon = voiceMessageButton.innerHTML;
const recordingIndicator = document.getElementById('recording-indicator');
const recordingTimer = document.getElementById('recording-timer');
const groupDialog = document.getElementById('group-dialog');
const groupForm = document.getElementById('group-form');
const groupPeopleList = document.getElementById('group-people-list');
const groupDialogError = document.getElementById('group-dialog-error');
const toastRegion = document.getElementById('toast-region');
const chatTitle = document.getElementById('chat-title');
const chatStatus = document.getElementById('chat-status');
const chatContactAvatar = document.getElementById('chat-contact-avatar');
const typingIndicator = document.getElementById('typing-indicator');
const viewChatProfileButton = document.getElementById('view-chat-profile');
const chatPinDialog = document.getElementById('chat-pin-dialog');
const chatPinForm = document.getElementById('chat-pin-form');
const chatPinInput = document.getElementById('chat-pin-input');
const chatPinError = document.getElementById('chat-pin-error');
const chatPinSubmitButton = document.getElementById('submit-chat-pin-button');
const logoutButton = document.getElementById('logout-button');
const profileSettingsButton = document.getElementById('profile-settings-button');
const profileDialog = document.getElementById('profile-dialog');
const profileForm = document.getElementById('profile-form');
const profileDisplayName = document.getElementById('profile-display-name');
const profileNickname = document.getElementById('profile-nickname');
const profileDateOfBirth = document.getElementById('profile-date-of-birth');
const profileDatePlaceholder = document.getElementById('profile-date-placeholder');
const clearProfileDateButton = document.getElementById('clear-profile-date');
const profileGender = document.getElementById('profile-gender');
const profileCustomGender = document.getElementById('profile-custom-gender');
const profileFieldVisibility = {
  fullName: document.getElementById('profile-full-name-visibility'),
  nickname: document.getElementById('profile-nickname-visibility'),
  dateOfBirth: document.getElementById('profile-dob-visibility'),
  gender: document.getElementById('profile-gender-visibility'),
  profilePhoto: document.getElementById('profile-photo-visibility')
};
const uploadProfilePhoto = document.getElementById('upload-profile-photo');
const changeProfilePhoto = document.getElementById('change-profile-photo');
const profileSaveButton = document.getElementById('profile-save-button');
const profilePhotoInput = document.getElementById('profile-photo-input');
const profilePhotoPreview = document.getElementById('profile-photo-preview');
const profileError = document.getElementById('profile-error');
const profileSaveNotice = document.getElementById('profile-save-notice');
const userProfileDialog = document.getElementById('user-profile-dialog');
const viewProfileAvatar = document.getElementById('view-profile-avatar');
const viewProfileName = document.getElementById('view-profile-name');
const viewProfileUsername = document.getElementById('view-profile-username');
const viewProfilePrivate = document.getElementById('view-profile-private');
const viewProfileDetails = document.getElementById('view-profile-details');
let viewedProfileUserId = null;
let editingProfileImage = null;
let pendingPhotoProcessing = null;
let profileSaveNoticeTimeout;
let pendingChatPinAction = null;
let userSearchRequest = 0;
let conversationLoadRequest = 0;
let groupDialogMode = 'create';
let groupDialogConversationId = null;
let toastTimeout;

const socket = io({ autoConnect: false });

class ApiError extends Error {
  constructor(message, { status = null, code = 'API_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function api(path, options = {}) {
  const {
    headers: requestHeaders,
    signal: callerSignal,
    ...requestOptions
  } = options;
  const headers = new Headers(requestHeaders || {});
  if (typeof requestOptions.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  const abortRequest = () => controller.abort(callerSignal.reason);
  if (callerSignal?.aborted) abortRequest();
  else callerSignal?.addEventListener('abort', abortRequest, { once: true });

  try {
    let response;
    try {
      response = await fetch(path, {
        ...requestOptions,
        headers,
        signal: controller.signal,
        credentials: 'same-origin'
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiError(
          callerSignal?.aborted
            ? 'This request was cancelled.'
            : 'The request took too long. Check your connection and try again.',
          { code: callerSignal?.aborted ? 'REQUEST_ABORTED' : 'REQUEST_TIMEOUT', cause: error }
        );
      }
      if (error instanceof TypeError || !navigator.onLine) {
        throw new ApiError(
          navigator.onLine
            ? 'Could not reach Infinity Chat. Check that the app server is running and try again.'
            : 'You appear to be offline. Reconnect and try again.',
          { code: navigator.onLine ? 'NETWORK_ERROR' : 'OFFLINE', cause: error }
        );
      }
      throw new ApiError('The request could not be completed. Please try again.', {
        code: 'NETWORK_ERROR',
        cause: error
      });
    }

    const responseText = await response.text();
    let payload = {};
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch (error) {
        if (response.ok) {
          throw new ApiError(
            `The server returned an unreadable response (${response.status}). Please retry.`,
            { status: response.status, code: 'INVALID_RESPONSE', cause: error }
          );
        }
      }
    }

    if (!response.ok) {
      const serverMessage = typeof payload?.error === 'string' ? payload.error.trim() : '';
      const message = serverMessage
        ? serverMessage.slice(0, 400)
        : response.status === 404
          ? `This API route was not found (404). Confirm the latest Infinity Chat server is running.`
          : response.status === 413
            ? 'This upload is too large. Choose a smaller file.'
            : response.status === 429
              ? 'Too many requests. Wait a moment and try again.'
              : response.status >= 500
                ? `The server could not complete this request (${response.status}). Please try again.`
                : `The request was rejected (${response.status}). Check your input and try again.`;
      throw new ApiError(message, {
        status: response.status,
        code: typeof payload?.code === 'string' ? payload.code : `HTTP_${response.status}`
      });
    }

    if (!responseText) return {};
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new ApiError('The server returned an unexpected response. Please retry.', {
        status: response.status,
        code: 'INVALID_RESPONSE'
      });
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener('abort', abortRequest);
  }
}

function setAuthError(message) {
  authError.textContent = message;
  authError.classList.toggle('hidden', !message);
}

function toggleAuthScreen() {
  const loggedIn = Boolean(appState.currentUser);
  authScreen.classList.toggle('active', !loggedIn);
  chatScreen.classList.toggle('active', loggedIn);
}

function renderCurrentUser() {
  if (!appState.currentUser) {
    return;
  }

  document.title = `${appState.currentUser.username} • INFINITY CHAT`;
  document.getElementById('current-display-name').textContent = getDisplayName(appState.currentUser);
  document.getElementById('current-username').textContent = `@${appState.currentUser.username}`;
  document.getElementById('current-profile-avatar').innerHTML = avatarContent(appState.currentUser);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function getDisplayName(user) {
  return user.nickname || user.displayName || user.username;
}

function showToast(message, type = 'error') {
  toastRegion.textContent = message;
  toastRegion.className = `toast-region toast-${type}`;
  toastRegion.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastRegion.classList.remove('visible'), 4200);
}

function avatarContent(user) {
  if (user.profileImage) {
    return `<img src="${escapeHtml(user.profileImage)}" alt="" />`;
  }
  return escapeHtml(getDisplayName(user).charAt(0).toUpperCase() || '?');
}

function getConversationMeta(conversationId) {
  return appState.conversations.find((conversation) => conversation.id === conversationId);
}

function activeConversationStorageKey() {
  return `infinity-chat:last-conversation:${appState.currentUser.id}`;
}

function renderPeople() {
  const query = userSearchInput.value.trim().replace(/^@+/, '').toLowerCase();
  const people = appState.users
    .filter((user) => user.id !== appState.currentUser?.id)
    .filter((user) => !query
      || user.username.toLowerCase().includes(query)
      || getDisplayName(user).toLowerCase().includes(query));

  peopleCount.textContent = query ? String(people.length) : '';
  clearUserSearch.classList.toggle('hidden', !userSearchInput.value);
  if (appState.usersLoadState === 'error') {
    peopleList.innerHTML = '<li class="people-empty">Could not load people. Check your connection and try again.</li>';
    return;
  }
  if (appState.usersLoadState === 'loading' && !appState.users.length) {
    peopleList.innerHTML = '<li class="people-empty">Loading people…</li>';
    return;
  }
  if (!people.length) {
    peopleList.innerHTML = `<li class="people-empty">${query ? 'No users found. Try another username.' : 'No other users yet.'}</li>`;
    return;
  }

  peopleList.innerHTML = people
    .map((user) => {
      const isOnline = appState.onlineUserIds.has(user.id);
      return `
        <li class="user-item" data-user-id="${user.id}">
          <div class="user-meta">
            <div class="avatar">${avatarContent(user)}</div>
            <div>
              <div class="user-name">${escapeHtml(getDisplayName(user))}</div>
              <div class="user-handle">@${escapeHtml(user.username)}</div>
            </div>
          </div>
          <div class="user-actions">
            <button class="user-action view-user-profile" type="button" data-user-id="${user.id}">Profile</button>
            <button class="user-action message-user ${isOnline ? 'online' : ''}" type="button" data-user-id="${user.id}">${isOnline ? 'Online' : 'Message'}</button>
          </div>
        </li>
      `;
    })
    .join('');

  peopleList.querySelectorAll('.view-user-profile').forEach((button) => {
    button.addEventListener('click', () => {
      viewUserProfile(Number(button.dataset.userId)).catch(showChatError);
    });
  });
  peopleList.querySelectorAll('.message-user').forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = Number(button.dataset.userId);
      try {
        await startConversation(userId);
      } catch (error) {
        showChatError(error);
      }
    });
  });
}

async function viewUserProfile(userId) {
  const { profile } = await api(`/api/users/${userId}/profile`);
  viewedProfileUserId = profile.id;
  viewProfileAvatar.innerHTML = avatarContent(profile);
  viewProfileName.textContent = getDisplayName(profile);
  viewProfileUsername.textContent = `@${profile.username}`;
  const privacyValues = Object.values(profile.fieldVisibility || {});
  const hasPrivateFields = privacyValues.some((visibility) => visibility === 'private');
  viewProfilePrivate.textContent = privacyValues.length && privacyValues.every((visibility) => visibility === 'private')
    ? 'This profile is private. Only the username is visible.'
    : 'Some profile information is private and is not shared.';
  viewProfilePrivate.classList.toggle('hidden', !hasPrivateFields);
  viewProfileDetails.classList.remove('hidden');
  document.getElementById('view-profile-full-name').textContent = profile.fieldVisibility?.fullName === 'private'
    ? 'Not shared' : profile.displayName || 'Not shared';
  document.getElementById('view-profile-nickname').textContent = profile.fieldVisibility?.nickname === 'private'
    ? 'Not shared' : profile.nickname || '—';
  document.getElementById('view-profile-dob').textContent = profile.fieldVisibility?.dateOfBirth === 'private'
    ? 'Not shared' : profile.dateOfBirth || '—';
  document.getElementById('view-profile-gender').textContent = profile.fieldVisibility?.gender === 'private'
    ? 'Not shared' : profile.gender === 'custom' ? profile.customGender || 'Custom' : formatGender(profile.gender) || '—';
  userProfileDialog.showModal();
}

function formatGender(gender) {
  const labels = {
    male: 'Male',
    female: 'Female',
    man: 'Male',
    woman: 'Female',
    transgender: 'Transgender',
    'non-binary': 'Non-binary',
    'prefer-not-to-say': 'Prefer not to say',
    custom: 'Custom'
  };
  return labels[gender] || '';
}

function conversationTimestamp(conversation) {
  return Date.parse(conversation.lastMessage?.sentAt || conversation.updatedAt || '') || 0;
}

function sortRecentConversations() {
  appState.conversations.sort((a, b) => conversationTimestamp(b) - conversationTimestamp(a));
}

function syncConversationFilterButtons() {
  conversationFilters.querySelectorAll('[data-filter]').forEach((button) => {
    const isActive = button.dataset.filter === appState.conversationFilter;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function formatConversationTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

function renderConversations() {
  const searchTerm = conversationSearchInput.value.trim().toLowerCase();
  const archivedView = appState.activeNavigation === 'archived';
  const totalUnread = appState.conversations
    .filter((conversation) => !conversation.isArchived)
    .reduce((count, conversation) => count + (Number(conversation.unreadCount) || 0), 0);
  const navUnreadCount = document.getElementById('nav-unread-count');
  navUnreadCount.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
  navUnreadCount.classList.toggle('hidden', totalUnread === 0);
  const conversations = appState.conversations.filter((conversation) => (
    Boolean(conversation.isArchived) === archivedView
  )).filter((conversation) => (
    appState.conversationFilter === 'all'
    || (appState.conversationFilter === 'groups' ? conversation.isGroup : !conversation.isGroup)
  )).filter((conversation) => {
    if (!searchTerm) return true;
    const displayName = getDisplayName(conversation.otherUser).toLowerCase();
    const username = conversation.otherUser.username.toLowerCase();
    const preview = (conversation.lastMessage?.text || '').toLowerCase();
    return displayName.includes(searchTerm) || username.includes(searchTerm) || preview.includes(searchTerm);
  });
  if (!conversations.length) {
    const emptyMessage = searchTerm
      ? 'No conversations match your search.'
      : appState.conversationLoadState === 'loading'
        ? 'Loading recent chats…'
        : appState.conversationLoadState === 'error'
          ? 'Could not load recent chats. Try again.'
      : appState.activeNavigation === 'archived' ? 'No archived chats yet.'
        : appState.conversationFilter === 'groups' ? 'No group chats yet. Create a group to get started.'
          : appState.conversationFilter === 'direct' ? 'No direct chats yet.'
            : 'No recent chats yet. Message a friend to get started.';
    const retryButton = appState.conversationLoadState === 'error' && !searchTerm
      ? '<button class="conversation-retry" type="button">Retry</button>'
      : '';
    conversationList.innerHTML = `<li class="conversation-item conversation-empty">${escapeHtml(emptyMessage)}${retryButton}</li>`;
    conversationList.querySelector('.conversation-retry')?.addEventListener('click', () => {
      loadConversations().catch(showChatError);
    });
    return;
  }

  conversationList.innerHTML = conversations
    .map((conversation) => {
      const isUnlocked = appState.unlockedConversationIds.has(conversation.id);
      const isLocked = conversation.isLocked && !isUnlocked;
      const otherUser = conversation.otherUser;
      const isActive = conversation.id === appState.activeConversationId;
      const preview = isLocked ? 'Enter PIN to view this chat'
        : conversation.lastMessage ? (conversation.lastMessage.text || conversation.lastMessage.attachment?.name || 'Attachment') : 'Start chatting';
      const unreadCount = Number(conversation.unreadCount) || 0;
      const timestamp = conversation.lastMessage?.sentAt || conversation.updatedAt;
      const timeLabel = formatConversationTime(timestamp);
      const dateTimeValue = timestamp && !Number.isNaN(Date.parse(timestamp))
        ? new Date(timestamp).toISOString()
        : '';
      return `
        <li class="conversation-item ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}" data-conversation-id="${conversation.id}" role="button" tabindex="0" aria-current="${isActive ? 'true' : 'false'}">
          <div class="conversation-meta">
            <div class="avatar">${isLocked ? '🔒' : otherUser.isGroup ? '👥' : avatarContent(otherUser)}</div>
            <div class="conversation-copy">
              <div class="conversation-heading">
                <div class="conversation-name">${isLocked ? 'Locked chat' : escapeHtml(getDisplayName(otherUser))}</div>
                ${timeLabel ? `<time class="conversation-time" datetime="${dateTimeValue}" title="${escapeHtml(new Date(timestamp).toLocaleString())}">${escapeHtml(timeLabel)}</time>` : ''}
              </div>
              <div class="conversation-preview">${escapeHtml(preview)}</div>
            </div>
          </div>
          ${unreadCount ? `<span class="unread-badge" aria-label="${unreadCount} unread messages">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
          ${!otherUser.isGroup ? `<span class="status-dot ${!isLocked && appState.onlineUserIds.has(otherUser.id) ? 'online' : ''}"></span>` : ''}
        </li>
      `;
    })
    .join('');

  conversationList.querySelectorAll('.conversation-item').forEach((item) => {
    if (!item.dataset.conversationId) return;
    const openChat = () => openConversation(item.dataset.conversationId).catch(showChatError);
    item.addEventListener('click', openChat);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openChat();
      }
    });
  });
}

function syncConversationInfoPanel() {
  const conversation = getConversationMeta(appState.activeConversationId);
  const isOpen = appState.conversationInfoOpen && Boolean(conversation);
  conversationInfoPanel.classList.toggle('hidden', !isOpen);
  chatScreen.classList.toggle('info-open', isOpen);
  conversationInfoButton.classList.toggle('active', isOpen);
  conversationInfoButton.setAttribute('aria-expanded', String(isOpen));
  conversationInfoButton.setAttribute('aria-label', isOpen
    ? 'Hide conversation information'
    : 'Show conversation information');
  conversationInfoButton.disabled = !conversation;
  archiveChatButton.classList.toggle('hidden', !conversation);
  if (!conversation) return;

  const otherUser = conversation.otherUser;
  infoPanelAvatar.innerHTML = otherUser.isGroup ? '👥' : avatarContent(otherUser);
  infoPanelName.textContent = getDisplayName(otherUser);
  infoPanelUsername.textContent = otherUser.isGroup
    ? `${otherUser.memberCount} members`
    : `@${otherUser.username}`;
  infoPanelAbout.textContent = conversation.lastMessage
    ? `Last message: ${conversation.lastMessage.text || conversation.lastMessage.attachment?.name || 'Attachment'}`
    : 'Your private conversation.';
  infoPanelProfileButton.classList.toggle('hidden', Boolean(otherUser.isGroup));
  infoPanelProfileButton.dataset.userId = otherUser.isGroup ? '' : String(otherUser.id);
  const membersSection = document.getElementById('group-members-section');
  membersSection.classList.toggle('hidden', !otherUser.isGroup);
  if (otherUser.isGroup) {
    const list = document.getElementById('group-member-list');
    list.innerHTML = (otherUser.members || []).map((member) => {
      const isOnline = appState.onlineUserIds.has(member.id);
      return `<li><span class="avatar">${avatarContent(member)}</span><span>${escapeHtml(getDisplayName(member))}</span>${isOnline ? '<i>Online</i>' : ''}</li>`;
    }).join('');
    document.getElementById('add-group-members-button').classList.toggle(
      'hidden',
      conversation.createdBy !== appState.currentUser.id
    );
    document.getElementById('add-group-members-button').dataset.conversationId = conversation.id;
  }
  archiveChatButton.textContent = conversation.isArchived ? 'Move to chats' : 'Archive';
  archiveChatButton.setAttribute('aria-label', conversation.isArchived ? 'Move conversation to chats' : 'Archive conversation');
}

function setNavigationView(view) {
  const modalView = view === 'profile' || view === 'settings';
  chatScreen.classList.remove('conversation-open');
  if (!modalView) {
    appState.collectionNavigation = view;
  }
  appState.activeNavigation = view;
  document.querySelectorAll('.navigation-item[data-view]').forEach((button) => {
    const isActive = button.dataset.view === view;
    button.classList.toggle('active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  appState.conversationFilter = 'all';
  syncConversationFilterButtons();

  if (view === 'chats' || view === 'archived') {
    listPanelTitle.textContent = view === 'archived' ? 'Archived Chats' : 'Chats';
    conversationSectionTitle.textContent = view === 'archived' ? 'Archived chats' : 'Recent chats';
    if (view === 'chats') appState.conversationFilter = 'all';
    syncConversationFilterButtons();
    conversationView.classList.remove('hidden');
    friendsView.classList.add('hidden');
    conversationSearchWrap.classList.remove('hidden');
    userSearchWrap.classList.add('hidden');
    conversationFilters.classList.toggle('hidden', view === 'archived');
    document.getElementById('create-group-button').classList.toggle('hidden', view !== 'chats');
    loadConversations({ autoSelect: false }).catch(showChatError);
  } else if (view === 'groups') {
    listPanelTitle.textContent = 'Groups';
    conversationSectionTitle.textContent = 'Your groups';
    appState.conversationFilter = 'groups';
    syncConversationFilterButtons();
    conversationView.classList.remove('hidden');
    friendsView.classList.add('hidden');
    conversationSearchWrap.classList.remove('hidden');
    userSearchWrap.classList.add('hidden');
    conversationFilters.classList.remove('hidden');
    document.getElementById('create-group-button').classList.remove('hidden');
    loadConversations({ autoSelect: false }).catch(showChatError);
  } else if (view === 'friends') {
    listPanelTitle.textContent = 'Friends';
    conversationSectionTitle.textContent = 'Friends';
    conversationView.classList.add('hidden');
    friendsView.classList.remove('hidden');
    conversationSearchWrap.classList.add('hidden');
    userSearchWrap.classList.remove('hidden');
    conversationFilters.classList.add('hidden');
    document.getElementById('create-group-button').classList.add('hidden');
    renderPeople();
  } else {
    openProfileSettings();
  }
}

function setChatEmptyState(title = 'Select a conversation', status = 'Choose someone to start chatting') {
  appState.activeConversationId = null;
  chatScreen.classList.remove('conversation-open');
  appState.activeMessages = [];
  chatTitle.textContent = title;
  chatStatus.textContent = status;
  chatStatus.classList.remove('error');
  chatContactAvatar.textContent = '∞';
  viewChatProfileButton.classList.add('hidden');
  appState.conversationInfoOpen = false;
  syncConversationInfoPanel();
  messageInput.disabled = true;
  sendButton.disabled = true;
  messageInput.value = '';
  messageSearchInput.value = '';
  appState.pendingAttachment = null;
  attachmentInput.value = '';
  attachmentPreview.classList.add('hidden');
  typingIndicator.classList.add('hidden');
  messagesContainer.innerHTML = '';
  renderConversations();
  syncConversationInfoPanel();
}

function showChatError(error) {
  const message = error.message || 'Could not open this conversation. Please try again.';
  chatStatus.textContent = message;
  chatStatus.classList.add('error');
  if (messagesContainer.querySelector('.loading-state')) {
    messagesContainer.innerHTML = '<div class="empty-state">Could not load messages. Try opening the conversation again.</div>';
  }
  if (error.code && error.code !== 'API_ERROR') {
    console.warn('Infinity Chat request failed:', {
      code: error.code,
      status: error.status,
      message
    });
  }
  showToast(message);
}

async function openConversation(conversationId) {
  const conversation = getConversationMeta(conversationId);
  if (!conversation) return;

  if (conversation.isLocked && !appState.unlockedConversationIds.has(conversationId)) {
    showChatPinDialog(conversationId);
    return;
  }

  await switchToConversation(conversationId);
}

async function switchToConversation(conversationId) {
  if (appState.recording) {
    appState.recording.recorder.stop();
  }
  const previousId = appState.activeConversationId;
  if (previousId && previousId !== conversationId) {
    socket.emit('leave-conversation', previousId);
    if (appState.unlockedConversationIds.has(previousId)) {
      await api(`/api/conversations/${previousId}/relock`, { method: 'POST' });
      appState.unlockedConversationIds.delete(previousId);
    }
  }

  appState.activeConversationId = conversationId;
  chatScreen.classList.add('conversation-open');
  messageSearchInput.value = '';
  appState.pendingAttachment = null;
  attachmentInput.value = '';
  attachmentPreview.classList.add('hidden');
  attachmentPreview.textContent = '';
  localStorage.setItem(activeConversationStorageKey(), conversationId);
  renderConversations();
  syncConversationInfoPanel();
  chatStatus.textContent = 'Loading messages…';
  messagesContainer.innerHTML = '<div class="loading-state" role="status">Loading messages…</div>';
  await loadMessages(conversationId);
  socket.emit('join-conversation', conversationId);
}

function showChatPinDialog(conversationId) {
  pendingChatPinAction = { conversationId };
  chatPinError.textContent = '';
  chatPinError.classList.add('hidden');
  chatPinInput.value = '';
  chatPinInput.autocomplete = 'off';
  chatPinDialog.showModal();
  chatPinInput.focus();
}

async function submitChatPin(event) {
  event.preventDefault();
  if (!pendingChatPinAction) return;
  const { conversationId } = pendingChatPinAction;
  const pin = chatPinInput.value;
  if (!/^\d{6,12}$/.test(pin)) {
    chatPinError.textContent = 'Enter a PIN with 6 to 12 digits.';
    chatPinError.classList.remove('hidden');
    chatPinInput.focus();
    return;
  }

  chatPinSubmitButton.disabled = true;
  chatPinError.classList.add('hidden');
  try {
    const { conversation } = await api(`/api/conversations/${conversationId}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ pin })
    });
    appState.unlockedConversationIds.add(conversationId);
    appState.conversations = appState.conversations.map((item) => (
      item.id === conversationId ? conversation : item
    ));
    chatPinDialog.close();
    pendingChatPinAction = null;
    renderConversations();
    await switchToConversation(conversationId);
  } catch (error) {
    chatPinError.textContent = error.message;
    chatPinError.classList.remove('hidden');
  } finally {
    chatPinSubmitButton.disabled = false;
  }
}

function renderMessages(messages = []) {
  const searchTerm = messageSearchInput.value.trim().toLowerCase();
  const visibleMessages = messages.filter((message) => {
    const text = String(message.text || '');
    const attachmentName = String(message.attachment?.name || '');
    return !searchTerm
      || text.toLowerCase().includes(searchTerm)
      || attachmentName.toLowerCase().includes(searchTerm);
  });
  if (!visibleMessages.length && searchTerm) {
    messagesContainer.innerHTML = '<div class="empty-state">No messages match your search.</div>';
    return;
  }
  if (!visibleMessages.length) {
    messagesContainer.innerHTML = '<div class="empty-state">No messages yet. Say hello to get started.</div>';
    return;
  }
  let previousDate = '';
  messagesContainer.innerHTML = visibleMessages
    .map((message) => {
      const isFromCurrentUser = Number(message.senderId) === Number(appState.currentUser.id);
      const sentAt = new Date(message.sentAt);
      const dateKey = Number.isNaN(sentAt.getTime()) ? '' : sentAt.toDateString();
      const dateDivider = dateKey && dateKey !== previousDate
        ? `<div class="message-date-divider"><span>${escapeHtml(sentAt.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}</span></div>`
        : '';
      previousDate = dateKey;
      const attachment = message.attachment;
      let attachmentHtml = '';
      if (attachment?.type.startsWith('image/')) {
        attachmentHtml = `<a class="message-attachment" href="${escapeHtml(attachment.data)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(attachment.data)}" alt="${escapeHtml(attachment.name)}" loading="lazy" /></a>`;
      } else if (attachment?.type.startsWith('audio/')) {
        attachmentHtml = `<audio class="message-audio" controls preload="metadata" src="${escapeHtml(attachment.data)}"></audio>`;
      } else if (attachment) {
        attachmentHtml = `<a class="message-file" href="${escapeHtml(attachment.data)}" download="${escapeHtml(attachment.name)}" rel="noopener noreferrer"><span aria-hidden="true">▧</span>${escapeHtml(attachment.name)}</a>`;
      }
      const reactions = (message.reactions || []).map((reaction) => `
        <button class="reaction-chip ${reaction.reacted ? 'reacted' : ''}" type="button" data-message-id="${escapeHtml(message.id)}" data-emoji="${escapeHtml(reaction.emoji)}" aria-label="${reaction.count} ${escapeHtml(reaction.emoji)} reactions">${escapeHtml(reaction.emoji)} ${reaction.count}</button>
      `).join('');
      return `
        ${dateDivider}
        <div class="message-bubble ${isFromCurrentUser ? 'self' : 'other'}" data-message-id="${escapeHtml(message.id)}">
          <div class="message-meta">${escapeHtml(message.senderUsername)} • ${new Date(message.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
          ${message.text ? `<div class="message-content">${escapeHtml(message.text)}</div>` : ''}
          ${attachmentHtml}
          <div class="message-actions">
            <div class="message-reactions">${reactions}</div>
            <div class="message-tools">
              <button class="add-reaction-button" type="button" data-message-id="${escapeHtml(message.id)}" aria-label="React to message">☺</button>
              <div class="reaction-picker hidden">${['❤️', '👍', '😂', '😮', '😢', '🔥', '👏'].map((emoji) => `<button class="reaction-option" type="button" data-message-id="${escapeHtml(message.id)}" data-emoji="${emoji}" aria-label="React ${emoji}">${emoji}</button>`).join('')}</div>
              ${isFromCurrentUser ? `<button class="delete-message-button" type="button" data-message-id="${escapeHtml(message.id)}" aria-label="Delete your message">×</button>` : ''}
            </div>
          </div>
          ${isFromCurrentUser ? `<div class="message-receipt">${message.readAt ? 'Seen' : 'Delivered'}</div>` : ''}
        </div>
      `;
    })
    .join('');

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  messagesContainer.querySelectorAll('.add-reaction-button, .reaction-chip').forEach((button) => {
    button.addEventListener('click', () => {
      if (!button.dataset.emoji) {
        const picker = button.closest('.message-actions')?.querySelector('.reaction-picker');
        picker?.classList.toggle('hidden');
        return;
      }
      const emoji = button.dataset.emoji;
      toggleMessageReaction(button.dataset.messageId, emoji).catch((error) => showToast(error.message));
    });
  });
  messagesContainer.querySelectorAll('.reaction-option').forEach((button) => {
    button.addEventListener('click', () => {
      toggleMessageReaction(button.dataset.messageId, button.dataset.emoji)
        .catch((error) => showToast(error.message));
    });
  });
  messagesContainer.querySelectorAll('.delete-message-button').forEach((button) => {
    button.addEventListener('click', () => {
      deleteMessage(button.dataset.messageId).catch((error) => showToast(error.message));
    });
  });
}

function updateTypingIndicator() {
  if (appState.typingUsers.size === 0) {
    typingIndicator.classList.add('hidden');
    typingIndicator.textContent = 'Typing...';
    return;
  }

  typingIndicator.classList.remove('hidden');
  const names = Array.from(appState.typingUsers.values()).slice(0, 2).join(', ');
  typingIndicator.textContent = `${names} ${appState.typingUsers.size > 1 ? 'are' : 'is'} typing...`;
}

async function toggleMessageReaction(messageId, emoji) {
  const { reactions } = await api(`/api/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji })
  });
  const message = appState.activeMessages.find((item) => item.id === messageId);
  if (message) {
    message.reactions = reactions;
    renderMessages(appState.activeMessages);
  }
}

async function deleteMessage(messageId) {
  if (!confirm('Delete this message for everyone in the conversation?')) return;
  await api(`/api/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
  appState.activeMessages = appState.activeMessages.filter((message) => message.id !== messageId);
  renderMessages(appState.activeMessages);
  await loadConversations({ autoSelect: false });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read that file.'));
    });
    reader.addEventListener('error', () => reject(new Error('Could not read that file.')));
    reader.readAsDataURL(file);
  });
}

async function setPendingAttachment(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    showToast('Attachments must be 8 MB or smaller.');
    return false;
  }
  const mimeType = file.type.split(';', 1)[0].trim().toLowerCase();
  const supported = new Set([
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'
  ]);
  if (!supported.has(mimeType)) {
    showToast('That file type is not supported.');
    return false;
  }
  attachmentPreview.textContent = 'Preparing attachment…';
  attachmentPreview.classList.remove('hidden');
  try {
    appState.pendingAttachment = {
      data: await readFileAsDataUrl(file),
      name: file.name || 'Voice message',
      type: mimeType
    };
    attachmentPreview.innerHTML = `
      ${mimeType.startsWith('image/')
        ? `<img class="attachment-preview-image" src="${escapeHtml(appState.pendingAttachment.data)}" alt="Preview of ${escapeHtml(file.name)}" />`
        : mimeType.startsWith('audio/')
          ? `<div class="voice-attachment-preview"><span>Voice message ready</span><audio controls preload="metadata" src="${escapeHtml(appState.pendingAttachment.data)}"></audio></div>`
          : `<span>${escapeHtml(file.name)}</span>`}
      <button id="remove-attachment-button" type="button" aria-label="Remove attachment">×</button>
    `;
    document.getElementById('remove-attachment-button').addEventListener('click', () => {
      appState.pendingAttachment = null;
      attachmentPreview.classList.add('hidden');
      attachmentInput.value = '';
    });
    return true;
  } catch (error) {
    appState.pendingAttachment = null;
    attachmentPreview.classList.add('hidden');
    showToast(error.message);
    return false;
  }
}

function openGroupDialog(mode, conversationId = null) {
  groupDialogMode = mode;
  groupDialogConversationId = conversationId;
  groupDialogError.textContent = '';
  groupDialogError.classList.add('hidden');
  const isAdding = mode === 'add';
  document.getElementById('group-dialog-title').textContent = isAdding ? 'Add people' : 'Create a group';
  document.querySelector('label[for="group-name-input"]').classList.toggle('hidden', isAdding);
  document.getElementById('group-name-input').classList.toggle('hidden', isAdding);
  document.getElementById('group-name-input').required = !isAdding;
  document.getElementById('submit-group-button').textContent = isAdding ? 'Add members' : 'Create group';
  const conversation = isAdding ? getConversationMeta(conversationId) : null;
  const existingIds = new Set((conversation?.otherUser.members || []).map((member) => member.id));
  const availableUsers = appState.users.filter((user) => user.id !== appState.currentUser.id && !existingIds.has(user.id));
  groupPeopleList.innerHTML = availableUsers.length
    ? availableUsers.map((user) => `
      <label class="group-person-option">
        <input type="checkbox" value="${user.id}" />
        <span class="avatar">${avatarContent(user)}</span>
        <span><strong>${escapeHtml(getDisplayName(user))}</strong><small>@${escapeHtml(user.username)}</small></span>
      </label>
    `).join('')
    : '<p class="empty-state">Everyone is already in this group.</p>';
  groupDialog.showModal();
}

async function submitGroupForm(event) {
  event.preventDefault();
  const selectedIds = Array.from(groupPeopleList.querySelectorAll('input:checked'))
    .map((input) => Number(input.value));
  const isAdding = groupDialogMode === 'add';
  if (!selectedIds.length) {
    groupDialogError.textContent = 'Choose at least one person.';
    groupDialogError.classList.remove('hidden');
    return;
  }
  const submitButton = document.getElementById('submit-group-button');
  submitButton.disabled = true;
  try {
    const result = isAdding
      ? await api(`/api/conversations/${encodeURIComponent(groupDialogConversationId)}/members`, {
        method: 'POST',
        body: JSON.stringify({ memberIds: selectedIds })
      })
      : await api('/api/groups', {
        method: 'POST',
        body: JSON.stringify({ name: document.getElementById('group-name-input').value.trim(), memberIds: selectedIds })
      });
    if (isAdding) {
      appState.conversations = appState.conversations.map((conversation) => (
        conversation.id === result.conversation.id ? result.conversation : conversation
      ));
      syncConversationInfoPanel();
    } else {
      appState.conversations.unshift(result.conversation);
    }
    groupDialog.close();
    renderConversations();
    if (!isAdding) {
      setNavigationView('chats');
      await switchToConversation(result.conversation.id);
      showToast('Group created.', 'success');
    } else {
      showToast('Group members added.', 'success');
    }
  } catch (error) {
    groupDialogError.textContent = error.message;
    groupDialogError.classList.remove('hidden');
  } finally {
    submitButton.disabled = false;
  }
}

async function toggleVoiceRecording() {
  if (appState.recording) {
    appState.recording.recorder.stop();
    voiceMessageButton.disabled = true;
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    showToast('Voice recording is not supported by this browser.');
    return;
  }
  voiceMessageButton.disabled = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    const recording = {
      recorder,
      conversationId: appState.activeConversationId,
      startedAt: Date.now(),
      cancelled: false,
      timerInterval: null
    };
    recorder.addEventListener('stop', async () => {
      stream.getTracks().forEach((track) => track.stop());
      clearInterval(recording.timerInterval);
      if (appState.recording === recording) appState.recording = null;
      voiceMessageButton.disabled = false;
      voiceMessageButton.innerHTML = voiceMessageIcon;
      voiceMessageButton.setAttribute('aria-label', 'Record voice message');
      voiceMessageButton.title = 'Record voice message';
      voiceMessageButton.classList.remove('recording');
      recordingIndicator.classList.add('hidden');
      if (recording.cancelled) return;
      if (recording.conversationId !== appState.activeConversationId) {
        showToast('Voice recording discarded because you switched conversations.');
        return;
      }
      const recordedMimeType = (recorder.mimeType || preferredType || 'audio/webm')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      const blob = new Blob(chunks, { type: recordedMimeType });
      if (!blob.size) {
        showToast('No audio was recorded. Please try again.');
        return;
      }
      const extension = recordedMimeType === 'audio/mp4' ? 'm4a'
        : recordedMimeType === 'audio/ogg' ? 'ogg'
          : recordedMimeType === 'audio/mpeg' ? 'mp3' : 'webm';
      const ready = await setPendingAttachment(new File(
        [blob],
        `voice-message.${extension}`,
        { type: recordedMimeType }
      ));
      if (ready) showToast('Voice message ready to send.', 'success');
    });
    recorder.start();
    appState.recording = recording;
    const updateRecordingTimer = () => {
      const elapsedSeconds = Math.floor((Date.now() - recording.startedAt) / 1000);
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = String(elapsedSeconds % 60).padStart(2, '0');
      recordingTimer.textContent = `Recording ${minutes}:${seconds}`;
    };
    updateRecordingTimer();
    recording.timerInterval = setInterval(updateRecordingTimer, 1000);
    recordingIndicator.classList.remove('hidden');
    voiceMessageButton.disabled = false;
    voiceMessageButton.textContent = '■';
    voiceMessageButton.setAttribute('aria-label', 'Stop recording and preview voice message');
    voiceMessageButton.title = 'Stop recording and preview';
    voiceMessageButton.classList.add('recording');
    showToast('Recording… select stop when you are done.', 'success');
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    appState.recording = null;
    voiceMessageButton.disabled = false;
    voiceMessageButton.innerHTML = voiceMessageIcon;
    voiceMessageButton.setAttribute('aria-label', 'Record voice message');
    voiceMessageButton.title = 'Record voice message';
    voiceMessageButton.classList.remove('recording');
    recordingIndicator.classList.add('hidden');
    showToast(error.name === 'NotAllowedError'
      ? 'Microphone permission was denied. Allow microphone access in your browser settings.'
      : `Could not start voice recording: ${error.message}`);
  }
}

async function sendCurrentMessage() {
  const conversationId = appState.activeConversationId;
  if (!conversationId) return;
  const text = messageInput.value.trim();
  const attachment = appState.pendingAttachment;
  if (!text && !attachment) return;

  sendButton.disabled = true;
  try {
    const payload = await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ conversationId, text, attachment })
    });

    if (appState.activeConversationId !== conversationId) return;
    messageInput.value = '';
    messageInput.style.height = '';
    appState.pendingAttachment = null;
    attachmentInput.value = '';
    attachmentPreview.classList.add('hidden');
    attachmentPreview.textContent = '';
    socket.emit('stop-typing', conversationId);
    const existing = getConversationMeta(conversationId);
    if (existing) {
      existing.lastMessage = payload.message;
      existing.unreadCount = 0;
      appState.conversations = [
        existing,
        ...appState.conversations.filter((conversation) => conversation.id !== conversationId)
      ];
      renderConversations();
    }
    await loadMessages(conversationId);
  } catch (error) {
    showChatError(error);
  } finally {
    sendButton.disabled = !appState.activeConversationId;
  }
}

async function loadUsers() {
  const requestId = ++userSearchRequest;
  if (!appState.users.length) {
    appState.usersLoadState = 'loading';
    renderPeople();
  }
  try {
    const { users } = await api('/api/users');
    if (requestId !== userSearchRequest) return;
    appState.users = users;
    appState.usersLoadState = 'loaded';
    renderPeople();
  } catch (error) {
    if (requestId === userSearchRequest) {
      appState.usersLoadState = 'error';
      renderPeople();
    }
    throw error;
  }
}

async function searchUsers() {
  const requestId = ++userSearchRequest;
  const search = userSearchInput.value.trim().replace(/^@+/, '');
  if (!appState.users.length) {
    appState.usersLoadState = 'loading';
    renderPeople();
  }
  try {
    const { users } = await api(`/api/users${search ? `?search=${encodeURIComponent(search)}` : ''}`);
    if (requestId !== userSearchRequest) return;
    appState.users = users;
    appState.usersLoadState = 'loaded';
    renderPeople();
  } catch (error) {
    if (requestId === userSearchRequest) {
      appState.usersLoadState = 'error';
      renderPeople();
    }
    throw error;
  }
}

async function loadConversations({ autoSelect = true } = {}) {
  const requestId = ++conversationLoadRequest;
  const existingConversations = new Map(appState.conversations.map((conversation) => [conversation.id, conversation]));
  if (!appState.conversations.length) {
    appState.conversationLoadState = 'loading';
    renderConversations();
  }
  try {
    const { conversations } = await api('/api/conversations');
    if (requestId !== conversationLoadRequest) return;
    appState.conversations = conversations.map((conversation) => {
      const previous = existingConversations.get(conversation.id);
      return conversation.isLocked && appState.unlockedConversationIds.has(conversation.id) && previous
        ? { ...conversation, otherUser: previous.otherUser, lastMessage: previous.lastMessage }
        : conversation;
    }).sort((a, b) => conversationTimestamp(b) - conversationTimestamp(a));
    appState.conversationLoadState = 'loaded';
  } catch (error) {
    if (requestId === conversationLoadRequest) {
      appState.conversationLoadState = 'error';
      renderConversations();
    }
    throw error;
  }
  renderConversations();
  syncConversationInfoPanel();

  if (autoSelect && !appState.activeConversationId && appState.conversations.length) {
    const firstUnlockedConversation = appState.conversations.find((conversation) => (
      (!conversation.isLocked || appState.unlockedConversationIds.has(conversation.id))
      && !conversation.isArchived
    ));
    if (firstUnlockedConversation) {
      await switchToConversation(firstUnlockedConversation.id);
    }
  }
}

async function startConversation(userId) {
  const { conversation } = await api('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ userId })
  });

  const existingIndex = appState.conversations.findIndex((item) => item.id === conversation.id);
  if (existingIndex < 0) {
    appState.conversations.unshift(conversation);
  } else {
    appState.conversations[existingIndex] = conversation;
  }
  renderConversations();
  setNavigationView('chats');
  await openConversation(conversation.id);
}

async function loadMessages(conversationId) {
  const { messages } = await api(`/api/conversations/${conversationId}/messages`);
  if (conversationId !== appState.activeConversationId) return;
  appState.activeMessages = messages;
  messageInput.disabled = false;
  sendButton.disabled = false;
  renderMessages(messages);

  const conversation = getConversationMeta(conversationId);
  if (conversation?.otherUser) {
    const otherUser = conversation.otherUser;
    chatTitle.textContent = getDisplayName(otherUser);
    chatContactAvatar.innerHTML = otherUser.isGroup ? '👥' : avatarContent(otherUser);
    chatStatus.textContent = otherUser.isGroup
      ? `${otherUser.memberCount} members`
      : appState.onlineUserIds.has(otherUser.id) ? 'Online now' : 'Offline';
    chatStatus.classList.remove('error');
    viewChatProfileButton.classList.toggle('hidden', Boolean(otherUser.isGroup));
    viewChatProfileButton.dataset.userId = String(otherUser.id);
    messageSearchInput.classList.remove('hidden');
    syncConversationInfoPanel();
  }

  if (document.visibilityState === 'visible') {
    try {
      const { messageIds, readAt } = await api(`/api/conversations/${conversationId}/read`, { method: 'POST' });
      if (conversationId !== appState.activeConversationId) return;
      const seenIds = new Set(messageIds);
      appState.activeMessages = appState.activeMessages.map((message) => (
        seenIds.has(message.id) ? { ...message, readAt } : message
      ));
      if (conversation) {
        conversation.unreadCount = 0;
        renderConversations();
      }
      renderMessages(appState.activeMessages);
    } catch (error) {
      showToast(`Messages loaded, but read status could not be updated: ${error.message}`);
    }
  }
}

function previewProfileImage(profileImage) {
  profilePhotoPreview.innerHTML = profileImage
    ? `<img src="${escapeHtml(profileImage)}" alt="" />`
    : escapeHtml(getDisplayName(appState.currentUser).charAt(0).toUpperCase() || '?');
  uploadProfilePhoto.classList.toggle('hidden', Boolean(profileImage));
  changeProfilePhoto.classList.toggle('hidden', !profileImage);
  document.getElementById('remove-profile-photo').classList.toggle('hidden', !profileImage);
}

function isValidDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function dateToInputValue(dateText) {
  const displayMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateText);
  const inputValue = displayMatch
    ? `${displayMatch[3]}-${displayMatch[2]}-${displayMatch[1]}`
    : dateText;
  return isValidDateOnly(inputValue) ? inputValue : '';
}

function getLocalDateOnly() {
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function syncProfileDateControls() {
  const hasDate = Boolean(profileDateOfBirth.value);
  profileDatePlaceholder.classList.toggle('hidden', hasDate);
  clearProfileDateButton.classList.toggle('hidden', !hasDate);
}

function syncCustomGenderField() {
  const showCustom = profileGender.value === 'custom';
  profileCustomGender.classList.toggle('hidden', !showCustom);
}

function populateProfileForm() {
  if (!appState.currentUser) return;
  const user = appState.currentUser;
  editingProfileImage = user.profileImage || null;
  profileDisplayName.value = user.displayName || user.username;
  profileNickname.value = user.nickname || '';
  profileDateOfBirth.value = dateToInputValue(user.dateOfBirth || '');
  profileDateOfBirth.max = getLocalDateOnly();
  syncProfileDateControls();
  const gender = ({ woman: 'female', man: 'male', transgender: 'custom' })[user.gender] || user.gender || '';
  profileGender.value = gender;
  profileCustomGender.value = user.customGender || (user.gender === 'transgender' ? 'Transgender' : '');
  syncCustomGenderField();
  const visibility = user.fieldVisibility || {};
  Object.entries(profileFieldVisibility).forEach(([field, control]) => {
    control.value = visibility[field] || (user.profilePrivate === false ? 'public' : 'private');
  });
  profilePhotoInput.value = '';
  pendingPhotoProcessing = null;
  profileError.textContent = '';
  profileError.classList.add('hidden');
  previewProfileImage(editingProfileImage);
}

function openProfileSettings() {
  if (!appState.currentUser) return;
  populateProfileForm();
  profileDialog.showModal();
}

function resizeProfileImage(file) {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(new Error('Choose a JPEG, PNG, or WebP image.'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('Choose an image smaller than 5 MB.'));
      return;
    }

    createImageBitmap(file).then((bitmap) => {
      if (bitmap.width > 4096 || bitmap.height > 4096) {
        bitmap.close();
        reject(new Error('Choose an image with dimensions no larger than 4096 × 4096.'));
        return;
      }

      const size = 256;
      const cropSize = Math.min(bitmap.width, bitmap.height);
      const sourceX = (bitmap.width - cropSize) / 2;
      const sourceY = (bitmap.height - cropSize) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) {
        bitmap.close();
        reject(new Error('Your browser could not process this image.'));
        return;
      }
      context.drawImage(bitmap, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);
      bitmap.close();

      const imageData = canvas.toDataURL('image/jpeg', 0.82);
      const imageBytes = Math.ceil((imageData.length - 'data:image/jpeg;base64,'.length) * 3 / 4);
      if (imageBytes > 512 * 1024) {
        reject(new Error('The resized photo is too large. Choose another image.'));
        return;
      }
      resolve(imageData);
    }).catch(() => reject(new Error('Could not open this image. Choose a different file.')));
  });
}

async function saveProfile(event) {
  event.preventDefault();
  const fullName = profileDisplayName.value.trim();
  const nickname = profileNickname.value.trim();
  const dateOfBirth = profileDateOfBirth.value.trim();
  profileError.classList.add('hidden');

  if (!fullName || fullName.length > 40) {
    profileError.textContent = 'Full Name must be between 1 and 40 characters.';
    profileError.classList.remove('hidden');
    profileDisplayName.focus();
    return;
  }

  if (nickname.length > 32) {
    profileError.textContent = 'Nickname must be 32 characters or fewer.';
    profileError.classList.remove('hidden');
    profileNickname.focus();
    return;
  }

  if (dateOfBirth && (!isValidDateOnly(dateOfBirth) || dateOfBirth > profileDateOfBirth.max)) {
    profileError.textContent = 'Choose a valid date of birth that is not in the future.';
    profileError.classList.remove('hidden');
    profileDateOfBirth.focus();
    return;
  }

  profileSaveButton.disabled = true;
  profileSaveButton.querySelector('.profile-save-label').textContent = 'Saving…';
  profileSaveButton.querySelector('.profile-save-loading').classList.remove('hidden');
  try {
    if (pendingPhotoProcessing) {
      await pendingPhotoProcessing;
    }
    const { user } = await api('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        fullName,
        nickname,
        dateOfBirth,
        dateOfBirthTimezoneOffsetMinutes: new Date().getTimezoneOffset(),
        gender: profileGender.value,
        customGender: profileCustomGender.value.trim(),
        profileImage: editingProfileImage,
        fieldVisibility: Object.fromEntries(
          Object.entries(profileFieldVisibility).map(([field, control]) => [field, control.value])
        )
      })
    });
    appState.currentUser = user;
    renderCurrentUser();
    profileDialog.close();
    profileSaveNotice.textContent = 'Profile saved successfully.';
    profileSaveNotice.classList.remove('hidden');
    clearTimeout(profileSaveNoticeTimeout);
    profileSaveNoticeTimeout = setTimeout(() => profileSaveNotice.classList.add('hidden'), 3500);
  } catch (error) {
    profileError.textContent = error.message;
    profileError.classList.remove('hidden');
    showToast(error.message);
  } finally {
    profileSaveButton.disabled = false;
    profileSaveButton.querySelector('.profile-save-label').textContent = 'Save Changes';
    profileSaveButton.querySelector('.profile-save-loading').classList.add('hidden');
  }

  if (!profileDialog.open) {
    try {
      await Promise.all([loadUsers(), loadConversations()]);
      if (appState.activeConversationId) {
        await loadMessages(appState.activeConversationId);
      }
    } catch (error) {
      showChatError(new Error(`Profile saved, but chat data could not be refreshed: ${error.message}`));
    }
  }
}

async function handleLogin(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton?.disabled) return;
  if (submitButton) submitButton.disabled = true;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  setAuthError('');

  try {
    const result = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    appState.currentUser = result.user;
    renderCurrentUser();
    toggleAuthScreen();
    socket.connect();
    try {
      await bootstrapDashboard();
    } catch (error) {
      showChatError(new Error(`You are signed in, but the chat could not finish loading. ${error.message}`));
    }
  } catch (error) {
    if (appState.currentUser) {
      showChatError(error);
    } else {
      setAuthError(error.message);
    }
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function handleRegister(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton?.disabled) return;
  if (submitButton) submitButton.disabled = true;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  setAuthError('');

  try {
    const result = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    appState.currentUser = result.user;
    renderCurrentUser();
    toggleAuthScreen();
    socket.connect();
    try {
      await bootstrapDashboard();
    } catch (error) {
      showChatError(new Error(`Your account is ready, but the chat could not finish loading. ${error.message}`));
    }
  } catch (error) {
    if (appState.currentUser) {
      showChatError(error);
    } else {
      setAuthError(error.message);
    }
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function logout() {
  logoutButton.disabled = true;
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (error) {
    showChatError(new Error(`Could not log out. Your session is still active. ${error.message}`));
    return;
  } finally {
    logoutButton.disabled = false;
  }

  socket.disconnect();
  appState.currentUser = null;
  appState.activeConversationId = null;
  appState.activeNavigation = 'chats';
  appState.collectionNavigation = 'chats';
  appState.conversationInfoOpen = false;
  appState.activeMessages = [];
  appState.conversations = [];
  appState.conversationLoadState = 'idle';
  appState.users = [];
  appState.unlockedConversationIds.clear();
  userSearchInput.value = '';
  appState.typingUsers.clear();
  appState.processedUnreadMessageIds.clear();
  conversationSearchInput.value = '';
  document.querySelectorAll('.navigation-item[data-view]').forEach((button) => {
    const isActive = button.dataset.view === 'chats';
    button.classList.toggle('active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  syncConversationInfoPanel();
  updateTypingIndicator();
  renderMessages([]);
  renderPeople();
  renderConversations();
  toggleAuthScreen();
}

async function bootstrapDashboard() {
  appState.activeNavigation = 'chats';
  appState.collectionNavigation = 'chats';
  appState.conversationInfoOpen = false;
  appState.conversationLoadState = 'loading';
  renderConversations();
  document.querySelectorAll('.navigation-item[data-view]').forEach((button) => {
    const isActive = button.dataset.view === 'chats';
    button.classList.toggle('active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.getElementById('create-group-button').classList.remove('hidden');
  appState.unlockedConversationIds.clear();
  await api('/api/chat-security/reset', { method: 'POST' });
  const [usersResult, conversationsResult] = await Promise.allSettled([
    loadUsers(),
    loadConversations({ autoSelect: false })
  ]);
  if (usersResult.status === 'rejected') showChatError(usersResult.reason);
  if (conversationsResult.status === 'rejected') throw conversationsResult.reason;
  const rememberedConversationId = localStorage.getItem(activeConversationStorageKey());
  const rememberedConversation = appState.conversations.find((conversation) => (
    conversation.id === rememberedConversationId && !conversation.isLocked && !conversation.isArchived
  ));
  const mostRecentUnlockedConversation = appState.conversations.find((conversation) => (
    !conversation.isLocked && !conversation.isArchived
  ));
  appState.activeConversationId = (rememberedConversation || mostRecentUnlockedConversation)?.id || null;
  chatScreen.classList.toggle('conversation-open', Boolean(appState.activeConversationId));
  renderConversations();
  syncConversationInfoPanel();
  if (appState.activeConversationId) {
    await loadMessages(appState.activeConversationId);
    socket.emit('join-conversation', appState.activeConversationId);
  } else {
    setChatEmptyState();
  }
}

async function loadSession() {
  try {
    const response = await api('/api/me');
    appState.currentUser = response.user;
    renderCurrentUser();
    toggleAuthScreen();
    socket.connect();
  } catch (error) {
    if (error.message !== 'Not authenticated' && error.message !== 'Unauthorized') {
      setAuthError(error.message);
      return;
    }
    appState.currentUser = null;
    toggleAuthScreen();
    return;
  }

  try {
    await bootstrapDashboard();
  } catch (error) {
    console.error('Your session is active, but the chat dashboard could not be loaded:', error);
    showChatError(new Error(`You are signed in, but the chat could not be loaded: ${error.message}`));
  }
}

function attachEventHandlers() {
  document.querySelectorAll('.password-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const passwordInput = button.closest('.password-input-wrap')?.querySelector('input');
      if (!passwordInput) return;

      const isVisible = passwordInput.type === 'text';
      passwordInput.type = isVisible ? 'password' : 'text';
      button.textContent = isVisible ? 'Show' : 'Hide';
      button.setAttribute('aria-label', `${isVisible ? 'Show' : 'Hide'} password`);
      button.setAttribute('aria-pressed', String(!isVisible));
    });
  });

  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      setAuthError('');
      document.querySelectorAll('.tab-button').forEach((item) => item.classList.toggle('active', item === button));
      const tab = button.dataset.tab;
      loginForm.classList.toggle('active', tab === 'login');
      registerForm.classList.toggle('active', tab === 'register');
    });
  });

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    handleLogin(loginForm);
  });

  registerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    handleRegister(registerForm);
  });

  userSearchInput.addEventListener('input', () => {
    searchUsers().catch(showChatError);
  });
  clearUserSearch.addEventListener('click', () => {
    userSearchInput.value = '';
    searchUsers().catch(showChatError);
    userSearchInput.focus();
  });

  sendButton.addEventListener('click', sendCurrentMessage);
  document.getElementById('attach-file-button').addEventListener('click', () => attachmentInput.click());
  attachmentInput.addEventListener('change', () => {
    const [file] = attachmentInput.files || [];
    setPendingAttachment(file);
  });
  document.getElementById('emoji-button').addEventListener('click', () => {
    emojiPicker.classList.toggle('hidden');
    document.getElementById('emoji-button').setAttribute('aria-expanded', String(!emojiPicker.classList.contains('hidden')));
  });
  const composerEmojis = ['😀', '😄', '😊', '😍', '🥰', '😂', '😉', '🙂', '🤔', '😎', '😭', '🙌', '👏', '👍', '❤️', '🔥', '🎉', '✨', '🙏', '💜', '💙', '🌸', '☀️', '💬'];
  emojiPicker.innerHTML = composerEmojis.map((emoji) => (
    `<button type="button" class="emoji-picker-option" data-emoji="${emoji}" aria-label="Insert ${emoji}">${emoji}</button>`
  )).join('');
  emojiPicker.addEventListener('click', (event) => {
    const button = event.target.closest('.emoji-picker-option');
    if (!button) return;
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    messageInput.setRangeText(button.dataset.emoji, start, end, 'end');
    messageInput.dispatchEvent(new Event('input', { bubbles: true }));
    messageInput.focus();
  });
  voiceMessageButton.addEventListener('click', toggleVoiceRecording);
  document.getElementById('cancel-voice-recording').addEventListener('click', () => {
    if (!appState.recording) return;
    appState.recording.cancelled = true;
    appState.recording.recorder.stop();
    showToast('Voice recording cancelled.', 'success');
  });
  messageSearchInput.addEventListener('input', () => renderMessages(appState.activeMessages));

  messageInput.addEventListener('input', () => {
    if (!appState.activeConversationId) return;
    if (messageInput.value.trim()) {
      socket.emit('typing', appState.activeConversationId);
    } else {
      socket.emit('stop-typing', appState.activeConversationId);
    }
  });

  messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 140)}px`;
  });

  logoutButton.addEventListener('click', logout);
  document.querySelectorAll('.navigation-item[data-view]').forEach((button) => {
    button.addEventListener('click', () => setNavigationView(button.dataset.view));
  });
  conversationSearchInput.addEventListener('input', renderConversations);
  conversationFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    appState.conversationFilter = button.dataset.filter;
    if (appState.activeNavigation === 'groups' && button.dataset.filter !== 'groups') {
      appState.activeNavigation = 'chats';
      document.querySelectorAll('.navigation-item[data-view]').forEach((item) => {
        const isActive = item.dataset.view === 'chats';
        item.classList.toggle('active', isActive);
        if (isActive) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
      listPanelTitle.textContent = 'Chats';
    }
    syncConversationFilterButtons();
    conversationSectionTitle.textContent = appState.conversationFilter === 'groups'
      ? 'Your groups'
      : appState.conversationFilter === 'direct' ? 'Direct messages' : 'Recent chats';
    renderConversations();
  });
  document.getElementById('mobile-chat-back').addEventListener('click', () => {
    chatScreen.classList.remove('conversation-open');
    appState.conversationInfoOpen = false;
    syncConversationInfoPanel();
  });
  conversationInfoButton.addEventListener('click', () => {
    appState.conversationInfoOpen = !appState.conversationInfoOpen;
    syncConversationInfoPanel();
  });
  document.getElementById('close-info-panel').addEventListener('click', () => {
    appState.conversationInfoOpen = false;
    syncConversationInfoPanel();
  });
  document.getElementById('create-group-button').addEventListener('click', () => openGroupDialog('create'));
  document.getElementById('add-group-members-button').addEventListener('click', () => {
    openGroupDialog('add', document.getElementById('add-group-members-button').dataset.conversationId);
  });
  groupForm.addEventListener('submit', submitGroupForm);
  document.getElementById('close-group-dialog').addEventListener('click', () => groupDialog.close());
  document.getElementById('cancel-group-button').addEventListener('click', () => groupDialog.close());
  infoPanelProfileButton.addEventListener('click', () => {
    viewUserProfile(Number(infoPanelProfileButton.dataset.userId)).catch(showChatError);
  });
  archiveChatButton.addEventListener('click', async () => {
    const conversation = getConversationMeta(appState.activeConversationId);
    if (!conversation) return;
    archiveChatButton.disabled = true;
    try {
      await api(`/api/conversations/${conversation.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({ isArchived: !conversation.isArchived })
      });
      setNavigationView(conversation.isArchived ? 'chats' : 'archived');
    } catch (error) {
      showChatError(error);
    } finally {
      archiveChatButton.disabled = false;
    }
  });
  viewChatProfileButton.addEventListener('click', () => {
    viewUserProfile(Number(viewChatProfileButton.dataset.userId)).catch(showChatError);
  });
  chatPinForm.addEventListener('submit', submitChatPin);
  document.getElementById('close-chat-pin-dialog').addEventListener('click', () => {
    chatPinDialog.close();
    pendingChatPinAction = null;
  });
  document.getElementById('cancel-chat-pin-button').addEventListener('click', () => {
    chatPinDialog.close();
    pendingChatPinAction = null;
  });
  profileGender.addEventListener('change', syncCustomGenderField);
  profileDateOfBirth.addEventListener('input', syncProfileDateControls);
  profileDateOfBirth.addEventListener('change', syncProfileDateControls);
  clearProfileDateButton.addEventListener('click', () => {
    profileDateOfBirth.value = '';
    syncProfileDateControls();
    profileDateOfBirth.focus();
  });
  profileSettingsButton.addEventListener('click', () => setNavigationView('profile'));
  document.getElementById('close-profile-dialog').addEventListener('click', () => profileDialog.close());
  document.getElementById('cancel-profile-button').addEventListener('click', () => {
    populateProfileForm();
    profileDialog.close();
  });
  profileDialog.addEventListener('close', () => {
    populateProfileForm();
    if (appState.activeNavigation === 'profile' || appState.activeNavigation === 'settings') {
      setNavigationView(appState.collectionNavigation);
    }
  });
  document.getElementById('close-user-profile-dialog').addEventListener('click', () => userProfileDialog.close());
  document.getElementById('message-profile-user').addEventListener('click', async () => {
    if (!viewedProfileUserId) return;
    userProfileDialog.close();
    try {
      await startConversation(viewedProfileUserId);
    } catch (error) {
      showChatError(error);
    }
  });
  document.getElementById('remove-profile-photo').addEventListener('click', () => {
    editingProfileImage = null;
    previewProfileImage(null);
    profilePhotoInput.value = '';
  });
  profilePhotoInput.addEventListener('change', async () => {
    const [file] = profilePhotoInput.files || [];
    if (!file) return;

    const saveButton = profileForm.querySelector('[type="submit"]');
    saveButton.disabled = true;
    pendingPhotoProcessing = resizeProfileImage(file);
    try {
      editingProfileImage = await pendingPhotoProcessing;
      previewProfileImage(editingProfileImage);
      profileError.textContent = '';
      profileError.classList.add('hidden');
    } catch (error) {
      profilePhotoInput.value = '';
      profileError.textContent = error.message;
      profileError.classList.remove('hidden');
    } finally {
      pendingPhotoProcessing = null;
      saveButton.disabled = false;
    }
  });
  profileForm.addEventListener('submit', saveProfile);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && appState.activeConversationId) {
      loadMessages(appState.activeConversationId).catch(showChatError);
    }
  });

}

socket.on('connect', () => {
  if (appState.currentUser && appState.activeConversationId) {
    socket.emit('join-conversation', appState.activeConversationId);
  }
});

socket.on('presence:update', (onlineIds) => {
  appState.onlineUserIds = new Set(onlineIds.map(Number));
  renderPeople();
  renderConversations();
  syncConversationInfoPanel();
  if (appState.activeConversationId) {
    const conversation = getConversationMeta(appState.activeConversationId);
    if (conversation?.otherUser) {
      chatStatus.textContent = appState.onlineUserIds.has(conversation.otherUser.id) ? 'Online now' : 'Offline';
    }
  }
});

socket.on('new-message', (message) => {
  const conversation = getConversationMeta(message.conversationId);
  if (!conversation) {
    return;
  }
  if (conversation.isLocked && !appState.unlockedConversationIds.has(message.conversationId)) {
    return;
  }
  conversation.lastMessage = message;
  appState.conversations = [
    conversation,
    ...appState.conversations.filter((item) => item.id !== message.conversationId)
  ];
  sortRecentConversations();
  renderConversations();
  syncConversationInfoPanel();
  if (appState.activeConversationId === message.conversationId) {
    loadMessages(message.conversationId).catch(showChatError);
  }
});

socket.on('messages-seen', ({ conversationId, messageIds, readAt }) => {
  const seenIds = new Set(messageIds);
  if (conversationId !== appState.activeConversationId) return;
  appState.activeMessages = appState.activeMessages.map((message) => (
    seenIds.has(message.id) ? { ...message, readAt } : message
  ));
  renderMessages(appState.activeMessages);
});

socket.on('conversation-updated', ({ conversationId, lastMessage }) => {
  const conversation = getConversationMeta(conversationId);
  if (!conversation) {
    loadConversations({ autoSelect: false }).catch(showChatError);
    return;
  }
  if (!conversation.isLocked && lastMessage) {
    conversation.lastMessage = lastMessage;
  }
  const isUnreadMessage = lastMessage
    && lastMessage.senderId !== appState.currentUser?.id
    && appState.activeConversationId !== conversationId
    && !appState.processedUnreadMessageIds.has(lastMessage.id);
  if (isUnreadMessage) {
    appState.processedUnreadMessageIds.add(lastMessage.id);
    if (appState.processedUnreadMessageIds.size > 1000) {
      appState.processedUnreadMessageIds.delete(appState.processedUnreadMessageIds.values().next().value);
    }
    conversation.unreadCount = (Number(conversation.unreadCount) || 0) + 1;
  }
  appState.conversations = [
    conversation,
    ...appState.conversations.filter((item) => item.id !== conversationId)
  ];
  sortRecentConversations();
  renderConversations();
  syncConversationInfoPanel();
});

socket.on('message-reactions-updated', ({ messageId, reactions }) => {
  const message = appState.activeMessages.find((item) => item.id === messageId);
  if (!message) return;
  message.reactions = reactions;
  renderMessages(appState.activeMessages);
});

socket.on('message-deleted', ({ messageId, conversationId }) => {
  if (conversationId === appState.activeConversationId) {
    appState.activeMessages = appState.activeMessages.filter((message) => message.id !== messageId);
    renderMessages(appState.activeMessages);
  }
  loadConversations({ autoSelect: false }).catch(showChatError);
});

socket.on('profile-updated', async ({ userId }) => {
  try {
    if (Number(userId) === Number(appState.currentUser?.id)) {
      const { user } = await api('/api/me');
      appState.currentUser = user;
      renderCurrentUser();
    }
    await Promise.all([
      loadUsers(),
      loadConversations({ autoSelect: false })
    ]);
    if (appState.activeConversationId) {
      await loadMessages(appState.activeConversationId);
    }
  } catch (error) {
    showToast(`Could not refresh profile information: ${error.message}`);
  }
});

socket.on('typing', ({ conversationId, userId, username }) => {
  if (conversationId !== appState.activeConversationId) return;
  if (userId !== appState.currentUser?.id) {
    appState.typingUsers.set(userId, username);
    updateTypingIndicator();
  }
});

socket.on('stop-typing', ({ conversationId, userId }) => {
  if (conversationId !== appState.activeConversationId) return;
  if (userId !== appState.currentUser?.id) {
    appState.typingUsers.delete(userId);
    updateTypingIndicator();
  }
});

attachEventHandlers();
loadSession();
