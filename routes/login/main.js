import { useGraffiti } from "@graffiti-garden/wrapper-vue";
import { useCourtConnectStore } from "../../store.js";

function setup() {
  const graffiti = useGraffiti();
  const store = useCourtConnectStore();

  async function logIn() {
    await graffiti.login();
  }

  return { store, logIn };
}

export default async () => ({
  setup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((response) =>
    response.text(),
  ),
});
