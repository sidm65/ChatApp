import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useCourtConnectStore } from "../../store.js";

function setup() {
  const store = useCourtConnectStore();
  const router = useRouter();

  onMounted(() => {
    (async () => {
      await store.refreshProfiles();
      if (!store.profileDirty.value) {
        store.resetProfileEditor();
      }
    })();
  });

  async function handleSaveProfile() {
    const result = await store.saveProfile();
    if (result.ok && result.created) {
      router.push("/matches");
    }
  }

  return { store, handleSaveProfile };
}

export default async () => ({
  setup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((response) =>
    response.text(),
  ),
});
