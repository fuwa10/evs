/**
 * Chrome Web Store 用の zip を作成するスクリプト
 * ex-evs/ から不要ファイルを除外してクリーンな zip を生成する
 *
 * 使い方: npm run zip:extension
 * 出力: dist/ex-evs-v{version}.zip
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'ex-evs');
const DIST_DIR = path.join(ROOT, 'dist');

// manifest.json からバージョンを取得
const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
const version = manifest.version;
const zipName = `ex-evs-v${version}.zip`;
const zipPath = path.join(DIST_DIR, zipName);

// 除外するパターン
const EXCLUDES = [
  '*.DS_Store',
  '.git/*',
  '.git',
  '.gitignore',
  '.test/*',
  '.test',
  '.vscode/*',
  '.vscode',
  'README.md',
  '*/CLAUDE.md',
  'CLAUDE.md',
  'js/jquery-3.6.0.min.js',
];

// dist/ ディレクトリを作成
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// 既存の zip を削除
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// zip コマンドを構築
const excludeArgs = EXCLUDES.map(e => `-x '${e}'`).join(' ');
const cmd = `cd "${EXT_DIR}" && zip -r "${zipPath}" . ${excludeArgs}`;

console.log(`\nex-evs v${version} の zip を作成中...\n`);

try {
  execSync(cmd, { stdio: 'pipe' });
} catch (e) {
  console.error('zip 作成エラー:', e.message);
  process.exit(1);
}

// zip の中身を確認
console.log('--- zip の内容 ---');
const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf8' });
console.log(listing);

// ファイルサイズ
const stats = fs.statSync(zipPath);
const sizeKB = (stats.size / 1024).toFixed(1);

console.log(`✅ ${zipName} (${sizeKB} KB) を作成しました`);
console.log(`   ${zipPath}\n`);
