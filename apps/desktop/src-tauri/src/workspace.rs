//! Workspace discovery: the Git repositories inside a folder, or listed by a
//! VS Code `.code-workspace` file. Read-only: nothing is written to the
//! repositories or to the workspace file.

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const MAX_DEPTH: usize = 4;
const MAX_REPOSITORIES: usize = 200;
const SKIPPED_DIRECTORIES: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "vendor",
    "venv",
    "Library",
    "Pods",
    "DerivedData",
    "__pycache__",
];

#[derive(Debug, Serialize, PartialEq)]
pub struct WorkspaceRepository {
    pub path: String,
    pub name: String,
    /// Same digest as `RepositorySnapshot.project_hash`, used to match Gemini CLI events.
    pub project_hash: String,
}

#[derive(Debug, Serialize)]
pub struct Workspace {
    /// `folder` or `code-workspace`.
    pub source: &'static str,
    pub path: String,
    pub label: String,
    pub repositories: Vec<WorkspaceRepository>,
    /// Folders listed by a `.code-workspace` file that do not exist on this machine.
    pub missing_folders: Vec<String>,
}

pub fn discover(path: &Path) -> Result<Workspace, String> {
    let is_code_workspace = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("code-workspace"));
    let label = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("workspace")
        .to_owned();
    let mut repositories = Vec::new();
    let mut missing_folders = Vec::new();
    if is_code_workspace {
        let text = fs::read_to_string(path)
            .map_err(|error| format!("Lecture du workspace impossible : {error}"))?;
        let base = path.parent().unwrap_or(Path::new("."));
        for folder in code_workspace_folders(&text)? {
            let folder_path = if Path::new(&folder).is_absolute() {
                PathBuf::from(&folder)
            } else {
                base.join(&folder)
            };
            let folder_path = fs::canonicalize(&folder_path).unwrap_or(folder_path);
            if folder_path.is_dir() {
                find_repositories(&folder_path, 0, &mut repositories);
            } else {
                missing_folders.push(folder_path.display().to_string());
            }
        }
    } else if path.is_dir() {
        find_repositories(path, 0, &mut repositories);
    } else {
        return Err("Choisis un dossier ou un fichier .code-workspace.".into());
    }
    repositories.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.path.cmp(&b.path))
    });
    repositories.dedup_by(|a, b| a.path == b.path);
    Ok(Workspace {
        source: if is_code_workspace {
            "code-workspace"
        } else {
            "folder"
        },
        path: path.display().to_string(),
        label,
        repositories,
        missing_folders,
    })
}

fn is_repository(path: &Path) -> bool {
    // `.git` is a directory for a normal clone and a file for worktrees and submodules.
    path.join(".git").exists()
}

fn find_repositories(directory: &Path, depth: usize, out: &mut Vec<WorkspaceRepository>) {
    if out.len() >= MAX_REPOSITORIES {
        return;
    }
    if is_repository(directory) {
        let path = directory.display().to_string();
        out.push(WorkspaceRepository {
            name: directory
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&path)
                .to_owned(),
            project_hash: format!("{:x}", Sha256::digest(path.as_bytes())),
            path,
        });
        // Nested repositories (submodules) stay part of their parent here.
        return;
    }
    if depth >= MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut children: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .filter(|child| {
            child
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| !name.starts_with('.') && !SKIPPED_DIRECTORIES.contains(&name))
        })
        .collect();
    children.sort();
    for child in children {
        find_repositories(&child, depth + 1, out);
    }
}

