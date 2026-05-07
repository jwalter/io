//! Agent Skills system — discover, catalog, and activate SKILL.md-based skills.
//!
//! Supports the open Agent Skills format (agentskills.io) and the
//! skills.sh registry for searching and installing community skills.

pub mod catalog;
pub mod registry;
pub mod scanner;
pub mod types;

pub use catalog::SkillCatalog;
pub use scanner::{parse_skill_content, scan_all_skills};
pub use types::SkillEntry;
