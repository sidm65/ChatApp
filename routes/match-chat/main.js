import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useCourtConnectStore } from "../../store.js";

function setup() {
  const route = useRoute();
  const store = useCourtConnectStore();

  const matchId = computed(() =>
    typeof route.params.matchId === "string" ? route.params.matchId : "",
  );

  const match = computed(() =>
    store.matchCards.value.find((card) => card.value.matchId === matchId.value),
  );

  const accessDenied = computed(() => {
    if (!match.value) {
      return false;
    }
    return !match.value.canChat;
  });

  onMounted(() => {
    store.refreshMatches();
    store.refreshProfiles();
    store.refreshConversationMessages();
  });

  watch(
    [matchId, match, () => store.profileReady.value],
    async ([currentMatchId, currentMatch, profileReady]) => {
      if (!currentMatchId || !currentMatch || !profileReady || !currentMatch.canChat) {
        return;
      }
      await store.openMatchChat(currentMatchId);
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    store.clearActiveChat();
  });

  return {
    store,
    match,
    accessDenied,
  };
}

export default async () => ({
  components: {
    MessageBubble: await import("../../components/message-bubble/main.js").then((module) =>
      module.default(),
    ),
  },
  setup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((response) =>
    response.text(),
  ),
});
