import type { Command } from '@lifo-sh/core';

// Steam Locomotive - based on sl by Toyoda Masashi (mtoyoda/sl)
// https://github.com/mtoyoda/sl

const CSI = '\x1b[';
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const ALT_SCREEN_ON = `${CSI}?1049h`;
const ALT_SCREEN_OFF = `${CSI}?1049l`;
const CLEAR = `${CSI}2J`;
const HOME = `${CSI}H`;

function moveTo(row: number, col: number): string {
  return `${CSI}${row + 1};${col + 1}H`;
}

// ─── D51 locomotive body (static part) ───

const D51BODY = [
  '      ====        ________                ___________ ',
  '  _D _|  |_______/        \\__I_I_____===__|_________|',
  '   |(_)---  |   H\\________/ |   |        =|___ ___|  ',
  '   /     |  |   H  |  |     |   |         ||_| |_||  ',
  '  |      |  |   H  |__--------------------| [___] |  ',
  '  | ________|___H__/__|_____/[][]~\\_______|       |  ',
  '  |/ |   |-----------I_____I [][] []  D   |=======|__',
];

// ─── Wheel frames (6 patterns) ───

const D51WHEELS = [
  [
    '__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__',
    ' |/-=|___|=    ||    ||    ||    |_____/~\\___/       ',
    '  \\_/      \\O=====O=====O=====O_/      \\_/          ',
  ],
  [
    '__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__',
    ' |/-=|___|=O=====O=====O=====O   |_____/~\\___/       ',
    '  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/          ',
  ],
  [
    '__/ =| o |=-O=====O=====O=====O \\ ____Y___________|__',
    ' |/-=|___|=    ||    ||    ||    |_____/~\\___/       ',
    '  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/          ',
  ],
  [
    '__/ =| o |=-~O=====O=====O=====O\\ ____Y___________|__',
    ' |/-=|___|=    ||    ||    ||    |_____/~\\___/       ',
    '  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/          ',
  ],
  [
    '__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__',
    ' |/-=|___|=   O=====O=====O=====O|_____/~\\___/       ',
    '  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/          ',
  ],
  [
    '__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__',
    ' |/-=|___|=    ||    ||    ||    |_____/~\\___/       ',
    '  \\_/      \\_O=====O=====O=====O/      \\_/          ',
  ],
];

// ─── Coal tender ───

const COAL = [
  '                              ',
  '                              ',
  '    _________________         ',
  '   _|                \\_____A  ',
  ' =|                        |  ',
  ' -|                        |  ',
  '__|________________________|_ ',
  '|__________________________|_ ',
  '   |_D__D__D_|  |_D__D__D_|  ',
  '    \\_/   \\_/    \\_/   \\_/   ',
];

const D51HEIGHT = 10;
const D51FUNNEL = 7;
const D51LENGTH = 53;
const COAL_LENGTH = 30;
const PATTERNS = 6;

// ─── Smoke ───

const SMOKEPTNS = 8;

const smokeA = [
  '(   )', '(    )', '(   )', '(  )',
  '( )',   '()',     'O',     ' ',
];

const smokeB = [
  '(@@@)', '(@@@@)', '(@@@)', '(@@)',
  '(@)',   '@@',     '@',     ' ',
];

const dy = [2, 1, 1, 1, 0, 0, 0, 0];
const dx = [-2, -1, 0, 1, 1, 2, 2, 3];

