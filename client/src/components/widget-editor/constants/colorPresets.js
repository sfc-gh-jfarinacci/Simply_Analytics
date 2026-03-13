/**
 * Color schemes and formatting options
 */
import * as d3 from 'd3';

// Color presets using D3 color schemes
// Types:
// - Categorical: Distinct colors for different categories
// - Sequential: Light→Dark gradients for showing magnitude (single or multi-hue)
// - Diverging: Two colors with neutral midpoint (for above/below comparisons)
export const COLOR_PRESETS = [
  // Categorical - distinct colors for different categories
  { name: 'Tableau', schemeKey: 'tableau10', type: 'categorical', colors: d3.schemeTableau10 },
  { name: 'Vivid', schemeKey: 'category10', type: 'categorical', colors: d3.schemeCategory10 },
  { name: 'Bold', schemeKey: 'set1', type: 'categorical', colors: d3.schemeSet1 },
  { name: 'Pastel', schemeKey: 'pastel1', type: 'categorical', colors: d3.schemePastel1 },
  { name: 'Muted', schemeKey: 'set2', type: 'categorical', colors: d3.schemeSet2 },
  { name: 'Paired', schemeKey: 'paired', type: 'categorical', colors: d3.schemePaired },
  
  // Sequential - light to dark gradients for showing magnitude/intensity
  { name: 'Blues', schemeKey: 'blues', type: 'sequential', colors: d3.quantize(d3.interpolateBlues, 8) },
  { name: 'Greens', schemeKey: 'greens', type: 'sequential', colors: d3.quantize(d3.interpolateGreens, 8) },
  { name: 'Oranges', schemeKey: 'oranges', type: 'sequential', colors: d3.quantize(d3.interpolateOranges, 8) },
  { name: 'Purples', schemeKey: 'purples', type: 'sequential', colors: d3.quantize(d3.interpolatePurples, 8) },
  { name: 'Reds', schemeKey: 'reds', type: 'sequential', colors: d3.quantize(d3.interpolateReds, 8) },
  { name: 'Viridis', schemeKey: 'viridis', type: 'sequential', colors: d3.quantize(d3.interpolateViridis, 8) },
  { name: 'Plasma', schemeKey: 'plasma', type: 'sequential', colors: d3.quantize(d3.interpolatePlasma, 8) },
  { name: 'Turbo', schemeKey: 'turbo', type: 'sequential', colors: d3.quantize(d3.interpolateTurbo, 8) },
  
  // Diverging - two colors with neutral midpoint (for positive/negative, above/below)
  { name: 'Red-Blue', schemeKey: 'rdBu', type: 'diverging', colors: d3.quantize(d3.interpolateRdBu, 9) },
  { name: 'Red-Yellow-Green', schemeKey: 'rdYlGn', type: 'diverging', colors: d3.quantize(d3.interpolateRdYlGn, 9) },
  { name: 'Purple-Green', schemeKey: 'prGn', type: 'diverging', colors: d3.quantize(d3.interpolatePRGn, 9) },
  { name: 'Pink-Green', schemeKey: 'piYG', type: 'diverging', colors: d3.quantize(d3.interpolatePiYG, 9) },
  { name: 'Brown-Teal', schemeKey: 'brBG', type: 'diverging', colors: d3.quantize(d3.interpolateBrBG, 9) },
  { name: 'Purple-Orange', schemeKey: 'puOr', type: 'diverging', colors: d3.quantize(d3.interpolatePuOr, 9) },
];

// Font size options
export const FONT_SIZES = [
  { label: 'XS', value: 10 },
  { label: 'S', value: 12 },
  { label: 'M', value: 14 },
  { label: 'L', value: 16 },
  { label: 'XL', value: 18 },
];

// Number format options
export const NUMBER_FORMATS = [
  { value: 'auto', label: 'Auto', example: '1,234.56' },
  { value: 'number', label: 'Number', example: '1234' },
  { value: 'decimal', label: 'Decimal', example: '1234.00' },
  { value: 'currency', label: 'Currency', example: '$1,234' },
  { value: 'percent', label: 'Percent', example: '12.34%' },
  { value: 'compact', label: 'Compact', example: '1.2K' },
];

// Decimal places options
export const DECIMAL_OPTIONS = [
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
];

// Text color options
export const TEXT_COLORS = [
  { name: 'Default', color: 'var(--text-primary)' },
  { name: 'Muted', color: 'var(--text-secondary)' },
  { name: 'White', color: '#ffffff' },
  { name: 'Cyan', color: '#00d4ff' },
  { name: 'Green', color: '#10b981' },
  { name: 'Orange', color: '#f59e0b' },
  { name: 'Pink', color: '#ec4899' },
];

// Label color options (for axis labels, legends)
export const LABEL_COLORS = [
  { name: 'Default', color: '#a0a0b0' },
  { name: 'Light', color: '#d0d0d8' },
  { name: 'White', color: '#ffffff' },
  { name: 'Cyan', color: '#00d4ff' },
  { name: 'Muted', color: '#6b7280' },
];
