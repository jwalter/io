#![allow(dead_code)]

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use semver::Version;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

use crate::event_bus::Event;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

pub struct UpdateConfig {
    pub enabled: bool,
    pub check_interval_hours: u64,
    pub auto_apply: bool,
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            check_interval_hours: 12,
            auto_apply: true,
        }
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub download_url: String,
    pub checksum: String,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

fn current_target() -> &'static str {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
}

fn archive_name() -> String {
    let target = current_target();
    if cfg!(target_os = "windows") {
        format!("io-daemon-{target}.zip")
    } else {
        format!("io-daemon-{target}.tar.gz")
    }
}

fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "io-daemon.exe"
    } else {
        "io-daemon"
    }
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/// Check GitHub for a newer release. Returns `Some(UpdateInfo)` when an update
/// is available, or `None` if already on the latest version.
pub async fn check_for_update(current_version: &str) -> Result<Option<UpdateInfo>> {
    let current = Version::parse(current_version)
        .context("Failed to parse current version as semver")?;

    let client = reqwest::Client::new();
    let release: GitHubRelease = client
        .get("https://api.github.com/repos/michaeljolley/io/releases/latest")
        .header(
            "User-Agent",
            format!("io-daemon/{}", env!("CARGO_PKG_VERSION")),
        )
        .send()
        .await
        .context("Failed to fetch latest release from GitHub")?
        .json()
        .await
        .context("Failed to parse GitHub release response")?;

    let tag = release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name);
    let latest = Version::parse(tag).context("Failed to parse release tag as semver")?;

    if latest <= current {
        return Ok(None);
    }

    let archive = archive_name();
    let download_url = release
        .assets
        .iter()
        .find(|a| a.name == archive)
        .map(|a| a.browser_download_url.clone())
        .context(format!("No asset found for platform archive: {archive}"))?;

    // Fetch sha256sums.txt to extract the checksum for our archive.
    let sums_url = release
        .assets
        .iter()
        .find(|a| a.name == "sha256sums.txt")
        .map(|a| a.browser_download_url.clone())
        .context("No sha256sums.txt asset found in release")?;

    let sums_text = client
        .get(&sums_url)
        .header(
            "User-Agent",
            format!("io-daemon/{}", env!("CARGO_PKG_VERSION")),
        )
        .send()
        .await
        .context("Failed to download sha256sums.txt")?
        .text()
        .await
        .context("Failed to read sha256sums.txt body")?;

    let checksum = parse_checksum(&sums_text, &archive)
        .context(format!("Checksum for {archive} not found in sha256sums.txt"))?;

    Ok(Some(UpdateInfo {
        version: latest.to_string(),
        download_url,
        checksum,
    }))
}

/// Download the release archive, extract the binary, verify its SHA256 hash,
/// and return the path to the verified binary inside `temp_dir`.
pub async fn download_and_verify(info: &UpdateInfo, temp_dir: &Path) -> Result<PathBuf> {
    let client = reqwest::Client::new();

    // Download the archive bytes.
    let archive_bytes = client
        .get(&info.download_url)
        .header(
            "User-Agent",
            format!("io-daemon/{}", env!("CARGO_PKG_VERSION")),
        )
        .send()
        .await
        .context("Failed to download release archive")?
        .bytes()
        .await
        .context("Failed to read archive bytes")?;

    let binary_path = temp_dir.join(binary_name());

    // Extract the binary from the archive.
    if cfg!(target_os = "windows") {
        extract_zip(&archive_bytes, &binary_path)?;
    } else {
        extract_tar_gz(&archive_bytes, &binary_path)?;
    }

    // Verify SHA256 checksum of the extracted binary.
    let binary_bytes = tokio::fs::read(&binary_path)
        .await
        .context("Failed to read extracted binary for checksum verification")?;

    let mut hasher = Sha256::new();
    hasher.update(&binary_bytes);
    let computed = format!("{:x}", hasher.finalize());

    if computed != info.checksum {
        anyhow::bail!(
            "Checksum mismatch: expected {}, got {}",
            info.checksum,
            computed
        );
    }

    info!("Update binary verified (SHA256 OK)");
    Ok(binary_path)
}

