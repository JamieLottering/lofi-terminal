// electron-builder afterPack hook.
//
// node-pty's npm tarball ships prebuilds/darwin-*/spawn-helper without the
// execute bit. On macOS node-pty launches every shell through that helper, so
// without +x pty.spawn() throws "posix_spawnp failed" and the terminal is blank.
const fs = require('fs');
const path = require('path');

function findSpawnHelpers(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findSpawnHelpers(p, out);
    else if (e.name === 'spawn-helper') out.push(p);
  }
  return out;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = `${context.packager.appInfo.productFilename}.app`;
  const ptyDir = path.join(context.appOutDir, app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty');
  const helpers = findSpawnHelpers(ptyDir);
  if (!helpers.length) throw new Error(`afterPack: no node-pty spawn-helper found under ${ptyDir}`);
  for (const h of helpers) fs.chmodSync(h, 0o755);
};
