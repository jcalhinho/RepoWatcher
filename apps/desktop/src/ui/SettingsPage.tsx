import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SectionHeader } from "./Explain";

type CapturePolicy = { capture_prompts: boolean; capture_commands: boolean };

const RETENTION_OPTIONS: Array<[number, string]> = [[7, "7 jours"], [30, "30 jours"], [90, "90 jours"], [365, "1 an"], [0, "Tout garder"]];

/** What is recorded, for how long, and the history export / erase actions. */
export function SettingsPage({ onExport, onClear, onMini }: { onExport: () => Promise<string | null>; onClear: () => Promise<boolean>; onMini: () => void }) {
  const [policy, setPolicy] = useState<CapturePolicy | null>(null);
  const [retention, setRetention] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const preview = policy === null && retention === null && notice.startsWith("Aperçu");

  useEffect(() => {
    // Every setup command reports the shared capture policy.
    invoke<CapturePolicy>("codex_setup").then(({ capture_prompts, capture_commands }) => setPolicy({ capture_prompts, capture_commands })).catch(() => setNotice("Aperçu : les réglages ne sont disponibles que dans l’application de bureau."));
    invoke<number>("retention_policy").then(setRetention).catch(() => undefined);
  }, []);

  async function savePolicy(next: CapturePolicy) {
    try {
      await invoke("update_capture_policy", { capturePrompts: next.capture_prompts, captureCommands: next.capture_commands });
      setPolicy(next);
      setNotice("Réglage enregistré.");
    } catch {
      setNotice("Impossible d’enregistrer ce réglage.");
    }
  }

  async function saveRetention(days: number) {
    if (days > 0 && retention !== null && (retention === 0 || days < retention) && !window.confirm(`Supprimer dès maintenant les événements de plus de ${days} jours ? Cette action ne peut pas être annulée.`)) return;
    try {
      const removed = await invoke<number>("update_retention_policy", { days });
      setRetention(days);
      setNotice(removed ? `${removed.toLocaleString("fr-FR")} événements anciens supprimés.` : "Réglage enregistré.");
    } catch (error) {
      setNotice(String(error));
    }
  }

  return <section className="page settings-page">
    <SectionHeader title="Réglages" description="Ce que l’app enregistre, combien de temps elle le garde, et ce que tu peux en faire. Tout reste sur cet ordinateur." />
    {notice && <p className={`notice ${preview ? "warn" : ""}`} role="status">{notice}</p>}

    <div className="settings-group">
      <h3>Ce qui est enregistré</h3>
      <p>Par défaut, l’app ne garde que le <b>déroulé</b> : quel agent, quel outil, quel fichier, quand, combien de tokens. Les réponses des agents, leurs raisonnements et les résultats des outils ne sont <b>jamais</b> enregistrés.</p>
      <Toggle checked={policy?.capture_prompts ?? false} disabled={!policy} onChange={(value) => policy && savePolicy({ ...policy, capture_prompts: value })} title="Enregistrer le texte de mes messages aux agents" hint="Utile pour relire une session, mais tes messages peuvent contenir du code privé ou des informations confidentielles." />
      <Toggle checked={policy?.capture_commands ?? false} disabled={!policy} onChange={(value) => policy && savePolicy({ ...policy, capture_commands: value })} title="Enregistrer les commandes lancées par les agents" hint="Par exemple « npm test ». Une commande peut contenir un mot de passe ou un jeton : à activer en connaissance de cause." />
    </div>

    <div className="settings-group">
      <h3>Combien de temps</h3>
      <label className="setting-row">
        <span><b>Conservation des événements</b><small>Les événements plus anciens sont supprimés automatiquement, au démarrage puis toutes les heures.</small></span>
        <select value={retention ?? ""} disabled={retention === null} onChange={(event) => void saveRetention(Number(event.target.value))}>
          {retention === null && <option value="">—</option>}
          {RETENTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>

    <div className="settings-group">
      <h3>Mes données</h3>
      <div className="setting-row">
        <span><b>Exporter l’historique</b><small>Un fichier JSON avec tous les événements enregistrés, pour les archiver ou les analyser ailleurs.</small></span>
        <button className="button" onClick={async () => { const message = await onExport(); if (message) setNotice(message); }}>Exporter…</button>
      </div>
      <div className="setting-row">
        <span><b>Effacer l’historique</b><small>Supprime définitivement tous les événements enregistrés sur cet ordinateur.</small></span>
        <button className="button danger" onClick={async () => { if (await onClear()) setNotice("Historique effacé."); }}>Effacer…</button>
      </div>
    </div>

    <div className="settings-group">
      <h3>Affichage</h3>
      <div className="setting-row">
        <span><b>Mode mini</b><small>Réduit l’app à une colonne dans un coin de l’écran, toujours visible, avec une carte par agent.</small></span>
        <button className="button" onClick={onMini}>Passer en mode mini</button>
      </div>
    </div>
  </section>;
}

function Toggle({ checked, disabled, onChange, title, hint }: { checked: boolean; disabled: boolean; onChange: (value: boolean) => void; title: string; hint: string }) {
  return <label className="setting-row toggle">
    <span><b>{title}</b><small>{hint}</small></span>
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
  </label>;
}
