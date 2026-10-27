import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder } from 'util';
 
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
 
  // Для каждого адреса создаём карточку FileInfo (все файлы обрабатываются параллельно)
  return Promise.all(
    uris.map(async (uri) => {
      const stat = await vscode.workspace.fs.stat(uri); // сведения о файле (нужен размер)
      const name = path.basename(uri.fsPath);
      // Если расширения нет (например, .gitignore), подставляем подпись
      const ext = path.extname(name).toLowerCase() || '(без расширения)';
      return { uri, name, ext, size: stat.size };
    })
  );
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
    // Если расширение встретилось впервые, начинаем счёт с 0
    counts.set(f.ext, (counts.get(f.ext) ?? 0) + 1);
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
  // Берём только текстовые файлы: у картинок и архивов строк нет
  const textFiles = files.filter((f) => TEXT_EXT.has(f.ext));
 
  // Читаем каждый файл и считаем в нём строки (разделитель - символ переноса \n)
  const perFile = await Promise.all(
    textFiles.map(async (f) => {
      const bytes = await vscode.workspace.fs.readFile(f.uri);
      return new TextDecoder().decode(bytes).split('\n').length;
    })
  );
 
  // Складываем числа строк всех файлов
  return perFile.reduce((sum, n) => sum + n, 0);
}
 
/**
 * Переводит размер из байтов в читаемый вид.
 * @param bytes размер в байтах
 * @returns строка с единицей измерения (Б, КБ или МБ)
 * @example formatSize(2048) // "2.0 КБ"
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
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
  // Строка-разделитель с заголовком
  const separator = (label: string): StatItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
 
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const readmes = files.filter((f) => /^readme/i.test(f.name)).length; // имя начинается с "readme"
  const byExt = [...countByExtension(files)].sort((a, b) => b[1] - a[1]); // сначала самые частые типы
  const top = [...files].sort((a, b) => b.size - a.size).slice(0, 3); // три самых больших файла
 
  return [
    // Общие числа
    { label: '$(files) Всего файлов', description: String(files.length) },
    { label: '$(database) Общий размер', description: formatSize(totalSize) },
    { label: '$(list-ordered) Строк в текстовых файлах', description: String(lines) },
    { label: '$(book) README-файлов', description: String(readmes) },
    // Файлы по расширениям
    separator('По расширениям'),
    ...byExt.map(([ext, n]) => ({ label: ext, description: `${n} шт.` })),
    // Топ-3 файла (звёздочка у самого большого, uri нужен, чтобы открыть файл по клику)
    separator('Самые большие файлы (клик - открыть)'),
    ...top.map((f, i) => ({
      label: `${i === 0 ? '$(star) ' : ''}${f.name}`,
      description: formatSize(f.size),
      uri: f.uri,
    })),
  ];
}
 
/**
 * Точка входа: VS Code вызывает её при запуске плагина.
 * Регистрирует команду и кнопку в статус-баре.
 * @param context контекст плагина (хранит его ресурсы)
 */
export function activate(context: vscode.ExtensionContext): void {
  // Команда должна называться так же, как в package.json
  const command = vscode.commands.registerCommand('project-stats.showStats', async () => {
    // Если папка не открыта, то и считать нечего
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showWarningMessage('Откройте папку с проектом');
      return;
    }
    const files = await collectFiles();
    const lines = await countLines(files);
    const picked = await vscode.window.showQuickPick(buildItems(files, lines), { title: 'Project Stats' });
    // Если выбран файл из топа, открываем его в редакторе
    if (picked?.uri) {
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
 