/// Folder paths of a `.code-workspace` file, which is JSON with comments and trailing commas.
pub fn code_workspace_folders(text: &str) -> Result<Vec<String>, String> {
    let json: Value = serde_json::from_str(&strip_jsonc(text))
        .map_err(|error| format!("Fichier .code-workspace illisible : {error}"))?;
    Ok(json
        .get("folders")
        .and_then(Value::as_array)
        .map(|folders| {
            folders
                .iter()
                .filter_map(|folder| folder.get("path").and_then(Value::as_str))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default())
}

fn strip_jsonc(text: &str) -> String {
    strip_trailing_commas(&strip_comments(text))
}

/// Calls `visit` for each character outside string literals; string contents are copied as is.
fn copy_strings(
    text: &str,
    mut visit: impl FnMut(char, &mut std::iter::Peekable<std::str::Chars>, &mut String),
) -> String {
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '"' {
            output.push(character);
            while let Some(next) = chars.next() {
                output.push(next);
                if next == '\\' {
                    if let Some(escaped) = chars.next() {
                        output.push(escaped);
                    }
                } else if next == '"' {
                    break;
                }
            }
        } else {
            visit(character, &mut chars, &mut output);
        }
    }
    output
}

fn strip_comments(text: &str) -> String {
    copy_strings(text, |character, chars, output| {
        match (character, chars.peek()) {
            ('/', Some('/')) => {
                for next in chars.by_ref() {
                    if next == '\n' {
                        output.push('\n');
                        break;
                    }
                }
            }
            ('/', Some('*')) => {
                chars.next();
                let mut previous = ' ';
                for next in chars.by_ref() {
                    if previous == '*' && next == '/' {
                        break;
                    }
                    previous = next;
                }
            }
            _ => output.push(character),
        }
    })
}

fn strip_trailing_commas(text: &str) -> String {
    copy_strings(text, |character, chars, output| {
        if character == ',' {
            let rest: String = chars.clone().collect();
            if matches!(rest.trim_start().chars().next(), Some('}') | Some(']')) {
                return;
            }
        }
        output.push(character);
    })
}

/// Main repository root of each path: worktrees resolve to the clone they belong to.
/// Paths that are not inside a Git repository map to `None`.
pub fn main_repositories(paths: Vec<String>) -> HashMap<String, Option<String>> {
    paths
        .into_iter()
        .take(200)
        .map(|path| {
            let root = main_repository(Path::new(&path));
            (path, root)
        })
        .collect()
}

fn main_repository(path: &Path) -> Option<String> {
    if !path.is_dir() {
        return None;
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args([
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
            "--show-toplevel",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut lines = text.lines();
    let common_dir = PathBuf::from(lines.next()?.trim());
    let top_level = lines.next()?.trim().to_owned();
    // A clone's common dir is `<root>/.git`; for a worktree it still points into the main clone.
    if common_dir.file_name().and_then(|name| name.to_str()) == Some(".git") {
        common_dir
            .parent()
            .map(|parent| parent.display().to_string())
    } else {
        Some(top_level)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_code_workspace_folders_with_comments_and_trailing_commas() {
        let text = r#"{
            // VS Code allows comments
            "folders": [
                { "path": "api" },
                { "path": "../web", "name": "Front /* not a comment */" }, /* block */
            ],
            "settings": { "url": "http://example.test//x", },
        }"#;
        assert_eq!(code_workspace_folders(text).unwrap(), vec!["api", "../web"]);
    }

    #[test]
    fn discovers_repositories_and_skips_dependencies() {
        let root = std::env::temp_dir().join(format!("agent-observer-ws-{}", uuid::Uuid::new_v4()));
        for repo in [
            "alpha",
            "group/beta",
            "node_modules/ignored",
            "alpha/nested",
        ] {
            fs::create_dir_all(root.join(repo).join(".git")).unwrap();
        }
        fs::create_dir_all(root.join("gamma")).unwrap();
        fs::write(root.join("gamma/.git"), "gitdir: /elsewhere").unwrap();
        fs::write(
            root.join("team.code-workspace"),
            r#"{ "folders": [ { "path": "group" }, { "path": "missing" }, ] }"#,
        )
        .unwrap();

        let folder = discover(&root).unwrap();
        let names: Vec<_> = folder
            .repositories
            .iter()
            .map(|repo| repo.name.as_str())
            .collect();
        assert_eq!(folder.source, "folder");
        assert_eq!(names, vec!["alpha", "beta", "gamma"]);
        assert_eq!(
            folder.repositories[0].project_hash,
            format!(
                "{:x}",
                Sha256::digest(folder.repositories[0].path.as_bytes())
            )
        );

        let listed = discover(&root.join("team.code-workspace")).unwrap();
        let _ = fs::remove_dir_all(&root);
        assert_eq!(listed.source, "code-workspace");
        assert_eq!(listed.label, "team");
        assert_eq!(
            listed
                .repositories
                .iter()
                .map(|repo| repo.name.as_str())
                .collect::<Vec<_>>(),
            vec!["beta"]
        );
        assert_eq!(listed.missing_folders.len(), 1);
    }
}
