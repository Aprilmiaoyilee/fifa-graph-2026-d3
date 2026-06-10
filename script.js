const svg = d3.select("#graph");
const tooltip = d3.select("#tooltip");
const winnerName = d3.select("#winnerName");
const winnerScore = d3.select("#winnerScore");
const searchInput = d3.select("#searchInput");
const topNInput = d3.select("#topNInput");
const topNValue = d3.select("#topNValue");
const resetButton = d3.select("#resetButton");

const width = () => svg.node().clientWidth;
const height = () => svg.node().clientHeight;

const root = svg.append("g");
const linkLayer = root.append("g");
const nodeLayer = root.append("g");
const labelLayer = root.append("g");
root.attr("opacity", 0);

const radiusScale = d3.scaleSqrt().range([4, 24]);
const clubRadiusScale = d3.scaleSqrt().range([3, 12]);
const linkScale = d3.scaleSqrt().range([0.8, 5]);

let graph = { nodes: [], links: [] };
let nodeById = new Map();
let linkedIds = new Map();
let currentTransform = d3.zoomIdentity;

const zoom = d3.zoom()
  .scaleExtent([0.35, 12])
  .on("zoom", (event) => {
    currentTransform = event.transform;
    root.attr("transform", currentTransform);
    updateLabelVisibility();
  });

svg.call(zoom);

loadData().then(([nodes, edges, winnerRows]) => {
  graph.nodes = nodes.map((node) => ({
    ...node,
    is_winner: String(node.is_winner).toLowerCase() === "true"
  }));
  graph.links = edges.map((edge) => ({
    ...edge,
    sourceId: edge.source,
    targetId: edge.target
  }));

  nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  linkedIds = buildLinkedIds(graph.links);

  const winner = winnerRows[0];
  winnerName.text(winner.country);
  winnerScore.text(`Centrality ${Number(winner.eigenvector_centrality).toFixed(6)}`);

  radiusScale.domain(d3.extent(graph.nodes.filter((d) => d.type === "country"), (d) => d.eigenvector_centrality));
  clubRadiusScale.domain(d3.extent(graph.nodes.filter((d) => d.type === "club"), (d) => d.player_count));
  linkScale.domain(d3.extent(graph.links, (d) => d.player_count));

  renderGraph();
}).catch((error) => {
  winnerName.text("Data load failed");
  winnerScore.text(error.message);
  console.error(error);
});

function loadData() {
  if (window.FIFA_GRAPH_DATA) {
    return Promise.resolve([
      window.FIFA_GRAPH_DATA.nodes,
      window.FIFA_GRAPH_DATA.edges,
      window.FIFA_GRAPH_DATA.winner
    ]);
  }

  return Promise.all([
    d3.csv("data/nodes.csv", d3.autoType),
    d3.csv("data/edges.csv", d3.autoType),
    d3.csv("data/winner.csv", d3.autoType)
  ]);
}

function buildLinkedIds(links) {
  const map = new Map();
  links.forEach((link) => {
    if (!map.has(link.sourceId)) map.set(link.sourceId, new Set());
    if (!map.has(link.targetId)) map.set(link.targetId, new Set());
    map.get(link.sourceId).add(link.targetId);
    map.get(link.targetId).add(link.sourceId);
  });
  return map;
}

function renderGraph() {
  const links = linkLayer.selectAll("line")
    .data(graph.links)
    .join("line")
    .attr("class", "link")
    .attr("stroke-width", (d) => linkScale(d.player_count))
    .on("mouseenter", showEdgeTooltip)
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip);

  const nodes = nodeLayer.selectAll("circle")
    .data(graph.nodes)
    .join("circle")
    .attr("class", (d) => `node ${d.type}${d.is_winner ? " winner" : ""}`)
    .attr("r", (d) => d.type === "country" ? radiusScale(d.eigenvector_centrality) : clubRadiusScale(d.player_count))
    .on("mouseenter", showNodeTooltip)
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip)
    .on("click", (event, d) => {
      event.stopPropagation();
      highlightNeighborhood(d.id);
    })
    .call(drag());

  const labels = labelLayer.selectAll("text")
    .data(graph.nodes)
    .join("text")
    .attr("class", (d) => `label ${d.type === "club" ? "club-label" : "country-label"}`)
    .attr("dy", (d) => d.type === "country" ? -12 : -8)
    .text((d) => d.label);

  const simulation = d3.forceSimulation(graph.nodes)
    .force("link", d3.forceLink(graph.links).id((d) => d.id).distance((d) => 55 + d.player_count * 3).strength(0.62))
    .force("charge", d3.forceManyBody().strength((d) => d.type === "country" ? -260 : -90))
    .force("center", d3.forceCenter(width() / 2, height() / 2))
    .force("collision", d3.forceCollide().radius((d) => (d.type === "country" ? radiusScale(d.eigenvector_centrality) : clubRadiusScale(d.player_count)) + 8))
    .on("tick", () => {
      links
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);

      nodes
        .attr("cx", (d) => d.x)
        .attr("cy", (d) => d.y);

      labels
        .attr("x", (d) => d.x)
        .attr("y", (d) => d.y);
    });

  svg.on("click", clearHighlight);
  searchInput.on("input", applyFilters);
  topNInput.on("input", applyFilters);
  resetButton.on("click", resetView);

  setTimeout(() => {
    fitToScreen({ animate: false });
    root.transition().duration(260).attr("opacity", 1);
  }, 450);
  updateLabelVisibility();

  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.25).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  function drag() {
    return d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended);
  }
}

