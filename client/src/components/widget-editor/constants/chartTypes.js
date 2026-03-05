/**
 * Chart type definitions and categories
 */
import {
  FiTable,
  FiHash,
  FiBarChart2,
  FiAlignLeft,
  FiMinusCircle,
  FiTrendingUp,
  FiPieChart,
  FiDisc,
  FiSun,
  FiGrid,
  FiLayers,
  FiActivity,
  FiShare2,
  FiFilter,
} from 'react-icons/fi';

// Widget type categories with nested options
export const CHART_CATEGORIES = [
  {
    category: 'Data',
    icon: FiTable,
    types: [
      { type: 'table', icon: FiTable, label: 'Table' },
      { type: 'metric', icon: FiHash, label: 'Metric Card' },
    ]
  },
  {
    category: 'Bar',
    icon: FiBarChart2,
    types: [
      { type: 'bar', icon: FiBarChart2, label: 'Vertical Bar' },
      { type: 'horizontal-bar', icon: FiAlignLeft, label: 'Horizontal Bar' },
      { type: 'diverging-bar', icon: FiMinusCircle, label: 'Diverging Bar' },
    ]
  },
  {
    category: 'Line',
    icon: FiTrendingUp,
    types: [
      { type: 'line', icon: FiTrendingUp, label: 'Line' },
      { type: 'area', icon: FiTrendingUp, label: 'Area' },
    ]
  },
  {
    category: 'Circular',
    icon: FiPieChart,
    types: [
      { type: 'pie', icon: FiPieChart, label: 'Pie' },
      { type: 'donut', icon: FiDisc, label: 'Donut' },
      { type: 'radial', icon: FiSun, label: 'Radial' },
    ]
  },
  {
    category: 'Hierarchy',
    icon: FiGrid,
    types: [
      { type: 'treemap', icon: FiGrid, label: 'Treemap' },
      { type: 'icicle', icon: FiLayers, label: 'Icicle' },
    ]
  },
 
  {
    category: 'Flow',
    icon: FiShare2,
    types: [
      { type: 'sankey', icon: FiShare2, label: 'Sankey' },
      { type: 'funnel', icon: FiFilter, label: 'Funnel' },
    ]
  },
 
];

// Flat list for lookups
export const WIDGET_TYPES = CHART_CATEGORIES.flatMap(cat => cat.types);

// Helper to get current chart category
export const getChartCategory = (type) => {
  return CHART_CATEGORIES.find(cat => cat.types.some(t => t.type === type));
};
