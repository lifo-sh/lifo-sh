import type { Command } from '../types.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

function formatDate(format: string, d: Date): string {
  let result = '';
  let i = 0;
  while (i < format.length) {
    if (format[i] === '%' && i + 1 < format.length) {
      i++;
      switch (format[i]) {
        case 'Y': result += d.getFullYear(); break;
        case 'm': result += pad(d.getMonth() + 1); break;
        case 'd': result += pad(d.getDate()); break;
        case 'H': result += pad(d.getHours()); break;
        case 'M': result += pad(d.getMinutes()); break;
        case 'S': result += pad(d.getSeconds()); break;
        case 'A': result += DAYS[d.getDay()]; break;
        case 'B': result += MONTHS[d.getMonth()]; break;
        case 'Z': result += 'UTC'; break;
        case 's': result += Math.floor(d.getTime() / 1000); break;
        case 'p': result += d.getHours() >= 12 ? 'PM' : 'AM'; break;
        case 'I': {
          const h = d.getHours() % 12;
          result += pad(h === 0 ? 12 : h);
          break;
        }
        case '%': result += '%'; break;
        default: result += '%' + format[i]; break;
      }
      i++;
    } else {
      result += format[i];
      i++;
    }
  }
  return result;
}

const command: Command = async (ctx) => {
  const now = new Date();

  if (ctx.args.length > 0 && ctx.args[0].startsWith('+')) {
    const format = ctx.args[0].slice(1);
    ctx.stdout.write(formatDate(format, now) + '\n');
  } else {
    ctx.stdout.write(now.toString() + '\n');
  }

  return 0;
};

export default command;
