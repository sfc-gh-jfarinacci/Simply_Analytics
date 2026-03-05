/**
 * Bar Charts - D3.js Chart Library
 * 
 * Exports all bar chart types:
 * - Vertical Bar Chart (grouped, stacked, grouped+stacked, trellis)
 * - Horizontal Bar Chart (grouped, stacked, grouped+stacked, trellis)
 * - Diverging Bar Chart
 */

// D3.js chart creation functions
export {
  createVerticalBarChart,
  createTrellisVerticalBarChart,
} from './verticalBarChart';

export {
  createHorizontalBarChart,
  createTrellisHorizontalBarChart,
} from './horizontalBarChart';

export {
  createDivergingBarChart,
  createTrellisDivergingBarChart,
} from './divergingBarChart';

// React wrapper components
export { default as VerticalBarChartWrapper } from './VerticalBarChartWrapper';
export { default as HorizontalBarChartWrapper } from './HorizontalBarChartWrapper';
export { default as DivergingBarChartWrapper } from './DivergingBarChartWrapper';
