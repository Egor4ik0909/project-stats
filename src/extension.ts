import * as vscode from 'vscode';
import * as path from 'path';
 
/**
 * Данные об одном файле проекта.
 */
interface FileInfo {
  /** Адрес файла: по нему файл можно прочитать или открыть. */
  uri: vscode.Uri;
  /** Имя файла, например "main.cpp". */
  name: string;
  /** Расширение в нижнем регистре, например ".cpp". */
  ext: string;
  /** Размер файла в байтах. */
  size: number;
}
 
/**
 * Одна строка в окне статистики.
 * Поле uri заполнено только у файлов, которые можно открыть кликом.
 */
interface StatItem extends vscode.QuickPickItem {
  uri?: vscode.Uri;
}
 
/** Маска служебных папок, которые не учитываются в статистике. */
const EXCLUDE = '**/{node_modules,.git,out,dist,build}/**';
 
/** Расширения текстовых файлов: только у них считаются строки. */
const TEXT_EXT = new Set(['.cpp', '.c', '.h', '.hpp', '.ts', '.js', '.py', '.java', '.md', '.txt', '.json']);
 
/**
 * Собирает информацию обо всех файлах открытой папки (кроме служебных).
 * @returns список файлов с именем, расширением и размером
 * @example const files = await collectFiles(); // [{ name: "main.cpp", ext: ".cpp", size: 1024, ... }]
 */
async function collectFiles(): Promise<FileInfo[]> {
  // Находим адреса всех файлов в папке, пропуская служебные
  const uris = await vscode.workspace.findFiles('**/*', EXCLUDE);
 
  const files: FileInfo[] = [];
  for (const uri of uris) {
    const stat = await vscode.workspace.fs.stat(uri); // сведения о файле (нужен размер)
    const name = path.basename(uri.fsPath);
    let ext = path.extname(name).toLowerCase();
    if (ext === '') {
      ext = '(без расширения)'; // например, у файла .gitignore
    }
    files.push({ uri: uri, name: name, ext: ext, size: stat.size });
  }
  return files;
}
 
/**
 * Считает, сколько файлов каждого расширения.
 * @param files список файлов проекта
 * @returns словарь: расширение -> количество файлов
 * @example countByExtension(files) // Map { ".cpp" => 12, ".md" => 2 }
 */
function countByExtension(files: FileInfo[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of files) {
    const current = counts.get(f.ext);
    if (current === undefined) {
      counts.set(f.ext, 1); // такое расширение встретилось впервые
    } else {
      counts.set(f.ext, current + 1);
    }
  }
  return counts;
}
 
/**
 * Считает общее число строк во всех текстовых файлах.
 * @param files список файлов проекта
 * @returns суммарное число строк
 * @example const lines = await countLines(files); // 1523
 */
async function countLines(files: FileInfo[]): Promise<number> {
  let total = 0;
  for (const f of files) {
    // У картинок и архивов строк нет, пропускаем их
    if (!TEXT_EXT.has(f.ext)) {
      continue;
    }
    const bytes = await vscode.workspace.fs.readFile(f.uri);
    const text = Buffer.from(bytes).toString('utf8');
    total += text.split('\n').length; // строки разделены символом переноса \n
  }
  return total;
}
 
/**
 * Переводит размер из байтов в читаемый вид.
 * @param bytes размер в байтах
 * @returns строка с единицей измерения (Б, КБ или МБ)
 * @example formatSize(2048) // "2.0 КБ"
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return bytes + ' Б';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' КБ';
  }
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}
 
/**
 * Формирует строки для окна со статистикой: общие числа,
 * файлы по расширениям и три самых больших файла.
 * @param files список файлов проекта
 * @param lines общее число строк (результат countLines)
 * @returns строки для окна QuickPick
 * @example const items = buildItems(files, 1523);
 */
function buildItems(files: FileInfo[], lines: number): StatItem[] {
  // Считаем общий размер и количество README-файлов
  let totalSize = 0;
  let readmes = 0;
  for (const f of files) {
    totalSize += f.size;
    if (f.name.toLowerCase().startsWith('readme')) {
      readmes++;
    }
  }
 
  const items: StatItem[] = [];
 
  // Общие числа
  items.push({ label: '$(files) Всего файлов', description: String(files.length) });
  items.push({ label: '$(database) Общий размер', description: formatSize(totalSize) });
  items.push({ label: '$(list-ordered) Строк в текстовых файлах', description: String(lines) });
  items.push({ label: '$(book) README-файлов', description: String(readmes) });
 
  // Файлы по расширениям: сначала самые частые
  items.push({ label: 'По расширениям', kind: vscode.QuickPickItemKind.Separator });
  const pairs = Array.from(countByExtension(files)); // список пар [расширение, количество]
  pairs.sort((a, b) => b[1] - a[1]);
  for (const pair of pairs) {
    items.push({ label: pair[0], description: pair[1] + ' шт.' });
  }
 
  // Три самых больших файла (по клику файл откроется)
  items.push({ label: 'Самые большие файлы (клик - открыть)', kind: vscode.QuickPickItemKind.Separator });
  const sorted = files.slice(); // копия списка, чтобы не менять исходный
  sorted.sort((a, b) => b.size - a.size);
  for (let i = 0; i < 3 && i < sorted.length; i++) {
    const f = sorted[i];
    let label = f.name;
    if (i === 0) {
      label = '$(star) ' + f.name; // звёздочка у самого большого
    }
    items.push({ label: label, description: formatSize(f.size), uri: f.uri });
  }
 
  return items;
}
 
/**
 * Точка входа: VS Code вызывает её при запуске плагина.
 * Регистрирует команду и кнопку в статус-баре.
 * @param context контекст плагина (хранит его ресурсы)
 */
export function activate(context: vscode.ExtensionContext): void {
  // Команда должна называться так же, как в package.json
  const command = vscode.commands.registerCommand('project-stats.showStats', async () => {
    // Если папка не открыта, считать нечего
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showWarningMessage('Откройте папку с проектом');
      return;
    }
    const files = await collectFiles();
    const lines = await countLines(files);
    const picked = await vscode.window.showQuickPick(buildItems(files, lines), { title: 'Project Stats' });
    // Если выбран файл из топа, открываем его в редакторе
    if (picked && picked.uri) {
      await vscode.commands.executeCommand('vscode.open', picked.uri);
    }
  });
 
  // Кнопка слева в статус-баре, по клику запускает команду
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  bar.text = '$(graph) Project Stats';
  bar.tooltip = 'Показать статистику проекта';
  bar.command = 'project-stats.showStats';
  bar.show();
 
  // Регистрируем ресурсы, чтобы VS Code убрал их при выключении плагина
  context.subscriptions.push(command, bar);
}
 
/** Вызывается при выключении плагина (очищать нечего). */
export function deactivate(): void {}