/// Replace the running binary with a new version and restart the process.
pub async fn apply_update(new_binary: &Path) -> Result<()> {
    let current_exe = std::env::current_exe().context("Failed to determine current exe path")?;
    let backup = current_exe.with_extension("old");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        // Rename current → .old, then copy new binary in place.
        tokio::fs::rename(&current_exe, &backup)
            .await
            .context("Failed to rename current binary to .old")?;

        tokio::fs::copy(new_binary, &current_exe)
            .await
            .context("Failed to copy new binary into place")?;

        // Ensure executable permissions.
        let perms = std::fs::Permissions::from_mode(0o755);
        tokio::fs::set_permissions(&current_exe, perms)
            .await
            .context("Failed to set executable permissions on new binary")?;

        info!("Update applied, restarting...");
    }

    #[cfg(windows)]
    {
        // On Windows the running binary cannot be replaced directly.
        // Rename current → .old (Windows allows renaming an open file).
        tokio::fs::rename(&current_exe, &backup)
            .await
            .context("Failed to rename current binary to .old on Windows")?;

        tokio::fs::copy(new_binary, &current_exe)
            .await
            .context("Failed to copy new binary into place on Windows")?;

        info!("Update applied (old binary will be cleaned up on next start), restarting...");
    }

    // Spawn the new binary with the same arguments and exit.
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::Command::new(&current_exe)
        .args(&args)
        .spawn()
        .context("Failed to spawn updated binary")?;

    std::process::exit(0);
}

/// Spawn a background task that periodically checks for updates.
pub fn spawn_update_checker(
    config: UpdateConfig,
    event_sender: broadcast::Sender<Event>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        if !config.enabled {
            info!("Auto-update checker is disabled");
            return;
        }

        let interval = tokio::time::Duration::from_secs(config.check_interval_hours * 3600);
        let current_version = env!("CARGO_PKG_VERSION");

        loop {
            tokio::time::sleep(interval).await;

            match check_for_update(current_version).await {
                Ok(Some(update_info)) => {
                    let msg = format!(
                        "Update available: v{}. Run with --update to apply.",
                        update_info.version
                    );
                    info!("{}", msg);

                    let _ = event_sender.send(Event::System {
                        level: "info".to_string(),
                        message: msg,
                    });

                    if config.auto_apply {
                        info!("Auto-apply enabled, applying update...");
                        let temp_dir =
                            std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()));

                        if let Some(dir) = temp_dir {
                            match download_and_verify(&update_info, &dir).await {
                                Ok(binary_path) => {
                                    if let Err(e) = apply_update(&binary_path).await {
                                        error!("Failed to apply update: {e:#}");
                                    }
                                }
                                Err(e) => {
                                    error!("Failed to download/verify update: {e:#}");
                                }
                            }
                        } else {
                            error!("Could not determine directory for update download");
                        }
                    }
                }
                Ok(None) => {
                    info!("No update available, already on latest version");
                }
                Err(e) => {
                    warn!("Update check failed: {e:#}");
                }
            }
        }
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse a sha256sums.txt file and find the hash for the given filename.
/// Expected format per line: `<hash>  <filename>` or `<hash> <filename>`
fn parse_checksum(sums_text: &str, filename: &str) -> Option<String> {
    for line in sums_text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() == 2 && parts[1] == filename {
            return Some(parts[0].to_string());
        }
    }
    None
}

/// Extract the binary from a `.tar.gz` archive.
fn extract_tar_gz(archive_bytes: &[u8], output_path: &Path) -> Result<()> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let decoder = GzDecoder::new(archive_bytes);
    let mut archive = Archive::new(decoder);

    let target_name = binary_name();

    for entry in archive.entries().context("Failed to read tar entries")? {
        let mut entry = entry.context("Failed to read tar entry")?;
        let path = entry.path().context("Failed to read entry path")?;

        if path.file_name().and_then(|n| n.to_str()) == Some(target_name) {
            entry
                .unpack(output_path)
                .context("Failed to extract binary from tar.gz")?;
            return Ok(());
        }
    }

    anyhow::bail!("Binary '{target_name}' not found in tar.gz archive")
}

/// Extract the binary from a `.zip` archive.
fn extract_zip(archive_bytes: &[u8], output_path: &Path) -> Result<()> {
    use std::io::{Cursor, Read};
    use zip::ZipArchive;

    let reader = Cursor::new(archive_bytes);
    let mut archive = ZipArchive::new(reader).context("Failed to open zip archive")?;

    let target_name = binary_name();

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .context("Failed to read zip entry")?;

        let name = file.name().to_string();
        if name == target_name || name.ends_with(&format!("/{target_name}")) {
            let mut contents = Vec::new();
            file.read_to_end(&mut contents)
                .context("Failed to read binary from zip")?;
            std::fs::write(output_path, &contents)
                .context("Failed to write extracted binary")?;
            return Ok(());
        }
    }

    anyhow::bail!("Binary '{target_name}' not found in zip archive")
}
