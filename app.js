(function () {
  const config = window.CHATDUDE_CONFIG || {};
  const backendUrl = (config.serverUrl || "https://chatdude-1091.onrender.com").replace(/\/$/, "");
  const storageKeys = {
    token: "chatdude:token",
    lastRoom: "chatdude:last-room",
    guestName: "chatdude:guest-name",
    pmFeed: "chatdude:pm-feed"
  };

  const state = {
    token: localStorage.getItem(storageKeys.token) || "",
    me: null,
    rooms: [],
    activeRoom: localStorage.getItem(storageKeys.lastRoom) || "general",
    pendingRoomSelection: true,
    socket: null,
    currentSocketId: "",
    users: [],
    messages: [],
    typingUsers: [],
    pmFeed: parseStoredJson(storageKeys.pmFeed, []),
    selectedUser: null,
    activeTab: "guest",
    typingTimer: null,
    isTyping: false,
    mediaPublishers: [],
    localStream: null,
    isPublishing: false,
    cameraEnabled: false,
    micEnabled: false,
    peerConnections: new Map(),
    remoteStreams: new Map(),
    remoteSettings: {},
    openMediaIds: new Set(),
    callLayout: {},
    maximizedCallId: "",
    draggingCall: null,
    pmInboxOpen: false,
    pmUnread: {},
    activePmUser: null,
    pmWindowPosition: { x: 96, y: 132 },
    draggingPmWindow: null,
    lastActivityPingAt: 0,
    pmCall: {
      targetSocketId: "",
      targetUsername: "",
      mode: "",
      localStream: null,
      remoteStream: null,
      peerConnection: null,
      incomingRequest: null,
      pendingRequest: null
    }
  };

  const CALL_CARD_WIDTH = 196;
  const CALL_CARD_HEIGHT = 146;
  const CALL_CARD_MIN_WIDTH = 160;
  const CALL_CARD_ASPECT_RATIO = CALL_CARD_WIDTH / CALL_CARD_HEIGHT;
  const CALL_CARD_MIN_HEIGHT = Math.round(CALL_CARD_MIN_WIDTH / CALL_CARD_ASPECT_RATIO);
  const CALL_EDGE_RESIZE_THRESHOLD = 10;

  const elements = {
    authShell: document.getElementById("auth-shell"),
    chatShell: document.getElementById("chat-shell"),
    authTabs: document.getElementById("auth-tabs"),
    guestForm: document.getElementById("guest-form"),
    loginForm: document.getElementById("login-form"),
    registerForm: document.getElementById("register-form"),
    guestName: document.getElementById("guest-name"),
    loginUsername: document.getElementById("login-username"),
    loginPassword: document.getElementById("login-password"),
    registerDisplayName: document.getElementById("register-display-name"),
    registerUsername: document.getElementById("register-username"),
    registerPassword: document.getElementById("register-password"),
    activeRoomPill: document.getElementById("active-room-pill"),
    accountBadge: document.getElementById("account-badge"),
    openInboxBtn: document.getElementById("open-inbox-btn"),
    inboxCount: document.getElementById("inbox-count"),
    pmInboxPopover: document.getElementById("pm-inbox-popover"),
    presenceStatusSelect: document.getElementById("presence-status-select"),
    accountMenu: document.getElementById("account-menu"),
    accountMenuTitle: document.getElementById("account-menu-title"),
    accountMenuCloseBtn: document.getElementById("account-menu-close-btn"),
    openRoomModalBtn: document.getElementById("open-room-modal-btn"),
    deleteRoomBtn: document.getElementById("delete-room-btn"),
    logoutBtn: document.getElementById("logout-btn"),
    guestUpgradeCard: document.getElementById("guest-upgrade-card"),
    roomList: document.getElementById("room-list"),
    callParticipants: document.getElementById("call-participants"),
    roomPickerOverlay: document.getElementById("room-picker-overlay"),
    roomPickerList: document.getElementById("room-picker-list"),
    joinAudioBtn: document.getElementById("join-audio-btn"),
    messages: document.getElementById("messages"),
    messageForm: document.getElementById("message-form"),
    messageInput: document.getElementById("message-input"),
    typingIndicator: document.getElementById("typing-indicator"),
    usersList: document.getElementById("users-list"),
    friendsList: document.getElementById("friends-list"),
    pmFeed: document.getElementById("pm-feed"),
    userMenu: document.getElementById("user-menu"),
    userMenuHeader: document.getElementById("user-menu-header"),
    menuPmBtn: document.getElementById("menu-pm-btn"),
    menuCallAudioBtn: document.getElementById("menu-call-audio-btn"),
    menuCallVideoBtn: document.getElementById("menu-call-video-btn"),
    menuFriendBtn: document.getElementById("menu-friend-btn"),
    menuBlockBtn: document.getElementById("menu-block-btn"),
    pmWindow: document.getElementById("pm-window"),
    pmWindowTitle: document.getElementById("pm-window-title"),
    pmWindowCloseBtn: document.getElementById("pm-window-close-btn"),
    pmRequestBanner: document.getElementById("pm-request-banner"),
    pmWindowMedia: document.getElementById("pm-window-media"),
    pmRemoteMediaStage: document.getElementById("pm-remote-media-stage"),
    pmLocalMediaStage: document.getElementById("pm-local-media-stage"),
    pmAudioBtn: document.getElementById("pm-audio-btn"),
    pmVideoBtn: document.getElementById("pm-video-btn"),
    pmEndCallBtn: document.getElementById("pm-end-call-btn"),
    pmThread: document.getElementById("pm-thread"),
    pmWindowForm: document.getElementById("pm-window-form"),
    pmWindowInput: document.getElementById("pm-window-input"),
    pmSendBtn: document.getElementById("pm-send-btn"),
    roomModalOverlay: document.getElementById("room-modal-overlay"),
    roomForm: document.getElementById("room-form"),
    roomCancelBtn: document.getElementById("room-cancel-btn"),
    roomNameInput: document.getElementById("room-name-input"),
    roomDescriptionInput: document.getElementById("room-description-input"),
    preferencesForm: document.getElementById("preferences-form"),
    fontSelect: document.getElementById("font-select"),
    accentColorInput: document.getElementById("accent-color-input"),
    backgroundStyleSelect: document.getElementById("background-style-select"),
    allowGuestCameraView: document.getElementById("allow-guest-camera-view"),
    allowPrivateCalls: document.getElementById("allow-private-calls"),
    blockedUsersList: document.getElementById("blocked-users-list"),
    toastStack: document.getElementById("toast-stack")
  };

  if (elements.pmInboxPopover && elements.pmInboxPopover.parentElement !== document.body) {
    document.body.appendChild(elements.pmInboxPopover);
  }
  if (elements.accountMenu && elements.accountMenu.parentElement !== document.body) {
    document.body.appendChild(elements.accountMenu);
  }
  if (elements.userMenu && elements.userMenu.parentElement !== document.body) {
    document.body.appendChild(elements.userMenu);
  }

  function parseStoredJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function savePmFeed() {
    localStorage.setItem(storageKeys.pmFeed, JSON.stringify(state.pmFeed.slice(-20)));
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
  }

  function verifiedBadgeMarkup() {
    return '<span class="verified-badge" title="Verified account" aria-label="Verified account"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12.75 11.25 15 15.75 9.75"></path><path d="M12 3l2.3 2.1 3.1.2.9 3 2.5 1.8-1 3 1 3-2.5 1.8-.9 3-3.1.2L12 21l-2.3-2.1-3.1-.2-.9-3L3.2 13.9l1-3-1-3 2.5-1.8.9-3 3.1-.2L12 3z"></path></svg></span>';
  }

  function iconMarkup(name) {
    const icons = {
      mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"></path><path d="M19 10a7 7 0 0 1-14 0"></path><path d="M12 17v4"></path><path d="M8 21h8"></path></svg>',
      micOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16"></path><path d="M9.5 9.5V11a2.5 2.5 0 0 0 4.24 1.77"></path><path d="M12 3a3 3 0 0 1 3 3v2.5"></path><path d="M19 10a7 7 0 0 1-11.11 5.69"></path><path d="M12 17v4"></path><path d="M8 21h8"></path></svg>',
      camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 10l4.5-3v10L15 14"></path><rect x="3" y="6.5" width="12" height="11" rx="2"></rect></svg>',
      cameraOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16"></path><path d="M15 10l4.5-3v10L15 14"></path><path d="M10.5 6.5H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"></path></svg>',
      volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18 6a8.5 8.5 0 0 1 0 12"></path></svg>',
      volumeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"></path><path d="M16 9l5 5"></path><path d="M21 9l-5 5"></path></svg>',
      fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H4v4"></path><path d="M16 3h4v4"></path><path d="M20 16v4h-4"></path><path d="M8 21H4v-4"></path></svg>',
      resize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15l6 6"></path><path d="M15 11l4 4"></path><path d="M6 18l1 1"></path></svg>'
    };

    return icons[name] || "";
  }

  function formatTime(payload) {
    if (typeof payload?.timestamp === "string" && payload.timestamp.trim()) {
      const parsed = new Date(payload.timestamp);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit"
        });
      }
    }

    if (typeof payload?.time === "string" && payload.time.trim()) {
      return payload.time.trim();
    }

    return new Date().toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function showToast(message, tone) {
    const toast = document.createElement("div");
    toast.className = `toast ${tone || "info"}`;
    toast.textContent = message;
    elements.toastStack.appendChild(toast);

    window.setTimeout(function () {
      toast.remove();
    }, 3400);
  }

  async function api(path, options) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      options?.headers || {}
    );

    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }

    const response = await fetch(`${backendUrl}${path}`, {
      method: options?.method || "GET",
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) {
      throw new Error(payload.error || "Something went wrong.");
    }

    return payload;
  }

  function setActiveTab(tab) {
    state.activeTab = tab;

    document.querySelectorAll("[data-tab]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.tab === tab);
    });

    document.querySelectorAll("[data-panel]").forEach(function (panel) {
      panel.classList.toggle("is-active", panel.dataset.panel === tab);
    });
  }

  function roomBySlug(roomSlug) {
    return state.rooms.find(function (room) {
      return room.slug === roomSlug;
    }) || null;
  }

  function applyPreferences() {
    const preferences = (state.me && state.me.preferences) || {
      textColor: "#edf4ff",
      fontFamily: "Space Grotesk",
      backgroundStyle: "aurora",
      allowPrivateCalls: true
    };

    document.body.dataset.backgroundStyle = preferences.backgroundStyle;

    elements.fontSelect.value = preferences.fontFamily;
    elements.accentColorInput.value = preferences.textColor;
    elements.backgroundStyleSelect.value = preferences.backgroundStyle;
    elements.allowGuestCameraView.checked = preferences.privacy?.allowGuestCameraView !== false;
    elements.allowPrivateCalls.checked = preferences.allowPrivateCalls !== false;
    elements.messageInput.style.cssText = styleFromPreferences(preferences);
    elements.pmWindowInput.style.cssText = styleFromPreferences(preferences);
    renderBlockedUsers();
    renderFriends();
  }

  function privateCallsEnabledForCurrentUser() {
    return !state.me || state.me.preferences?.allowPrivateCalls !== false;
  }

  function privateCallsEnabledForUser(user) {
    return !user || user.preferences?.allowPrivateCalls !== false;
  }

  function playPmNotification() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    try {
      if (!state.pmAudioContext) {
        state.pmAudioContext = new AudioContextClass();
      }
      const audioContext = state.pmAudioContext;
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(function () {});
      }
      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, now);
      oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.24);
    } catch (_error) {
      // ignore notification sound failures
    }
  }

  function playIncomingCallTone() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    try {
      if (!state.callAudioContext) {
        state.callAudioContext = new AudioContextClass();
      }
      const audioContext = state.callAudioContext;
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(function () {});
      }

      const now = audioContext.currentTime;
      [0, 0.34].forEach(function (offset, index) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(index === 0 ? 720 : 860, now + offset);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.09, now + offset + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.26);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.28);
      });
    } catch (_error) {
      // ignore call notification sound failures
    }
  }

  function styleFromPreferences(preferences) {
    const safe = preferences || {};
    const style = [];

    if (safe.fontFamily) {
      style.push(`font-family: "${String(safe.fontFamily).replace(/"/g, "")}", sans-serif`);
    }

    if (safe.textColor) {
      style.push(`color: ${safe.textColor}`);
    }

    return style.join("; ");
  }

  function renderBlockedUsers() {
    const blockedUsers = (state.me && state.me.blockedUsers) || [];
    elements.blockedUsersList.innerHTML = "";

    if (!blockedUsers.length) {
      elements.blockedUsersList.textContent = "No blocked users.";
      return;
    }

    blockedUsers.forEach(function (username) {
      const chip = document.createElement("div");
      chip.className = "blocked-user-chip";
      chip.innerHTML = `
        <span>${escapeHtml(username)}</span>
        <button type="button" data-unblock-username="${escapeHtml(username)}">Unblock</button>
      `;
      elements.blockedUsersList.appendChild(chip);
    });
  }

  function friendUsernames() {
    return Array.isArray(state.me?.friends) ? state.me.friends : [];
  }

  function renderFriends() {
    if (!elements.friendsList) {
      return;
    }

    elements.friendsList.innerHTML = "";

    if (!state.me || state.me.isGuest) {
      elements.friendsList.innerHTML = '<li class="empty-state">Create an account to build a friends list.</li>';
      return;
    }

    const friends = friendUsernames();
    if (!friends.length) {
      elements.friendsList.innerHTML = '<li class="empty-state">No friends yet. Use a user menu to add one.</li>';
      return;
    }

    friends
      .slice()
      .sort(function (left, right) {
        return left.localeCompare(right);
      })
      .forEach(function (username) {
        const onlineFriend = state.users.find(function (user) {
          return user.username === username;
        });
        const item = document.createElement("li");
        item.className = "user-item";
        item.innerHTML = `
          <div class="user-row">
            <span class="user-dot is-${escapeHtml(onlineFriend?.effectivePresenceStatus || "offline")}"></span>
            <div class="user-name-trigger-wrap">
              <div class="user-name-trigger is-self">
                <span class="user-name-line">
                  <strong>${escapeHtml(onlineFriend?.displayName || username)}</strong>
                  ${onlineFriend && !onlineFriend.isGuest ? verifiedBadgeMarkup() : ""}
                </span>
                <span class="user-secondary-line">${escapeHtml(onlineFriend ? "Here now" : "Offline")}</span>
              </div>
              ${onlineFriend?.isPublishing ? `
                <button
                  type="button"
                  class="user-cam-btn inline"
                  data-open-media-id="${escapeHtml(onlineFriend.socketId)}"
                  title="Open camera"
                  aria-label="Open camera"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M15 10.5 19.5 7v10L15 13.5"></path>
                    <rect x="3" y="6" width="12" height="12" rx="2" ry="2"></rect>
                  </svg>
                </button>
              ` : ""}
            </div>
          </div>
        `;
        elements.friendsList.appendChild(item);
      });
  }

  function renderAccount() {
    if (!state.me) return;

    const roleLabel = state.me.isGuest ? "" : verifiedBadgeMarkup();
    elements.accountBadge.innerHTML = `
      <span class="account-badge-row">
        <strong>${escapeHtml(state.me.displayName || state.me.username)}</strong>
        ${roleLabel}
      </span>
    `;
    elements.accountMenuTitle.textContent = state.me.displayName || state.me.username;

    elements.openRoomModalBtn.classList.toggle("hidden", !state.me.canCreateRooms);
    elements.guestUpgradeCard.classList.toggle("hidden", !state.me.isGuest);
    elements.joinAudioBtn.disabled = false;
    elements.joinAudioBtn.title = state.isPublishing
      ? "Stop publishing your camera"
      : "Publish your camera";
    elements.joinAudioBtn.classList.toggle("is-active", state.isPublishing);
    elements.presenceStatusSelect.value = state.me.presenceStatus || "online";
    elements.presenceStatusSelect.disabled = !state.socket;
    renderPmInbox();
    renderPmWindow();
  }

  function canManageActiveRoom() {
    const room = roomBySlug(state.activeRoom);
    return Boolean(
      state.me &&
      !state.me.isGuest &&
      room &&
      !room.system &&
      room.createdBy === state.me.username
    );
  }

  function renderRooms() {
    elements.roomList.innerHTML = "";
    elements.roomPickerList.innerHTML = "";

    state.rooms.forEach(function (room) {
      const roomButton = document.createElement("button");
      roomButton.type = "button";
      roomButton.className = `room-item${room.slug === state.activeRoom ? " is-active" : ""}`;
      roomButton.dataset.roomSlug = room.slug;
      roomButton.innerHTML = `
        <strong>${escapeHtml(room.name)}</strong>
        <span class="subtle-copy">${escapeHtml(room.description)}</span>
        <div class="room-meta">
          <span>${room.onlineCount || 0} online</span>
          <span>${room.lastMessageAt ? formatTime({ timestamp: room.lastMessageAt }) : "Quiet"}</span>
        </div>
      `;
      elements.roomList.appendChild(roomButton);

      const pickerButton = document.createElement("button");
      pickerButton.type = "button";
      pickerButton.className = `room-item room-picker-item${room.slug === state.activeRoom ? " is-active" : ""}`;
      pickerButton.dataset.pickRoomSlug = room.slug;
      pickerButton.innerHTML = `
        <strong>${escapeHtml(room.name)}</strong>
        <span class="subtle-copy">${escapeHtml(room.description)}</span>
        <div class="room-meta">
          <span>${room.onlineCount || 0} online</span>
          <span>${room.system ? "Default" : "Custom"}</span>
        </div>
      `;
      elements.roomPickerList.appendChild(pickerButton);
    });

    const activeRoom = roomBySlug(state.activeRoom) || state.rooms[0];
    if (activeRoom) {
      elements.activeRoomPill.textContent = `${activeRoom.name} room`;
    }

    elements.deleteRoomBtn.classList.toggle("hidden", !canManageActiveRoom());
  }

  function showRoomPicker() {
    state.pendingRoomSelection = true;
    elements.roomPickerOverlay.classList.remove("hidden");
    renderRooms();
  }

  function hideRoomPicker() {
    state.pendingRoomSelection = false;
    elements.roomPickerOverlay.classList.add("hidden");
  }

  function initialFromName(name) {
    return (name || "?").slice(0, 1).toUpperCase();
  }

  function getDefaultCallPosition(index) {
    const column = index % 4;
    const row = Math.floor(index / 4);

    return {
      x: 18 + (column * (CALL_CARD_WIDTH + 18)),
      y: 92 + (row * (CALL_CARD_HEIGHT + 18))
    };
  }

  function normalizeCallSize(width) {
    const maxWidth = Math.max(CALL_CARD_MIN_WIDTH, window.innerWidth - 24);
    const normalizedWidth = Math.max(CALL_CARD_MIN_WIDTH, Math.min(width || CALL_CARD_WIDTH, maxWidth));
    return {
      width: normalizedWidth,
      height: Math.max(CALL_CARD_MIN_HEIGHT, Math.round(normalizedWidth / CALL_CARD_ASPECT_RATIO))
    };
  }

  function clampCallLayout(layout) {
    const size = normalizeCallSize(layout.width || CALL_CARD_WIDTH);
    const maxHeight = Math.max(CALL_CARD_MIN_HEIGHT, window.innerHeight - 84);
    const width = size.height > maxHeight
      ? Math.round(maxHeight * CALL_CARD_ASPECT_RATIO)
      : size.width;
    const height = Math.min(maxHeight, Math.round(width / CALL_CARD_ASPECT_RATIO));
    const maxX = Math.max(0, window.innerWidth - width - 18);
    const maxY = Math.max(0, window.innerHeight - height - 18);

    return {
      x: Math.min(Math.max(layout.x, 12), maxX),
      y: Math.min(Math.max(layout.y, 74), maxY),
      width,
      height
    };
  }

  function setMicrophoneEnabled(enabled) {
    if (!state.localStream) {
      return;
    }

    state.localStream.getAudioTracks().forEach(function (track) {
      track.enabled = enabled;
    });
  }

  function renderCallPanel() {
    elements.callParticipants.innerHTML = "";
    document.body.classList.toggle("has-split-call", Boolean(state.maximizedCallId));

    const allPublishers = state.mediaPublishers.slice();
    if (state.isPublishing && !allPublishers.some(function (publisher) { return publisher.socketId === state.currentSocketId; })) {
      allPublishers.unshift({
        socketId: state.currentSocketId,
        username: state.me?.username || "you",
        displayName: state.me?.displayName || state.me?.username || "You",
        cameraEnabled: state.cameraEnabled,
        micEnabled: state.micEnabled
      });
    }

    const visiblePublishers = allPublishers.filter(function (publisher) {
      return publisher.socketId === state.currentSocketId ||
        state.remoteStreams.has(publisher.socketId) ||
        state.openMediaIds.has(publisher.socketId);
    });

    if (!visiblePublishers.length) {
      if (state.maximizedCallId) {
        state.maximizedCallId = "";
        document.body.classList.remove("has-split-call");
      }
      return;
    }

    if (state.maximizedCallId && !visiblePublishers.some(function (participant) { return participant.socketId === state.maximizedCallId; })) {
      state.maximizedCallId = "";
      document.body.classList.remove("has-split-call");
    }

    visiblePublishers.forEach(function (participant) {
      const card = document.createElement("article");
      const remoteStream = state.remoteStreams.get(participant.socketId);
      const showVideo = participant.socketId === state.currentSocketId
        ? Boolean(state.localStream && state.cameraEnabled)
        : Boolean(remoteStream && participant.cameraEnabled);
      card.className = `call-card${showVideo ? "" : " is-audio-only is-camera-off"}${state.maximizedCallId === participant.socketId ? " is-maximized" : ""}`;
      card.dataset.callSocketId = participant.socketId;

      const layout = clampCallLayout(
        Object.assign(
          {
            width: CALL_CARD_WIDTH,
            height: CALL_CARD_HEIGHT
          },
          state.callLayout[participant.socketId] || getDefaultCallPosition(visiblePublishers.indexOf(participant))
        )
      );
      state.callLayout[participant.socketId] = layout;
      card.style.left = `${layout.x}px`;
      card.style.top = `${layout.y}px`;
      card.style.width = `${layout.width}px`;
      card.style.height = `${layout.height}px`;

      const dragBar = document.createElement("div");
      dragBar.className = "call-drag-bar";
      dragBar.dataset.callDragHandle = "true";
      dragBar.innerHTML = `
        <strong>${escapeHtml(participant.displayName || participant.username)}</strong>
        <div class="call-drag-actions">
          <button
            type="button"
            class="call-fullscreen-btn"
            data-call-fullscreen="${escapeHtml(participant.socketId)}"
            aria-label="Fullscreen camera"
            title="Fullscreen camera"
          >${iconMarkup("fullscreen")}</button>
          ${participant.socketId === state.currentSocketId ? `
            <button
              type="button"
              class="call-close-btn"
              data-close-local-camera="true"
              aria-label="Close your camera"
              title="Stop publishing your camera"
            >X</button>
          ` : `
            <button
              type="button"
              class="call-close-btn"
              data-close-remote-camera="${escapeHtml(participant.socketId)}"
              aria-label="Close this camera"
              title="Close this camera"
            >X</button>
          `}
          <span class="call-drag-dot">::</span>
        </div>
      `;
      card.appendChild(dragBar);

      if (participant.socketId === state.currentSocketId && state.localStream) {
        if (state.cameraEnabled) {
          const localVideo = document.createElement("video");
          localVideo.autoplay = true;
          localVideo.muted = true;
          localVideo.playsInline = true;
          localVideo.srcObject = state.localStream;
          card.appendChild(localVideo);
        } else {
          const avatar = document.createElement("div");
          avatar.className = "call-avatar";
          avatar.textContent = initialFromName(participant.displayName || participant.username);
          card.appendChild(avatar);
        }
      } else if (remoteStream && participant.cameraEnabled) {
        const remoteVideo = document.createElement("video");
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.srcObject = remoteStream;
        const remoteSettings = state.remoteSettings[participant.socketId] || { volume: 1, muted: false };
        remoteVideo.volume = remoteSettings.volume;
        remoteVideo.muted = remoteSettings.muted;
        card.appendChild(remoteVideo);
        const playAttempt = remoteVideo.play();
        if (playAttempt && typeof playAttempt.catch === "function") {
          playAttempt.catch(function () {
            remoteVideo.muted = true;
            state.remoteSettings[participant.socketId] = {
              volume: remoteSettings.volume,
              muted: true
            };
            showToast("Browser blocked auto-audio for this camera. Use the speaker control to unmute.", "error");
          });
        }
      } else {
        const avatar = document.createElement("div");
        avatar.className = "call-avatar";
        avatar.textContent = initialFromName(participant.displayName || participant.username);
        card.appendChild(avatar);
      }

      if (participant.socketId === state.currentSocketId && state.isPublishing) {
        const controls = document.createElement("div");
        controls.className = "camera-controls";
        controls.innerHTML = `
          <button type="button" class="camera-status-btn icon-control" data-toggle-mic="true" title="${state.micEnabled ? "Mute microphone" : "Unmute microphone"}" aria-label="${state.micEnabled ? "Mute microphone" : "Unmute microphone"}">
            ${iconMarkup(state.micEnabled ? "mic" : "micOff")}
          </button>
          <button type="button" class="camera-status-btn icon-control" data-toggle-camera="true" title="${state.cameraEnabled ? "Hide camera" : "Show camera"}" aria-label="${state.cameraEnabled ? "Hide camera" : "Show camera"}">
            ${iconMarkup(state.cameraEnabled ? "camera" : "cameraOff")}
          </button>
        `;
        card.appendChild(controls);
      } else if (remoteStream) {
        const remoteSettings = state.remoteSettings[participant.socketId] || { volume: 1, muted: false };
        const controls = document.createElement("div");
        controls.className = "camera-controls";
        controls.innerHTML = `
          <button type="button" class="camera-status-btn icon-control" data-toggle-remote-mute="${escapeHtml(participant.socketId)}" title="${remoteSettings.muted ? "Unmute viewer audio" : "Mute viewer audio"}" aria-label="${remoteSettings.muted ? "Unmute viewer audio" : "Mute viewer audio"}">
            ${iconMarkup(remoteSettings.muted ? "volumeOff" : "volume")}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value="${escapeHtml(remoteSettings.volume)}"
            class="volume-slider"
            title="Remote camera volume"
            aria-label="Remote camera volume"
            data-remote-volume="${escapeHtml(participant.socketId)}"
          />
        `;
        card.appendChild(controls);
      }

      elements.callParticipants.appendChild(card);
    });
  }

  function renderMessages() {
    elements.messages.innerHTML = "";

    if (!state.messages.length) {
      elements.messages.innerHTML = '<li class="empty-state">No messages yet. Start the energy.</li>';
      return;
    }

    state.messages.forEach(function (message) {
      const item = document.createElement("li");
      item.className = `message-item ${message.kind}`;
      const isOwnMessage = Boolean(
        state.me &&
        message.kind !== "system" &&
        (
          (message.senderId && message.senderId === state.me.id) ||
          (message.username && state.me.username && message.username === state.me.username)
        )
      );

      if (message.kind === "system") {
        const body = document.createElement("div");
        body.className = "message-bubble";

        const textRow = document.createElement("div");
        textRow.className = "message-text-row";

        const text = document.createElement("div");
        text.className = "message-text";
        text.textContent = message.message;
        textRow.appendChild(text);

        const time = document.createElement("span");
        time.className = "time-label bubble-time";
        time.textContent = formatTime(message);
        textRow.appendChild(time);

        body.appendChild(textRow);
        item.appendChild(body);
        elements.messages.appendChild(item);
        return;
      } else {
        const meta = document.createElement("div");
        meta.className = "message-meta";
        const userButton = document.createElement("button");
        userButton.type = "button";
        userButton.className = "username-button";
        userButton.dataset.userTrigger = "true";
        userButton.dataset.socketId = message.socketId || "";
        userButton.dataset.username = message.username || "";
        userButton.textContent = message.displayName || message.username || "User";
        userButton.style.cssText = styleFromPreferences(message.preferences);

        const left = document.createElement("div");
        left.className = "message-meta";
        left.style.justifyContent = "flex-start";
        left.appendChild(userButton);

        const role = document.createElement("span");
        role.className = "message-role";
        role.innerHTML = message.accountType === "registered"
          ? verifiedBadgeMarkup()
          : "";
        if (role.innerHTML) {
          left.appendChild(role);
        }

        meta.appendChild(left);

        const body = document.createElement("div");
        body.className = "message-bubble is-own-inline";

        const text = document.createElement("div");
        text.className = "message-text";
        text.textContent = message.message;
        text.style.cssText = styleFromPreferences(message.preferences);

        const bubbleTime = document.createElement("span");
        bubbleTime.className = "time-label bubble-time";
        bubbleTime.textContent = formatTime(message);

        const inlineRow = document.createElement("div");
        inlineRow.className = "message-inline-row";
        inlineRow.appendChild(meta);
        inlineRow.appendChild(text);
        inlineRow.appendChild(bubbleTime);
        body.appendChild(inlineRow);

        item.appendChild(body);
        elements.messages.appendChild(item);
      }
    });

    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  function renderUsers() {
    elements.usersList.innerHTML = "";

    const everyone = state.users.slice();

    if (!everyone.length) {
      elements.usersList.innerHTML = '<li class="empty-state">Nobody is here yet.</li>';
      return;
    }

    everyone.forEach(function (user) {
      const isSelf = user.socketId === state.currentSocketId;
      const item = document.createElement("li");
      item.className = "user-item";

      item.innerHTML = `
        <div class="user-row">
          <span class="user-dot is-${escapeHtml(user.effectivePresenceStatus || "online")}"></span>
          ${isSelf ? `
            <div class="user-name-trigger-wrap">
              <div class="user-name-trigger is-self">
                <span class="user-name-line" style="${escapeHtml(styleFromPreferences(user.preferences))}">
                  <strong>${escapeHtml(user.displayName || user.username)}</strong>
                  <span class="user-badge-text">You</span>
                  ${user.isGuest ? "" : verifiedBadgeMarkup()}
                </span>
              </div>
              ${user.isPublishing ? `
                <button
                  type="button"
                  class="user-cam-btn inline"
                  data-open-media-id="${escapeHtml(user.socketId)}"
                  title="Open your camera window"
                  aria-label="Open your camera window"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M15 10.5 19.5 7v10L15 13.5"></path>
                    <rect x="3" y="6" width="12" height="12" rx="2" ry="2"></rect>
                  </svg>
                </button>
              ` : ""}
            </div>
          ` : `
            <div class="user-name-trigger-wrap">
              <button
                type="button"
                class="user-name-trigger"
                data-user-trigger="true"
                data-socket-id="${escapeHtml(user.socketId)}"
                data-username="${escapeHtml(user.username)}"
              >
                <span class="user-name-line" style="${escapeHtml(styleFromPreferences(user.preferences))}">
                  <strong>${escapeHtml(user.displayName || user.username)}</strong>
                  ${user.isGuest ? "" : verifiedBadgeMarkup()}
                </span>
              </button>
              ${user.isPublishing ? `
                <button
                  type="button"
                  class="user-cam-btn inline"
                  data-open-media-id="${escapeHtml(user.socketId)}"
                  ${!user.canViewCamera ? "disabled" : ""}
                  title="Open ${escapeHtml(user.displayName || user.username)}'s camera"
                  aria-label="Open ${escapeHtml(user.displayName || user.username)} camera"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M15 10.5 19.5 7v10L15 13.5"></path>
                    <rect x="3" y="6" width="12" height="12" rx="2" ry="2"></rect>
                  </svg>
                </button>
              ` : ""}
            </div>
          `}
        </div>
      `;
      elements.usersList.appendChild(item);
    });

    renderFriends();
  }

  function getConversationUsername(entry) {
    if (entry.counterpartUsername) {
      return entry.counterpartUsername;
    }

    if (entry.username) {
      return entry.username;
    }

    if (entry.direction === "incoming") {
      return entry.fromUsername || entry.from || "";
    }

    if (entry.direction === "outgoing" && entry.toUsername) {
      return entry.toUsername;
    }

    if (entry.toUsername) {
      return entry.toUsername;
    }

    if (entry.fromUsername) {
      return entry.fromUsername;
    }

    const match = String(entry.from || "").match(/^\(to ([^)]+)\)$/);
    return match ? match[1] : (entry.counterpartLabel || "");
  }

  function getConversationLabel(entry) {
    return entry.counterpartLabel || getConversationUsername(entry) || "Conversation";
  }

  function getConversationEntries(username) {
    if (!username) {
      return [];
    }

    return state.pmFeed.filter(function (entry) {
      return getConversationUsername(entry) === username;
    });
  }

  function canReplyToPmConversation(username) {
    if (!username) {
      return false;
    }

    if (state.me && state.me.canPrivateMessage) {
      return true;
    }

    return getConversationEntries(username).length > 0;
  }

  function getConversationTarget(username) {
    if (!username) {
      return null;
    }

    return state.users.find(function (user) {
      return user.username === username;
    }) || null;
  }

  function buildPmConversations() {
    const map = new Map();

    state.pmFeed.forEach(function (entry) {
      const username = getConversationUsername(entry);
      if (!username) {
        return;
      }

      const existing = map.get(username);
      if (!existing || new Date(entry.timestamp || 0).getTime() >= new Date(existing.timestamp || 0).getTime()) {
        map.set(username, {
          username,
          label: getConversationLabel(entry),
          message: entry.message,
          preferences: entry.preferences || {},
          timestamp: entry.timestamp,
          time: entry.time,
          unread: Number(state.pmUnread[username] || 0)
        });
      }
    });

    const conversations = Array.from(map.values());
    if (!conversations.length) {
      Object.keys(state.pmUnread).forEach(function (username) {
        if (!username || map.has(username)) {
          return;
        }

        conversations.push({
          username,
          label: username,
          message: "New private message",
          preferences: {},
          timestamp: "",
          time: "",
          unread: Number(state.pmUnread[username] || 0)
        });
      });
    }

    return conversations.sort(function (left, right) {
      return new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime();
    });
  }

  function updateInboxCount() {
    const totalUnread = Object.values(state.pmUnread).reduce(function (sum, count) {
      return sum + Number(count || 0);
    }, 0);

    elements.inboxCount.textContent = String(totalUnread);
    elements.inboxCount.classList.toggle("hidden", totalUnread < 1);
  }

  function renderPmInbox() {
    elements.pmFeed.innerHTML = "";
    updateInboxCount();

    const conversations = buildPmConversations();
    if (!conversations.length) {
      elements.pmFeed.innerHTML = '<li class="empty-state">Your private conversations will show up here.</li>';
      return;
    }

    conversations.forEach(function (conversation) {
      const item = document.createElement("li");
      item.className = "pm-entry";
      item.innerHTML = `
        <button type="button" class="pm-entry-button" data-open-pm-user="${escapeHtml(conversation.username)}">
          <div class="pm-entry-header">
            <strong style="${escapeHtml(styleFromPreferences(conversation.preferences))}">${escapeHtml(conversation.label)}</strong>
            <span class="pm-meta">${escapeHtml(formatTime(conversation))}</span>
          </div>
          <div class="message-text" style="${escapeHtml(styleFromPreferences(conversation.preferences))}">${escapeHtml(conversation.message)}</div>
          ${conversation.unread ? `<span class="pm-unread-badge">${escapeHtml(conversation.unread)}</span>` : ""}
        </button>
      `;
      elements.pmFeed.appendChild(item);
    });
  }

  function renderPmThread() {
    elements.pmThread.innerHTML = "";

    if (!state.activePmUser) {
      elements.pmThread.innerHTML = '<li class="empty-state">Choose a conversation from the envelope or a user menu.</li>';
      return;
    }

    const entries = getConversationEntries(state.activePmUser.username);
    if (!entries.length) {
      elements.pmThread.innerHTML = '<li class="empty-state">No private messages yet. Say hello.</li>';
      return;
    }

    entries.forEach(function (entry) {
      const item = document.createElement("li");
      const outgoing = entry.direction === "outgoing" || Boolean(
        state.me &&
        entry.fromUsername === state.me.username &&
        getConversationUsername(entry) === state.activePmUser.username
      );
      item.className = `pm-thread-item${outgoing ? " is-outgoing" : ""}`;
      item.innerHTML = `
        <div class="pm-thread-bubble">
          <div class="pm-entry-header">
            <strong style="${escapeHtml(styleFromPreferences(entry.preferences))}">${escapeHtml(outgoing ? "You" : getConversationLabel(entry))}</strong>
            <span class="pm-meta">${escapeHtml(formatTime(entry))}</span>
          </div>
          <div class="message-text" style="${escapeHtml(styleFromPreferences(entry.preferences))}">${escapeHtml(entry.message)}</div>
        </div>
      `;
      elements.pmThread.appendChild(item);
    });

    elements.pmThread.scrollTop = elements.pmThread.scrollHeight;
  }

  function renderPmRequestBanner() {
    const request = state.pmCall.incomingRequest;
    if (!request || !state.activePmUser || request.fromUsername !== state.activePmUser.username) {
      elements.pmRequestBanner.classList.add("hidden");
      elements.pmRequestBanner.innerHTML = "";
      return;
    }

    elements.pmRequestBanner.classList.remove("hidden");
    elements.pmRequestBanner.innerHTML = `
      <span>${escapeHtml(request.fromDisplayName || request.fromUsername)} wants to start a private ${escapeHtml(request.mode)} chat.</span>
      <div class="pm-request-actions">
        <button type="button" class="ghost-button" data-accept-pm-call="true">Accept</button>
        <button type="button" class="ghost-button" data-decline-pm-call="true">Decline</button>
      </div>
    `;
  }

  function renderPmMedia() {
    const hasCall = Boolean(state.pmCall.localStream || state.pmCall.remoteStream || state.pmCall.pendingRequest);
    elements.pmWindowMedia.classList.toggle("hidden", !hasCall);
    elements.pmEndCallBtn.classList.toggle("hidden", !hasCall);

    elements.pmLocalMediaStage.innerHTML = "";
    elements.pmRemoteMediaStage.innerHTML = "";

    if (state.pmCall.localStream) {
      const localHasVideo = state.pmCall.localStream.getVideoTracks().some(function (track) {
        return track.enabled;
      });
      if (localHasVideo) {
        const video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.srcObject = state.pmCall.localStream;
        elements.pmLocalMediaStage.appendChild(video);
      } else {
        elements.pmLocalMediaStage.innerHTML = `<div class="pm-media-avatar">${escapeHtml(initialFromName(state.me?.displayName || state.me?.username))}</div>`;
      }
    }

    if (state.pmCall.remoteStream) {
      const remoteHasVideo = state.pmCall.remoteStream.getVideoTracks().length > 0;
      if (remoteHasVideo) {
        const video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.srcObject = state.pmCall.remoteStream;
        elements.pmRemoteMediaStage.appendChild(video);
      } else {
        elements.pmRemoteMediaStage.innerHTML = `<div class="pm-media-avatar">${escapeHtml(initialFromName(state.activePmUser?.label || state.activePmUser?.username))}</div>`;
      }
    }
  }

  function renderPmWindow() {
    const isOpen = Boolean(state.activePmUser);
    elements.pmWindow.classList.toggle("hidden", !isOpen);

    if (!isOpen) {
      return;
    }

    elements.pmWindow.style.left = `${state.pmWindowPosition.x}px`;
    elements.pmWindow.style.top = `${state.pmWindowPosition.y}px`;
    elements.pmWindowTitle.textContent = state.activePmUser.label || state.activePmUser.username;

    const targetUser = getConversationTarget(state.activePmUser.username);
    const canPm = canReplyToPmConversation(state.activePmUser.username);
    const online = Boolean(targetUser && targetUser.socketId);
    const callDisabled = !canPm || !online || !privateCallsEnabledForCurrentUser() || !privateCallsEnabledForUser(targetUser);

    elements.pmWindowInput.disabled = !canPm || !online;
    elements.pmSendBtn.disabled = !canPm || !online;
    elements.pmAudioBtn.disabled = callDisabled;
    elements.pmVideoBtn.disabled = callDisabled;
    elements.pmAudioBtn.title = callDisabled ? "Private calls are unavailable for this conversation right now" : "Start private voice call";
    elements.pmVideoBtn.title = callDisabled ? "Private calls are unavailable for this conversation right now" : "Start private video call";

    renderPmThread();
    renderPmRequestBanner();
    renderPmMedia();
  }

  function renderTyping() {
    if (!state.typingUsers.length) {
      elements.typingIndicator.textContent = "";
      return;
    }

    if (state.typingUsers.length === 1) {
      elements.typingIndicator.textContent = `${state.typingUsers[0]} is typing...`;
      return;
    }

    elements.typingIndicator.textContent = `${state.typingUsers.slice(0, 2).join(" and ")} are typing...`;
  }

  function getRtcConfig() {
    return {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    };
  }

  function closePeerConnection(socketId) {
    const existing = state.peerConnections.get(socketId);
    if (existing) {
      existing.close();
      state.peerConnections.delete(socketId);
    }

    state.remoteStreams.delete(socketId);
    delete state.remoteSettings[socketId];
  }

  function cleanupCallState() {
    Array.from(state.peerConnections.keys()).forEach(closePeerConnection);

    if (state.localStream) {
      state.localStream.getTracks().forEach(function (track) {
        track.stop();
      });
      state.localStream = null;
    }

    state.isPublishing = false;
    state.cameraEnabled = false;
    state.micEnabled = false;
    state.mediaPublishers = [];
    state.openMediaIds.clear();
    state.maximizedCallId = "";
    document.body.classList.remove("has-split-call");
    renderAccount();
    renderCallPanel();
  }

  function createPeerConnection(targetSocketId) {
    const existing = state.peerConnections.get(targetSocketId);
    if (existing) {
      return existing;
    }

    const connection = new RTCPeerConnection(getRtcConfig());

    if (state.localStream && state.isPublishing) {
      state.localStream.getTracks().forEach(function (track) {
        connection.addTrack(track, state.localStream);
      });
    }

    connection.onicecandidate = function (event) {
      if (event.candidate && state.socket) {
        state.socket.emit("webrtc ice candidate", {
          toSocketId: targetSocketId,
          candidate: event.candidate
        });
      }
    };

    connection.ontrack = function (event) {
      const stream = event.streams && event.streams[0]
        ? event.streams[0]
        : new MediaStream([event.track]);
      state.remoteStreams.set(targetSocketId, stream);
      state.remoteSettings[targetSocketId] = state.remoteSettings[targetSocketId] || {
        volume: 1,
        muted: true
      };
      renderCallPanel();
    };

    connection.onconnectionstatechange = function () {
      if (["closed", "failed", "disconnected"].includes(connection.connectionState)) {
        closePeerConnection(targetSocketId);
        renderCallPanel();
      }
    };

    state.peerConnections.set(targetSocketId, connection);
    return connection;
  }

  async function createOfferForParticipant(targetSocketId) {
    if (!state.localStream || !state.socket || !state.isPublishing || targetSocketId === state.currentSocketId) {
      return;
    }

    const connection = createPeerConnection(targetSocketId);
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    state.socket.emit("webrtc offer", {
      toSocketId: targetSocketId,
      description: connection.localDescription
    });
  }

  async function syncPeerConnections() {
    const participantIds = new Set(state.mediaPublishers.map(function (participant) {
      return participant.socketId;
    }));

    Object.keys(state.callLayout).forEach(function (socketId) {
      if (!participantIds.has(socketId)) {
        delete state.callLayout[socketId];
      }
    });

    Array.from(state.peerConnections.keys()).forEach(function (socketId) {
      if (!participantIds.has(socketId) || (!state.openMediaIds.has(socketId) && socketId !== state.currentSocketId)) {
        closePeerConnection(socketId);
      }
    });

    renderCallPanel();
  }

  async function startCall() {
    if (!state.me) {
      showToast("Sign in or join as guest before publishing a camera.", "error");
      return;
    }

    if (!window.isSecureContext) {
      showToast("Voice and video need HTTPS or localhost to access devices.", "error");
      return;
    }

    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      showToast("This browser does not support WebRTC room calls here.", "error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: "user" }
      });

      cleanupCallState();
      state.localStream = stream;
      state.isPublishing = true;
      state.cameraEnabled = true;
      state.micEnabled = true;
      state.openMediaIds.add(state.currentSocketId);
      setMicrophoneEnabled(true);
      renderAccount();
      renderCallPanel();

      if (state.socket) {
        state.socket.emit("start publishing");
      }
    } catch (error) {
      if (error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
        showToast("Browser permission was denied for microphone or camera.", "error");
        return;
      }

      if (error && (error.name === "NotFoundError" || error.name === "DevicesNotFoundError")) {
        showToast("No usable microphone or camera was found on this device.", "error");
        return;
      }

      if (error && error.name === "NotReadableError") {
        showToast("Your microphone or camera is busy in another app.", "error");
        return;
      }

      showToast(`Unable to start camera: ${error?.message || "unknown error"}`, "error");
    }
  }

  function leaveCall(announce) {
    if (announce !== false && state.socket && state.isPublishing) {
      state.socket.emit("stop publishing");
    }

    cleanupCallState();
  }

  function openUserMenu(socketId, username, clientX, clientY) {
    if (!socketId || socketId === state.currentSocketId) {
      return;
    }

    state.selectedUser = { socketId, username };
    elements.userMenuHeader.textContent = username;
    elements.menuPmBtn.disabled = !state.me || !state.me.canPrivateMessage;
    const user = state.users.find(function (entry) {
      return entry.socketId === socketId;
    });
    const canCall = Boolean(
      !state.me?.isGuest &&
      state.me?.canPrivateMessage &&
      user &&
      user.socketId &&
      privateCallsEnabledForCurrentUser() &&
      privateCallsEnabledForUser(user)
    );
    elements.menuCallAudioBtn.disabled = !canCall;
    elements.menuCallVideoBtn.disabled = !canCall;
    elements.menuCallAudioBtn.title = canCall ? `Start a voice call with ${username}` : "Voice calling is unavailable right now";
    elements.menuCallVideoBtn.title = canCall ? `Start a video call with ${username}` : "Video calling is unavailable right now";
    elements.menuFriendBtn.disabled = !state.me || state.me.isGuest;
    elements.menuFriendBtn.textContent = user && user.isFriend ? "Remove friend" : "Add friend";
    elements.menuBlockBtn.disabled = !state.me || state.me.isGuest;
    elements.menuBlockBtn.textContent = user && user.isBlocked ? "Unblock user" : "Block user";
    elements.userMenu.classList.remove("hidden");
    elements.userMenu.style.display = "grid";

    const rect = elements.userMenu.getBoundingClientRect();
    const x = Math.min(clientX, window.innerWidth - rect.width - 12);
    const y = Math.min(clientY, window.innerHeight - rect.height - 12);
    elements.userMenu.style.left = `${x}px`;
    elements.userMenu.style.top = `${y}px`;
  }

  function closeUserMenu() {
    elements.userMenu.classList.add("hidden");
    elements.userMenu.style.display = "";
  }

  function openAccountMenu() {
    if (!state.me) {
      return;
    }
    applyPreferences();
    positionAccountMenu();
    elements.accountMenu.classList.remove("hidden");
    elements.accountMenu.style.display = "grid";
    elements.accountBadge.setAttribute("aria-expanded", "true");
  }

  function closeAccountMenu() {
    elements.accountMenu.classList.add("hidden");
    elements.accountMenu.style.display = "";
    elements.accountBadge.setAttribute("aria-expanded", "false");
  }

  function openModal(overlay) {
    overlay.classList.remove("hidden");
  }

  function closeModal(overlay) {
    overlay.classList.add("hidden");
  }

  function sendActivityPing(force) {
    const now = Date.now();
    if (!state.socket) {
      return;
    }

    if (!force && now - state.lastActivityPingAt < 20000) {
      return;
    }

    state.lastActivityPingAt = now;
    state.socket.emit("activity ping");
  }

  function clampPmWindowPosition(position) {
    const maxX = Math.max(12, window.innerWidth - 430);
    const maxY = Math.max(80, window.innerHeight - 540);

    return {
      x: Math.min(Math.max(position.x, 12), maxX),
      y: Math.min(Math.max(position.y, 72), maxY)
    };
  }

  function positionPmInbox() {
    const buttonRect = elements.openInboxBtn.getBoundingClientRect();
    const panelWidth = Math.min(340, window.innerWidth - 24);
    const left = Math.min(
      Math.max(12, buttonRect.right - panelWidth),
      Math.max(12, window.innerWidth - panelWidth - 12)
    );
    const top = Math.min(buttonRect.bottom + 10, Math.max(72, window.innerHeight - 160));

    elements.pmInboxPopover.style.width = `${panelWidth}px`;
    elements.pmInboxPopover.style.left = `${left}px`;
    elements.pmInboxPopover.style.top = `${top}px`;
    elements.pmInboxPopover.style.maxHeight = `${Math.max(180, window.innerHeight - top - 12)}px`;
  }

  function openPmInbox() {
    state.pmInboxOpen = !state.pmInboxOpen;
    renderPmInbox();
    elements.pmInboxPopover.classList.toggle("hidden", !state.pmInboxOpen);
    elements.openInboxBtn.setAttribute("aria-expanded", state.pmInboxOpen ? "true" : "false");
    if (state.pmInboxOpen) {
      positionPmInbox();
    }
  }

  function closePmInbox() {
    state.pmInboxOpen = false;
    elements.pmInboxPopover.classList.add("hidden");
    elements.openInboxBtn.setAttribute("aria-expanded", "false");
  }

  function openPmConversation(userLike) {
    if (!userLike || !userLike.username) {
      return;
    }

    state.activePmUser = {
      username: userLike.username,
      label: userLike.displayName || userLike.label || userLike.username,
      socketId: userLike.socketId || (getConversationTarget(userLike.username) || {}).socketId || ""
    };
    delete state.pmUnread[userLike.username];
    updateInboxCount();
    renderPmInbox();
    renderPmWindow();
    closePmInbox();
    closeUserMenu();
    window.setTimeout(function () {
      elements.pmWindowInput.focus();
    }, 0);
  }

  function closePmWindow() {
    state.activePmUser = null;
    state.pmCall.incomingRequest = null;
    renderPmWindow();
  }

  function closePmCall() {
    if (state.pmCall.peerConnection) {
      state.pmCall.peerConnection.close();
    }

    if (state.pmCall.localStream) {
      state.pmCall.localStream.getTracks().forEach(function (track) {
        track.stop();
      });
    }

    state.pmCall = {
      targetSocketId: "",
      targetUsername: "",
      mode: "",
      localStream: null,
      remoteStream: null,
      peerConnection: null,
      incomingRequest: null,
      pendingRequest: null
    };
    renderPmWindow();
  }

  function endPmCall(announce) {
    if (announce !== false && state.socket && state.pmCall.targetSocketId) {
      state.socket.emit("pm media end", {
        toSocketId: state.pmCall.targetSocketId
      });
    }

    closePmCall();
  }

  function createPmPeerConnection(targetSocketId, mode) {
    if (state.pmCall.peerConnection) {
      return state.pmCall.peerConnection;
    }

    const connection = new RTCPeerConnection(getRtcConfig());
    if (state.pmCall.localStream) {
      state.pmCall.localStream.getTracks().forEach(function (track) {
        connection.addTrack(track, state.pmCall.localStream);
      });
    }

    connection.onicecandidate = function (event) {
      if (event.candidate && state.socket) {
        state.socket.emit("pm webrtc ice candidate", {
          toSocketId: targetSocketId,
          candidate: event.candidate
        });
      }
    };

    connection.ontrack = function (event) {
      state.pmCall.remoteStream = event.streams && event.streams[0]
        ? event.streams[0]
        : new MediaStream([event.track]);
      renderPmWindow();
    };

    connection.onconnectionstatechange = function () {
      if (["closed", "failed", "disconnected"].includes(connection.connectionState)) {
        closePmCall();
      }
    };

    state.pmCall.peerConnection = connection;
    state.pmCall.targetSocketId = targetSocketId;
    state.pmCall.mode = mode;
    return connection;
  }

  async function ensurePmLocalStream(mode) {
    if (state.pmCall.localStream) {
      return state.pmCall.localStream;
    }

    if (!window.isSecureContext) {
      throw new Error("Voice and video need HTTPS or localhost to access devices.");
    }

    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support private voice/video chat.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: mode === "video" ? { facingMode: "user" } : false
    });
    state.pmCall.localStream = stream;
    state.pmCall.mode = mode;
    renderPmWindow();
    return stream;
  }

  async function startPmCall(mode) {
    if (!state.socket || !state.activePmUser || !state.me || !state.me.canPrivateMessage) {
      showToast("Private calls are available for registered users.", "error");
      return;
    }
    if (!privateCallsEnabledForCurrentUser()) {
      showToast("Turn private calls back on in your account menu to start a call.", "error");
      return;
    }

    const targetUser = getConversationTarget(state.activePmUser.username);
    if (!targetUser || !targetUser.socketId) {
      showToast("That user is not online right now.", "error");
      return;
    }
    if (!privateCallsEnabledForUser(targetUser)) {
      showToast("That user is not accepting private calls right now.", "error");
      return;
    }

    try {
      endPmCall(false);
      await ensurePmLocalStream(mode);
      state.pmCall.targetSocketId = targetUser.socketId;
      state.pmCall.targetUsername = targetUser.username;
      state.pmCall.pendingRequest = {
        socketId: targetUser.socketId,
        mode
      };
      renderPmWindow();
      state.socket.emit("pm media request", {
        toSocketId: targetUser.socketId,
        mode
      });
      showToast(`Private ${mode} request sent to ${targetUser.username}.`, "success");
    } catch (error) {
      closePmCall();
      showToast(error.message || "Unable to start a private call.", "error");
    }
  }

  async function acceptPmCall() {
    const request = state.pmCall.incomingRequest;
    if (!request || !state.socket) {
      return;
    }
    if (!privateCallsEnabledForCurrentUser()) {
      declinePmCall();
      showToast("Private calls are turned off in your account settings.", "error");
      return;
    }

    try {
      endPmCall(false);
      await ensurePmLocalStream(request.mode);
      state.pmCall.targetSocketId = request.fromSocketId;
      state.pmCall.targetUsername = request.fromUsername;
      state.pmCall.incomingRequest = null;
      renderPmWindow();
      state.socket.emit("pm media accept", {
        toSocketId: request.fromSocketId,
        mode: request.mode
      });
    } catch (error) {
      showToast(error.message || "Unable to join the private call.", "error");
    }
  }

  function declinePmCall() {
    const request = state.pmCall.incomingRequest;
    if (!request || !state.socket) {
      return;
    }

    state.socket.emit("pm media decline", {
      toSocketId: request.fromSocketId
    });
    state.pmCall.incomingRequest = null;
    renderPmWindow();
  }

  function showChatShell() {
    elements.authShell.classList.add("hidden");
    elements.chatShell.classList.remove("hidden");
    renderAccount();
    renderRooms();
    renderMessages();
    renderUsers();
    renderPmInbox();
    renderPmWindow();
    renderTyping();
    renderCallPanel();
    applyPreferences();
    showRoomPicker();
  }

  function showAuthShell() {
    elements.chatShell.classList.add("hidden");
    elements.authShell.classList.remove("hidden");
    hideRoomPicker();
    setActiveTab("guest");
  }

  function connectSocket(authPayload) {
    if (state.socket) {
      leaveCall(false);
      endPmCall(false);
      state.socket.disconnect();
      state.socket = null;
    }

    const socket = io(backendUrl, {
      auth: authPayload,
      transports: ["websocket", "polling"]
    });

    state.socket = socket;

    socket.on("session ready", function (payload) {
      state.currentSocketId = payload.socketId;
      state.me = payload.user;
      state.lastActivityPingAt = 0;
      state.rooms = payload.rooms || state.rooms;
      applyPreferences();
      renderAccount();
      renderRooms();
      renderPmInbox();
      renderPmWindow();
      showChatShell();

      sendActivityPing(true);
    });

    socket.on("room list", function (rooms) {
      state.rooms = rooms;
      renderRooms();
    });

    socket.on("room history", function (payload) {
      state.activeRoom = payload.room.slug;
      localStorage.setItem(storageKeys.lastRoom, state.activeRoom);
      state.messages = payload.messages || [];
      renderRooms();
      renderMessages();
      renderCallPanel();
    });

    socket.on("chat message", function (message) {
      state.messages.push(message);
      renderMessages();
    });

    socket.on("system message", function (message) {
      state.messages.push(message);
      renderMessages();
    });

    socket.on("message deleted", function (payload) {
      if (payload.roomSlug !== state.activeRoom) {
        return;
      }

      state.messages = state.messages.filter(function (message) {
        return message.id !== payload.messageId;
      });
      renderMessages();
    });

    socket.on("user list", function (users) {
      state.users = users;
      renderUsers();
      renderPmWindow();
    });

    socket.on("typing update", function (typingUsers) {
      state.typingUsers = Array.isArray(typingUsers) ? typingUsers : [];
      renderTyping();
    });

    socket.on("room media state", async function (payload) {
      if (payload.roomSlug !== state.activeRoom) {
        return;
      }

      state.mediaPublishers = Array.isArray(payload.publishers) ? payload.publishers : [];
      await syncPeerConnections();
      renderAccount();
      renderCallPanel();
    });

    socket.on("private message", function (payload) {
      state.pmFeed.push(payload);
      savePmFeed();
      if (payload.direction === "incoming" && payload.counterpartUsername !== state.activePmUser?.username) {
        state.pmUnread[payload.counterpartUsername] = Number(state.pmUnread[payload.counterpartUsername] || 0) + 1;
        playPmNotification();
      }
      renderPmInbox();
      renderPmWindow();
      showToast(`Private message: ${payload.counterpartLabel || payload.from}`, "success");
    });

    socket.on("preferences updated", function (preferences) {
      if (!state.me) return;
      state.me.preferences = preferences;
      applyPreferences();
      renderMessages();
    });

    socket.on("friends updated", function (friends) {
      if (!state.me) return;
      state.me.friends = Array.isArray(friends) ? friends : [];
      renderUsers();
      renderFriends();
    });

    socket.on("presence updated", function (user) {
      state.me = user;
      renderAccount();
      renderUsers();
    });

    socket.on("room removed", function (payload) {
      leaveCall(false);
      showToast("This room was removed.", "success");
      if (payload.fallbackRoom) {
        state.activeRoom = payload.fallbackRoom.slug;
        joinRoom(payload.fallbackRoom.slug);
      } else {
        state.messages = [];
        renderMessages();
      }
    });

    socket.on("media view requested", async function (payload) {
      if (!state.isPublishing || !state.localStream) {
        return;
      }

      await createOfferForParticipant(payload.viewerSocketId);
    });

    socket.on("pm media request", function (payload) {
      if (!privateCallsEnabledForCurrentUser()) {
        socket.emit("pm media decline", {
          toSocketId: payload.fromSocketId
        });
        return;
      }
      state.pmCall.incomingRequest = payload;
      openPmConversation({
        username: payload.fromUsername,
        displayName: payload.fromDisplayName,
        socketId: payload.fromSocketId
      });
      playIncomingCallTone();
      renderPmWindow();
      showToast(`${payload.fromDisplayName || payload.fromUsername} wants to start a private ${payload.mode} chat.`, "success");
    });

    socket.on("pm media accept", async function (payload) {
      if (!state.pmCall.localStream) {
        return;
      }

      state.pmCall.pendingRequest = null;
      state.pmCall.targetSocketId = payload.fromSocketId;
      try {
        const connection = createPmPeerConnection(payload.fromSocketId, payload.mode);
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        socket.emit("pm webrtc offer", {
          toSocketId: payload.fromSocketId,
          description: connection.localDescription,
          mode: payload.mode
        });
      } catch (error) {
        closePmCall();
        showToast(error.message || "Private call setup failed.", "error");
      }
    });

    socket.on("pm media decline", function (payload) {
      if (payload.fromSocketId === state.pmCall.targetSocketId || state.pmCall.pendingRequest) {
        closePmCall();
        showToast(`${payload.fromUsername || "That user"} declined the private call.`, "error");
      }
    });

    socket.on("pm media end", function (payload) {
      if (payload.fromSocketId === state.pmCall.targetSocketId) {
        closePmCall();
        showToast("Private call ended.", "success");
      }
    });

    socket.on("pm webrtc offer", async function (payload) {
      if (!state.pmCall.localStream) {
        return;
      }

      try {
        state.pmCall.targetSocketId = payload.fromSocketId;
        const connection = createPmPeerConnection(payload.fromSocketId, payload.mode);
        await connection.setRemoteDescription(new RTCSessionDescription(payload.description));
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socket.emit("pm webrtc answer", {
          toSocketId: payload.fromSocketId,
          description: connection.localDescription
        });
      } catch (error) {
        closePmCall();
        showToast(error.message || "Unable to answer the private call.", "error");
      }
    });

    socket.on("pm webrtc answer", async function (payload) {
      if (!state.pmCall.peerConnection) {
        return;
      }

      await state.pmCall.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.description));
    });

    socket.on("pm webrtc ice candidate", async function (payload) {
      if (!state.pmCall.peerConnection) {
        return;
      }

      try {
        await state.pmCall.peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch (_error) {
        showToast("A private-call network candidate was skipped.", "error");
      }
    });

    socket.on("webrtc offer", async function (payload) {
      const connection = createPeerConnection(payload.fromSocketId);
      await connection.setRemoteDescription(new RTCSessionDescription(payload.description));
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      socket.emit("webrtc answer", {
        toSocketId: payload.fromSocketId,
        description: connection.localDescription
      });
    });

    socket.on("webrtc answer", async function (payload) {
      const connection = state.peerConnections.get(payload.fromSocketId);
      if (!connection) {
        return;
      }

      await connection.setRemoteDescription(new RTCSessionDescription(payload.description));
    });

    socket.on("webrtc ice candidate", async function (payload) {
      const connection = state.peerConnections.get(payload.fromSocketId);
      if (!connection) {
        return;
      }

      try {
        await connection.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch (_error) {
        showToast("A network candidate was skipped during call setup.", "error");
      }
    });

    socket.on("error message", function (message) {
      showToast(message, "error");
    });

    socket.on("connect_error", function (error) {
      if (state.token) {
        logout(false);
      } else {
        showAuthShell();
      }
      showToast(error.message || "Unable to connect right now.", "error");
    });
  }

  function joinRoom(roomSlug) {
    if (!state.socket || !roomSlug) return;
    if (state.isPublishing) {
      leaveCall();
    }
    state.activeRoom = roomSlug;
    localStorage.setItem(storageKeys.lastRoom, roomSlug);
    state.messages = [];
    state.mediaPublishers = [];
    state.openMediaIds.clear();
    renderCallPanel();
    renderRooms();
    renderMessages();
    hideRoomPicker();
    state.socket.emit("join room", { roomSlug });
  }

  function handleTypingInput() {
    if (!state.socket || !state.me) return;

    if (!state.isTyping) {
      state.isTyping = true;
      state.socket.emit("typing", { isTyping: true });
    }

    window.clearTimeout(state.typingTimer);
    state.typingTimer = window.setTimeout(function () {
      state.isTyping = false;
      if (state.socket) {
        state.socket.emit("typing", { isTyping: false });
      }
    }, 1000);
  }

  function stopTyping() {
    state.isTyping = false;
    window.clearTimeout(state.typingTimer);
    if (state.socket) {
      state.socket.emit("typing", { isTyping: false });
    }
  }

  async function bootstrap() {
    try {
      const payload = await api("/api/bootstrap");
      state.rooms = payload.rooms || [];

      if (state.token && payload.currentUser) {
        state.me = payload.currentUser;
        connectSocket({ token: state.token });
      } else if (state.token && !payload.currentUser) {
        logout(false);
      }
    } catch (error) {
      showToast(error.message, "error");
    }

    const savedGuestName = localStorage.getItem(storageKeys.guestName) || "";
    elements.guestName.value = savedGuestName;
    renderRooms();
    renderPmInbox();

    if (!state.token && savedGuestName && state.rooms.length) {
      connectSocket({ guestName: savedGuestName });
      return;
    }

    if (!state.token) {
      showAuthShell();
    }
  }

  async function handleGuestJoin(event) {
    event.preventDefault();

    const guestName = elements.guestName.value.trim();
    if (guestName.length < 2) {
      showToast("Pick a guest name with at least 2 characters.", "error");
      return;
    }

    localStorage.setItem(storageKeys.guestName, guestName);
    connectSocket({ guestName });
  }

  async function handleLogin(event) {
    event.preventDefault();

    try {
      const payload = await api("/api/auth/login", {
        method: "POST",
        body: {
          username: elements.loginUsername.value.trim(),
          password: elements.loginPassword.value
        }
      });

      state.token = payload.token;
      localStorage.setItem(storageKeys.token, payload.token);
      state.me = payload.user;
      showToast("Welcome back.", "success");
      connectSocket({ token: state.token });
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function handleRegister(event) {
    event.preventDefault();

    try {
      const payload = await api("/api/auth/register", {
        method: "POST",
        body: {
          displayName: elements.registerDisplayName.value.trim(),
          username: elements.registerUsername.value.trim(),
          password: elements.registerPassword.value
        }
      });

      state.token = payload.token;
      localStorage.setItem(storageKeys.token, payload.token);
      state.me = payload.user;
      showToast("Account created. You are in.", "success");
      connectSocket({ token: state.token });
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function handleCreateRoom(event) {
    event.preventDefault();

    try {
      const payload = await api("/api/rooms", {
        method: "POST",
        body: {
          name: elements.roomNameInput.value.trim(),
          description: elements.roomDescriptionInput.value.trim()
        }
      });

      closeModal(elements.roomModalOverlay);
      elements.roomForm.reset();
      showToast(`Room created: ${payload.room.name}`, "success");
      joinRoom(payload.room.slug);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function handleSavePreferences(event) {
    event.preventDefault();

    try {
      const payload = await api("/api/me/preferences", {
        method: "PATCH",
        body: {
          preferences: {
            fontFamily: elements.fontSelect.value,
            textColor: elements.accentColorInput.value,
            backgroundStyle: elements.backgroundStyleSelect.value,
            allowPrivateCalls: elements.allowPrivateCalls.checked,
            privacy: {
              allowGuestCameraView: elements.allowGuestCameraView.checked
            }
          }
        }
      });

      state.me = payload.user;
      applyPreferences();
      closeAccountMenu();
      showToast("Appearance updated.", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function logout(showMessage) {
    stopTyping();
    const wasGuest = Boolean(state.me && state.me.isGuest);
    leaveCall(false);
    endPmCall(false);

    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }

    state.token = "";
    state.me = null;
    state.currentSocketId = "";
    state.users = [];
    state.messages = [];
    state.typingUsers = [];
    state.pmUnread = {};
    state.activePmUser = null;
    closePmInbox();
    localStorage.removeItem(storageKeys.token);

    if (wasGuest) {
      localStorage.removeItem(storageKeys.guestName);
    }

    showAuthShell();

    if (showMessage !== false) {
      showToast("You left the chat.", "success");
    }
  }

  function handleMessageSubmit(event) {
    event.preventDefault();
    if (!state.socket) return;

    const message = elements.messageInput.value.trim();
    if (!message) return;

    state.socket.emit("chat message", { message });
    elements.messageInput.value = "";
    stopTyping();
    elements.messageInput.focus();
  }

  function openPmModal() {
    if (!state.selectedUser) return;

    if (!state.me || !state.me.canPrivateMessage) {
      showToast("Guests can reply to private messages, but only registered users can start them.", "error");
      return;
    }

    openPmConversation({
      username: state.selectedUser.username,
      displayName: state.selectedUser.username,
      socketId: state.selectedUser.socketId
    });
  }

  function openPmCallFromMenu(mode) {
    if (!state.selectedUser) {
      return;
    }

    openPmConversation({
      username: state.selectedUser.username,
      displayName: state.selectedUser.username,
      socketId: state.selectedUser.socketId
    });

    window.setTimeout(function () {
      startPmCall(mode);
    }, 30);
  }

  function sendPrivateMessage() {
    const message = elements.pmWindowInput.value.trim();
    const targetUser = state.activePmUser ? getConversationTarget(state.activePmUser.username) : null;
    if (!state.socket || !state.activePmUser || !targetUser || !targetUser.socketId || !message) return;
    if (!canReplyToPmConversation(state.activePmUser.username)) {
      showToast("Guests can only reply to private messages they have already received.", "error");
      return;
    }

    state.socket.emit("private message", {
      toSocketId: targetUser.socketId,
      message
    });
    elements.pmWindowInput.value = "";
    elements.pmWindowInput.focus();
  }

  async function handleDeleteRoom() {
    const room = roomBySlug(state.activeRoom);
    if (!room || !canManageActiveRoom()) {
      return;
    }

    const confirmed = window.confirm(`Delete "${room.name}" and its room history?`);
    if (!confirmed) {
      return;
    }

    try {
      await api(`/api/rooms/${encodeURIComponent(room.slug)}`, {
        method: "DELETE"
      });

      showToast(`Deleted room: ${room.name}`, "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function openPublishedMedia(socketId) {
    if (!state.socket || !socketId) {
      return;
    }

    const existing = state.remoteSettings[socketId] || { volume: 1, muted: false };
    state.remoteSettings[socketId] = {
      volume: existing.volume,
      muted: false
    };
    state.openMediaIds.add(socketId);
    renderCallPanel();

    if (socketId !== state.currentSocketId) {
      state.socket.emit("request media view", { toSocketId: socketId });
    }
  }

  function closePublishedMedia(socketId) {
    if (!socketId || socketId === state.currentSocketId) {
      return;
    }

    state.openMediaIds.delete(socketId);
    if (state.maximizedCallId === socketId) {
      state.maximizedCallId = "";
    }
    closePeerConnection(socketId);
    renderCallPanel();
  }

  function toggleCallFullscreen(socketId) {
    if (!socketId) {
      return;
    }

    state.maximizedCallId = state.maximizedCallId === socketId ? "" : socketId;
    renderCallPanel();
  }

  function getCallResizeEdges(card, event) {
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return {
      left: x <= CALL_EDGE_RESIZE_THRESHOLD,
      right: x >= rect.width - CALL_EDGE_RESIZE_THRESHOLD,
      top: y <= CALL_EDGE_RESIZE_THRESHOLD,
      bottom: y >= rect.height - CALL_EDGE_RESIZE_THRESHOLD
    };
  }

  function hasResizeEdge(edges) {
    return edges.left || edges.right || edges.top || edges.bottom;
  }

  function cursorForResizeEdges(edges) {
    if ((edges.left && edges.top) || (edges.right && edges.bottom)) {
      return "nwse-resize";
    }
    if ((edges.right && edges.top) || (edges.left && edges.bottom)) {
      return "nesw-resize";
    }
    if (edges.left || edges.right) {
      return "ew-resize";
    }
    if (edges.top || edges.bottom) {
      return "ns-resize";
    }
    return "";
  }

  async function toggleBlockedUser() {
    if (!state.selectedUser || !state.me || state.me.isGuest) {
      return;
    }

    const selected = state.users.find(function (user) {
      return user.socketId === state.selectedUser.socketId;
    });
    const action = selected && selected.isBlocked ? "remove" : "add";

    try {
      const payload = await api("/api/me/blocks", {
        method: "PATCH",
        body: {
          username: state.selectedUser.username,
          action
        }
      });

      state.me = payload.user;
      renderBlockedUsers();
      renderAccount();
      closeUserMenu();
      showToast(action === "add" ? `Blocked ${state.selectedUser.username}` : `Unblocked ${state.selectedUser.username}`, "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function toggleFriendUser() {
    if (!state.selectedUser || !state.me || state.me.isGuest) {
      return;
    }

    const selected = state.users.find(function (user) {
      return user.socketId === state.selectedUser.socketId;
    });
    const action = selected && selected.isFriend ? "remove" : "add";

    try {
      const payload = await api("/api/me/friends", {
        method: "PATCH",
        body: {
          username: state.selectedUser.username,
          action
        }
      });

      state.me = payload.user;
      renderAccount();
      renderUsers();
      closeUserMenu();
      showToast(action === "add" ? `Added ${state.selectedUser.username} as a friend` : `Removed ${state.selectedUser.username} from friends`, "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function toggleLocalMicrophone() {
    if (!state.isPublishing || !state.localStream) {
      return;
    }

    state.micEnabled = !state.micEnabled;
    setMicrophoneEnabled(state.micEnabled);

    if (state.socket) {
      state.socket.emit("update media status", {
        cameraEnabled: state.cameraEnabled,
        micEnabled: state.micEnabled
      });
    }

    renderAccount();
    renderCallPanel();
  }

  function toggleLocalCamera() {
    if (!state.isPublishing || !state.localStream) {
      return;
    }

    state.cameraEnabled = !state.cameraEnabled;
    state.localStream.getVideoTracks().forEach(function (track) {
      track.enabled = state.cameraEnabled;
    });

    if (state.socket) {
      state.socket.emit("update media status", {
        cameraEnabled: state.cameraEnabled,
        micEnabled: state.micEnabled
      });
    }

    renderCallPanel();
  }

  function handleCallPointerDown(event) {
    if (event.target.closest("button, input")) {
      return;
    }

    const handle = event.target.closest("[data-call-drag-handle='true']");
    const card = event.target.closest("[data-call-socket-id]");
    if (!card) {
      return;
    }

    const resizeEdges = getCallResizeEdges(card, event);
    const resizeMode = !handle && hasResizeEdge(resizeEdges);
    if (!resizeMode && !handle) {
      return;
    }

    const socketId = card.dataset.callSocketId;
    const currentPosition = state.callLayout[socketId] || {
      x: 0,
      y: 0,
      width: CALL_CARD_WIDTH,
      height: CALL_CARD_HEIGHT
    };
    state.draggingCall = {
      socketId,
      mode: resizeMode ? "resize" : "move",
      resizeEdges,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: currentPosition.x,
      originY: currentPosition.y,
      originWidth: currentPosition.width || CALL_CARD_WIDTH,
      originHeight: currentPosition.height || CALL_CARD_HEIGHT
    };

    card.classList.add("is-dragging");
    card.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleCallPointerMove(event) {
    if (!state.draggingCall || state.draggingCall.pointerId !== event.pointerId) {
      const card = event.target.closest ? event.target.closest("[data-call-socket-id]") : null;
      if (!card || event.target.closest("button, input")) {
        return;
      }
      const handle = event.target.closest("[data-call-drag-handle='true']");
      if (handle) {
        card.style.cursor = "grab";
        return;
      }
      const edges = getCallResizeEdges(card, event);
      card.style.cursor = hasResizeEdge(edges) ? cursorForResizeEdges(edges) : "";
      return;
    }

    const nextLayout = state.draggingCall.mode === "resize"
      ? (function () {
          const horizontalDelta = state.draggingCall.resizeEdges.left
            ? (state.draggingCall.startX - event.clientX)
            : (event.clientX - state.draggingCall.startX);
          const requestedWidth = state.draggingCall.originWidth + horizontalDelta;
          const size = normalizeCallSize(requestedWidth);
          const nextX = state.draggingCall.resizeEdges.left
            ? state.draggingCall.originX + (state.draggingCall.originWidth - size.width)
            : state.draggingCall.originX;
          const nextY = state.draggingCall.resizeEdges.top
            ? state.draggingCall.originY + (state.draggingCall.originHeight - size.height)
            : state.draggingCall.originY;
          return clampCallLayout({
            x: nextX,
            y: nextY,
            width: size.width,
            height: size.height
          });
        }())
      : clampCallLayout({
          x: state.draggingCall.originX + (event.clientX - state.draggingCall.startX),
          y: state.draggingCall.originY + (event.clientY - state.draggingCall.startY),
          width: state.draggingCall.originWidth,
          height: state.draggingCall.originHeight
        });

    state.callLayout[state.draggingCall.socketId] = nextLayout;
    const card = elements.callParticipants.querySelector(`[data-call-socket-id="${state.draggingCall.socketId}"]`);
    if (card) {
      card.style.left = `${nextLayout.x}px`;
      card.style.top = `${nextLayout.y}px`;
      card.style.width = `${nextLayout.width}px`;
      card.style.height = `${nextLayout.height}px`;
    }
  }

  function handleCallPointerUp(event) {
    if (!state.draggingCall || state.draggingCall.pointerId !== event.pointerId) {
      return;
    }

    const card = elements.callParticipants.querySelector(`[data-call-socket-id="${state.draggingCall.socketId}"]`);
    if (card) {
      card.classList.remove("is-dragging");
      card.releasePointerCapture?.(event.pointerId);
      card.style.cursor = "";
    }

    state.draggingCall = null;
    renderCallPanel();
  }

  function handlePmWindowPointerDown(event) {
    const handle = event.target.closest("[data-pm-drag-handle='true']");
    if (!handle) {
      return;
    }

    state.draggingPmWindow = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: state.pmWindowPosition.x,
      originY: state.pmWindowPosition.y
    };
    event.preventDefault();
  }

  function handlePmWindowPointerMove(event) {
    if (!state.draggingPmWindow || state.draggingPmWindow.pointerId !== event.pointerId) {
      return;
    }

    state.pmWindowPosition = clampPmWindowPosition({
      x: state.draggingPmWindow.originX + (event.clientX - state.draggingPmWindow.startX),
      y: state.draggingPmWindow.originY + (event.clientY - state.draggingPmWindow.startY)
    });
    renderPmWindow();
  }

  function handlePmWindowPointerUp(event) {
    if (!state.draggingPmWindow || state.draggingPmWindow.pointerId !== event.pointerId) {
      return;
    }

    state.draggingPmWindow = null;
  }

  function bindEvents() {
    elements.authTabs.addEventListener("click", function (event) {
      const button = event.target.closest("[data-tab]");
      if (!button) return;
      setActiveTab(button.dataset.tab);
    });

    elements.guestForm.addEventListener("submit", handleGuestJoin);
    elements.loginForm.addEventListener("submit", handleLogin);
    elements.registerForm.addEventListener("submit", handleRegister);
    elements.messageForm.addEventListener("submit", handleMessageSubmit);
    elements.messageInput.addEventListener("input", handleTypingInput);
    elements.messageInput.addEventListener("input", function () {
      sendActivityPing(false);
    });
    elements.callParticipants.addEventListener("pointerdown", handleCallPointerDown);
    elements.callParticipants.addEventListener("pointerdown", function (event) {
      if (event.target.closest("[data-close-local-camera='true'], [data-close-remote-camera], [data-call-fullscreen], [data-toggle-mic='true'], [data-toggle-camera='true'], [data-toggle-remote-mute], [data-remote-volume]")) {
        event.stopPropagation();
      }
    });
    elements.pmWindow.addEventListener("pointerdown", handlePmWindowPointerDown);
    elements.callParticipants.addEventListener("click", function (event) {
      if (event.target.closest("[data-close-local-camera='true']")) {
        event.preventDefault();
        event.stopPropagation();
        leaveCall();
        return;
      }

      const closeRemoteButton = event.target.closest("[data-close-remote-camera]");
      if (closeRemoteButton) {
        event.preventDefault();
        event.stopPropagation();
        closePublishedMedia(closeRemoteButton.dataset.closeRemoteCamera);
        return;
      }

      const fullscreenButton = event.target.closest("[data-call-fullscreen]");
      if (fullscreenButton) {
        toggleCallFullscreen(fullscreenButton.dataset.callFullscreen);
        return;
      }

      if (event.target.closest("[data-toggle-mic='true']")) {
        toggleLocalMicrophone();
        return;
      }

      if (event.target.closest("[data-toggle-camera='true']")) {
        toggleLocalCamera();
        return;
      }

      const remoteMuteButton = event.target.closest("[data-toggle-remote-mute]");
      if (remoteMuteButton) {
        const socketId = remoteMuteButton.dataset.toggleRemoteMute;
        const existing = state.remoteSettings[socketId] || { volume: 1, muted: true };
        state.remoteSettings[socketId] = {
          volume: existing.volume,
          muted: !existing.muted
        };
        renderCallPanel();
      }
    });
    elements.callParticipants.addEventListener("input", function (event) {
      const volumeSlider = event.target.closest("[data-remote-volume]");
      if (!volumeSlider) {
        return;
      }

      const socketId = volumeSlider.dataset.remoteVolume;
      const existing = state.remoteSettings[socketId] || { volume: 1, muted: true };
      state.remoteSettings[socketId] = {
        volume: Number(volumeSlider.value),
        muted: existing.muted
      };
      renderCallPanel();
    });
    elements.logoutBtn.addEventListener("click", function () {
      logout(true);
    });
    elements.presenceStatusSelect.addEventListener("change", function () {
      if (!state.socket) {
        return;
      }

      state.socket.emit("set presence status", {
        status: elements.presenceStatusSelect.value
      });
    });
    elements.openInboxBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      openPmInbox();
    });
    elements.joinAudioBtn.addEventListener("click", function () {
      if (state.isPublishing) {
        leaveCall();
        return;
      }

      startCall();
    });
    elements.deleteRoomBtn.addEventListener("click", handleDeleteRoom);

    elements.roomList.addEventListener("click", function (event) {
      const button = event.target.closest("[data-room-slug]");
      if (!button) return;
      joinRoom(button.dataset.roomSlug);
    });
    elements.roomPickerList.addEventListener("click", function (event) {
      const button = event.target.closest("[data-pick-room-slug]");
      if (!button) {
        return;
      }

      joinRoom(button.dataset.pickRoomSlug);
    });

    elements.usersList.addEventListener("click", function (event) {
      const openMediaButton = event.target.closest("[data-open-media-id]");
      if (openMediaButton) {
        event.preventDefault();
        event.stopPropagation();
        openPublishedMedia(openMediaButton.dataset.openMediaId);
      }
    });
    elements.friendsList.addEventListener("click", function (event) {
      const openMediaButton = event.target.closest("[data-open-media-id]");
      if (openMediaButton) {
        event.preventDefault();
        event.stopPropagation();
        openPublishedMedia(openMediaButton.dataset.openMediaId);
      }
    });
    elements.pmFeed.addEventListener("click", function (event) {
      const button = event.target.closest("[data-open-pm-user]");
      if (!button) {
        return;
      }

      openPmConversation({
        username: button.dataset.openPmUser,
        displayName: button.dataset.openPmUser
      });
    });

    const sidebarTabs = document.getElementById("sidebar-tabs");
    sidebarTabs.addEventListener("click", function (event) {
      const button = event.target.closest("[data-sidebar-tab]");
      if (!button) return;

      document.querySelectorAll("[data-sidebar-tab]").forEach(function (tabButton) {
        tabButton.classList.toggle("is-active", tabButton.dataset.sidebarTab === button.dataset.sidebarTab);
      });

      document.querySelectorAll("[data-sidebar-panel]").forEach(function (panel) {
        panel.classList.toggle("is-active", panel.dataset.sidebarPanel === button.dataset.sidebarTab);
      });
    });

    function userTriggerHandler(event) {
      const button = event.target.closest("[data-user-trigger='true']");
      if (!button) return;
      event.preventDefault();
      openUserMenu(
        button.dataset.socketId,
        button.dataset.username,
        event.clientX,
        event.clientY
      );
    }

    elements.messages.addEventListener("click", userTriggerHandler);
    elements.usersList.addEventListener("click", userTriggerHandler);
    elements.friendsList.addEventListener("click", userTriggerHandler);

    document.addEventListener("click", function (event) {
      if (event.target.closest("[data-user-trigger='true']") || event.target.closest("#user-menu")) {
        return;
      }
      closeUserMenu();

      if (event.target.closest("#account-badge") || event.target.closest("#account-menu")) {
        return;
      }
      closeAccountMenu();

      if (event.target.closest("#open-inbox-btn") || event.target.closest("#pm-inbox-popover")) {
        return;
      }
      closePmInbox();
      sendActivityPing(false);
    });

    document.addEventListener("keydown", function (event) {
      sendActivityPing(false);
      if (event.key === "Escape") {
        closeUserMenu();
        closeAccountMenu();
        closePmInbox();
        closePmWindow();
        closeModal(elements.roomModalOverlay);
      }
    });

    document.addEventListener("pointermove", handleCallPointerMove);
    document.addEventListener("pointerup", handleCallPointerUp);
    document.addEventListener("pointercancel", handleCallPointerUp);
    document.addEventListener("pointermove", handlePmWindowPointerMove);
    document.addEventListener("pointerup", handlePmWindowPointerUp);
    document.addEventListener("pointercancel", handlePmWindowPointerUp);
    window.addEventListener("resize", function () {
      if (state.pmInboxOpen) {
        positionPmInbox();
      }
      if (!elements.accountMenu.classList.contains("hidden")) {
        positionAccountMenu();
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        sendActivityPing(true);
      }
    });
    document.addEventListener("fullscreenchange", function () {
      if (!document.fullscreenElement && state.maximizedCallId) {
        state.maximizedCallId = "";
        renderCallPanel();
      }
    });

    elements.menuPmBtn.addEventListener("click", openPmModal);
    elements.menuCallAudioBtn.addEventListener("click", function () {
      openPmCallFromMenu("audio");
    });
    elements.menuCallVideoBtn.addEventListener("click", function () {
      openPmCallFromMenu("video");
    });
    elements.menuFriendBtn.addEventListener("click", toggleFriendUser);
    elements.menuBlockBtn.addEventListener("click", toggleBlockedUser);
    elements.pmWindowCloseBtn.addEventListener("click", closePmWindow);
    elements.pmWindowForm.addEventListener("submit", function (event) {
      event.preventDefault();
      sendPrivateMessage();
    });
    elements.pmWindowInput.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }

      event.preventDefault();
      sendPrivateMessage();
    });
    elements.pmAudioBtn.addEventListener("click", function () {
      startPmCall("audio");
    });
    elements.pmVideoBtn.addEventListener("click", function () {
      startPmCall("video");
    });
    elements.pmEndCallBtn.addEventListener("click", function () {
      endPmCall();
    });
    elements.pmRequestBanner.addEventListener("click", function (event) {
      if (event.target.closest("[data-accept-pm-call='true']")) {
        acceptPmCall();
      }

      if (event.target.closest("[data-decline-pm-call='true']")) {
        declinePmCall();
      }
    });

    elements.openRoomModalBtn.addEventListener("click", function () {
      closeAccountMenu();
      openModal(elements.roomModalOverlay);
      window.setTimeout(function () {
        elements.roomNameInput.focus();
      }, 0);
    });
    elements.roomCancelBtn.addEventListener("click", function () {
      closeModal(elements.roomModalOverlay);
    });
    elements.roomForm.addEventListener("submit", handleCreateRoom);

    elements.accountBadge.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (elements.accountMenu.classList.contains("hidden")) {
        openAccountMenu();
      } else {
        closeAccountMenu();
      }
    });
    elements.accountMenuCloseBtn.addEventListener("click", function () {
      closeAccountMenu();
    });
    elements.preferencesForm.addEventListener("submit", handleSavePreferences);
    elements.blockedUsersList.addEventListener("click", function (event) {
      const unblockButton = event.target.closest("[data-unblock-username]");
      if (!unblockButton) {
        return;
      }

      state.selectedUser = {
        username: unblockButton.dataset.unblockUsername,
        socketId: ""
      };
      toggleBlockedUser();
    });

    [
      elements.roomModalOverlay
    ].forEach(function (overlay) {
      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) {
          closeModal(overlay);
        }
      });
    });
  }

  bindEvents();
  bootstrap();
})();
  function positionAccountMenu() {
    const buttonRect = elements.accountBadge.getBoundingClientRect();
    const panelWidth = Math.min(360, window.innerWidth - 24);
    const left = Math.min(
      Math.max(12, buttonRect.right - panelWidth),
      Math.max(12, window.innerWidth - panelWidth - 12)
    );
    const top = Math.min(buttonRect.bottom + 10, Math.max(72, window.innerHeight - 180));
    elements.accountMenu.style.width = `${panelWidth}px`;
    elements.accountMenu.style.left = `${left}px`;
    elements.accountMenu.style.top = `${top}px`;
    elements.accountMenu.style.maxHeight = `${Math.max(220, window.innerHeight - top - 12)}px`;
  }
