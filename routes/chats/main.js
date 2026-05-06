import { onMounted } from "vue";
import { useCourtConnectStore } from "../../store.js";

function setup() {
  const store = useCourtConnectStore();

  onMounted(() => {
    store.clearActiveChat();
    store.refreshProfiles();
    store.refreshChats();
    store.refreshMatches();
    store.refreshConversationMessages();
  });

  return { store };
}

export default async () => ({
  setup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((response) =>
    response.text(),
  ),
});
