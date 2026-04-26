/**
 * Multi-format response formatter for API endpoints.
 *
 * Supports: json, csv, ndjson, parquet, excel, sse
 * Callers pick format via the Accept header (standard HTTP content negotiation).
 *
 * File formats (csv, parquet, excel) automatically split into a zip archive
 * when the row count exceeds FILE_CHUNK_SIZE (500 000 rows).
 */

import { PassThrough } from 'stream';
import archiver from 'archiver';

const FILE_CHUNK_SIZE = 500_000;

const ACCEPT_MAP = {
  'application/json':            'json',
  'text/csv':                    'csv',
  'application/x-ndjson':        'ndjson',
  'application/vnd.apache.parquet': 'parquet',
  'application/octet-stream':    'parquet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.ms-excel':    'excel',
  'text/event-stream':           'sse',
};

const SUPPORTED_ACCEPT_TYPES = Object.keys(ACCEPT_MAP);

/**
 * Resolve the response format from the request's Accept header.
 * Falls back to 'json' when Accept is missing, wildcard, or application/json.
 *
 * @param {import('express').Request} req
 * @returns {string} one of: json, csv, ndjson, parquet, excel, sse
 * @throws 406 if the Accept header requests an unsupported type
 */
export function resolveFormat(req) {
  const accept = req.headers['accept'] || req.headers['Accept'] || '';

  if (!accept || accept === '*/*' || accept === 'application/json') {
    return 'json';
  }

  const types = accept.split(',').map(t => t.split(';')[0].trim().toLowerCase());

  for (const type of types) {
    if (type === '*/*') return 'json';
    if (ACCEPT_MAP[type]) return ACCEPT_MAP[type];
  }

  throw Object.assign(
    new Error(
      `Not Acceptable. Supported types: ${SUPPORTED_ACCEPT_TYPES.join(', ')}`,
    ),
    { statusCode: 406 },
  );
}

/**
 * Write the endpoint result to the Express response in the requested format.
 *
 * @param {import('express').Response} res
 * @param {{ data: object[], meta: object }} result
 * @param {string} format - one of SUPPORTED_FORMATS
 * @param {string} slug   - endpoint slug, used for filenames
 */
export async function formatResponse(res, result, format, slug) {
  const { data = [], meta = {} } = result;
  const filename = slug || 'data';

  switch (format) {
    case 'json':
      return sendJson(res, result);
    case 'csv':
      return data.length > FILE_CHUNK_SIZE
        ? sendZippedCsv(res, data, filename)
        : sendCsv(res, data, filename);
    case 'ndjson':
      return sendNdjson(res, data, meta);
    case 'parquet':
      return data.length > FILE_CHUNK_SIZE
        ? sendZippedParquet(res, data, filename)
        : sendParquet(res, data, filename);
    case 'excel':
      return data.length > FILE_CHUNK_SIZE
        ? sendZippedExcel(res, data, filename)
        : sendExcel(res, data, filename);
    case 'sse':
      return sendSse(res, data, meta);
    default:
      return sendJson(res, result);
  }
}

// ── Helpers ──────────────────────────────────────────────────

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ── JSON (default, streaming) ────────────────────────────────

function sendJson(res, result) {
  const { data = [], meta = {} } = result;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.write('{"data":[');

  for (let i = 0; i < data.length; i++) {
    if (i > 0) res.write(',');
    res.write(JSON.stringify(data[i]));
  }

  res.write('],"meta":');
  res.write(JSON.stringify(meta));
  res.write('}');
  res.end();
}

// ── CSV ──────────────────────────────────────────────────────

function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvString(rows, columns) {
  let csv = columns.map(escapeCsvField).join(',') + '\n';
  for (const row of rows) {
    csv += columns.map(col => escapeCsvField(row[col])).join(',') + '\n';
  }
  return csv;
}

function sendCsv(res, rows, filename) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

  if (rows.length === 0) {
    res.end('');
    return;
  }

  const columns = Object.keys(rows[0]);
  res.write(columns.map(escapeCsvField).join(',') + '\n');

  for (const row of rows) {
    res.write(columns.map(col => escapeCsvField(row[col])).join(',') + '\n');
  }
  res.end();
}

function sendZippedCsv(res, rows, slug) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  const columns = Object.keys(rows[0]);
  const chunks = chunkArray(rows, FILE_CHUNK_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    const name = `${slug}-${i + 1}.csv`;
    archive.append(buildCsvString(chunks[i], columns), { name });
  }

  archive.finalize();
}

