import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder } from 'util';

interface FileInfo{
	uri: vscode.Uri;
	name: string;
	ext: string;
	size: number;
}

interface StatItem extends vscode.QuickPickItem {
  uri?: vscode.Uri;
}

const EXCLUDE = '**/{node_modules,.git,out,dist,build}/**'
const TEXT_EXT = new Set(['.cpp', '.c', '.h', '.hpp', '.ts', '.js', '.py', '.java', '.md', '.txt', '.json']);

/**
 * Собирает информацию обо всех файлах открытой папки (кроме служебных).
 * @example const files = await collectFiles(); // [{ name: "main.cpp", ext: ".cpp", size: 1024, ... }]
 */
async function collectFiles(): Promise<FileInfo[]>{
	const uris = await vscode.workspace.findFiles('**/*', EXCLUDE);
	return Promise.all(
		uris.map(async (uri) => {
			const stat = await vscode.workspace.fs.stat(uri);
			const name = path.basename(uri.fsPath);
			const ext = path.extname(name).toLowerCase() || '(без расширения)';
			return {uri, name, ext, size: stat.size };
		})
	);
}

/**
 * Считает, сколько файлов каждого расширения.
 * @example countByExtension(files) // Map { ".cpp" => 12, ".md" => 2 }
 */
function countByExtension(files: FileInfo[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of files) {
    counts.set(f.ext, (counts.get(f.ext) ?? 0) + 1);
  }
  return counts;
}

/**
 * Считает общее число строк во всех текстовых файлах.
 * @example const lines = await countLines(files); // 1523
 */
async function countLines(files: FileInfo[]): Promise<number> {
  const textFiles = files.filter((f) => TEXT_EXT.has(f.ext));
  const perFile = await Promise.all(
    textFiles.map(async (f) => {
      const bytes = await vscode.workspace.fs.readFile(f.uri);
      return new TextDecoder().decode(bytes).split('\n').length;
    })
  );
  return perFile.reduce((sum, n) => sum + n, 0);
}

/**
 * Переводит байты в читаемый вид.
 * @example formatSize(2048) // "2.0 КБ"
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
}

/**
 * Формирует строки для окна со статистикой.
 * @example const items = buildItems(files, 1523);
 */
function buildItems(files: FileInfo[], lines: number): StatItem[] {
  const separator = (label: string): StatItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const readmes = files.filter((f) => /^readme/i.test(f.name)).length;
  const byExt = [...countByExtension(files)].sort((a, b) => b[1] - a[1]);
  const top = [...files].sort((a, b) => b.size - a.size).slice(0, 3);

  return [
    { label: '$(files) Всего файлов', description: String(files.length) },
    { label: '$(database) Общий размер', description: formatSize(totalSize) },
    { label: '$(list-ordered) Строк в текстовых файлах', description: String(lines) },
    { label: '$(book) README-файлов', description: String(readmes) },
    separator('По расширениям'),
    ...byExt.map(([ext, n]) => ({ label: ext, description: `${n} шт.` })),
    separator('Самые большие файлы (клик - открыть)'),
    ...top.map((f, i) => ({
      label: `${i === 0 ? '$(star) ' : ''}${f.name}`,
      description: formatSize(f.size),
      uri: f.uri,
    })),
  ];
}

/** Точка входа: регистрирует команду и кнопку в статус-баре. */
export function activate(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('project-stats.showStats', async () => {
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showWarningMessage('Откройте папку с проектом');
      return;
    }
    const files = await collectFiles();
    const lines = await countLines(files);
    const picked = await vscode.window.showQuickPick(buildItems(files, lines), { title: 'Project Stats' });
    if (picked?.uri) {
      await vscode.commands.executeCommand('vscode.open', picked.uri);
    }
  });

  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  bar.text = '$(graph) Project Stats';
  bar.tooltip = 'Показать статистику проекта';
  bar.command = 'project-stats.showStats';
  bar.show();

  context.subscriptions.push(command, bar);
}

/** Вызывается при выключении плагина. */
export function deactivate(): void {}