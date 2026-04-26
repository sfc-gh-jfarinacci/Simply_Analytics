/**
 * Dashboard AI — validation & normalization
 *
 * Ensures AI-generated YAML structures conform to the expected schema
 * with proper defaults, valid chart types, and correct field shapes.
 */

export const VALID_WIDGET_TYPES = [
  'bar', 'stacked-bar', 'horizontal-bar', 'diverging-bar',
  'line', 'multiline', 'area',
  'pie', 'donut', 'radial',
  'treemap', 'icicle', 'sankey', 'funnel',
  'waterfall', 'scatter', 'boxplot',
  'heatmap', 'histogram', 'radar', 'gauge',
  'table', 'pivot', 'metric',
  'choropleth', 'hexbin',
];

export function validateAndNormalizeWidget(widget) {
  if (!widget || typeof widget !== 'object') {
    throw new Error('AI returned invalid widget structure');
  }

  if (!widget.id) {
    widget.id = `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }
  if (!widget.title) widget.title = 'Untitled Widget';
  if (!widget.type || !VALID_WIDGET_TYPES.includes(widget.type)) {
    widget.type = 'bar';
  }
  if (!Array.isArray(widget.fields)) widget.fields = [];
  if (!widget.position) {
    widget.position = { x: 0, y: 0, w: 6, h: 4, minW: 2, minH: 2 };
  } else {
    widget.position.minW = widget.position.minW || 2;
    widget.position.minH = widget.position.minH || 2;
  }
  if (!widget.config) {
    widget.config = {
      showTitle: true,
      titlePosition: 'top-left',
      colorScheme: 'tableau10',
      sorts: [],
      columnAliases: {},
      fieldAggregations: {},
    };
  }
  if (!Array.isArray(widget.filtersApplied)) widget.filtersApplied = [];
  if (!Array.isArray(widget.sortsApplied)) widget.sortsApplied = [];
  if (!Array.isArray(widget.customColumns)) widget.customColumns = [];
  if (!widget.marks) widget.marks = {};
  if (!widget.chartQuery) widget.chartQuery = {};

  if (!widget.semanticViewsReferenced || widget.semanticViewsReferenced.length === 0) {
    if (widget.semanticView) {
      const fqn = widget.semanticView;
      const name = fqn.includes('.') ? fqn.split('.').pop() : fqn;
      widget.semanticViewsReferenced = [{ name, fullyQualifiedName: fqn }];
    } else {
      widget.semanticViewsReferenced = [];
    }
  }

  for (const field of widget.fields) {
    if (!field.shelf) field.shelf = 'columns';
    if (!field.semanticType) field.semanticType = 'dimension';
    if (!field.dataType) field.dataType = 'VARCHAR';
    if (field.isCustomColumn === undefined) field.isCustomColumn = false;
  }

  return widget;
}

export function validateAndNormalizeDashboard(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI returned invalid YAML structure');
  }

  if (!parsed.tabs || !Array.isArray(parsed.tabs)) {
    parsed.tabs = [{
      id: 'tab-1',
      title: 'Sheet 1',
      widgets: parsed.widgets || [],
    }];
    delete parsed.widgets;
  }

  for (const tab of parsed.tabs) {
    if (!tab.id) tab.id = `tab-${Date.now()}`;
    if (!tab.title) tab.title = 'Sheet 1';
    if (!tab.widgets) tab.widgets = [];

    for (const widget of tab.widgets) {
      validateAndNormalizeWidget(widget);
    }
  }

  if (!parsed.filters) parsed.filters = [];
  if (!parsed.semanticViewsReferenced) {
    const viewSet = new Map();
    for (const tab of parsed.tabs) {
      for (const widget of tab.widgets) {
        for (const sv of (widget.semanticViewsReferenced || [])) {
          if (sv.fullyQualifiedName) {
            viewSet.set(sv.fullyQualifiedName, sv);
          }
        }
      }
    }
    parsed.semanticViewsReferenced = Array.from(viewSet.values());
  }

  if (!parsed.customColorSchemes) parsed.customColorSchemes = [];

  return parsed;
}
