"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, Button, ManualConfigModal, ComboFormModal, McpMarketplaceModal, ModelSelectModal, Tooltip } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import { rememberEndpoint } from "./cliEndpointPresets";
import ApiKeySelect from "./ApiKeySelect";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { getProvidersByKind } from "@/shared/constants/providers";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const ENDPOINT = "/api/cli-tools/cowork-settings";

const stripV1 = (url) => (url || "").replace(/\/v1\/?$/, "");
const ensureV1 = (url) => {
  const trimmed = (url || "").replace(/\/+$/, "");
  if (!trimmed) return "";
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

function SortableModelChip({
  id,
  model,
  isDefault,
  onRemove,
  onEdit,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 99 : undefined,
  };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);

  useEffect(() => {
    setDraft(model);
  }, [model]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) {
      onEdit(trimmed);
    } else {
      setDraft(model);
    }
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setDraft(model);
      setEditing(false);
    }
  };

  return (
    <span
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-black/5 dark:bg-white/5 text-text-muted border transition-colors select-none cursor-grab active:cursor-grabbing ${
        isDefault
          ? "border-primary/40 bg-primary/5 text-primary font-medium"
          : "border-transparent hover:border-border"
      } ${isDragging ? "shadow-md ring-1 ring-primary/50" : ""}`}
    >
      {isDefault && (
        <span className="text-[9px] font-bold text-primary bg-primary/10 px-1 py-0.2 rounded shrink-0">
          Default
        </span>
      )}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="min-w-[80px] max-w-[180px] px-1 py-0 bg-surface border border-primary/50 rounded text-xs text-text-main outline-none"
        />
      ) : (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="cursor-text hover:text-text-main"
          title="Click to edit name, hold & drag to set default"
        >
          {model}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className="ml-0.5 text-text-muted/60 hover:text-primary transition-colors"
        title="Edit model name"
      >
        <span className="material-symbols-outlined text-[12px]">edit</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(model);
        }}
        className="ml-0.5 text-text-muted/60 hover:text-red-500 transition-colors"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-[12px]">close</span>
      </button>
    </span>
  );
}

export default function CoworkToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  apiKeys,
  activeProviders,
  hasActiveProviders,
  cloudEnabled,
  cloudUrl,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
  initialStatus,
}) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [oneMContext, setOneMContext] = useState(false);
  const [webSearchProvider, setWebSearchProvider] = useState("");
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [plugins, setPlugins] = useState([]);
  const [localPlugins, setLocalPlugins] = useState([]);
  const [customPlugins, setCustomPlugins] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [comboModalOpen, setComboModalOpen] = useState(false);
  const [modelSelectOpen, setModelSelectOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [addMcpOpen, setAddMcpOpen] = useState(false);
  const [addMcpForm, setAddMcpForm] = useState({ name: "", url: "" });
  const [webCombos, setWebCombos] = useState([]);

  const searchProviders = useMemo(() => getProvidersByKind("webSearch"), []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setSelectedModels((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleEditModel = (index, newModel) => {
    if (!newModel.trim()) return;
    setSelectedModels((prev) => {
      const next = [...prev];
      next[index] = newModel.trim();
      return next;
    });
  };

  useEffect(() => {
    fetch("/api/combos")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.combos) {
          setWebCombos(data.combos.filter((c) => c.kind === "webSearch" || c.kind === "webFetch"));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !status) checkStatus();
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;
    fetch("/api/models/alias")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setModelAliases(data.aliases || {});
      })
      .catch(() => {});
  }, [isExpanded]);

  useEffect(() => {
    if (status?.cowork?.models?.length) {
      setSelectedModels(status.cowork.models);
      setOneMContext(status.cowork.models.some((m) => /\[1m\]$/i.test(m)));
    }
    if (status?.cowork?.baseUrl && !customBaseUrl) {
      setCustomBaseUrl(stripV1(status.cowork.baseUrl));
    }
    if (status?.cowork?.webSearchProvider !== undefined) {
      setWebSearchProvider(status.cowork.webSearchProvider || "");
    }
    // Initialize plugins: from current config, fallback to defaultPlugins
    if (Array.isArray(status?.cowork?.plugins) && status.cowork.plugins.length > 0) {
      setPlugins(status.cowork.plugins.filter((p) => p.name !== "9router-web" && p.name !== "web-search"));
    } else if (plugins.length === 0 && Array.isArray(status?.defaultPlugins)) {
      setPlugins(status.defaultPlugins);
    }
    if (Array.isArray(status?.cowork?.localPlugins)) {
      setLocalPlugins(status.cowork.localPlugins);
    }
    if (Array.isArray(status?.cowork?.customPlugins) && status.cowork.customPlugins.length > 0) {
      setCustomPlugins(
        status.cowork.customPlugins.filter(
          (p) => p.name !== "9router-web" && p.name !== "web-search" && p.name !== "exa"
        )
      );
    }
  }, [status]);

  const withContextMarker = (value, enabled) => {
    const { model } = stripModelContextMarker(value);
    return enabled ? `${model}[1m]` : model;
  };

  const handleOneMContextToggle = (enabled) => {
    setOneMContext(enabled);
    setSelectedModels((prev) => prev.map((m) => withContextMarker(m, enabled)));
  };

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const getEffectiveBaseUrl = () => ensureV1(customBaseUrl);

  const currentBaseUrl = status?.cowork?.baseUrl || "";

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    const url = status?.cowork?.baseUrl;
    if (!url) return "not_configured";
    return status.has9Router ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const handleApply = async () => {
    setMessage(null);
    const effectiveUrl = getEffectiveBaseUrl();

    if (selectedModels.length === 0) {
      setMessage({ type: "error", text: "Please select at least one model" });
      return;
    }

    setApplying(true);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_9router" : null);

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: effectiveUrl,
          apiKey: keyToUse,
          models: selectedModels,
          plugins: plugins.filter((p) => p.name !== "9router-web" && p.name !== "web-search" && p.name !== "exa"),
          localPlugins,
          customPlugins: customPlugins.filter((p) => p.name !== "9router-web" && p.name !== "web-search" && p.name !== "exa"),
          webSearchProvider,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Remember the endpoint so it stays selectable next time
        rememberEndpoint(getEffectiveBaseUrl(), { tunnelPublicUrl, tailscaleUrl });
        setMessage({ type: "success", text: "Settings applied. Quit & reopen Claude Desktop to load." });
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleCreateCombo = async ({ name, models }) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, models }),
      });
      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to create combo" });
        return;
      }
      const finalName = withContextMarker(name, oneMContext);
      if (!selectedModels.includes(finalName)) {
        setSelectedModels([...selectedModels, finalName]);
      }
      setComboModalOpen(false);
      setMessage({ type: "success", text: `Combo "${name}" created and added.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  const handleAddModel = (model) => {
    const value = model?.value || model?.name || model;
    if (!value) return;
    const bareValue = stripModelContextMarker(value).model;
    if (selectedModels.some((m) => stripModelContextMarker(m).model === bareValue)) return;
    setSelectedModels((prev) => [...prev, withContextMarker(bareValue, oneMContext)]);
  };

  const handleRemoveModel = (model) => {
    const value = model?.value || model?.name || model;
    const bareValue = stripModelContextMarker(value).model;
    setSelectedModels((prev) => prev.filter((item) => stripModelContextMarker(item).model !== bareValue));
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully" });
        setSelectedModels([]);
        setOneMContext(false);
        setWebSearchProvider("");
        setPlugins(status?.defaultPlugins || []);
        setLocalPlugins([]);
        setCustomPlugins([]);
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const addPlugin = (p) => {
    if (plugins.some((x) => x.name === p.name)) return;
    setPlugins([...plugins, p]);
  };

  const removePlugin = (name) => {
    setPlugins(plugins.filter((p) => p.name !== name));
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];
    const cfg = {
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: getEffectiveBaseUrl() || "https://your-public-host/v1",
      inferenceGatewayApiKey: keyToUse,
      inferenceModels: modelsToShow.map((name) => ({ name })),
    };

    return [{
      filename: "~/Library/Application Support/Claude-3p/configLibrary/<appliedId>.json",
      content: JSON.stringify(cfg, null, 2),
    }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not configured</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">Other</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Claude Cowork...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-yellow-500">warning</span>
                <div className="flex-1">
                  <p className="font-medium text-yellow-600 dark:text-yellow-400">Claude Desktop (Cowork mode) not detected</p>
                  <p className="text-sm text-text-muted">Open Claude Desktop → Help → Troubleshooting → Enable Developer mode → Configure third-party inference, then return here.</p>
                </div>
              </div>
              <div className="pl-9">
                <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                  <span className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                  Manual Config
                </Button>
              </div>
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                    value={getEffectiveBaseUrl()}
                    onChange={(url) => setCustomBaseUrl(stripV1(url))}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                    cloudEnabled={cloudEnabled}
                    cloudUrl={cloudUrl}
                    currentUrl={currentBaseUrl}
                  />
                </div>

                {status?.cowork?.baseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {status.cowork.baseUrl}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">Models</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
                      {selectedModels.length === 0 ? (
                        <span className="text-xs text-text-muted">No models selected</span>
                      ) : (
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                          <SortableContext items={selectedModels} strategy={rectSortingStrategy}>
                            {selectedModels.map((m, idx) => (
                              <SortableModelChip
                                key={m}
                                id={m}
                                index={idx}
                                model={m}
                                isDefault={idx === 0}
                                onRemove={handleRemoveModel}
                                onEdit={(newVal) => handleEditModel(idx, newVal)}
                              />
                            ))}
                          </SortableContext>
                        </DndContext>
                      )}
                    </div>
                    <button onClick={() => setModelSelectOpen(true)} disabled={!hasActiveProviders} className={`shrink-0 px-2 py-1.5 rounded border text-xs whitespace-nowrap transition-colors ${hasActiveProviders ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>+ Model</button>
                    <button onClick={() => setComboModalOpen(true)} disabled={!hasActiveProviders} className={`shrink-0 px-2 py-1.5 rounded border text-xs whitespace-nowrap transition-colors ${hasActiveProviders ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>+ Combo</button>
                  </div>
                </div>

                {/* 1M context */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">1M context</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={oneMContext} onChange={(e) => handleOneMContextToggle(e.target.checked)} className="w-3.5 h-3.5 accent-primary cursor-pointer" />
                    <span className="text-xs text-text-muted">Append [1m] to the model name</span>
                    <Tooltip text="Claude Desktop otherwise assumes a 200K window. Applied to every selected model — only enable it for models that really accept 1M.">
                      <span className="material-symbols-outlined text-text-muted text-[14px] cursor-help">info</span>
                    </Tooltip>
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-2">MCP</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px] mt-2">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-1">
                    {/* Preset plugins */}
                    {plugins.filter((p) => p.name !== "exa" && p.name !== "9router-web").map((p) => (
                      <div key={p.name} className="flex items-center gap-2 px-2 py-1 bg-surface rounded border border-border">
                        <span className="text-xs font-medium min-w-0 truncate flex-shrink-0">{p.title || p.name}</span>
                        {p.oauth && <span className="text-[8px] text-amber-600 shrink-0">OAuth</span>}
                        <div className="flex-1 flex flex-wrap gap-1 overflow-hidden" style={{ maxHeight: "1.5rem" }}>
                          {Array.isArray(p.toolNames) && p.toolNames.slice(0, 6).map((t) => (
                            <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-black/5 dark:bg-white/5 text-text-muted whitespace-nowrap">{t}</span>
                          ))}
                          {Array.isArray(p.toolNames) && p.toolNames.length > 6 && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-black/5 dark:bg-white/5 text-text-muted whitespace-nowrap">+{p.toolNames.length - 6}</span>
                          )}
                        </div>
                        <button onClick={() => removePlugin(p.name)} className="shrink-0 hover:text-red-500 ml-auto">
                          <span className="material-symbols-outlined text-[12px]">close</span>
                        </button>
                      </div>
                    ))}
                    {/* Custom plugins */}
                    {customPlugins.map((p) => (
                      <div key={p.name} className="flex items-center gap-2 px-2 py-1 bg-surface rounded border border-border">
                        <span className="text-xs font-medium min-w-0 truncate flex-shrink-0">{p.name}</span>
                        <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-500 shrink-0">custom</span>
                        <span className="flex-1 text-[9px] text-text-muted truncate">{p.url}</span>
                        <button onClick={() => setCustomPlugins(customPlugins.filter((x) => x.name !== p.name))} className="shrink-0 hover:text-red-500 ml-auto">
                          <span className="material-symbols-outlined text-[12px]">close</span>
                        </button>
                      </div>
                    ))}
                    {plugins.filter((p) => p.name !== "exa" && p.name !== "9router-web").length === 0 && customPlugins.length === 0 && (
                      <div className="px-2 py-1.5 bg-surface rounded border border-border text-xs text-text-muted">No MCPs added</div>
                    )}
                    {/* Actions row */}
                    <div className="flex items-center gap-2 mt-0.5">
                      <button onClick={() => setMarketplaceOpen(true)} className="px-2 py-1 rounded border text-xs bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 cursor-pointer whitespace-nowrap">
                        + Browse
                      </button>
                      <button onClick={() => { setAddMcpForm({ name: "", url: "" }); setAddMcpOpen(true); }} className="px-2 py-1 rounded border text-xs bg-surface border-border text-text-muted hover:border-primary hover:text-primary cursor-pointer whitespace-nowrap">
                        + Custom
                      </button>
                      <a href="https://mcp.so" target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-muted hover:text-primary underline ml-auto">Find MCPs →</a>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Tools</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-1.5">
                    {/* Web Search & Fetch */}
                    <div className="flex flex-col gap-1.5 p-2 bg-surface rounded border border-border">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium">Web Search & Fetch</div>
                          <p className="text-[10px] text-text-muted leading-snug">Replaces built-in WebSearch/WebFetch with 9Router or Exa MCP.</p>
                        </div>
                        <select
                          value={webSearchProvider}
                          onChange={(e) => setWebSearchProvider(e.target.value)}
                          className="px-2 py-1 bg-background rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                        >
                          <option value="">Disabled</option>
                          <option value="exa">Exa MCP (external)</option>
                          <optgroup label="9Router Web Search & Fetch">
                            {searchProviders.map((p) => (
                              <option key={p.id} value={p.alias || p.id}>{p.name} ({p.alias || p.id})</option>
                            ))}
                            {webCombos.map((c) => (
                              <option key={c.id} value={c.name}>Combo: {c.name}</option>
                            ))}
                          </optgroup>
                        </select>
                      </div>
                    </div>
                    {(() => {
                      const browserDef = (status?.localStdioPlugins || []).find((p) => p.name === "browsermcp");
                      if (!browserDef) return null;
                      const browserEnabled = localPlugins.includes("browsermcp");
                      return (
                        <label className="flex items-start gap-2 cursor-pointer px-2 py-1.5 bg-surface rounded border border-border">
                          <input
                            type="checkbox"
                            checked={browserEnabled}
                            onChange={(e) => setLocalPlugins(e.target.checked ? [...localPlugins, "browsermcp"] : localPlugins.filter((n) => n !== "browsermcp"))}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium">Browser Control (Browser MCP)</div>
                            <p className="text-[10px] text-text-muted leading-snug">
                              Controls your running Chrome. Auto-strips Cowork&apos;s built-in browser tools.{" "}
                              <a href={browserDef.extensionUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Install Chrome extension</a>
                            </p>
                          </div>
                        </label>
                      );
                    })()}
                  </div>
                </div>

                {Array.isArray(status?.localStdioPlugins) && status.localStdioPlugins.filter((p) => p.name !== "browsermcp").length > 0 && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                    <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Local Plugins</span>
                    <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">arrow_forward</span>
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="flex flex-col gap-1.5 px-2 py-1.5 bg-surface rounded border border-border">
                        {status.localStdioPlugins.filter((p) => p.name !== "browsermcp").map((p) => {
                          const enabled = localPlugins.includes(p.name);
                          return (
                            <label key={p.name} className="flex items-start gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => setLocalPlugins(e.target.checked ? [...localPlugins, p.name] : localPlugins.filter((n) => n !== p.name))}
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs font-medium">{p.title}</span>
                                  <span className="text-[8px] text-amber-600">stdio</span>
                                </div>
                                <p className="text-[10px] text-text-muted leading-snug">{p.description}</p>
                                {p.extensionUrl && (
                                  <a href={p.extensionUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary underline">Install Chrome extension</a>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-text-muted leading-snug">
                        ⚠️ Local plugins run as subprocess via <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/5">npx</code>. Requires Node.js installed.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={selectedModels.length === 0} loading={applying} className="w-full sm:w-auto">
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={!status.has9Router} loading={restoring} className="w-full sm:w-auto">
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)} className="w-full sm:w-auto">
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Claude Cowork - Manual Configuration"
        configs={getManualConfigs()}
      />

      {comboModalOpen && (
        <ComboFormModal
          isOpen={comboModalOpen}
          combo={null}
          onClose={() => setComboModalOpen(false)}
          onSave={handleCreateCombo}
          activeProviders={activeProviders}
          forcePrefix="claude-"
          title="Create Cowork Combo"
        />
      )}

      {modelSelectOpen && (
        <ModelSelectModal
          isOpen={modelSelectOpen}
          onClose={() => setModelSelectOpen(false)}
          onSelect={handleAddModel}
          onDeselect={handleRemoveModel}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Select Cowork Model"
          addedModelValues={selectedModels.map((m) => stripModelContextMarker(m).model)}
          closeOnSelect={false}
        />
      )}

      <McpMarketplaceModal
        isOpen={marketplaceOpen}
        onClose={() => setMarketplaceOpen(false)}
        onAdd={addPlugin}
        addedNames={plugins.map((p) => p.name)}
      />

      {/* Add Custom MCP modal */}
      {addMcpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAddMcpOpen(false)}>
          <div className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Add Custom MCP</h3>
              <button onClick={() => setAddMcpOpen(false)} className="text-text-muted hover:text-text-main">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted font-medium">Name</label>
                <input
                  type="text"
                  placeholder="my-mcp"
                  value={addMcpForm.name}
                  onChange={(e) => setAddMcpForm((f) => ({ ...f, name: e.target.value.replace(/\s+/g, "-").toLowerCase() }))}
                  className="px-2 py-1.5 rounded border border-border bg-surface text-xs outline-none focus:border-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted font-medium">SSE URL</label>
                <input
                  type="text"
                  placeholder="https://your-mcp-server.com/sse"
                  value={addMcpForm.url}
                  onChange={(e) => setAddMcpForm((f) => ({ ...f, url: e.target.value }))}
                  className="px-2 py-1.5 rounded border border-border bg-surface text-xs outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setAddMcpOpen(false)} className="px-3 py-1.5 rounded border border-border text-xs text-text-muted hover:bg-surface cursor-pointer">Cancel</button>
              <button
                onClick={() => {
                  const name = addMcpForm.name.trim();
                  if (!name || !addMcpForm.url.trim()) return;
                  setCustomPlugins((prev) => [...prev.filter((x) => x.name !== name), { name, url: addMcpForm.url.trim(), transport: "sse", custom: true }]);
                  setAddMcpOpen(false);
                }}
                className="px-3 py-1.5 rounded bg-primary text-white text-xs font-medium hover:opacity-90 cursor-pointer"
              >Add</button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
