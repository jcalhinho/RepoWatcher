import { useState } from "react";
import { t } from "./i18n";
import { EmptyState, SectionHeader } from "./Explain";
import { RepositoryMap } from "./RepositoryMap";
import { Resizable } from "./Resizable";
import type { SessionEvent } from "./types";
import type { WorkspaceModel } from "./useWorkspace";
import { filterByRepository, pathKey, type RepositoryFilter, type WorkspaceRepository } from "./workspace";
import { RepositoryTable, type RepositoryActivity } from "./WorkspaceViews";

/** The workspace's repositories: Git state next to agent activity, and the detail of one repository. */
export function RepositoriesPage({ model, activity, events, onFilter }: { model: WorkspaceModel; activity: Map<string, RepositoryActivity>; events: SessionEvent[]; onFilter: (filter: RepositoryFilter) => void }) {
  const [selected, setSelected] = useState<WorkspaceRepository | null>(null);
  const current = (selected && model.repositories.find((repository) => pathKey(repository.path) === pathKey(selected.path))) ?? model.repositories[0] ?? null;
  const snapshot = current ? model.states[current.path]?.snapshot ?? null : null;

  return <section className="page">
    <SectionHeader
      title={t("Dépôts", "Repositories")}
      description={model.workspace ? t(`${model.repositories.length} dépôt${model.repositories.length > 1 ? "s" : ""} dans « ${model.workspace.label} ». Clique sur une ligne pour voir le détail du dépôt.`, `${model.repositories.length} repositor${model.repositories.length > 1 ? "ies" : "y"} in “${model.workspace.label}”. Click a row to see the repository’s details.`) : t("Choisis un workspace en haut à gauche pour suivre ici tous ses dépôts Git.", "Pick a workspace at the top left to follow all its Git repositories here.")}
      details={t("L’état Git (branche, fichiers non commités, commits à envoyer ou à récupérer) est lu toutes les 5 secondes pour les dépôts où un agent travaille, toutes les minutes pour les autres. L’app ne fait aucune action Git et n’attribue jamais un changement à un agent.", "Git state (branch, uncommitted files, commits to push or pull) is read every 5 seconds for repositories where an agent works, every minute for the others. The app runs no Git action and never attributes a change to an agent.")}
    />
    {model.workspace?.missing_folders.length ? <p className="notice warn">{t("Dossiers du workspace introuvables", "Workspace folders not found")} : {model.workspace.missing_folders.join(" · ")}</p> : null}
    {model.error && <p className="notice warn">{model.error}</p>}
    {!model.workspace
      ? <EmptyState title={t("Aucun workspace choisi", "No workspace chosen")}>{t("Un workspace est un dossier qui contient tes projets, ou un fichier .code-workspace de VS Code. Utilise le bouton « Workspace » en haut à gauche.", "A workspace is a folder holding your projects, or a VS Code .code-workspace file. Use the “Workspace” button at the top left.")}</EmptyState>
      : !model.repositories.length
        ? <EmptyState title={t("Aucun dépôt Git trouvé", "No Git repository found")}>{t("Ce workspace ne contient pas de dépôt Git (jusqu’à 4 niveaux de dossiers). Choisis un dossier plus haut ou un autre workspace.", "This workspace holds no Git repository (up to 4 folder levels deep). Pick a higher folder or another workspace.")}</EmptyState>
        : <>
            <Resizable id="repositories-table" defaultHeight={320} min={150} max={1400} label={t("le tableau des dépôts", "the repositories table")}>
              <RepositoryTable model={model} activity={activity} selected={current?.path ?? null} onSelect={setSelected} onFilter={onFilter} />
            </Resizable>
            {current && <div className="page-section">
              <SectionHeader level={3} title={t(`Détail : ${current.name}`, `Details: ${current.name}`)} description={t("Fichiers modifiés selon Git, fichiers touchés par les agents, et derniers commits, présentés côte à côte.", "Files changed according to Git, files touched by agents, and latest commits, side by side.")} />
              {snapshot ? <RepositoryMap snapshot={snapshot} events={filterByRepository(events, current.path, model.repositoryOf)} /> : <p className="text-muted">{t("Lecture de l’état Git…", "Reading Git state…")}</p>}
            </div>}
          </>}
  </section>;
}
