import { useCallback, useEffect, useId, useRef, useState } from "react";
import "./bill-as-dialog.css";
import { createBoundedFetch, type BoundedFetch } from "../bounded-fetch";
import { readJsonOrThrow } from "../fetch-json";
import { useI18n } from "../i18n/shared";

const REQUEST_TIMEOUT_MS = 60_000;
type Phase = "loading" | "ready" | "empty" | "loadFailed" | "saving" | "unknown";

interface CandidatePrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface Candidate {
  provider: string;
  model: string;
  price: CandidatePrice;
}

interface BillAsDialogProps {
  apiBase: string;
  provider: string;
  model: string;
  providerLabel: string;
  dropdown?: boolean;
  onSaved: () => void;
  onClose: () => void;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function finiteRate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseCandidate(value: unknown): Candidate | null {
  const row = record(value);
  const price = record(row?.price);
  if (!row || !price || typeof row.provider !== "string" || typeof row.model !== "string") return null;
  const input = finiteRate(price.input);
  const output = finiteRate(price.output);
  if (input === undefined || output === undefined) return null;
  return {
    provider: row.provider,
    model: row.model,
    price: {
      input,
      output,
      cacheRead: finiteRate(price.cacheRead) ?? 0,
      cacheWrite: finiteRate(price.cacheWrite) ?? 0,
    },
  };
}

export default function BillAsDialog({
  apiBase, provider, model, providerLabel, dropdown = false, onSaved, onClose,
}: BillAsDialogProps) {
  const { locale, t } = useI18n();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestRef = useRef<BoundedFetch | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState(-1);
  const [errorKey, setErrorKey] = useState<"usage.billAs.loadFailed" | "usage.billAs.saveFailed" | "usage.billAs.providerMissing" | null>(null);
  const saving = phase === "saving";

  const rateFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });

  const load = useCallback(() => {
    if (requestRef.current) return;
    const bounded = createBoundedFetch(REQUEST_TIMEOUT_MS);
    requestRef.current = bounded;
    const query = new URLSearchParams({ model, provider, limit: "10" });
    void fetch(`${apiBase}/api/usage/model-price-candidates?${query}`, {
      signal: bounded.signal, cache: "no-store",
    }).then(async response => {
      const result = await readJsonOrThrow<unknown>(response);
      bounded.signal.throwIfAborted();
      const rows = record(result)?.candidates;
      if (!Array.isArray(rows)) throw new Error("invalid candidates response");
      const parsed = rows.map(parseCandidate).filter((row): row is Candidate => row !== null);
      if (requestRef.current !== bounded) return;
      setCandidates(parsed);
      setSelected(parsed.length ? 0 : -1);
      setPhase(parsed.length ? "ready" : "empty");
      setErrorKey(null);
    }).catch(() => {
      if (requestRef.current !== bounded) return;
      setPhase("loadFailed");
      setErrorKey("usage.billAs.loadFailed");
    }).finally(() => {
      bounded.clear();
      if (requestRef.current === bounded) requestRef.current = null;
    });
  }, [apiBase, model, provider]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    load();
    return () => {
      requestRef.current?.controller.abort();
      requestRef.current?.clear();
      requestRef.current = null;
      if (dialog?.open) dialog.close();
    };
  }, [load]);

  const save = async (cost: CandidatePrice | null, candidate: Candidate | null) => {
    if (requestRef.current) return;
    const bounded = createBoundedFetch(REQUEST_TIMEOUT_MS);
    requestRef.current = bounded;
    setPhase("saving");
    setErrorKey(null);
    try {
      const response = await fetch(`${apiBase}/api/providers/${encodeURIComponent(provider)}/model-costs`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId: model, cost }),
        signal: bounded.signal,
      });
      if (response.status === 404) {
        if (requestRef.current !== bounded) return;
        setPhase("ready");
        setErrorKey("usage.billAs.providerMissing");
        return;
      }
      const result = await readJsonOrThrow<unknown>(response);
      bounded.signal.throwIfAborted();
      const receipt = record(result);
      if (receipt?.ok !== true || receipt.provider !== provider || receipt.modelId !== model) {
        throw new Error("invalid model-costs receipt");
      }
      if (cost === null) {
        if (receipt.cost !== null) throw new Error("invalid model-costs receipt");
      } else if (!candidate || !record(receipt.cost)) {
        throw new Error("invalid model-costs receipt");
      }
      if (requestRef.current !== bounded) return;
      onSaved();
      onClose();
    } catch {
      if (requestRef.current !== bounded) return;
      setPhase("ready");
      setErrorKey("usage.billAs.saveFailed");
    } finally {
      bounded.clear();
      if (requestRef.current === bounded) requestRef.current = null;
    }
  };

  const requestClose = () => {
    if (!saving) onClose();
  };

  return (
    <dialog ref={dialogRef} className="modal-overlay" aria-labelledby={`${id}-title`}
      onCancel={event => { event.preventDefault(); requestClose(); }}>
      <button type="button" className="modal-backdrop-dismiss" tabIndex={-1}
        aria-label={t("usage.billAs.close")} disabled={saving} onClick={requestClose} />
      <form className="modal-card model-display-name-dialog bill-as-dialog" role="document"
        aria-busy={phase === "loading" || saving}
        onClick={event => event.stopPropagation()}
        onSubmit={event => {
          event.preventDefault();
          if (saving) return;
          const candidate = candidates[selected] ?? null;
          if (candidate) void save(candidate.price, candidate);
        }}>
        <div className="modal-head">
          <h3 id={`${id}-title`}>{t("usage.billAs.title", { model })}</h3>
          <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={requestClose}>
            {t("usage.billAs.close")}
          </button>
        </div>
        <div className="bill-as-body">
          <p className="muted small">{t("usage.billAs.help")}</p>
          <div className="model-display-name-identity">
            <span className="muted text-label">{t("logs.col.provider")}</span>
            <code className="mono text-control">{providerLabel}</code>
          </div>
          {phase === "loading" && <p role="status" className="muted small">{t("usage.billAs.loading")}</p>}
          {phase === "empty" && <p role="status" className="muted small">{t("usage.billAs.empty")}</p>}
          {(phase === "ready" || phase === "saving") && candidates.length > 0 && dropdown && (
            <label>
              {t("usage.billAs.candidates")}
              <select value={selected} disabled={saving} onChange={event => { setSelected(Number(event.target.value)); setErrorKey(null); }}>
                {candidates.map((candidate, index) => (
                  <option key={`${candidate.provider}/${candidate.model}`} value={index}>
                    {candidate.provider}/{candidate.model} — {t("usage.billAs.rates", {
                      input: rateFormat.format(candidate.price.input), output: rateFormat.format(candidate.price.output),
                      cacheRead: rateFormat.format(candidate.price.cacheRead), cacheWrite: rateFormat.format(candidate.price.cacheWrite),
                    })}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(phase === "ready" || phase === "saving") && candidates.length > 0 && !dropdown && (
            <fieldset className="bill-as-candidates" disabled={saving}>
              <legend className="sr-only">{t("usage.billAs.candidates")}</legend>
              {candidates.map((candidate, index) => (
                <label className="bill-as-candidate" key={`${candidate.provider}/${candidate.model}`}>
                  <input type="radio" name={`${id}-candidate`} value={index}
                    checked={selected === index}
                    onChange={() => { setSelected(index); setErrorKey(null); }} />
                  <span className="bill-as-candidate-identity">
                    <span className="mono">{candidate.provider}/{candidate.model}</span>
                    <span className="muted text-caption">
                      {t("usage.billAs.rates", {
                        input: rateFormat.format(candidate.price.input),
                        output: rateFormat.format(candidate.price.output),
                        cacheRead: rateFormat.format(candidate.price.cacheRead),
                        cacheWrite: rateFormat.format(candidate.price.cacheWrite),
                      })}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {errorKey && <p role="alert" className="notice notice-err">
            {t(errorKey, { provider: providerLabel })}
          </p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={saving}
            onClick={() => { if (!saving) void save(null, null); }}>
            {t("usage.billAs.reset")}
          </button>
          <button type="submit" className="btn btn-primary btn-sm"
            disabled={saving || phase !== "ready" || selected < 0}>
            {t("usage.billAs.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
