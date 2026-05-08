---
layout: home

hero:
  name: IO
  text: Personal AI Assistant
  tagline: Your AI-powered personal assistant, built with the GitHub Copilot SDK
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
    title: Smart Orchestrator
    details: Uses Copilot SDK sessions with infinite context and automatic compaction to handle conversations of any length.
  - icon: 👥
    title: Project Squads
    details: Persistent teams of specialized agents stored in SQLite, recalled across sessions for per-project continuity.
  - icon: 🧠
    title: Knowledge Wiki
    details: Markdown-based wiki for long-term memory and cross-squad knowledge sharing.
  - icon: 📱
    title: Multi-Interface
    details: Telegram bot (grammy), terminal TUI (readline), and Web API (Express SSE) — use IO from anywhere.
  - icon: 🛠️
    title: Skills System
    details: Load skills from SKILL.md files and a skills.sh registry to extend IO with new capabilities.
  - icon: 🔄
    title: Auto-Update
    details: npm-based self-update on startup keeps IO current without manual intervention.
---