interface SmokeParticle {
  y: number;
  x: number;
  prevY: number;
  prevX: number;
  prevLen: number;
  age: number;
  kind: number; // 0 or 1
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const command: Command = async (ctx) => {
  const cols = parseInt(ctx.env['COLUMNS'] || '80', 10);
  const rows = parseInt(ctx.env['LINES'] || '24', 10);

  const midRow = Math.max(0, Math.floor((rows - D51HEIGHT) / 2));

  const smoke: SmokeParticle[] = [];
  let smokeCounter = 0;

  // Switch to alternate screen buffer so terminal history is untouched
  ctx.stdout.write(ALT_SCREEN_ON + CLEAR + HOME + HIDE_CURSOR);

  // Train width is body + space + coal
  const trainWidth = D51LENGTH + 1 + COAL_LENGTH;

  // Helper to erase a smoke particle's previous drawn position
  function eraseSmoke(f: string, py: number, px: number, plen: number): string {
    const col = px - Math.floor(plen / 2);
    const startCol = Math.max(0, col);
    const clearLen = Math.min(plen + 1, cols - startCol);
    if (py >= 0 && py < rows && startCol < cols && clearLen > 0) {
      f += moveTo(py, startCol) + ' '.repeat(clearLen);
    }
    return f;
  }

  for (let x = cols - 1; ; x--) {
    if (ctx.signal.aborted) break;
    // Exit once train is fully off-screen and no smoke remains
    if (x < -trainWidth && smoke.length === 0) break;

    const wheelFrame = ((cols - x) % PATTERNS + PATTERNS) % PATTERNS;
    const body = [...D51BODY, ...D51WHEELS[wheelFrame]];
    const full: string[] = [];
    for (let i = 0; i < D51HEIGHT; i++) {
      const bodyLine = i < body.length ? body[i] : '';
      const coalLine = i < COAL.length ? COAL[i] : '';
      full.push(bodyLine + (coalLine.length > 0 ? ' ' + coalLine : ''));
    }

    let frame = '';

    // Draw the train
    for (let i = 0; i < D51HEIGHT; i++) {
      const row = midRow + i;
      if (row < 0 || row >= rows) continue;

      const line = full[i];
      let visibleStart = 0;
      let visibleEnd = line.length;
      let screenCol = x;

      if (x < 0) {
        visibleStart = -x;
        screenCol = 0;
      }
      if (x + visibleEnd > cols) {
        visibleEnd = cols - x;
      }
      if (visibleStart >= visibleEnd) continue;

      const slice = line.substring(visibleStart, visibleEnd);
      frame += moveTo(row, screenCol) + slice;
    }

    // Clear columns behind the train (erase trail)
    const trailCol = x + trainWidth + 1;
    if (trailCol >= 0 && trailCol < cols) {
      for (let i = 0; i < D51HEIGHT; i++) {
        const row = midRow + i;
        if (row >= 0 && row < rows) {
          frame += moveTo(row, trailCol) + '  ';
        }
      }
    }

    // Spawn smoke (only while funnel is on screen)
    if (x % 4 === 0 && x + D51FUNNEL >= 0 && x + D51FUNNEL < cols) {
      const sy = midRow - 1;
      const sx = x + D51FUNNEL;
      smoke.push({
        y: sy, x: sx,
        prevY: sy, prevX: sx, prevLen: 0,
        age: 0,
        kind: smokeCounter % 2,
      });
      smokeCounter++;
    }

    // Erase previous positions, then draw new positions
    for (const p of smoke) {
      if (p.prevLen > 0) {
        frame = eraseSmoke(frame, p.prevY, p.prevX, p.prevLen);
      }
    }

    for (const p of smoke) {
      if (p.age < SMOKEPTNS) {
        const pattern = p.kind === 0 ? smokeA[p.age] : smokeB[p.age];
        const px = p.x - Math.floor(pattern.length / 2);
        if (p.y >= 0 && p.y < rows && px >= 0 && px + pattern.length <= cols) {
          frame += moveTo(p.y, px) + pattern;
        }
        // Save current as prev, then age
        p.prevY = p.y;
        p.prevX = p.x;
        p.prevLen = pattern.length;
        p.y -= dy[p.age];
        p.x += dx[p.age];
        p.age++;
      }
    }

    // Remove expired particles (erase their last position)
    for (let si = smoke.length - 1; si >= 0; si--) {
      if (smoke[si].age >= SMOKEPTNS) {
        const p = smoke[si];
        frame = eraseSmoke(frame, p.prevY, p.prevX, p.prevLen);
        smoke.splice(si, 1);
      }
    }

    ctx.stdout.write(frame);
    await sleep(40);
  }

  // Switch back to main screen buffer - restores previous terminal content
  ctx.stdout.write(SHOW_CURSOR + ALT_SCREEN_OFF);

  return 0;
};

export default command;
