/**
 * The reference component system, shared by the studio and the API.
 *
 * Generation happens on the server and rendering happens in the browser, so
 * both sides have to agree on exactly which components exist and what props
 * they accept. Keeping the definitions here — with no rendering code attached —
 * is what makes that possible.
 */
export {
  createSurfaceRegistry,
  surfaceComponentNames,
  barChartProps,
  calloutProps,
  compareTableProps,
  fieldSetProps,
  filterBarProps,
  metricRowProps,
  optionGridProps,
  sectionProps,
  summaryProps,
  timelineProps,
  type SurfaceComponentName,
} from "./components";

export {
  chartComponents,
  donutChartProps,
  funnelChartProps,
  gaugeMeterProps,
  heatGridProps,
  lineChartProps,
  rankedListProps,
} from "./charts";

export {
  codeBlockProps,
  dataComponents,
  diffViewerProps,
  jsonViewerProps,
  keyValueGridProps,
  statCardProps,
} from "./data";

export {
  agentTaskListProps,
  agenticComponents,
  anomalyListProps,
  approvalCardProps,
  sourceListProps,
  thinkingTraceProps,
  toolRunProps,
} from "./agentic";

export { createSurfaceActions } from "./actions";
