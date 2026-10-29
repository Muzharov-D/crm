/**
 * Three-way merge of a KV value, so several people saving at once don't
 * erase each other. The app writes whole collections (every deal in one
 * value); without this, the last save wins and drops whatever anyone else
 * changed since that person loaded the page.
 *
 *   base    what this client last read or wrote for the key (null if unknown)
 *   mine    what it is saving now
 *   theirs  what the server holds
 *
 * Collections (arrays of records with an `id`) merge record by record:
 * a record only one side touched takes that side's version; one both
 * touched takes the newer `updatedAt` (mine on a tie); additions from
 * either side stay; a record survives a delete only if the other side
 * edited it since. Objects (settings) merge field by field the same way.
 * Anything else: mine, unless only theirs changed.
 */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const isCollection = (v) => Array.isArray(v) && v.every((r) => r && typeof r === 'object' && 'id' in r);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function pickRecord(base, mine, theirs) {
  const mineChanged = !same(mine, base);
  const theirsChanged = !same(theirs, base);
  if (!theirsChanged) return mine;
  if (!mineChanged) return theirs;
  return Number(theirs?.updatedAt) > Number(mine?.updatedAt) ? theirs : mine;
}

function mergeCollections(base, mine, theirs) {
  const byId = (list) => new Map((list || []).map((r) => [r.id, r]));
  const b = base ? byId(base) : null;
  const m = byId(mine);
  const t = byId(theirs);
  const out = [];
  const seen = new Set();

  // Mine first, in my order: the person saving sees their list as they left it.
  for (const [id, rec] of m) {
    seen.add(id);
    if (t.has(id)) {
      out.push(b?.has(id) ? pickRecord(b.get(id), rec, t.get(id)) : pickRecord(undefined, rec, t.get(id)));
    } else if (b?.has(id)) {
      // Deleted on the server since I loaded it: stays deleted unless I edited it.
      if (!same(rec, b.get(id))) out.push(rec);
    } else {
      out.push(rec);
    }
  }
  for (const [id, rec] of t) {
    if (seen.has(id)) continue;
    // Added by someone else: keep. Present in my base but gone from mine: I
    // deleted it, unless someone else edited it since.
    if (!b) out.push(rec);
    else if (!b.has(id) || !same(rec, b.get(id))) out.push(rec);
  }
  return out;
}

function mergeObjects(base, mine, theirs) {
  const out = { ...theirs };
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const bv = base?.[key];
    const mv = mine[key];
    const tv = theirs[key];
    if (!(key in mine)) {
      if (base && key in base && same(tv, bv)) delete out[key];
      continue;
    }
    if (!base || !same(mv, bv) || same(tv, bv)) out[key] = mv;
  }
  return out;
}

/** Values are the JSON text the app stores; returns the text to store. */
export function mergeValue(baseText, mineText, theirsText) {
  if (theirsText === null || theirsText === undefined) return mineText;
  if (theirsText === mineText) return mineText;
  if (baseText !== null && baseText !== undefined && theirsText === baseText) return mineText;
  let base, mine, theirs;
  try {
    mine = JSON.parse(mineText);
    theirs = JSON.parse(theirsText);
    base = baseText === null || baseText === undefined ? null : JSON.parse(baseText);
  } catch {
    return mineText;
  }
  if (isCollection(mine) && isCollection(theirs) && (base === null || isCollection(base))) {
    return JSON.stringify(mergeCollections(base, mine, theirs));
  }
  if (isPlainObject(mine) && isPlainObject(theirs) && (base === null || isPlainObject(base))) {
    return JSON.stringify(mergeObjects(base, mine, theirs));
  }
  if (base !== null && same(mine, base)) return theirsText;
  return mineText;
}
