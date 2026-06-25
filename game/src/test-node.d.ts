declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string | URL, encoding: string): string;
}

declare module 'node:path' {
  const path: {
    dirname(filePath: string): string;
    join(...parts: string[]): string;
    resolve(...parts: string[]): string;
  };

  export default path;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
