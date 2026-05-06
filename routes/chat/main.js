import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useCourtConnectStore } from "../../store.js";

function setup() {
  const route = useRoute();
  const store = useCourtConnectStore();

  const routeActor = computed(() =>
    typeof route.params.actor === "string" ? route.params.actor : "",
  );

  const isSelfRoute = computed(() => routeActor.value === store.myActor.value);
  const routePerson = computed(() =>
    store.people.value.find((person) => person.actor === routeActor.value),
  );
  const isInvalidRoute = computed(() => {
    if (!routeActor.value || store.profilesLoading.value) {
      return false;
    }
    return isSelfRoute.value || !routePerson.value;
  });

  onMounted(() => {
    store.refreshProfiles();
    store.refreshChats();
    store.refreshConversationMessages();
  });

  watch(
    [
      routeActor,
      () => store.session.value,
      () => store.profileReady.value,
      () => store.profilesLoading.value,
      routePerson,
    ],
    async ([actor, session, profileReady, profilesLoading, person]) => {
      if (!actor || !session || !profileReady || profilesLoading || !person || actor === store.myActor.value) {
        return;
      }
      await store.openChat(actor);
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    store.clearActiveChat();
  });

  return {
    store,
    routeActor,
    routePerson,
    isInvalidRoute,
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
