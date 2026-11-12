import { useEffect, useId, useRef, useState } from "react";
import { useT } from "../i18n/shared";
import { Select } from "../ui";
import type { GenerationSettings, PlaygroundModel } from "./playground-types";

export function PlaygroundSettings({ settings, onChange, onClose }: {
  settings: GenerationSettings;
  onChange: (settings: GenerationSettings) => void;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const helpId = useId();
  const change = <K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <section className="playground-settings" aria-labelledby={`${id}-title`}>
      <div className="playground-settings-head">
        <h3>
          <button
            type="button"
            id={`${id}-title`}
            className="btn btn-ghost btn-sm"
            aria-expanded={true}
            aria-controls={`${id}-fields`}
          >
            {t("playground.settingsTitle")}
          </button>
        </h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
      <div id={`${id}-fields`} className="playground-settings-fields">
        <p id={helpId} className="muted text-label">{t("playground.settingsHelp")}</p>
        <label className="field-label" htmlFor={`${id}-system`}>{t("playground.systemPrompt")}</label>
        <textarea
          id={`${id}-system`}
          className="input"
          rows={4}
          value={settings.systemPrompt}
          aria-describedby={helpId}
          onChange={event => change("systemPrompt", event.target.value)}
        />
        <label className="field-label" htmlFor={`${id}-max-tokens`}>{t("playground.maxTokens")}</label>
        <input
          form="playground-composer-form"
          id={`${id}-max-tokens`}
          className="input"
          type="number"
          min={1}
          max={16384}
          step={1}
          value={settings.maxTokens}
          aria-describedby={helpId}
          onChange={event => change("maxTokens", event.target.value)}
        />
        <label className="field-label" htmlFor={`${id}-temperature`}>{t("playground.temperature")}</label>
        <input
          form="playground-composer-form"
          id={`${id}-temperature`}
          className="input"
          type="number"
          min={0}
          max={2}
          step="any"
          value={settings.temperature}
          placeholder={t("playground.unset")}
          aria-describedby={helpId}
          onChange={event => change("temperature", event.target.value)}
        />
        <label className="field-label" htmlFor={`${id}-top-p`}>{t("playground.topP")}</label>
        <input
          form="playground-composer-form"
          id={`${id}-top-p`}
          className="input"
          type="number"
          min={0}
          max={1}
          step="any"
          value={settings.topP}
          placeholder={t("playground.unset")}
          aria-describedby={helpId}
          onChange={event => change("topP", event.target.value)}
        />
        <label className="field-label" htmlFor={`${id}-reasoning`}>{t("playground.reasoningEffort")}</label>
        <Select
          id={`${id}-reasoning`}
          value={settings.reasoningEffort}
          describedBy={helpId}
          options={[
            { value: "", label: t("playground.unset") },
            { value: "none", label: t("playground.reasoningNone") },
            { value: "minimal", label: t("playground.reasoningMinimal") },
            { value: "low", label: t("playground.reasoningLow") },
            { value: "medium", label: t("playground.reasoningMedium") },
            { value: "high", label: t("playground.reasoningHigh") },
            { value: "xhigh", label: t("playground.reasoningXhigh") },
          ]}
          onChange={value => change("reasoningEffort", value)}
        />
        <label className="field-label" htmlFor={`${id}-stream`}>
          <input
            id={`${id}-stream`}
            type="checkbox"
            checked={settings.stream}
            disabled
            title={t("playground.streamingUnavailable")}
            aria-describedby={helpId}
            onChange={event => change("stream", event.target.checked)}
          />
          {t("playground.stream")}
        </label>
      </div>
    </section>
  );
}

export function PlaygroundCustomModel({ providers, onSave, onClose }: {
  providers: string[];
  onSave: (model: PlaygroundModel) => void;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [selectedProvider, setSelectedProvider] = useState(providers[0] ?? "");
  const [model, setModel] = useState("");
  const [invalid, setInvalid] = useState(false);
  const helpId = useId();
  const errorId = useId();
  const modelHelpId = useId();
  const provider = providers.includes(selectedProvider) ? selectedProvider : (providers[0] ?? "");
  const description = [helpId, invalid ? errorId : undefined].filter(Boolean).join(" ");
  const modelDescription = [modelHelpId, invalid ? errorId : undefined].filter(Boolean).join(" ");

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    labelRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="modal-overlay"
      aria-labelledby={`${id}-title`}
      aria-describedby={helpId}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
    >
      <button
        type="button"
        className="modal-backdrop-dismiss"
        aria-label={t("common.close")}
        tabIndex={-1}
        onClick={onClose}
      />
      <form
        className="modal-card playground-custom-model"
        noValidate
        onSubmit={event => {
          event.preventDefault();
          const nextLabel = label.trim();
          const nextModel = model.trim();
          if (!nextLabel || !nextModel || !provider || !providers.includes(provider)) {
            setInvalid(true);
            if (!nextLabel) labelRef.current?.focus();
            else if (!nextModel) modelRef.current?.focus();
            return;
          }
          setInvalid(false);
          onSave({ id: `${provider}/${nextModel}`, provider, model: nextModel, label: nextLabel, custom: true });
        }}
      >
        <div className="modal-head">
          <h3 id={`${id}-title`}>{t("playground.customModelTitle")}</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t("common.close")}</button>
        </div>
        <p id={helpId} className="muted text-label">{t("playground.customModelHelp")}</p>
        <a href="#providers" onClick={onClose}>{t("playground.apiConnections")}</a>
        {providers.length === 0 && <p className="muted text-label" role="status">{t("playground.noConfiguredProviders")}</p>}
        <div className="playground-custom-model-fields">
          <label className="field-label" htmlFor={`${id}-label`}>{t("playground.customModelLabel")}</label>
          <input
            ref={labelRef}
            id={`${id}-label`}
            className="input"
            required
            value={label}
            aria-invalid={invalid && !label.trim() ? true : undefined}
            aria-describedby={description}
            onChange={event => { setLabel(event.target.value); setInvalid(false); }}
          />
          <label className="field-label" htmlFor={`${id}-provider`}>{t("playground.customModelProvider")}</label>
          <Select
            id={`${id}-provider`}
            value={provider}
            options={providers.length ? providers.map(value => ({ value, label: value })) : [{ value: "", label: t("playground.unset") }]}
            disabled={providers.length === 0}
            describedBy={description}
            portal={false}
            onChange={value => { setSelectedProvider(value); setInvalid(false); }}
          />
          <label className="field-label" htmlFor={`${id}-model`}>{t("playground.customModelId")}</label>
          <input
            ref={modelRef}
            id={`${id}-model`}
            className="input mono"
            required
            value={model}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            aria-invalid={invalid && !model.trim() ? true : undefined}
            aria-describedby={modelDescription}
            onChange={event => { setModel(event.target.value); setInvalid(false); }}
          />
          <p id={modelHelpId} className="muted text-label">{t("playground.customModelIdHelp")}</p>
          {invalid && <p id={errorId} className="notice notice-err" role="alert">{t("playground.customModelRequired")}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-sm" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={providers.length === 0}>{t("common.save")}</button>
        </div>
      </form>
    </dialog>
  );
}
