import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const columns = 53;
const rows = 7;
const cellSize = 12;
const foodSize = 8;
const pitch = 16;
const marginX = 16;
const marginY = 16;
const width = 880;
const height = 144;
const bodyLength = 6;
const foodCount = 18;
const durationMs = 30000;
const outputDir = process.env.SNAKE_DIST_DIR || 'dist/snake';
const seed = process.env.SNAKE_SEED || `${Date.now()}-${Math.random()}`;

const themes = {
  light: {
    cell: '#ebedf0',
    cellStroke: '#d0d7de',
    food: ['#16a34a', '#22c55e', '#4ade80'],
    snake: ['#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e', '#083344'],
    eye: '#f8fafc',
  },
  dark: {
    cell: '#161b22',
    cellStroke: '#30363d',
    food: ['#16a34a', '#22c55e', '#4ade80'],
    snake: ['#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63'],
    eye: '#03151f',
  },
};

function hashSeed(value) {
  let hash = 1779033703 ^ value.length;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

function createRandom(seedValue) {
  const getHash = hashSeed(seedValue);
  let state = getHash();

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(seed);

function randomInt(max) {
  return Math.floor(random() * max);
}

function shuffle(items) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function key(point) {
  return `${point.x},${point.y}`;
}

function cellX(column) {
  return marginX + column * pitch;
}

function cellY(row) {
  return marginY + row * pitch;
}

function formatPercent(stepIndex, maxStepIndex) {
  if (maxStepIndex === 0) {
    return '100';
  }

  return ((stepIndex / maxStepIndex) * 100).toFixed(2);
}

function pickFoodCells(start) {
  const reserved = new Set();
  const food = [];

  for (let offset = 0; offset < bodyLength; offset += 1) {
    reserved.add(key({ x: start.x - offset, y: start.y }));
  }

  while (food.length < foodCount) {
    const point = {
      x: randomInt(columns),
      y: randomInt(rows),
    };
    const pointKey = key(point);

    if (!reserved.has(pointKey)) {
      reserved.add(pointKey);
      food.push(point);
    }
  }

  return food;
}

function walkAxis(route, current, target, axis) {
  const next = { ...current };
  const direction = Math.sign(target[axis] - next[axis]);

  while (next[axis] !== target[axis]) {
    next[axis] += direction;
    route.push({ ...next });
  }

  return next;
}

function buildRoute(start, targets) {
  let current = { x: start.x - (bodyLength - 1), y: start.y };
  const route = [{ ...current }];

  current = walkAxis(route, current, start, 'x');

  for (const target of targets) {
    if (random() > 0.5) {
      current = walkAxis(route, current, target, 'x');
      current = walkAxis(route, current, target, 'y');
    } else {
      current = walkAxis(route, current, target, 'y');
      current = walkAxis(route, current, target, 'x');
    }
  }

  return route;
}

function getDistance(first, second) {
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
}

function orderTargets(start, food) {
  const remaining = [...food];
  const targets = [];
  let current = start;

  while (remaining.length > 0) {
    remaining.sort((first, second) => getDistance(current, first) - getDistance(current, second));

    const pickIndex = randomInt(Math.min(4, remaining.length));
    const [target] = remaining.splice(pickIndex, 1);

    targets.push(target);
    current = target;
  }

  return targets;
}

function getStepByCell(route, headOffset) {
  const steps = new Map();

  route.forEach((point, index) => {
    const pointKey = key(point);
    const headStep = Math.max(0, index - headOffset);

    if (!steps.has(pointKey)) {
      steps.set(pointKey, headStep);
    }
  });

  return steps;
}

function createSegmentKeyframes(route, segmentIndex, headOffset) {
  const maxStepIndex = route.length - 1;
  const frames = route.map((_, stepIndex) => {
    const routeIndex = Math.min(route.length - 1, Math.max(0, stepIndex + headOffset - segmentIndex));
    const point = route[routeIndex];
    const x = cellX(point.x);
    const y = cellY(point.y);

    return `${formatPercent(stepIndex, maxStepIndex)}%{transform:translate(${x}px,${y}px)}`;
  });

  return `@keyframes snake-${segmentIndex}{${frames.join('')}}`;
}

function createFoodKeyframes(food, foodIndex, stepByCell, maxStepIndex) {
  const eatStep = stepByCell.get(key(food)) ?? maxStepIndex;
  const visibleUntil = formatPercent(Math.max(0, eatStep - 1), maxStepIndex);
  const hiddenFrom = formatPercent(eatStep, maxStepIndex);

  return `@keyframes food-${foodIndex}{0%,${visibleUntil}%{opacity:1}${hiddenFrom}%,100%{opacity:0}}`;
}

function renderSvg(themeName, route, food) {
  const theme = themes[themeName];
  const maxStepIndex = route.length - 1;
  const headOffset = bodyLength - 1;
  const stepByCell = getStepByCell(route, headOffset);
  const styleParts = [
    '.cell{shape-rendering:geometricPrecision}',
    `.cell{fill:${theme.cell};stroke:${theme.cellStroke};stroke-width:1px}`,
    `.food{shape-rendering:geometricPrecision;animation-duration:${durationMs}ms;animation-timing-function:steps(1,end);animation-iteration-count:infinite}`,
    `.snake{shape-rendering:geometricPrecision;animation-duration:${durationMs}ms;animation-timing-function:linear;animation-iteration-count:infinite}`,
    ...route.slice(0, bodyLength).map((_, index) => createSegmentKeyframes(route, index, headOffset)),
    ...food.map((point, index) => createFoodKeyframes(point, index, stepByCell, maxStepIndex)),
    '@media (prefers-reduced-motion: reduce){.snake,.food{animation-play-state:paused}}',
  ];
  const cells = [];
  const foods = food.map((point, index) => {
    const color = theme.food[index % theme.food.length];
    const x = cellX(point.x) + (cellSize - foodSize) / 2;
    const y = cellY(point.y) + (cellSize - foodSize) / 2;

    return `<rect class="food food-${index}" x="${x}" y="${y}" width="${foodSize}" height="${foodSize}" rx="2" fill="${color}" style="animation-name:food-${index}"/>`;
  });
  const segments = [];

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      cells.push(
        `<rect class="cell" x="${cellX(column)}" y="${cellY(row)}" width="${cellSize}" height="${cellSize}" rx="2"/>`,
      );
    }
  }

  for (let index = bodyLength - 1; index >= 1; index -= 1) {
    const size = cellSize - Math.min(index, 4);
    const inset = (cellSize - size) / 2;
    segments.push(
      `<rect class="snake snake-${index}" x="${inset}" y="${inset}" width="${size}" height="${size}" rx="4" fill="${theme.snake[index]}" style="animation-name:snake-${index}"/>`,
    );
  }

  segments.push(
    [
      `<g class="snake snake-0" style="animation-name:snake-0">`,
      `<rect x="-1" y="-1" width="${cellSize + 2}" height="${cellSize + 2}" rx="5" fill="${theme.snake[0]}"/>`,
      `<circle cx="8.4" cy="3.8" r="1.2" fill="${theme.eye}"/>`,
      `<circle cx="8.4" cy="8.2" r="1.2" fill="${theme.eye}"/>`,
      '</g>',
    ].join(''),
  );

  return [
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">`,
    '<title id="title">Random GitHub snake animation</title>',
    '<desc id="desc">A custom animated snake eats randomly generated green cells.</desc>',
    `<style>${styleParts.join('')}</style>`,
    ...cells,
    ...foods,
    ...segments,
    '</svg>',
    '',
  ].join('');
}

const start = { x: bodyLength, y: 3 };
const food = pickFoodCells(start);
const route = buildRoute(start, orderTargets(start, food));

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'light.svg'), renderSvg('light', route, food));
writeFileSync(join(outputDir, 'dark.svg'), renderSvg('dark', route, food));
