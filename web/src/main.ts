import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router/index";
import { initSupabase } from "./lib/supabase";
import "./style.css";

async function bootstrap() {
  await initSupabase();
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);

  // Start listening for auth state changes (token refresh, etc.)
  const { useAuthStore } = await import("./stores/auth");
  const auth = useAuthStore();
  auth.initAuthListener();

  app.mount("#app");
}

bootstrap();
