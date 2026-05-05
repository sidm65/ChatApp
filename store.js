import { computed, inject, provide, ref, watch } from "vue";
import {
  useGraffiti,
  useGraffitiDiscover,
  useGraffitiSession,
} from "@graffiti-garden/wrapper-vue";

const CourtConnectStoreKey = Symbol("CourtConnectStore");

const profileChannel = "sidmdesignftw-v4";
const chatDirectoryChannel = "sidmdesignftw-v4-chats";
const lobbyChannel = "sidmdesignftw-v4-match-lobby";
const MAX_NAME_LENGTH = 15;

const emptyProfileForm = () => ({
  name: "",
  sports: [],
  utr: "",
  utrp: "",
});

const emptyMatchForm = () => ({
  sport: "tennis",
  location: "MIT",
  ratingType: "UTR",
  rating: 4,
  format: "singles",
  date: "",
  time: "",
  costPerSpot: 0,
});

const profileSchema = {
  properties: {
    value: {
      required: ["activity", "type", "name", "sports", "published"],
      properties: {
        activity: { const: "Create" },
        type: { const: "Profile" },
        name: { type: "string" },
        sports: { type: "array" },
        icon: { type: "string" },
        utr: { type: "number" },
        utrp: { type: "number" },
        published: { type: "number" },
      },
    },
  },
};

const chatSchema = {
  properties: {
    value: {
      required: ["activity", "type", "channel", "participants", "published"],
      properties: {
        activity: { const: "Create" },
        type: { const: "Chat" },
        channel: { type: "string" },
        participants: { type: "array" },
        published: { type: "number" },
      },
    },
  },
};

const messageSchema = {
  properties: {
    value: {
      required: ["activity", "type", "content", "published"],
      properties: {
        activity: { const: "Send" },
        type: { const: "Message" },
        content: { type: "string" },
        published: { type: "number" },
      },
    },
  },
};

const matchSchema = {
  properties: {
    value: {
      required: ["activity", "type", "published"],
      properties: {
        activity: { enum: ["Post", "Join"] },
        type: { type: "string" },
        published: { type: "number" },
      },
    },
  },
};

function clipName(name) {
  return String(name || "").trim().slice(0, MAX_NAME_LENGTH);
}

function toOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

function isWithinOptionalRange(value, min, max) {
  return value === undefined || (value >= min && value <= max);
}

function dmChannel(actorA, actorB) {
  return "sidmdesignftw-v4-dm-" + [actorA, actorB].sort().join("-");
}

function matchChatChannel(matchId) {
  return `sidmdesignftw-v4-match-chat-${matchId}`;
}

function buildProfileValue(form, icon) {
  const utr = toOptionalNumber(form.utr);
  const utrp = toOptionalNumber(form.utrp);
  const value = {
    activity: "Create",
    type: "Profile",
    name: clipName(form.name),
    sports: [...form.sports],
    published: Date.now(),
  };

  if (icon) {
    value.icon = icon;
  }
  if (utr !== undefined) {
    value.utr = utr;
  }
  if (utrp !== undefined) {
    value.utrp = utrp;
  }

  return value;
}

function buildChatValue(channel, actorA, actorB, nameA, nameB) {
  return {
    activity: "Create",
    type: "Chat",
    channel,
    participants: [actorA, actorB],
    names: [nameA, nameB],
    published: Date.now(),
  };
}

function buildMessageValue(content) {
  return {
    activity: "Send",
    type: "Message",
    content,
    published: Date.now(),
  };
}

function buildMatchValue(form) {
  return {
    activity: "Post",
    type: "Match",
    sport: form.sport,
    location: form.location,
    ratingType: form.ratingType,
    rating: Number(form.rating),
    format: form.format,
    date: form.date,
    time: form.time,
    costPerSpot: Number(form.costPerSpot),
    openSeats: form.format === "singles" ? 1 : 3,
    matchId: crypto.randomUUID(),
    published: Date.now(),
  };
}

function buildJoinValue(matchId) {
  return {
    activity: "Join",
    type: "Match",
    target: matchId,
    published: Date.now(),
  };
}

