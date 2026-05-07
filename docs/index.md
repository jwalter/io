---
layout: home

hero:
  name: IO
  text: Personal AI Assistant
  tagline: A Rust-powered daemon using the GitHub Models API with dynamic multi-agent squads
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Architecture
      link: /architecture/overview
    - theme: alt
      text: GitHub
      link: https://github.com/michaeljolley/io

features:
  - icon: 🤖
    title: Hybrid Orchestrator
    details: The orchestrator uses the LLM to decide — answering simple questions directly and delegating complex tasks to specialist agent squads.
  - icon: 👥
    title: Dynamic Squads
    details: Per-project teams of specialized agents that persist, learn, and can be recalled across sessions.
  - icon: 🧠
    title: Knowledge System
    details: SQLite FTS5 + markdown wiki for long-term memory and cross-squad knowledge sharing.
  - icon: 📱
    title: Multi-Interface
    details: Terminal TUI and Telegram bot today, with a Vue 3 web frontend on the roadmap.
  - icon: 🔄
    title: Self-Updating
    details: Automatically checks GitHub Releases and applies updates with SHA256 verification.
  - icon: 🛠️
    title: Extensible Tools
    details: Built-in tools for file ops, shell commands, web fetch, wiki, and calendar — with a skills marketplace planned.
---
