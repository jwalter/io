import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'IO',
  description: 'IO — a personal AI assistant daemon powered by the GitHub Copilot SDK',
  base: '/io/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/io/logo.svg' }],
  ],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'Reference', link: '/reference/tools' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Telegram Bot', link: '/guide/telegram' },
            { text: 'Auto-Update', link: '/guide/auto-update' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/overview' },
            { text: 'Orchestrator', link: '/architecture/orchestrator' },
            { text: 'Squads', link: '/architecture/squads' },
            { text: 'Knowledge System', link: '/architecture/knowledge' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Tools', link: '/reference/tools' },
            { text: 'CLI', link: '/reference/cli' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/michaeljolley/io' },
    ],

    editLink: {
      pattern: 'https://github.com/michaeljolley/io/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025 Michael Jolley',
    },

    search: {
      provider: 'local',
    },
  },
})