function createCourtConnectStore() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const activeChatMode = ref("");
  const activeChatActor = ref("");
  const activeMatchChatId = ref("");
  const pendingMatchId = ref("");
  const openingChatFor = ref("");
  const localChatChannels = ref({});
  const profileForm = ref(emptyProfileForm());
  const matchForm = ref(emptyMatchForm());
  const messageText = ref("");
  const savingProfile = ref(false);
  const postingMatch = ref(false);
  const sendingMessage = ref(false);
  const joiningMatchId = ref("");
  const deletingMatchId = ref("");
  const toast = ref(null);
  const profileError = ref("");
  const profileLoaded = ref(false);
  const selectedProfilePhoto = ref(null);
  const selectedProfilePhotoName = ref("");
  const removeProfilePhoto = ref(false);
  let toastTimeoutId = 0;

  const { objects: profileObjects, isFirstPoll: profilesLoading, poll: pollProfiles } =
    useGraffitiDiscover([profileChannel], profileSchema);

  const { objects: chatObjects, poll: pollChats } = useGraffitiDiscover(
    [chatDirectoryChannel],
    chatSchema,
    session,
  );

  const { objects: matchObjects, isFirstPoll: matchesLoading, poll: pollMatches } =
    useGraffitiDiscover([lobbyChannel], matchSchema);

  const myActor = computed(() => session.value?.actor || "");

  const latestProfiles = computed(() => {
    const byActor = {};
    for (const object of profileObjects.value) {
      if (!byActor[object.actor] || byActor[object.actor].value.published < object.value.published) {
        byActor[object.actor] = object;
      }
    }
    return Object.values(byActor);
  });

  const profilesByActor = computed(() => {
    return Object.fromEntries(latestProfiles.value.map((object) => [object.actor, object]));
  });

  const myProfile = computed(() => profilesByActor.value[myActor.value]);
  const currentProfilePhotoUrl = computed(() => {
    if (removeProfilePhoto.value) {
      return "";
    }
    return myProfile.value?.value.icon || "";
  });
  const currentProfileHasPhoto = computed(() => !!myProfile.value?.value.icon && !removeProfilePhoto.value);
  const profileReady = computed(() => !!myProfile.value);
  const appReady = computed(() => !!session.value && profileReady.value);
  const normalizedProfileName = computed(() => clipName(profileForm.value.name).toLowerCase());
  const nameTooLong = computed(() => String(profileForm.value.name || "").trim().length > MAX_NAME_LENGTH);
  const profileUtr = computed(() => toOptionalNumber(profileForm.value.utr));
  const profileUtrp = computed(() => toOptionalNumber(profileForm.value.utrp));
  const invalidUtr = computed(() => {
    return (
      profileForm.value.utr !== "" &&
      !isWithinOptionalRange(profileUtr.value, 1, 16)
    );
  });
  const invalidUtrp = computed(() => {
    return (
      profileForm.value.utrp !== "" &&
      !isWithinOptionalRange(profileUtrp.value, 1, 10)
    );
  });

  const duplicateName = computed(() => {
    if (!normalizedProfileName.value) {
      return false;
    }

    return latestProfiles.value.some(
      (object) =>
        object.actor !== myActor.value &&
        clipName(object.value.name).toLowerCase() === normalizedProfileName.value,
    );
  });

  const canSaveProfile = computed(() => {
    return (
      !!clipName(profileForm.value.name) &&
      profileForm.value.sports.length > 0 &&
      !duplicateName.value &&
      !nameTooLong.value &&
      !invalidUtr.value &&
      !invalidUtrp.value
    );
  });

  const people = computed(() => {
    return latestProfiles.value
      .filter((object) => object.actor !== myActor.value)
      .toSorted((a, b) => clipName(a.value.name).localeCompare(clipName(b.value.name)));
  });

  const profileNames = computed(() => {
    return Object.fromEntries(
      latestProfiles.value.map((object) => [object.actor, clipName(object.value.name)]),
    );
  });

  const activePerson = computed(() => {
    return people.value.find((object) => object.actor === activeChatActor.value);
  });

  const myChats = computed(() => {
    return chatObjects.value.filter((object) => object.value.participants.includes(myActor.value));
  });

  const activeChat = computed(() => {
    if (!myActor.value || !activeChatActor.value) {
      return undefined;
    }

    return myChats.value
      .filter((object) => object.value.participants.includes(activeChatActor.value))
      .toSorted((a, b) => b.value.published - a.value.published)[0];
  });

  const matchPosts = computed(() => {
    return matchObjects.value
      .filter((object) => object.value.activity === "Post" && object.value.type === "Match")
      .toSorted((a, b) => b.value.published - a.value.published);
  });

  const joinObjects = computed(() => {
    return matchObjects.value.filter(
      (object) => object.value.activity === "Join" && object.value.type === "Match",
    );
  });

  const matchCards = computed(() => {
    return matchPosts.value.map((match) => {
      const joiners = joinObjects.value
        .filter((object) => object.value.target === match.value.matchId)
        .toSorted((a, b) => a.value.published - b.value.published);
      const joinedActors = [...new Set(joiners.map((object) => object.actor))];
      const participantActors = [match.actor, ...joinedActors.filter((actor) => actor !== match.actor)];
      const participantNames = participantActors.map((actor) => ({
        actor,
        name: profileNames.value[actor] || "Player",
      }));
      const seats = Array.from({ length: match.value.openSeats }, (_, index) => {
        const actor = joinedActors[index];
        return actor
          ? {
              open: false,
              label: profileNames.value[actor] || "Player",
              actor,
            }
          : {
              open: true,
              label: "Open Seat",
              actor: "",
            };
      });
      const joinCount = joinedActors.length;
      return {
        ...match,
        joinCount,
        mine: match.actor === myActor.value,
        joined: joinedActors.includes(myActor.value),
        full: joinCount >= match.value.openSeats,
        seats,
        hostActor: match.actor,
        hostName: profileNames.value[match.actor] || "Player",
        participantActors,
        participantNames,
        canChat: match.actor === myActor.value || joinedActors.includes(myActor.value),
        chatPath: `/matches/${match.value.matchId}/chat`,
        profilePath: `/profile/${match.actor}`,
      };
    });
  });

  const activeMatchChat = computed(() => {
    return matchCards.value.find((match) => match.value.matchId === activeMatchChatId.value);
  });

  const activeMessageChannels = computed(() => {
    if (activeChatMode.value === "dm") {
      const channel =
        activeChat.value?.value.channel || localChatChannels.value[activeChatActor.value];
      return channel ? [channel] : [];
    }

    if (activeChatMode.value === "match" && activeMatchChat.value) {
      return [matchChatChannel(activeMatchChat.value.value.matchId)];
    }

    return [];
  });

  const activeAllowedActors = computed(() => {
    if (activeChatMode.value === "dm" && activeChatActor.value) {
      return [myActor.value, activeChatActor.value];
    }

    if (activeChatMode.value === "match" && activeMatchChat.value) {
      return activeMatchChat.value.participantActors;
    }

    return [];
  });

  const {
    objects: messageObjects,
    isFirstPoll: messagesLoading,
  } = useGraffitiDiscover(activeMessageChannels, messageSchema, session, true);

  const chatReady = computed(() => activeMessageChannels.value.length > 0);

  const sortedMessages = computed(() => {
    return messageObjects.value
      .toSorted((a, b) => a.value.published - b.value.published)
      .map((message) => ({
        ...message,
        mine: message.actor === myActor.value,
      }));
  });

  const canPostMatch = computed(() => {
    const rating = Number(matchForm.value.rating);
    const cost = Number(matchForm.value.costPerSpot);
    return (
      matchForm.value.date &&
      matchForm.value.time &&
      Number.isFinite(rating) &&
      rating >= 1 &&
      rating <= 16 &&
      Number.isFinite(cost) &&
      cost >= 0
    );
  });

  const matchRatingValid = computed(() => {
    const rating = Number(matchForm.value.rating);
    return Number.isFinite(rating) && rating >= 1 && rating <= 16;
  });

  const matchCostValid = computed(() => {
    const cost = Number(matchForm.value.costPerSpot);
    return Number.isFinite(cost) && cost >= 0;
  });

  const matchFormProgress = computed(() => {
    const completed = [
      matchRatingValid.value,
      !!matchForm.value.date,
      !!matchForm.value.time,
      matchCostValid.value,
    ].filter(Boolean).length;

    return completed / 4;
  });

  const matchFormProgressPercent = computed(() => {
    return Math.round(matchFormProgress.value * 100);
  });

  const matchFormProgressLabel = computed(() => {
    const completedSteps = Math.round(matchFormProgress.value * 4);
    return canPostMatch.value
      ? "All core details are ready to post."
      : `${completedSteps} of 4 core details complete`;
  });

  watch(
    myProfile,
    (profile) => {
      if (profile && !profileLoaded.value) {
        profileForm.value = {
          name: clipName(profile.value.name),
          sports: [...profile.value.sports],
          utr: profile.value.utr ?? "",
          utrp: profile.value.utrp ?? "",
        };
        selectedProfilePhoto.value = null;
        selectedProfilePhotoName.value = "";
        removeProfilePhoto.value = false;
        profileLoaded.value = true;
      }

      if (!profile && !session.value) {
        profileForm.value = emptyProfileForm();
      }
    },
    { immediate: true },
  );

  watch(myActor, () => {
    profileLoaded.value = false;
    clearActiveChat();
    pendingMatchId.value = "";
  });

  function getProfileByActor(actor) {
    return profilesByActor.value[actor];
  }

  function handleProfilePhotoSelect(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    selectedProfilePhoto.value = file;
    selectedProfilePhotoName.value = file.name;
    removeProfilePhoto.value = false;
  }

  function markProfilePhotoForRemoval() {
    selectedProfilePhoto.value = null;
    selectedProfilePhotoName.value = "";
    removeProfilePhoto.value = true;
  }

  function keepCurrentProfilePhoto() {
    removeProfilePhoto.value = false;
  }

  async function refreshProfiles() {
    await pollProfiles();
  }

  async function refreshChats() {
    await pollChats();
  }

  async function refreshMatches() {
    await pollMatches();
  }

  function showToast(message) {
    toast.value = {
      id: Date.now(),
      message,
    };

    window.clearTimeout(toastTimeoutId);
    toastTimeoutId = window.setTimeout(() => {
      toast.value = null;
    }, 2200);
  }

  async function saveProfile() {
    if (!session.value || !canSaveProfile.value) {
      if (nameTooLong.value) {
        profileError.value = `Usernames must be ${MAX_NAME_LENGTH} characters or fewer.`;
      } else if (duplicateName.value) {
        profileError.value = "That nickname is already taken.";
      } else if (invalidUtr.value) {
        profileError.value = "UTR must be between 1 and 16.";
      } else if (invalidUtrp.value) {
        profileError.value = "UTR-P must be between 1 and 10.";
      }
      return;
    }

    savingProfile.value = true;
    profileError.value = "";

    const previousIcon = myProfile.value?.value.icon;
    let uploadedIcon = "";

    try {
      let nextIcon = previousIcon;

      if (selectedProfilePhoto.value) {
        uploadedIcon = await graffiti.postMedia(
          { data: selectedProfilePhoto.value },
          session.value,
        );
        nextIcon = uploadedIcon;
      } else if (removeProfilePhoto.value) {
        nextIcon = undefined;
      }

      await graffiti.post(
        {
          value: buildProfileValue(profileForm.value, nextIcon),
          channels: [profileChannel],
        },
        session.value,
      );

      if (
        previousIcon &&
        ((removeProfilePhoto.value && !selectedProfilePhoto.value) ||
          (uploadedIcon && previousIcon !== uploadedIcon))
      ) {
        try {
          await graffiti.deleteMedia(previousIcon, session.value);
        } catch {
          // Ignore cleanup errors after the new profile is already saved.
        }
      }

      selectedProfilePhoto.value = null;
      selectedProfilePhotoName.value = "";
      removeProfilePhoto.value = false;
      profileLoaded.value = true;
    } catch (error) {
      if (uploadedIcon) {
        try {
          await graffiti.deleteMedia(uploadedIcon, session.value);
        } catch {
          // Ignore cleanup errors for a failed save.
        }
      }
      profileError.value = error?.message || "Could not save your profile.";
    } finally {
      savingProfile.value = false;
    }
  }

  async function ensureChat(actor) {
    const existingChat = myChats.value.find((object) => object.value.participants.includes(actor));
    if (existingChat) {
      localChatChannels.value = {
        ...localChatChannels.value,
        [actor]: existingChat.value.channel,
      };
      return existingChat;
    }

    const person = people.value.find((object) => object.actor === actor);
    const channel = dmChannel(myActor.value, actor);
    localChatChannels.value = {
      ...localChatChannels.value,
      [actor]: channel,
    };

    await graffiti.post(
      {
        value: buildChatValue(
          channel,
          myActor.value,
          actor,
          profileNames.value[myActor.value] || "",
          person?.value.name || "",
        ),
        channels: [chatDirectoryChannel],
        allowed: [myActor.value, actor],
      },
      session.value,
    );

    return { value: { channel } };
  }

  async function openChat(actor) {
    if (!actor || !session.value) {
      return;
    }

    activeChatMode.value = "dm";
    activeMatchChatId.value = "";
    activeChatActor.value = actor;
    openingChatFor.value = actor;
    try {
      await ensureChat(actor);
    } finally {
      openingChatFor.value = "";
    }
  }

  function openMatchChat(matchId) {
    activeChatMode.value = "match";
    activeChatActor.value = "";
    activeMatchChatId.value = matchId;
    messageText.value = "";
  }

  function clearActiveChat() {
    activeChatMode.value = "";
    activeChatActor.value = "";
    activeMatchChatId.value = "";
    messageText.value = "";
  }

  async function sendMessage() {
    if (
      !session.value ||
      !messageText.value.trim() ||
      !activeMessageChannels.value.length ||
      !activeAllowedActors.value.length
    ) {
      return;
    }

    sendingMessage.value = true;
    try {
      await graffiti.post(
        {
          value: buildMessageValue(messageText.value.trim()),
          channels: activeMessageChannels.value,
          allowed: activeAllowedActors.value,
        },
        session.value,
      );
      messageText.value = "";
    } finally {
      sendingMessage.value = false;
    }
  }

  async function postMatch() {
    if (!session.value) {
      return;
    }

    postingMatch.value = true;
    try {
      const postedSport = matchForm.value.sport;
      const postedLocation = matchForm.value.location;
      await graffiti.post(
        {
          value: buildMatchValue(matchForm.value),
          channels: [lobbyChannel],
        },
        session.value,
      );
      matchForm.value = emptyMatchForm();
      showToast(`${clipName(postedSport)} match posted for ${postedLocation}.`);
    } finally {
      postingMatch.value = false;
    }
  }

  async function joinMatch(match) {
    if (!session.value) {
      return;
    }

    joiningMatchId.value = match.value.matchId;
    try {
      await graffiti.post(
        {
          value: buildJoinValue(match.value.matchId),
          channels: [lobbyChannel],
        },
        session.value,
      );
      pendingMatchId.value = "";
    } finally {
      joiningMatchId.value = "";
    }
  }

  async function deleteMatch(match) {
    if (!session.value) {
      return;
    }

    deletingMatchId.value = match.url;
    try {
      await graffiti.delete(match, session.value);
      if (pendingMatchId.value === match.value.matchId) {
        pendingMatchId.value = "";
      }
    } finally {
      deletingMatchId.value = "";
    }
  }

  return {
    MAX_NAME_LENGTH,
    session,
    profileForm,
    matchForm,
    messageText,
    savingProfile,
    postingMatch,
    sendingMessage,
    joiningMatchId,
    deletingMatchId,
    toast,
    openingChatFor,
    pendingMatchId,
    profileError,
    profilesLoading,
    messagesLoading,
    matchesLoading,
    myActor,
    myProfile,
    latestProfiles,
    profilesByActor,
    currentProfilePhotoUrl,
    currentProfileHasPhoto,
    selectedProfilePhotoName,
    removeProfilePhoto,
    profileReady,
    appReady,
    duplicateName,
    nameTooLong,
    invalidUtr,
    invalidUtrp,
    canSaveProfile,
    people,
    profileNames,
    activeChatActor,
    activeMatchChatId,
    activePerson,
    activeChat,
    activeMatchChat,
    chatReady,
    sortedMessages,
    matchCards,
    canPostMatch,
    matchRatingValid,
    matchCostValid,
    matchFormProgress,
    matchFormProgressPercent,
    matchFormProgressLabel,
    getProfileByActor,
    handleProfilePhotoSelect,
    markProfilePhotoForRemoval,
    keepCurrentProfilePhoto,
    refreshProfiles,
    refreshChats,
    refreshMatches,
    showToast,
    saveProfile,
    openChat,
    openMatchChat,
    clearActiveChat,
    sendMessage,
    postMatch,
    joinMatch,
    deleteMatch,
    clipName,
  };
}

export function provideCourtConnectStore() {
  const store = createCourtConnectStore();
  provide(CourtConnectStoreKey, store);
  return store;
}

export function useCourtConnectStore() {
  const store = inject(CourtConnectStoreKey, null);
  if (!store) {
    throw new Error("Court Connect store was not provided.");
  }
  return store;
}
