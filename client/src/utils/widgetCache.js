// Simple in-memory cache for widget query results
const queryCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const getCacheKey = (semanticView, dimensions, measures, filters = [], sorts = [], customColumns = []) => {
  return JSON.stringify({ 
    semanticView, 
    dimensions: dimensions.sort(), 
    measures: measures.sort(),
    filters: filters.map(f => ({ field: f.field, values: (f.values || []).sort() })),
    sorts: sorts.map(s => ({ field: s.field, direction: s.direction })),
    customColumns: customColumns.map(c => ({ name: c.name, expression: c.expression }))
  });
};

export const getCachedResult = (key) => {
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  queryCache.delete(key);
  return null;
};

export const setCachedResult = (key, data) => {
  queryCache.set(key, { data, timestamp: Date.now() });
};

export const clearWidgetCache = () => {
  queryCache.clear();
};

export const invalidateCacheForView = (semanticViewFQN) => {
  for (const [key] of queryCache) {
    if (key.includes(semanticViewFQN)) {
      queryCache.delete(key);
    }
  }
};
