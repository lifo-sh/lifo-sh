/**
 * lifo-pkg-ffmpeg -- FFmpeg command for Lifo, powered by ffmpeg.wasm.
 *
 * Usage:
 *   ffmpeg -i input.mp4 output.mp3          Convert video to audio
 *   ffmpeg -i input.wav -ar 16000 out.wav    Resample audio
 *   ffmpeg -i video.mp4 -ss 5 -t 10 clip.mp4  Extract 10s clip
 *   ffmpeg -version                          Show ffmpeg version
 *   ffmpeg -formats                          List supported formats
 *   ffmpeg -codecs                           List supported codecs
 *
 * Files are read from and written to the Lifo VFS.
 * FFmpeg WASM core is loaded from CDN on first use.
 */

import type { Command, CommandContext } from '@lifo-sh/core';
import type { FFmpeg as FFmpegType } from '@ffmpeg/ffmpeg';

// CDN URLs -- load @ffmpeg/ffmpeg and @ffmpeg/util from CDN to avoid
// bundler issues with ffmpeg.wasm's internal Web Worker creation.
const FFMPEG_CDN = 'https://esm.sh/@ffmpeg/ffmpeg@0.12.10';
const UTIL_CDN = 'https://esm.sh/@ffmpeg/util@0.12.1';
const CORE_VERSION = '0.12.10';
const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

// Singleton FFmpeg instance (persists across command invocations)
let _ffmpeg: FFmpegType | null = null;
let _loading: Promise<FFmpegType> | null = null;

async function getFFmpeg(
  stdout: { write: (s: string) => void },
  stderr: { write: (s: string) => void },
): Promise<FFmpegType> {
  if (_ffmpeg?.loaded) return _ffmpeg;
  if (_loading) return _loading;

  _loading = (async () => {
    // Load from CDN to avoid Vite bundling issues with ffmpeg.wasm's Worker
    const { FFmpeg } = await import(/* @vite-ignore */ FFMPEG_CDN);
    const { toBlobURL } = await import(/* @vite-ignore */ UTIL_CDN);

    const ffmpeg = new FFmpeg();

    // Forward ffmpeg log messages to stderr
    ffmpeg.on('log', ({ message }: { message: string }) => {
      stderr.write(message + '\n');
    });

    stdout.write('Loading ffmpeg core...\n');

    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    _ffmpeg = ffmpeg;
    _loading = null;
    return ffmpeg;
  })();

  return _loading;
}

// ─── Argument parsing ───

interface ParsedArgs {
  inputs: string[];       // files after -i flags
  output: string | null;  // last non-flag argument (the output file)
  ffmpegArgs: string[];   // all args as-is for ffmpeg.exec()
  isInfoOnly: boolean;    // -version, -formats, -codecs, etc.
}

function parseArgs(args: string[]): ParsedArgs {
  const inputs: string[] = [];
  let output: string | null = null;
  let isInfoOnly = false;

  const infoFlags = ['-version', '-formats', '-codecs', '-decoders', '-encoders',
    '-protocols', '-filters', '-pix_fmts', '-sample_fmts', '-help', '-h',
    '-buildconf', '-devices', '-layouts', '-colors'];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-i' && i + 1 < args.length) {
      inputs.push(args[i + 1]);
      i++; // skip the filename
    } else if (infoFlags.includes(args[i])) {
      isInfoOnly = true;
    }
  }

  // The output is the last argument that doesn't start with '-'
  // and isn't a value for a flag
  if (!isInfoOnly && args.length > 0) {
    const last = args[args.length - 1];
    if (!last.startsWith('-')) {
      output = last;
    }
  }

  return { inputs, output, ffmpegArgs: args, isInfoOnly };
}

// ─── VFS <-> FFmpeg MEMFS bridge ───

async function copyVfsToMemfs(
  ffmpeg: FFmpegType,
  vfs: CommandContext['vfs'],
  vfsPath: string,
  memfsPath: string,
): Promise<void> {
  const data = vfs.readFile(vfsPath);
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data instanceof Uint8Array
      ? data
      : new Uint8Array(data as ArrayBuffer);
  await ffmpeg.writeFile(memfsPath, bytes);
}

async function copyMemfsToVfs(
  ffmpeg: FFmpegType,
  memfsPath: string,
  vfs: CommandContext['vfs'],
  vfsPath: string,
): Promise<void> {
  const data = await ffmpeg.readFile(memfsPath);
  if (data instanceof Uint8Array) {
    vfs.writeFile(vfsPath, data);
  } else {
    vfs.writeFile(vfsPath, data as string);
  }
}

