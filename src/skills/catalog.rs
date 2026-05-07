//! Skill catalog — holds discovered skills and generates prompt XML.

use super::types::SkillEntry;

/// The skill catalog holds all discovered skills and generates
/// the `<available_skills>` XML block for system prompt injection.
pub struct SkillCatalog {
    skills: Vec<SkillEntry>,
}

impl SkillCatalog {
    /// Build a catalog from scanned skill entries.
    pub fn new(skills: Vec<SkillEntry>) -> Self {
        Self { skills }
    }

    /// Get all skills in the catalog.
    pub fn skills(&self) -> &[SkillEntry] {
        &self.skills
    }

    /// Check if the catalog has any skills.
    pub fn is_empty(&self) -> bool {
        self.skills.is_empty()
    }

    /// Number of skills in the catalog.
    pub fn len(&self) -> usize {
        self.skills.len()
    }

    /// Generate the `<available_skills>` XML block for injection into
    /// the orchestrator's system prompt. This follows the Agent Skills
    /// spec's progressive disclosure model — only name + description
    /// are included (~100 tokens per skill).
    pub fn to_prompt_xml(&self) -> String {
        if self.skills.is_empty() {
            return String::new();
        }

        let mut xml = String::from("\n\n## Installed Skills\n\n");
        xml.push_str("You have the following skills available. ");
        xml.push_str("Use the `activate_skill` tool to load a skill's full instructions when a task matches its description.\n\n");
        xml.push_str("<available_skills>\n");

        for skill in &self.skills {
            xml.push_str("<skill>\n");
            xml.push_str(&format!("  <name>{}</name>\n", skill.name));
            xml.push_str(&format!(
                "  <description>{}</description>\n",
                skill.description
            ));
            xml.push_str(&format!(
                "  <location>{}</location>\n",
                skill.location.display()
            ));
            xml.push_str("</skill>\n");
        }

        xml.push_str("</available_skills>");
        xml
    }

    /// Find a skill by name.
    pub fn find(&self, name: &str) -> Option<&SkillEntry> {
        self.skills.iter().find(|s| s.name == name)
    }
}
