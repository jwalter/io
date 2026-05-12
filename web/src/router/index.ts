import { createRouter, createWebHistory } from 'vue-router'
import ChatView from '../views/ChatView.vue'
import SkillsView from '../views/SkillsView.vue'
import SquadsView from '../views/SquadsView.vue'
import AgentActivityView from '../views/AgentActivityView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/chat',
    },
    {
      path: '/chat',
      name: 'chat',
      component: ChatView,
    },
    {
      path: '/skills',
      name: 'skills',
      component: SkillsView,
    },
    {
      path: '/squads',
      name: 'squads',
      component: SquadsView,
    },
    {
      path: '/activity',
      name: 'activity',
      component: AgentActivityView,
    },
  ],
})

export default router