function showNodeTooltip(event, d) {
  const html = d.type === "country"
    ? `<strong>${d.label}</strong>排名：${d.rank}<br>球员数：${d.player_count}<br>连接俱乐部数：${d.club_count}`
    : `<strong>${d.label}</strong>连接国家队数量：${d.country_count}<br>涉及球员数量：${d.player_count}`;
  tooltip.html(html).attr("hidden", null);
  moveTooltip(event);
}

function showEdgeTooltip(event, d) {
  const source = typeof d.source === "object" ? d.source.id : d.source;
  const target = typeof d.target === "object" ? d.target.id : d.target;
  const sourceNode = nodeById.get(source);
  const country = sourceNode.type === "country" ? source : target;
  const club = sourceNode.type === "club" ? source : target;
  tooltip
    .html(`<strong>${country} → ${club}</strong>${d.player_count} 名球员来自该俱乐部`)
    .attr("hidden", null);
  moveTooltip(event);
}

function moveTooltip(event) {
  const stage = document.querySelector(".graph-stage").getBoundingClientRect();
  tooltip
    .style("left", `${event.clientX - stage.left + 14}px`)
    .style("top", `${event.clientY - stage.top + 14}px`);
}

function hideTooltip() {
  tooltip.attr("hidden", true);
}

function updateLabelVisibility() {
  const showClubLabels = currentTransform.k >= 1.5;
  labelLayer.selectAll(".club-label").style("opacity", showClubLabels ? 1 : 0);
  labelLayer.selectAll(".country-label").style("opacity", 1);
}

function applyFilters() {
  const query = searchInput.property("value").trim().toLowerCase();
  const topN = Number(topNInput.property("value"));
  topNValue.text(topN);

  const visibleCountries = new Set(
    graph.nodes
      .filter((d) => d.type === "country" && Number(d.rank) <= topN)
      .map((d) => d.id)
  );

  const matchingIds = new Set();
  if (query) {
    graph.nodes.forEach((node) => {
      if (node.label.toLowerCase().includes(query)) matchingIds.add(node.id);
    });
  }

  nodeLayer.selectAll("circle").classed("dimmed", (d) => {
    const hiddenByRank = d.type === "country" && !visibleCountries.has(d.id);
    const hiddenBySearch = query && !matchingIds.has(d.id);
    return hiddenByRank || hiddenBySearch;
  });

  labelLayer.selectAll("text").classed("dimmed", (d) => {
    const hiddenByRank = d.type === "country" && !visibleCountries.has(d.id);
    const hiddenBySearch = query && !matchingIds.has(d.id);
    return hiddenByRank || hiddenBySearch;
  });

  linkLayer.selectAll("line").classed("dimmed", (d) => {
    const source = typeof d.source === "object" ? d.source.id : d.source;
    const target = typeof d.target === "object" ? d.target.id : d.target;
    const sourceNode = nodeById.get(source);
    const countryId = sourceNode.type === "country" ? source : target;
    const hiddenByRank = !visibleCountries.has(countryId);
    const hiddenBySearch = query && !matchingIds.has(source) && !matchingIds.has(target);
    return hiddenByRank || hiddenBySearch;
  });
}

function highlightNeighborhood(id) {
  const neighbors = linkedIds.get(id) || new Set();
  nodeLayer.selectAll("circle")
    .classed("dimmed", (d) => d.id !== id && !neighbors.has(d.id))
    .classed("highlighted", (d) => d.id === id || neighbors.has(d.id));

  labelLayer.selectAll("text")
    .classed("dimmed", (d) => d.id !== id && !neighbors.has(d.id))
    .classed("highlighted", (d) => d.id === id || neighbors.has(d.id));

  linkLayer.selectAll("line")
    .classed("dimmed", (d) => {
      const source = typeof d.source === "object" ? d.source.id : d.source;
      const target = typeof d.target === "object" ? d.target.id : d.target;
      return source !== id && target !== id;
    })
    .classed("highlighted", (d) => {
      const source = typeof d.source === "object" ? d.source.id : d.source;
      const target = typeof d.target === "object" ? d.target.id : d.target;
      return source === id || target === id;
    });
}

function clearHighlight() {
  nodeLayer.selectAll("circle").classed("dimmed highlighted", false);
  labelLayer.selectAll("text").classed("dimmed highlighted", false);
  linkLayer.selectAll("line").classed("dimmed highlighted", false);
  applyFilters();
}

function resetView() {
  searchInput.property("value", "");
  topNInput.property("value", 48);
  topNValue.text("48");
  clearHighlight();
  fitToScreen({ animate: true });
}

function fitToScreen({ animate = true } = {}) {
  const bounds = root.node().getBBox();
  const fullWidth = width();
  const fullHeight = height();
  const scale = Math.max(0.35, Math.min(0.78, 0.68 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight)));
  const translate = [
    fullWidth / 2 - scale * (bounds.x + bounds.width / 2),
    fullHeight / 2 - scale * (bounds.y + bounds.height / 2)
  ];
  const nextTransform = d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale);
  if (animate) {
    svg.transition().duration(650).call(zoom.transform, nextTransform);
  } else {
    svg.call(zoom.transform, nextTransform);
  }
}
