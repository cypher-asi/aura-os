import { useState, useCallback, useEffect, useMemo } from "react";
import type { ProcessNode } from "../../../../types";
import { processApi } from "../../../../api/process";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { useAgentStore } from "../../../agents/stores";

export interface UseNodeEditorModalArgs {
  isOpen: boolean;
  node: ProcessNode;
  processId: string | undefined;
  onClose: () => void;
}

export function useNodeEditorModal({ isOpen, node, processId, onClose }: UseNodeEditorModalArgs) {
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const closeNodeInspector = useProcessSidekickStore((s) => s.closeNodeInspector);
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  const [label, setLabel] = useState(node.label);
  const [prompt, setPrompt] = useState(node.prompt);
  const [agentId, setAgentId] = useState(node.agent_id ?? "");
  const cfg = node.config as Record<string, unknown>;
  const [schedule, setSchedule] = useState(
    node.node_type === "ignition" ? (cfg?.schedule as string) ?? "" : "",
  );
  const [conditionExpr, setConditionExpr] = useState(
    node.node_type === "condition" ? (cfg?.condition_expression as string) ?? "" : "",
  );
  const [artifactMode, setArtifactMode] = useState(
    node.node_type === "artifact" ? (cfg?.artifact_mode as string) ?? "prompt" : "prompt",
  );
  const [artifactType, setArtifactType] = useState(
    node.node_type === "artifact" ? (cfg?.artifact_type as string) ?? "report" : "report",
  );
  const [artifactName, setArtifactName] = useState(
    node.node_type === "artifact" ? (cfg?.artifact_name as string) ?? "" : "",
  );
  const [artifactData, setArtifactData] = useState(
    node.node_type === "artifact" ? JSON.stringify(cfg?.data ?? {}, null, 2) : "{}",
  );
  const [delaySeconds, setDelaySeconds] = useState(
    node.node_type === "delay" ? String(cfg?.delay_seconds ?? "60") : "60",
  );
  const [childProcessId, setChildProcessId] = useState(
    (node.node_type === "sub_process" || node.node_type === "for_each")
      ? (cfg?.child_process_id as string) ?? ""
      : "",
  );
  const [maxConcurrency, setMaxConcurrency] = useState(
    node.node_type === "for_each" ? String(cfg?.max_concurrency ?? "3") : "3",
  );
  const [maxItems, setMaxItems] = useState(
    node.node_type === "for_each" ? String(cfg?.max_items ?? "") : "",
  );
  const [iteratorMode, setIteratorMode] = useState(
    node.node_type === "for_each" ? (cfg?.iterator_mode as string) ?? "json_array" : "json_array",
  );
  const [itemVariableName, setItemVariableName] = useState(
    node.node_type === "for_each" ? (cfg?.item_variable_name as string) ?? "item" : "item",
  );
  const [jsonArrayKey, setJsonArrayKey] = useState(
    node.node_type === "for_each" ? (cfg?.json_array_key as string) ?? "entries" : "entries",
  );
  const [collectMode, setCollectMode] = useState(
    node.node_type === "for_each" ? (cfg?.collect_mode as string) ?? "json_array" : "json_array",
  );
  const [outputFile, setOutputFile] = useState(
    (node.node_type === "action" || node.node_type === "artifact" || node.node_type === "prompt")
      ? (cfg?.output_file as string) ?? ""
      : "",
  );
  const [watchlist, setWatchlist] = useState(
    node.node_type === "ignition" ? JSON.stringify(cfg?.watchlist ?? {}, null, 2) : "{}",
  );
  const [model, setModel] = useState((cfg?.model as string) ?? "");
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    String(cfg?.timeout_seconds ?? "600"),
  );
  const [maxTurns, setMaxTurns] = useState(
    String(cfg?.max_turns ?? ""),
  );
  const [isPinned, setIsPinned] = useState(!!cfg?.pinned_output);
  const [pinnedOutput, setPinnedOutput] = useState((cfg?.pinned_output as string) ?? "");
  const [pinLoading, setPinLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [processes, setProcesses] = useState<Array<{ process_id: string; name: string }>>([]);
  useEffect(() => {
    if (node.node_type === "sub_process" || node.node_type === "for_each") {
      processApi.listProcesses().then(setProcesses).catch((e) => {
        console.error("Failed to list processes for node editor:", e);
      });
    }
  }, [node.node_type]);

  const processOptions = useMemo(
    () => [
      { value: "", label: "Select a process..." },
      ...processes
        .filter((p) => p.process_id !== processId)
        .map((p) => ({ value: p.process_id, label: p.name })),
    ],
    [processes, processId],
  );

  const agentOptions = useMemo(
    () => [
      { value: "", label: "No agent assigned" },
      ...agents.map((a) => ({ value: a.agent_id, label: a.name })),
    ],
    [agents],
  );

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  useEffect(() => {
    if (isOpen) {
      setLabel(node.label);
      setPrompt(node.prompt);
      setAgentId(node.agent_id ?? "");
      setSaving(false);
      const c = node.config as Record<string, unknown>;
      if (node.node_type === "ignition") setSchedule((c?.schedule as string) ?? "");
      if (node.node_type === "condition") setConditionExpr((c?.condition_expression as string) ?? "");
      if (node.node_type === "artifact") {
        setArtifactMode((c?.artifact_mode as string) ?? "prompt");
        setArtifactType((c?.artifact_type as string) ?? "report");
        setArtifactName((c?.artifact_name as string) ?? "");
        setArtifactData(JSON.stringify(c?.data ?? {}, null, 2));
      }
      if (node.node_type === "delay") setDelaySeconds(String(c?.delay_seconds ?? "60"));
      if (node.node_type === "sub_process" || node.node_type === "for_each") {
        setChildProcessId((c?.child_process_id as string) ?? "");
      }
      if (node.node_type === "for_each") {
        setMaxConcurrency(String(c?.max_concurrency ?? "3"));
        setMaxItems(c?.max_items == null ? "" : String(c?.max_items));
        setIteratorMode((c?.iterator_mode as string) ?? "json_array");
        setItemVariableName((c?.item_variable_name as string) ?? "item");
        setJsonArrayKey((c?.json_array_key as string) ?? "entries");
        setCollectMode((c?.collect_mode as string) ?? "json_array");
      }
      if (node.node_type === "action" || node.node_type === "artifact" || node.node_type === "prompt") setOutputFile((c?.output_file as string) ?? "");
      if (node.node_type === "ignition") setWatchlist(JSON.stringify(c?.watchlist ?? {}, null, 2));
      setModel((c?.model as string) ?? "");
      setTimeoutSeconds(String(c?.timeout_seconds ?? "600"));
      setMaxTurns(String(c?.max_turns ?? ""));
      setIsPinned(!!c?.pinned_output);
      setPinnedOutput((c?.pinned_output as string) ?? "");
    }
  }, [isOpen, node]);

  const handlePinToggle = useCallback(async () => {
    if (isPinned) {
      setIsPinned(false);
      setPinnedOutput("");
      return;
    }
    if (pinnedOutput) {
      setIsPinned(true);
      return;
    }
    if (!processId) return;
    setPinLoading(true);
    try {
      const runs = await processApi.listRuns(processId);
      const latestRun = runs[0];
      if (!latestRun) return;
      const events = await processApi.listRunEvents(processId, latestRun.run_id);
      const nodeEvent = events.find(
        (e) => e.node_id === node.node_id && e.status === "completed" && e.output,
      );
      if (nodeEvent?.output) {
        setPinnedOutput(nodeEvent.output);
        setIsPinned(true);
      }
    } finally {
      setPinLoading(false);
    }
  }, [isPinned, pinnedOutput, processId, node.node_id]);

  const handleSave = useCallback(async () => {
    if (!processId) return;
    setSaving(true);
    try {
      const config: Record<string, unknown> = { ...(node.config as Record<string, unknown>) };
      if (node.node_type === "ignition" && schedule) config.schedule = schedule;
      if (node.node_type === "condition") config.condition_expression = conditionExpr;
      if (node.node_type === "artifact") {
        config.artifact_mode = artifactMode;
        config.artifact_type = artifactType;
        config.artifact_name = artifactName;
        if (artifactMode === "json_schema" && artifactData) {
          try { config.data = JSON.parse(artifactData); } catch { /* keep existing */ }
        } else {
          delete config.data;
        }
      }
      if (node.node_type === "delay") config.delay_seconds = Number(delaySeconds) || 60;
      if (node.node_type === "sub_process" || node.node_type === "for_each") {
        if (childProcessId) config.child_process_id = childProcessId;
      }
      if (node.node_type === "for_each") {
        config.max_concurrency = Number(maxConcurrency) || 3;
        if (maxItems.trim() && Number(maxItems) > 0) config.max_items = Number(maxItems);
        else delete config.max_items;
        config.iterator_mode = iteratorMode;
        if (itemVariableName) config.item_variable_name = itemVariableName;
        if (jsonArrayKey.trim()) config.json_array_key = jsonArrayKey.trim();
        else delete config.json_array_key;
        config.collect_mode = collectMode;
      }
      if ((node.node_type === "action" || node.node_type === "artifact" || node.node_type === "prompt") && outputFile) {
        config.output_file = outputFile;
      } else {
        delete config.output_file;
      }
      if (model) config.model = model;
      else delete config.model;
      if (Number(timeoutSeconds) && Number(timeoutSeconds) !== 600) config.timeout_seconds = Number(timeoutSeconds);
      else delete config.timeout_seconds;
      if (maxTurns && Number(maxTurns)) config.max_turns = Number(maxTurns);
      else delete config.max_turns;
      if (isPinned && pinnedOutput) {
        config.pinned_output = pinnedOutput;
      } else {
        delete config.pinned_output;
      }
      if (node.node_type === "ignition" && watchlist) {
        try { config.watchlist = JSON.parse(watchlist); } catch { /* keep existing */ }
      }

      await processApi.updateNode(processId, node.node_id, {
        label,
        prompt,
        agent_id: agentId || undefined,
        config,
      });
      if (node.node_type === "ignition" && schedule) {
        await processApi.updateProcess(processId, { schedule });
      }
      fetchNodes(processId);
      onClose();
    } catch (e) {
      console.error("Failed to save node:", e);
    } finally {
      setSaving(false);
    }
  }, [processId, node, label, prompt, agentId, schedule, conditionExpr, artifactMode, artifactType, artifactName, artifactData, delaySeconds, childProcessId, maxConcurrency, maxItems, iteratorMode, itemVariableName, jsonArrayKey, collectMode, outputFile, watchlist, model, timeoutSeconds, maxTurns, isPinned, pinnedOutput, fetchNodes, onClose]);

  const handleDelete = useCallback(async () => {
    if (!processId || node.node_type === "ignition") return;
    try {
      await processApi.deleteNode(processId, node.node_id);
      fetchNodes(processId);
      closeNodeInspector();
      onClose();
    } catch (e) {
      console.error("Failed to delete node:", e);
    }
  }, [processId, node, fetchNodes, closeNodeInspector, onClose]);

  const hasPrompt = node.node_type !== "merge" && node.node_type !== "delay" && node.node_type !== "group";
  const isRuntimeBackedNode = ["action", "condition", "artifact", "prompt"].includes(node.node_type);
  const isLlmNode = isRuntimeBackedNode;

  return {
    label, setLabel,
    prompt, setPrompt,
    agentId, setAgentId,
    schedule, setSchedule,
    conditionExpr, setConditionExpr,
    artifactMode, setArtifactMode,
    artifactType, setArtifactType,
    artifactName, setArtifactName,
    artifactData, setArtifactData,
    delaySeconds, setDelaySeconds,
    childProcessId, setChildProcessId,
    maxConcurrency, setMaxConcurrency,
    maxItems, setMaxItems,
    iteratorMode, setIteratorMode,
    itemVariableName, setItemVariableName,
    jsonArrayKey, setJsonArrayKey,
    collectMode, setCollectMode,
    outputFile, setOutputFile,
    watchlist, setWatchlist,
    model, setModel,
    timeoutSeconds, setTimeoutSeconds,
    maxTurns, setMaxTurns,
    isPinned,
    pinnedOutput,
    pinLoading,
    saving,
    showAdvanced, setShowAdvanced,
    showDeleteConfirm, setShowDeleteConfirm,
    processOptions,
    agentOptions,
    handlePinToggle,
    handleSave,
    handleDelete,
    hasPrompt,
    isRuntimeBackedNode,
    isLlmNode,
  };
}
