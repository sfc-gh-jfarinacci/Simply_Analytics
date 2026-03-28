import {
  FiBarChart2, FiAlignLeft, FiColumns, FiMinusCircle,
  FiTrendingUp, FiActivity, FiPieChart, FiDisc, FiSun,
  FiGrid, FiLayers, FiShare2, FiTable, FiHash, FiType,
} from 'react-icons/fi';

export const LAYOUT_MODES = {
  ADAPTIVE: 'adaptive',
  FIXED: 'fixed',
};

export const WIDGET_TYPES = [
  { type: 'bar', icon: FiBarChart2, label: 'Bar', category: 'chart' },
  { type: 'horizontal-bar', icon: FiAlignLeft, label: 'Horizontal Bar', category: 'chart' },
  { type: 'stacked-bar', icon: FiColumns, label: 'Stacked Bar', category: 'chart' },
  { type: 'diverging-bar', icon: FiMinusCircle, label: 'Diverging Bar', category: 'chart' },
  { type: 'line', icon: FiTrendingUp, label: 'Line', category: 'chart' },
  { type: 'multiline', icon: FiActivity, label: 'Multiline', category: 'chart' },
  { type: 'area', icon: FiTrendingUp, label: 'Area', category: 'chart' },
  { type: 'pie', icon: FiPieChart, label: 'Pie', category: 'circular' },
  { type: 'donut', icon: FiDisc, label: 'Donut', category: 'circular' },
  { type: 'radial', icon: FiSun, label: 'Radial', category: 'circular' },
  { type: 'treemap', icon: FiGrid, label: 'Treemap', category: 'comparison' },
  { type: 'icicle', icon: FiLayers, label: 'Icicle', category: 'comparison' },
  { type: 'sankey', icon: FiShare2, label: 'Sankey', category: 'comparison' },
  { type: 'table', icon: FiTable, label: 'Table', category: 'data' },
  { type: 'metric', icon: FiHash, label: 'Metric', category: 'data' },
  { type: 'title', icon: FiType, label: 'Title', category: 'layout' },
];
