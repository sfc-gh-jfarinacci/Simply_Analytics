import { useState, useEffect, useRef } from 'react';
import yaml from 'js-yaml';

/**
 * @param {string} activeTab
 * @param {object} currentDashboard
 * @param {string} currentRole
 */
export function useYamlExport(activeTab, currentDashboard, currentRole) {
  const [yamlContent, setYamlContent] = useState('');
  const [yamlCopied, setYamlCopied] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [pendingYamlImport, setPendingYamlImport] = useState(null); // Stores parsed YAML until Save
  const fileInputRef = useRef(null);

  // Generate YAML string from dashboard object
  const generateYamlFromDashboard = (db) => {
      const indent = (level) => '  '.repeat(level);
      let yaml = '';

      // Version header
      yaml += `version: "1.0"\n\n`;

      // Dashboard metadata
      yaml += `# Dashboard: ${db.title || db.name || 'Untitled'}\n`;
      yaml += `# Generated: ${new Date().toISOString()}\n`;
      yaml += `# Note: This reflects the current state including unsaved changes\n\n`;

      yaml += `dashboard:\n`;
      yaml += `${indent(1)}id: ${db.id || 'new'}\n`;
      yaml += `${indent(1)}title: "${(db.title || db.name || '').replace(/"/g, '\\"')}"\n`;
      yaml += `${indent(1)}description: "${(db.description || '').replace(/"/g, '\\"')}"\n`;
      yaml += `${indent(1)}warehouse: ${db.warehouse || 'null'}\n`;
      yaml += `${indent(1)}isPublished: ${db.isPublished || false}\n`;
      yaml += `${indent(1)}ownerRole: ${db.ownerRole || db.owner_role || currentRole || 'null'}\n`;
      yaml += `${indent(1)}creator: ${db.creator || db.createdBy || currentRole || 'null'}\n`;
      yaml += `${indent(1)}lastUpdatedBy: ${db.lastUpdatedBy || db.last_updated_by || currentRole || 'null'}\n\n`;

      // Filters
      yaml += `${indent(1)}filters:\n`;
      if (db.filters && db.filters.length > 0) {
        db.filters.forEach((filter, i) => {
          yaml += `${indent(2)}- id: ${filter.id || `filter-${i}`}\n`;
          yaml += `${indent(3)}field: ${filter.field || ''}\n`;
          yaml += `${indent(3)}type: ${filter.type || 'select'}\n`;
        });
      } else {
        yaml += `${indent(2)}[] # No filters defined\n`;
      }
      yaml += '\n';

      // Semantic views referenced (dashboard level)
      yaml += `${indent(1)}semanticViewsReferenced:\n`;
      if (db.semanticViewsReferenced && db.semanticViewsReferenced.length > 0) {
        db.semanticViewsReferenced.forEach((view) => {
          const viewName = typeof view === 'string' ? view : view.name;
          const viewFqn = typeof view === 'object' ? view.fullyQualifiedName : null;
          const rawCalcFields = typeof view === 'object' ? view.calculatedFields : null;
          const calculatedFields = rawCalcFields?.map((cf) => (cf.id ? cf : { ...cf, id: crypto.randomUUID() })) || null;

          yaml += `${indent(2)}- name: "${viewName}"\n`;
          if (viewFqn) {
            yaml += `${indent(3)}fullyQualifiedName: "${viewFqn}"\n`;
          }

          // Calculated fields for this semantic view
          yaml += `${indent(3)}calculatedFields:\n`;
          if (calculatedFields && calculatedFields.length > 0) {
            calculatedFields.forEach((cf) => {
              yaml += `${indent(4)}- id: "${cf.id}"\n`;
              yaml += `${indent(5)}name: "${cf.name}"\n`;
              yaml += `${indent(5)}displayName: "${cf.displayName || cf.name}"\n`;
              yaml += `${indent(5)}expression: |\n`;
              const exprLines = cf.expression.split('\n');
              exprLines.forEach((line) => {
                yaml += `${indent(6)}${line}\n`;
              });
              if (cf.referencedFields?.length > 0) {
                yaml += `${indent(5)}referencedFields: [${cf.referencedFields.map((r) => `"${r}"`).join(', ')}]\n`;
              }
              if (cf.isAggregate != null) {
                yaml += `${indent(5)}isAggregate: ${cf.isAggregate}\n`;
              }
            });
          } else {
            yaml += `${indent(4)}[] # No calculated fields\n`;
          }

          // Column aliases for this semantic view
          const columnAliases = typeof view === 'object' ? view.columnAliases : null;
          yaml += `${indent(3)}columnAliases:\n`;
          if (columnAliases && Object.keys(columnAliases).length > 0) {
            Object.entries(columnAliases).forEach(([originalName, alias]) => {
              yaml += `${indent(4)}${originalName}: "${alias}"\n`;
            });
          } else {
            yaml += `${indent(4)}{} # No column aliases\n`;
          }
        });
      } else {
        yaml += `${indent(2)}[] # No semantic views referenced\n`;
      }
      yaml += '\n';

      // Custom Color Schemes
      yaml += `${indent(1)}customColorSchemes:\n`;
      if (db.customColorSchemes && db.customColorSchemes.length > 0) {
        db.customColorSchemes.forEach((scheme) => {
          yaml += `${indent(2)}- id: "${scheme.id}"\n`;
          yaml += `${indent(3)}name: "${(scheme.name || '').replace(/"/g, '\\"')}"\n`;
          yaml += `${indent(3)}type: ${scheme.type || 'categorical'}\n`;
          yaml += `${indent(3)}colors:\n`;
          if (scheme.colors && scheme.colors.length > 0) {
            scheme.colors.forEach((color) => {
              yaml += `${indent(4)}- "${color}"\n`;
            });
          } else {
            yaml += `${indent(4)}[]\n`;
          }
          if (scheme.createdAt) {
            yaml += `${indent(3)}createdAt: ${scheme.createdAt}\n`;
          }
          if (scheme.updatedAt) {
            yaml += `${indent(3)}updatedAt: ${scheme.updatedAt}\n`;
          }
        });
      } else {
        yaml += `${indent(2)}[] # No custom color schemes\n`;
      }
      yaml += '\n';

      // Tabs and widgets
      yaml += `${indent(1)}tabs:\n`;
      if (db.tabs && db.tabs.length > 0) {
        db.tabs.forEach((tab, tabIndex) => {
          yaml += `${indent(2)}- id: ${tab.id}\n`;
          yaml += `${indent(3)}title: "${(tab.title || `Tab ${tabIndex + 1}`).replace(/"/g, '\\"')}"\n`;
          yaml += `${indent(3)}tabColor: ${tab.backgroundColor || tab.tabColor || 'null'}\n`;
          yaml += `${indent(3)}canvasColor: ${tab.canvasColor || 'null'}\n`;
          yaml += `${indent(3)}widgets:\n`;

          if (tab.widgets && tab.widgets.length > 0) {
            tab.widgets.forEach((widget, widgetIndex) => {
              yaml += `${indent(4)}- id: ${widget.id}\n`;
              yaml += `${indent(5)}type: ${widget.type || 'chart'}\n`;
              yaml += `${indent(5)}title: "${(widget.title || '').replace(/"/g, '\\"')}"\n`;
              yaml += `${indent(5)}order: ${widgetIndex}\n`;

              // Semantic view
              const svName =
                widget.semanticView ||
                widget.semanticViewsReferenced?.[0]?.fullyQualifiedName ||
                widget.semanticViewsReferenced?.[0]?.name ||
                null;
              yaml += `${indent(5)}semanticView: ${svName ? `"${svName}"` : 'null'}\n`;

              // Creator and timestamps
              yaml += `${indent(5)}creator: ${widget.creator || widget.createdBy || db.creator || currentRole || 'null'}\n`;
              yaml += `${indent(5)}createdAt: ${widget.createdAt || 'null'}\n`;
              yaml += `${indent(5)}lastUpdatedBy: ${widget.lastUpdatedBy || db.lastUpdatedBy || currentRole || 'null'}\n`;
              yaml += `${indent(5)}lastUpdatedAt: ${widget.lastUpdatedAt || 'null'}\n`;

              // Position
              const posX = widget.x ?? widget.position?.x ?? 0;
              const posY = widget.y ?? widget.position?.y ?? 0;
              const posW = widget.width ?? widget.w ?? widget.position?.w ?? widget.size?.width ?? 4;
              const posH = widget.height ?? widget.h ?? widget.position?.h ?? widget.size?.height ?? 3;
              yaml += `${indent(5)}position:\n`;
              yaml += `${indent(6)}x: ${posX}\n`;
              yaml += `${indent(6)}y: ${posY}\n`;
              yaml += `${indent(6)}width: ${posW}\n`;
              yaml += `${indent(6)}height: ${posH}\n`;

              // Fields — the core widget definition (shelf assignments)
              yaml += `${indent(5)}fields:\n`;
              const fields = widget.fields || [];
              if (fields.length > 0) {
                fields.forEach((field) => {
                  yaml += `${indent(6)}- name: "${(typeof field === 'string' ? field : field.name || '').replace(/"/g, '\\"')}"\n`;
                  if (field.shelf) yaml += `${indent(7)}shelf: ${field.shelf}\n`;
                  if (field.semanticType) yaml += `${indent(7)}semanticType: ${field.semanticType}\n`;
                  if (field.markType) yaml += `${indent(7)}markType: ${field.markType}\n`;
                  if (field.aggregation) yaml += `${indent(7)}aggregation: ${field.aggregation}\n`;
                  if (field.sortDirection) yaml += `${indent(7)}sortDirection: ${field.sortDirection}\n`;
                });
              } else {
                yaml += `${indent(6)}[]\n`;
              }

              // Marks (color, detail, cluster, tooltip assignments)
              const marks = widget.marks || {};
              const markEntries = Object.entries(marks).filter(([, v]) => v != null);
              yaml += `${indent(5)}marks:\n`;
              if (markEntries.length > 0) {
                markEntries.forEach(([markType, fieldName]) => {
                  yaml += `${indent(6)}${markType}: "${fieldName}"\n`;
                });
              } else {
                yaml += `${indent(6)}{}\n`;
              }

              // Config — formatting, colors, display options
              yaml += `${indent(5)}config:\n`;
              const cfg = widget.config || {};
              const cfgEntries = Object.entries(cfg).filter(([, v]) => v != null && v !== '');
              if (cfgEntries.length > 0) {
                cfgEntries.forEach(([key, val]) => {
                  if (Array.isArray(val)) {
                    yaml += `${indent(6)}${key}:\n`;
                    val.forEach((item) => {
                      yaml += `${indent(7)}- ${typeof item === 'string' ? `"${item}"` : item}\n`;
                    });
                  } else if (typeof val === 'object') {
                    yaml += `${indent(6)}${key}:\n`;
                    Object.entries(val).forEach(([k2, v2]) => {
                      if (v2 != null) yaml += `${indent(7)}${k2}: ${typeof v2 === 'string' ? `"${v2}"` : v2}\n`;
                    });
                  } else {
                    yaml += `${indent(6)}${key}: ${typeof val === 'string' ? `"${val}"` : val}\n`;
                  }
                });
              } else {
                yaml += `${indent(6)}{}\n`;
              }

              // Custom columns — only IDs actually used by this widget's fields (+ transitive refs)
              const allCustomCols = widget.customColumns || [];
              const widgetFieldNames = new Set(
                (widget.fields || []).map((f) => (typeof f === 'string' ? f : f.name || '').toUpperCase())
              );
              const calcByName = new Map(allCustomCols.map((cc) => [cc.name.toUpperCase(), cc]));
              const usedNames = new Set();
              allCustomCols.forEach((cc) => {
                if (widgetFieldNames.has(cc.name.toUpperCase())) usedNames.add(cc.name.toUpperCase());
              });
              let didExpand = true;
              while (didExpand) {
                didExpand = false;
                for (const name of usedNames) {
                  const cc = calcByName.get(name);
                  if (!cc?.expression) continue;
                  for (const m of cc.expression.matchAll(/\[([^\]]+)\]/g)) {
                    const ref = m[1].toUpperCase();
                    if (calcByName.has(ref) && !usedNames.has(ref)) {
                      usedNames.add(ref);
                      didExpand = true;
                    }
                  }
                }
              }
              const usedCustomCols = allCustomCols.filter((cc) => usedNames.has(cc.name.toUpperCase()));
              yaml += `${indent(5)}customColumnIds:\n`;
              if (usedCustomCols.length > 0) {
                usedCustomCols.forEach((col) => {
                  yaml += `${indent(6)}- "${col.id}"\n`;
                });
              } else {
                yaml += `${indent(6)}[]\n`;
              }

              // Semantic views referenced
              yaml += `${indent(5)}semanticViewsReferenced:\n`;
              const semanticViews = widget.semanticViewsReferenced || [];
              if (semanticViews.length > 0) {
                semanticViews.forEach((view) => {
                  yaml += `${indent(6)}- name: "${view.name || view}"\n`;
                  if (view.fullyQualifiedName) {
                    yaml += `${indent(7)}fullyQualifiedName: "${view.fullyQualifiedName}"\n`;
                  }
                });
              } else {
                yaml += `${indent(6)}[]\n`;
              }

              // Filters applied
              yaml += `${indent(5)}filters:\n`;
              const filtersApplied = widget.filtersApplied || widget.filters || [];
              if (filtersApplied.length > 0) {
                filtersApplied.forEach((filter) => {
                  yaml += `${indent(6)}- field: "${filter.field}"\n`;
                  yaml += `${indent(7)}operator: "${filter.operator || '='}"\n`;
                  const fVal = Array.isArray(filter.value) ? filter.value.join(', ') : filter.value;
                  yaml += `${indent(7)}value: "${fVal ?? ''}"\n`;
                });
              } else {
                yaml += `${indent(6)}[]\n`;
              }

              // Sorts applied
              yaml += `${indent(5)}sorts:\n`;
              const sortsApplied = widget.sortsApplied || widget.sorts || [];
              if (sortsApplied.length > 0) {
                sortsApplied.forEach((sort) => {
                  yaml += `${indent(6)}- field: "${sort.field}"\n`;
                  yaml += `${indent(7)}direction: ${sort.direction || 'asc'}\n`;
                });
              } else {
                yaml += `${indent(6)}[]\n`;
              }

              // Query dimensions/measures (resolved field names for the query)
              const qDims = widget.queryDimensions || [];
              const qMeas = widget.queryMeasures || [];
              if (qDims.length > 0 || qMeas.length > 0) {
                yaml += `${indent(5)}queryDimensions: [${qDims.map((d) => `"${d}"`).join(', ')}]\n`;
                yaml += `${indent(5)}queryMeasures: [${qMeas.map((m) => `"${m}"`).join(', ')}]\n`;
              }
            });
          } else {
            yaml += `${indent(4)}[] # No widgets in this tab\n`;
          }
        });
      } else {
        yaml += `${indent(2)}[] # No tabs defined\n`;
      }

      return yaml;
  };

  // Watch for changes in tabs, widgets, and semantic views (including calculated fields)
  const currentTabs = currentDashboard?.tabs;
  const tabsJson = JSON.stringify(currentTabs);
  const semanticViewsJson = JSON.stringify(currentDashboard?.semanticViewsReferenced);
  useEffect(() => {
    if (activeTab === 'yaml' && currentDashboard) {
      const yamlData = generateYamlFromDashboard(currentDashboard);
      setYamlContent(yamlData);
    }
  }, [activeTab, currentDashboard, tabsJson, semanticViewsJson]);

  // Parse YAML content using js-yaml library — unified schema
  const parseYamlContent = (content) => {
    try {
      const parsed = yaml.load(content);

      if (!parsed) {
        throw new Error('Empty or invalid YAML content');
      }

      const dashboardData = parsed.dashboard || parsed;
      const semanticViewsReferenced = dashboardData.semanticViewsReferenced || [];

      // Build a lookup of calculated fields by ID from dashboard-level definitions
      const calcFieldsById = new Map();
      semanticViewsReferenced.forEach((sv) => {
        if (typeof sv === 'object' && sv.calculatedFields) {
          sv.calculatedFields.forEach((cf) => {
            if (cf.id) calcFieldsById.set(cf.id, cf);
          });
        }
      });

      // Map tabs — resolve customColumnIds → customColumns on each widget
      let tabs = dashboardData.tabs || [];
      tabs = tabs.map((tab) => ({
        ...tab,
        backgroundColor: tab.tabColor || tab.backgroundColor || null,
        widgets: (tab.widgets || []).map((w) => ({
          ...w,
          customColumns: (w.customColumnIds || w.customColumns || [])
            .map((ref) => (typeof ref === 'string' ? calcFieldsById.get(ref) : ref))
            .filter(Boolean),
        })),
      }));

      return {
        tabs,
        filters: dashboardData.filters || [],
        semanticViewsReferenced,
        customColorSchemes: dashboardData.customColorSchemes || [],
      };
    } catch (err) {
      console.error('YAML parse error:', err);
      throw new Error(`Failed to parse YAML: ${err.message}`);
    }
  };

  // Copy YAML to clipboard
  const handleCopyYaml = async () => {
    try {
      await navigator.clipboard.writeText(yamlContent);
      setYamlCopied(true);
      setTimeout(() => setYamlCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Download YAML file
  const handleDownloadYaml = () => {
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(currentDashboard?.title || currentDashboard?.name || 'dashboard').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Handle file upload
  const handleFileUpload = (event) => {
    event.preventDefault();
    event.stopPropagation();

    const file = event.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportSuccess(false);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result;
        if (typeof content !== 'string') {
          throw new Error('Invalid file content');
        }

        // Parse the YAML content using js-yaml
        const parsed = parseYamlContent(content);

        if (parsed) {
          // Store the parsed content locally - will be applied when Save is clicked
          const pendingUpdates = {};
          if (parsed.tabs && parsed.tabs.length > 0) {
            pendingUpdates.tabs = parsed.tabs;
          }
          if (parsed.filters) {
            pendingUpdates.filters = parsed.filters;
          }
          if (parsed.semanticViewsReferenced) {
            pendingUpdates.semanticViewsReferenced = parsed.semanticViewsReferenced;
          }
          if (Object.keys(pendingUpdates).length > 0) {
            setPendingYamlImport(pendingUpdates);
            setImportSuccess(true);
            // Don't auto-clear success message - user needs to see it until they save
          } else {
            setImportError('No valid dashboard content found in YAML file');
          }
        } else {
          setImportError('Failed to parse YAML or no dashboard loaded');
        }
      } catch (err) {
        console.error('YAML import error:', err);
        setImportError(err.message || 'Failed to parse YAML file');
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read file');
    };
    reader.readAsText(file);

    // Reset file input
    event.target.value = '';
  };

  return {
    yamlContent,
    yamlCopied,
    importError,
    importSuccess,
    pendingYamlImport,
    setPendingYamlImport,
    setImportSuccess,
    setImportError,
    fileInputRef,
    handleCopyYaml,
    handleDownloadYaml,
    handleFileUpload,
  };
}
