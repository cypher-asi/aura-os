function parseJsonBody(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function cloneEntries(entries) {
  return Array.isArray(entries) ? entries.map((entry) => structuredClone(entry)) : [];
}

function createResponse(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function createTextResponse(route, body, status = 200, contentType = "text/plain; charset=utf-8") {
  return route.fulfill({
    status,
    contentType,
    body: String(body ?? ""),
  });
}

function createFeedbackItem({
  id,
  title,
  body,
  category,
  status,
  product,
  createdAt,
  commentCount = 0,
  upvotes = 0,
  downvotes = 0,
  viewerVote = "none",
  authorName = "Test User",
}) {
  return {
    id,
    profileId: "profile-1",
    eventType: "feedback",
    postType: "feedback",
    title,
    summary: body,
    metadata: null,
    category,
    status,
    product,
    createdAt,
    commentCount,
    upvotes,
    downvotes,
    voteScore: upvotes - downvotes,
    viewerVote,
    authorName,
    authorAvatar: null,
  };
}

function buildFeedbackState(profile) {
  const feedbackItems = cloneEntries(profile.seed.feedbackItems);
  const feedbackComments = new Map(
    Object.entries(profile.seed.feedbackComments ?? {}).map(([itemId, comments]) => [itemId, cloneEntries(comments)]),
  );
  let commentCounter = 10;
  let feedbackCounter = 10;

  return {
    feedbackItems,
    feedbackComments,
    nextCommentId() {
      commentCounter += 1;
      return `fb-comment-${commentCounter}`;
    },
    nextFeedbackId() {
      feedbackCounter += 1;
      return `fb-${feedbackCounter}`;
    },
  };
}

function createNoteRecord(notesRoot, relPath, title, content, updatedAt = new Date().toISOString()) {
  const name = relPath.split("/").pop() || `${title}.md`;
  const trimmedTitle = String(title || "").trim() || name.replace(/\.md$/, "");
  const normalizedContent = String(content || "").trim();
  return {
    relPath,
    treeNode: {
      kind: "note",
      name,
      relPath,
      title: trimmedTitle,
      absPath: `${notesRoot}/${relPath}`,
      updatedAt,
    },
    document: {
      content: normalizedContent,
      title: trimmedTitle,
      frontmatter: {
        created_at: updatedAt,
        created_by: "Test User",
        updated_at: updatedAt,
      },
      absPath: `${notesRoot}/${relPath}`,
      updatedAt,
      wordCount: normalizedContent.split(/\s+/).filter(Boolean).length,
    },
  };
}

function walkNotes(nodes, visit) {
  for (const node of nodes) {
    visit(node);
    if (node.kind === "folder") {
      walkNotes(node.children ?? [], visit);
    }
  }
}

function findFolder(nodes, relPath) {
  if (!relPath) {
    return { children: nodes };
  }

  let found = null;
  walkNotes(nodes, (node) => {
    if (found || node.kind !== "folder") return;
    if (node.relPath === relPath) {
      found = node;
    }
  });
  return found;
}

function buildNotesState(profile) {
  const notesTree = cloneEntries(profile.seed.notesTree ?? []);
  const notesRoot = String(profile.seed.notesRoot || "/Users/demo/workspaces/Demo Project");
  const notesDocuments = new Map(
    Object.entries(profile.seed.notesDocuments ?? {}).map(([relPath, document]) => [relPath, structuredClone(document)]),
  );
  const notesComments = new Map(
    Object.entries(profile.seed.notesComments ?? {}).map(([relPath, comments]) => [relPath, cloneEntries(comments)]),
  );
  let noteCounter = 20;
  let commentCounter = 20;

  return {
    notesTree,
    notesRoot,
    notesDocuments,
    notesComments,
    treeResponse() {
      return { nodes: structuredClone(this.notesTree), root: this.notesRoot };
    },
    read(relPath) {
      return structuredClone(this.notesDocuments.get(relPath) ?? null);
    },
    comments(relPath) {
      return structuredClone(this.notesComments.get(relPath) ?? []);
    },
    create(parentPath, requestedName = "", kind = "note") {
      noteCounter += 1;
      const baseName = String(requestedName || "").trim() || (kind === "folder" ? `Folder ${noteCounter}` : `Note ${noteCounter}`);
      const name = kind === "folder" || baseName.endsWith(".md") ? baseName : `${baseName}.md`;
      const relPath = parentPath ? `${parentPath}/${name}` : name;
      const parentFolder = findFolder(this.notesTree, parentPath);
      if (!parentFolder) {
        throw new Error(`Could not find notes folder ${parentPath}`);
      }

      if (kind === "folder") {
        parentFolder.children.push({
          kind: "folder",
          name,
          relPath,
          children: [],
        });
        return {
          relPath,
          title: name,
          absPath: `${this.notesRoot}/${relPath}`,
        };
      }

      const title = name.replace(/\.md$/, "");
      const note = createNoteRecord(
        this.notesRoot,
        relPath,
        title,
        `# ${title}\n\nThis note was created inside the seeded demo workspace.`,
      );
      parentFolder.children.push(note.treeNode);
      this.notesDocuments.set(relPath, note.document);
      return {
        relPath,
        title,
        absPath: note.document.absPath,
      };
    },
    write(relPath, content) {
      const existing = this.notesDocuments.get(relPath);
      const updatedAt = new Date().toISOString();
      const title = String(content || "").split(/\r?\n/).find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "").trim()
        || existing?.title
        || relPath.split("/").pop()?.replace(/\.md$/, "")
        || "Untitled";
      const note = createNoteRecord(this.notesRoot, relPath, title, String(content || ""), updatedAt);
      this.notesDocuments.set(relPath, note.document);
      walkNotes(this.notesTree, (node) => {
        if (node.kind === "note" && node.relPath === relPath) {
          node.title = title;
          node.updatedAt = updatedAt;
        }
      });
      return {
        ok: true,
        title,
        relPath,
        absPath: note.document.absPath,
        updatedAt,
        wordCount: note.document.wordCount,
      };
    },
    addComment(relPath, body, authorName = "Test User") {
      commentCounter += 1;
      const created = {
        id: `note-comment-${commentCounter}`,
        authorId: "user-1",
        authorName,
        body: String(body || "").trim(),
        createdAt: new Date().toISOString(),
      };
      this.notesComments.set(relPath, [...(this.notesComments.get(relPath) ?? []), created]);
      return created;
    },
  };
}

function buildAgentState(profile) {
  const agents = cloneEntries(profile.seed.agents ?? []);
  const events = new Map(
    Object.entries(profile.seed.agentEvents ?? {}).map(([agentId, entries]) => [agentId, cloneEntries(entries)]),
  );
  const projectBindings = new Map(
    Object.entries(profile.seed.agentProjectBindings ?? {}).map(([agentId, bindings]) => [agentId, cloneEntries(bindings)]),
  );
  let agentCounter = 20;
  let eventCounter = 20;

  return {
    agents,
    events,
    projectBindings,
    nextAgentId() {
      agentCounter += 1;
      return `agent-demo-${agentCounter}`;
    },
    nextEventId() {
      eventCounter += 1;
      return `agent-event-${eventCounter}`;
    },
    list(orgId) {
      if (!orgId) {
        return structuredClone(this.agents);
      }
      return structuredClone(this.agents.filter((agent) => !agent.org_id || agent.org_id === orgId));
    },
    get(agentId) {
      return structuredClone(this.agents.find((agent) => agent.agent_id === agentId) ?? null);
    },
    upsert(agent) {
      const index = this.agents.findIndex((entry) => entry.agent_id === agent.agent_id);
      if (index >= 0) {
        this.agents[index] = agent;
      } else {
        this.agents.push(agent);
      }
      return structuredClone(agent);
    },
    create(body, session) {
      const now = new Date().toISOString();
      const created = {
        agent_id: this.nextAgentId(),
        user_id: session.user_id,
        org_id: body.org_id || "org-1",
        name: String(body.name || "New Agent").trim() || "New Agent",
        role: String(body.role || "Generalist").trim(),
        personality: String(body.personality || "").trim(),
        system_prompt: String(body.system_prompt || "").trim(),
        skills: Array.isArray(body.skills) ? body.skills.map((entry) => String(entry || "").trim()).filter(Boolean) : [],
        icon: body.icon ? String(body.icon) : null,
        machine_type: String(body.machine_type || (body.environment === "swarm_microvm" ? "remote" : "local")),
        adapter_type: String(body.adapter_type || "aura_harness"),
        environment: String(body.environment || "local_host"),
        auth_source: String(body.auth_source || "aura_managed"),
        integration_id: body.integration_id ?? null,
        default_model: body.default_model ?? null,
        profile_id: session.profile_id,
        tags: Array.isArray(body.tags) ? body.tags.map((entry) => String(entry || "").trim()).filter(Boolean) : [],
        is_pinned: Boolean(body.is_pinned),
        listing_status: typeof body.listing_status === "string" ? body.listing_status : "closed",
        permissions: body.permissions ?? { scope: { orgs: [], projects: [], agent_ids: [] }, capabilities: [] },
        intent_classifier: body.intent_classifier ?? null,
        created_at: now,
        updated_at: now,
      };
      this.agents.push(created);
      this.events.set(created.agent_id, [
        {
          event_id: this.nextEventId(),
          agent_instance_id: `standalone-${created.agent_id}`,
          project_id: "proj-1",
          role: "assistant",
          content: `${created.name} is ready. Start a conversation or attach it to a project.`,
          created_at: now,
        },
      ]);
      this.projectBindings.set(created.agent_id, []);
      return structuredClone(created);
    },
    update(agentId, body) {
      const index = this.agents.findIndex((agent) => agent.agent_id === agentId);
      if (index === -1) {
        return null;
      }
      const current = this.agents[index];
      const updated = {
        ...current,
        ...body,
        icon: body.icon === "" ? null : body.icon ?? current.icon,
        updated_at: new Date().toISOString(),
      };
      this.agents[index] = updated;
      return structuredClone(updated);
    },
    delete(agentId) {
      const index = this.agents.findIndex((agent) => agent.agent_id === agentId);
      if (index === -1) {
        return false;
      }
      this.agents.splice(index, 1);
      this.events.delete(agentId);
      this.projectBindings.delete(agentId);
      return true;
    },
    ensureCeo(session) {
      const existing = this.agents.find((agent) => Array.isArray(agent.tags) && agent.tags.includes("super_agent"));
      if (existing) {
        return {
          agent: structuredClone(existing),
          created: false,
        };
      }
      const created = {
        agent_id: this.nextAgentId(),
        user_id: session.user_id,
        org_id: "org-1",
        name: "Aura CEO",
        role: "CEO SuperAgent",
        personality: "Decisive, calm, and deeply aware of the product surface.",
        system_prompt: "Coordinate Aura workflows and keep teams moving.",
        skills: [],
        icon: null,
        machine_type: "local",
        adapter_type: "aura_harness",
        environment: "local_host",
        auth_source: "aura_managed",
        integration_id: null,
        default_model: null,
        profile_id: session.profile_id,
        tags: ["super_agent"],
        is_pinned: true,
        listing_status: "closed",
        permissions: {
          scope: { orgs: ["org-1"], projects: ["proj-1"], agent_ids: [] },
          capabilities: [
            { type: "spawnAgent" },
            { type: "controlAgent" },
            { type: "readAgent" },
            { type: "manageOrgMembers" },
            { type: "manageBilling" },
            { type: "invokeProcess" },
            { type: "postToFeed" },
            { type: "generateMedia" },
            { type: "readProject", id: "proj-1" },
            { type: "writeProject", id: "proj-1" },
          ],
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.agents.unshift(created);
      return {
        agent: structuredClone(created),
        created: true,
      };
    },
    listEvents(agentId, limit) {
      const agentEvents = cloneEntries(this.events.get(agentId) ?? []);
      if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
        return agentEvents.slice(-limit);
      }
      return agentEvents;
    },
    contextUsage(agentId) {
      const count = (this.events.get(agentId) ?? []).length;
      return {
        context_utilization: count > 0 ? Math.min(0.12 + count * 0.03, 0.42) : 0.08,
        estimated_context_tokens: 900 + count * 180,
      };
    },
    listProjectBindings(agentId) {
      return structuredClone(this.projectBindings.get(agentId) ?? []);
    },
    addProjectBinding(agentId, binding) {
      const current = this.projectBindings.get(agentId) ?? [];
      if (current.some((entry) => entry.project_agent_id === binding.project_agent_id)) {
        return structuredClone(binding);
      }
      this.projectBindings.set(agentId, [...current, structuredClone(binding)]);
      return structuredClone(binding);
    },
    removeProjectBinding(agentId, bindingId) {
      const current = this.projectBindings.get(agentId) ?? [];
      const next = current.filter((binding) => binding.project_agent_id !== bindingId);
      this.projectBindings.set(agentId, next);
      return current.length !== next.length;
    },
  };
}

function buildProjectAgentInstance(agent, binding) {
  const timestamp = new Date().toISOString();
  return {
    agent_instance_id: String(binding.project_agent_id || `${binding.project_id}-${agent.agent_id}`),
    project_id: binding.project_id,
    agent_id: agent.agent_id,
    org_id: agent.org_id ?? "org-1",
    name: agent.name,
    role: agent.role,
    personality: agent.personality,
    system_prompt: agent.system_prompt,
    skills: cloneEntries(agent.skills ?? []),
    icon: agent.icon ?? null,
    machine_type: agent.machine_type || "local",
    adapter_type: agent.adapter_type || "aura_harness",
    environment: agent.environment || "local_host",
    auth_source: agent.auth_source || "aura_managed",
    integration_id: agent.integration_id ?? null,
    default_model: agent.default_model ?? null,
    workspace_path: `/Users/demo/workspaces/${binding.project_name || "Demo Project"}`,
    status: "idle",
    current_task_id: null,
    current_session_id: null,
    total_input_tokens: 0,
    total_output_tokens: 0,
    permissions: structuredClone(agent.permissions ?? {
      scope: { orgs: [], projects: [], agent_ids: [] },
      capabilities: [],
    }),
    intent_classifier: agent.intent_classifier ?? null,
    created_at: agent.created_at || timestamp,
    updated_at: agent.updated_at || timestamp,
  };
}

function buildProjectState(profile, agentsState, session) {
  const projects = cloneEntries(profile.seed.projects ?? []);
  const specs = cloneEntries(profile.seed.specs ?? []);
  const tasks = cloneEntries(profile.seed.tasks ?? []);
  const taskOutputs = new Map(
    Object.entries(profile.seed.taskOutputs ?? {}).map(([taskId, value]) => [taskId, structuredClone(value)]),
  );
  let projectAgentCounter = 20;

  const getProject = (projectId) =>
    structuredClone(projects.find((project) => project.project_id === projectId) ?? null);

  const listProjectAgents = (projectId) => {
    const instances = [];
    for (const agent of agentsState.agents) {
      const bindings = agentsState.listProjectBindings(agent.agent_id);
      for (const binding of bindings) {
        if (binding.project_id === projectId) {
          instances.push(buildProjectAgentInstance(agent, binding));
        }
      }
    }
    return instances;
  };

  const getProjectAgent = (projectId, agentInstanceId) =>
    structuredClone(
      listProjectAgents(projectId).find((agent) => agent.agent_instance_id === agentInstanceId) ?? null,
    );

  return {
    getProject,
    listSpecs(projectId) {
      return structuredClone(specs.filter((spec) => spec.project_id === projectId));
    },
    getSpec(projectId, specId) {
      return structuredClone(
        specs.find((spec) => spec.project_id === projectId && spec.spec_id === specId) ?? null,
      );
    },
    listTasks(projectId) {
      return structuredClone(tasks.filter((task) => task.project_id === projectId));
    },
    listTasksBySpec(projectId, specId) {
      return structuredClone(
        tasks.filter((task) => task.project_id === projectId && task.spec_id === specId),
      );
    },
    getTaskOutput(projectId, taskId) {
      const task = tasks.find((entry) => entry.project_id === projectId && entry.task_id === taskId);
      if (!task) {
        return { output: "", unavailable: true };
      }
      return structuredClone(taskOutputs.get(taskId) ?? {
        output: task.live_output || "",
        build_steps: task.build_steps ?? [],
        test_steps: task.test_steps ?? [],
        unavailable: !(task.live_output || task.build_steps?.length || task.test_steps?.length),
      });
    },
    listProjectAgents(projectId) {
      return structuredClone(listProjectAgents(projectId));
    },
    getProjectAgent,
    listProjectAgentEvents(projectId, agentInstanceId) {
      const instance = getProjectAgent(projectId, agentInstanceId);
      if (!instance) {
        return [];
      }
      return agentsState.listEvents(instance.agent_id).map((event) => ({
        ...event,
        agent_instance_id: agentInstanceId,
        project_id: projectId,
      }));
    },
    createProjectAgent(projectId, body) {
      const project = getProject(projectId);
      if (!project) {
        return null;
      }

      const requestedAgentId = String(body.agent_id || "").trim();
      let agent = requestedAgentId ? agentsState.get(requestedAgentId) : null;
      if (!agent) {
        agent = agentsState.ensureCeo(session).agent;
      }
      if (!agent) {
        return null;
      }

      projectAgentCounter += 1;
      const binding = {
        project_agent_id: `proj-agent-generated-${projectAgentCounter}`,
        project_id: projectId,
        project_name: project.name,
      };
      agentsState.addProjectBinding(agent.agent_id, binding);
      return buildProjectAgentInstance(agent, binding);
    },
  };
}

function buildFeedState(profile) {
  const feedEvents = cloneEntries(profile.seed.feedEvents ?? []);
  const feedComments = new Map(
    Object.entries(profile.seed.feedComments ?? {}).map(([eventId, comments]) => [eventId, cloneEntries(comments)]),
  );
  let postCounter = 20;
  let commentCounter = 20;

  return {
    feedEvents,
    feedComments,
    nextPostId() {
      postCounter += 1;
      return `feed-post-${postCounter}`;
    },
    nextCommentId() {
      commentCounter += 1;
      return `feed-comment-${commentCounter}`;
    },
    list() {
      return structuredClone(this.feedEvents);
    },
    get(postId) {
      return structuredClone(this.feedEvents.find((event) => event.id === postId) ?? null);
    },
    comments(postId) {
      return structuredClone(this.feedComments.get(postId) ?? []);
    },
    createPost(body, session) {
      const created = {
        id: this.nextPostId(),
        profile_id: session.profile_id,
        event_type: String(body.event_type || body.post_type || "post"),
        post_type: String(body.post_type || "post"),
        title: String(body.title || "Launch update").trim(),
        summary: String(body.summary || "").trim() || null,
        metadata: body.metadata ?? null,
        org_id: "org-1",
        project_id: "proj-1",
        agent_id: null,
        user_id: session.user_id,
        push_id: null,
        commit_ids: [],
        created_at: new Date().toISOString(),
        comment_count: 0,
        author_name: session.display_name,
        author_avatar: null,
      };
      this.feedEvents.unshift(created);
      return structuredClone(created);
    },
    addComment(postId, content, session) {
      const created = {
        id: this.nextCommentId(),
        activity_event_id: postId,
        profile_id: session.profile_id,
        content: String(content || "").trim(),
        created_at: new Date().toISOString(),
        author_name: session.display_name,
        author_avatar: null,
      };
      this.feedComments.set(postId, [...(this.feedComments.get(postId) ?? []), created]);
      const index = this.feedEvents.findIndex((event) => event.id === postId);
      if (index >= 0) {
        this.feedEvents[index] = {
          ...this.feedEvents[index],
          comment_count: Number(this.feedEvents[index].comment_count ?? 0) + 1,
        };
      }
      return structuredClone(created);
    },
    deleteComment(commentId) {
      let removed = false;
      for (const [eventId, comments] of this.feedComments.entries()) {
        const next = comments.filter((comment) => comment.id !== commentId);
        if (next.length !== comments.length) {
          this.feedComments.set(eventId, next);
          const index = this.feedEvents.findIndex((event) => event.id === eventId);
          if (index >= 0) {
            this.feedEvents[index] = {
              ...this.feedEvents[index],
              comment_count: Math.max(0, Number(this.feedEvents[index].comment_count ?? 0) - 1),
            };
          }
          removed = true;
          break;
        }
      }
      return removed;
    },
  };
}

function buildProcessState(profile) {
  const processes = cloneEntries(profile.seed.processes ?? []);
  const folders = cloneEntries(profile.seed.processFolders ?? []);
  const nodes = new Map(
    Object.entries(profile.seed.processNodes ?? {}).map(([processId, entries]) => [processId, cloneEntries(entries)]),
  );
  const connections = new Map(
    Object.entries(profile.seed.processConnections ?? {}).map(([processId, entries]) => [processId, cloneEntries(entries)]),
  );
  const runs = new Map(
    Object.entries(profile.seed.processRuns ?? {}).map(([processId, entries]) => [processId, cloneEntries(entries)]),
  );
  const runEvents = new Map(
    Object.entries(profile.seed.processRunEvents ?? {}).map(([runId, entries]) => [runId, cloneEntries(entries)]),
  );
  let processCounter = 20;
  let folderCounter = 20;
  let nodeCounter = 20;
  let connectionCounter = 20;
  let runCounter = 20;

  return {
    processes,
    folders,
    nodes,
    connections,
    runs,
    runEvents,
    nextProcessId() {
      processCounter += 1;
      return `process-demo-${processCounter}`;
    },
    nextFolderId() {
      folderCounter += 1;
      return `process-folder-${folderCounter}`;
    },
    nextNodeId() {
      nodeCounter += 1;
      return `process-node-${nodeCounter}`;
    },
    nextConnectionId() {
      connectionCounter += 1;
      return `process-connection-${connectionCounter}`;
    },
    nextRunId() {
      runCounter += 1;
      return `process-run-${runCounter}`;
    },
    listProcesses() {
      return structuredClone(this.processes);
    },
    getProcess(processId) {
      return structuredClone(this.processes.find((process) => process.process_id === processId) ?? null);
    },
    createProcess(body, session) {
      const now = new Date().toISOString();
      const created = {
        process_id: this.nextProcessId(),
        org_id: "org-1",
        user_id: session.user_id,
        project_id: body.project_id || "proj-1",
        name: String(body.name || "My Process").trim(),
        description: String(body.description || "").trim(),
        enabled: true,
        folder_id: body.folder_id ?? null,
        schedule: body.schedule ?? null,
        tags: Array.isArray(body.tags) ? body.tags.map((entry) => String(entry || "").trim()).filter(Boolean) : [],
        last_run_at: null,
        next_run_at: null,
        created_at: now,
        updated_at: now,
      };
      this.processes.unshift(created);
      this.nodes.set(created.process_id, []);
      this.connections.set(created.process_id, []);
      this.runs.set(created.process_id, []);
      return structuredClone(created);
    },
    updateProcess(processId, body) {
      const index = this.processes.findIndex((process) => process.process_id === processId);
      if (index === -1) {
        return null;
      }
      const updated = {
        ...this.processes[index],
        ...body,
        updated_at: new Date().toISOString(),
      };
      this.processes[index] = updated;
      return structuredClone(updated);
    },
    deleteProcess(processId) {
      const index = this.processes.findIndex((process) => process.process_id === processId);
      if (index === -1) {
        return false;
      }
      this.processes.splice(index, 1);
      this.nodes.delete(processId);
      this.connections.delete(processId);
      this.runs.delete(processId);
      return true;
    },
    listNodes(processId) {
      return structuredClone(this.nodes.get(processId) ?? []);
    },
    createNode(processId, body) {
      const created = {
        node_id: this.nextNodeId(),
        process_id: processId,
        node_type: String(body.node_type || "prompt"),
        label: String(body.label || "Untitled Node").trim(),
        agent_id: body.agent_id ?? null,
        prompt: String(body.prompt || "").trim(),
        config: body.config ?? {},
        position_x: Number(body.position_x ?? 160),
        position_y: Number(body.position_y ?? 160),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.nodes.set(processId, [...(this.nodes.get(processId) ?? []), created]);
      return structuredClone(created);
    },
    updateNode(processId, nodeId, body) {
      const current = this.nodes.get(processId) ?? [];
      const index = current.findIndex((node) => node.node_id === nodeId);
      if (index === -1) {
        return null;
      }
      const updated = {
        ...current[index],
        ...body,
        updated_at: new Date().toISOString(),
      };
      current[index] = updated;
      this.nodes.set(processId, current);
      return structuredClone(updated);
    },
    deleteNode(processId, nodeId) {
      const current = this.nodes.get(processId) ?? [];
      const next = current.filter((node) => node.node_id !== nodeId);
      this.nodes.set(processId, next);
      return next.length !== current.length;
    },
    listConnections(processId) {
      return structuredClone(this.connections.get(processId) ?? []);
    },
    createConnection(processId, body) {
      const created = {
        connection_id: this.nextConnectionId(),
        process_id: processId,
        source_node_id: String(body.source_node_id || ""),
        source_handle: body.source_handle ?? null,
        target_node_id: String(body.target_node_id || ""),
        target_handle: body.target_handle ?? null,
      };
      this.connections.set(processId, [...(this.connections.get(processId) ?? []), created]);
      return structuredClone(created);
    },
    deleteConnection(processId, connectionId) {
      const current = this.connections.get(processId) ?? [];
      const next = current.filter((connection) => connection.connection_id !== connectionId);
      this.connections.set(processId, next);
      return next.length !== current.length;
    },
    listRuns(processId) {
      return structuredClone(this.runs.get(processId) ?? []);
    },
    triggerProcess(processId) {
      const created = {
        run_id: this.nextRunId(),
        process_id: processId,
        status: "completed",
        trigger: "manual",
        error: null,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        output: "Seeded demo run completed successfully.",
      };
      this.runs.set(processId, [created, ...(this.runs.get(processId) ?? [])]);
      this.runEvents.set(created.run_id, []);
      const index = this.processes.findIndex((process) => process.process_id === processId);
      if (index >= 0) {
        this.processes[index] = {
          ...this.processes[index],
          last_run_at: created.completed_at,
          updated_at: created.completed_at,
        };
      }
      return structuredClone(created);
    },
    getRun(processId, runId) {
      return structuredClone((this.runs.get(processId) ?? []).find((run) => run.run_id === runId) ?? null);
    },
    cancelRun(processId, runId) {
      const current = this.runs.get(processId) ?? [];
      const index = current.findIndex((run) => run.run_id === runId);
      if (index === -1) {
        return false;
      }
      current[index] = {
        ...current[index],
        status: "cancelled",
        completed_at: new Date().toISOString(),
      };
      this.runs.set(processId, current);
      return true;
    },
    listRunEvents(runId) {
      return structuredClone(this.runEvents.get(runId) ?? []);
    },
    listFolders() {
      return structuredClone(this.folders);
    },
    createFolder(body, session) {
      const now = new Date().toISOString();
      const created = {
        folder_id: this.nextFolderId(),
        org_id: body.org_id || "org-1",
        user_id: session.user_id,
        name: String(body.name || "New Folder").trim() || "New Folder",
        created_at: now,
        updated_at: now,
      };
      this.folders.unshift(created);
      return structuredClone(created);
    },
    updateFolder(folderId, body) {
      const index = this.folders.findIndex((folder) => folder.folder_id === folderId);
      if (index === -1) {
        return null;
      }
      const updated = {
        ...this.folders[index],
        ...body,
        updated_at: new Date().toISOString(),
      };
      this.folders[index] = updated;
      return structuredClone(updated);
    },
    deleteFolder(folderId) {
      const index = this.folders.findIndex((folder) => folder.folder_id === folderId);
      if (index === -1) {
        return false;
      }
      this.folders.splice(index, 1);
      return true;
    },
  };
}

function buildDebugState(profile, projects) {
  const runsByProject = new Map(
    Object.entries(profile.seed.debugRuns ?? {}).map(([projectId, runs]) => [projectId, cloneEntries(runs)]),
  );
  const logsByRun = new Map(
    Object.entries(profile.seed.debugRunLogs ?? {}).map(([runId, logs]) => [runId, structuredClone(logs)]),
  );
  const summariesByRun = new Map(
    Object.entries(profile.seed.debugRunSummaries ?? {}).map(([runId, summary]) => [runId, structuredClone(summary)]),
  );
  const projectsById = new Map(
    (Array.isArray(projects) ? projects : []).map((project) => [project.project_id, structuredClone(project)]),
  );

  const findRun = (projectId, runId) =>
    (runsByProject.get(projectId) ?? []).find((run) => run.run_id === runId) ?? null;

  return {
    listProjects() {
      const entries = [];
      for (const [projectId, runs] of runsByProject.entries()) {
        const sortedRuns = [...runs].sort((left, right) =>
          String(right.started_at || "").localeCompare(String(left.started_at || ""))
        );
        const latestRun = sortedRuns[0] ?? null;
        const project = projectsById.get(projectId) ?? null;
        entries.push({
          project_id: projectId,
          project_name: project?.name || projectId,
          run_count: sortedRuns.length,
          latest_run: structuredClone(latestRun),
        });
      }

      return {
        projects: entries.sort((left, right) =>
          String(left.project_name || left.project_id).localeCompare(String(right.project_name || right.project_id))
        ),
      };
    },
    listRuns(projectId, specId = "") {
      const normalizedSpecId = String(specId || "").trim();
      const runs = cloneEntries(runsByProject.get(projectId) ?? []);
      const filtered = normalizedSpecId
        ? runs.filter((run) => Array.isArray(run.spec_ids) && run.spec_ids.includes(normalizedSpecId))
        : runs;
      return {
        runs: filtered.sort((left, right) =>
          String(right.started_at || "").localeCompare(String(left.started_at || ""))
        ),
      };
    },
    getRun(projectId, runId) {
      return structuredClone(findRun(projectId, runId));
    },
    getSummary(projectId, runId) {
      const run = findRun(projectId, runId);
      if (!run) {
        return null;
      }
      return structuredClone(
        summariesByRun.get(runId) ?? {
          run_id: runId,
          markdown: `# ${runId}\n\nSeeded debug summary is available for this demo run.`,
        },
      );
    },
    getLogs(projectId, runId, channel = "events") {
      const run = findRun(projectId, runId);
      if (!run) {
        return null;
      }
      const runLogs = logsByRun.get(runId) ?? {};
      return String(runLogs[channel] ?? "");
    },
    exportRun(projectId, runId) {
      const run = findRun(projectId, runId);
      if (!run) {
        return null;
      }
      return `Seeded debug export for ${runId}\n`;
    },
  };
}

export async function installBootAuth(page, session) {
  await page.addInitScript((seedSession) => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem("aura-jwt", seedSession.access_token);
      window.localStorage.setItem("aura-session", JSON.stringify(seedSession));
      window.localStorage.setItem("aura-idb:auth:session", JSON.stringify(seedSession));
      window.__AURA_ENABLE_SCREENSHOT_BRIDGE__ = true;
      window.__AURA_BOOT_AUTH__ = {
        isLoggedIn: true,
        session: seedSession,
        jwt: seedSession.access_token,
      };
    } catch {
      // Ignore storage bootstrap failures inside the screenshot harness.
    }
  }, session);
}

export async function installSeedRoutes(page, profile) {
  const state = buildFeedbackState(profile);
  const notesState = buildNotesState(profile);
  const agentsState = buildAgentState(profile);
  const projectState = buildProjectState(profile, agentsState, profile.session);
  const feedState = buildFeedState(profile);
  const processState = buildProcessState(profile);
  const debugState = buildDebugState(profile, profile.seed.projects ?? []);
  const orgs = cloneEntries(profile.seed.orgs);
  const projects = cloneEntries(profile.seed.projects);
  const session = structuredClone(profile.session);
  const user = {
    id: session.user_id,
    zos_user_id: session.user_id,
    display_name: session.display_name,
    avatar_url: null,
    bio: "Testing screenshot-first product capture.",
    location: "NYC",
    website: "https://example.com",
    profile_id: session.profile_id,
    created_at: "2026-03-17T01:00:00.000Z",
    updated_at: "2026-03-17T01:00:00.000Z",
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : url.pathname;
    const method = request.method();

    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      return route.fallback();
    }

    if (pathname === "/api/auth/session" || pathname === "/api/auth/validate") {
      return createResponse(route, session);
    }
    if (pathname === "/api/users/me") {
      return createResponse(route, user);
    }
    if (pathname === "/api/orgs") {
      return createResponse(route, orgs);
    }
    if (pathname === "/api/projects") {
      return createResponse(route, projects);
    }

    if (pathname === "/api/debug/projects" && method === "GET") {
      return createResponse(route, debugState.listProjects());
    }

    const debugRunsMatch = pathname.match(/^\/api\/debug\/projects\/([^/]+)\/runs$/);
    if (debugRunsMatch && method === "GET") {
      const [, projectId] = debugRunsMatch;
      return createResponse(route, debugState.listRuns(projectId, url.searchParams.get("spec_id") || ""));
    }

    const debugRunSummaryMatch = pathname.match(/^\/api\/debug\/projects\/([^/]+)\/runs\/([^/]+)\/summary$/);
    if (debugRunSummaryMatch && method === "GET") {
      const [, projectId, runId] = debugRunSummaryMatch;
      const summary = debugState.getSummary(projectId, runId);
      return createResponse(route, summary ?? { error: "Run not found" }, summary ? 200 : 404);
    }

    const debugRunLogsMatch = pathname.match(/^\/api\/debug\/projects\/([^/]+)\/runs\/([^/]+)\/logs$/);
    if (debugRunLogsMatch && method === "GET") {
      const [, projectId, runId] = debugRunLogsMatch;
      const channel = String(url.searchParams.get("channel") || "events");
      const logs = debugState.getLogs(projectId, runId, channel);
      return createTextResponse(route, logs ?? "", logs !== null ? 200 : 404);
    }

    const debugRunExportMatch = pathname.match(/^\/api\/debug\/projects\/([^/]+)\/runs\/([^/]+)\/export$/);
    if (debugRunExportMatch && method === "GET") {
      const [, projectId, runId] = debugRunExportMatch;
      const exportBody = debugState.exportRun(projectId, runId);
      return createTextResponse(route, exportBody ?? "", exportBody !== null ? 200 : 404, "application/zip");
    }

    const debugRunMatch = pathname.match(/^\/api\/debug\/projects\/([^/]+)\/runs\/([^/]+)$/);
    if (debugRunMatch && method === "GET") {
      const [, projectId, runId] = debugRunMatch;
      const run = debugState.getRun(projectId, runId);
      return createResponse(route, run ?? { error: "Run not found" }, run ? 200 : 404);
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && method === "GET") {
      const [, projectId] = projectMatch;
      const project = projectState.getProject(projectId);
      return createResponse(route, project ?? { error: "Project not found" }, project ? 200 : 404);
    }

    const projectAgentsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/agents$/);
    if (projectAgentsMatch && method === "GET") {
      const [, projectId] = projectAgentsMatch;
      return createResponse(route, projectState.listProjectAgents(projectId));
    }
    if (projectAgentsMatch && method === "POST") {
      const [, projectId] = projectAgentsMatch;
      const body = parseJsonBody(request.postData());
      const created = projectState.createProjectAgent(projectId, body);
      return createResponse(route, created ?? { error: "Project not found" }, created ? 201 : 404);
    }

    const projectAgentMatch = pathname.match(/^\/api\/projects\/([^/]+)\/agents\/([^/]+)$/);
    if (projectAgentMatch && method === "GET") {
      const [, projectId, agentInstanceId] = projectAgentMatch;
      const instance = projectState.getProjectAgent(projectId, agentInstanceId);
      return createResponse(route, instance ?? { error: "Project agent not found" }, instance ? 200 : 404);
    }

    const projectAgentEventsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/agents\/([^/]+)\/events$/);
    if (projectAgentEventsMatch && method === "GET") {
      const [, projectId, agentInstanceId] = projectAgentEventsMatch;
      return createResponse(route, projectState.listProjectAgentEvents(projectId, agentInstanceId));
    }

    const projectAgentResetMatch = pathname.match(/^\/api\/projects\/([^/]+)\/agents\/([^/]+)\/reset-session$/);
    if (projectAgentResetMatch && method === "POST") {
      return createResponse(route, { ok: true });
    }

    const projectSpecsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/specs$/);
    if (projectSpecsMatch && method === "GET") {
      const [, projectId] = projectSpecsMatch;
      return createResponse(route, projectState.listSpecs(projectId));
    }

    const projectSpecMatch = pathname.match(/^\/api\/projects\/([^/]+)\/specs\/([^/]+)$/);
    if (projectSpecMatch && method === "GET") {
      const [, projectId, specId] = projectSpecMatch;
      const spec = projectState.getSpec(projectId, specId);
      return createResponse(route, spec ?? { error: "Spec not found" }, spec ? 200 : 404);
    }

    const projectSpecTasksMatch = pathname.match(/^\/api\/projects\/([^/]+)\/specs\/([^/]+)\/tasks$/);
    if (projectSpecTasksMatch && method === "GET") {
      const [, projectId, specId] = projectSpecTasksMatch;
      return createResponse(route, projectState.listTasksBySpec(projectId, specId));
    }

    const projectTasksMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks$/);
    if (projectTasksMatch && method === "GET") {
      const [, projectId] = projectTasksMatch;
      return createResponse(route, projectState.listTasks(projectId));
    }

    const projectTaskOutputMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/output$/);
    if (projectTaskOutputMatch && method === "GET") {
      const [, projectId, taskId] = projectTaskOutputMatch;
      return createResponse(route, projectState.getTaskOutput(projectId, taskId));
    }

    if (pathname === "/api/feed" || pathname === "/api/log-entries") {
      return createResponse(route, feedState.list());
    }
    if (pathname === "/api/follows") {
      return createResponse(route, []);
    }
    if (pathname === "/api/leaderboard" || pathname === "/api/leaderboard/") {
      return createResponse(route, []);
    }
    if (pathname === "/api/posts" && method === "POST") {
      const body = parseJsonBody(request.postData());
      return createResponse(route, feedState.createPost(body, session), 201);
    }

    const postMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
    if (postMatch && method === "GET") {
      const [, postId] = postMatch;
      const post = feedState.get(postId);
      return createResponse(route, post ?? { error: "Post not found" }, post ? 200 : 404);
    }

    const postCommentsMatch = pathname.match(/^\/api\/posts\/([^/]+)\/comments$/);
    if (postCommentsMatch && method === "GET") {
      const [, postId] = postCommentsMatch;
      return createResponse(route, feedState.comments(postId));
    }
    if (postCommentsMatch && method === "POST") {
      const [, postId] = postCommentsMatch;
      const body = parseJsonBody(request.postData());
      return createResponse(route, feedState.addComment(postId, body.content, session), 201);
    }

    const commentMatch = pathname.match(/^\/api\/comments\/([^/]+)$/);
    if (commentMatch && method === "DELETE") {
      const [, commentId] = commentMatch;
      const deleted = feedState.deleteComment(commentId);
      return createResponse(route, deleted ? { ok: true } : { error: "Comment not found" }, deleted ? 200 : 404);
    }

    if (pathname === "/api/processes" && method === "GET") {
      return createResponse(route, processState.listProcesses());
    }
    if (pathname === "/api/processes" && method === "POST") {
      const body = parseJsonBody(request.postData());
      return createResponse(route, processState.createProcess(body, session), 201);
    }

    const processMatch = pathname.match(/^\/api\/processes\/([^/]+)$/);
    if (processMatch && method === "GET") {
      const [, processId] = processMatch;
      const process = processState.getProcess(processId);
      return createResponse(route, process ?? { error: "Process not found" }, process ? 200 : 404);
    }
    if (processMatch && method === "PUT") {
      const [, processId] = processMatch;
      const body = parseJsonBody(request.postData());
      const updated = processState.updateProcess(processId, body);
      return createResponse(route, updated ?? { error: "Process not found" }, updated ? 200 : 404);
    }
    if (processMatch && method === "DELETE") {
      const [, processId] = processMatch;
      const deleted = processState.deleteProcess(processId);
      return createResponse(route, deleted ? { ok: true } : { error: "Process not found" }, deleted ? 200 : 404);
    }

    const processTriggerMatch = pathname.match(/^\/api\/processes\/([^/]+)\/trigger$/);
    if (processTriggerMatch && method === "POST") {
      const [, processId] = processTriggerMatch;
      return createResponse(route, processState.triggerProcess(processId), 201);
    }

    const processNodesMatch = pathname.match(/^\/api\/processes\/([^/]+)\/nodes$/);
    if (processNodesMatch && method === "GET") {
      const [, processId] = processNodesMatch;
      return createResponse(route, processState.listNodes(processId));
    }
    if (processNodesMatch && method === "POST") {
      const [, processId] = processNodesMatch;
      const body = parseJsonBody(request.postData());
      return createResponse(route, processState.createNode(processId, body), 201);
    }

    const processNodeMatch = pathname.match(/^\/api\/processes\/([^/]+)\/nodes\/([^/]+)$/);
    if (processNodeMatch && method === "PUT") {
      const [, processId, nodeId] = processNodeMatch;
      const body = parseJsonBody(request.postData());
      const updated = processState.updateNode(processId, nodeId, body);
      return createResponse(route, updated ?? { error: "Node not found" }, updated ? 200 : 404);
    }
    if (processNodeMatch && method === "DELETE") {
      const [, processId, nodeId] = processNodeMatch;
      const deleted = processState.deleteNode(processId, nodeId);
      return createResponse(route, deleted ? { ok: true } : { error: "Node not found" }, deleted ? 200 : 404);
    }

    const processConnectionsMatch = pathname.match(/^\/api\/processes\/([^/]+)\/connections$/);
    if (processConnectionsMatch && method === "GET") {
      const [, processId] = processConnectionsMatch;
      return createResponse(route, processState.listConnections(processId));
    }
    if (processConnectionsMatch && method === "POST") {
      const [, processId] = processConnectionsMatch;
      const body = parseJsonBody(request.postData());
      return createResponse(route, processState.createConnection(processId, body), 201);
    }

    const processConnectionMatch = pathname.match(/^\/api\/processes\/([^/]+)\/connections\/([^/]+)$/);
    if (processConnectionMatch && method === "DELETE") {
      const [, processId, connectionId] = processConnectionMatch;
      const deleted = processState.deleteConnection(processId, connectionId);
      return createResponse(route, deleted ? { ok: true } : { error: "Connection not found" }, deleted ? 200 : 404);
    }

    const processRunsMatch = pathname.match(/^\/api\/processes\/([^/]+)\/runs$/);
    if (processRunsMatch && method === "GET") {
      const [, processId] = processRunsMatch;
      return createResponse(route, processState.listRuns(processId));
    }

    const processRunMatch = pathname.match(/^\/api\/processes\/([^/]+)\/runs\/([^/]+)$/);
    if (processRunMatch && method === "GET") {
      const [, processId, runId] = processRunMatch;
      const run = processState.getRun(processId, runId);
      return createResponse(route, run ?? { error: "Run not found" }, run ? 200 : 404);
    }

    const processRunCancelMatch = pathname.match(/^\/api\/processes\/([^/]+)\/runs\/([^/]+)\/cancel$/);
    if (processRunCancelMatch && method === "POST") {
      const [, processId, runId] = processRunCancelMatch;
      const cancelled = processState.cancelRun(processId, runId);
      return createResponse(route, cancelled ? { ok: true } : { error: "Run not found" }, cancelled ? 200 : 404);
    }

    const processRunEventsMatch = pathname.match(/^\/api\/processes\/([^/]+)\/runs\/([^/]+)\/events$/);
    if (processRunEventsMatch && method === "GET") {
      const [, , runId] = processRunEventsMatch;
      return createResponse(route, processState.listRunEvents(runId));
    }

    const processRunArtifactsMatch = pathname.match(/^\/api\/processes\/([^/]+)\/runs\/([^/]+)\/artifacts$/);
    if (processRunArtifactsMatch && method === "GET") {
      return createResponse(route, []);
    }

    const processArtifactMatch = pathname.match(/^\/api\/process-artifacts\/([^/]+)$/);
    if (processArtifactMatch && method === "GET") {
      return createResponse(route, { error: "Artifact not found" }, 404);
    }

    if (pathname === "/api/process-folders" && method === "GET") {
      return createResponse(route, processState.listFolders());
    }
    if (pathname === "/api/process-folders" && method === "POST") {
      const body = parseJsonBody(request.postData());
      return createResponse(route, processState.createFolder(body, session), 201);
    }

    const processFolderMatch = pathname.match(/^\/api\/process-folders\/([^/]+)$/);
    if (processFolderMatch && method === "PUT") {
      const [, folderId] = processFolderMatch;
      const body = parseJsonBody(request.postData());
      const updated = processState.updateFolder(folderId, body);
      return createResponse(route, updated ?? { error: "Folder not found" }, updated ? 200 : 404);
    }
    if (processFolderMatch && method === "DELETE") {
      const [, folderId] = processFolderMatch;
      const deleted = processState.deleteFolder(folderId);
      return createResponse(route, deleted ? { ok: true } : { error: "Folder not found" }, deleted ? 200 : 404);
    }
    if (pathname === "/api/agents/harness/setup" && method === "POST") {
      return createResponse(route, agentsState.ensureCeo(session));
    }
    if (pathname === "/api/agents/harness/cleanup" && method === "POST") {
      const ceos = agentsState.agents.filter((agent) => Array.isArray(agent.tags) && agent.tags.includes("super_agent"));
      const kept = ceos[0]?.agent_id ?? null;
      return createResponse(route, {
        kept,
        deleted: [],
        failed: [],
      });
    }
    if (pathname === "/api/harness/skills") {
      return createResponse(route, []);
    }
    if (pathname === "/api/orgs/org-1/members") {
      return createResponse(route, [
        {
          org_id: "org-1",
          user_id: "user-1",
          display_name: "Test User",
          role: "owner",
          joined_at: "2026-03-17T01:00:00.000Z",
        },
      ]);
    }
    if (pathname === "/api/orgs/org-1/credits/balance") {
      return createResponse(route, { balance_cents: 1200, plan: "free", balance_formatted: "$12.00" });
    }
    if (
      pathname === "/api/orgs/org-1/invites"
      || pathname === "/api/orgs/org-1/integrations"
      || pathname === "/api/orgs/org-1/integrations/github/app"
    ) {
      return createResponse(route, []);
    }
    if (pathname === "/api/orgs/org-1/billing" || pathname === "/api/orgs/org-1/integrations/github") {
      return createResponse(route, null);
    }
    if (pathname === "/api/orgs/org-1/credits/transactions") {
      return createResponse(route, { transactions: [], has_more: false });
    }

    if (pathname === "/api/feedback" && method === "GET") {
      return createResponse(route, state.feedbackItems);
    }
    if (pathname === "/api/feedback" && method === "POST") {
      const body = parseJsonBody(request.postData());
      const created = {
        ...createFeedbackItem({
          id: state.nextFeedbackId(),
          title: String(body.title || "New idea").trim(),
          body: String(body.body || body.summary || "Created in seeded demo mode.").trim(),
          category: String(body.category || "feature_request"),
          status: String(body.status || "open"),
          product: String(body.product || "aura"),
          createdAt: new Date().toISOString(),
          commentCount: 0,
          upvotes: 1,
          authorName: session.display_name,
        }),
        metadata: body.metadata ?? null,
      };
      state.feedbackItems.unshift(created);
      return createResponse(route, created, 201);
    }

    const feedbackItemMatch = pathname.match(/^\/api\/feedback\/([^/]+)$/);
    if (feedbackItemMatch && method === "GET") {
      const [, itemId] = feedbackItemMatch;
      return createResponse(route, state.feedbackItems.find((item) => item.id === itemId) ?? {});
    }

    const feedbackCommentsMatch = pathname.match(/^\/api\/feedback\/([^/]+)\/comments$/);
    if (feedbackCommentsMatch && method === "GET") {
      const [, itemId] = feedbackCommentsMatch;
      return createResponse(route, state.feedbackComments.get(itemId) ?? []);
    }
    if (feedbackCommentsMatch && method === "POST") {
      const [, itemId] = feedbackCommentsMatch;
      const body = parseJsonBody(request.postData());
      const created = {
        id: state.nextCommentId(),
        activityEventId: itemId,
        profileId: session.profile_id,
        content: String(body.content || "").trim(),
        createdAt: new Date().toISOString(),
        authorName: session.display_name,
        authorAvatar: null,
      };
      state.feedbackComments.set(itemId, [...(state.feedbackComments.get(itemId) ?? []), created]);
      const itemIndex = state.feedbackItems.findIndex((item) => item.id === itemId);
      if (itemIndex >= 0) {
        state.feedbackItems[itemIndex] = {
          ...state.feedbackItems[itemIndex],
          commentCount: Number(state.feedbackItems[itemIndex].commentCount ?? 0) + 1,
        };
      }
      return createResponse(route, created);
    }

    const feedbackVoteMatch = pathname.match(/^\/api\/feedback\/([^/]+)\/vote$/);
    if (feedbackVoteMatch && method === "POST") {
      const [, itemId] = feedbackVoteMatch;
      const body = parseJsonBody(request.postData());
      const itemIndex = state.feedbackItems.findIndex((item) => item.id === itemId);
      if (itemIndex === -1) {
        return createResponse(route, { error: "Feedback item not found" }, 404);
      }
      const current = state.feedbackItems[itemIndex];
      const nextVote = typeof body.vote === "string" ? body.vote : "none";
      let upvotes = Number(current.upvotes ?? 0);
      let downvotes = Number(current.downvotes ?? 0);
      if (current.viewerVote === "up") upvotes -= 1;
      if (current.viewerVote === "down") downvotes -= 1;
      if (nextVote === "up") upvotes += 1;
      if (nextVote === "down") downvotes += 1;
      const updated = {
        ...current,
        viewerVote: nextVote,
        upvotes,
        downvotes,
        voteScore: upvotes - downvotes,
      };
      state.feedbackItems[itemIndex] = updated;
      return createResponse(route, {
        upvotes,
        downvotes,
        voteScore: upvotes - downvotes,
        viewerVote: nextVote,
      });
    }

    const notesProjectTreeMatch = pathname.match(/^\/api\/notes\/projects\/([^/]+)\/tree$/);
    if (notesProjectTreeMatch && method === "GET") {
      return createResponse(route, notesState.treeResponse());
    }

    const notesReadMatch = pathname.match(/^\/api\/notes\/projects\/([^/]+)\/read$/);
    if (notesReadMatch && method === "GET") {
      const relPath = url.searchParams.get("path") || "";
      const note = notesState.read(relPath);
      return createResponse(route, note ?? { error: "Note not found" }, note ? 200 : 404);
    }

    const notesWriteMatch = pathname.match(/^\/api\/notes\/projects\/([^/]+)\/write$/);
    if (notesWriteMatch && method === "POST") {
      const body = parseJsonBody(request.postData());
      return createResponse(route, notesState.write(String(body.path || ""), String(body.content || "")));
    }

    const notesCreateMatch = pathname.match(/^\/api\/notes\/projects\/([^/]+)\/create$/);
    if (notesCreateMatch && method === "POST") {
      const body = parseJsonBody(request.postData());
      return createResponse(
        route,
        notesState.create(String(body.parentPath || ""), String(body.name || ""), String(body.kind || "note")),
        201,
      );
    }

    const notesCommentsMatch = pathname.match(/^\/api\/notes\/projects\/([^/]+)\/comments$/);
    if (notesCommentsMatch && method === "GET") {
      const relPath = url.searchParams.get("path") || "";
      return createResponse(route, notesState.comments(relPath));
    }
    if (notesCommentsMatch && method === "POST") {
      const body = parseJsonBody(request.postData());
      return createResponse(
        route,
        notesState.addComment(
          String(body.path || ""),
          String(body.body || ""),
          String(body.authorName || session.display_name),
        ),
        201,
      );
    }

    if (pathname === "/api/agents" && method === "GET") {
      return createResponse(route, agentsState.list(url.searchParams.get("org_id") || undefined));
    }
    if (pathname === "/api/agents" && method === "POST") {
      const body = parseJsonBody(request.postData());
      return createResponse(route, agentsState.create(body, session), 201);
    }

    const agentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (agentMatch && method === "GET") {
      const [, agentId] = agentMatch;
      const agent = agentsState.get(agentId);
      return createResponse(route, agent ?? { error: "Agent not found" }, agent ? 200 : 404);
    }
    if (agentMatch && method === "PUT") {
      const [, agentId] = agentMatch;
      const body = parseJsonBody(request.postData());
      const updated = agentsState.update(agentId, body);
      return createResponse(route, updated ?? { error: "Agent not found" }, updated ? 200 : 404);
    }
    if (agentMatch && method === "DELETE") {
      const [, agentId] = agentMatch;
      const deleted = agentsState.delete(agentId);
      return createResponse(route, deleted ? { ok: true } : { error: "Agent not found" }, deleted ? 200 : 404);
    }

    const agentEventsMatch = pathname.match(/^\/api\/agents\/([^/]+)\/events$/);
    if (agentEventsMatch && method === "GET") {
      const [, agentId] = agentEventsMatch;
      const limit = Number(url.searchParams.get("limit") || 0) || undefined;
      return createResponse(route, agentsState.listEvents(agentId, limit));
    }

    const agentContextMatch = pathname.match(/^\/api\/agents\/([^/]+)\/context-usage$/);
    if (agentContextMatch && method === "GET") {
      const [, agentId] = agentContextMatch;
      return createResponse(route, agentsState.contextUsage(agentId));
    }

    const agentResetMatch = pathname.match(/^\/api\/agents\/([^/]+)\/reset-session$/);
    if (agentResetMatch && method === "POST") {
      return createResponse(route, { ok: true });
    }

    const agentProjectsMatch = pathname.match(/^\/api\/agents\/([^/]+)\/projects$/);
    if (agentProjectsMatch && method === "GET") {
      const [, agentId] = agentProjectsMatch;
      return createResponse(route, agentsState.listProjectBindings(agentId));
    }

    const agentProjectDeleteMatch = pathname.match(/^\/api\/agents\/([^/]+)\/projects\/([^/]+)$/);
    if (agentProjectDeleteMatch && method === "DELETE") {
      const [, agentId, bindingId] = agentProjectDeleteMatch;
      const removed = agentsState.removeProjectBinding(agentId, bindingId);
      return createResponse(route, removed ? { ok: true } : { error: "Binding not found" }, removed ? 200 : 404);
    }

    return createResponse(route, []);
  });
}
