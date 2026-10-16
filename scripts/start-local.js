const { spawn } = require('node:child_process');
const { createLocalIdamStub } = require('./local-idam-stub');

const host = 'localhost';
const port = Number(process.env.IDAM_STUB_PORT || 5000);
const idamStub = createLocalIdamStub();
let application;

const shutdown = (signal) => {
  if (application && !application.killed) {
    application.kill(signal);
  }
  idamStub.close();
};

idamStub.on('error', (error) => {
  process.stderr.write(`Unable to start the local IDAM stub: ${error.message}\n`);
  process.exitCode = 1;
});

idamStub.listen(port, host, () => {
  process.stdout.write(`Local IDAM stub listening at http://${host}:${port}\n`);

  application = spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      IDAM_BASE_URL: `http://${host}:${port}`,
    },
    stdio: 'inherit',
  });

  application.on('exit', (code, signal) => {
    idamStub.close(() => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exitCode = code;
      }
    });
  });
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
