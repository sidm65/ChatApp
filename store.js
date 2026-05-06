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
const conversationReadStorageKeyPrefix = "court-connect-read-state";

const emptyProfileForm = () => ({
  name: "",
  sports: [],
  utr: "",
  utrp: "",
});

const emptyMatchForm = () => ({
  sport: "tennis",
  location: "MIT",
  ratingType: "Unrated",
  rating: "",
  format: "singles",
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
  const value = {
    activity: "Post",
    type: "Match",
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
  const activeMatchesTab = ref("open");
  const matchSortMode = ref("soonest");
  const matchAvailabilityFilter = ref("all");
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
  const profileReady = computed(() => !!myProfile.value);
  const appReady = computed(() => !!session.value && profileReady.value);
  const normalizedProfileName = computed(() => clipName(profileForm.value.name).toLowerCase());
  const nameTooLong = computed(
    () => String(profileForm.value.name || "").trim().length > MAX_NAME_LENGTH,
  );
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

  const matchNeedsRating = computed(() => matchForm.value.ratingType !== "Unrated");

  const matchSkillReady = computed(() => {
    return !!matchForm.value.ratingType && matchRatingValid.value;
  });

  const matchRatingValid = computed(() => {
    if (!matchNeedsRating.value) {
      return true;
    }

    const rating = Number(matchForm.value.rating);
    return Number.isFinite(rating) && rating >= 1 && rating <= 16;
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
      !!matchForm.value.format &&
      !!matchForm.value.date &&
      !!matchForm.value.time &&
      matchSkillReady.value &&
      matchCostValid.value
    );
  });

  const matchFormProgress = computed(() => {
    const completed = [
      !!matchForm.value.sport,
      !!matchForm.value.location,
      matchSkillReady.value,
      !!matchForm.value.format,
      !!matchForm.value.date,
      !!matchForm.value.time,
      matchCostValid.value,
    ].filter(Boolean).length;

    return completed / 7;
  });

  const matchFormProgressPercent = computed(() => {
    return Math.round(matchFormProgress.value * 100);
  });

  const matchFormProgressLabel = computed(() => {
    const completedSteps = [
      !!matchForm.value.sport,
      !!matchForm.value.location,
      matchSkillReady.value,
      !!matchForm.value.format,
      !!matchForm.value.date,
      !!matchForm.value.time,
      matchCostValid.value,
    ].filter(Boolean).length;
    return canPostMatch.value
      ? "All core details are ready to post."
      : `${completedSteps} of 7 required details complete`;
  });

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

  const openMatches = computed(() => {
    let matches = matchCards.value.filter((match) => !match.mine);

    if (matchAvailabilityFilter.value === "available") {
      matches = matches.filter((match) => !match.full && !match.joined);
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

  const myMatches = computed(() => {
    return matchCards.value.filter((match) => match.mine).toSorted(compareBySoonest);
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
          title: `${clipName(match.value.sport)} at ${match.value.location}`,
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

  const hasUnreadConversations = computed(() => {
    return (
      dmRows.value.some((row) => row.unread) || matchChatRows.value.some((row) => row.unread)
    );
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

  watch(
    myActor,
    () => {
      conversationReadState.value = loadConversationReadState(myActor.value);
      profileLoaded.value = false;
      profileForm.value = emptyProfileForm();
      selectedProfilePhoto.value = null;
      selectedProfilePhotoName.value = "";
      removeProfilePhoto.value = false;
      profileError.value = "";
      clearActiveChat();
      pendingMatchId.value = "";
    },
    { immediate: true },
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

  function togglePostMatchCollapsed() {
    postMatchCollapsed.value = !postMatchCollapsed.value;
  }

  function setActiveMatchesTab(tab) {
    activeMatchesTab.value = tab;
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
      } else if (invalidUtr.value) {
        profileError.value = "UTR must be between 1 and 16.";
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

      selectedProfilePhoto.value = null;
      selectedProfilePhotoName.value = "";
      removeProfilePhoto.value = false;
      profileLoaded.value = true;

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
      showToast(`Joined ${clipName(currentMatch.value.sport)} match at ${currentMatch.value.location}.`);
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
    openMatches,
    myMatches,
    dmRows,
    matchChatRows,
    hasUnreadConversations,
    activeMatchesTab,
    matchSortMode,
    matchAvailabilityFilter,
    postMatchCollapsed,
    matchNeedsRating,
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
    togglePostMatchCollapsed,
    setActiveMatchesTab,
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