function resolvePath(cwd: string, filePath: string): string {
  if (filePath.startsWith('/')) return filePath;
  // Simple join for relative paths
  const base = cwd.endsWith('/') ? cwd : cwd + '/';
  return base + filePath;
}

// Unique name for memfs to avoid collisions between runs
function memfsName(filePath: string): string {
  return filePath.replace(/[/\\]/g, '_');
}

// ─── Command ───

const ffmpegCommand: Command = async (ctx: CommandContext): Promise<number> => {
  const { args, vfs, cwd, stdout, stderr } = ctx;

  if (args.length === 0 || args.includes('--help')) {
    stdout.write('Usage: ffmpeg [options] [[infile options] -i infile]... {[outfile options] outfile}...\n\n');
    stdout.write('Powered by ffmpeg.wasm (WebAssembly). Files are read from/written to the Lifo VFS.\n\n');
    stdout.write('Examples:\n');
    stdout.write('  ffmpeg -i video.mp4 audio.mp3          Extract audio\n');
    stdout.write('  ffmpeg -i input.wav -ar 16000 out.wav   Resample audio\n');
    stdout.write('  ffmpeg -i video.mp4 -ss 5 -t 10 c.mp4  Extract 10s clip from 5s\n');
    stdout.write('  ffmpeg -i image.png -vf scale=320:240 thumb.png  Resize image\n');
    stdout.write('  ffmpeg -version                         Show version\n');
    stdout.write('  ffmpeg -formats                         List formats\n');
    stdout.write('  ffmpeg -codecs                          List codecs\n');
    return 0;
  }

  const parsed = parseArgs(args);

  let ffmpeg: FFmpegType;
  try {
    ffmpeg = await getFFmpeg(stdout, stderr);
  } catch (e) {
    stderr.write(`ffmpeg: failed to load WASM core: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  // For info-only commands, just exec directly
  if (parsed.isInfoOnly) {
    const exitCode = await ffmpeg.exec(parsed.ffmpegArgs);
    return exitCode;
  }

  // Copy input files from VFS to ffmpeg MEMFS
  const inputMap = new Map<string, string>(); // original name -> memfs name
  for (const input of parsed.inputs) {
    const vfsPath = resolvePath(cwd, input);

    if (!vfs.exists(vfsPath)) {
      stderr.write(`ffmpeg: ${input}: No such file or directory\n`);
      return 1;
    }

    const mName = memfsName(input);
    inputMap.set(input, mName);

    try {
      await copyVfsToMemfs(ffmpeg, vfs, vfsPath, mName);
    } catch (e) {
      stderr.write(`ffmpeg: error reading ${input}: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  }

  // Rewrite args: replace input filenames with memfs names,
  // and output filename with memfs name
  const outputMemfs = parsed.output ? memfsName(parsed.output) : null;
  const execArgs = parsed.ffmpegArgs.map((arg, i) => {
    // If this arg follows -i, replace with memfs name
    if (i > 0 && parsed.ffmpegArgs[i - 1] === '-i' && inputMap.has(arg)) {
      return inputMap.get(arg)!;
    }
    // If this is the output file (last arg), replace with memfs name
    if (parsed.output && arg === parsed.output && i === parsed.ffmpegArgs.length - 1 && outputMemfs) {
      return outputMemfs;
    }
    return arg;
  });

  // Run ffmpeg
  const exitCode = await ffmpeg.exec(execArgs);

  // Copy output from ffmpeg MEMFS back to VFS
  if (exitCode === 0 && parsed.output && outputMemfs) {
    const vfsPath = resolvePath(cwd, parsed.output);
    try {
      await copyMemfsToVfs(ffmpeg, outputMemfs, vfs, vfsPath);
      stdout.write(`Output written to ${parsed.output}\n`);
    } catch (e) {
      stderr.write(`ffmpeg: error writing output ${parsed.output}: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  }

  // Cleanup memfs
  for (const mName of inputMap.values()) {
    try { await ffmpeg.deleteFile(mName); } catch { /* ignore */ }
  }
  if (outputMemfs) {
    try { await ffmpeg.deleteFile(outputMemfs); } catch { /* ignore */ }
  }

  return exitCode;
};

export default ffmpegCommand;
