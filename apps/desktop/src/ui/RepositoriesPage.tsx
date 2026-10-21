import { useState } from "react";
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
      title="Dépôts"
      description={model.workspace ? `${model.repositories.length} dépôt${model.repositories.length > 1 ? "s" : ""} dans « ${model.workspace.label} ». Clique sur une ligne pour voir le détail du dépôt.` : "Choisis un workspace en haut à gauche pour suivre ici tous ses dépôts Git."}
      details="L’état Git (branche, fichiers non commités, commits à envoyer ou à récupérer) est lu toutes les 5 secondes pour les dépôts où un agent travaille, toutes les minutes pour les autres. L’app ne fait aucune action Git et n’attribue jamais un changement à un agent."
    />
    {model.workspace?.missing_folders.length ? <p className="notice warn">Dossiers du workspace introuvables : {model.workspace.missing_folders.join(" · ")}</p> : null}
    {model.error && <p className="notice warn">{model.error}</p>}
    {!model.workspace
      ? <EmptyState title="Aucun workspace choisi">Un workspace est un dossier qui contient tes projets, ou un fichier <code>.code-workspace</code> de VS Code. Utilise le bouton « Workspace » en haut à gauche.</EmptyState>
      : !model.repositories.length
        ? <EmptyState title="Aucun dépôt Git trouvé">Ce workspace ne contient pas de dépôt Git (jusqu’à 4 niveaux de dossiers). Choisis un dossier plus haut ou un autre workspace.</EmptyState>
        : <>
            <Resizable id="repositories-table" defaultHeight={320} min={150} max={1400} label="le tableau des dépôts">
              <RepositoryTable model={model} activity={activity} selected={current?.path ?? null} onSelect={setSelected} onFilter={onFilter} />
            </Resizable>
            {current && <div className="page-section">
              <SectionHeader level={3} title={`Détail : ${current.name}`} description="Fichiers modifiés selon Git, fichiers touchés par les agents, et derniers commits, présentés côte à côte." />
              {snapshot ? <RepositoryMap snapshot={snapshot} events={filterByRepository(events, current.path, model.repositoryOf)} /> : <p className="text-muted">Lecture de l’état Git…</p>}
            </div>}
          </>}
  </section>;
}
