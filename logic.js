// Lógica pura del juego, sin DOM. `node logic.js` corre el self-check.
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0]; // dir: 0 arriba, 1 derecha, 2 abajo, 3 izquierda

function rng(seed) { // mulberry32: mismo nivel => mismo tablero en los dos teléfonos
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Curva de dificultad. Cada mundo arranca más liviano de lo que terminó el anterior y tiene tres desafíos
// (niveles 5, 10 y 15: 3 lugares en la parada). Acá están todas las perillas para ajustar.
const WORLD_LEN = 15; // niveles por mundo
function params(level) {
  const world = (level - 1) / WORLD_LEN | 0, step = (level - 1) % WORLD_LEN;
  const boss = step % 5 === 4;
  const n = 6 + (world > 0) + (world > 2);                                  // tablero 6 -> 7 (mundo 2) -> 8 (mundo 4)
  const docks = boss || world >= 4 ? 3 : 4;                                 // lugares en la parada
  const fill = Math.min(.5 + .012 * step + .03 * Math.min(world, 3), .66);  // qué tan lleno está el tablero
  // Mecánicas extra: en el mundo 1 aparecen de a una (niveles 4, 8 y 12); después están desde el principio.
  const late = world > 0;
  return {
    world, n, docks, boss,
    count: Math.round(n * n * fill / 2.5),
    colors: Math.min(5 + (step > 5 || world > 0), 6),
    window: Math.min(docks, step < 2 ? 3 : 4),                              // cuánto se mezcla la fila
    deep: Math.min(.3 + .04 * step + .1 * world, .9),                       // qué tan enterrado está lo que pide la fila (0 a 1)
    gates: late || step >= 3 ? Math.min(1 + (world >> 1) + (step > 9), 3) : 0,   // puentes levadizos
    counts: late || step >= 7 ? Math.min(1 + (world >> 2) + (step > 12), 2) : 0, // bloques con número
    hidden: late || step >= 11 ? Math.min(2 + world, 5) : 0,                     // piezas sorpresa
  };
}

// (x, y) es la celda superior-izquierda de la pieza
function cells(v) {
  return Array.from({ length: v.len }, (_, i) => v.dir % 2 ? [v.x + i, v.y] : [v.x, v.y + i]);
}

function path(v, n) { // celdas que la pieza tiene que recorrer para salir del tablero
  const out = [];
  let x = v.dir === 1 ? v.x + v.len : v.x + DX[v.dir];
  let y = v.dir === 2 ? v.y + v.len : v.y + DY[v.dir];
  for (; x >= 0 && y >= 0 && x < n && y < n; x += DX[v.dir], y += DY[v.dir]) out.push(x + ',' + y);
  return out;
}

// tiles: Map 'x,y' -> obstáculo que se abre jugando. Mientras está en el mapa, bloquea el paso.
//   { t: 'gate', color }  puente levadizo: se abre cuando sale del tablero una pieza de ese color
//   { t: 'count', n }     bloque con número: se rompe cuando salieron n piezas
// Un obstáculo fijo no serviría de nada: la pieza que lo mirase no podría salir nunca. Por eso todos se abren,
// y como salir solo abre cosas (nunca cierra), el tablero no puede quedar trabado.
function canExit(v, lot, n, tiles) {
  const occ = new Set(lot.filter(o => o !== v).flatMap(cells).map(String));
  return path(v, n).every(k => !occ.has(k) && !tiles.has(k));
}

function advance(tiles, v) { // la pieza v acaba de salir
  for (const [k, o] of tiles) if (o.t === 'gate' ? o.color === v.color : --o.n <= 0) tiles.delete(k);
}

// ¿Cada obstáculo llega a ser, en algún momento de la solución, lo ÚNICO que le impide salir a alguna pieza?
// Si no, se abre antes de molestar a nadie y es puro adorno.
function allUsed(lot, tiles, order, n) {
  const rest = [...lot], live = copyTiles(tiles), used = new Set();
  for (const v of order) {
    for (const k of live.keys()) if (!used.has(k)) {
      const without = new Map(live);
      without.delete(k);
      if (rest.some(o => !canExit(o, rest, n, live) && canExit(o, rest, n, without))) used.add(k);
    }
    rest.splice(rest.indexOf(v), 1);
    advance(live, v);
  }
  return used.size === tiles.size;
}

const copyTiles = tiles => new Map([...tiles].map(([k, o]) => [k, { ...o }]));

function makeLevel(level) {
  const p = params(level), n = p.n;
  for (let attempt = 0; ; attempt++) {
    const r = rng(level * 1000 + attempt), pick = k => r() * k | 0;
    const lot = [], occ = new Set();
    for (let tries = 0; lot.length < p.count && tries < 500; tries++) {
      const len = 2 + pick(2), dir = pick(4), h = dir % 2;
      const v = { len, dir, x: pick(h ? n - len + 1 : n), y: pick(h ? n : n - len + 1), color: pick(p.colors), cap: len * 2, filled: 0 };
      const cs = cells(v).map(String);
      if (cs.some(c => occ.has(c))) continue;
      cs.forEach(c => occ.add(c));
      lot.push(v);
    }
    if (lot.length < p.count) continue;

    // Cada obstáculo va sobre el camino de una pieza que, sin él, ya podría salir (una distinta por obstáculo):
    // así arranca frenando a alguien de verdad. Si no le corta el paso a nadie, es adorno.
    const tiles = new Map(), want = p.gates + p.counts;
    const open = lot.filter(v => canExit(v, lot, n, tiles));
    while (tiles.size < want && open.length) {
      const v = open.splice(pick(open.length), 1)[0], key = lot[pick(lot.length)];
      const free = path(v, n).filter(k => !tiles.has(k));
      if (!free.length || key === v) continue;
      tiles.set(free[pick(free.length)], tiles.size < p.gates ? { t: 'gate', color: key.color } : { t: 'count', n: 2 + pick(3) });
    }
    if (tiles.size < want) continue;

    // Salir nunca le cierra el paso a otra pieza, así que un greedy alcanza para saber si el tablero tiene salida.
    // Con probabilidad `deep` la solución sigue a la que se liberó última: así encadena piezas que se tapan entre sí.
    const order = [], rest = [...lot], live = copyTiles(tiles), born = new Map(); // born: en qué turno quedó libre cada pieza
    for (let free, turn = 0; (free = rest.filter(v => canExit(v, rest, n, live))).length; turn++) {
      for (const v of free) if (!born.has(v)) born.set(v, turn);
      const latest = Math.max(...free.map(v => born.get(v)));
      const pool = r() < p.deep ? free.filter(v => born.get(v) === latest) : free;
      const v = pool[pick(pool.length)];
      order.push(v);
      rest.splice(rest.indexOf(v), 1);
      advance(live, v);
    }
    if (rest.length || !allUsed(lot, tiles, order, n)) continue;

    // Sorpresa: piezas que arrancan tapadas y no muestran su color hasta que quedan libres
    const buried = lot.filter(v => born.get(v) > 0);
    for (let i = 0; i < p.hidden && buried.length; i++) buried.splice(pick(buried.length), 1)[0].hidden = true;

    // La fila se arma mezclando pasajeros por ventanas de la solución: ventana <= lugares garantiza que se puede ganar.
    const queue = [];
    for (let i = 0; i < order.length; i += p.window) {
      // A veces la ventana va al revés sin mezclar: primero piden subir los de la pieza más tapada,
      // y hay que estacionar a todas las que la tapan antes de que suba nadie.
      const dig = r() < p.deep / 2;
      const group = order.slice(i, i + p.window);
      const chunk = (dig ? group.reverse() : group).flatMap(v => Array(v.cap).fill(v.color));
      if (!dig) for (let j = chunk.length - 1; j > 0; j--) { const k = pick(j + 1); [chunk[j], chunk[k]] = [chunk[k], chunk[j]]; }
      queue.push(...chunk);
    }
    return { ...p, lot, queue, tiles, solution: order };
  }
}

// Estado: { n, tiles, lot, dock, queue }. dock tiene lugares fijos (null = libre) para que nada salte de lugar.
const newState = L => ({ n: L.n, tiles: copyTiles(L.tiles), lot: [...L.lot], queue: [...L.queue], dock: Array(L.docks).fill(null) });

function exit(s, v) {
  const slot = s.dock.indexOf(null);
  if (slot < 0 || !canExit(v, s.lot, s.n, s.tiles)) return false;
  s.lot.splice(s.lot.indexOf(v), 1);
  s.dock[slot] = v;
  advance(s.tiles, v);
  return true;
}

function boardNext(s) { // sube al pasajero del frente si hay una pieza de su color; devuelve { v, slot } o null
  const slot = s.dock.findIndex(v => v && v.color === s.queue[0]);
  if (slot < 0) return null;
  const v = s.dock[slot];
  s.queue.shift();
  if (++v.filled === v.cap) s.dock[slot] = null; // llena: se va
  return { v, slot };
}

const won = s => !s.queue.length;
const lost = s => !s.dock.includes(null) && !s.dock.some(v => v.color === s.queue[0]);

if (typeof module !== 'undefined' && require.main === module) {
  const assert = require('assert');
  let tiles = 0;
  for (let level = 1; level <= 300; level++) {
    const t0 = Date.now(), L = makeLevel(level), s = newState(L);
    assert(Date.now() - t0 < 500, `nivel ${level}: tarda demasiado en generarse`); // en un teléfono sería una pantalla congelada
    assert(L.window <= L.docks, `nivel ${level}: ventana mayor que la parada`);
    assert(L.tiles.size === L.gates + L.counts, `nivel ${level}: faltan obstáculos`);
    assert(allUsed(L.lot, L.tiles, L.solution, L.n), `nivel ${level}: hay un obstáculo de adorno`);
    tiles += L.tiles.size;
    for (const v of L.solution) {
      while (boardNext(s));
      assert(!lost(s) && exit(s, v), `nivel ${level}: la solución no puede sacar una pieza`);
    }
    while (boardNext(s));
    assert(won(s) && !s.lot.length && s.dock.every(v => !v), `nivel ${level}: no se gana siguiendo la solución`);
    assert(!s.tiles.size, `nivel ${level}: quedó un obstáculo sin abrir`);
  }
  console.log(`ok: 300 niveles generados y resueltos; ${tiles} obstáculos y todos frenan a alguna pieza`);
}
