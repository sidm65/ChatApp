import { computed, inject, provide, ref, watch } from "vue";
import {
  useGraffiti,
  useGraffitiDiscover,
  useGraffitiSession,
} from "@graffiti-garden/wrapper-vue";

const CourtConnectStoreKey = Symbol("CourtConnectStore");

const appChannelRoot = "sidmdesignftw-v5";
const profileChannel = appChannelRoot;
const chatDirectoryChannel = `${appChannelRoot}-chats`;
const lobbyChannel = `${appChannelRoot}-match-lobby`;
const MAX_NAME_LENGTH = 15;
const MAX_MATCH_TITLE_LENGTH = 30;
const MAX_ABOUT_WORDS = 50;
const conversationReadStorageKeyPrefix = "court-connect-read-state";

const emptyProfileForm = () => ({
  name: "",
  sports: [],
  utr: "",
  utrp: "",
  about: "",
  instagram: "",
});

const emptyMatchForm = () => ({
  title: "",
  sport: "",
  location: "",
  ratingType: "",
  rating: "",
  format: "",
  date: "",
  time: "",
  costPerSpot: "",
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
        about: { type: "string" },
        instagram: { type: "string" },
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
        participants: {
          type: "array",
          minItems: 2,
          items: { type: "string" },
        },
        names: {
          type: "array",
          items: { type: "string" },
        },
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
  oneOf: [
    {
      properties: {
        value: {
          required: [
            "activity",
            "type",
            "sport",
            "location",
            "ratingType",
            "format",
            "date",
            "time",
            "costPerSpot",
            "openSeats",
            "matchId",
            "published",
          ],
          properties: {
            activity: { const: "Post" },
            type: { const: "Match" },
            title: { type: "string" },
            sport: { enum: ["tennis", "pickleball"] },
            location: { type: "string" },
            ratingType: { enum: ["UTR", "UTR-P", "Unrated"] },
            rating: { type: "number" },
            format: { enum: ["singles", "doubles"] },
            date: { type: "string" },
            time: { type: "string" },
            costPerSpot: { type: "number" },
            openSeats: { enum: [1, 3] },
            matchId: { type: "string" },
            published: { type: "number" },
          },
        },
      },
    },
    {
      properties: {
        value: {
          required: ["activity", "type", "target", "published"],
          properties: {
            activity: { const: "Join" },
            type: { const: "Match" },
            target: { type: "string" },
            published: { type: "number" },
          },
        },
      },
    },
  ],
};

function clipName(name) {
  return String(name || "").trim().slice(0, MAX_NAME_LENGTH);
}

function clipMatchTitle(title) {
  return String(title || "").trim().slice(0, MAX_MATCH_TITLE_LENGTH);
}

function formatSportName(sport) {
  const value = String(sport || "").trim();
  if (!value) {
    return "Match";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
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

function normalizeBoundedRatingInput(rawValue, min, max) {
  const cleaned = String(rawValue ?? "").replace(/[^\d.]/g, "");
  if (!cleaned) {
    return "";
  }

  const [whole = "", ...decimalParts] = cleaned.split(".");
  const normalized = decimalParts.length ? `${whole}.${decimalParts.join("")}` : whole;
  const numericValue = Number(normalized);

  if (!Number.isFinite(numericValue)) {
    return "";
  }

  return String(Math.min(max, Math.max(min, numericValue)));
}

function normalizeAboutText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function countWords(value) {
  const normalized = normalizeAboutText(value);
  return normalized ? normalized.split(" ").length : 0;
}

function normalizeInstagramHandle(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (!/^@[A-Za-z0-9._]{1,30}$/.test(raw)) {
    return "";
  }

  return raw.slice(1);
}

function instagramProfileUrl(handle) {
  return handle ? `https://www.instagram.com/${handle}` : "";
}

function isValidInstagramInput(value) {
  const raw = String(value || "").trim();
  return !raw || /^@[A-Za-z0-9._]{1,30}$/.test(raw);
}

function dmChannel(actorA, actorB) {
  return `${appChannelRoot}-dm-` + [actorA, actorB].sort().join("-");
}

function matchChatChannel(matchId) {
  return `${appChannelRoot}-match-chat-${matchId}`;
}

function parseMatchStartTimestamp(date, time) {
  if (!date || !time) {
    return NaN;
  }
  return new Date(`${date}T${time}`).getTime();
}

function formatConversationTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const date = new Date(timestamp);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDifference = Math.round(
    (startOfToday.getTime() - startOfMessageDay.getTime()) / 86400000,
  );

  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  if (dayDifference === 0) {
    return timeFormatter.format(date);
  }

  if (dayDifference === 1) {
    return `Yesterday`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatMatchSchedule(date, time) {
  const startAt = parseMatchStartTimestamp(date, time);
  if (!Number.isFinite(startAt)) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startAt));
}

function sameStringSet(left, right) {
  const leftItems = [...left].map(String).sort();
  const rightItems = [...right].map(String).sort();

  if (leftItems.length !== rightItems.length) {
    return false;
  }

  return leftItems.every((item, index) => item === rightItems[index]);
}

function defaultMatchTitle(sport, location, hostName) {
  return clipMatchTitle(
    `${formatSportName(sport)} at ${String(location || "TBD").trim()} by ${clipName(hostName || "Player")}`,
  );
}

function conversationReadStorageKey(actor) {
  return `${conversationReadStorageKeyPrefix}:${actor || "guest"}`;
}

function loadConversationReadState(actor) {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(conversationReadStorageKey(actor));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistConversationReadState(actor, value) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(conversationReadStorageKey(actor), JSON.stringify(value));
  } catch {
    // Ignore localStorage failures.
  }
}

function buildProfileValue(form, icon) {
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
  if (form.sports.includes("tennis")) {
    const utr = toOptionalNumber(form.utr);
    if (utr !== undefined) {
      value.utr = utr;
    }
  }
  if (form.sports.includes("pickleball")) {
    const utrp = toOptionalNumber(form.utrp);
    if (utrp !== undefined) {
      value.utrp = utrp;
    }
  }
  if (normalizeAboutText(form.about)) {
    value.about = normalizeAboutText(form.about);
  }
  if (normalizeInstagramHandle(form.instagram)) {
    value.instagram = normalizeInstagramHandle(form.instagram);
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

function buildMatchValue(form, hostName) {
  const value = {
    activity: "Post",
    type: "Match",
    title: clipMatchTitle(form.title) || defaultMatchTitle(form.sport, form.location, hostName),
    sport: form.sport,
    location: form.location,
    ratingType: form.ratingType,
    format: form.format,
    date: form.date,
    time: form.time,
    costPerSpot: Number(form.costPerSpot),
    openSeats: form.format === "singles" ? 1 : 3,
    matchId: crypto.randomUUID(),
    published: Date.now(),
  };

  if (form.ratingType !== "Unrated") {
    value.rating = Number(form.rating);
  }

  return value;
}

function buildJoinValue(matchId) {
  return {
    activity: "Join",
    type: "Match",
    target: matchId,
    published: Date.now(),
  };
}

function profileEditorSignature(form) {
  return {
    name: clipName(form.name),
    sports: [...form.sports].map(String).sort(),
    utr: form.sports.includes("tennis") ? String(form.utr ?? "").trim() : "",
    utrp: form.sports.includes("pickleball") ? String(form.utrp ?? "").trim() : "",
    about: String(form.about ?? "").trim(),
    instagram: String(form.instagram ?? "").trim(),
  };
}

function buildMatchFieldStates(form, matchNeedsRating, matchRatingValid, matchCostValid) {
  return {
    sport: !!form.sport,
    location: !!form.location,
    skill: !!form.ratingType && (!matchNeedsRating || matchRatingValid),
    format: !!form.format,
    date: !!form.date,
    time: !!form.time,
    costPerSpot: matchCostValid,
  };
}

function filterMatchesByQuery(matches, query) {
  if (!query) {
    return matches;
  }

  return matches.filter((match) =>
    [
      match.title,
      match.hostName,
      match.value.sport,
      match.value.location,
      match.ratingLabel,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function filterRowsByQuery(rows, query) {
  if (!query) {
    return rows;
  }

  return rows.filter((row) =>
    [row.title, row.subtitle].filter(Boolean).join(" ").toLowerCase().includes(query),
  );
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
  const profileEditorSynced = ref(false);
  const profileEditorBaseline = ref(profileEditorSignature(emptyProfileForm()));
  const selectedProfilePhoto = ref(null);
  const selectedProfilePhotoName = ref("");
  const selectedProfilePhotoPreviewUrl = ref("");
  const profilePhotoPreviewOpen = ref(false);
  const profilePhotoPreviewSource = ref("current");
  const lastInstagramAlertValue = ref("");
  const removeProfilePhoto = ref(false);
  const activeMatchesTab = ref("open");
  const matchSearchText = ref("");
  const dmSearchText = ref("");
  const matchChatSearchText = ref("");
  const matchSortMode = ref("soonest");
  const matchAvailabilityFilter = ref("available");
  const postMatchCollapsed = ref(true);
  const conversationReadState = ref({});
  const currentTime = ref(Date.now());
  const cleaningExpiredMatches = ref(false);
  const pendingChatCreations = new Map();
  let toastTimeoutId = 0;

  if (typeof window !== "undefined") {
    window.setInterval(() => {
      currentTime.value = Date.now();
    }, 60000);
  }

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
  const currentProfileHasPhoto = computed(
    () => !!myProfile.value?.value.icon && !removeProfilePhoto.value,
  );
  const profilePhotoHasPendingChange = computed(
    () => !!selectedProfilePhoto.value || removeProfilePhoto.value,
  );
  const profilePhotoUploadLabel = computed(() =>
    currentProfileHasPhoto.value ? "Choose a replacement photo" : "Choose a photo",
  );
  const profilePhotoStatusTitle = computed(() => {
    if (removeProfilePhoto.value) {
      return "Photo removal pending";
    }
    if (selectedProfilePhoto.value && myProfile.value?.value.icon) {
      return "New photo selected";
    }
    if (selectedProfilePhoto.value) {
      return "Photo ready to add";
    }
    if (currentProfileHasPhoto.value) {
      return "Current photo saved";
    }
    return "No profile photo yet";
  });
  const profilePhotoStatusText = computed(() => {
    if (removeProfilePhoto.value) {
      return "Your current saved photo will be removed after you save the profile.";
    }
    if (selectedProfilePhoto.value && myProfile.value?.value.icon) {
      return "You selected a replacement photo. Save Profile to replace the current one.";
    }
    if (selectedProfilePhoto.value) {
      return "You selected a new photo. Save Profile to add it to your profile.";
    }
    if (currentProfileHasPhoto.value) {
      return "This is the photo currently saved on your profile.";
    }
    return "Add a profile photo if you want other players to recognize you more easily.";
  });
  const profilePhotoPreviewTitle = computed(() =>
    profilePhotoPreviewSource.value === "selected"
      ? "Selected Photo Preview"
      : "Current Photo Preview",
  );
  const previewingSelectedProfilePhoto = computed(
    () =>
      profilePhotoPreviewSource.value === "selected" &&
      !!selectedProfilePhotoPreviewUrl.value,
  );
  const profileReady = computed(() => !!myProfile.value);
  const appReady = computed(() => !!session.value && profileReady.value);
  const normalizedProfileName = computed(() => clipName(profileForm.value.name).toLowerCase());
  const normalizedMatchSearch = computed(() => String(matchSearchText.value || "").trim().toLowerCase());
  const normalizedDmSearch = computed(() => String(dmSearchText.value || "").trim().toLowerCase());
  const normalizedMatchChatSearch = computed(() =>
    String(matchChatSearchText.value || "").trim().toLowerCase(),
  );
  const nameTooLong = computed(
    () => String(profileForm.value.name || "").trim().length > MAX_NAME_LENGTH,
  );
  const matchTitleTooLong = computed(
    () => String(matchForm.value.title || "").trim().length > MAX_MATCH_TITLE_LENGTH,
  );
  const profileHasTennis = computed(() => profileForm.value.sports.includes("tennis"));
  const profileHasPickleball = computed(() => profileForm.value.sports.includes("pickleball"));
  const profileUtr = computed(() => toOptionalNumber(profileForm.value.utr));
  const profileUtrp = computed(() => toOptionalNumber(profileForm.value.utrp));
  const profileAboutWordCount = computed(() => countWords(profileForm.value.about));
  const profileAboutTooLong = computed(() => profileAboutWordCount.value > MAX_ABOUT_WORDS);
  const normalizedInstagramHandle = computed(() =>
    normalizeInstagramHandle(profileForm.value.instagram),
  );
  const invalidInstagram = computed(
    () => !isValidInstagramInput(profileForm.value.instagram),
  );
  const invalidUtr = computed(() => {
    return (
      profileHasTennis.value &&
      profileForm.value.utr !== "" &&
      !isWithinOptionalRange(profileUtr.value, 1, 16.5)
    );
  });
  const invalidUtrp = computed(() => {
    return (
      profileHasPickleball.value &&
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

  const profileDirty = computed(() => {
    const current = profileEditorSignature(profileForm.value);
    const baseline = profileEditorBaseline.value;
    const formChanged =
      current.name !== baseline.name ||
      !sameStringSet(current.sports, baseline.sports) ||
      current.utr !== baseline.utr ||
      current.utrp !== baseline.utrp ||
      current.about !== baseline.about ||
      current.instagram !== baseline.instagram;

    return (
      formChanged ||
      !!selectedProfilePhoto.value ||
      (removeProfilePhoto.value && !!myProfile.value?.value.icon)
    );
  });

  const canSaveProfile = computed(() => {
    return (
      profileEditorSynced.value &&
      !!clipName(profileForm.value.name) &&
      profileForm.value.sports.length > 0 &&
      profileDirty.value &&
      !duplicateName.value &&
      !nameTooLong.value &&
      !profileAboutTooLong.value &&
      !invalidInstagram.value &&
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

  const latestChatByActor = computed(() => {
    const byActor = {};

    for (const chat of myChats.value) {
      const otherActor = chat.value.participants.find((actor) => actor !== myActor.value);
      if (!otherActor) {
        continue;
      }

      if (!byActor[otherActor] || byActor[otherActor].value.published < chat.value.published) {
        byActor[otherActor] = chat;
      }
    }

    return byActor;
  });

  const activeChat = computed(() => {
    return activeChatActor.value ? latestChatByActor.value[activeChatActor.value] : undefined;
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

  function isMatchExpiredValue(value) {
    const startAt = parseMatchStartTimestamp(value.date, value.time);
    return Number.isFinite(startAt) && startAt <= currentTime.value;
  }

  const matchCards = computed(() => {
    return matchPosts.value
      .filter((match) => !isMatchExpiredValue(match.value))
      .map((match) => {
        const joiners = joinObjects.value
          .filter((object) => object.value.target === match.value.matchId)
          .toSorted((a, b) => a.value.published - b.value.published);
        const joinedActors = [
          ...new Set(
            joiners
              .map((object) => object.actor)
              .filter((actor) => actor && actor !== match.actor),
          ),
        ].slice(0, match.value.openSeats);
        const participantActors = [
          match.actor,
          ...joinedActors.filter((actor) => actor !== match.actor),
        ];
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
        const startAt = parseMatchStartTimestamp(match.value.date, match.value.time);
        const ratingLabel =
          match.value.ratingType === "Unrated"
            ? "Unrated"
            : `${match.value.ratingType} ${match.value.rating}`;
        const title =
          clipMatchTitle(match.value.title) ||
          defaultMatchTitle(match.value.sport, match.value.location, profileNames.value[match.actor]);

        return {
          ...match,
          title,
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
          startAt,
          ratingLabel,
          scheduleLabel: formatMatchSchedule(match.value.date, match.value.time),
        };
      });
  });

  const activeMatchChat = computed(() => {
    return matchCards.value.find((match) => match.value.matchId === activeMatchChatId.value);
  });

  const overviewMessageChannels = computed(() => {
    const channels = new Set();

    for (const chat of myChats.value) {
      if (chat.value.channel) {
        channels.add(chat.value.channel);
      }
    }

    for (const channel of Object.values(localChatChannels.value)) {
      if (channel) {
        channels.add(channel);
      }
    }

    for (const match of matchCards.value) {
      if (match.canChat) {
        channels.add(matchChatChannel(match.value.matchId));
      }
    }

    return [...channels];
  });

  const {
    objects: overviewMessageObjects,
    isFirstPoll: messagesLoading,
    poll: pollMessages,
  } = useGraffitiDiscover(overviewMessageChannels, messageSchema, session, true);

  const messagesByChannel = computed(() => {
    const grouped = {};

    for (const message of overviewMessageObjects.value) {
      for (const channel of message.channels || []) {
        if (!grouped[channel]) {
          grouped[channel] = [];
        }
        grouped[channel].push(message);
      }
    }

    return grouped;
  });

  const latestMessageByChannel = computed(() => {
    return Object.fromEntries(
      Object.entries(messagesByChannel.value).map(([channel, messages]) => [
        channel,
        messages.toSorted((a, b) => a.value.published - b.value.published).at(-1),
      ]),
    );
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

  const activeConversationChannel = computed(() => activeMessageChannels.value[0] || "");

  const activeAllowedActors = computed(() => {
    if (activeChatMode.value === "dm" && activeChatActor.value) {
      return [myActor.value, activeChatActor.value];
    }

    if (activeChatMode.value === "match" && activeMatchChat.value) {
      return activeMatchChat.value.participantActors;
    }

    return [];
  });

  const chatReady = computed(() => activeMessageChannels.value.length > 0);

  const sortedMessages = computed(() => {
    const channel = activeConversationChannel.value;
    if (!channel) {
      return [];
    }

    return (messagesByChannel.value[channel] || [])
      .toSorted((a, b) => a.value.published - b.value.published)
      .map((message) => ({
        ...message,
        mine: message.actor === myActor.value,
      }));
  });

  const matchNeedsRating = computed(
    () => !!matchForm.value.ratingType && matchForm.value.ratingType !== "Unrated",
  );
  const matchSupportsTennisRating = computed(() => matchForm.value.sport === "tennis");
  const matchSupportsPickleballRating = computed(() => matchForm.value.sport === "pickleball");
  const matchRatingLabel = computed(() =>
    matchForm.value.ratingType === "UTR-P" ? "Rating (1.0-10.0)" : "Rating (1.0-16.5)",
  );
  const matchRatingPlaceholder = computed(() =>
    matchForm.value.ratingType === "UTR-P" ? "1.0 to 10.0" : "1.0 to 16.5",
  );
  const matchRatingMin = computed(() => 1);
  const matchRatingMax = computed(() => (matchForm.value.ratingType === "UTR-P" ? 10 : 16.5));

  const matchSkillReady = computed(() => {
    return !!matchForm.value.ratingType && matchRatingValid.value;
  });

  const matchRatingValid = computed(() => {
    if (!matchForm.value.ratingType || !matchNeedsRating.value) {
      return true;
    }

    const rating = Number(matchForm.value.rating);
    if (matchForm.value.ratingType === "UTR-P") {
      return Number.isFinite(rating) && rating >= 1 && rating <= 10;
    }

    return Number.isFinite(rating) && rating >= 1 && rating <= 16.5;
  });

  const matchCostValid = computed(() => {
    if (matchForm.value.costPerSpot === "" || matchForm.value.costPerSpot === null) {
      return false;
    }
    const cost = Number(matchForm.value.costPerSpot);
    return Number.isFinite(cost) && cost >= 0;
  });

  const canPostMatch = computed(() => {
    return (
      !!matchForm.value.sport &&
      !!matchForm.value.location &&
      !!matchForm.value.ratingType &&
      !!matchForm.value.format &&
      !!matchForm.value.date &&
      !!matchForm.value.time &&
      matchSkillReady.value &&
      matchCostValid.value
    );
  });

  const matchFormProgress = computed(() => {
    const completed = Object.values(
      buildMatchFieldStates(
        matchForm.value,
        matchNeedsRating.value,
        matchRatingValid.value,
        matchCostValid.value,
      ),
    ).filter(Boolean).length;

    return completed / 7;
  });

  const matchFormProgressPercent = computed(() => {
    return Math.round(matchFormProgress.value * 100);
  });

  const matchFormProgressLabel = computed(() => {
    const completedSteps = Object.values(
      buildMatchFieldStates(
        matchForm.value,
        matchNeedsRating.value,
        matchRatingValid.value,
        matchCostValid.value,
      ),
    ).filter(Boolean).length;
    return canPostMatch.value
      ? "All core details are ready to post."
      : `${completedSteps} of 7 required details complete`;
  });

  const matchFieldState = computed(() =>
    buildMatchFieldStates(
      matchForm.value,
      matchNeedsRating.value,
      matchRatingValid.value,
      matchCostValid.value,
    ),
  );

  function getViewerComparableRating(match) {
    if (match.value.ratingType === "UTR") {
      return toOptionalNumber(myProfile.value?.value.utr);
    }

    if (match.value.ratingType === "UTR-P") {
      return toOptionalNumber(myProfile.value?.value.utrp);
    }

    return undefined;
  }

  function getMatchSkillDistance(match) {
    if (match.value.ratingType === "Unrated") {
      return null;
    }

    const viewerRating = getViewerComparableRating(match);
    const matchRating = toOptionalNumber(match.value.rating);
    if (viewerRating === undefined || matchRating === undefined) {
      return null;
    }

    return Math.abs(viewerRating - matchRating);
  }

  function compareBySoonest(a, b) {
    const aStart = Number.isFinite(a.startAt) ? a.startAt : Number.POSITIVE_INFINITY;
    const bStart = Number.isFinite(b.startAt) ? b.startAt : Number.POSITIVE_INFINITY;
    if (aStart !== bStart) {
      return aStart - bStart;
    }
    return b.value.published - a.value.published;
  }

  const filteredOpenMatches = computed(() => {
    let matches = matchCards.value.filter((match) => !match.mine && !match.joined);

    if (matchAvailabilityFilter.value === "available") {
      matches = matches.filter((match) => !match.full);
    }

    if (matchSortMode.value === "newest") {
      return matches.toSorted((a, b) => b.value.published - a.value.published);
    }

    if (matchSortMode.value === "skill") {
      return matches.toSorted((a, b) => {
        const aDistance = getMatchSkillDistance(a);
        const bDistance = getMatchSkillDistance(b);
        const aComparable = aDistance !== null;
        const bComparable = bDistance !== null;

        if (aComparable && bComparable && aDistance !== bDistance) {
          return aDistance - bDistance;
        }
        if (aComparable !== bComparable) {
          return aComparable ? -1 : 1;
        }

        return compareBySoonest(a, b);
      });
    }

    return matches.toSorted(compareBySoonest);
  });

  const openMatches = computed(() =>
    filterMatchesByQuery(filteredOpenMatches.value, normalizedMatchSearch.value),
  );

  const joinedMatches = computed(() =>
    filterMatchesByQuery(
      matchCards.value
        .filter((match) => match.joined && !match.mine)
        .toSorted(compareBySoonest),
      normalizedMatchSearch.value,
    ),
  );

  const myMatches = computed(() =>
    filterMatchesByQuery(
      matchCards.value.filter((match) => match.mine).toSorted(compareBySoonest),
      normalizedMatchSearch.value,
    ),
  );

  const visibleMatches = computed(() => {
    if (activeMatchesTab.value === "joined") {
      return joinedMatches.value;
    }
    if (activeMatchesTab.value === "mine") {
      return myMatches.value;
    }
    return openMatches.value;
  });

  function previewMessageContent(content) {
    const trimmed = String(content || "").trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed;
  }

  function isConversationUnread(channel, latestMessage) {
    if (!channel || !latestMessage || latestMessage.actor === myActor.value) {
      return false;
    }

    return latestMessage.value.published > (conversationReadState.value[channel] || 0);
  }

  const dmRows = computed(() => {
    return people.value
      .map((person) => {
        const chat = latestChatByActor.value[person.actor];
        const channel = chat?.value.channel || localChatChannels.value[person.actor] || "";
        const latestMessage = channel ? latestMessageByChannel.value[channel] : undefined;
        const unread = isConversationUnread(channel, latestMessage);

        return {
          actor: person.actor,
          title: clipName(person.value.name),
          subtitle:
            previewMessageContent(latestMessage?.value.content) ||
            `Sports: ${person.value.sports.join(", ")}`,
          timeLabel: latestMessage
            ? formatConversationTimestamp(latestMessage.value.published)
            : "",
          latestPublished: latestMessage?.value.published || chat?.value.published || 0,
          unread,
          route: { name: "chat", params: { actor: person.actor } },
          icon: person.value.icon || "",
          initial: clipName(person.value.name).slice(0, 1).toUpperCase(),
        };
      })
      .toSorted((a, b) => {
        if (a.unread !== b.unread) {
          return a.unread ? -1 : 1;
        }
        if (a.latestPublished !== b.latestPublished) {
          return b.latestPublished - a.latestPublished;
        }
        return a.title.localeCompare(b.title);
      });
  });

  const matchChatRows = computed(() => {
    return matchCards.value
      .filter((match) => match.canChat)
      .map((match) => {
        const channel = matchChatChannel(match.value.matchId);
        const latestMessage = latestMessageByChannel.value[channel];
        const unread = isConversationUnread(channel, latestMessage);

        return {
          matchId: match.value.matchId,
          title: match.title,
          subtitle:
            previewMessageContent(latestMessage?.value.content) ||
            `Hosted by ${match.hostName}`,
          timeLabel: latestMessage
            ? formatConversationTimestamp(latestMessage.value.published)
            : match.scheduleLabel,
          latestPublished: latestMessage?.value.published || match.value.published,
          unread,
          route: match.chatPath,
          initial: clipName(match.value.sport).slice(0, 1).toUpperCase(),
        };
      })
      .toSorted((a, b) => {
        if (a.unread !== b.unread) {
          return a.unread ? -1 : 1;
        }
        return b.latestPublished - a.latestPublished;
      });
  });

  const filteredDmRows = computed(() => filterRowsByQuery(dmRows.value, normalizedDmSearch.value));
  const filteredMatchChatRows = computed(() =>
    filterRowsByQuery(matchChatRows.value, normalizedMatchChatSearch.value),
  );

  const hasUnreadConversations = computed(() => {
    return (
      dmRows.value.some((row) => row.unread) || matchChatRows.value.some((row) => row.unread)
    );
  });

  function resetProfileEditor() {
    const profile = myProfile.value;

    if (profile) {
      profileForm.value = {
        name: clipName(profile.value.name),
        sports: [...profile.value.sports],
        utr: profile.value.utr ?? "",
        utrp: profile.value.utrp ?? "",
        about: profile.value.about ?? "",
        instagram: profile.value.instagram ? `@${profile.value.instagram}` : "",
      };
      profileLoaded.value = true;
    } else {
      profileForm.value = emptyProfileForm();
      profileLoaded.value = false;
    }

    clearSelectedProfilePhoto();
    removeProfilePhoto.value = false;
    profileError.value = "";
    profileEditorBaseline.value = profileEditorSignature(profileForm.value);
    profileEditorSynced.value = true;
  }

  watch(
    myProfile,
    (profile) => {
      if (profile && !profileLoaded.value) {
        resetProfileEditor();
      }

      if (!profile && !session.value) {
        resetProfileEditor();
      }
    },
    { immediate: true },
  );

  watch(
    myActor,
    () => {
      conversationReadState.value = loadConversationReadState(myActor.value);
      profileLoaded.value = false;
      profileEditorSynced.value = false;
      profileForm.value = emptyProfileForm();
      profileEditorBaseline.value = profileEditorSignature(profileForm.value);
      clearSelectedProfilePhoto();
      removeProfilePhoto.value = false;
      profileError.value = "";
      clearActiveChat();
      pendingMatchId.value = "";
    },
    { immediate: true },
  );

  watch(
    () => profileForm.value.sports.slice(),
    (sports) => {
      if (!sports.includes("tennis")) {
        profileForm.value.utr = "";
      }
      if (!sports.includes("pickleball")) {
        profileForm.value.utrp = "";
      }
    },
    { deep: true },
  );

  watch(
    () => profileForm.value.instagram,
    (instagram) => {
      if (isValidInstagramInput(instagram)) {
        lastInstagramAlertValue.value = "";
      }
    },
  );

  watch(
    () => matchForm.value.sport,
    (sport) => {
      if (sport === "tennis" && matchForm.value.ratingType === "UTR-P") {
        matchForm.value.ratingType = "";
        matchForm.value.rating = "";
      } else if (sport === "pickleball" && matchForm.value.ratingType === "UTR") {
        matchForm.value.ratingType = "";
        matchForm.value.rating = "";
      } else if (!sport) {
        matchForm.value.ratingType = "";
        matchForm.value.rating = "";
      }
    },
  );

  watch(
    () => matchForm.value.ratingType,
    (ratingType) => {
      if (!ratingType || ratingType === "Unrated") {
        matchForm.value.rating = "";
      }
    },
  );

  watch(
    [activeConversationChannel, sortedMessages, messagesLoading],
    ([channel, messages, loading]) => {
      if (!channel || loading) {
        return;
      }

      const latestPublished = messages.at(-1)?.value?.published || Date.now();
      const nextValue = Math.max(conversationReadState.value[channel] || 0, latestPublished);
      if (nextValue === conversationReadState.value[channel]) {
        return;
      }

      conversationReadState.value = {
        ...conversationReadState.value,
        [channel]: nextValue,
      };
      persistConversationReadState(myActor.value, conversationReadState.value);
    },
    { immediate: true },
  );

  function getProfileByActor(actor) {
    return profilesByActor.value[actor];
  }

  function revokeSelectedProfilePhotoPreview() {
    if (
      selectedProfilePhotoPreviewUrl.value &&
      typeof URL !== "undefined" &&
      typeof URL.revokeObjectURL === "function"
    ) {
      URL.revokeObjectURL(selectedProfilePhotoPreviewUrl.value);
    }
    selectedProfilePhotoPreviewUrl.value = "";
  }

  function clearSelectedProfilePhoto() {
    revokeSelectedProfilePhotoPreview();
    selectedProfilePhoto.value = null;
    selectedProfilePhotoName.value = "";
    profilePhotoPreviewOpen.value = false;
    profilePhotoPreviewSource.value = "current";
  }

  function handleProfilePhotoSelect(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    revokeSelectedProfilePhotoPreview();
    selectedProfilePhoto.value = file;
    selectedProfilePhotoName.value = file.name;
    selectedProfilePhotoPreviewUrl.value =
      typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : "";
    profilePhotoPreviewOpen.value = false;
    profilePhotoPreviewSource.value = "selected";
    removeProfilePhoto.value = false;
    event.target.value = "";
  }

  function openCurrentProfilePhotoPreview() {
    if (currentProfilePhotoUrl.value) {
      profilePhotoPreviewSource.value = "current";
      profilePhotoPreviewOpen.value = true;
    }
  }

  function openSelectedProfilePhotoPreview() {
    if (selectedProfilePhotoPreviewUrl.value) {
      profilePhotoPreviewSource.value = "selected";
      profilePhotoPreviewOpen.value = true;
    }
  }

  function closeSelectedProfilePhotoPreview() {
    profilePhotoPreviewOpen.value = false;
  }

  function markProfilePhotoForRemoval() {
    clearSelectedProfilePhoto();
    removeProfilePhoto.value = true;
  }

  function keepCurrentProfilePhoto() {
    removeProfilePhoto.value = false;
  }

  function discardSelectedProfilePhoto() {
    clearSelectedProfilePhoto();
  }

  function maybeAlertInvalidInstagram(force = false) {
    const raw = String(profileForm.value.instagram || "").trim();
    if (!raw || isValidInstagramInput(raw)) {
      lastInstagramAlertValue.value = "";
      return false;
    }

    if (!force && lastInstagramAlertValue.value === raw) {
      return true;
    }

    lastInstagramAlertValue.value = raw;
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert("Instagram must use the format @username.");
    }
    return true;
  }

  function togglePostMatchCollapsed() {
    postMatchCollapsed.value = !postMatchCollapsed.value;
  }

  function setActiveMatchesTab(tab) {
    activeMatchesTab.value = tab;
  }

  function setProfileRating(field, rawValue) {
    if (field === "utr") {
      profileForm.value.utr = normalizeBoundedRatingInput(rawValue, 1, 16.5);
      return;
    }

    if (field === "utrp") {
      profileForm.value.utrp = normalizeBoundedRatingInput(rawValue, 1, 10);
    }
  }

  function setMatchRating(rawValue) {
    if (!matchForm.value.ratingType || matchForm.value.ratingType === "Unrated") {
      matchForm.value.rating = "";
      return;
    }

    matchForm.value.rating = normalizeBoundedRatingInput(
      rawValue,
      1,
      matchForm.value.ratingType === "UTR-P" ? 10 : 16.5,
    );
  }

  function refreshConversationReadState() {
    conversationReadState.value = loadConversationReadState(myActor.value);
  }

  async function cleanupExpiredHostedMatches() {
    if (!session.value || cleaningExpiredMatches.value) {
      return false;
    }

    const expiredHostedMatches = matchPosts.value.filter(
      (match) => match.actor === myActor.value && isMatchExpiredValue(match.value),
    );

    if (!expiredHostedMatches.length) {
      return false;
    }

    cleaningExpiredMatches.value = true;
    let deletedAny = false;

    try {
      for (const match of expiredHostedMatches) {
        try {
          await graffiti.delete(match, session.value);
          deletedAny = true;
        } catch {
          // Ignore expired cleanup errors.
        }
      }
    } finally {
      cleaningExpiredMatches.value = false;
    }

    return deletedAny;
  }

  async function refreshProfiles() {
    await pollProfiles();
  }

  async function refreshChats() {
    await pollChats();
  }

  async function refreshConversationMessages() {
    if (!overviewMessageChannels.value.length) {
      return;
    }
    await pollMessages();
  }

  async function refreshMatches() {
    await pollMatches();
    const deletedAny = await cleanupExpiredHostedMatches();
    if (deletedAny) {
      await pollMatches();
    }
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
      } else if (profileAboutTooLong.value) {
        profileError.value = `About Me must be ${MAX_ABOUT_WORDS} words or fewer.`;
      } else if (invalidInstagram.value) {
        maybeAlertInvalidInstagram(true);
        profileError.value = "";
      } else if (invalidUtr.value) {
        profileError.value = "UTR must be between 1 and 16.5.";
      } else if (invalidUtrp.value) {
        profileError.value = "UTR-P must be between 1 and 10.";
      }
      return {
        ok: false,
        created: false,
      };
    }

    const created = !myProfile.value;
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

      clearSelectedProfilePhoto();
      removeProfilePhoto.value = false;
      profileLoaded.value = true;
      profileEditorBaseline.value = profileEditorSignature(profileForm.value);
      profileEditorSynced.value = true;
      showToast("Profile saved.");
      await refreshProfiles();

      return {
        ok: true,
        created,
      };
    } catch (error) {
      if (uploadedIcon) {
        try {
          await graffiti.deleteMedia(uploadedIcon, session.value);
        } catch {
          // Ignore cleanup errors for a failed save.
        }
      }
      profileError.value = error?.message || "Could not save your profile.";
      return {
        ok: false,
        created: false,
      };
    } finally {
      savingProfile.value = false;
    }
  }

  async function ensureChat(actor) {
    const existingChat = latestChatByActor.value[actor];
    if (existingChat) {
      localChatChannels.value = {
        ...localChatChannels.value,
        [actor]: existingChat.value.channel,
      };
      return existingChat;
    }

    const pendingCreation = pendingChatCreations.get(actor);
    if (pendingCreation) {
      return pendingCreation;
    }

    const person = people.value.find((object) => object.actor === actor);
    const channel = dmChannel(myActor.value, actor);
    localChatChannels.value = {
      ...localChatChannels.value,
      [actor]: channel,
    };

    const creation = (async () => {
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

      await refreshChats();
      return latestChatByActor.value[actor] || { value: { channel } };
    })();

    pendingChatCreations.set(actor, creation);

    try {
      return await creation;
    } finally {
      pendingChatCreations.delete(actor);
    }
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
      await refreshConversationMessages();
    } finally {
      openingChatFor.value = "";
    }
  }

  async function openMatchChat(matchId) {
    activeChatMode.value = "match";
    activeChatActor.value = "";
    activeMatchChatId.value = matchId;
    messageText.value = "";
    await refreshConversationMessages();
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
    } catch (error) {
      showToast(error?.message || "Could not send message.");
    } finally {
      sendingMessage.value = false;
    }
  }

  async function postMatch() {
    if (!session.value || !canPostMatch.value) {
      return;
    }

    postingMatch.value = true;
    try {
      const matchTitle =
        clipMatchTitle(matchForm.value.title) ||
        defaultMatchTitle(
          matchForm.value.sport,
          matchForm.value.location,
          profileNames.value[myActor.value],
        );
      await graffiti.post(
        {
          value: buildMatchValue(matchForm.value, profileNames.value[myActor.value]),
          channels: [lobbyChannel],
        },
        session.value,
      );
      matchForm.value = emptyMatchForm();
      showToast(`${matchTitle} posted.`);
      await refreshMatches();
    } finally {
      postingMatch.value = false;
    }
  }

  async function joinMatch(match) {
    if (!session.value) {
      return;
    }

    const currentMatch = matchCards.value.find(
      (candidate) => candidate.value.matchId === match.value.matchId,
    );
    if (!currentMatch || currentMatch.mine || currentMatch.joined || currentMatch.full) {
      return;
    }

    joiningMatchId.value = currentMatch.value.matchId;
    try {
      await graffiti.post(
        {
          value: buildJoinValue(currentMatch.value.matchId),
          channels: [lobbyChannel],
        },
        session.value,
      );
      pendingMatchId.value = "";
      showToast(`Joined ${currentMatch.title}.`);
      await refreshMatches();
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
      await refreshMatches();
    } finally {
      deletingMatchId.value = "";
    }
  }

  return {
    MAX_NAME_LENGTH,
    MAX_MATCH_TITLE_LENGTH,
    MAX_ABOUT_WORDS,
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
    profileEditorSynced,
    profilePhotoHasPendingChange,
    profilePhotoUploadLabel,
    profilePhotoStatusTitle,
    profilePhotoStatusText,
    selectedProfilePhotoName,
    selectedProfilePhotoPreviewUrl,
    profilePhotoPreviewTitle,
    previewingSelectedProfilePhoto,
    profilePhotoPreviewOpen,
    removeProfilePhoto,
    profileReady,
    appReady,
    profileHasTennis,
    profileHasPickleball,
    profileDirty,
    profileAboutWordCount,
    profileAboutTooLong,
    normalizedInstagramHandle,
    invalidInstagram,
    duplicateName,
    nameTooLong,
    matchTitleTooLong,
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
    openMatches,
    joinedMatches,
    myMatches,
    visibleMatches,
    dmRows,
    matchChatRows,
    filteredDmRows,
    filteredMatchChatRows,
    hasUnreadConversations,
    activeMatchesTab,
    matchSearchText,
    dmSearchText,
    matchChatSearchText,
    matchSortMode,
    matchAvailabilityFilter,
    postMatchCollapsed,
    matchNeedsRating,
    matchSupportsTennisRating,
    matchSupportsPickleballRating,
    canPostMatch,
    matchRatingValid,
    matchRatingLabel,
    matchRatingPlaceholder,
    matchRatingMin,
    matchRatingMax,
    matchCostValid,
    matchFormProgress,
    matchFormProgressPercent,
    matchFormProgressLabel,
    matchFieldState,
    getProfileByActor,
    handleProfilePhotoSelect,
    openCurrentProfilePhotoPreview,
    openSelectedProfilePhotoPreview,
    closeSelectedProfilePhotoPreview,
    markProfilePhotoForRemoval,
    keepCurrentProfilePhoto,
    discardSelectedProfilePhoto,
    maybeAlertInvalidInstagram,
    resetProfileEditor,
    togglePostMatchCollapsed,
    setActiveMatchesTab,
    setProfileRating,
    setMatchRating,
    refreshConversationReadState,
    refreshProfiles,
    refreshChats,
    refreshConversationMessages,
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
    formatConversationTimestamp,
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