// ── NDJSON ───────────────────────────────────────────────────

function sendNdjson(res, rows, meta) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');

  res.write(JSON.stringify({ __meta: true, ...meta }) + '\n');

  for (const row of rows) {
    res.write(JSON.stringify(row) + '\n');
  }
  res.end();
}

// ── Parquet ──────────────────────────────────────────────────

async function buildParquetBuffer(rows, columns) {
  const parquet = await import('parquetjs-lite');
  const { ParquetSchema, ParquetWriter } = parquet.default || parquet;

  const schemaDef = {};
  for (const col of columns) {
    schemaDef[col] = { type: inferParquetTypeForColumn(rows, col), optional: true };
  }

  const schema = new ParquetSchema(schemaDef);

  const outputStream = new PassThrough();
  const bufferChunks = [];
  outputStream.on('data', chunk => bufferChunks.push(chunk));

  const writer = await ParquetWriter.openStream(schema, outputStream);

  for (const row of rows) {
    const cleanRow = {};
    for (const col of columns) {
      const val = row[col];
      if (val !== null && val !== undefined) {
        cleanRow[col] = val;
      }
    }
    await writer.appendRow(cleanRow);
  }

  await writer.close();
  return Buffer.concat(bufferChunks);
}

async function sendParquet(res, rows, filename) {
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.parquet"`);

  if (rows.length === 0) {
    res.status(204).end();
    return;
  }

  const columns = Object.keys(rows[0]);
  const buffer = await buildParquetBuffer(rows, columns);
  res.send(buffer);
}

async function sendZippedParquet(res, rows, slug) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  const columns = Object.keys(rows[0]);
  const chunks = chunkArray(rows, FILE_CHUNK_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    const buffer = await buildParquetBuffer(chunks[i], columns);
    archive.append(buffer, { name: `${slug}-${i + 1}.parquet` });
  }

  archive.finalize();
}

function inferParquetTypeForColumn(rows, col) {
  let hasFloat = false;
  let hasInt = false;
  let hasBool = false;

  for (const row of rows) {
    const val = row[col];
    if (val === null || val === undefined) continue;
    if (typeof val === 'boolean') { hasBool = true; continue; }
    if (typeof val === 'number') {
      if (Number.isInteger(val)) hasInt = true;
      else hasFloat = true;
    }
  }

  if (hasBool && !hasFloat && !hasInt) return 'BOOLEAN';
  if (hasFloat) return 'DOUBLE';
  if (hasInt) return 'INT64';
  return 'UTF8';
}

// ── Excel ────────────────────────────────────────────────────

async function buildExcelBuffer(rows, columns) {
  const ExcelJS = await import('exceljs');
  const Workbook = ExcelJS.default?.Workbook || ExcelJS.Workbook;
  const wb = new Workbook();
  const ws = wb.addWorksheet('Data');

  ws.columns = columns.map(col => ({ header: col, key: col, width: 18 }));
  for (const row of rows) {
    ws.addRow(row);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function sendExcel(res, rows, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);

  if (rows.length === 0) {
    const ExcelJS = await import('exceljs');
    const Workbook = ExcelJS.default?.Workbook || ExcelJS.Workbook;
    const wb = new Workbook();
    wb.addWorksheet('Data');
    const buffer = await wb.xlsx.writeBuffer();
    res.send(Buffer.from(buffer));
    return;
  }

  const columns = Object.keys(rows[0]);
  const buffer = await buildExcelBuffer(rows, columns);
  res.send(buffer);
}

async function sendZippedExcel(res, rows, slug) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  const columns = Object.keys(rows[0]);
  const chunks = chunkArray(rows, FILE_CHUNK_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    const buffer = await buildExcelBuffer(chunks[i], columns);
    archive.append(buffer, { name: `${slug}-${i + 1}.xlsx` });
  }

  archive.finalize();
}

// ── SSE (Server-Sent Events) ─────────────────────────────────

function sendSse(res, rows, meta) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`event: meta\ndata: ${JSON.stringify(meta)}\n\n`);

  for (const row of rows) {
    res.write(`event: row\ndata: ${JSON.stringify(row)}\n\n`);
  }

  res.write(`event: done\ndata: {}\n\n`);
  res.end();
}

export default { resolveFormat, formatResponse };
