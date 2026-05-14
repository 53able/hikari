#!/usr/bin/env node
import('../dist/cli/index.js')
  .then(({ runCli }) => runCli())
  .then((code) => process.exit(code ?? 0))
  .catch((err) => { console.error(err); process.exit(1); });
