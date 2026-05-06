import { createApp, watch } from "vue";
import {
  createRouter,
  createWebHashHistory,
  useRoute,
  useRouter,
} from "vue-router";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import {
  GraffitiPlugin,
  useGraffiti,
  useGraffitiSession,
} from "@graffiti-garden/wrapper-vue";
import { provideCourtConnectStore } from "./store.js";

function loadComponent(name) {
  return () => import(`./routes/${name}/main.js`).then((module) => module.default());
}

const routes = [
  { path: "/", redirect: "/matches" },
  {
    path: "/login",
    name: "login",
    component: loadComponent("login"),
    meta: { guestOnly: true },
  },
  {
    path: "/profile",
    name: "profile",
    component: loadComponent("profile"),
    meta: { requiresAuth: true },
  },
  {
    path: "/profile/:actor",
    name: "profile-view",
    component: loadComponent("profile-view"),
    props: true,
    meta: { requiresAuth: true },
  },
  {
    path: "/matches",
    name: "matches",
    component: loadComponent("matches"),
    meta: { requiresAuth: true },
  },
  {
    path: "/matches/:matchId/chat",
    name: "match-chat",
    component: loadComponent("match-chat"),
    props: true,
    meta: { requiresAuth: true },
  },
  {
    path: "/chats",
    name: "chats",
    component: loadComponent("chats"),
    meta: { requiresAuth: true },
  },
  {
    path: "/chats/:actor",
    name: "chat",
    component: loadComponent("chat"),
    props: true,
    meta: { requiresAuth: true },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

function setup() {
  const route = useRoute();
  const router = useRouter();
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const store = provideCourtConnectStore();

  const isLoggedIn = () => !!session.value;
  const isLoadingSession = () => session.value === undefined;

  watch(
    [() => route.fullPath, () => session.value],
    () => {
      if (isLoadingSession()) {
        return;
      }

      const requiresAuth = route.matched.some((record) => record.meta.requiresAuth);
      const guestOnly = route.matched.some((record) => record.meta.guestOnly);

      if (requiresAuth && !isLoggedIn()) {
        router.replace("/login");
        return;
      }

      if (guestOnly && isLoggedIn()) {
        router.replace("/matches");
      }
    },
    { immediate: true },
  );

  async function logIn() {
    await graffiti.login();
  }

  async function logOut() {
    if (!session.value) {
      return;
    }
    const confirmed = window.confirm("Log out of Court Connect?");
    if (!confirmed) {
      return;
    }
    await graffiti.logout(session.value);
  }

  return {
    store,
    session,
    logIn,
    logOut,
  };
}

createApp({
  template: "#template",
  setup,
})
  .use(GraffitiPlugin, {
    graffiti: new GraffitiDecentralized(),
  })
  .use(router)
  .mount("#app");
