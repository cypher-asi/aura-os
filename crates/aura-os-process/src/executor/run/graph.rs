// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

fn topological_sort(
    nodes: &[ProcessNode],
    connections: &[aura_os_core::ProcessNodeConnection],
) -> Result<Vec<ProcessNodeId>, ProcessError> {
    // Group nodes are purely visual — strip them and any connection that
    // touches them so they have zero impact on execution topology.
    let group_ids: HashSet<ProcessNodeId> = nodes
        .iter()
        .filter(|n| n.node_type == ProcessNodeType::Group)
        .map(|n| n.node_id)
        .collect();

    let exec_nodes: Vec<_> = nodes
        .iter()
        .filter(|n| !group_ids.contains(&n.node_id))
        .collect();
    let exec_node_ids: HashSet<ProcessNodeId> = exec_nodes.iter().map(|n| n.node_id).collect();

    let mut in_degree: HashMap<ProcessNodeId, usize> = HashMap::new();
    let mut adjacency: HashMap<ProcessNodeId, Vec<ProcessNodeId>> = HashMap::new();

    for node in &exec_nodes {
        in_degree.entry(node.node_id).or_insert(0);
        adjacency.entry(node.node_id).or_default();
    }

    for conn in connections {
        if !exec_node_ids.contains(&conn.source_node_id)
            || !exec_node_ids.contains(&conn.target_node_id)
        {
            continue;
        }
        *in_degree.entry(conn.target_node_id).or_insert(0) += 1;
        adjacency
            .entry(conn.source_node_id)
            .or_default()
            .push(conn.target_node_id);
    }

    let mut queue: VecDeque<ProcessNodeId> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    let mut sorted = Vec::new();

    while let Some(id) = queue.pop_front() {
        sorted.push(id);
        if let Some(neighbors) = adjacency.get(&id) {
            for &neighbor in neighbors {
                if let Some(deg) = in_degree.get_mut(&neighbor) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(neighbor);
                    }
                }
            }
        }
    }

    let expected = exec_nodes.len();
    if sorted.len() != expected {
        return Err(ProcessError::InvalidGraph("Graph contains a cycle".into()));
    }

    Ok(sorted)
}

// ---------------------------------------------------------------------------
// Reachability from Ignition nodes
// ---------------------------------------------------------------------------

fn reachable_from_ignition(
    nodes: &[ProcessNode],
    connections: &[aura_os_core::ProcessNodeConnection],
) -> HashSet<ProcessNodeId> {
    let group_ids: HashSet<ProcessNodeId> = nodes
        .iter()
        .filter(|n| n.node_type == ProcessNodeType::Group)
        .map(|n| n.node_id)
        .collect();

    let mut adjacency: HashMap<ProcessNodeId, Vec<ProcessNodeId>> = HashMap::new();
    for conn in connections {
        if group_ids.contains(&conn.source_node_id) || group_ids.contains(&conn.target_node_id) {
            continue;
        }
        adjacency
            .entry(conn.source_node_id)
            .or_default()
            .push(conn.target_node_id);
    }

    let mut visited = HashSet::new();
    let mut queue: VecDeque<ProcessNodeId> = nodes
        .iter()
        .filter(|n| n.node_type == ProcessNodeType::Ignition)
        .map(|n| n.node_id)
        .collect();

    while let Some(id) = queue.pop_front() {
        if !visited.insert(id) {
            continue;
        }
        if let Some(neighbors) = adjacency.get(&id) {
            for &neighbor in neighbors {
                if !visited.contains(&neighbor) {
                    queue.push_back(neighbor);
                }
            }
        }
    }

    visited
}
