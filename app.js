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
  const CALL_CARD_MIN_HEIGHT = 120;

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
    openRoomModalBtn: document.getElementById("open-room-modal-btn"),
    deleteRoomBtn: document.getElementById("delete-room-btn"),
    openPreferencesInlineBtn: document.getElementById("open-preferences-inline-btn"),
    logoutBtn: document.getElementById("logout-btn"),
    guestUpgradeCard: document.getElementById("guest-upgrade-card"),
    roomList: document.getElementById("room-list"),
    roomTitle: document.getElementById("room-title"),
    roomDescription: document.getElementById("room-description"),
    callParticipants: document.getElementById("call-participants"),
    roomPickerOverlay: document.getElementById("room-picker-overlay"),
    roomPickerList: document.getElementById("room-picker-list"),
    joinAudioBtn: document.getElementById("join-audio-btn"),
    messages: document.getElementById("messages"),
    messageForm: document.getElementById("message-form"),
    messageInput: document.getElementById("message-input"),
    typingIndicator: document.getElementById("typing-indicator"),
    usersList: document.getElementById("users-list"),
    pmFeed: document.getElementById("pm-feed"),
    userMenu: document.getElementById("user-menu"),
    userMenuHeader: document.getElementById("user-menu-header"),
    menuPmBtn: document.getElementById("menu-pm-btn"),
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
    preferencesModalOverlay: document.getElementById("preferences-modal-overlay"),
    preferencesForm: document.getElementById("preferences-form"),
    preferencesCancelBtn: document.getElementById("preferences-cancel-btn"),
    fontSelect: document.getElementById("font-select"),
    accentColorInput: document.getElementById("accent-color-input"),
    backgroundStyleSelect: document.getElementById("background-style-select"),
    allowGuestCameraView: document.getElementById("allow-guest-camera-view"),
    blockedUsersList: document.getElementById("blocked-users-list"),
    toastStack: document.getElementById("toast-stack")
  };

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
      volumeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"></path><path d="M16 9l5 5"></path><path d="M21 9l-5 5"></path></svg>'
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
      backgroundStyle: "aurora"
    };

    document.body.dataset.backgroundStyle = preferences.backgroundStyle;

    elements.fontSelect.value = preferences.fontFamily;
    elements.accentColorInput.value = preferences.textColor;
    elements.backgroundStyleSelect.value = preferences.backgroundStyle;
    elements.allowGuestCameraView.checked = preferences.privacy?.allowGuestCameraView !== false;
    elements.messageInput.style.cssText = styleFromPreferences(preferences);
    elements.pmWindowInput.style.cssText = styleFromPreferences(preferences);
    renderBlockedUsers();
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

  function renderAccount() {
    if (!state.me) return;

    const roleLabel = state.me.isGuest
      ? '<span>Guest account</span>'
      : verifiedBadgeMarkup();
    elements.accountBadge.innerHTML = `
      <strong>${escapeHtml(state.me.displayName || state.me.username)}</strong>
      ${roleLabel}
    `;

    elements.openRoomModalBtn.classList.toggle("hidden", !state.me.canCreateRooms);
    elements.openPreferencesInlineBtn.classList.toggle("hidden", !state.me.canCustomize);
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
      elements.roomTitle.textContent = activeRoom.name;
      elements.roomDescription.textContent = activeRoom.description;
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

  function clampCallLayout(layout) {
    const width = Math.max(CALL_CARD_MIN_WIDTH, Math.min(layout.width || CALL_CARD_WIDTH, window.innerWidth - 24));
    const height = Math.max(CALL_CARD_MIN_HEIGHT, Math.min(layout.height || CALL_CARD_HEIGHT, window.innerHeight - 84));
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
      return;
    }

    visiblePublishers.forEach(function (participant) {
      const card = document.createElement("article");
      const remoteStream = state.remoteStreams.get(participant.socketId);
      const showVideo = participant.socketId === state.currentSocketId
        ? Boolean(state.localStream && state.cameraEnabled)
        : Boolean(remoteStream && participant.cameraEnabled);
      card.className = `call-card${showVideo ? "" : " is-audio-only is-camera-off"}`;
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
          ${participant.socketId === state.currentSocketId ? `
            <button
              type="button"
              class="call-close-btn"
              data-close-local-camera="true"
              aria-label="Close your camera"
              title="Stop publishing your camera"
            >X</button>
          ` : ""}
          <button
            type="button"
            class="call-fullscreen-btn"
            data-call-fullscreen="${escapeHtml(participant.socketId)}"
            aria-label="Fullscreen camera"
            title="Fullscreen camera"
          >[]</button>
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
        const remoteSettings = state.remoteSettings[participant.socketId] || { volume: 1, muted: true };
        remoteVideo.volume = remoteSettings.volume;
        remoteVideo.muted = remoteSettings.muted;
        card.appendChild(remoteVideo);
        const playAttempt = remoteVideo.play();
        if (playAttempt && typeof playAttempt.catch === "function") {
          playAttempt.catch(function () {
            remoteVideo.muted = true;
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
        const remoteSettings = state.remoteSettings[participant.socketId] || { volume: 1, muted: true };
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

      const resizeHandle = document.createElement("button");
      resizeHandle.type = "button";
      resizeHandle.className = "call-resize-handle";
      resizeHandle.dataset.callResizeHandle = "true";
      resizeHandle.setAttribute("aria-label", "Resize camera");
      resizeHandle.title = "Resize camera";
      resizeHandle.textContent = "◢";
      card.appendChild(resizeHandle);
      elements.callParticipants.appendChild(card);
    });
  }

  function canDeleteMessage(message) {
    const activeRoom = roomBySlug(state.activeRoom);
    if (!state.me || !activeRoom || message.kind === "system") {
      return false;
    }

    if (!state.me.isGuest && message.senderId && message.senderId === state.me.id) {
      return true;
    }

    return canManageActiveRoom();
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

      const meta = document.createElement("div");
      meta.className = "message-meta";

      if (message.kind === "system") {
        meta.innerHTML = `
          <span class="room-role-tag">System</span>
          <span class="time-label">${escapeHtml(formatTime(message))}</span>
        `;
      } else {
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
          : "Guest";
        left.appendChild(role);

        meta.appendChild(left);

        const time = document.createElement("span");
        time.className = "time-label";
        time.textContent = formatTime(message);
        meta.appendChild(time);
      }

      const body = document.createElement("div");
      body.className = "message-bubble";
      body.appendChild(meta);

      const text = document.createElement("div");
      text.className = "message-text";
      text.textContent = message.message;
      text.style.cssText = styleFromPreferences(message.preferences);
      body.appendChild(text);

      if (canDeleteMessage(message)) {
        const actions = document.createElement("div");
        actions.className = "message-actions";
        actions.innerHTML = `
          <button
            type="button"
            class="inline-action"
            data-delete-message-id="${escapeHtml(message.id)}"
          >Delete</button>
        `;
        body.appendChild(actions);
      }

      item.appendChild(body);
      elements.messages.appendChild(item);
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
            <div class="user-name-trigger is-self">
              <span class="user-name-line" style="${escapeHtml(styleFromPreferences(user.preferences))}">
                <strong>${escapeHtml(user.displayName || user.username)}</strong>
                <span class="user-badge-text">You</span>
                ${user.isGuest ? '<span class="user-badge-text">Guest</span>' : verifiedBadgeMarkup()}
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
              </span>
            </div>
          ` : `
            <button
              type="button"
              class="user-name-trigger"
              data-user-trigger="true"
              data-socket-id="${escapeHtml(user.socketId)}"
              data-username="${escapeHtml(user.username)}"
            >
              <span class="user-name-line" style="${escapeHtml(styleFromPreferences(user.preferences))}">
                <strong>${escapeHtml(user.displayName || user.username)}</strong>
                ${user.isGuest ? '<span class="user-badge-text">Guest</span>' : verifiedBadgeMarkup()}
                ${user.isPublishing ? `
                  <span class="user-cam-icon">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M15 10.5 19.5 7v10L15 13.5"></path>
                      <rect x="3" y="6" width="12" height="12" rx="2" ry="2"></rect>
                    </svg>
                  </span>
                ` : ""}
              </span>
            </button>
          `}
          ${user.isPublishing && !isSelf ? `
            <button
              type="button"
              class="user-cam-btn"
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
      `;
      elements.usersList.appendChild(item);
    });
  }

  function getConversationUsername(entry) {
    if (entry.counterpartUsername) {
      return entry.counterpartUsername;
    }

    if (entry.direction === "incoming") {
      return entry.fromUsername || "";
    }

    if (entry.direction === "outgoing" && entry.toUsername) {
      return entry.toUsername;
    }

    const match = String(entry.from || "").match(/^\(to ([^)]+)\)$/);
    return match ? match[1] : "";
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

    return Array.from(map.values()).sort(function (left, right) {
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

    if (state.me && state.me.isGuest) {
      elements.pmFeed.innerHTML = '<li class="empty-state">Private messages unlock after creating an account.</li>';
      return;
    }

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
    const canPm = Boolean(state.me && state.me.canPrivateMessage);
    const online = Boolean(targetUser && targetUser.socketId);
    const callDisabled = !canPm || !online;

    elements.pmWindowInput.disabled = !canPm || !online;
    elements.pmSendBtn.disabled = !canPm || !online;
    elements.pmAudioBtn.disabled = callDisabled;
    elements.pmVideoBtn.disabled = callDisabled;
    elements.pmAudioBtn.title = callDisabled ? "User must be online to start a private call" : "Start private voice call";
    elements.pmVideoBtn.title = callDisabled ? "User must be online to start a private call" : "Start private video call";

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
    elements.menuBlockBtn.disabled = !state.me || state.me.isGuest;
    elements.menuBlockBtn.textContent = user && user.isBlocked ? "Unblock user" : "Block user";
    elements.userMenu.classList.remove("hidden");

    const rect = elements.userMenu.getBoundingClientRect();
    const x = Math.min(clientX, window.innerWidth - rect.width - 12);
    const y = Math.min(clientY, window.innerHeight - rect.height - 12);
    elements.userMenu.style.left = `${x}px`;
    elements.userMenu.style.top = `${y}px`;
  }

  function closeUserMenu() {
    elements.userMenu.classList.add("hidden");
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

  function openPmInbox() {
    state.pmInboxOpen = !state.pmInboxOpen;
    elements.pmInboxPopover.classList.toggle("hidden", !state.pmInboxOpen);
  }

  function closePmInbox() {
    state.pmInboxOpen = false;
    elements.pmInboxPopover.classList.add("hidden");
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

    const targetUser = getConversationTarget(state.activePmUser.username);
    if (!targetUser || !targetUser.socketId) {
      showToast("That user is not online right now.", "error");
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
      }
      renderPmInbox();
      renderPmWindow();
      showToast(`Private message: ${payload.counterpartLabel || payload.from}`, "success");
    });

    socket.on("preferences updated", function (preferences) {
      if (!state.me) return;
      state.me.preferences = preferences;
      applyPreferences();
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
      state.pmCall.incomingRequest = payload;
      openPmConversation({
        username: payload.fromUsername,
        displayName: payload.fromDisplayName,
        socketId: payload.fromSocketId
      });
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
            privacy: {
              allowGuestCameraView: elements.allowGuestCameraView.checked
            }
          }
        }
      });

      state.me = payload.user;
      applyPreferences();
      closeModal(elements.preferencesModalOverlay);
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
      showToast("Create an account to unlock private messages.", "error");
      return;
    }

    openPmConversation({
      username: state.selectedUser.username,
      displayName: state.selectedUser.username,
      socketId: state.selectedUser.socketId
    });
  }

  function sendPrivateMessage() {
    const message = elements.pmWindowInput.value.trim();
    const targetUser = state.activePmUser ? getConversationTarget(state.activePmUser.username) : null;
    if (!state.socket || !state.activePmUser || !targetUser || !targetUser.socketId || !message) return;

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

  function handleMessageActions(event) {
    const deleteButton = event.target.closest("[data-delete-message-id]");
    if (!deleteButton || !state.socket) {
      return;
    }

    const messageId = deleteButton.dataset.deleteMessageId;
    state.socket.emit("delete message", { messageId });
  }

  function openPublishedMedia(socketId) {
    if (!state.socket || !socketId) {
      return;
    }

    state.openMediaIds.add(socketId);
    renderCallPanel();

    if (socketId !== state.currentSocketId) {
      state.socket.emit("request media view", { toSocketId: socketId });
    }
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
    const resizeHandle = event.target.closest("[data-call-resize-handle='true']");
    const handle = event.target.closest("[data-call-drag-handle='true']");
    const card = (resizeHandle || handle) ? (resizeHandle || handle).closest("[data-call-socket-id]") : null;
    if (!card) {
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
      mode: resizeHandle ? "resize" : "move",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: currentPosition.x,
      originY: currentPosition.y,
      originWidth: currentPosition.width || CALL_CARD_WIDTH,
      originHeight: currentPosition.height || CALL_CARD_HEIGHT
    };

    card.classList.add("is-dragging");
    event.preventDefault();
  }

  function handleCallPointerMove(event) {
    if (!state.draggingCall || state.draggingCall.pointerId !== event.pointerId) {
      return;
    }

    const nextLayout = state.draggingCall.mode === "resize"
      ? clampCallLayout({
          x: state.draggingCall.originX,
          y: state.draggingCall.originY,
          width: state.draggingCall.originWidth + (event.clientX - state.draggingCall.startX),
          height: state.draggingCall.originHeight + (event.clientY - state.draggingCall.startY)
        })
      : clampCallLayout({
          x: state.draggingCall.originX + (event.clientX - state.draggingCall.startX),
          y: state.draggingCall.originY + (event.clientY - state.draggingCall.startY),
          width: state.draggingCall.originWidth,
          height: state.draggingCall.originHeight
        });

    state.callLayout[state.draggingCall.socketId] = nextLayout;
    renderCallPanel();
  }

  function handleCallPointerUp(event) {
    if (!state.draggingCall || state.draggingCall.pointerId !== event.pointerId) {
      return;
    }

    const card = elements.callParticipants.querySelector(`[data-call-socket-id="${state.draggingCall.socketId}"]`);
    if (card) {
      card.classList.remove("is-dragging");
    }

    state.draggingCall = null;
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
    elements.messages.addEventListener("click", handleMessageActions);
    elements.callParticipants.addEventListener("pointerdown", handleCallPointerDown);
    elements.pmWindow.addEventListener("pointerdown", handlePmWindowPointerDown);
    elements.callParticipants.addEventListener("click", function (event) {
      if (event.target.closest("[data-close-local-camera='true']")) {
        leaveCall();
        return;
      }

      const fullscreenButton = event.target.closest("[data-call-fullscreen]");
      if (fullscreenButton) {
        const card = fullscreenButton.closest("[data-call-socket-id]");
        if (card && card.requestFullscreen) {
          card.requestFullscreen().catch(function () {
            showToast("Fullscreen was blocked by the browser.", "error");
          });
        }
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

    document.addEventListener("click", function (event) {
      if (event.target.closest("[data-user-trigger='true']") || event.target.closest("#user-menu")) {
        return;
      }
      closeUserMenu();

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
        closePmInbox();
        closePmWindow();
        closeModal(elements.roomModalOverlay);
        closeModal(elements.preferencesModalOverlay);
      }
    });

    document.addEventListener("pointermove", handleCallPointerMove);
    document.addEventListener("pointerup", handleCallPointerUp);
    document.addEventListener("pointercancel", handleCallPointerUp);
    document.addEventListener("pointermove", handlePmWindowPointerMove);
    document.addEventListener("pointerup", handlePmWindowPointerUp);
    document.addEventListener("pointercancel", handlePmWindowPointerUp);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        sendActivityPing(true);
      }
    });

    elements.menuPmBtn.addEventListener("click", openPmModal);
    elements.menuBlockBtn.addEventListener("click", toggleBlockedUser);
    elements.pmWindowCloseBtn.addEventListener("click", closePmWindow);
    elements.pmWindowForm.addEventListener("submit", function (event) {
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
      openModal(elements.roomModalOverlay);
      window.setTimeout(function () {
        elements.roomNameInput.focus();
      }, 0);
    });
    elements.roomCancelBtn.addEventListener("click", function () {
      closeModal(elements.roomModalOverlay);
    });
    elements.roomForm.addEventListener("submit", handleCreateRoom);

    elements.openPreferencesInlineBtn.addEventListener("click", function () {
      applyPreferences();
      openModal(elements.preferencesModalOverlay);
    });
    elements.preferencesCancelBtn.addEventListener("click", function () {
      closeModal(elements.preferencesModalOverlay);
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
      elements.roomModalOverlay,
      elements.preferencesModalOverlay
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
