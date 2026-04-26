import { parseColumnsToMetadata } from '../utils/parseColumnsToMetadata.js';

const VERBOSE = process.env.VERBOSE_LOGS === 'true';
const log = (...args) => VERBOSE && console.log('[MetadataCache]', ...args);

const cache = new Map();
const TTL = 10 * 60 * 1000; // 10 minutes

async function describeSemanticView(sfConn, viewFqn) {
  return new Promise((resolve, reject) => {
    sfConn.execute({
      sqlText: `DESCRIBE SEMANTIC VIEW ${viewFqn}`,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows || [])),
    });
  });
}

/**
 * Get semantic view metadata with in-memory caching.
 * First call per view fetches from Snowflake, subsequent calls within TTL return cached data.
 */
export async function getCachedMetadata(sfConn, viewFqn) {
  const entry = cache.get(viewFqn);
  if (entry && Date.now() - entry.timestamp < TTL) {
    log('Cache hit for', viewFqn);
    return entry.metadata;
  }

  log('Cache miss for', viewFqn, '— fetching from Snowflake');
  const rows = await describeSemanticView(sfConn, viewFqn);
  const metadata = parseColumnsToMetadata(rows);
  metadata.fullyQualifiedName = viewFqn;

  cache.set(viewFqn, { metadata, timestamp: Date.now() });
  return metadata;
}

/**
 * Get cached metadata for multiple views in parallel.
 */
export async function getCachedMetadataMulti(sfConn, viewFqns) {
  return Promise.all(viewFqns.map(fqn => getCachedMetadata(sfConn, fqn)));
}

export function invalidateCache(viewFqn) {
  if (viewFqn) {
    cache.delete(viewFqn);
  } else {
    cache.clear();
  }
}
